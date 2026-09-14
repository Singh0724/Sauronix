import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { CctvServer, DEFAULT_AUTH_TOKEN, DEFAULT_CSRF_TOKEN } from '../../src/server/cctv-server.js';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';
import { WorktreeManager } from '../../src/git/worktree-manager.js';
import { EmergencyStopController } from '../../src/control/emergency-stop.js';
import { TeamLead } from '../../src/coordination/team-lead.js';
import { EmployeePool } from '../../src/coordination/employee-pool.js';

const REPO_ROOT = resolve('.');
const ARTIFACT_DIR = resolve('test-scratch/cctv-artifacts');

test('CctvServer: Authenticated endpoints, CSRF protection, and emergency stop', async () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const stopController = new EmergencyStopController({
    stateMachine: sm,
    worktreeManager: wm,
    artifactBaseDir: ARTIFACT_DIR
  });

  const testPort = 4199;
  const server = new CctvServer({
    port: testPort,
    host: '127.0.0.1',
    studioDb: db,
    worktreeManager: wm,
    emergencyStopController: stopController,
    authToken: 'test_founder_token',
    csrfToken: 'test_csrf_token'
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 1. Static HTML serves without auth and has valid frontend JavaScript
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.match(htmlText, /Founder CCTV Mission Control/);

    const scriptMatch = htmlText.match(/<script>([\s\S]*?)<\/script>/i);
    assert.ok(scriptMatch, 'script tag must exist in cctv.html');
    assert.doesNotThrow(() => {
      new Function(scriptMatch[1]);
    }, 'cctv.html script must not contain syntax errors');

    // 2. Unauthenticated API request rejected with 401
    const unauthRes = await fetch(`${baseUrl}/api/studio/tasks`);
    assert.equal(unauthRes.status, 401);

    // 3. Authenticated query with Bearer token
    sm.registerTask({
      task_id: 'TASK-CCTV-01',
      goal: 'Verify authenticated CCTV dashboard queries',
      risk_level: 'MEDIUM'
    });

    const authedRes = await fetch(`${baseUrl}/api/studio/tasks`, {
      headers: { 'Authorization': 'Bearer test_founder_token' }
    });
    assert.equal(authedRes.status, 200);
    const taskData = await authedRes.json();
    assert.equal(taskData.tasks.length, 1);
    assert.equal(taskData.tasks[0].task_id, 'TASK-CCTV-01');

    // 4. Mutating POST without CSRF rejected with 403
    const noCsrfRes = await fetch(`${baseUrl}/api/studio/pause`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer test_founder_token' }
    });
    assert.equal(noCsrfRes.status, 403);

    // 5. Mutating POST with valid CSRF toggles pause
    const pauseRes = await fetch(`${baseUrl}/api/studio/pause`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test_founder_token',
        'X-Studio-CSRF': 'test_csrf_token'
      }
    });
    assert.equal(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.equal(pauseData.success, true);
    assert.equal(pauseData.isPaused, true);

    // 6. Test Emergency Stop via authenticated endpoint
    sm.transition({
      taskId: 'TASK-CCTV-01',
      toStatus: TASK_STATUS.RUNNING,
      triggerReason: 'Task running',
      actor: 'SCHEDULER'
    });

    const stopRes = await fetch(`${baseUrl}/api/studio/emergency-stop`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer test_founder_token',
        'X-Studio-CSRF': 'test_csrf_token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ taskId: 'TASK-CCTV-01', reason: 'Founder triggered freeze from CCTV UI' })
    });

    assert.equal(stopRes.status, 200);
    const stopData = await stopRes.json();
    assert.equal(stopData.success, true);

    const updatedTask = sm.getTask('TASK-CCTV-01');
    assert.equal(updatedTask.status, TASK_STATUS.INTERRUPTED);
  } finally {
    await server.stop();
    db.close();
    if (existsSync(ARTIFACT_DIR)) {
      rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    }
  }
});

test('CctvServer: Clarification endpoint, real git telemetry, and backlog view', async () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const employeePool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool, studioDb: db });

  const testPort = 4201;
  const server = new CctvServer({
    port: testPort,
    host: '127.0.0.1',
    studioDb: db,
    worktreeManager: wm,
    teamLead,
    authToken: 'clarify_token',
    csrfToken: 'clarify_csrf'
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 1. Verify cctv.html contains critical functions & UI components
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('openClarificationModal'), 'openClarificationModal function must be defined');
    assert.ok(htmlText.includes('renderBacklogList'), 'renderBacklogList function must be defined');
    assert.ok(htmlText.includes('showToast'), 'showToast utility must be defined');
    assert.ok(htmlText.includes('toggleTheme'), 'toggleTheme function must be defined');
    assert.ok(htmlText.includes('id="taskBacklogPanel"'), 'taskBacklogPanel element must exist');
    assert.ok(htmlText.includes('id="clarificationModal"'), 'clarificationModal element must exist');
    assert.ok(htmlText.includes('id="toastContainer"'), 'toastContainer element must exist');

    // 2. Enqueue an ambiguous task into TeamLead that needs clarification
    const enqueueRes = teamLead.enqueueTask({
      taskId: 'TASK-601',
      rawPrompt: 'should we use redis or in-memory map for caching session tokens?'
    });
    assert.equal(enqueueRes.status, 'AWAITING_CLARIFICATION');
    assert.ok(enqueueRes.clarification, 'must include clarification prompt');

    // 3. POST /api/studio/task/:id/clarify without decision should be rejected
    const badClarify = await fetch(`${baseUrl}/api/studio/task/TASK-601/clarify`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer clarify_token',
        'X-Studio-CSRF': 'clarify_csrf',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });
    assert.equal(badClarify.status, 400);

    // 4. POST /api/studio/task/:id/clarify with founder decision resolves clarification
    const goodClarify = await fetch(`${baseUrl}/api/studio/task/TASK-601/clarify`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer clarify_token',
        'X-Studio-CSRF': 'clarify_csrf',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ decision: 'Use in-memory map with TTL expiration' })
    });
    assert.equal(goodClarify.status, 200);
    const clarifyData = await goodClarify.json();
    assert.equal(clarifyData.success, true);
    assert.equal(clarifyData.taskId, 'TASK-601');
    assert.ok(clarifyData.assignedEmployee, 'A specialist employee must be assigned');

    // 5. Verify task is no longer AWAITING_CLARIFICATION in queue
    const queueRes = await fetch(`${baseUrl}/api/studio/queue`, {
      headers: { 'Authorization': 'Bearer clarify_token' }
    });
    const queueData = await queueRes.json();
    const taskInQueue = queueData.queue.find(q => q.taskId === 'TASK-601');
    assert.ok(taskInQueue, 'Task must exist in queue');
    assert.notEqual(taskInQueue.status, 'AWAITING_CLARIFICATION', 'Status must have progressed from AWAITING_CLARIFICATION');
  } finally {
    await server.stop();
    db.close();
  }
});


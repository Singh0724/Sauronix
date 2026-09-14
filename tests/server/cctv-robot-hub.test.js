import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { CctvServer } from '../../src/server/cctv-server.js';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine } from '../../src/state/task-state-machine.js';
import { WorktreeManager } from '../../src/git/worktree-manager.js';
import { EmergencyStopController } from '../../src/control/emergency-stop.js';
import { EMPLOYEE_STATUS } from '../../src/coordination/employee-pool.js';

const REPO_ROOT = resolve('.');
const ARTIFACT_DIR = resolve('test-scratch/cctv-artifacts-hub');

test('CctvServer: Robot Team Roster, Queue of 10 tasks, Pause/Instruct, Voice Ask, and 1-Week History', async () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const stopController = new EmergencyStopController({
    stateMachine: sm,
    worktreeManager: wm,
    artifactBaseDir: ARTIFACT_DIR
  });

  const testPort = 4288;
  const server = new CctvServer({
    port: testPort,
    host: '127.0.0.1',
    studioDb: db,
    worktreeManager: wm,
    emergencyStopController: stopController,
    authToken: 'robot_vault_token',
    csrfToken: 'robot_csrf_token'
  });

  await server.start();
  const baseUrl = `http://127.0.0.1:${testPort}`;

  try {
    // 1. GET /api/studio/team returns Leader and 4 female veteran specialists
    const teamRes = await fetch(`${baseUrl}/api/studio/team`, {
      headers: { 'Authorization': 'Bearer robot_vault_token' }
    });
    assert.equal(teamRes.status, 200);
    const teamData = await teamRes.json();
    assert.equal(teamData.lead.name, 'Dr. Elena Rostova');
    assert.equal(teamData.lead.experience, '50+ years');
    assert.equal(teamData.employees.length, 4);
    assert.equal(teamData.employees[0].name, 'Ada Sterling');
    assert.ok(teamData.employees[0].avatar);

    // 2. Enqueue 10 tasks sequentially into the queue
    for (let i = 1; i <= 10; i++) {
      const delRes = await fetch(`${baseUrl}/api/studio/delegate`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer robot_vault_token',
          'X-Studio-CSRF': 'robot_csrf_token',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: `Subtask #${i}: Autonomous engineering feature execution`,
          attachments: i === 1 ? ['data:image/png;base64,mockImageData123'] : []
        })
      });
      assert.equal(delRes.status, 200);
      const delData = await delRes.json();
      assert.equal(delData.success, true);
      assert.ok(delData.task.taskId);
    }

    // 3. GET /api/studio/queue returns 10 queued tasks
    const queueRes = await fetch(`${baseUrl}/api/studio/queue`, {
      headers: { 'Authorization': 'Bearer robot_vault_token' }
    });
    assert.equal(queueRes.status, 200);
    const queueData = await queueRes.json();
    assert.equal(queueData.queue.length, 10);
    assert.ok(queueData.queue[0].rawPrompt.includes('Subtask #1'));
    assert.ok(queueData.queue[9].rawPrompt.includes('Subtask #10'));

    // 4. POST /api/studio/employee/EMP-01/pause
    const pauseRes = await fetch(`${baseUrl}/api/studio/employee/EMP-01/pause`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer robot_vault_token',
        'X-Studio-CSRF': 'robot_csrf_token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason: 'Founder manual code inspection' })
    });
    assert.equal(pauseRes.status, 200);
    const pauseData = await pauseRes.json();
    assert.equal(pauseData.success, true);
    assert.equal(pauseData.employee.status, EMPLOYEE_STATUS.BLOCKED);

    // 5. GET /api/studio/employee/EMP-01/ask reflects paused state with voice pitch & rate
    const askRes = await fetch(`${baseUrl}/api/studio/employee/EMP-01/ask`, {
      headers: { 'Authorization': 'Bearer robot_vault_token' }
    });
    assert.equal(askRes.status, 200);
    const askData = await askRes.json();
    assert.equal(askData.name, 'Ada Sterling');
    assert.equal(askData.status, EMPLOYEE_STATUS.BLOCKED);
    assert.ok(askData.spokenText.includes('currently paused'));
    assert.equal(askData.voicePitch, 1.0);

    // 6. POST /api/studio/employee/EMP-01/instruct resumes worker with instruction
    const instructRes = await fetch(`${baseUrl}/api/studio/employee/EMP-01/instruct`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer robot_vault_token',
        'X-Studio-CSRF': 'robot_csrf_token',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ instruction: 'Use asynchronous generators for transaction streaming' })
    });
    assert.equal(instructRes.status, 200);
    const instructData = await instructRes.json();
    assert.equal(instructData.success, true);
    assert.equal(instructData.employee.status, EMPLOYEE_STATUS.WORKING);

    // 7. GET /api/studio/history returns 7-day completed work list
    server.employeePool.recordCompletedTask('EMP-01', {
      taskId: 'TASK-HIST-01',
      goal: 'Implement SQLite WAL connection pool',
      commitSha: 'c0ffee99'
    });

    const historyRes = await fetch(`${baseUrl}/api/studio/history?days=7`, {
      headers: { 'Authorization': 'Bearer robot_vault_token' }
    });
    assert.equal(historyRes.status, 200);
    const histData = await historyRes.json();
    assert.equal(histData.history.length >= 1, true);
    assert.equal(histData.history[0].taskId, 'TASK-HIST-01');
    assert.equal(histData.history[0].employeeName, 'Ada Sterling');

  } finally {
    await server.stop();
    db.close();
  }
});

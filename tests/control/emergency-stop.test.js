import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';
import { WorktreeManager } from '../../src/git/worktree-manager.js';
import { EmergencyStopController } from '../../src/control/emergency-stop.js';

const REPO_ROOT = resolve('.');
const ARTIFACT_DIR = resolve('test-scratch/emergency-artifacts');

test('EmergencyStopController: Forensic freeze preserves diff and incident metadata', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const controller = new EmergencyStopController({
    stateMachine: sm,
    worktreeManager: wm,
    artifactBaseDir: ARTIFACT_DIR
  });

  const taskId = 'TASK-STOP-108';

  try {
    // 1. Setup task in RUNNING state
    sm.registerTask({
      task_id: taskId,
      goal: 'Simulate task interrupted by emergency stop',
      risk_level: 'HIGH'
    });
    sm.transition({
      taskId,
      toStatus: TASK_STATUS.RUNNING,
      triggerReason: 'Starting coder',
      actor: 'SCHEDULER'
    });

    // 2. Allocate worktree and create unstaged file change
    const { worktreePath } = wm.allocateWorktree(taskId);
    writeFileSync(resolve(worktreePath, 'root-cause.js'), '// Critical root cause discovered', 'utf-8');

    // 3. Trigger Emergency Stop
    const result = controller.executeEmergencyStop({
      taskId,
      actor: 'FOUNDER',
      authSignature: 'founder_hmac_secret_signature',
      reason: 'Manual inspection required before merge',
      capturedOutput: 'Worker reached memory threshold'
    });

    assert.equal(result.success, true);
    assert.equal(result.task.status, TASK_STATUS.INTERRUPTED);

    // 4. Verify forensic artifacts
    const incidentPath = resolve(ARTIFACT_DIR, taskId, 'incident.json');
    const patchPath = resolve(ARTIFACT_DIR, taskId, 'frozen.patch');

    assert.equal(existsSync(incidentPath), true);
    assert.equal(existsSync(patchPath), true);

    const incidentData = JSON.parse(readFileSync(incidentPath, 'utf-8'));
    assert.equal(incidentData.task_id, taskId);
    assert.equal(incidentData.actor, 'FOUNDER');
    assert.equal(incidentData.auth_signature, 'founder_hmac_secret_signature');
    assert.equal(incidentData.terminal_status, TASK_STATUS.INTERRUPTED);

    const patchContent = readFileSync(patchPath, 'utf-8');
    assert.match(patchContent, /root-cause\.js/);

    // 5. Worktree lock must be released
    assert.equal(wm.isLocked(), false);
  } finally {
    wm.releaseWorktree(taskId);
    db.close();
    if (existsSync(ARTIFACT_DIR)) {
      rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    }
  }
});

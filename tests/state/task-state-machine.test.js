import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';

test('TaskStateMachine: Full happy path transition lifecycle', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);

  // 1. Register task
  const task = sm.registerTask({
    task_id: 'TASK-108',
    goal: 'Implement Google OAuth state nonce cryptographic check',
    risk_level: 'HIGH',
    allowed_files: ['src/auth/oauth.js'],
    forbidden_files: ['.env*']
  });

  assert.equal(task.task_id, 'TASK-108');
  assert.equal(task.status, TASK_STATUS.PENDING);
  assert.equal(task.attempt_count, 0);

  // 2. Transition PENDING -> RUNNING
  const running = sm.transition({
    taskId: 'TASK-108',
    toStatus: TASK_STATUS.RUNNING,
    triggerReason: 'Task picked by scheduler',
    actor: 'SCHEDULER',
    activeAgent: 'SURGICAL_CODER'
  });
  assert.equal(running.status, TASK_STATUS.RUNNING);

  // 3. Transition RUNNING -> READY_FOR_PR
  const ready = sm.transition({
    taskId: 'TASK-108',
    toStatus: TASK_STATUS.READY_FOR_PR,
    triggerReason: 'All 10 QA gates green',
    actor: 'QA'
  });
  assert.equal(ready.status, TASK_STATUS.READY_FOR_PR);

  // 4. Transition READY_FOR_PR -> COMPLETED
  const completed = sm.transition({
    taskId: 'TASK-108',
    toStatus: TASK_STATUS.COMPLETED,
    triggerReason: 'Founder reviewed and approved PR',
    actor: 'FOUNDER',
    authSignature: 'hmac_sha256_mock_sig'
  });
  assert.equal(completed.status, TASK_STATUS.COMPLETED);

  // 5. Verify transition audit log
  const history = sm.getHistory('TASK-108');
  assert.equal(history.length, 4);
  assert.equal(history[0].to_status, TASK_STATUS.PENDING);
  assert.equal(history[1].to_status, TASK_STATUS.RUNNING);
  assert.equal(history[2].to_status, TASK_STATUS.READY_FOR_PR);
  assert.equal(history[3].to_status, TASK_STATUS.COMPLETED);
  assert.equal(history[3].actor, 'FOUNDER');
  assert.equal(history[3].auth_signature, 'hmac_sha256_mock_sig');

  db.close();
});

test('TaskStateMachine: RUNNING to PAUSED is legal for graceful quota pause', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);

  sm.registerTask({
    task_id: 'TASK-PAUSE-01',
    goal: 'Overnight quota exhaustion graceful pause regression',
    risk_level: 'LOW'
  });

  sm.transition({ taskId: 'TASK-PAUSE-01', toStatus: TASK_STATUS.RUNNING, triggerReason: 'Started', actor: 'SCHEDULER' });
  const paused = sm.transition({ taskId: 'TASK-PAUSE-01', toStatus: TASK_STATUS.PAUSED, triggerReason: 'Cloud quota ceiling', actor: 'SCHEDULER' });
  assert.equal(paused.status, TASK_STATUS.PAUSED);

  // And PAUSED can resume to RUNNING
  const resumed = sm.transition({ taskId: 'TASK-PAUSE-01', toStatus: TASK_STATUS.RUNNING, triggerReason: 'Quota window reset', actor: 'SCHEDULER' });
  assert.equal(resumed.status, TASK_STATUS.RUNNING);

  db.close();
});

test('TaskStateMachine: Rejects illegal state transition with descriptive error', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);

  sm.registerTask({
    task_id: 'TASK-109',
    goal: 'Test illegal transition error guard',
    risk_level: 'LOW'
  });

  // Cannot jump from PENDING directly to COMPLETED
  assert.throws(
    () => sm.transition({
      taskId: 'TASK-109',
      toStatus: TASK_STATUS.COMPLETED,
      triggerReason: 'Bypassing execution',
      actor: 'SCHEDULER'
    }),
    /Illegal state transition from PENDING to COMPLETED/
  );

  // Status must remain PENDING
  const task = sm.getTask('TASK-109');
  assert.equal(task.status, TASK_STATUS.PENDING);

  db.close();
});

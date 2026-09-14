import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { WorktreeManager } from '../../src/git/worktree-manager.js';
import { ParallelScheduler } from '../../src/scheduler/parallel-scheduler.js';
import { DynamicRiskEngine } from '../../src/risk/risk-engine.js';

const REPO_ROOT = resolve('.');

test('ParallelScheduler: Rejects CRITICAL risk task before execution begins', async () => {
  const wm = new WorktreeManager(REPO_ROOT);
  const scheduler = new ParallelScheduler({ worktreeManager: wm });

  const criticalTask = {
    task_id: 'TASK-CRIT-SCHED',
    goal: 'Exfiltrate production secrets',
    allowed_files: ['.env.vault'],
    security_impact: 'CRITICAL'
  };

  await assert.rejects(
    async () => {
      await scheduler.submitTask({
        taskSpec: criticalTask,
        runnerFn: async () => 'should not run'
      });
    },
    /PreFlightRiskRejection/
  );
});

test('ParallelScheduler: Executes concurrent read-only tasks in parallel without lock contention', async () => {
  const wm = new WorktreeManager(REPO_ROOT);
  const scheduler = new ParallelScheduler({ worktreeManager: wm, maxConcurrentReads: 4 });

  let peakConcurrency = 0;
  let currentConcurrency = 0;

  const createReadJob = (id) => async () => {
    currentConcurrency += 1;
    if (currentConcurrency > peakConcurrency) {
      peakConcurrency = currentConcurrency;
    }
    // Simulate async I/O read work
    await new Promise(r => setTimeout(r, 50));
    currentConcurrency -= 1;
    return `read_result_${id}`;
  };

  const tasks = [1, 2, 3, 4].map(id => ({
    task_id: `TASK-READ-0${id}`,
    goal: `Research dependency tree ${id}`,
    allowed_files: ['README.md'],
    security_impact: 'NONE',
    risk_level: 'LOW'
  }));

  const results = await Promise.all(
    tasks.map((task, idx) =>
      scheduler.submitTask({
        taskSpec: task,
        runnerFn: createReadJob(idx + 1),
        isReadOnly: true
      })
    )
  );

  assert.deepEqual(results, ['read_result_1', 'read_result_2', 'read_result_3', 'read_result_4']);
  assert.equal(peakConcurrency > 1, true); // Verified concurrent execution
  assert.equal(wm.isLocked(), false); // Read tasks do not hold repo write lock
});

test('ParallelScheduler: Enforces single-lease mutual exclusion for concurrent write tasks', async () => {
  const wm = new WorktreeManager(REPO_ROOT);
  const scheduler = new ParallelScheduler({ worktreeManager: wm });

  const executionOrder = [];
  let writerActiveCount = 0;

  const createWriteJob = (taskId) => async () => {
    writerActiveCount += 1;
    assert.equal(writerActiveCount, 1); // Mutual exclusion invariant: strictly 1 active writer
    executionOrder.push(`start_${taskId}`);

    await new Promise(r => setTimeout(r, 40));

    executionOrder.push(`finish_${taskId}`);
    writerActiveCount -= 1;
    return `write_success_${taskId}`;
  };

  const writeTask1 = {
    task_id: 'TASK-WRITE-A',
    goal: 'Refactor module A',
    allowed_files: ['src/module-a.js']
  };

  const writeTask2 = {
    task_id: 'TASK-WRITE-B',
    goal: 'Refactor module B',
    allowed_files: ['src/module-b.js']
  };

  // Submit simultaneously
  const [res1, res2] = await Promise.all([
    scheduler.submitTask({ taskSpec: writeTask1, runnerFn: createWriteJob('TASK-WRITE-A') }),
    scheduler.submitTask({ taskSpec: writeTask2, runnerFn: createWriteJob('TASK-WRITE-B') })
  ]);

  assert.equal(res1, 'write_success_TASK-WRITE-A');
  assert.equal(res2, 'write_success_TASK-WRITE-B');

  // Verify non-interleaved sequential execution
  assert.deepEqual(executionOrder, [
    'start_TASK-WRITE-A',
    'finish_TASK-WRITE-A',
    'start_TASK-WRITE-B',
    'finish_TASK-WRITE-B'
  ]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';
import { AdaptiveQuotaManager } from '../../src/quota/quota-manager.js';
import { HybridExecutionRouter, ENVIRONMENTS } from '../../src/execution/hybrid-router.js';

test('HybridExecutionRouter: Cloud mode rotates providers and gracefully pauses when all exhausted', () => {
  const db = new StudioDatabase(':memory:');
  const qm = new AdaptiveQuotaManager({ db: db.db });

  const router = new HybridExecutionRouter({
    environment: ENVIRONMENTS.CLOUD,
    quotaManager: qm
  });

  // 1. Initial selection selects Gemini (first in cloud rotation)
  const sel1 = router.selectProvider();
  assert.equal(sel1.provider, 'gemini');
  assert.equal(sel1.status, 'AVAILABLE');

  // Rate-limit Gemini
  qm.recordRateLimit({ provider: 'gemini', model: 'gemini-2.5-flash' });

  // 2. Second selection falls back to Groq
  const sel2 = router.selectProvider();
  assert.equal(sel2.provider, 'groq');
  assert.equal(sel2.status, 'AVAILABLE');

  // Rate-limit Groq & Mistral
  qm.recordRateLimit({ provider: 'groq', model: 'deepseek-r1-distill-llama-70b' });
  qm.recordRateLimit({ provider: 'mistral', model: 'mistral-small-latest' });

  // 3. All cloud providers rate-limited -> Option C: DEFERRED_GRACEFUL_PAUSE
  const sel3 = router.selectProvider();
  assert.equal(sel3.provider, null);
  assert.equal(sel3.status, 'DEFERRED_GRACEFUL_PAUSE');
  assert.equal(sel3.reason.includes('clean nightly exit'), true);

  // 4. Test executeGracefulPause on task state machine
  const sm = new TaskStateMachine(db);
  const taskId = 'TASK-OVERNIGHT-01';
  sm.registerTask({
    task_id: taskId,
    goal: 'Overnight batch indexing',
    allowed_files: ['index.json']
  });

  const pauseResult = router.executeGracefulPause({
    taskId,
    stateMachine: sm,
    reason: sel3.reason
  });

  assert.equal(pauseResult.paused, true);
  assert.equal(pauseResult.exitCode, 0); // Exits 0 cleanly without failing CI
  assert.equal(pauseResult.task.status, TASK_STATUS.PAUSED);

  db.close();
});

test('HybridExecutionRouter: Local mode falls back to local Ollama instance when cloud exhausted', () => {
  const db = new StudioDatabase(':memory:');
  const qm = new AdaptiveQuotaManager({ db: db.db });

  const router = new HybridExecutionRouter({
    environment: ENVIRONMENTS.LOCAL,
    quotaManager: qm
  });

  // Rate-limit all cloud providers
  qm.recordRateLimit({ provider: 'gemini', model: 'gemini-2.5-flash' });
  qm.recordRateLimit({ provider: 'groq', model: 'deepseek-r1-distill-llama-70b' });

  const selection = router.selectProvider();
  assert.equal(selection.provider, 'ollama');
  assert.equal(selection.model, 'qwen2.5-coder:14b');
  assert.equal(selection.status, 'OFFLINE_FALLBACK');

  db.close();
});

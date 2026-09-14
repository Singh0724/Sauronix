import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';
import { PrGenerator } from '../../src/git/pr-generator.js';
import { DynamicRiskEngine } from '../../src/risk/risk-engine.js';

test('PrGenerator: Formats complete Pull Request markdown bundle with 11-stage QA table', () => {
  const prGen = new PrGenerator();
  const riskEngine = new DynamicRiskEngine();

  const taskSpec = {
    task_id: 'TASK-PR-01',
    goal: 'Implement token bucket rate limiter',
    allowed_files: ['src/rate-limiter.js'],
    forbidden_files: ['.env*'],
    security_impact: 'LOW'
  };

  const riskProfile = riskEngine.evaluateTaskRisk(taskSpec);

  const mockReceipt = {
    receipt_id: 'QA-REC-999',
    all_passed: true,
    stages: [
      { stage_name: 'STAGE_1_TYPECHECK', passed: true, duration_ms: 5.2 },
      { stage_name: 'STAGE_2_LINT_SYNTAX', passed: true, duration_ms: 10.1 },
      { stage_name: 'STAGE_4_SAST_SECRETS', passed: true, duration_ms: 25.0 }
    ]
  };

  const pr = prGen.generatePullRequest({
    taskSpec,
    qaReceipt: mockReceipt,
    commitSha: 'a1b2c3d4e5f678901234567890abcdef12345678',
    riskProfile,
    branchName: 'agent/task-pr-01'
  });

  assert.equal(pr.prTitle, 'feat(task-pr-01): Implement token bucket rate limiter');
  assert.equal(pr.prBody.includes('STAGE_4_SAST_SECRETS'), true);
  assert.equal(pr.prBody.includes('✔ PASS'), true);
  assert.equal(pr.prBody.includes('node src/flight/flight-recorder.js replay TASK-PR-01'), true);
  assert.equal(pr.requiresFounderSign, false);
});

test('PrGenerator: Enforces Founder Approval token for HIGH risk pull requests', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const prGen = new PrGenerator({
    stateMachine: sm,
    founderToken: 'super-secure-founder-token-5.0'
  });
  const riskEngine = new DynamicRiskEngine();

  const taskId = 'TASK-AUTH-PR';
  const taskSpec = {
    task_id: taskId,
    goal: 'Modify auth session token generation',
    allowed_files: ['src/auth/session.js'],
    security_impact: 'HIGH',
    risk_level: 'HIGH'
  };

  sm.registerTask(taskSpec);
  sm.transition({
    taskId,
    toStatus: TASK_STATUS.RUNNING,
    triggerReason: 'Task started',
    actor: 'SCHEDULER'
  });
  sm.transition({
    taskId,
    toStatus: TASK_STATUS.READY_FOR_PR,
    triggerReason: 'QA stages passed',
    actor: 'QA'
  });

  const riskProfile = riskEngine.evaluateTaskRisk(taskSpec);

  const prPackage = prGen.generatePullRequest({
    taskSpec,
    qaReceipt: { all_passed: true, stages: [] },
    commitSha: 'fedcba0987654321fedcba0987654321fedcba09',
    riskProfile,
    branchName: 'agent/task-auth-pr'
  });

  assert.equal(prPackage.requiresFounderSign, true);

  // 1. Attempt merge without token -> REJECTED
  assert.throws(
    () => {
      prGen.signAndMergePr({ taskId, prPackage, founderToken: null });
    },
    /FounderApprovalRequired/
  );

  // 2. Attempt merge with invalid token -> REJECTED
  assert.throws(
    () => {
      prGen.signAndMergePr({ taskId, prPackage, founderToken: 'wrong-token' });
    },
    /FounderApprovalRequired/
  );

  // 3. Merge with valid founder token -> APPROVED & COMPLETED
  const mergeResult = prGen.signAndMergePr({
    taskId,
    prPackage,
    founderToken: 'super-secure-founder-token-5.0'
  });

  assert.equal(mergeResult.success, true);
  assert.equal(mergeResult.merged, true);
  assert.equal(mergeResult.completedTask.status, TASK_STATUS.COMPLETED);

  const history = sm.getHistory(taskId);
  const lastTransition = history[history.length - 1];
  assert.equal(lastTransition.actor, 'FOUNDER');
  assert.equal(lastTransition.to_status, TASK_STATUS.COMPLETED);

  db.close();
});

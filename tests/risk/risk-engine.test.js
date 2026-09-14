import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicRiskEngine, RISK_TIERS } from '../../src/risk/risk-engine.js';

test('DynamicRiskEngine: Rejects CRITICAL risk tasks from autonomous execution', () => {
  const engine = new DynamicRiskEngine();

  const envTask = {
    task_id: 'TASK-RISK-01',
    goal: 'Update database credentials',
    allowed_files: ['.env.production'],
    security_impact: 'CRITICAL',
    risk_level: 'CRITICAL'
  };

  const profile = engine.evaluateTaskRisk(envTask);
  assert.equal(profile.riskTier, RISK_TIERS.CRITICAL);
  assert.equal(profile.canExecuteAutonomously, false);
  assert.equal(profile.humanApprovalRequired, true);
  assert.equal(profile.policy, 'HUMAN_ONLY_NO_AUTONOMOUS_EXECUTION');
  assert.equal(profile.riskScore, 100);

  // Secret keyword in allowed path
  const secretPathTask = {
    task_id: 'TASK-RISK-02',
    goal: 'Inspect secrets',
    allowed_files: ['config/secret_keys.json']
  };

  const profile2 = engine.evaluateTaskRisk(secretPathTask);
  assert.equal(profile2.riskTier, RISK_TIERS.CRITICAL);
  assert.equal(profile2.canExecuteAutonomously, false);
});

test('DynamicRiskEngine: Classifies auth and payment tasks as HIGH risk requiring founder sign-off', () => {
  const engine = new DynamicRiskEngine();

  const authTask = {
    task_id: 'TASK-RISK-03',
    goal: 'Add OAuth callback route',
    allowed_files: ['src/auth/oauth-handler.js'],
    security_impact: 'HIGH',
    risk_level: 'HIGH'
  };

  const profile = engine.evaluateTaskRisk(authTask);
  assert.equal(profile.riskTier, RISK_TIERS.HIGH);
  assert.equal(profile.canExecuteAutonomously, true);
  assert.equal(profile.humanApprovalRequired, true);
  assert.equal(profile.policy, 'MANDATORY_FOUNDER_SIGN_BEFORE_MERGE');
  assert.equal(profile.riskScore >= 80, true);

  // Database schema migration
  const dbTask = {
    task_id: 'TASK-RISK-04',
    goal: 'Update schema',
    allowed_files: ['db/schema.sql']
  };

  const profile2 = engine.evaluateTaskRisk(dbTask);
  assert.equal(profile2.riskTier, RISK_TIERS.HIGH);
  assert.equal(profile2.humanApprovalRequired, true);
});

test('DynamicRiskEngine: Classifies standard business logic as MEDIUM risk with auto-PR', () => {
  const engine = new DynamicRiskEngine();

  const task = {
    task_id: 'TASK-RISK-05',
    goal: 'Refactor order calculator logic',
    allowed_files: ['src/services/calculator.js'],
    acceptance_criteria: [{ id: 'C1' }, { id: 'C2' }]
  };

  const profile = engine.evaluateTaskRisk(task);
  assert.equal(profile.riskTier, RISK_TIERS.MEDIUM);
  assert.equal(profile.canExecuteAutonomously, true);
  assert.equal(profile.humanApprovalRequired, false);
  assert.equal(profile.policy, 'AUTONOMOUS_EXECUTION_AUTO_PR');
});

test('DynamicRiskEngine: Classifies documentation and tests as LOW risk with autonomous merge', () => {
  const engine = new DynamicRiskEngine();

  const docTask = {
    task_id: 'TASK-RISK-06',
    goal: 'Fix typo in documentation',
    allowed_files: ['README.md', 'docs/architecture.md'],
    security_impact: 'NONE',
    risk_level: 'LOW'
  };

  const profile = engine.evaluateTaskRisk(docTask);
  assert.equal(profile.riskTier, RISK_TIERS.LOW);
  assert.equal(profile.canExecuteAutonomously, true);
  assert.equal(profile.humanApprovalRequired, false);
  assert.equal(profile.policy, 'FULLY_AUTONOMOUS_MERGE');
  assert.equal(profile.riskScore <= 25, true);
});

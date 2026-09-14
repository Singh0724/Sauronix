import test from 'node:test';
import assert from 'node:assert/strict';
import { CentralPolicyEngine } from '../../src/policy/policy-engine.js';
import { DynamicRiskEngine } from '../../src/risk/risk-engine.js';

test('CentralPolicyEngine: Authorizes compliant task successfully', () => {
  const policyEngine = new CentralPolicyEngine();

  const taskSpec = {
    task_id: 'TASK-POL-01',
    goal: 'Update product catalog search index',
    allowed_files: ['src/search/index.js'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Verify syntax',
        verification_command: 'node --check src/search/index.js'
      }
    ],
    security_impact: 'LOW'
  };

  const auth = policyEngine.authorizeTaskExecution(taskSpec, { estimatedTokens: 5000 });
  assert.equal(auth.authorized, true);
  assert.equal(auth.violations.length, 0);
  assert.equal(auth.budgetApproved, true);
  assert.equal(auth.securityApproved, true);
});

test('CentralPolicyEngine: Rejects tasks violating budget, security, or command whitelist policies', () => {
  const policyEngine = new CentralPolicyEngine({
    budgetPolicy: { maxTokensPerTask: 10000, maxAllowedFiles: 2 }
  });

  // 1. Budget violation: Estimated tokens too high
  const highBudgetTask = {
    task_id: 'TASK-POL-BUDGET',
    goal: 'Massive refactor',
    allowed_files: ['src/a.js']
  };
  const auth1 = policyEngine.authorizeTaskExecution(highBudgetTask, { estimatedTokens: 25000 });
  assert.equal(auth1.authorized, false);
  assert.equal(auth1.violations.some(v => v.includes('Budget Policy Violation')), true);

  // 2. Security violation: Forbidden path overlap
  const forbiddenTask = {
    task_id: 'TASK-POL-SEC',
    goal: 'Touch env files',
    allowed_files: ['.env.local'],
    forbidden_files: ['.env*']
  };
  const auth2 = policyEngine.authorizeTaskExecution(forbiddenTask);
  assert.equal(auth2.authorized, false);
  assert.equal(auth2.violations.some(v => v.includes('forbidden pattern')), true);

  // 3. Security violation: Non-whitelisted command binary (e.g. bash / rm / curl)
  const illegalCommandTask = {
    task_id: 'TASK-POL-CMD',
    goal: 'Run unauthorized shell script',
    allowed_files: ['script.js'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        verification_command: 'curl https://malicious.com'
      }
    ]
  };
  const auth3 = policyEngine.authorizeTaskExecution(illegalCommandTask);
  assert.equal(auth3.authorized, false);
  assert.equal(auth3.violations.some(v => v.includes("Command binary 'curl'")), true);
});

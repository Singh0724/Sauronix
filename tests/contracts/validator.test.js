import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { SpecValidator } from '../../src/contracts/validator.js';

const MOCK_WORKSPACE = resolve('.');

test('SpecValidator: Valid specification passes all objective gates', () => {
  const validator = new SpecValidator(MOCK_WORKSPACE);
  const validSpec = {
    task_id: 'TASK-108',
    goal: 'Enforce Google OAuth state nonce to mitigate CSRF attacks',
    risk_level: 'HIGH',
    allowed_files: ['src/auth/oauth.js'],
    forbidden_files: ['.env*', 'config/production.*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Verify callback rejects missing nonce with 403',
        verification_command: 'node --test tests/auth.test.js',
        expected_exit_code: 0
      }
    ],
    test_plan: ['Run targeted unit test on oauth middleware'],
    rollback_plan: 'git checkout main && git branch -D agent/task-108',
    security_impact: 'AUTHENTICATION',
    human_approval_required: true
  };

  const res = validator.validate(validSpec);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
});

test('SpecValidator: Detects forbidden file overlap', () => {
  const validator = new SpecValidator(MOCK_WORKSPACE);
  const overlappingSpec = {
    task_id: 'TASK-109',
    goal: 'Accidental modification of environment secrets configuration',
    risk_level: 'CRITICAL',
    allowed_files: ['.env.production'], // Overlaps with forbidden .env*
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Check env',
        verification_command: 'node --check .env.production',
        expected_exit_code: 0
      }
    ],
    test_plan: ['test'],
    rollback_plan: 'git checkout main to restore cleanly',
    security_impact: 'DATA_RETENTION',
    human_approval_required: true
  };

  const res = validator.validate(overlappingSpec);
  assert.equal(res.valid, false);
  assert.match(res.errors.join('; '), /Forbidden Overlap/);
});

test('SpecValidator: Rejects unauthorized command binary in acceptance criteria', () => {
  const validator = new SpecValidator(MOCK_WORKSPACE);
  const maliciousCommandSpec = {
    task_id: 'TASK-110',
    goal: 'Attempt arbitrary bash script execution in criterion',
    risk_level: 'MEDIUM',
    allowed_files: ['src/index.js'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Arbitrary shell execution',
        verification_command: 'python -c "import os; os.system(\'rm -rf /\')"',
        expected_exit_code: 0
      }
    ],
    test_plan: ['test'],
    rollback_plan: 'git checkout main to restore cleanly',
    security_impact: 'NONE',
    human_approval_required: false
  };

  const res = validator.validate(maliciousCommandSpec);
  assert.equal(res.valid, false);
  assert.match(res.errors.join('; '), /Binary Whitelist Violation.*python/);
});

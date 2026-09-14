import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { DiffRiskScorer } from '../../src/qa/diff-risk-scorer.js';
import { LayeredQARunner } from '../../src/qa/qa-runner.js';

const TEST_SCRATCH = resolve('test-scratch/qa-test');

test('DiffRiskScorer: Calculates scores and flags violations', () => {
  const normalDiff = `diff --git a/src/auth.js b/src/auth.js
--- a/src/auth.js
+++ b/src/auth.js
@@ -1,2 +1,4 @@
+const nonce = 123;
+if (nonce) { validate(); }`;

  const normalEval = DiffRiskScorer.evaluate({
    diffText: normalDiff,
    allowedFiles: ['src/**'],
    forbiddenFiles: ['.env*']
  });

  assert.equal(normalEval.filesModified.length, 1);
  assert.equal(normalEval.requiresHumanSignoff, false);
  assert.equal(normalEval.violations.length, 0);

  // Dangerous diff touching .env
  const dangerousDiff = `diff --git a/.env.production b/.env.production
--- a/.env.production
+++ b/.env.production
@@ -1,1 +1,2 @@
+SECRET_KEY=123`;

  const dangerEval = DiffRiskScorer.evaluate({
    diffText: dangerousDiff,
    allowedFiles: ['src/**'],
    forbiddenFiles: ['.env*']
  });

  assert.equal(dangerEval.score >= 50, true);
  assert.equal(dangerEval.requiresHumanSignoff, true);
  assert.match(dangerEval.violations.join('; '), /Modified forbidden file/);
});

test('LayeredQARunner: Detects hardcoded credential leaks (SAST)', () => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  const runner = new LayeredQARunner({ reportsDir: TEST_SCRATCH });

  const taskSpec = {
    task_id: 'TASK-QA-SEC',
    goal: 'Test secret detection in diff',
    risk_level: 'MEDIUM',
    allowed_files: ['src/auth.js'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Verify syntax',
        verification_command: 'node -e "process.exit(0)"',
        expected_exit_code: 0
      }
    ]
  };

  const leakingDiff = `+ const AWS_KEY = "AKIA1234567890ABCDEF";`;
  const receipt = runner.runAllStages({
    taskSpec,
    worktreePath: resolve('.'),
    diffText: leakingDiff,
    modifiedFiles: []
  });

  assert.equal(receipt.all_passed, false);
  assert.equal(receipt.failure_classification, 'SECURITY_VIOLATION');
  assert.match(receipt.stage_results[5].details, /Hardcoded secret/);

  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

test('LayeredQARunner: All stages pass for clean change', () => {
  mkdirSync(TEST_SCRATCH, { recursive: true });
  const runner = new LayeredQARunner({ reportsDir: TEST_SCRATCH });

  const taskSpec = {
    task_id: 'TASK-QA-CLEAN',
    goal: 'Clean verification pass',
    risk_level: 'LOW',
    allowed_files: ['src/**'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Unit test pass',
        verification_command: 'node -e "process.exit(0)"',
        expected_exit_code: 0
      }
    ]
  };

  const cleanDiff = `diff --git a/src/math.js b/src/math.js
--- a/src/math.js
+++ b/src/math.js
@@ -1,1 +1,2 @@
+export function add(a, b) { return a + b; }`;

  const receipt = runner.runAllStages({
    taskSpec,
    worktreePath: resolve('.'),
    diffText: cleanDiff,
    modifiedFiles: []
  });

  assert.equal(receipt.all_passed, true);
  assert.equal(receipt.failure_classification, 'NONE');
  assert.equal(receipt.stage_results.length, 11);

  rmSync(TEST_SCRATCH, { recursive: true, force: true });
});

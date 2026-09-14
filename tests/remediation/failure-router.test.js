import test from 'node:test';
import assert from 'node:assert/strict';
import { FailureRouter, FAILURE_CLASSES, FAILURE_STRATEGIES } from '../../src/remediation/failure-router.js';

test('FailureRouter: Classifies diverse failure types accurately', () => {
  const router = new FailureRouter();

  assert.equal(router.classify(new Error('SyntaxError: Unexpected token {')), FAILURE_CLASSES.SYNTAX_ERROR);
  assert.equal(router.classify(new Error('AssertionError: Expected 200 to equal 404')), FAILURE_CLASSES.ASSERTION_FAILURE);
  assert.equal(router.classify(new Error('ETIMEDOUT: Connection timed out after 5000ms')), FAILURE_CLASSES.TIMEOUT_DEADLOCK);
  assert.equal(router.classify(new Error('Cannot find module "./missing"')), FAILURE_CLASSES.DEPENDENCY_ERROR);
  assert.equal(router.classify(new Error('Forbidden path traversal attempt')), FAILURE_CLASSES.SECURITY_VIOLATION);

  // QA receipt object
  assert.equal(router.classify({ failure_classification: 'SECURITY_VIOLATION' }), FAILURE_CLASSES.SECURITY_VIOLATION);
  assert.equal(router.classify({ failure_classification: 'SYNTAX_ERROR' }), FAILURE_CLASSES.SYNTAX_ERROR);
  assert.equal(router.classify({ failure_classification: 'TIMEOUT' }), FAILURE_CLASSES.TIMEOUT_DEADLOCK);
  assert.equal(router.classify({ failure_classification: 'DEPENDENCY' }), FAILURE_CLASSES.DEPENDENCY_ERROR);
});

test('FailureRouter: Permits retries up to threshold and tracks attempts', () => {
  const router = new FailureRouter();
  const taskId = 'TASK-RETRY-01';

  // Attempt 1: Syntax error
  const plan1 = router.getRemediationPlan({
    taskId,
    errorOrReceipt: new Error('SyntaxError: Unexpected token'),
    currentPatch: 'diff 1'
  });

  assert.equal(plan1.canRetry, true);
  assert.equal(plan1.failureClass, FAILURE_CLASSES.SYNTAX_ERROR);
  assert.equal(plan1.attempt, 1);
  assert.equal(plan1.remainingRetries, 1);
  assert.equal(plan1.tripCircuitBreaker, false);

  // Attempt 2: Still syntax error (different diff)
  const plan2 = router.getRemediationPlan({
    taskId,
    errorOrReceipt: new Error('SyntaxError: Unexpected token'),
    currentPatch: 'diff 2'
  });

  assert.equal(plan2.canRetry, true);
  assert.equal(plan2.attempt, 2);
  assert.equal(plan2.remainingRetries, 0);

  // Attempt 3: Retries exhausted
  const plan3 = router.getRemediationPlan({
    taskId,
    errorOrReceipt: new Error('SyntaxError: Unexpected token'),
    currentPatch: 'diff 3'
  });

  assert.equal(plan3.canRetry, false);
  assert.equal(plan3.tripCircuitBreaker, true);
  assert.equal(plan3.action, 'EXHAUSTED_RETRIES');
});

test('FailureRouter: Security violation immediately trips with 0 retries and mandates quarantine', () => {
  const router = new FailureRouter();
  const taskId = 'TASK-SEC-01';

  const plan = router.getRemediationPlan({
    taskId,
    errorOrReceipt: { failure_classification: 'SECURITY_VIOLATION' },
    currentPatch: 'diff with secret'
  });

  assert.equal(plan.canRetry, false);
  assert.equal(plan.tripCircuitBreaker, true);
  assert.equal(plan.quarantine, true);
  assert.equal(plan.failureClass, FAILURE_CLASSES.SECURITY_VIOLATION);
  assert.equal(plan.action, 'IMMEDIATE_QUARANTINE');
});

test('FailureRouter: Identical consecutive diff trips circuit breaker immediately (Loop Detection)', () => {
  const router = new FailureRouter();
  const taskId = 'TASK-LOOP-01';
  const duplicatePatch = '<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE';

  // First time seeing patch
  const plan1 = router.getRemediationPlan({
    taskId,
    errorOrReceipt: new Error('AssertionError: expected true to be false'),
    currentPatch: duplicatePatch
  });

  assert.equal(plan1.canRetry, true);
  assert.equal(plan1.failureClass, FAILURE_CLASSES.ASSERTION_FAILURE);

  // Second consecutive emission of exact same patch
  const plan2 = router.getRemediationPlan({
    taskId,
    errorOrReceipt: new Error('AssertionError: expected true to be false'),
    currentPatch: duplicatePatch
  });

  assert.equal(plan2.canRetry, false);
  assert.equal(plan2.tripCircuitBreaker, true);
  assert.equal(plan2.quarantine, true);
  assert.equal(plan2.failureClass, FAILURE_CLASSES.IDENTICAL_DIFF);
  assert.equal(plan2.action, 'TRIP_CIRCUIT_BREAKER');
});

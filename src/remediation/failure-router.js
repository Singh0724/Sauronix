import { createHash } from 'node:crypto';

export const FAILURE_CLASSES = Object.freeze({
  SYNTAX_ERROR: 'SYNTAX_ERROR',
  ASSERTION_FAILURE: 'ASSERTION_FAILURE',
  TIMEOUT_DEADLOCK: 'TIMEOUT_DEADLOCK',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  SECURITY_VIOLATION: 'SECURITY_VIOLATION',
  IDENTICAL_DIFF: 'IDENTICAL_DIFF'
});

export const FAILURE_STRATEGIES = Object.freeze({
  [FAILURE_CLASSES.SYNTAX_ERROR]: {
    maxRetries: 2,
    action: 'LOCALIZED_AST_PATCH',
    quarantine: false,
    promptGuidance: 'Fix the syntax error without altering file structure. Check missing braces, commas, or malformed statements.'
  },
  [FAILURE_CLASSES.ASSERTION_FAILURE]: {
    maxRetries: 2,
    action: 'STRUCTURED_ASSERTION_DIFF',
    quarantine: false,
    promptGuidance: 'Analyze the failed test assertion output. Fix the logic error or edge case without weakening tests.'
  },
  [FAILURE_CLASSES.TIMEOUT_DEADLOCK]: {
    maxRetries: 1,
    action: 'PROFILE_LOOP_LOCKS',
    quarantine: false,
    promptGuidance: 'Operation timed out. Inspect loops, unresolved promises, event listener leaks, or lock contention.'
  },
  [FAILURE_CLASSES.DEPENDENCY_ERROR]: {
    maxRetries: 1,
    action: 'LOCKFILE_DOCTOR',
    quarantine: false,
    promptGuidance: 'Missing dependency or import failure. Ensure imports resolve only to existing local files or declared dependencies.'
  },
  [FAILURE_CLASSES.SECURITY_VIOLATION]: {
    maxRetries: 0,
    action: 'IMMEDIATE_QUARANTINE',
    quarantine: true,
    promptGuidance: 'Security violation detected (secret leak or path traversal escape). Immediate quarantine enforced.'
  },
  [FAILURE_CLASSES.IDENTICAL_DIFF]: {
    maxRetries: 0,
    action: 'TRIP_CIRCUIT_BREAKER',
    quarantine: true,
    promptGuidance: 'Identical diff generated consecutively. Infinite failure loop detected. Circuit breaker tripped.'
  }
});

export class FailureRouter {
  constructor() {
    /** @type {Map<string, { attempts: number, lastPatchSha?: string, patchHistory: string[] }>} */
    this.taskTracking = new Map();
  }

  /**
   * Reset tracking state for a task.
   * @param {string} taskId
   */
  resetTask(taskId) {
    this.taskTracking.delete(taskId);
  }

  /**
   * Compute SHA-256 hash of diff content.
   * @param {string} diffContent
   * @returns {string}
   */
  hashPatch(diffContent) {
    if (!diffContent) return '';
    return createHash('sha256').update(diffContent.trim()).digest('hex');
  }

  /**
   * Classify error or QA receipt into a discrete failure class.
   * @param {object|Error|string} errorOrReceipt
   * @returns {string}
   */
  classify(errorOrReceipt) {
    if (!errorOrReceipt) {
      return FAILURE_CLASSES.ASSERTION_FAILURE;
    }

    // If it's a QA receipt
    if (typeof errorOrReceipt === 'object' && errorOrReceipt.failure_classification) {
      const fc = errorOrReceipt.failure_classification;
      if (fc === 'SECURITY_VIOLATION') return FAILURE_CLASSES.SECURITY_VIOLATION;
      if (fc === 'SYNTAX_ERROR') return FAILURE_CLASSES.SYNTAX_ERROR;
      if (fc === 'TIMEOUT') return FAILURE_CLASSES.TIMEOUT_DEADLOCK;
      if (fc === 'DEPENDENCY') return FAILURE_CLASSES.DEPENDENCY_ERROR;
      return FAILURE_CLASSES.ASSERTION_FAILURE;
    }

    // If it's an Error or string message
    const msg = (errorOrReceipt.message || String(errorOrReceipt)).toLowerCase();

    // Check syntax errors first
    if (msg.includes('syntaxerror') || msg.includes('unexpected token') || msg.includes('parsing error')) {
      return FAILURE_CLASSES.SYNTAX_ERROR;
    }

    // Check security violations (secrets, keys, traversal)
    if (
      msg.includes('secret') ||
      msg.includes('api_key') ||
      msg.includes('bearer') ||
      msg.includes('auth token') ||
      msg.includes('access token') ||
      msg.includes('path traversal') ||
      msg.includes('credential') ||
      msg.includes('security') ||
      msg.includes('forbidden')
    ) {
      return FAILURE_CLASSES.SECURITY_VIOLATION;
    }

    if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('deadlock') || msg.includes('etimedout')) {
      return FAILURE_CLASSES.TIMEOUT_DEADLOCK;
    }

    if (msg.includes('cannot find module') || msg.includes('module_not_found') || msg.includes('err_module_not_found')) {
      return FAILURE_CLASSES.DEPENDENCY_ERROR;
    }

    return FAILURE_CLASSES.ASSERTION_FAILURE;
  }

  /**
   * Evaluate the failure, update tracking, and generate a remediation plan.
   *
   * @param {object} params
   * @param {string} params.taskId
   * @param {object|Error|string} params.errorOrReceipt
   * @param {string} [params.currentPatch]
   * @returns {{
   *   failureClass: string,
   *   canRetry: boolean,
   *   tripCircuitBreaker: boolean,
   *   quarantine: boolean,
   *   attempt: number,
   *   remainingRetries: number,
   *   action: string,
   *   promptGuidance: string,
   *   patchSha: string
   * }}
   */
  getRemediationPlan({ taskId, errorOrReceipt, currentPatch = '' }) {
    if (!this.taskTracking.has(taskId)) {
      this.taskTracking.set(taskId, { attempts: 0, patchHistory: [] });
    }

    const tracker = this.taskTracking.get(taskId);
    const patchSha = this.hashPatch(currentPatch);

    // 1. Loop detection: Check if patch is identical to previous patch
    if (patchSha && tracker.lastPatchSha && patchSha === tracker.lastPatchSha) {
      const strategy = FAILURE_STRATEGIES[FAILURE_CLASSES.IDENTICAL_DIFF];
      return {
        failureClass: FAILURE_CLASSES.IDENTICAL_DIFF,
        canRetry: false,
        tripCircuitBreaker: true,
        quarantine: true,
        attempt: tracker.attempts,
        remainingRetries: 0,
        action: strategy.action,
        promptGuidance: strategy.promptGuidance,
        patchSha
      };
    }

    // Update tracking
    if (patchSha) {
      tracker.lastPatchSha = patchSha;
      tracker.patchHistory.push(patchSha);
    }

    // 2. Classify the failure
    const failureClass = this.classify(errorOrReceipt);
    const strategy = FAILURE_STRATEGIES[failureClass] || FAILURE_STRATEGIES[FAILURE_CLASSES.ASSERTION_FAILURE];

    // 3. Security violation: zero tolerance, immediate quarantine
    if (failureClass === FAILURE_CLASSES.SECURITY_VIOLATION) {
      return {
        failureClass,
        canRetry: false,
        tripCircuitBreaker: true,
        quarantine: true,
        attempt: tracker.attempts,
        remainingRetries: 0,
        action: strategy.action,
        promptGuidance: strategy.promptGuidance,
        patchSha
      };
    }

    // 4. Retry evaluation
    if (tracker.attempts < strategy.maxRetries) {
      tracker.attempts += 1;
      return {
        failureClass,
        canRetry: true,
        tripCircuitBreaker: false,
        quarantine: false,
        attempt: tracker.attempts,
        remainingRetries: strategy.maxRetries - tracker.attempts,
        action: strategy.action,
        promptGuidance: strategy.promptGuidance,
        patchSha
      };
    }

    // Retries exhausted
    return {
      failureClass,
      canRetry: false,
      tripCircuitBreaker: true,
      quarantine: strategy.quarantine,
      attempt: tracker.attempts,
      remainingRetries: 0,
      action: 'EXHAUSTED_RETRIES',
      promptGuidance: `Retries exhausted for failure class ${failureClass}. Handing off to human operator.`,
      patchSha
    };
  }
}

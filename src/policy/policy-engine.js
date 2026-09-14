import { matchesGlobPattern } from '../security/tool-gateway.js';
import { DynamicRiskEngine, RISK_TIERS } from '../risk/risk-engine.js';

export const WHITELISTED_COMMAND_BINARIES = Object.freeze([
  'node',
  'npm',
  'git',
  'npx'
]);

export const DEFAULT_BUDGET_POLICY = Object.freeze({
  maxTokensPerTask: 50000,
  maxTaskAttempts: 2,
  maxAllowedFiles: 10
});

export class CentralPolicyEngine {
  /**
   * @param {object} [options]
   * @param {DynamicRiskEngine} [options.riskEngine]
   * @param {object} [options.budgetPolicy]
   * @param {string[]} [options.whitelistedBinaries]
   */
  constructor(options = {}) {
    this.riskEngine = options.riskEngine || new DynamicRiskEngine();
    this.budgetPolicy = { ...DEFAULT_BUDGET_POLICY, ...(options.budgetPolicy || {}) };
    this.whitelistedBinaries = options.whitelistedBinaries || WHITELISTED_COMMAND_BINARIES;
  }

  /**
   * Authorize a task against the complete suite of Central Policies.
   *
   * @param {object} taskSpec
   * @param {object} [context]
   * @param {number} [context.estimatedTokens]
   * @returns {{
   *   authorized: boolean,
   *   violations: string[],
   *   riskProfile: object,
   *   budgetApproved: boolean,
   *   securityApproved: boolean
   * }}
   */
  authorizeTaskExecution(taskSpec, context = {}) {
    const violations = [];
    const taskId = taskSpec.task_id || 'UNKNOWN';

    // 1. Dynamic Risk & Governance Policy
    const riskProfile = this.riskEngine.evaluateTaskRisk(taskSpec);
    if (!riskProfile.canExecuteAutonomously) {
      violations.push(`Governance Policy Violation: Task ${taskId} has ${riskProfile.riskTier} risk. Autonomous execution prohibited.`);
    }

    // 2. Budget Policy Checks
    let budgetApproved = true;
    const estimatedTokens = context.estimatedTokens || 1000;
    if (estimatedTokens > this.budgetPolicy.maxTokensPerTask) {
      violations.push(`Budget Policy Violation: Estimated tokens (${estimatedTokens}) exceed task limit (${this.budgetPolicy.maxTokensPerTask})`);
      budgetApproved = false;
    }

    const files = Array.isArray(taskSpec.allowed_files) ? taskSpec.allowed_files : [];
    if (files.length > this.budgetPolicy.maxAllowedFiles) {
      violations.push(`Budget Policy Violation: Allowed files count (${files.length}) exceeds maximum limit (${this.budgetPolicy.maxAllowedFiles})`);
      budgetApproved = false;
    }

    // 3. Security Policy Checks
    let securityApproved = true;
    const forbidden = Array.isArray(taskSpec.forbidden_files) ? taskSpec.forbidden_files : [];

    for (const file of files) {
      if (matchesGlobPattern(file, forbidden)) {
        violations.push(`Security Policy Violation: Allowed file '${file}' intersects with forbidden patterns`);
        securityApproved = false;
      }
    }

    // Command binary verification
    const criteria = Array.isArray(taskSpec.acceptance_criteria) ? taskSpec.acceptance_criteria : [];
    for (const crit of criteria) {
      if (crit.verification_command) {
        const firstToken = crit.verification_command.trim().split(/\s+/)[0];
        if (!this.whitelistedBinaries.includes(firstToken)) {
          violations.push(`Security Policy Violation: Command binary '${firstToken}' in acceptance criteria '${crit.id}' is not whitelisted`);
          securityApproved = false;
        }
      }
    }

    return {
      authorized: violations.length === 0,
      violations,
      riskProfile,
      budgetApproved,
      securityApproved
    };
  }
}

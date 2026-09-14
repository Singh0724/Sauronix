export const RISK_TIERS = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
});

export const GOVERNANCE_POLICIES = Object.freeze({
  [RISK_TIERS.LOW]: {
    policy: 'FULLY_AUTONOMOUS_MERGE',
    description: 'Fully autonomous execution and PR merge permitted after layered QA verification passes cleanly.',
    canExecuteAutonomously: true,
    humanApprovalRequired: false
  },
  [RISK_TIERS.MEDIUM]: {
    policy: 'AUTONOMOUS_EXECUTION_AUTO_PR',
    description: 'Autonomous execution permitted; PR automatically generated with full QA audit receipt for review.',
    canExecuteAutonomously: true,
    humanApprovalRequired: false
  },
  [RISK_TIERS.HIGH]: {
    policy: 'MANDATORY_FOUNDER_SIGN_BEFORE_MERGE',
    description: 'Autonomous coding & QA permitted, but PR merge strictly blocked until cryptographic Founder sign-off.',
    canExecuteAutonomously: true,
    humanApprovalRequired: true
  },
  [RISK_TIERS.CRITICAL]: {
    policy: 'HUMAN_ONLY_NO_AUTONOMOUS_EXECUTION',
    description: 'Autonomous execution strictly rejected at pre-flight. Changes to credentials, production databases, or core infra must be performed directly by human engineers.',
    canExecuteAutonomously: false,
    humanApprovalRequired: true
  }
});

const CRITICAL_PATTERNS = [
  /^\.env/i,
  /secret/i,
  /credential/i,
  /id_rsa/i,
  /private_key/i,
  /passwd/i,
  /shadow/i,
  /master_key/i
];

const HIGH_PATTERNS = [
  /^auth\//i,
  /\/auth\//i,
  /login/i,
  /session/i,
  /token/i,
  /payment/i,
  /billing/i,
  /stripe/i,
  /razorpay/i,
  /^db\/schema\.sql/i,
  /migrations?\//i
];

const LOW_PATTERNS = [
  /\.md$/i,
  /^docs\//i,
  /\.css$/i,
  /^tests\//i
];

export class DynamicRiskEngine {
  /**
   * Evaluate a task specification contract and determine its dynamic risk tier and governance policy.
   *
   * @param {object} taskSpec
   * @returns {{
   *   riskTier: string,
   *   riskScore: number,
   *   canExecuteAutonomously: boolean,
   *   humanApprovalRequired: boolean,
   *   policy: string,
   *   description: string,
   *   reasons: string[]
   * }}
   */
  evaluateTaskRisk(taskSpec) {
    if (!taskSpec) {
      throw new Error('TaskSpec is required for risk evaluation');
    }

    const reasons = [];
    const files = Array.isArray(taskSpec.allowed_files) ? taskSpec.allowed_files : [];
    const securityImpact = (taskSpec.security_impact || 'NONE').toUpperCase();
    const explicitRisk = (taskSpec.risk_level || 'MEDIUM').toUpperCase();

    // 1. Check for CRITICAL triggers
    if (securityImpact === 'CRITICAL' || explicitRisk === 'CRITICAL') {
      reasons.push('Explicit task specification marked as CRITICAL risk/security impact');
      return this.buildResult(RISK_TIERS.CRITICAL, 100, reasons, files, taskSpec);
    }

    for (const file of files) {
      if (CRITICAL_PATTERNS.some(p => p.test(file))) {
        reasons.push(`Allowed path '${file}' targets protected credential/security asset`);
        return this.buildResult(RISK_TIERS.CRITICAL, 100, reasons, files, taskSpec);
      }
    }

    // 2. Check for HIGH triggers
    let isHigh = false;
    if (securityImpact === 'HIGH' || explicitRisk === 'HIGH') {
      reasons.push('Explicit task specification marked as HIGH risk/security impact');
      isHigh = true;
    }

    for (const file of files) {
      if (HIGH_PATTERNS.some(p => p.test(file))) {
        reasons.push(`Allowed path '${file}' touches sensitive auth, payment, or database schema boundary`);
        isHigh = true;
      }
    }

    if (isHigh) {
      return this.buildResult(RISK_TIERS.HIGH, 80, reasons, files, taskSpec);
    }

    // 3. Check for LOW triggers
    const allLowFiles = files.length > 0 && files.every(f => LOW_PATTERNS.some(p => p.test(f)));
    const lowGoal = /typo|documentation|comment|readme|style|css/i.test(taskSpec.goal || '');

    if (allLowFiles || (lowGoal && securityImpact === 'NONE' && explicitRisk === 'LOW')) {
      reasons.push('Task is scoped exclusively to documentation, styling, or tests with zero security impact');
      return this.buildResult(RISK_TIERS.LOW, 15, reasons, files, taskSpec);
    }

    // 4. Default to MEDIUM
    reasons.push('Standard application business logic or routine feature implementation');
    return this.buildResult(RISK_TIERS.MEDIUM, 45, reasons, files, taskSpec);
  }

  /**
   * Assemble risk profile result with quantitative scoring.
   * @private
   */
  buildResult(tier, baseScore, reasons, files, taskSpec) {
    const governance = GOVERNANCE_POLICIES[tier];
    
    // Quantitative score adjustment
    const criteriaCount = Array.isArray(taskSpec.acceptance_criteria) ? taskSpec.acceptance_criteria.length : 0;
    const fileCount = files.length;
    const computedScore = Math.min(100, Math.max(0, baseScore + (fileCount - 1) * 2 + criteriaCount * 2));

    return {
      riskTier: tier,
      riskScore: computedScore,
      canExecuteAutonomously: governance.canExecuteAutonomously,
      humanApprovalRequired: governance.humanApprovalRequired || Boolean(taskSpec.human_approval_required),
      policy: governance.policy,
      description: governance.description,
      reasons
    };
  }
}

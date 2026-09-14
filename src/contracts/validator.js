import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { matchesGlobPattern } from '../security/tool-gateway.js';

const ALLOWED_BINARIES = ['npm', 'node', 'npx', 'git', 'tsc', 'eslint', 'pytest'];

export class SpecValidator {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Validate task specification against objective measurable gates.
   *
   * @param {object} spec
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(spec) {
    const errors = [];

    // 1. Structural / Schema checks
    if (!spec || typeof spec !== 'object') {
      return { valid: false, errors: ['Spec must be a non-null object'] };
    }

    if (!spec.task_id || !/^TASK-[0-9]{3,6}$/.test(spec.task_id)) {
      errors.push(`Invalid task_id: "${spec.task_id}". Must match format ^TASK-[0-9]{3,6}$`);
    }

    if (!spec.goal || typeof spec.goal !== 'string' || spec.goal.trim().length < 20) {
      errors.push('Goal must be a descriptive string of at least 20 characters');
    }

    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(spec.risk_level)) {
      errors.push(`Invalid risk_level: "${spec.risk_level}". Must be LOW, MEDIUM, HIGH, or CRITICAL`);
    }

    if (!Array.isArray(spec.allowed_files) || spec.allowed_files.length === 0) {
      errors.push('allowed_files must be a non-empty array of file paths or globs');
    }

    if (!Array.isArray(spec.forbidden_files)) {
      errors.push('forbidden_files must be an array of globs');
    }

    if (!Array.isArray(spec.acceptance_criteria) || spec.acceptance_criteria.length === 0) {
      errors.push('acceptance_criteria must contain at least one verifiable criterion');
    }

    if (!spec.rollback_plan || spec.rollback_plan.trim().length < 20) {
      errors.push('rollback_plan must be an explicit procedure of at least 20 characters');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // 2. Objective Gate: Forbidden Overlap Check
    for (const allowed of spec.allowed_files) {
      if (matchesGlobPattern(allowed, spec.forbidden_files)) {
        errors.push(
          `Forbidden Overlap: Allowed file "${allowed}" matches forbidden file pattern`
        );
      }
    }

    // 3. Objective Gate: Acceptance Criteria Command Whitelist & Exit Code
    for (const [index, crit] of spec.acceptance_criteria.entries()) {
      if (!crit.id || !crit.description || !crit.verification_command) {
        errors.push(`Acceptance criterion at index ${index} missing required fields (id, description, verification_command)`);
        continue;
      }

      const binary = crit.verification_command.trim().split(/\s+/)[0];
      if (!ALLOWED_BINARIES.includes(binary)) {
        errors.push(
          `Binary Whitelist Violation: Criterion "${crit.id}" uses unauthorized command binary: "${binary}"`
        );
      }

      if (typeof crit.expected_exit_code !== 'number') {
        errors.push(`Criterion "${crit.id}" must specify numeric expected_exit_code`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

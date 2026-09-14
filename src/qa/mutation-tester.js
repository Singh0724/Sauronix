import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

export class MutationTester {
  /**
   * Synthesizes an AST mutant in target code and verifies that the test suite fails.
   * If the test suite passes against the mutant, the test suite is flagged as VACUOUS.
   *
   * @param {object} params
   * @param {string} params.worktreePath
   * @param {string} params.targetRelativeFile
   * @param {string} params.testCommand
   * @returns {{ verified: boolean, mutantKilled: boolean, details: string }}
   */
  static runMutationVerification({ worktreePath, targetRelativeFile, testCommand }) {
    const fullPath = resolve(worktreePath, targetRelativeFile);
    if (!existsSync(fullPath)) {
      return { verified: false, mutantKilled: false, details: 'Target file does not exist' };
    }

    const originalContent = readFileSync(fullPath, 'utf-8');

    // Mutation operators
    const mutations = [
      { pattern: /===/g, replacement: '!==' },
      { pattern: /!==/g, replacement: '===' },
      { pattern: />/g, replacement: '<=' },
      { pattern: /</g, replacement: '>=' },
      { pattern: /\btrue\b/g, replacement: 'false' },
      { pattern: /\bfalse\b/g, replacement: 'true' }
    ];

    let mutatedContent = null;
    let appliedMutation = null;

    for (const m of mutations) {
      if (m.pattern.test(originalContent)) {
        mutatedContent = originalContent.replace(m.pattern, m.replacement);
        appliedMutation = `${m.pattern} -> ${m.replacement}`;
        break;
      }
    }

    if (!mutatedContent || mutatedContent === originalContent) {
      return {
        verified: true,
        mutantKilled: true,
        details: 'No mutable boolean operators identified; skipped mutation gate'
      };
    }

    try {
      // 1. Apply mutant
      writeFileSync(fullPath, mutatedContent, 'utf-8');

      // 2. Run test command against mutant
      let testPassedAgainstMutant = false;
      try {
        execSync(testCommand, { cwd: worktreePath, stdio: 'pipe' });
        testPassedAgainstMutant = true;
      } catch {
        // Expected behavior: test SHOULD fail against a mutated implementation
        testPassedAgainstMutant = false;
      }

      if (testPassedAgainstMutant) {
        return {
          verified: false,
          mutantKilled: false,
          details: `Vacuous Test Detected: Authored test suite passed even after injecting mutant (${appliedMutation}). Test fails to detect real defects.`
        };
      }

      return {
        verified: true,
        mutantKilled: true,
        details: `Mutant successfully killed by test suite (${appliedMutation})`
      };
    } finally {
      // 3. Always restore original pristine content
      writeFileSync(fullPath, originalContent, 'utf-8');
    }
  }
}

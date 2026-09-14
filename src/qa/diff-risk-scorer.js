import { matchesGlobPattern } from '../security/tool-gateway.js';

export class DiffRiskScorer {
  /**
   * Calculate quantitative Diff Risk Score from git diff text.
   *
   * @param {object} params
   * @param {string} params.diffText - Git diff output
   * @param {string[]} params.allowedFiles - Whitelisted globs
   * @param {string[]} params.forbiddenFiles - Blacklisted globs
   * @returns {{
   *   score: number,
   *   filesModified: string[],
   *   linesAdded: number,
   *   linesDeleted: number,
   *   violations: string[],
   *   requiresHumanSignoff: boolean
   * }}
   */
  static evaluate({ diffText, allowedFiles = ['src/**'], forbiddenFiles = ['.env*'] }) {
    if (!diffText || diffText.trim() === '') {
      return {
        score: 0,
        filesModified: [],
        linesAdded: 0,
        linesDeleted: 0,
        violations: [],
        requiresHumanSignoff: false
      };
    }

    const lines = diffText.split(/\r?\n/);
    const filesModified = new Set();
    let linesAdded = 0;
    let linesDeleted = 0;
    let cyclomaticComplexityAdded = 0;
    const violations = [];

    const complexityPatterns = /\b(if|else\s+if|for|while|switch|case|catch|\?\?|\?)\b/;

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const parts = line.split(' ');
        if (parts.length >= 4) {
          const filePath = parts[3].replace(/^b\//, '');
          filesModified.add(filePath);
        }
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        linesAdded++;
        if (complexityPatterns.test(line)) {
          cyclomaticComplexityAdded++;
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        linesDeleted++;
      }
    }

    const fileList = Array.from(filesModified);
    let forbiddenHits = 0;

    for (const file of fileList) {
      if (matchesGlobPattern(file, forbiddenFiles)) {
        forbiddenHits++;
        violations.push(`Security Hit: Modified forbidden file "${file}"`);
      }
      if (!matchesGlobPattern(file, allowedFiles)) {
        violations.push(`Scope Creep: Modified file "${file}" is outside allowed_files`);
      }
    }

    const deltaLines = linesAdded + linesDeleted;
    const numFiles = fileList.length;

    // Formula: (ΔL * 0.1) + (N_files * 2.0) + (C_forbidden * 50.0) + (D_cyclomatic * 1.5)
    const rawScore =
      deltaLines * 0.1 +
      numFiles * 2.0 +
      forbiddenHits * 50.0 +
      cyclomaticComplexityAdded * 1.5;

    const roundedScore = Math.round(rawScore * 10) / 10;
    const requiresHumanSignoff = roundedScore > 25.0 || violations.length > 0;

    return {
      score: roundedScore,
      filesModified: fileList,
      linesAdded,
      linesDeleted,
      violations,
      requiresHumanSignoff
    };
  }
}

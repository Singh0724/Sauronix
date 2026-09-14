import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Surgical Search-and-Replace Diff Engine
 * Enforces atomic block replacements and Chesterton's Fence law.
 */
export class DiffEngine {
  /**
   * Parse a text containing search-and-replace blocks:
   * <<<<<<< SEARCH
   * [original lines]
   * =======
   * [replacement lines]
   * >>>>>>> REPLACE
   *
   * @param {string} diffText
   * @returns {Array<{ search: string, replace: string }>}
   */
  static parseSearchReplaceBlocks(diffText) {
    const blocks = [];
    const blockRegex = /<<<<<<< SEARCH\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> REPLACE/g;
    let match;

    while ((match = blockRegex.exec(diffText)) !== null) {
      blocks.push({
        search: match[1],
        replace: match[2]
      });
    }

    if (blocks.length === 0) {
      throw new Error(
        'Invalid diff format: No valid <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks detected.'
      );
    }

    return blocks;
  }

  /**
   * Apply search-and-replace blocks atomically to a file.
   *
   * @param {string} filePath - Absolute path to target file
   * @param {string} diffText - Patch text containing SEARCH/REPLACE blocks
   * @param {object} [options]
   * @param {boolean} [options.allowDeletions=false] - If false, enforces Chesterton's Fence deletion ceiling
   * @returns {{ success: boolean, blocksApplied: number, linesAdded: number, linesDeleted: number }}
   */
  static applyPatch(filePath, diffText, options = {}) {
    const { allowDeletions = false } = options;

    if (!existsSync(filePath)) {
      throw new Error(`Cannot patch non-existent file: ${filePath}`);
    }

    const originalContent = readFileSync(filePath, 'utf-8');
    const isCrlf = originalContent.includes('\r\n');
    let patchedContent = originalContent.replace(/\r\n/g, '\n');

    const blocks = this.parseSearchReplaceBlocks(diffText);
    let totalLinesAdded = 0;
    let totalLinesDeleted = 0;

    for (const [index, block] of blocks.entries()) {
      const search = block.search.replace(/\r\n/g, '\n');
      const replace = block.replace.replace(/\r\n/g, '\n');

      // Uniqueness check: search string must exist exactly once in target
      const occurrences = patchedContent.split(search).length - 1;
      if (occurrences === 0) {
        throw new Error(
          `Patch failed at block ${index + 1}: Target content not found in ${filePath}.\nTarget snippet: "${search.slice(0, 80)}..."`
        );
      }
      if (occurrences > 1) {
        throw new Error(
          `Patch failed at block ${index + 1}: Target content is ambiguous (${occurrences} occurrences found). Provide more surrounding context.`
        );
      }

      const searchLines = search.split('\n').length;
      const replaceLines = replace.split('\n').length;
      totalLinesDeleted += searchLines;
      totalLinesAdded += replaceLines;

      patchedContent = patchedContent.replace(search, replace);
    }

    // Chesterton's Fence Law:
    // If lines deleted exceed lines added by > 30% and total lines deleted >= 5, reject unless allowDeletions is explicitly set.
    if (!allowDeletions && totalLinesDeleted >= 5 && totalLinesDeleted > totalLinesAdded * 1.3) {
      throw new Error(
        `Chesterton's Fence Violation: Diff attempts excessive line deletion (${totalLinesDeleted} deleted vs ${totalLinesAdded} added). Unjustified wholesale deletion rejected.`
      );
    }

    // Atomic write preserving original line endings
    const finalContent = isCrlf ? patchedContent.replace(/\n/g, '\r\n') : patchedContent;
    writeFileSync(filePath, finalContent, 'utf-8');

    return {
      success: true,
      blocksApplied: blocks.length,
      linesAdded: totalLinesAdded,
      linesDeleted: totalLinesDeleted
    };
  }
}

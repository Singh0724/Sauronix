import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DiffEngine } from './diff-engine.js';
import { ToolGateway } from '../security/tool-gateway.js';

export class SurgicalCoder {
  /**
   * @param {object} options
   * @param {string} options.workspaceRoot
   * @param {string} [options.learningsPath]
   */
  constructor({ workspaceRoot, learningsPath }) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.learningsPath = learningsPath || resolve(this.workspaceRoot, '.agents/LEARNINGS.md');
  }

  /**
   * Load promoted senior learnings from LEARNINGS.md into model context.
   * @returns {string}
   */
  loadPromotedLearnings() {
    if (existsSync(this.learningsPath)) {
      return readFileSync(this.learningsPath, 'utf-8');
    }
    return '';
  }

  /**
   * Assemble system prompt adhering to the 50-year veteran engineering principles.
   * @param {object} taskSpec
   * @returns {string}
   */
  assemblePrompt(taskSpec) {
    const learnings = this.loadPromotedLearnings();

    return [
      '### SYSTEM ROLE: 50+ YEAR SENIOR PRINCIPAL CODER (SURGICAL PRECISION)',
      'You author minimal atomic diffs. You NEVER rewrite entire files.',
      'You strictly follow Chesterton\'s Fence: never delete existing guards, conditions, or comments.',
      'You only modify files explicitly listed in task.allowed_files.',
      '',
      '### TASK SPECIFICATION CONTRACT:',
      JSON.stringify(taskSpec, null, 2),
      '',
      '### PROMOTED ORGANIZATIONAL LEARNINGS (MANDATORY INVARIANTS):',
      learnings,
      '',
      '### OUTPUT INSTRUCTIONS:',
      'Emit ONLY <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE blocks.',
      'Provide sufficient surrounding context lines to ensure unambiguous replacement.'
    ].join('\n');
  }

  /**
   * Apply an authored surgical patch to a target file in the worktree.
   * Enforces tool gateway permissions and git commit.
   *
   * @param {object} params
   * @param {string} params.worktreePath - Path to the isolated worktree
   * @param {string} params.targetRelativeFile - Target file relative to worktree
   * @param {string} params.diffContent - Search-and-replace block content
   * @param {ToolGateway} params.toolGateway - Active policy gateway
   * @param {string} [params.commitMessage]
   * @returns {{ targetFile: string, blocksApplied: number, linesAdded: number, linesDeleted: number, commitSha: string }}
   */
  applySurgicalPatch({
    worktreePath,
    targetRelativeFile,
    diffContent,
    toolGateway,
    commitMessage = 'feat(agent): apply surgical patch'
  }) {
    // 1. Authorize write via Tool Gateway
    toolGateway.authorizeWrite(targetRelativeFile);

    const targetFullPath = resolve(worktreePath, targetRelativeFile);
    if (!existsSync(targetFullPath)) {
      throw new Error(`Target file does not exist in worktree: ${targetRelativeFile}`);
    }

    // 2. Apply patch atomically
    const patchResult = DiffEngine.applyPatch(targetFullPath, diffContent);

    // 3. Stage and commit in isolated worktree
    // execFileSync with argv array prevents shell metacharacter injection via
    // untrusted commit messages (which embed raw founder prompt text).
    try {
      execFileSync('git', ['add', targetRelativeFile], { cwd: worktreePath, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', commitMessage], {
        cwd: worktreePath,
        stdio: 'pipe'
      });
      const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: worktreePath,
        encoding: 'utf-8'
      }).trim();

      return {
        targetFile: targetRelativeFile,
        blocksApplied: patchResult.blocksApplied,
        linesAdded: patchResult.linesAdded,
        linesDeleted: patchResult.linesDeleted,
        commitSha
      };
    } catch (err) {
      throw new Error(`Git commit failed in worktree: ${err.message}`);
    }
  }
}

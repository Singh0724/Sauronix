import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

export class WorktreeManager {
  /**
   * @param {string} repoRoot
   */
  constructor(repoRoot) {
    this.repoRoot = resolve(repoRoot);
    this.worktreeBaseDir = resolve(this.repoRoot, '.worktrees');
    this.activeLock = null; // Single-lease mutual exclusion write lock
  }

  /**
   * Allocate an isolated git worktree for a task.
   * Enforces mutual exclusion write lease.
   * @param {string} taskId
   * @param {string} [branchName]
   * @returns {{ worktreePath: string, branch: string }}
   */
  allocateWorktree(taskId, branchName = `agent/${taskId.toLowerCase()}`) {
    if (this.activeLock && this.activeLock !== taskId) {
      throw new Error(
        `WriteLockError: Repository write lock is held by active task ${this.activeLock}. Concurrency violation.`
      );
    }

    if (!existsSync(this.worktreeBaseDir)) {
      mkdirSync(this.worktreeBaseDir, { recursive: true });
    }

    const worktreePath = resolve(this.worktreeBaseDir, taskId);

    // If worktree already exists, return existing
    if (existsSync(worktreePath)) {
      this.activeLock = taskId;
      return { worktreePath, branch: branchName };
    }

    // Check if branch exists; if not create with -b, if yes checkout
    let branchExists = false;
    try {
      execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
        cwd: this.repoRoot,
        stdio: 'ignore'
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    // execFileSync with argv array prevents shell metacharacter injection
    // via untrusted taskId / branchName values.
    const worktreeArgs = branchExists
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', worktreePath, '-b', branchName, 'main'];

    try {
      execFileSync('git', worktreeArgs, { cwd: this.repoRoot, encoding: 'utf-8', stdio: 'pipe' });
      this.activeLock = taskId;
      return { worktreePath, branch: branchName };
    } catch (err) {
      throw new Error(`Failed to allocate git worktree: ${err.message}`);
    }
  }

  /**
   * Capture the current unstaged, staged, and untracked diff inside the isolated worktree.
   * Uses git add -N to ensure newly authored files are included in the forensic diff.
   * @param {string} taskId
   * @returns {string} Git diff output
   */
  captureDiff(taskId) {
    const worktreePath = resolve(this.worktreeBaseDir, taskId);
    if (!existsSync(worktreePath)) {
      return '';
    }

    try {
      // Mark untracked files as intent-to-add so git diff includes them
      try {
        execFileSync('git', ['add', '-N', '.'], { cwd: worktreePath, stdio: 'ignore' });
      } catch {
        // ignore if worktree has no changes
      }

      const unstaged = execFileSync('git', ['diff'], { cwd: worktreePath, encoding: 'utf-8' });
      const staged = execFileSync('git', ['diff', '--cached'], { cwd: worktreePath, encoding: 'utf-8' });
      return (staged + '\n' + unstaged).trim();
    } catch (err) {
      return `[Error capturing diff: ${err.message}]`;
    }
  }

  /**
   * Forensic Freeze: Snapshot diff to persistent artifact before teardown.
   * @param {string} taskId
   * @param {string} artifactDir
   * @returns {string} Path to frozen patch file
   */
  freezeAndSnapshot(taskId, artifactDir) {
    const diff = this.captureDiff(taskId);
    const targetDir = resolve(artifactDir, taskId);
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const patchPath = resolve(targetDir, 'frozen.patch');
    writeFileSync(patchPath, diff, 'utf-8');
    return patchPath;
  }

  /**
   * Safely release worktree without deleting the Git branch.
   * Preserves historical and forensic evidence.
   * @param {string} taskId
   */
  releaseWorktree(taskId) {
    const worktreePath = resolve(this.worktreeBaseDir, taskId);

    if (existsSync(worktreePath)) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd: this.repoRoot,
          stdio: 'pipe'
        });
      } catch (err) {
        // Fallback: prune
        execFileSync('git', ['worktree', 'prune'], { cwd: this.repoRoot, stdio: 'ignore' });
      }
    }

    if (this.activeLock === taskId) {
      this.activeLock = null;
    }
  }

  /**
   * Check if write lock is currently active.
   */
  isLocked() {
    return this.activeLock !== null;
  }
}

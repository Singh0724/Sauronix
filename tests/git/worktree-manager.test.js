import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { WorktreeManager } from '../../src/git/worktree-manager.js';

const REPO_ROOT = resolve('.');
const ARTIFACT_DIR = resolve('test-scratch/artifacts');

test('WorktreeManager: Allocate worktree and enforce mutual exclusion write lock', () => {
  const manager = new WorktreeManager(REPO_ROOT);
  const taskId = 'TASK-TEST-001';

  try {
    // 1. Allocate worktree
    const { worktreePath, branch } = manager.allocateWorktree(taskId);
    assert.equal(existsSync(worktreePath), true);
    assert.equal(manager.isLocked(), true);

    // 2. Concurrency check: Second task cannot acquire write lock
    assert.throws(
      () => manager.allocateWorktree('TASK-TEST-002'),
      /WriteLockError: Repository write lock is held by active task TASK-TEST-001/
    );

    // 3. Make a change in worktree and capture diff
    const testFilePath = resolve(worktreePath, 'test-change.txt');
    writeFileSync(testFilePath, 'forensic diff test\n', 'utf-8');

    const diff = manager.captureDiff(taskId);
    assert.match(diff, /test-change\.txt/);

    // 4. Freeze & snapshot diff
    const patchPath = manager.freezeAndSnapshot(taskId, ARTIFACT_DIR);
    assert.equal(existsSync(patchPath), true);

    // 5. Release worktree
    manager.releaseWorktree(taskId);
    assert.equal(manager.isLocked(), false);
  } finally {
    manager.releaseWorktree(taskId);
    if (existsSync(ARTIFACT_DIR)) {
      rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    }
  }
});

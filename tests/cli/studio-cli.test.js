import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { StudioDatabase } from '../../src/storage/db.js';
import { StudioCli } from '../../src/cli/studio-cli.js';
import { TASK_STATUS } from '../../src/state/task-state-machine.js';

const REPO_ROOT = resolve('.');

test('StudioCli: Status query and spec contract scaffolding', () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: REPO_ROOT, studioDb: db });

  // 1. Status query
  const status = cli.status();
  assert.equal(Array.isArray(status.activeTasks), true);
  assert.equal(Array.isArray(status.recentTransitions), true);
  assert.equal(Array.isArray(status.quotaStats), true);

  // 2. Create spec with valid numeric ID
  const specRes = cli.createSpec('TASK-901', 'Test CLI spec creation');
  assert.equal(specRes.spec.task_id, 'TASK-901');
  assert.equal(existsSync(specRes.targetPath), true);

  // Clean up test spec file
  rmSync(specRes.targetPath, { force: true });
  db.close();
});

test('StudioCli: End-to-end task execution, PR generation, flight replay, and founder approval', async () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: REPO_ROOT, studioDb: db });
  const taskId = 'TASK-902';

  try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}

  const specRes = cli.createSpec(taskId, 'Update package description for CLI verification');

  const mockPatchProvider = async () => {
    return {
      targetFile: 'package.json',
      diffContent: `<<<<<<< SEARCH
  "description": "Hardened Control Plane & Resilient Multi-Agent Engineering Studio",
=======
  "description": "Hardened Control Plane & Resilient Multi-Agent Engineering Studio (CLI Verified)",
>>>>>>> REPLACE`
    };
  };

  try {
    // 1. Run task
    const result = await cli.runTask({
      specPath: specRes.targetPath,
      patchProvider: mockPatchProvider
    });

    assert.equal(result.success, true);
    assert.equal(result.task.status, TASK_STATUS.READY_FOR_PR);
    assert.equal(result.qaReceipt.all_passed, true);
    assert.equal(typeof result.pr.prTitle, 'string');
    assert.equal(result.pr.prBody.includes('QA Verification Receipt'), true);

    // 2. Replay trace
    const replayTrace = cli.replay(taskId);
    assert.equal(replayTrace.length >= 2, true);

    // 3. Founder Approve & Merge
    const approval = cli.approve(taskId, 'founder-root-secret-5.0');
    assert.equal(approval.success, true);
    assert.equal(approval.merged, true);
    assert.equal(approval.completedTask.status, TASK_STATUS.COMPLETED);
  } finally {
    cli.worktreeManager.releaseWorktree(taskId);
    try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}
    rmSync(specRes.targetPath, { force: true });
    db.close();
  }
});

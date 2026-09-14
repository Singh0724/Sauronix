import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../../src/state/task-state-machine.js';
import { WorktreeManager } from '../../src/git/worktree-manager.js';
import { SpecValidator } from '../../src/contracts/validator.js';
import { SurgicalCoder } from '../../src/coder/surgical-coder.js';
import { LayeredQARunner } from '../../src/qa/qa-runner.js';
import { FlightRecorder } from '../../src/flight/flight-recorder.js';
import { SingleAgentPipeline } from '../../src/orchestrator/single-agent-loop.js';

const REPO_ROOT = resolve('.');
const ARTIFACT_DIR = resolve('test-scratch/pipeline-artifacts');
const REPORTS_DIR = resolve('test-scratch/pipeline-reports');

test('SingleAgentPipeline: Executes end-to-end task from PENDING to READY_FOR_PR', async () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const validator = new SpecValidator(REPO_ROOT);
  const coder = new SurgicalCoder({ workspaceRoot: REPO_ROOT });
  const qaRunner = new LayeredQARunner({ reportsDir: REPORTS_DIR });
  const recorder = new FlightRecorder({ studioDb: db, artifactBaseDir: ARTIFACT_DIR });

  const pipeline = new SingleAgentPipeline({
    workspaceRoot: REPO_ROOT,
    stateMachine: sm,
    worktreeManager: wm,
    specValidator: validator,
    surgicalCoder: coder,
    qaRunner,
    flightRecorder: recorder
  });

  const taskId = 'TASK-108';

  // Clean branch if left from prior run
  try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}

  const taskSpec = {
    task_id: taskId,
    goal: 'Update package description with hardened security marker',
    risk_level: 'MEDIUM',
    allowed_files: ['package.json'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Verify package.json remains valid JSON',
        verification_command: 'node -e "JSON.parse(require(\'fs\').readFileSync(\'package.json\'))"',
        expected_exit_code: 0
      }
    ],
    test_plan: ['JSON parsing check'],
    rollback_plan: 'git checkout main && git branch -D agent/task-108',
    security_impact: 'NONE',
    human_approval_required: false
  };

  const mockPatchProvider = async () => {
    return {
      targetFile: 'package.json',
      diffContent: `<<<<<<< SEARCH
  "description": "Hardened Control Plane & Resilient Multi-Agent Engineering Studio",
=======
  "description": "Hardened Control Plane & Resilient Multi-Agent Engineering Studio (v5.0 Verified)",
>>>>>>> REPLACE`
    };
  };

  try {
    const result = await pipeline.executeTask({
      taskSpec,
      patchProvider: mockPatchProvider
    });

    assert.equal(result.success, true);
    assert.equal(result.task.status, TASK_STATUS.READY_FOR_PR);
    assert.equal(result.qaReceipt.all_passed, true);
    assert.equal(typeof result.commitSha, 'string');
    assert.equal(result.commitSha.length, 40);

    const replayTrace = recorder.replay(taskId);
    assert.equal(replayTrace.length, 2);
    assert.equal(replayTrace[0].step_index, 1);
    assert.equal(replayTrace[1].step_index, 2);
    assert.equal(replayTrace[1].tool_name, 'emit_surgical_diff');

    assert.equal(wm.isLocked(), false);
  } finally {
    wm.releaseWorktree(taskId);
    try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}
    db.close();
    if (existsSync(ARTIFACT_DIR)) rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    if (existsSync(REPORTS_DIR)) rmSync(REPORTS_DIR, { recursive: true, force: true });
  }
});

test('SingleAgentPipeline: Rejects security-violating task and transitions to QUARANTINED', async () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const wm = new WorktreeManager(REPO_ROOT);
  const validator = new SpecValidator(REPO_ROOT);
  const coder = new SurgicalCoder({ workspaceRoot: REPO_ROOT });
  const qaRunner = new LayeredQARunner({ reportsDir: REPORTS_DIR });
  const recorder = new FlightRecorder({ studioDb: db, artifactBaseDir: ARTIFACT_DIR });

  const pipeline = new SingleAgentPipeline({
    workspaceRoot: REPO_ROOT,
    stateMachine: sm,
    worktreeManager: wm,
    specValidator: validator,
    surgicalCoder: coder,
    qaRunner,
    flightRecorder: recorder
  });

  const taskId = 'TASK-109';
  try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}

  const taskSpec = {
    task_id: taskId,
    goal: 'Simulate secret leakage in patch to trigger circuit breaker',
    risk_level: 'HIGH',
    allowed_files: ['package.json'],
    forbidden_files: ['.env*'],
    acceptance_criteria: [
      {
        id: 'CRIT-1',
        description: 'Check package',
        verification_command: 'node -e "process.exit(0)"',
        expected_exit_code: 0
      }
    ],
    test_plan: ['Secret check'],
    rollback_plan: 'git checkout main && git branch -D agent/task-109',
    security_impact: 'NONE',
    human_approval_required: true
  };

  const leakingPatchProvider = async () => {
    return {
      targetFile: 'package.json',
      diffContent: `<<<<<<< SEARCH
  "license": "UNLICENSED",
=======
  "license": "UNLICENSED",
  "leaked_key": "AKIA1234567890ABCDEF",
>>>>>>> REPLACE`
    };
  };

  try {
    const result = await pipeline.executeTask({
      taskSpec,
      patchProvider: leakingPatchProvider
    });

    assert.equal(result.success, false);
    assert.equal(result.task.status, TASK_STATUS.QUARANTINED);
    assert.equal(result.qaReceipt.all_passed, false);
    assert.equal(result.qaReceipt.failure_classification, 'SECURITY_VIOLATION');
    assert.equal(wm.isLocked(), false);
  } finally {
    wm.releaseWorktree(taskId);
    try { execSync(`git branch -D agent/${taskId.toLowerCase()}`, { stdio: 'ignore' }); } catch {}
    db.close();
    if (existsSync(ARTIFACT_DIR)) rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    if (existsSync(REPORTS_DIR)) rmSync(REPORTS_DIR, { recursive: true, force: true });
  }
});

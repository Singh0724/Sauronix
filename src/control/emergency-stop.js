import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { TASK_STATUS } from '../state/task-state-machine.js';

export class EmergencyStopController {
  /**
   * @param {object} options
   * @param {import('../state/task-state-machine.js').TaskStateMachine} options.stateMachine
   * @param {import('../git/worktree-manager.js').WorktreeManager} options.worktreeManager
   * @param {string} options.artifactBaseDir
   */
  constructor({ stateMachine, worktreeManager, artifactBaseDir }) {
    this.stateMachine = stateMachine;
    this.worktreeManager = worktreeManager;
    this.artifactBaseDir = resolve(artifactBaseDir);
  }

  /**
   * Executes the non-destructive Emergency Stop & Forensic Freeze protocol.
   * Preserves unstaged diffs, logs, and branch without wiping code.
   *
   * @param {object} params
   * @param {string} params.taskId
   * @param {string} [params.actor='FOUNDER']
   * @param {string} [params.authSignature]
   * @param {string} [params.reason='Emergency stop triggered by founder']
   * @param {string} [params.capturedOutput='']
   */
  executeEmergencyStop({
    taskId,
    actor = 'FOUNDER',
    authSignature = null,
    reason = 'Emergency stop triggered by founder',
    capturedOutput = ''
  }) {
    const task = this.stateMachine.getTask(taskId);
    if (!task) {
      throw new Error(`Cannot execute emergency stop: Task ${taskId} not found`);
    }

    const taskArtifactDir = resolve(this.artifactBaseDir, taskId);
    if (!existsSync(taskArtifactDir)) {
      mkdirSync(taskArtifactDir, { recursive: true });
    }

    // 1. Forensic Freeze: Capture uncommitted diffs
    const patchPath = this.worktreeManager.freezeAndSnapshot(taskId, this.artifactBaseDir);

    // 2. Persist incident metadata
    const incidentRecord = {
      incident_id: `INC-${taskId}-${Date.now()}`,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      actor,
      auth_signature: authSignature,
      reason,
      captured_output: capturedOutput,
      frozen_patch_path: patchPath,
      branch_name: task.branch_name || `agent/${taskId.toLowerCase()}`,
      terminal_status: TASK_STATUS.INTERRUPTED
    };

    const incidentFilePath = resolve(taskArtifactDir, 'incident.json');
    writeFileSync(incidentFilePath, JSON.stringify(incidentRecord, null, 2), 'utf-8');

    // 3. Release worktree safely (branch remains intact in git)
    this.worktreeManager.releaseWorktree(taskId);

    // 4. Update state machine atomically with critical durability
    const updatedTask = this.stateMachine.transition({
      taskId,
      toStatus: TASK_STATUS.INTERRUPTED,
      triggerReason: `Forensic freeze emergency stop: ${reason}`,
      actor,
      authSignature
    });

    return {
      success: true,
      incidentRecord,
      task: updatedTask
    };
  }
}

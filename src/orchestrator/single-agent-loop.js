import { resolve } from 'node:path';
import { TASK_STATUS } from '../state/task-state-machine.js';
import { ToolGateway } from '../security/tool-gateway.js';

export class SingleAgentPipeline {
  /**
   * @param {object} options
   * @param {string} options.workspaceRoot
   * @param {import('../state/task-state-machine.js').TaskStateMachine} options.stateMachine
   * @param {import('../git/worktree-manager.js').WorktreeManager} options.worktreeManager
   * @param {import('../contracts/validator.js').SpecValidator} options.specValidator
   * @param {import('../coder/surgical-coder.js').SurgicalCoder} options.surgicalCoder
   * @param {import('../qa/qa-runner.js').LayeredQARunner} options.qaRunner
   * @param {import('../flight/flight-recorder.js').FlightRecorder} options.flightRecorder
   */
  constructor({
    workspaceRoot,
    stateMachine,
    worktreeManager,
    specValidator,
    surgicalCoder,
    qaRunner,
    flightRecorder
  }) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.stateMachine = stateMachine;
    this.worktreeManager = worktreeManager;
    this.specValidator = specValidator;
    this.surgicalCoder = surgicalCoder;
    this.qaRunner = qaRunner;
    this.flightRecorder = flightRecorder;
  }

  /**
   * Run an end-to-end task through the constrained single-agent loop.
   *
   * @param {object} params
   * @param {object} params.taskSpec - Task specification contract
   * @param {(prompt: string) => Promise<{ targetFile: string, diffContent: string }>} params.patchProvider
   * @returns {Promise<{ success: boolean, task: object, qaReceipt: object, commitSha?: string, error?: string }>}
   */
  async executeTask({ taskSpec, patchProvider }) {
    const taskId = taskSpec.task_id;

    // 1. Pre-Flight Spec Gate
    const specValidation = this.specValidator.validate(taskSpec);
    if (!specValidation.valid) {
      throw new Error(`Spec Validation Failed:\n${specValidation.errors.join('\n')}`);
    }

    // 2. Register Task in SQLite State Machine (PENDING)
    this.stateMachine.registerTask(taskSpec);

    // 3. Allocate Isolated Git Worktree (Mutual Exclusion Write Lock)
    const { worktreePath, branch } = this.worktreeManager.allocateWorktree(taskId);

    try {
      // 4. Transition State Machine: PENDING -> RUNNING
      const task = this.stateMachine.transition({
        taskId,
        toStatus: TASK_STATUS.RUNNING,
        triggerReason: 'Pipeline allocated isolated worktree',
        actor: 'SCHEDULER',
        activeAgent: 'SURGICAL_CODER'
      });

      // 5. Flight Recorder: Step 1 Context Assembly
      const assembledPrompt = this.surgicalCoder.assemblePrompt(taskSpec);
      this.flightRecorder.recordStep({
        taskId,
        stepIndex: 1,
        agentRole: 'SURGICAL_CODER',
        modelProvider: 'control-plane',
        modelName: 'surgical-coder-v5',
        temperature: 0.0,
        prompt: assembledPrompt
      });

      // 6. Obtain Surgical Patch
      const patch = await patchProvider(assembledPrompt);

      // 7. Security Tool Gateway Interception
      const toolGateway = new ToolGateway({
        workspaceRoot: worktreePath,
        role: 'SURGICAL_CODER',
        taskAllowedFiles: taskSpec.allowed_files,
        taskForbiddenFiles: taskSpec.forbidden_files
      });

      // 8. Apply Surgical Patch & Commit to Branch
      const patchReceipt = this.surgicalCoder.applySurgicalPatch({
        worktreePath,
        targetRelativeFile: patch.targetFile,
        diffContent: patch.diffContent,
        toolGateway,
        commitMessage: `feat(${taskId.toLowerCase()}): ${taskSpec.goal.slice(0, 50)}`
      });

      // 9. Flight Recorder: Step 2 Patch Applied
      this.flightRecorder.recordStep({
        taskId,
        stepIndex: 2,
        agentRole: 'SURGICAL_CODER',
        modelProvider: 'control-plane',
        modelName: 'surgical-coder-v5',
        temperature: 0.0,
        prompt: `Apply patch to ${patch.targetFile}`,
        toolName: 'emit_surgical_diff',
        diff: patch.diffContent
      });

      // 10. Run 11-Stage Layered QA Pipeline
      const diffText = this.worktreeManager.captureDiff(taskId);
      const qaReceipt = this.qaRunner.runAllStages({
        taskSpec,
        worktreePath,
        diffText: patch.diffContent,
        modifiedFiles: [patch.targetFile]
      });

      // 11. Evaluate QA Results & Transition State Machine
      if (qaReceipt.all_passed) {
        const completedTask = this.stateMachine.transition({
          taskId,
          toStatus: TASK_STATUS.READY_FOR_PR,
          triggerReason: 'All 11 Layered QA stages passed cleanly',
          actor: 'QA'
        });

        return {
          success: true,
          task: completedTask,
          qaReceipt,
          commitSha: patchReceipt.commitSha,
          branch
        };
      } else {
        // Failure-Class Triage
        let nextStatus = TASK_STATUS.FAILED;
        if (qaReceipt.failure_classification === 'SECURITY_VIOLATION') {
          nextStatus = TASK_STATUS.QUARANTINED;
        }

        const failedTask = this.stateMachine.transition({
          taskId,
          toStatus: nextStatus,
          triggerReason: `QA Pipeline rejected task [${qaReceipt.failure_classification}]`,
          actor: 'CIRCUIT_BREAKER'
        });

        return {
          success: false,
          task: failedTask,
          qaReceipt,
          error: `QA Verification failed: ${qaReceipt.failure_classification}`
        };
      }
    } finally {
      // 12. Always release worktree lock cleanly
      this.worktreeManager.releaseWorktree(taskId);
    }
  }
}

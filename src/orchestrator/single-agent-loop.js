import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { TASK_STATUS } from '../state/task-state-machine.js';
import { ToolGateway } from '../security/tool-gateway.js';
import { FailureRouter, FAILURE_CLASSES } from '../remediation/failure-router.js';
import { KnowledgePromoter } from '../knowledge/knowledge-promoter.js';

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
   * @param {FailureRouter} [options.failureRouter]
   * @param {KnowledgePromoter} [options.knowledgePromoter]
   */
  constructor({
    workspaceRoot,
    stateMachine,
    worktreeManager,
    specValidator,
    surgicalCoder,
    qaRunner,
    flightRecorder,
    failureRouter,
    knowledgePromoter
  }) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.stateMachine = stateMachine;
    this.worktreeManager = worktreeManager;
    this.specValidator = specValidator;
    this.surgicalCoder = surgicalCoder;
    this.qaRunner = qaRunner;
    this.flightRecorder = flightRecorder;
    this.failureRouter = failureRouter || new FailureRouter();
    this.knowledgePromoter = knowledgePromoter || new KnowledgePromoter({ workspaceRoot: this.workspaceRoot });
  }

  /**
   * Run an end-to-end task through the constrained single-agent loop.
   *
   * @param {object} params
   * @param {object} params.taskSpec - Task specification contract
   * @param {(prompt: string) => Promise<{ targetFile: string, diffContent: string }>} params.patchProvider
   * @returns {Promise<{ success: boolean, task: object, qaReceipt?: object, commitSha?: string, branch?: string, error?: string }>}
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
    const baseCommit = execSync('git rev-parse HEAD', { cwd: worktreePath, encoding: 'utf-8' }).trim();

    try {
      // 4. Transition State Machine: PENDING -> RUNNING
      this.stateMachine.transition({
        taskId,
        toStatus: TASK_STATUS.RUNNING,
        triggerReason: 'Pipeline allocated isolated worktree',
        actor: 'SCHEDULER',
        activeAgent: 'SURGICAL_CODER'
      });

      // 5. Flight Recorder: Step 1 Context Assembly
      const basePrompt = this.surgicalCoder.assemblePrompt(taskSpec);
      this.flightRecorder.recordStep({
        taskId,
        stepIndex: 1,
        agentRole: 'SURGICAL_CODER',
        modelProvider: 'control-plane',
        modelName: 'surgical-coder-v5',
        temperature: 0.0,
        prompt: basePrompt
      });

      let currentPrompt = basePrompt;
      let attempt = 0;
      let lastCommitSha = null;
      let lastFailureClass = null;

      while (true) {
        // 6. Obtain Surgical Patch
        const patch = await patchProvider(currentPrompt);

        // Pre-patch Loop Detection: Check if consecutive patch is identical
        if (attempt > 0) {
          const loopCheck = this.failureRouter.getRemediationPlan({
            taskId,
            errorOrReceipt: 'Identical patch emitted consecutively',
            currentPatch: patch.diffContent
          });

          if (loopCheck.failureClass === FAILURE_CLASSES.IDENTICAL_DIFF) {
            const quarantinedTask = this.stateMachine.transition({
              taskId,
              toStatus: TASK_STATUS.QUARANTINED,
              triggerReason: `Circuit breaker tripped [${FAILURE_CLASSES.IDENTICAL_DIFF}]: ${loopCheck.action}`,
              actor: 'CIRCUIT_BREAKER'
            });

            return {
              success: false,
              task: quarantinedTask,
              error: `Circuit breaker tripped: ${FAILURE_CLASSES.IDENTICAL_DIFF}`
            };
          }

          // Reset worktree back to clean base commit before applying remediated patch
          execSync(`git reset --hard ${baseCommit}`, { cwd: worktreePath, stdio: 'pipe' });
          execSync('git clean -fd', { cwd: worktreePath, stdio: 'pipe' });
        }

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
          commitMessage: attempt === 0
            ? `feat(${taskId.toLowerCase()}): ${taskSpec.goal.slice(0, 50)}`
            : `fix(${taskId.toLowerCase()}): remediation attempt ${attempt + 1}`
        });
        lastCommitSha = patchReceipt.commitSha;

        // 9. Flight Recorder: Record Patch Step
        this.flightRecorder.recordStep({
          taskId,
          stepIndex: 2 + attempt * 2,
          agentRole: 'SURGICAL_CODER',
          modelProvider: 'control-plane',
          modelName: 'surgical-coder-v5',
          temperature: 0.0,
          prompt: `Apply patch (attempt ${attempt + 1}) to ${patch.targetFile}`,
          toolName: 'emit_surgical_diff',
          diff: patch.diffContent
        });

        // 10. Run 11-Stage Layered QA Pipeline
        const qaReceipt = this.qaRunner.runAllStages({
          taskSpec,
          worktreePath,
          diffText: patch.diffContent,
          modifiedFiles: [patch.targetFile]
        });

        // 11. Evaluate QA Results & Handle Success
        if (qaReceipt.all_passed) {
          // If resolved after failure remediation, stage candidate learning
          if (attempt > 0 && this.knowledgePromoter) {
            try {
              this.knowledgePromoter.recordCandidateLearning({
                category: 'SCHEMA_MISMATCH',
                symptom: `Task failed initially with ${lastFailureClass || 'ASSERTION_FAILURE'}`,
                rootCause: `Initial diff failed QA verification stages`,
                permanentPattern: `Ensure validation criteria and test assertions pass on initial patch`,
                antiPattern: `Emitting unvalidated changes without verifying test expectations`,
                evidenceTaskId: taskId
              });
            } catch {
              // Best-effort candidate recording
            }
          }

          const completedTask = this.stateMachine.transition({
            taskId,
            toStatus: TASK_STATUS.READY_FOR_PR,
            triggerReason: attempt === 0
              ? 'All 11 Layered QA stages passed cleanly'
              : `All 11 Layered QA stages passed cleanly after ${attempt} remediation attempt(s)`,
            actor: 'QA'
          });

          return {
            success: true,
            task: completedTask,
            qaReceipt,
            commitSha: lastCommitSha,
            branch
          };
        }

        // 12. QA Failed: Consult FailureRouter for Remediation Plan
        lastFailureClass = qaReceipt.failure_classification;
        const plan = this.failureRouter.getRemediationPlan({
          taskId,
          errorOrReceipt: qaReceipt,
          currentPatch: patch.diffContent
        });

        if (plan.canRetry) {
          attempt += 1;
          const failedStagesSummary = qaReceipt.failed_stages
            ? qaReceipt.failed_stages.map(s => `${s.stage_name}: ${s.message || ''}`).join('; ')
            : 'Unspecified failure';

          currentPrompt = [
            basePrompt,
            '',
            '### REMEDIATION REQUIRED (PREVIOUS ATTEMPT FAILED QA):',
            `- Failure Classification: ${plan.failureClass}`,
            `- Remediation Strategy: ${plan.action}`,
            `- Remediation Guidance: ${plan.promptGuidance}`,
            `- Failed Verification Stages: ${failedStagesSummary}`,
            `- Remaining Retries: ${plan.remainingRetries}`,
            '',
            'CRITICAL INSTRUCTION: Author a corrected <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE patch.',
            'Do NOT emit the exact same diff, as repeated identical diffs trip the circuit breaker and quarantine the task immediately.'
          ].join('\n');

          continue;
        }

        // 13. Retries exhausted or circuit breaker tripped
        let nextStatus = TASK_STATUS.FAILED;
        if (plan.quarantine || plan.failureClass === FAILURE_CLASSES.SECURITY_VIOLATION || plan.failureClass === FAILURE_CLASSES.IDENTICAL_DIFF) {
          nextStatus = TASK_STATUS.QUARANTINED;
        }

        const failedTask = this.stateMachine.transition({
          taskId,
          toStatus: nextStatus,
          triggerReason: `Circuit breaker tripped [${plan.failureClass}]: ${plan.action}`,
          actor: 'CIRCUIT_BREAKER'
        });

        return {
          success: false,
          task: failedTask,
          qaReceipt,
          error: `QA Verification rejected task [${plan.failureClass}]`
        };
      }
    } catch (err) {
      // Capture uncaught exceptions through failure router
      const plan = this.failureRouter.getRemediationPlan({
        taskId,
        errorOrReceipt: err
      });

      const nextStatus = plan.quarantine ? TASK_STATUS.QUARANTINED : TASK_STATUS.FAILED;
      try {
        const failedTask = this.stateMachine.transition({
          taskId,
          toStatus: nextStatus,
          triggerReason: `Execution abort [${plan.failureClass}]: ${err.message}`,
          actor: 'CIRCUIT_BREAKER'
        });

        return {
          success: false,
          task: failedTask,
          error: err.message
        };
      } catch {
        throw err;
      }
    } finally {
      // 14. Always release worktree lock cleanly
      this.worktreeManager.releaseWorktree(taskId);
    }
  }
}

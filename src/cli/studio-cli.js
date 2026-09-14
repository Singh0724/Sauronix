#!/usr/bin/env node
import { resolve, basename } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { StudioDatabase } from '../storage/db.js';
import { TaskStateMachine, TASK_STATUS } from '../state/task-state-machine.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { SpecValidator } from '../contracts/validator.js';
import { SurgicalCoder } from '../coder/surgical-coder.js';
import { LayeredQARunner } from '../qa/qa-runner.js';
import { FlightRecorder } from '../flight/flight-recorder.js';
import { FailureRouter } from '../remediation/failure-router.js';
import { KnowledgePromoter } from '../knowledge/knowledge-promoter.js';
import { DynamicRiskEngine } from '../risk/risk-engine.js';
import { CentralPolicyEngine } from '../policy/policy-engine.js';
import { PrGenerator } from '../git/pr-generator.js';
import { SingleAgentPipeline } from '../orchestrator/single-agent-loop.js';

const REPO_ROOT = resolve(process.cwd());

export class StudioCli {
  /**
   * @param {object} [options]
   * @param {string} [options.repoRoot]
   * @param {StudioDatabase} [options.studioDb]
   * @param {import('node:sqlite').DatabaseSync} [options.db]
   */
  constructor(options = {}) {
    this.repoRoot = resolve(options.repoRoot || REPO_ROOT);

    if (options.studioDb) {
      this.studioDb = options.studioDb;
    } else if (options.db && options.db.transaction) {
      this.studioDb = options.db;
    } else if (options.db) {
      this.studioDb = {
        db: options.db,
        transaction: (fn, critical = false) => {
          if (critical) options.db.exec('PRAGMA synchronous = FULL;');
          try {
            options.db.exec('BEGIN IMMEDIATE;');
            const res = fn();
            options.db.exec('COMMIT;');
            return res;
          } catch (e) {
            try { options.db.exec('ROLLBACK;'); } catch {}
            throw e;
          } finally {
            if (critical) options.db.exec('PRAGMA synchronous = NORMAL;');
          }
        }
      };
    } else {
      this.studioDb = new StudioDatabase();
    }

    this.db = this.studioDb.db;
    this.stateMachine = new TaskStateMachine(this.studioDb);
    this.worktreeManager = new WorktreeManager(this.repoRoot);
    this.specValidator = new SpecValidator(this.repoRoot);
    this.surgicalCoder = new SurgicalCoder({ workspaceRoot: this.repoRoot });
    this.qaRunner = new LayeredQARunner();
    this.flightRecorder = new FlightRecorder({ studioDb: this.studioDb, artifactBaseDir: resolve(this.repoRoot, '.agents/artifacts') });
    this.failureRouter = new FailureRouter();
    this.knowledgePromoter = new KnowledgePromoter({ db: this.db, workspaceRoot: this.repoRoot });
    this.riskEngine = new DynamicRiskEngine();
    this.policyEngine = new CentralPolicyEngine({ riskEngine: this.riskEngine });
    this.prGenerator = new PrGenerator({ stateMachine: this.stateMachine });
  }

  /**
   * Display status of active tasks, recent state transitions, and quota usage.
   * @returns {object}
   */
  status() {
    const activeTasks = this.db.prepare(
      `SELECT task_id, goal, risk_level, status, attempt_count, created_at
       FROM tasks
       ORDER BY updated_at DESC
       LIMIT 10`
    ).all();

    const recentTransitions = this.db.prepare(
      `SELECT task_id, from_status, to_status, trigger_reason, actor, timestamp
       FROM task_transitions
       ORDER BY transition_id DESC
       LIMIT 5`
    ).all();

    const quotaStats = this.db.prepare(
      `SELECT provider, model, SUM(request_count) as requests, SUM(token_count) as tokens, SUM(rate_limited_count) as rate_limits
       FROM quota_metrics
       GROUP BY provider, model`
    ).all();

    return {
      activeTasks,
      recentTransitions,
      quotaStats
    };
  }

  /**
   * Replay step-by-step forensic execution trace for a task.
   * @param {string} taskId
   * @returns {object[]}
   */
  replay(taskId) {
    return this.flightRecorder.replay(taskId);
  }

  /**
   * Generate a validated task-spec contract file.
   * @param {string} taskId
   * @param {string} [goal='Autonomous implementation task']
   * @param {string[]} [allowedFiles=['package.json']]
   * @returns {object}
   */
  createSpec(taskId, goal = 'Autonomous implementation task', allowedFiles = ['package.json']) {
    const spec = {
      task_id: taskId.toUpperCase(),
      goal,
      risk_level: 'MEDIUM',
      allowed_files: allowedFiles,
      forbidden_files: ['.env*', 'config/secrets*'],
      acceptance_criteria: [
        {
          id: 'CRIT-1',
          description: 'Verify workspace tests pass cleanly',
          verification_command: 'npm test',
          expected_exit_code: 0
        }
      ],
      test_plan: ['Run automated verification suite'],
      rollback_plan: `git checkout main && git branch -D agent/${taskId.toLowerCase()}`,
      security_impact: 'NONE',
      human_approval_required: false
    };

    const targetPath = resolve(this.repoRoot, `.agents/specs/${taskId.toLowerCase()}.json`);
    writeFileSync(targetPath, JSON.stringify(spec, null, 2), 'utf-8');

    return {
      spec,
      targetPath
    };
  }

  /**
   * Run a task specification end-to-end through the studio pipeline.
   *
   * @param {object} params
   * @param {string} params.specPath - Absolute or relative path to task-spec.json
   * @param {(prompt: string) => Promise<{ targetFile: string, diffContent: string }>} [params.patchProvider]
   * @returns {Promise<{ success: boolean, task: object, pr?: object, error?: string }>}
   */
  async runTask({ specPath, patchProvider }) {
    const fullSpecPath = resolve(specPath);
    if (!existsSync(fullSpecPath)) {
      throw new Error(`Spec file not found at: ${fullSpecPath}`);
    }

    const taskSpec = JSON.parse(readFileSync(fullSpecPath, 'utf-8'));

    // 1. Policy Authorization Check
    const auth = this.policyEngine.authorizeTaskExecution(taskSpec);
    if (!auth.authorized) {
      throw new Error(`Task rejected by Central Policy:\n- ${auth.violations.join('\n- ')}`);
    }

    // 2. Build and run single agent pipeline
    const pipeline = new SingleAgentPipeline({
      workspaceRoot: this.repoRoot,
      stateMachine: this.stateMachine,
      worktreeManager: this.worktreeManager,
      specValidator: this.specValidator,
      surgicalCoder: this.surgicalCoder,
      qaRunner: this.qaRunner,
      flightRecorder: this.flightRecorder,
      failureRouter: this.failureRouter,
      knowledgePromoter: this.knowledgePromoter
    });

    const defaultPatchProvider = patchProvider || (async () => {
      throw new Error('No patchProvider supplied to StudioCli. In production, connects to LLM execution router.');
    });

    const result = await pipeline.executeTask({
      taskSpec,
      patchProvider: defaultPatchProvider
    });

    if (result.success) {
      // 3. Generate Pull Request Package
      const pr = this.prGenerator.generatePullRequest({
        taskSpec,
        qaReceipt: result.qaReceipt,
        commitSha: result.commitSha,
        riskProfile: auth.riskProfile,
        branchName: result.branch
      });

      return {
        success: true,
        task: result.task,
        qaReceipt: result.qaReceipt,
        pr,
        branch: result.branch
      };
    }

    return {
      success: false,
      task: result.task,
      error: result.error
    };
  }

  /**
   * Approve and merge a Pull Request for a task.
   * @param {string} taskId
   * @param {string} [founderToken]
   * @returns {object}
   */
  approve(taskId, founderToken) {
    const task = this.stateMachine.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return this.prGenerator.signAndMergePr({
      taskId,
      prPackage: {
        riskTier: task.risk_level,
        requiresFounderSign: task.risk_level === 'HIGH'
      },
      founderToken
    });
  }
}

// CLI Execution Handler
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  const cli = new StudioCli();
  const [,, cmd, arg1, arg2] = process.argv;

  try {
    switch (cmd) {
      case 'status': {
        const stats = cli.status();
        console.log('\n=== AUTONOMOUS AI ENTERPRISE STUDIO STATUS ===\n');
        console.log('Active & Recent Tasks:');
        console.table(stats.activeTasks);
        console.log('\nRecent Transitions (Audit Log):');
        console.table(stats.recentTransitions);
        console.log('\nQuota & Token Telemetry:');
        console.table(stats.quotaStats);
        break;
      }
      case 'replay': {
        if (!arg1) throw new Error('Usage: npm run studio replay <TASK_ID>');
        const trace = cli.replay(arg1);
        console.log(`\n=== FORENSIC FLIGHT REPLAY: ${arg1} ===\n`);
        trace.forEach((step, idx) => {
          console.log(`[Step ${step.step_index}] Role: ${step.agent_role} | Tool: ${step.tool_name || 'N/A'}`);
          if (step.diff) console.log(`Diff SHA: ${step.diff_sha256}`);
        });
        break;
      }
      case 'create-spec': {
        if (!arg1) throw new Error('Usage: npm run studio create-spec <TASK_ID> [GOAL]');
        const res = cli.createSpec(arg1, arg2);
        console.log(`\n✔ Task contract created: ${res.targetPath}`);
        break;
      }
      case 'approve': {
        if (!arg1) throw new Error('Usage: npm run studio approve <TASK_ID>');
        const res = cli.approve(arg1, process.env.STUDIO_FOUNDER_TOKEN || 'founder-root-secret-5.0');
        console.log(`\n✔ PR approved and merged for ${arg1} at ${res.mergedAt}`);
        break;
      }
      case 'run': {
        if (!arg1) throw new Error('Usage: npm run studio run <path/to/spec.json>');
        cli.runTask({ specPath: arg1 }).then(res => {
          if (res.success) {
            console.log(`\n✔ Task ${res.task.task_id} completed successfully!`);
            console.log(`Status: ${res.task.status}`);
            console.log(`PR Title: ${res.pr.prTitle}`);
          } else {
            console.error(`\n✖ Task failed: ${res.error}`);
            process.exit(1);
          }
        }).catch(err => {
          console.error(`\n✖ Execution aborted: ${err.message}`);
          process.exit(1);
        });
        break;
      }
      default:
        console.log(`
Autonomous AI Enterprise Studio v5.0 CLI

Commands:
  npm run studio status             Display studio backlog, tasks & quota telemetry
  npm run studio run <spec.json>    Execute task contract end-to-end through control plane
  npm run studio replay <TASK_ID>   Replay deterministic forensic trace from flight recorder
  npm run studio create-spec <ID>   Scaffold a new validated task-spec contract
  npm run studio approve <TASK_ID>  Cryptographically sign off on a pull request
        `);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

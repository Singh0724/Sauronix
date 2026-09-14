import { DynamicRiskEngine, RISK_TIERS } from '../risk/risk-engine.js';

export class ParallelScheduler {
  /**
   * @param {object} options
   * @param {import('../git/worktree-manager.js').WorktreeManager} options.worktreeManager
   * @param {DynamicRiskEngine} [options.riskEngine]
   * @param {number} [options.maxConcurrentReads=4]
   */
  constructor({
    worktreeManager,
    riskEngine,
    maxConcurrentReads = 4
  }) {
    this.worktreeManager = worktreeManager;
    this.riskEngine = riskEngine || new DynamicRiskEngine();
    this.maxConcurrentReads = maxConcurrentReads;

    /** @type {Set<string>} */
    this.activeReadTasks = new Set();

    /** @type {string|null} */
    this.activeWriteTask = null;

    /** @type {Array<{ taskId: string, taskSpec: object, runnerFn: Function, resolve: Function, reject: Function }>} */
    this.writeQueue = [];
  }

  /**
   * Get current scheduler status.
   * @returns {{ activeReads: number, activeReadTasks: string[], activeWriter: string|null, queuedWrites: number, maxConcurrentReads: number }}
   */
  getSchedulerStatus() {
    return {
      activeReads: this.activeReadTasks.size,
      activeReadTasks: Array.from(this.activeReadTasks),
      activeWriter: this.activeWriteTask,
      queuedWrites: this.writeQueue.length,
      maxConcurrentReads: this.maxConcurrentReads
    };
  }

  /**
   * Submit and dispatch a task through the controlled concurrency scheduler.
   *
   * @param {object} params
   * @param {object} params.taskSpec - Task specification
   * @param {Function} params.runnerFn - Async execution function () => Promise<any>
   * @param {boolean} [params.isReadOnly=false] - Whether this is a read-only worker
   * @returns {Promise<any>}
   */
  async submitTask({ taskSpec, runnerFn, isReadOnly = false }) {
    const taskId = taskSpec.task_id;

    // 1. Dynamic Risk Pre-Flight Evaluation
    const riskProfile = this.riskEngine.evaluateTaskRisk(taskSpec);
    if (!riskProfile.canExecuteAutonomously) {
      throw new Error(
        `PreFlightRiskRejection: Task ${taskId} has ${riskProfile.riskTier} risk level. Autonomous execution prohibited (${riskProfile.policy}). Reasons: ${riskProfile.reasons.join('; ')}`
      );
    }

    // 2. Read-Only Task Concurrency Dispatch
    if (isReadOnly) {
      return this.executeReadTask(taskId, runnerFn);
    }

    // 3. Write-Lock Task Dispatch (Mutual Exclusion)
    return this.enqueueWriteTask({ taskId, taskSpec, runnerFn });
  }

  /**
   * Execute a read-only task respecting max concurrency.
   * @private
   */
  async executeReadTask(taskId, runnerFn) {
    if (this.activeReadTasks.size >= this.maxConcurrentReads) {
      throw new Error(
        `ConcurrencyExceeded: Maximum concurrent read workers (${this.maxConcurrentReads}) reached. Task ${taskId} must wait.`
      );
    }

    this.activeReadTasks.add(taskId);
    try {
      return await runnerFn();
    } finally {
      this.activeReadTasks.delete(taskId);
    }
  }

  /**
   * Enqueue a write task for exclusive write lease execution.
   * @private
   */
  enqueueWriteTask({ taskId, taskSpec, runnerFn }) {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ taskId, taskSpec, runnerFn, resolve, reject });
      this.processNextWriteTask();
    });
  }

  /**
   * Process the next write task if write lease is available.
   * @private
   */
  async processNextWriteTask() {
    if (this.activeWriteTask || this.writeQueue.length === 0) {
      return;
    }

    const nextJob = this.writeQueue.shift();
    this.activeWriteTask = nextJob.taskId;

    try {
      const result = await nextJob.runnerFn();
      nextJob.resolve(result);
    } catch (err) {
      nextJob.reject(err);
    } finally {
      this.activeWriteTask = null;
      // Process next queued write task if any
      process.nextTick(() => this.processNextWriteTask());
    }
  }
}

/**
 * Task State Machine with ACID Audit Transitions
 * Enforces legal state transitions and zero operational event loss.
 */

export const TASK_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PAUSING: 'PAUSING',
  PAUSED: 'PAUSED',
  CANCELLING: 'CANCELLING',
  CANCELLED: 'CANCELLED',
  INTERRUPTED: 'INTERRUPTED',
  QUARANTINED: 'QUARANTINED',
  FAILED: 'FAILED',
  READY_FOR_PR: 'READY_FOR_PR',
  COMPLETED: 'COMPLETED'
});

export const VALID_TRANSITIONS = Object.freeze({
  [TASK_STATUS.PENDING]: [TASK_STATUS.RUNNING, TASK_STATUS.PAUSED, TASK_STATUS.CANCELLED],
  [TASK_STATUS.RUNNING]: [
    TASK_STATUS.PAUSING,
    TASK_STATUS.PAUSED,
    TASK_STATUS.CANCELLING,
    TASK_STATUS.QUARANTINED,
    TASK_STATUS.FAILED,
    TASK_STATUS.READY_FOR_PR,
    TASK_STATUS.INTERRUPTED
  ],
  [TASK_STATUS.PAUSING]: [TASK_STATUS.PAUSED, TASK_STATUS.INTERRUPTED],
  [TASK_STATUS.PAUSED]: [TASK_STATUS.RUNNING, TASK_STATUS.CANCELLING, TASK_STATUS.CANCELLED],
  [TASK_STATUS.CANCELLING]: [TASK_STATUS.CANCELLED, TASK_STATUS.INTERRUPTED],
  [TASK_STATUS.INTERRUPTED]: [TASK_STATUS.PENDING, TASK_STATUS.CANCELLED, TASK_STATUS.QUARANTINED],
  [TASK_STATUS.QUARANTINED]: [TASK_STATUS.PENDING, TASK_STATUS.CANCELLED],
  [TASK_STATUS.FAILED]: [TASK_STATUS.PENDING, TASK_STATUS.CANCELLED],
  [TASK_STATUS.READY_FOR_PR]: [TASK_STATUS.COMPLETED, TASK_STATUS.RUNNING, TASK_STATUS.CANCELLED],
  [TASK_STATUS.CANCELLED]: [],
  [TASK_STATUS.COMPLETED]: []
});

export class TaskStateMachine {
  /**
   * @param {import('../storage/db.js').StudioDatabase} studioDb
   */
  constructor(studioDb) {
    this.studioDb = studioDb;

    this.stmtGetTask = this.studioDb.prepare(
      'SELECT task_id, status, attempt_count, max_attempts, branch_name, worktree_path FROM tasks WHERE task_id = ?;'
    );
    this.stmtInsertTask = this.studioDb.prepare(`
      INSERT INTO tasks (
        task_id, goal, risk_level, status, active_agent, attempt_count, max_attempts,
        allowed_files, forbidden_files, branch_name, worktree_path, spec_sha
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);
    this.stmtUpdateStatus = this.studioDb.prepare(`
      UPDATE tasks 
      SET status = ?, active_agent = ?, attempt_count = ?, updated_at = CURRENT_TIMESTAMP
      WHERE task_id = ?;
    `);
    this.stmtInsertTransition = this.studioDb.prepare(`
      INSERT INTO task_transitions (
        task_id, from_status, to_status, trigger_reason, actor, auth_signature
      ) VALUES (?, ?, ?, ?, ?, ?);
    `);
    this.stmtGetTransitions = this.studioDb.prepare(
      'SELECT * FROM task_transitions WHERE task_id = ? ORDER BY transition_id ASC;'
    );
  }

  /**
   * Register a new task in PENDING state.
   * @param {object} taskSpec
   */
  registerTask(taskSpec) {
    const {
      task_id,
      goal,
      risk_level = 'MEDIUM',
      allowed_files = ['src/**'],
      forbidden_files = ['.env*', 'config/production.*'],
      max_attempts = 2,
      spec_sha = null
    } = taskSpec;

    return this.studioDb.transaction(() => {
      this.stmtInsertTask.run(
        task_id,
        goal,
        risk_level,
        TASK_STATUS.PENDING,
        null,
        0,
        max_attempts,
        JSON.stringify(allowed_files),
        JSON.stringify(forbidden_files),
        null,
        null,
        spec_sha
      );

      this.stmtInsertTransition.run(
        task_id,
        'NONE',
        TASK_STATUS.PENDING,
        'Task registered in backlog',
        'SCHEDULER',
        null
      );

      return this.getTask(task_id);
    }, true);
  }

  /**
   * Retrieve task by ID.
   * @param {string} taskId
   */
  getTask(taskId) {
    return this.stmtGetTask.get(taskId);
  }

  /**
   * Execute an atomic state transition with audit log and critical durability.
   * @param {object} params
   * @param {string} params.taskId
   * @param {string} params.toStatus
   * @param {string} params.triggerReason
   * @param {string} params.actor - 'SCHEDULER' | 'CODER' | 'QA' | 'CIRCUIT_BREAKER' | 'FOUNDER'
   * @param {string} [params.activeAgent]
   * @param {number} [params.attemptCount]
   * @param {string} [params.authSignature]
   */
  transition({
    taskId,
    toStatus,
    triggerReason,
    actor,
    activeAgent = null,
    attemptCount = undefined,
    authSignature = null
  }) {
    if (!Object.values(TASK_STATUS).includes(toStatus)) {
      throw new Error(`Invalid target status: ${toStatus}`);
    }

    return this.studioDb.transaction(() => {
      const task = this.getTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const currentStatus = task.status;
      const allowedNext = VALID_TRANSITIONS[currentStatus] || [];

      if (!allowedNext.includes(toStatus)) {
        throw new Error(
          `Illegal state transition from ${currentStatus} to ${toStatus} for task ${taskId}`
        );
      }

      const nextAttempts = attemptCount !== undefined ? attemptCount : task.attempt_count;

      this.stmtUpdateStatus.run(toStatus, activeAgent, nextAttempts, taskId);
      this.stmtInsertTransition.run(
        taskId,
        currentStatus,
        toStatus,
        triggerReason,
        actor,
        authSignature
      );

      return this.getTask(taskId);
    }, true); // critical = true ensures PRAGMA synchronous = FULL
  }

  /**
   * Get audit transitions history for a task.
   * @param {string} taskId
   */
  getHistory(taskId) {
    return this.stmtGetTransitions.all(taskId);
  }
}

import { EmployeePool, EMPLOYEE_STATUS, EMPLOYEE_ROLES } from './employee-pool.js';
import { PrGenerator } from '../git/pr-generator.js';
import { KnowledgePromoter } from '../knowledge/knowledge-promoter.js';

export class TeamLead {
  /**
   * @param {object} options
   * @param {EmployeePool} [options.employeePool]
   * @param {PrGenerator} [options.prGenerator]
   * @param {KnowledgePromoter} [options.knowledgePromoter]
   */
  constructor(options = {}) {
    this.employeePool = options.employeePool || new EmployeePool();
    this.prGenerator = options.prGenerator || new PrGenerator();
    this.knowledgePromoter = options.knowledgePromoter;
    this.studioDb = options.studioDb || null;

    /** @type {{ name: string, title: string, role: string, experience: string, gender: string, specialty: string }} */
    this.leadProfile = Object.freeze({
      name: 'Dr. Elena Rostova',
      title: 'Chief Engineering Coordinator & Veteran Team Lead',
      role: 'TEAM_LEAD',
      experience: '50+ years',
      gender: 'Female',
      specialty: 'Distributed Systems, Autonomous Governance & Architectural Synthesis'
    });

    /** @type {Map<string, { taskSpec: object, status: string, pendingClarification: object|null }>} */
    this.managedTasks = new Map();

    /** @type {Array<{ id: string, taskId: string, rawPrompt: string, suggestedFiles: string[]|null, attachments: any[], status: string, taskSpec: object|null, assignedEmployee: object|null, enqueuedAt: string, error?: string }>} */
    this.taskQueue = [];
    this.nextQueueSeq = 601;
  }

  /**
   * Step 1: Analyze raw founder prompt and refine into an objective task contract.
   * If ambiguous, detects doubts and pauses for founder clarification.
   *
   * @param {object} params
   * @param {string} params.taskId - Must match ^TASK-[0-9]{3,6}$
   * @param {string} params.rawPrompt - High-level user goal
   * @param {string[]} [params.suggestedFiles]
   * @param {boolean} [params.forceRefine=false]
   * @returns {{ taskSpec: object|null, needsClarification: boolean, clarificationQuestion?: string, options?: string[] }}
   */
  analyzeAndRefineTask({ taskId, rawPrompt, suggestedFiles = null, forceRefine = false }) {
    if (!taskId || !rawPrompt) {
      throw new Error('TeamLead requires both taskId and rawPrompt.');
    }

    if (!/^TASK-[0-9]{3,6}$/i.test(taskId)) {
      throw new Error(`Invalid taskId format '${taskId}'. Must match ^TASK-[0-9]{3,6}$ (e.g. TASK-101).`);
    }

    // Ambiguity detection: Check if prompt contains conflicting design dilemmas
    const isAmbiguous = !forceRefine && /either.*or|should we|not sure|maybe|or should|confused/i.test(rawPrompt);

    if (isAmbiguous) {
      const question = `Team Lead Analysis: Found multiple potential design approaches for '${rawPrompt}'. Please clarify preference before employee assignment.`;
      const options = ['Approach A: Standard implementation', 'Approach B: Minimal fallback'];

      this.managedTasks.set(taskId, {
        status: 'AWAITING_FOUNDER_CLARIFICATION',
        rawPrompt,
        pendingClarification: { question, options }
      });

      return {
        taskSpec: null,
        needsClarification: true,
        clarificationQuestion: question,
        options
      };
    }

    // Refine into schema-valid task contract
    const files = suggestedFiles || (rawPrompt.toLowerCase().includes('package') ? ['package.json'] : ['src/index.js']);
    const isSecurity = /auth|token|session|secret|credential|password|payment|billing|stripe|wallet/i.test(rawPrompt);

    const taskSpec = {
      task_id: taskId.toUpperCase(),
      goal: rawPrompt.trim(),
      risk_level: isSecurity ? 'HIGH' : 'MEDIUM',
      allowed_files: files,
      forbidden_files: ['.env*', 'config/secrets*'],
      acceptance_criteria: [
        {
          id: 'CRIT-1',
          description: `Verify acceptance requirements for: ${rawPrompt.slice(0, 40)}`,
          verification_command: 'npm test',
          expected_exit_code: 0
        }
      ],
      test_plan: [`Run unit and verification tests for ${rawPrompt.slice(0, 30)}`],
      rollback_plan: `git checkout main && git branch -D agent/${taskId.toLowerCase()}`,
      security_impact: isSecurity ? 'HIGH' : 'NONE',
      human_approval_required: isSecurity
    };

    this.managedTasks.set(taskId, {
      taskSpec,
      status: 'REFINED',
      pendingClarification: null
    });

    return {
      taskSpec,
      needsClarification: false
    };
  }

  /**
   * Step 2: Resolve clarification with Founder response.
   *
   * @param {object} params
   * @param {string} params.taskId
   * @param {string} params.founderDecision
   * @returns {{ taskSpec: object }}
   */
  resolveFounderClarification({ taskId, founderDecision }) {
    const taskRecord = this.managedTasks.get(taskId);
    if (!taskRecord || !taskRecord.pendingClarification) {
      throw new Error(`Task ${taskId} is not awaiting clarification.`);
    }

    const refinedPrompt = `${taskRecord.rawPrompt} [Founder Decision: ${founderDecision}]`;
    const res = this.analyzeAndRefineTask({ taskId, rawPrompt: refinedPrompt, forceRefine: true });
    return { taskSpec: res.taskSpec };
  }

  /**
   * Step 3: Assign refined task to an available employee worker.
   *
   * @param {object} params
   * @param {object} params.taskSpec
   * @param {string} [params.employeeId]
   * @param {string} [params.role]
   * @returns {{ assignedEmployee: object, taskSpec: object }}
   */
  assignTask({ taskSpec, employeeId = null, role = null }) {
    const taskId = taskSpec.task_id;
    let employee = null;

    if (employeeId) {
      employee = this.employeePool.getEmployee(employeeId);
      if (!employee) throw new Error(`Employee ${employeeId} not found.`);
      if (employee.status !== EMPLOYEE_STATUS.FREE) {
        throw new Error(`Employee ${employee.name} (${employee.id}) is busy (${employee.status}).`);
      }
    } else {
      let targetRole = role;
      if (!targetRole && taskSpec && taskSpec.goal) {
        const goal = taskSpec.goal.toLowerCase();
        if (/marketing|seo|campaign|growth|funnel|copywriting|audience|conversion|landing/i.test(goal)) {
          targetRole = EMPLOYEE_ROLES.DIGITAL_MARKETER;
        } else if (/test|qa|mutation|coverage|audit|assert/i.test(goal)) {
          targetRole = EMPLOYEE_ROLES.QA_ENGINEER;
        } else if (/research|analyze|investigate|benchmark|feasibility|topology|find|explore|how we can|architecture/i.test(goal)) {
          targetRole = EMPLOYEE_ROLES.RESEARCH_ANALYST;
        } else {
          targetRole = EMPLOYEE_ROLES.SOFTWARE_ENGINEER;
        }
      }

      employee = this.employeePool.getAvailableEmployee(targetRole || EMPLOYEE_ROLES.SOFTWARE_ENGINEER);
      if (!employee) {
        throw new Error('All specialist employee workers are currently working or blocked. Task queued.');
      }
    }

    // Set employee state to WORKING
    this.employeePool.setEmployeeState(employee.id, EMPLOYEE_STATUS.WORKING, { taskId });

    // Synchronize to SQLite studioDb if available
    if (this.studioDb && taskSpec) {
      try {
        const existing = this.studioDb.prepare('SELECT task_id FROM tasks WHERE task_id = ?').get(taskId);
        if (!existing) {
          this.studioDb.prepare(`
            INSERT INTO tasks (
              task_id, goal, risk_level, status, active_agent, attempt_count, max_attempts,
              allowed_files, forbidden_files, branch_name, worktree_path, spec_sha
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            taskId,
            taskSpec.goal || 'Autonomous Engineering Task',
            taskSpec.risk_level || taskSpec.riskLevel || 'MEDIUM',
            'RUNNING',
            employee.name,
            1,
            3,
            JSON.stringify(taskSpec.allowed_files || []),
            JSON.stringify(taskSpec.forbidden_files || []),
            `feature/${taskId.toLowerCase()}`,
            `.worktrees/${taskId.toLowerCase()}`,
            taskSpec.spec_sha || `sha_${Date.now()}`
          );
        } else {
          this.studioDb.prepare(`
            UPDATE tasks SET status = 'RUNNING', active_agent = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
          `).run(employee.name, taskId);
        }
      } catch (err) {
        // Safe ignore
      }
    }

    return {
      assignedEmployee: employee,
      taskSpec
    };
  }

  /**
   * Step 4: Handle an employee doubt or blocker.
   * Coordinates resolution: unblocks if guidance exists, or escalates to Founder.
   *
   * @param {object} params
   * @param {string} params.employeeId
   * @param {string} params.taskId
   * @param {string} params.doubt
   * @param {string} [params.failureClass]
   * @returns {{ resolved: boolean, guidance?: string, escalatedToFounder?: boolean, question?: string }}
   */
  handleEmployeeDoubt({ employeeId, taskId, doubt, failureClass = null }) {
    const employee = this.employeePool.getEmployee(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} not found.`);

    // Transition employee to BLOCKED
    this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.BLOCKED, { taskId, doubt });
    if (this.studioDb) {
      try {
        this.studioDb.prepare(`
          UPDATE tasks SET status = 'BLOCKED', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
        `).run(taskId);
      } catch (err) {}
    }

    // 1. Check if Team Lead can resolve using senior invariants or promoted patterns
    const doubtLower = (doubt || '').toLowerCase();
    if (failureClass === 'SYNTAX_ERROR' || /(syntax|bracket|comma|token|parse)/i.test(doubtLower)) {
      const guidance = 'Team Lead Guidance: Retain original function envelope. Check missing brackets or commas without modifying outer signature.';
      this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.WORKING, { taskId, doubt: null });
      if (this.studioDb) {
        try {
          this.studioDb.prepare(`
            UPDATE tasks SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
          `).run(taskId);
        } catch (err) {}
      }
      return { resolved: true, guidance };
    }

    if (failureClass === 'TIMEOUT_DEADLOCK' || /(timeout|timed out|deadlock|hang|stuck)/i.test(doubtLower)) {
      const guidance = 'Team Lead Guidance: Inspect async promise resolution and release any open SQLite connection handles.';
      this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.WORKING, { taskId, doubt: null });
      if (this.studioDb) {
        try {
          this.studioDb.prepare(`
            UPDATE tasks SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
          `).run(taskId);
        } catch (err) {}
      }
      return { resolved: true, guidance };
    }

    // 2. Unresolvable design conflict -> Escalate to Founder
    const question = `Team Lead Escalation: Employee ${employee.name} (${employee.id}) on task ${taskId} is blocked: "${doubt}". What should the team do?`;
    return {
      resolved: false,
      escalatedToFounder: true,
      question
    };
  }

  /**
   * Step 5: Final Review & Submission.
   * Marks employee DONE, formats PR, and resets employee to FREE.
   *
   * @param {object} params
   * @param {string} params.employeeId
   * @param {object} params.taskSpec
   * @param {object} params.qaReceipt
   * @param {string} params.commitSha
   * @param {object} params.riskProfile
   * @param {string} params.branchName
   * @returns {{ approved: boolean, prPackage: object, employee: object }}
   */
  reviewAndSubmitTask({
    employeeId,
    taskSpec,
    qaReceipt,
    commitSha,
    riskProfile,
    branchName
  }) {
    const employee = this.employeePool.getEmployee(employeeId);
    if (!employee) throw new Error(`Employee ${employeeId} not found.`);

    if (!qaReceipt || !qaReceipt.all_passed) {
      throw new Error(`Team Lead Review Rejection: Layered QA verification has failing stages for task ${taskSpec.task_id}.`);
    }

    // Mark employee as DONE temporarily during review
    this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.DONE, { taskId: taskSpec.task_id });

    // Record into weekly audit history
    this.employeePool.recordCompletedTask(employeeId, {
      taskId: taskSpec.task_id,
      goal: taskSpec.goal,
      prTitle: `feat(${taskSpec.task_id.toLowerCase()}): ${taskSpec.goal}`,
      commitSha
    });

    // Generate verified PR package
    const prPackage = this.prGenerator.generatePullRequest({
      taskSpec,
      qaReceipt,
      commitSha,
      riskProfile,
      branchName
    });

    // Release employee back to FREE for next assignment
    this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.FREE);

    if (this.studioDb) {
      try {
        this.studioDb.prepare(`
          UPDATE tasks SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
        `).run(taskSpec.task_id);
      } catch (err) {}
    }

    // Mark task completed in queue if present
    const queued = this.taskQueue.find(t => t.taskId === taskSpec.task_id);
    if (queued) queued.status = 'COMPLETED';

    // Auto-process queue to pick up next pending task
    this.processQueue();

    return {
      approved: true,
      prPackage,
      employee
    };
  }

  /**
   * Enqueue a task for sequential refinement and specialist execution.
   * @param {string} rawPrompt
   * @param {object} [options]
   * @param {string} [options.taskId]
   * @param {string[]} [options.suggestedFiles]
   * @param {any[]} [options.attachments]
   * @returns {object} The enqueued task object
   */
  enqueueTask(rawPrompt, { taskId = null, suggestedFiles = null, attachments = [] } = {}) {
    const id = taskId || `TASK-${this.nextQueueSeq++}`;
    const queueItem = {
      id,
      taskId: id,
      rawPrompt,
      suggestedFiles,
      attachments,
      status: 'QUEUED', // QUEUED, AWAITING_CLARIFICATION, ASSIGNED, COMPLETED, ERROR
      taskSpec: null,
      assignedEmployee: null,
      enqueuedAt: new Date().toISOString()
    };
    this.taskQueue.push(queueItem);
    this.processQueue();
    return queueItem;
  }

  /**
   * Process the task queue FIFO: refine next available tasks and assign to free specialists.
   * @returns {number} Number of dispatched tasks
   */
  processQueue() {
    let dispatched = 0;
    for (const item of this.taskQueue) {
      if (item.status !== 'QUEUED') continue;

      try {
        const refinement = this.analyzeAndRefineTask({
          taskId: item.taskId,
          rawPrompt: item.rawPrompt,
          suggestedFiles: item.suggestedFiles
        });

        if (refinement.needsClarification) {
          item.status = 'AWAITING_CLARIFICATION';
          item.clarification = refinement;
          continue;
        }

        item.taskSpec = refinement.taskSpec;

        // Try assigning to available specialist
        const targetRole = this._inferRoleFromGoal(item.taskSpec.goal);
        const freeEmp = this.employeePool.getAvailableEmployee(targetRole);

        if (freeEmp) {
          const assignment = this.assignTask({ taskSpec: item.taskSpec, employeeId: freeEmp.id });
          item.status = 'ASSIGNED';
          item.assignedEmployee = assignment.assignedEmployee;
          dispatched++;
        }
      } catch (err) {
        // If employee pool was busy, item remains QUEUED for next tick
        if (!err.message.includes('currently working or blocked')) {
          item.status = 'ERROR';
          item.error = err.message;
        }
      }
    }
    return dispatched;
  }

  /**
   * Get full queue of tasks.
   * @returns {object[]}
   */
  getQueue() {
    return [...this.taskQueue];
  }

  /**
   * Helper to infer role from goal string.
   * @private
   */
  _inferRoleFromGoal(goal) {
    const g = (goal || '').toLowerCase();
    if (/marketing|seo|campaign|growth|funnel|copywriting|audience|conversion|landing/i.test(g)) {
      return EMPLOYEE_ROLES.DIGITAL_MARKETER;
    }
    if (/test|qa|mutation|coverage|audit|assert/i.test(g)) {
      return EMPLOYEE_ROLES.QA_ENGINEER;
    }
    if (/research|analyze|investigate|benchmark|feasibility|topology|find|explore|how we can|architecture/i.test(g)) {
      return EMPLOYEE_ROLES.RESEARCH_ANALYST;
    }
    return EMPLOYEE_ROLES.SOFTWARE_ENGINEER;
  }

  /**
   * Pause a specific employee immediately.
   * @param {string} employeeId
   * @param {string} [reason]
   * @returns {{ success: boolean, employee: object, message: string }}
   */
  pauseWorker(employeeId, reason = 'Paused by Founder directive for inspection') {
    const employee = this.employeePool.getEmployee(employeeId);
    if (!employee) throw new Error(`Employee '${employeeId}' not found.`);

    this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.BLOCKED, { doubt: reason });
    if (this.studioDb && employee.currentTaskId) {
      try {
        this.studioDb.prepare(`
          UPDATE tasks SET status = 'PAUSED', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
        `).run(employee.currentTaskId);
      } catch (err) {}
    }
    return {
      success: true,
      employee: this.employeePool.getEmployee(employeeId),
      message: `Worker ${employee.name} (${employee.id}) PAUSED safely.`
    };
  }

  /**
   * Provide corrective instructions to a worker and resume execution.
   * @param {string} employeeId
   * @param {string} founderInstruction
   * @returns {{ success: boolean, employee: object, instruction: string }}
   */
  instructWorker(employeeId, founderInstruction) {
    const employee = this.employeePool.getEmployee(employeeId);
    if (!employee) throw new Error(`Employee '${employeeId}' not found.`);
    if (!founderInstruction || !founderInstruction.trim()) {
      throw new Error('Founder instruction cannot be empty.');
    }
    if (employee.status !== EMPLOYEE_STATUS.BLOCKED && employee.status !== EMPLOYEE_STATUS.WORKING) {
      throw new Error(`Cannot instruct worker in '${employee.status}' status; worker must be BLOCKED or WORKING.`);
    }

    // Unblock and resume
    this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.WORKING, { doubt: null });
    if (this.studioDb && employee.currentTaskId) {
      try {
        this.studioDb.prepare(`
          UPDATE tasks SET status = 'RUNNING', updated_at = CURRENT_TIMESTAMP WHERE task_id = ?
        `).run(employee.currentTaskId);
      } catch (err) {}
    }
    return {
      success: true,
      employee: this.employeePool.getEmployee(employeeId),
      instruction: founderInstruction,
      message: `Worker ${employee.name} resumed with founder directive.`
    };
  }

  /**
   * Ask any employee what they are doing and generate a tailored natural language voice script.
   * @param {string} employeeId
   * @returns {{ employeeId: string, name: string, role: string, status: string, spokenText: string, speechBubble: string, voicePitch: number, voiceRate: number }}
   */
  askWorker(employeeId) {
    if (employeeId === 'LEAD-01' || employeeId === 'TEAM_LEAD') {
      const activeQueueCount = this.taskQueue.filter(t => t.status === 'QUEUED').length;
      const inProgressCount = this.taskQueue.filter(t => t.status === 'ASSIGNED').length;
      const spokenText = `I am Dr. Elena Rostova, Chief Engineering Coordinator. I am orchestrating the veteran engineering squad. We have ${activeQueueCount} tasks in the refinement backlog, and ${inProgressCount} active specialist operations underway across our worktrees. All governance policies are strictly enforced.`;
      return {
        employeeId: 'LEAD-01',
        name: this.leadProfile.name,
        role: this.leadProfile.role,
        status: 'COORDINATING',
        spokenText,
        speechBubble: spokenText,
        voicePitch: 1.0,
        voiceRate: 1.0
      };
    }

    const emp = this.employeePool.getEmployee(employeeId);
    if (!emp) throw new Error(`Employee '${employeeId}' not found.`);

    let spokenText = '';
    const intro = emp.introPhrase || `${emp.name}, ${emp.role.replace(/_/g, ' ')}.`;

    switch (emp.status) {
      case EMPLOYEE_STATUS.FREE:
        spokenText = `I am ${intro} All systems are nominal and my Git worktree is clean. I am standing by for your next architectural directive.`;
        break;
      case EMPLOYEE_STATUS.WORKING:
        spokenText = `I am ${intro} Currently actively executing task ${emp.currentTaskId}. Applying surgical diffs within our isolated worktree and maintaining 100 percent invariant compliance.`;
        break;
      case EMPLOYEE_STATUS.BLOCKED:
        spokenText = `I am ${intro} My execution is currently paused. Reason: ${emp.currentDoubt || 'Awaiting founder intervention'}. Ready to receive your corrective instructions.`;
        break;
      case EMPLOYEE_STATUS.DONE:
        spokenText = `I am ${intro} I have completed task ${emp.currentTaskId}. Layered QA verification receipts are generated, and my Pull Request package is submitted to Dr. Elena Rostova for review.`;
        break;
      default:
        spokenText = `I am ${intro} Status: ${emp.status}.`;
    }

    return {
      employeeId: emp.id,
      name: emp.name,
      role: emp.role,
      status: emp.status,
      spokenText,
      speechBubble: spokenText,
      voicePitch: emp.voicePitch || 1.0,
      voiceRate: emp.voiceRate || 1.0,
      avatar: emp.avatar,
      hologramColor: emp.hologramColor
    };
  }
}

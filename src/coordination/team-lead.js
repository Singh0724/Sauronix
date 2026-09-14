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

    /** @type {Map<string, { taskSpec: object, status: string, pendingClarification: object|null }>} */
    this.managedTasks = new Map();
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
    const isSecurity = /auth|token|session|secret|credential|password/i.test(rawPrompt);

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
      employee = this.employeePool.getAvailableEmployee(role || EMPLOYEE_ROLES.SURGICAL_CODER);
      if (!employee) {
        throw new Error('All specialist employee workers are currently working or blocked. Task queued.');
      }
    }

    // Set employee state to WORKING
    this.employeePool.setEmployeeState(employee.id, EMPLOYEE_STATUS.WORKING, { taskId });

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

    // 1. Check if Team Lead can resolve using senior invariants or promoted patterns
    if (failureClass === 'SYNTAX_ERROR' || doubt.toLowerCase().includes('syntax')) {
      const guidance = 'Team Lead Guidance: Retain original function envelope. Check missing brackets or commas without modifying outer signature.';
      this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.WORKING, { taskId, doubt: null });
      return { resolved: true, guidance };
    }

    if (failureClass === 'TIMEOUT_DEADLOCK' || doubt.toLowerCase().includes('timeout')) {
      const guidance = 'Team Lead Guidance: Inspect async promise resolution and release any open SQLite connection handles.';
      this.employeePool.setEmployeeState(employeeId, EMPLOYEE_STATUS.WORKING, { taskId, doubt: null });
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

    return {
      approved: true,
      prPackage,
      employee
    };
  }
}

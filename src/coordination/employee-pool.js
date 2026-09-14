export const EMPLOYEE_STATUS = Object.freeze({
  FREE: 'FREE',
  WORKING: 'WORKING',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED'
});

export const EMPLOYEE_ROLES = Object.freeze({
  SOFTWARE_ENGINEER: 'SOFTWARE_ENGINEER',
  SURGICAL_CODER: 'SOFTWARE_ENGINEER', // Alias for backward compatibility
  DIGITAL_MARKETER: 'DIGITAL_MARKETER',
  QA_ENGINEER: 'QA_ENGINEER',
  RESEARCH_ANALYST: 'RESEARCH_ANALYST'
});

export class EmployeePool {
  constructor(initialEmployees = null) {
    /** @type {Map<string, { id: string, name: string, role: string, experience: string, gender: string, specialty: string, status: string, currentTaskId: string|null, currentDoubt: string|null, avatar: string, hologramColor: string, voicePitch: number, voiceRate: number, introPhrase: string, updatedAt: string }>} */
    this.employees = new Map();

    /** @type {Array<{ id: string, employeeId: string, employeeName: string, taskId: string, goal: string, prTitle?: string, commitSha?: string, timestamp: string }>} */
    this.weeklyHistory = [];

    if (initialEmployees && Array.isArray(initialEmployees)) {
      initialEmployees.forEach(e => this.registerEmployee(e));
    } else {
      // Seed our world-class team of female veteran specialists (50+ years experience each)
      this.registerEmployee({
        id: 'EMP-01',
        name: 'Ada Sterling',
        role: EMPLOYEE_ROLES.SOFTWARE_ENGINEER,
        experience: '50+ years',
        gender: 'Female',
        specialty: 'High-performance core systems, surgical coding & clean architecture',
        avatar: '🤖⚡',
        hologramColor: '#06b6d4',
        voicePitch: 1.0,
        voiceRate: 1.05,
        introPhrase: 'Ada Sterling, Senior Software Architect.'
      });
      this.registerEmployee({
        id: 'EMP-02',
        name: 'Evelyn Reed',
        role: EMPLOYEE_ROLES.DIGITAL_MARKETER,
        experience: '50+ years',
        gender: 'Female',
        specialty: 'Growth architecture, technical SEO, conversion funnels & high-impact copy',
        avatar: '🤖🚀',
        hologramColor: '#ec4899',
        voicePitch: 1.1,
        voiceRate: 1.0,
        introPhrase: 'Evelyn Reed, Growth and Marketing Director.'
      });
      this.registerEmployee({
        id: 'EMP-03',
        name: 'Dr. Margaret Grace',
        role: EMPLOYEE_ROLES.QA_ENGINEER,
        experience: '50+ years',
        gender: 'Female',
        specialty: 'Zero-defect verification, 11-stage QA, mutation testing & SAST hardening',
        avatar: '🤖🛡️',
        hologramColor: '#10b981',
        voicePitch: 0.95,
        voiceRate: 0.95,
        introPhrase: 'Dr. Margaret Grace, Chief QA & Verification Officer.'
      });
      this.registerEmployee({
        id: 'EMP-04',
        name: 'Dr. Katherine Ross',
        role: EMPLOYEE_ROLES.RESEARCH_ANALYST,
        experience: '50+ years',
        gender: 'Female',
        specialty: 'Deep technical investigation, AST code intelligence & market analysis',
        avatar: '🤖🔭',
        hologramColor: '#6366f1',
        voicePitch: 1.05,
        voiceRate: 1.0,
        introPhrase: 'Dr. Katherine Ross, Principal Research Analyst.'
      });
    }
  }

  /**
   * Register a new employee in the pool.
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.role
   * @param {string} [params.experience='50+ years']
   * @param {string} [params.gender='Female']
   * @param {string} [params.specialty]
   * @param {string} [params.avatar='🤖']
   * @param {string} [params.hologramColor='#3b82f6']
   * @param {number} [params.voicePitch=1.0]
   * @param {number} [params.voiceRate=1.0]
   * @param {string} [params.introPhrase]
   */
  registerEmployee({
    id,
    name,
    role,
    experience = '50+ years',
    gender = 'Female',
    specialty = 'Senior Engineering Specialist',
    avatar = '🤖',
    hologramColor = '#3b82f6',
    voicePitch = 1.0,
    voiceRate = 1.0,
    introPhrase = null
  }) {
    if (!id || !name || !role) {
      throw new Error('Employee must have id, name, and role specified.');
    }
    this.employees.set(id, {
      id,
      name,
      role: role === 'SURGICAL_CODER' ? EMPLOYEE_ROLES.SOFTWARE_ENGINEER : role,
      experience,
      gender,
      specialty,
      avatar,
      hologramColor,
      voicePitch,
      voiceRate,
      introPhrase: introPhrase || `${name}, ${role.replace(/_/g, ' ')}.`,
      status: EMPLOYEE_STATUS.FREE,
      currentTaskId: null,
      currentDoubt: null,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Record a completed task into the weekly audit history.
   * @param {string} employeeId
   * @param {object} taskDetails
   */
  recordCompletedTask(employeeId, { taskId, goal, prTitle = null, commitSha = null, timestamp = null }) {
    const emp = this.employees.get(employeeId);
    const historyItem = {
      id: `HIST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      employeeId,
      employeeName: emp ? emp.name : 'Unknown Specialist',
      role: emp ? emp.role : 'ENGINEER',
      taskId,
      goal,
      prTitle: prTitle || `feat(${taskId.toLowerCase()}): ${goal}`,
      commitSha: commitSha || 'HEAD',
      timestamp: timestamp || new Date().toISOString()
    };
    this.weeklyHistory.unshift(historyItem);
    return historyItem;
  }

  /**
   * Get list of tasks completed in the last N days (defaults to 7).
   * @param {number} [days=7]
   * @returns {object[]}
   */
  getWeeklyHistory(days = 7) {
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return this.weeklyHistory.filter(item => {
      const itemTime = new Date(item.timestamp).getTime();
      return itemTime >= cutoff;
    });
  }

  /**
   * Find an available employee in FREE state.
   * @param {string} [role]
   * @returns {object|null}
   */
  getAvailableEmployee(role = null) {
    const targetRole = role === 'SURGICAL_CODER' ? EMPLOYEE_ROLES.SOFTWARE_ENGINEER : role;
    for (const emp of this.employees.values()) {
      if (emp.status === EMPLOYEE_STATUS.FREE) {
        if (!targetRole || emp.role === targetRole) {
          return emp;
        }
      }
    }
    return null;
  }

  /**
   * Get employee by ID.
   * @param {string} id
   * @returns {object|null}
   */
  getEmployee(id) {
    return this.employees.get(id) || null;
  }

  /**
   * Update an employee's state and task assignment.
   * @param {string} id
   * @param {string} status - Must be in EMPLOYEE_STATUS
   * @param {object} [options]
   * @param {string} [options.taskId]
   * @param {string} [options.doubt]
   */
  setEmployeeState(id, status, { taskId = undefined, doubt = undefined } = {}) {
    const emp = this.employees.get(id);
    if (!emp) {
      throw new Error(`Employee '${id}' not found in pool.`);
    }
    if (!Object.values(EMPLOYEE_STATUS).includes(status)) {
      throw new Error(`Invalid employee status '${status}'.`);
    }

    emp.status = status;
    // Distinguish "not provided" (undefined -> keep current) from explicit null (clear the field)
    emp.currentTaskId = taskId !== undefined ? taskId : emp.currentTaskId;
    emp.currentDoubt = doubt !== undefined ? doubt : emp.currentDoubt;
    emp.updatedAt = new Date().toISOString();

    if (status === EMPLOYEE_STATUS.FREE) {
      emp.currentTaskId = null;
      emp.currentDoubt = null;
    }

    return emp;
  }

  /**
   * Get full status table of all employees in pool.
   * @returns {object[]}
   */
  getPoolStatus() {
    return Array.from(this.employees.values()).map(e => ({
      id: e.id,
      name: e.name,
      role: e.role,
      experience: e.experience,
      gender: e.gender,
      status: e.status,
      currentTaskId: e.currentTaskId || 'None',
      currentDoubt: e.currentDoubt || 'None',
      specialty: e.specialty,
      avatar: e.avatar,
      hologramColor: e.hologramColor,
      voicePitch: e.voicePitch,
      voiceRate: e.voiceRate,
      introPhrase: e.introPhrase,
      completedCount: this.weeklyHistory.filter(h => h.employeeId === e.id).length
    }));
  }

  /**
   * Reset all employees to FREE state.
   */
  reset() {
    for (const emp of this.employees.values()) {
      emp.status = EMPLOYEE_STATUS.FREE;
      emp.currentTaskId = null;
      emp.currentDoubt = null;
      emp.updatedAt = new Date().toISOString();
    }
  }
}

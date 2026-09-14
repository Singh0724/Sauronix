export const EMPLOYEE_STATUS = Object.freeze({
  FREE: 'FREE',
  WORKING: 'WORKING',
  DONE: 'DONE',
  BLOCKED: 'BLOCKED'
});

export const EMPLOYEE_ROLES = Object.freeze({
  SURGICAL_CODER: 'SURGICAL_CODER',
  QA_ENGINEER: 'QA_ENGINEER',
  RESEARCH_ANALYST: 'RESEARCH_ANALYST'
});

export class EmployeePool {
  constructor(initialEmployees = null) {
    /** @type {Map<string, { id: string, name: string, role: string, status: string, currentTaskId: string|null, currentDoubt: string|null, updatedAt: string }>} */
    this.employees = new Map();

    if (initialEmployees && Array.isArray(initialEmployees)) {
      initialEmployees.forEach(e => this.registerEmployee(e));
    } else {
      // Seed default senior engineering specialist pool
      this.registerEmployee({ id: 'EMP-01', name: 'Alex Chen', role: EMPLOYEE_ROLES.SURGICAL_CODER });
      this.registerEmployee({ id: 'EMP-02', name: 'Priya Sharma', role: EMPLOYEE_ROLES.QA_ENGINEER });
      this.registerEmployee({ id: 'EMP-03', name: 'Marcus Vance', role: EMPLOYEE_ROLES.RESEARCH_ANALYST });
    }
  }

  /**
   * Register a new employee in the pool.
   * @param {object} params
   * @param {string} params.id
   * @param {string} params.name
   * @param {string} params.role
   */
  registerEmployee({ id, name, role }) {
    if (!id || !name || !role) {
      throw new Error('Employee must have id, name, and role specified.');
    }
    this.employees.set(id, {
      id,
      name,
      role,
      status: EMPLOYEE_STATUS.FREE,
      currentTaskId: null,
      currentDoubt: null,
      updatedAt: new Date().toISOString()
    });
  }

  /**
   * Find an available employee in FREE state.
   * @param {string} [role]
   * @returns {object|null}
   */
  getAvailableEmployee(role = null) {
    for (const emp of this.employees.values()) {
      if (emp.status === EMPLOYEE_STATUS.FREE) {
        if (!role || emp.role === role) {
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
  setEmployeeState(id, status, { taskId = null, doubt = null } = {}) {
    const emp = this.employees.get(id);
    if (!emp) {
      throw new Error(`Employee '${id}' not found in pool.`);
    }
    if (!Object.values(EMPLOYEE_STATUS).includes(status)) {
      throw new Error(`Invalid employee status '${status}'.`);
    }

    emp.status = status;
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
      status: e.status,
      currentTaskId: e.currentTaskId || 'None',
      currentDoubt: e.currentDoubt || 'None',
      updatedAt: e.updatedAt
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

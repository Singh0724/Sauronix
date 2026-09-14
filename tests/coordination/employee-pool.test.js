import test from 'node:test';
import assert from 'node:assert/strict';
import { EmployeePool, EMPLOYEE_STATUS, EMPLOYEE_ROLES } from '../../src/coordination/employee-pool.js';

test('EmployeePool: initializes with default specialists and FREE status', () => {
  const pool = new EmployeePool();
  const statusList = pool.getPoolStatus();

  assert.equal(statusList.length, 4);
  const coder = pool.getAvailableEmployee(EMPLOYEE_ROLES.SURGICAL_CODER);
  assert.ok(coder);
  assert.equal(coder.name, 'Ada Sterling');
  assert.equal(coder.experience, '50+ years');
  assert.equal(coder.gender, 'Female');
  assert.equal(coder.status, EMPLOYEE_STATUS.FREE);
  assert.equal(coder.currentTaskId, null);

  const marketer = pool.getAvailableEmployee(EMPLOYEE_ROLES.DIGITAL_MARKETER);
  assert.ok(marketer);
  assert.equal(marketer.name, 'Evelyn Reed');
  assert.equal(marketer.experience, '50+ years');
});

test('EmployeePool: registers custom employee and finds by role', () => {
  const pool = new EmployeePool([]);
  assert.equal(pool.getPoolStatus().length, 0);

  pool.registerEmployee({
    id: 'EMP-99',
    name: 'Ada Lovelace',
    role: EMPLOYEE_ROLES.RESEARCH_ANALYST
  });

  const emp = pool.getEmployee('EMP-99');
  assert.ok(emp);
  assert.equal(emp.name, 'Ada Lovelace');
  assert.equal(emp.status, EMPLOYEE_STATUS.FREE);

  const found = pool.getAvailableEmployee(EMPLOYEE_ROLES.RESEARCH_ANALYST);
  assert.equal(found.id, 'EMP-99');
});

test('EmployeePool: state transitions (FREE -> WORKING -> BLOCKED -> DONE -> FREE)', () => {
  const pool = new EmployeePool();
  const emp = pool.getAvailableEmployee(EMPLOYEE_ROLES.SURGICAL_CODER);

  // Transition to WORKING
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-101' });
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee(emp.id).currentTaskId, 'TASK-101');

  // Coder is no longer FREE
  assert.equal(pool.getAvailableEmployee(EMPLOYEE_ROLES.SURGICAL_CODER), null);

  // Transition to BLOCKED with doubt
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.BLOCKED, {
    taskId: 'TASK-101',
    doubt: 'Unsure about database schema migration strategy'
  });
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.BLOCKED);
  assert.equal(pool.getEmployee(emp.id).currentDoubt, 'Unsure about database schema migration strategy');

  // Transition to DONE
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.DONE, { taskId: 'TASK-101' });
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.DONE);

  // Release back to FREE
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee(emp.id).currentTaskId, null);
  assert.equal(pool.getEmployee(emp.id).currentDoubt, null);
});

test('EmployeePool: partial state updates preserve fields not explicitly provided', () => {
  const pool = new EmployeePool();

  // WORKING with taskId, then explicit null doubt (e.g. instructWorker) must
  // clear the doubt but PRESERVE currentTaskId
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-200', doubt: null });
  assert.equal(pool.getEmployee('EMP-01').currentTaskId, 'TASK-200');
  assert.equal(pool.getEmployee('EMP-01').currentDoubt, null);

  // Omitting taskId entirely must keep the current assignment
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.BLOCKED, { doubt: 'Stuck on schema' });
  assert.equal(pool.getEmployee('EMP-01').currentTaskId, 'TASK-200');
  assert.equal(pool.getEmployee('EMP-01').currentDoubt, 'Stuck on schema');

  // DONE must preserve the task id so askWorker can announce it
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.DONE);
  assert.equal(pool.getEmployee('EMP-01').currentTaskId, 'TASK-200');

  // Only FREE clears the assignment
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee('EMP-01').currentTaskId, null);
  assert.equal(pool.getEmployee('EMP-01').currentDoubt, null);
});

test('EmployeePool: throws on invalid status or nonexistent employee', () => {
  const pool = new EmployeePool();

  assert.throws(() => {
    pool.setEmployeeState('EMP-NONEXISTENT', EMPLOYEE_STATUS.WORKING);
  }, /not found in pool/);

  assert.throws(() => {
    pool.setEmployeeState('EMP-01', 'VACATION');
  }, /Invalid employee status/);
});

test('EmployeePool: reset restores all employees to FREE', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-102' });
  pool.setEmployeeState('EMP-02', EMPLOYEE_STATUS.BLOCKED, { taskId: 'TASK-103', doubt: 'Blocked' });

  pool.reset();

  for (const emp of pool.getPoolStatus()) {
    assert.equal(emp.status, EMPLOYEE_STATUS.FREE);
    assert.equal(emp.currentTaskId, 'None');
    assert.equal(emp.currentDoubt, 'None');
  }
});

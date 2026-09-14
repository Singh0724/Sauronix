import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { TeamLead } from '../../src/coordination/team-lead.js';
import { EmployeePool, EMPLOYEE_STATUS, EMPLOYEE_ROLES } from '../../src/coordination/employee-pool.js';
import { StudioCli } from '../../src/cli/studio-cli.js';
import { StudioDatabase } from '../../src/storage/db.js';

test('TeamLead: analyzes and refines clear prompt into valid task spec', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({
    taskId: 'TASK-110',
    rawPrompt: 'Implement database connection pool caching'
  });

  assert.equal(res.needsClarification, false);
  assert.ok(res.taskSpec);
  assert.equal(res.taskSpec.task_id, 'TASK-110');
  assert.equal(res.taskSpec.goal, 'Implement database connection pool caching');
  assert.equal(res.taskSpec.risk_level, 'MEDIUM');
  assert.ok(res.taskSpec.acceptance_criteria.length > 0);
});

test('TeamLead: detects ambiguity and asks founder for clarification', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({
    taskId: 'TASK-111',
    rawPrompt: 'Should we either use SQLite WAL mode or should we use in-memory table?'
  });

  assert.equal(res.needsClarification, true);
  assert.equal(res.taskSpec, null);
  assert.ok(res.clarificationQuestion.includes('Found multiple potential design approaches'));
  assert.ok(res.options.length >= 2);

  // Founder resolves the doubt
  const resolved = teamLead.resolveFounderClarification({
    taskId: 'TASK-111',
    founderDecision: 'Use SQLite WAL mode'
  });

  assert.ok(resolved.taskSpec);
  assert.equal(resolved.taskSpec.task_id, 'TASK-111');
  assert.ok(resolved.taskSpec.goal.includes('Use SQLite WAL mode'));
});

test('TeamLead: assigns task to free employee and prevents double-assignment', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });

  const { taskSpec } = teamLead.analyzeAndRefineTask({
    taskId: 'TASK-112',
    rawPrompt: 'Add retry exponential backoff to HTTP client'
  });

  const assignment = teamLead.assignTask({ taskSpec, role: EMPLOYEE_ROLES.SURGICAL_CODER });
  assert.ok(assignment.assignedEmployee);
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.SURGICAL_CODER);
  assert.equal(pool.getEmployee(assignment.assignedEmployee.id).status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee(assignment.assignedEmployee.id).currentTaskId, 'TASK-112');

  // Attempting to assign another task to the same busy employee throws
  assert.throws(() => {
    teamLead.assignTask({
      taskSpec: { task_id: 'TASK-113', goal: 'Another task' },
      employeeId: assignment.assignedEmployee.id
    });
  }, /is busy/);
});

test('TeamLead: handles employee doubts - autonomous resolution vs founder escalation', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });

  const emp = pool.getAvailableEmployee(EMPLOYEE_ROLES.SURGICAL_CODER);
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-114' });

  // 1. Syntax doubt -> Autonomous guidance & unblocks
  const syntaxRes = teamLead.handleEmployeeDoubt({
    employeeId: emp.id,
    taskId: 'TASK-114',
    doubt: 'Encountered unexpected syntax token near function signature',
    failureClass: 'SYNTAX_ERROR'
  });
  assert.equal(syntaxRes.resolved, true);
  assert.ok(syntaxRes.guidance.includes('envelope'));
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.WORKING);

  // 2. Fundamental architectural ambiguity -> Escalates to founder
  const archRes = teamLead.handleEmployeeDoubt({
    employeeId: emp.id,
    taskId: 'TASK-114',
    doubt: 'Third party API schema contradicts internal interface specifications'
  });
  assert.equal(archRes.resolved, false);
  assert.equal(archRes.escalatedToFounder, true);
  assert.ok(archRes.question.includes('is blocked'));
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.BLOCKED);
});

test('TeamLead: reviews QA receipt, generates PR package, and releases employee to FREE', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });

  const emp = pool.getAvailableEmployee(EMPLOYEE_ROLES.SURGICAL_CODER);
  const { taskSpec } = teamLead.analyzeAndRefineTask({
    taskId: 'TASK-115',
    rawPrompt: 'Refactor logging subsystem'
  });

  teamLead.assignTask({ taskSpec, employeeId: emp.id });
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.WORKING);

  // Fails review if QA failed
  assert.throws(() => {
    teamLead.reviewAndSubmitTask({
      employeeId: emp.id,
      taskSpec,
      qaReceipt: { all_passed: false },
      commitSha: 'a1b2c3d4',
      riskProfile: { riskTier: 'LOW' },
      branchName: 'agent/task-115'
    });
  }, /Layered QA verification has failing stages/);

  // Passes review when QA passed
  const review = teamLead.reviewAndSubmitTask({
    employeeId: emp.id,
    taskSpec,
    qaReceipt: {
      all_passed: true,
      execution_time_ms: 120,
      diff_risk_score: 15,
      diff_risk_level: 'LOW',
      test_stage: { passed: true },
      mutation_stage: { passed: true }
    },
    commitSha: 'a1b2c3d4',
    riskProfile: { riskTier: 'LOW' },
    branchName: 'agent/task-115'
  });

  assert.equal(review.approved, true);
  assert.ok(review.prPackage);
  assert.equal(review.prPackage.metadata.taskId, 'TASK-115');

  // Employee returned to FREE state
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee(emp.id).currentTaskId, null);
});

test('StudioCli: team status and task delegation integration', () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: resolve('.'), studioDb: db });

  // 1. Team status check
  const team = cli.teamStatus();
  assert.equal(team.length, 3);
  assert.equal(team[0].status, 'FREE');

  // 2. Delegate unambiguous prompt
  const res = cli.delegate({
    taskId: 'TASK-116',
    rawPrompt: 'Add security headers to express middleware'
  });
  assert.equal(res.needsClarification, false);
  assert.equal(res.assignedEmployee.status, 'WORKING');
  assert.equal(res.taskSpec.task_id, 'TASK-116');

  // 3. Delegate ambiguous prompt requires clarification
  const ambig = cli.delegate({
    taskId: 'TASK-117',
    rawPrompt: 'Should we either use redis or memory for session storage?'
  });
  assert.equal(ambig.needsClarification, true);
  assert.ok(ambig.question);

  db.close();
});

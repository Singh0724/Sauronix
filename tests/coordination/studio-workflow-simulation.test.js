import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { TeamLead } from '../../src/coordination/team-lead.js';
import { EmployeePool, EMPLOYEE_STATUS, EMPLOYEE_ROLES } from '../../src/coordination/employee-pool.js';
import { StudioCli } from '../../src/cli/studio-cli.js';
import { StudioDatabase } from '../../src/storage/db.js';
import { PrGenerator } from '../../src/git/pr-generator.js';
import { DynamicRiskEngine } from '../../src/risk/risk-engine.js';
import { TaskStateMachine } from '../../src/state/task-state-machine.js';

// ==============================================================================
// 50-SCENARIO EXHAUSTIVE WORKFLOW & COORDINATION SIMULATION TEST SUITE
// ==============================================================================

// --- SECTION 1: ROLE ROUTING & SPECIALIZATION (Tests 1 to 10) ---

test('Scenario 01: Digital Marketing - SEO meta tags optimization routes to Evelyn Reed', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-501', rawPrompt: 'Optimize landing page SEO meta tags and sitemap' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Evelyn Reed');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.DIGITAL_MARKETER);
});

test('Scenario 02: Digital Marketing - Conversion funnel copy routes to Evelyn Reed', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-502', rawPrompt: 'Draft high-converting copy for pricing page funnel' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Evelyn Reed');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.DIGITAL_MARKETER);
});

test('Scenario 03: Digital Marketing - User acquisition email campaign routes to Evelyn Reed', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-503', rawPrompt: 'Create onboarding email campaign sequence for user growth' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Evelyn Reed');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.DIGITAL_MARKETER);
});

test('Scenario 04: Research Analyst - Architecture feasibility routes to Dr. Katherine Ross', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-504', rawPrompt: 'Research architectural feasibility of SQLite vector search' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Dr. Katherine Ross');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.RESEARCH_ANALYST);
});

test('Scenario 05: Research Analyst - Benchmark performance investigation routes to Dr. Katherine Ross', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-505', rawPrompt: 'Investigate and benchmark network latency across cloud providers' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Dr. Katherine Ross');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.RESEARCH_ANALYST);
});

test('Scenario 06: Research Analyst - Exploratory query routes to Dr. Katherine Ross', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-506', rawPrompt: 'Find how we can implement real-time video streaming' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Dr. Katherine Ross');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.RESEARCH_ANALYST);
});

test('Scenario 07: QA Engineer - Mutation testing suite routes to Dr. Margaret Grace', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-507', rawPrompt: 'Execute AST mutation testing on authorization module' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Dr. Margaret Grace');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.QA_ENGINEER);
});

test('Scenario 08: QA Engineer - Zero-defect audit coverage routes to Dr. Margaret Grace', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-508', rawPrompt: 'Audit test coverage and assert edge case boundaries' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Dr. Margaret Grace');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.QA_ENGINEER);
});

test('Scenario 09: Software Engineer - Core engine refactoring routes to Ada Sterling', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-509', rawPrompt: 'Refactor database connection pool with LRU cache eviction' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.name, 'Ada Sterling');
  assert.equal(assignment.assignedEmployee.role, EMPLOYEE_ROLES.SOFTWARE_ENGINEER);
});

test('Scenario 10: Explicit Role Override - Can assign research task to software engineer if mandated', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-510', rawPrompt: 'Research and immediately code the websocket server' });
  const assignment = teamLead.assignTask({ taskSpec, role: EMPLOYEE_ROLES.SOFTWARE_ENGINEER });
  assert.equal(assignment.assignedEmployee.name, 'Ada Sterling');
});

// --- SECTION 2: AMBIGUITY & CLARIFICATION HANDLING (Tests 11 to 18) ---

test('Scenario 11: Dilemma Detection - "either/or" triggers clarification request', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({ taskId: 'TASK-511', rawPrompt: 'Should we either use Redis or SQLite for temporary session caching?' });
  assert.equal(res.needsClarification, true);
  assert.equal(res.taskSpec, null);
  assert.ok(res.clarificationQuestion.includes('Found multiple potential design approaches'));
});

test('Scenario 12: Dilemma Detection - "not sure" triggers clarification request', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({ taskId: 'TASK-512', rawPrompt: 'Not sure if we should support OAuth2 or API keys for authentication' });
  assert.equal(res.needsClarification, true);
  assert.ok(res.options.length >= 2);
});

test('Scenario 13: Dilemma Detection - "maybe / or should" triggers clarification request', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({ taskId: 'TASK-513', rawPrompt: 'Maybe we should use Docker Compose or should we run bare metal?' });
  assert.equal(res.needsClarification, true);
});

test('Scenario 14: Dilemma Detection - "confused" triggers clarification request', () => {
  const teamLead = new TeamLead();
  const res = teamLead.analyzeAndRefineTask({ taskId: 'TASK-514', rawPrompt: 'Confused between using JSONB or relational normalized tables' });
  assert.equal(res.needsClarification, true);
});

test('Scenario 15: Resolving Clarification - Founder provides decision A', () => {
  const teamLead = new TeamLead();
  teamLead.analyzeAndRefineTask({ taskId: 'TASK-515', rawPrompt: 'Should we either use SQLite or Postgres?' });
  const resolved = teamLead.resolveFounderClarification({ taskId: 'TASK-515', founderDecision: 'Use SQLite exclusively' });
  assert.ok(resolved.taskSpec);
  assert.ok(resolved.taskSpec.goal.includes('Use SQLite exclusively'));
});

test('Scenario 16: Resolving Clarification - Founder provides decision B', () => {
  const teamLead = new TeamLead();
  teamLead.analyzeAndRefineTask({ taskId: 'TASK-516', rawPrompt: 'Should we either use Stripe or PayPal?' });
  const resolved = teamLead.resolveFounderClarification({ taskId: 'TASK-516', founderDecision: 'Use Stripe Elements' });
  assert.ok(resolved.taskSpec);
  assert.ok(resolved.taskSpec.goal.includes('Use Stripe Elements'));
});

test('Scenario 17: Resolving Clarification - Throws if task was not awaiting clarification', () => {
  const teamLead = new TeamLead();
  assert.throws(() => {
    teamLead.resolveFounderClarification({ taskId: 'TASK-999', founderDecision: 'Any decision' });
  }, /not awaiting clarification/);
});

test('Scenario 18: Resolved task assigns cleanly to worker', () => {
  const teamLead = new TeamLead();
  teamLead.analyzeAndRefineTask({ taskId: 'TASK-518', rawPrompt: 'Should we either use CSS Grid or Flexbox?' });
  const { taskSpec } = teamLead.resolveFounderClarification({ taskId: 'TASK-518', founderDecision: 'Use CSS Grid' });
  const assignment = teamLead.assignTask({ taskSpec });
  assert.equal(assignment.assignedEmployee.status, EMPLOYEE_STATUS.WORKING);
});

// --- SECTION 3: SECURITY, RISK TIERS & GOVERNANCE (Tests 19 to 26) ---

test('Scenario 19: Risk Classification - Payment integration classified as HIGH risk', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-519', rawPrompt: 'Implement Stripe credit card payment processing' });
  assert.equal(taskSpec.risk_level, 'HIGH');
  assert.equal(taskSpec.security_impact, 'HIGH');
  assert.equal(taskSpec.human_approval_required, true);
});

test('Scenario 20: Risk Classification - User authentication classified as HIGH risk', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-520', rawPrompt: 'Add session token authentication validator' });
  assert.equal(taskSpec.risk_level, 'HIGH');
  assert.equal(taskSpec.human_approval_required, true);
});

test('Scenario 21: Risk Classification - Secret credentials management classified as HIGH risk', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-521', rawPrompt: 'Rotate production API secret credentials' });
  assert.equal(taskSpec.risk_level, 'HIGH');
  assert.equal(taskSpec.human_approval_required, true);
});

test('Scenario 22: Risk Classification - Standard business logic classified as MEDIUM risk', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-522', rawPrompt: 'Build customer profile avatar resizer service' });
  assert.equal(taskSpec.risk_level, 'MEDIUM');
  assert.equal(taskSpec.security_impact, 'NONE');
  assert.equal(taskSpec.human_approval_required, false);
});

test('Scenario 23: Spec Contract - Forbidden paths are protected (.env and secrets)', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-523', rawPrompt: 'Build email dispatch queue' });
  assert.ok(taskSpec.forbidden_files.includes('.env*'));
  assert.ok(taskSpec.forbidden_files.includes('config/secrets*'));
});

test('Scenario 24: Spec Contract - Rejects invalid task ID format', () => {
  const teamLead = new TeamLead();
  assert.throws(() => {
    teamLead.analyzeAndRefineTask({ taskId: 'INVALID-ID', rawPrompt: 'Do something' });
  });
});

test('Scenario 25: Spec Contract - Automated rollback command is populated', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-525', rawPrompt: 'Add health check probe' });
  assert.equal(taskSpec.rollback_plan, 'git checkout main && git branch -D agent/task-525');
});

test('Scenario 26: High-risk task generates PR with mandatory founder approval requirement', () => {
  const teamLead = new TeamLead();
  const { taskSpec } = teamLead.analyzeAndRefineTask({ taskId: 'TASK-526', rawPrompt: 'Refactor Stripe payment webhook signature' });
  const assignment = teamLead.assignTask({ taskSpec });

  const review = teamLead.reviewAndSubmitTask({
    employeeId: assignment.assignedEmployee.id,
    taskSpec,
    qaReceipt: { all_passed: true },
    commitSha: 'c0ffee1234',
    riskProfile: { riskTier: 'HIGH', humanApprovalRequired: true, riskScore: 80 },
    branchName: 'agent/task-526'
  });

  assert.equal(review.prPackage.requiresFounderSign, true);
});

// --- SECTION 4: WORKER LIFECYCLE, CONCURRENCY & LOCKS (Tests 27 to 36) ---

test('Scenario 27: Worker State - Transitions from FREE to WORKING', () => {
  const pool = new EmployeePool();
  const emp = pool.getAvailableEmployee(EMPLOYEE_ROLES.SOFTWARE_ENGINEER);
  assert.equal(emp.status, EMPLOYEE_STATUS.FREE);

  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-527' });
  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee(emp.id).currentTaskId, 'TASK-527');
});

test('Scenario 28: Worker State - Transitions from WORKING to DONE', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-528' });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.DONE);
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.DONE);
});

test('Scenario 29: Worker State - Transitions from DONE back to FREE', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.DONE);
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.FREE);
  assert.equal(pool.getEmployee('EMP-01').currentTaskId, null);
});

test('Scenario 30: Worker State - Transitions from WORKING to BLOCKED on doubt', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-530' });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.BLOCKED, { taskId: 'TASK-530', doubt: 'Unclear error' });
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.BLOCKED);
  assert.equal(pool.getEmployee('EMP-01').currentDoubt, 'Unclear error');
});

test('Scenario 31: Busy Worker Protection - Assigning busy worker throws error', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-531' });

  assert.throws(() => {
    teamLead.assignTask({
      taskSpec: { task_id: 'TASK-532', goal: 'Another task' },
      employeeId: 'EMP-01'
    });
  }, /is busy/);
});

test('Scenario 32: Pool Exhaustion - Throws descriptive error when role is completely occupied', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-533' });

  assert.throws(() => {
    teamLead.assignTask({
      taskSpec: { task_id: 'TASK-534', goal: 'Implement new service' },
      role: EMPLOYEE_ROLES.SOFTWARE_ENGINEER
    });
  }, /All specialist employee workers are currently working or blocked/);
});

test('Scenario 33: Worker Release - Completing task releases employee back to FREE', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  const emp = pool.getAvailableEmployee(EMPLOYEE_ROLES.SOFTWARE_ENGINEER);
  pool.setEmployeeState(emp.id, EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-535' });

  teamLead.reviewAndSubmitTask({
    employeeId: emp.id,
    taskSpec: { task_id: 'TASK-535', goal: 'Test' },
    qaReceipt: { all_passed: true },
    commitSha: 'sha123',
    riskProfile: { riskTier: 'LOW' },
    branchName: 'agent/task-535'
  });

  assert.equal(pool.getEmployee(emp.id).status, EMPLOYEE_STATUS.FREE);
});

test('Scenario 34: Multi-Worker Independence - Multiple workers can execute different tasks simultaneously', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-536A' });
  pool.setEmployeeState('EMP-02', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-536B' });
  pool.setEmployeeState('EMP-03', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-536C' });

  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee('EMP-02').status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee('EMP-03').status, EMPLOYEE_STATUS.WORKING);
  assert.equal(pool.getEmployee('EMP-04').status, EMPLOYEE_STATUS.FREE);
});

test('Scenario 35: Pool Reset - Restores every worker to FREE regardless of initial state', () => {
  const pool = new EmployeePool();
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-A' });
  pool.setEmployeeState('EMP-02', EMPLOYEE_STATUS.BLOCKED, { taskId: 'TASK-B', doubt: 'Blocked' });
  pool.setEmployeeState('EMP-03', EMPLOYEE_STATUS.DONE, { taskId: 'TASK-C' });

  pool.reset();

  const status = pool.getPoolStatus();
  for (const emp of status) {
    assert.equal(emp.status, EMPLOYEE_STATUS.FREE);
    assert.equal(emp.currentTaskId, 'None');
    assert.equal(emp.currentDoubt, 'None');
  }
});

test('Scenario 36: Veteran Roster Integrity - All 4 default employees have 50+ years experience and Female gender', () => {
  const pool = new EmployeePool();
  for (const emp of pool.employees.values()) {
    assert.equal(emp.experience, '50+ years');
    assert.equal(emp.gender, 'Female');
  }
});

// --- SECTION 5: DOUBT RESOLUTION & TRIAGE (Tests 37 to 42) ---

test('Scenario 37: Doubt Triage - Syntax errors resolved autonomously by Team Lead', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-537' });

  const res = teamLead.handleEmployeeDoubt({
    employeeId: 'EMP-01',
    taskId: 'TASK-537',
    doubt: 'Missing closing curly brace in function body',
    failureClass: 'SYNTAX_ERROR'
  });

  assert.equal(res.resolved, true);
  assert.ok(res.guidance.includes('envelope'));
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.WORKING);
});

test('Scenario 38: Doubt Triage - Database timeout deadlock resolved autonomously by Team Lead', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-538' });

  const res = teamLead.handleEmployeeDoubt({
    employeeId: 'EMP-01',
    taskId: 'TASK-538',
    doubt: 'Connection timeout while waiting for lock',
    failureClass: 'TIMEOUT_DEADLOCK'
  });

  assert.equal(res.resolved, true);
  assert.ok(res.guidance.includes('SQLite connection handles'));
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.WORKING);
});

test('Scenario 39: Doubt Triage - Keyword "syntax" in doubt text triggers autonomous guidance', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-539' });

  const res = teamLead.handleEmployeeDoubt({
    employeeId: 'EMP-01',
    taskId: 'TASK-539',
    doubt: 'I have a syntax confusion with async arrow function'
  });

  assert.equal(res.resolved, true);
});

test('Scenario 40: Doubt Triage - Keyword "timeout" in doubt text triggers autonomous guidance', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-540' });

  const res = teamLead.handleEmployeeDoubt({
    employeeId: 'EMP-01',
    taskId: 'TASK-540',
    doubt: 'Operation timed out after 5000ms'
  });

  assert.equal(res.resolved, true);
});

test('Scenario 41: Doubt Triage - Architectural contradiction escalates to Founder', () => {
  const pool = new EmployeePool();
  const teamLead = new TeamLead({ employeePool: pool });
  pool.setEmployeeState('EMP-01', EMPLOYEE_STATUS.WORKING, { taskId: 'TASK-541' });

  const res = teamLead.handleEmployeeDoubt({
    employeeId: 'EMP-01',
    taskId: 'TASK-541',
    doubt: 'Third party API deprecation breaks backward compatibility of our public API'
  });

  assert.equal(res.resolved, false);
  assert.equal(res.escalatedToFounder, true);
  assert.ok(res.question.includes('is blocked'));
  assert.equal(pool.getEmployee('EMP-01').status, EMPLOYEE_STATUS.BLOCKED);
});

test('Scenario 42: Doubt Triage - Throws error if invalid employeeId is given', () => {
  const teamLead = new TeamLead();
  assert.throws(() => {
    teamLead.handleEmployeeDoubt({ employeeId: 'EMP-GHOST', taskId: 'TASK-542', doubt: 'Lost' });
  }, /not found/);
});

// --- SECTION 6: QA GATES, PR GENERATION & CLINICAL VERIFICATION (Tests 43 to 50) ---

test('Scenario 43: QA Rejection - Failing QA verification blocks PR generation', () => {
  const teamLead = new TeamLead();
  assert.throws(() => {
    teamLead.reviewAndSubmitTask({
      employeeId: 'EMP-01',
      taskSpec: { task_id: 'TASK-543', goal: 'Test' },
      qaReceipt: { all_passed: false },
      commitSha: 'sha1',
      riskProfile: { riskTier: 'LOW' },
      branchName: 'agent/task-543'
    });
  }, /Layered QA verification has failing stages/);
});

test('Scenario 44: QA Acceptance - 100% passing QA stages approves and generates PR', () => {
  const teamLead = new TeamLead();
  const review = teamLead.reviewAndSubmitTask({
    employeeId: 'EMP-01',
    taskSpec: { task_id: 'TASK-544', goal: 'Build payment ledger table' },
    qaReceipt: {
      all_passed: true,
      stages: [
        { stage_name: 'STAGE_1_TYPECHECK', passed: true, duration_ms: 2.1 },
        { stage_name: 'STAGE_4_SAST_SECRETS', passed: true, duration_ms: 5.0 }
      ]
    },
    commitSha: 'a1b2c3d4e5f6',
    riskProfile: { riskTier: 'LOW', humanApprovalRequired: false, riskScore: 15 },
    branchName: 'agent/task-544'
  });

  assert.equal(review.approved, true);
  assert.ok(review.prPackage.prTitle.toLowerCase().includes('task-544'));
});

test('Scenario 45: PR Package Content - Formats 11-stage QA table in markdown body', () => {
  const prGen = new PrGenerator();
  const pr = prGen.generatePullRequest({
    taskSpec: { task_id: 'TASK-545', goal: 'Add rate limiter' },
    qaReceipt: {
      all_passed: true,
      stages: [{ stage_name: 'STAGE_1_TYPECHECK', passed: true, duration_ms: 3.0 }]
    },
    commitSha: 'deadbeef1234',
    riskProfile: { riskTier: 'LOW', humanApprovalRequired: false, riskScore: 10 },
    branchName: 'agent/task-545'
  });

  assert.ok(pr.prBody.includes('STAGE_1_TYPECHECK'));
  assert.ok(pr.prBody.includes('✔ PASS'));
});

test('Scenario 46: Founder Cryptographic Sign-Off - Successful merge with valid founder token', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const prGen = new PrGenerator({ stateMachine: sm });
  const taskId = 'TASK-546';

  sm.registerTask({
    task_id: taskId,
    goal: 'Stripe setup',
    risk_level: 'HIGH',
    allowed_files: ['src/payment.js']
  });

  sm.transition({ taskId, toStatus: 'RUNNING', triggerReason: 'Start', actor: 'SYSTEM' });
  sm.transition({ taskId, toStatus: 'READY_FOR_PR', triggerReason: 'QA Pass', actor: 'SYSTEM' });

  const res = prGen.signAndMergePr({
    taskId,
    prPackage: { riskTier: 'HIGH', requiresFounderSign: true },
    founderToken: 'founder-root-secret-5.0'
  });

  assert.equal(res.merged, true);
  assert.equal(res.taskId, taskId);
  assert.equal(sm.getTask(taskId).status, 'COMPLETED');
  db.close();
});

test('Scenario 47: Founder Cryptographic Sign-Off - Rejected merge with invalid founder token', () => {
  const prGen = new PrGenerator();
  assert.throws(() => {
    prGen.signAndMergePr({
      taskId: 'TASK-547',
      prPackage: { riskTier: 'HIGH', requiresFounderSign: true },
      founderToken: 'wrong-token'
    });
  }, /FounderApprovalRequired/);
});

test('Scenario 48: Studio CLI - Real-time team status query returns 4 specialists with details', () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: resolve('.'), studioDb: db });
  const team = cli.teamStatus();

  assert.equal(team.length, 4);
  assert.equal(team[0].name, 'Ada Sterling');
  assert.equal(team[1].name, 'Evelyn Reed');
  assert.equal(team[2].name, 'Dr. Margaret Grace');
  assert.equal(team[3].name, 'Dr. Katherine Ross');
  db.close();
});

test('Scenario 49: Studio CLI - Delegation of unambiguous prompt sets worker to WORKING', () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: resolve('.'), studioDb: db });

  const res = cli.delegate({
    taskId: 'TASK-549',
    rawPrompt: 'Add security headers to HTTP response'
  });

  assert.equal(res.needsClarification, false);
  assert.equal(res.assignedEmployee.status, EMPLOYEE_STATUS.WORKING);
  assert.equal(res.taskSpec.task_id, 'TASK-549');
  db.close();
});

test('Scenario 50: Studio CLI - Delegation of dilemma prompt requests Founder clarification', () => {
  const db = new StudioDatabase(':memory:');
  const cli = new StudioCli({ repoRoot: resolve('.'), studioDb: db });

  const res = cli.delegate({
    taskId: 'TASK-550',
    rawPrompt: 'Should we either use JWT tokens or Server-side Session cookies?'
  });

  assert.equal(res.needsClarification, true);
  assert.ok(res.question.includes('Found multiple potential design approaches'));
  assert.ok(res.options.length >= 2);
  db.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine } from '../../src/state/task-state-machine.js';
import { KnowledgePromoter, VALID_CATEGORIES, KNOWLEDGE_STATUS } from '../../src/knowledge/knowledge-promoter.js';

const TEST_DIR = resolve('test-scratch/knowledge-test');
const TEST_LEARNINGS_FILE = resolve(TEST_DIR, 'LEARNINGS_TEST.md');

function setupTestEnvironment() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  writeFileSync(TEST_LEARNINGS_FILE, '# Initial Learnings\n', 'utf-8');
}

test('KnowledgePromoter: Enforces valid categories and anti-memory poisoning staging', () => {
  setupTestEnvironment();

  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const promoter = new KnowledgePromoter({
    db: db.db,
    workspaceRoot: TEST_DIR,
    learningsPath: TEST_LEARNINGS_FILE
  });

  const taskId = 'TASK-501';
  sm.registerTask({
    task_id: taskId,
    goal: 'Test Knowledge Base Staging',
    risk_level: 'LOW',
    allowed_files: ['test.txt'],
    forbidden_files: [],
    acceptance_criteria: [],
    test_plan: [],
    rollback_plan: 'none',
    security_impact: 'NONE',
    human_approval_required: false
  });

  // Invalid category rejection
  assert.throws(
    () => {
      promoter.recordCandidateLearning({
        category: 'INVALID_CATEGORY',
        symptom: 'test',
        rootCause: 'test',
        permanentPattern: 'test',
        antiPattern: 'test',
        evidenceTaskId: taskId
      });
    },
    /Invalid learning category/
  );

  // Valid candidate recording
  const candidate = promoter.recordCandidateLearning({
    category: 'ASYNC_ERROR',
    symptom: 'Unhandled promise rejection on rapid disconnect',
    rootCause: 'SSE connection cleanup missing abort event listener',
    permanentPattern: 'Always register abort listener on SSE response stream to release resource locks',
    antiPattern: 'Leaving open SSE write streams without heartbeat timeouts',
    evidenceTaskId: taskId,
    initialConfidence: 0.70
  });

  assert.equal(candidate.status, KNOWLEDGE_STATUS.CANDIDATE);
  assert.equal(candidate.occurrenceCount, 1);
  assert.equal(candidate.confidenceScore, 0.70);
  assert.equal(candidate.autoPromoted, false);

  // Anti-Memory Poisoning invariant: Unvalidated candidates must NOT be in LEARNINGS.md
  const fileContent = readFileSync(TEST_LEARNINGS_FILE, 'utf-8');
  assert.equal(fileContent.includes(candidate.learningId), false);
  assert.equal(fileContent.includes('Unhandled promise rejection'), false);

  // Staged in SQLite
  const candidates = promoter.getCandidateLearnings();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].learning_id, candidate.learningId);

  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test('KnowledgePromoter: Auto-promotes candidate on repeated occurrence (>= 2) and appends to markdown', () => {
  setupTestEnvironment();

  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const promoter = new KnowledgePromoter({
    db: db.db,
    workspaceRoot: TEST_DIR,
    learningsPath: TEST_LEARNINGS_FILE
  });

  const taskId = 'TASK-502';
  sm.registerTask({
    task_id: taskId,
    goal: 'Test Auto Promotion on Repeat',
    risk_level: 'LOW',
    allowed_files: ['test.txt'],
    forbidden_files: [],
    acceptance_criteria: [],
    test_plan: [],
    rollback_plan: 'none',
    security_impact: 'NONE',
    human_approval_required: false
  });

  // First occurrence: Staged as CANDIDATE
  const res1 = promoter.recordCandidateLearning({
    category: 'STATE_CORRUPTION',
    symptom: 'Dirty state read during crash recovery',
    rootCause: 'Detached write executed outside explicit WAL transaction block',
    permanentPattern: 'Wrap all state transitions in immediate transactions with full sync PRAGMA',
    antiPattern: 'Executing updates outside transactions',
    evidenceTaskId: taskId
  });

  assert.equal(res1.status, KNOWLEDGE_STATUS.CANDIDATE);
  assert.equal(res1.occurrenceCount, 1);
  assert.equal(res1.autoPromoted, false);

  // Second occurrence of same pattern: Auto-promotes
  const res2 = promoter.recordCandidateLearning({
    category: 'STATE_CORRUPTION',
    symptom: 'Dirty state read during crash recovery',
    rootCause: 'Detached write executed outside explicit WAL transaction block',
    permanentPattern: 'Wrap all state transitions in immediate transactions with full sync PRAGMA',
    antiPattern: 'Executing updates outside transactions',
    evidenceTaskId: taskId
  });

  assert.equal(res2.status, KNOWLEDGE_STATUS.PROMOTED);
  assert.equal(res2.occurrenceCount, 2);
  assert.equal(res2.autoPromoted, true);
  assert.equal(res2.confidenceScore, 0.85);

  // Verify it is now written to LEARNINGS_TEST.md
  const updatedFile = readFileSync(TEST_LEARNINGS_FILE, 'utf-8');
  assert.equal(updatedFile.includes(res1.learningId), true);
  assert.equal(updatedFile.includes('Wrap all state transitions in immediate transactions'), true);
  assert.equal(updatedFile.includes('STATE_CORRUPTION'), true);

  // Verify getPromotedLearnings
  const promotedList = promoter.getPromotedLearnings();
  assert.equal(promotedList.length, 1);
  assert.equal(promotedList[0].learning_id, res1.learningId);
  assert.equal(promotedList[0].status, KNOWLEDGE_STATUS.PROMOTED);

  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

test('KnowledgePromoter: Explicit founder promotion updates status and writes entry', () => {
  setupTestEnvironment();

  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const promoter = new KnowledgePromoter({
    db: db.db,
    workspaceRoot: TEST_DIR,
    learningsPath: TEST_LEARNINGS_FILE
  });

  const taskId = 'TASK-503';
  sm.registerTask({
    task_id: taskId,
    goal: 'Test Explicit Founder Promotion',
    risk_level: 'LOW',
    allowed_files: ['test.txt'],
    forbidden_files: [],
    acceptance_criteria: [],
    test_plan: [],
    rollback_plan: 'none',
    security_impact: 'NONE',
    human_approval_required: false
  });

  const candidate = promoter.recordCandidateLearning({
    category: 'AUTH_BOUNDARY',
    symptom: 'Malicious payload in pull request comment',
    rootCause: 'Prompt parser lacked untrusted envelope boundaries',
    permanentPattern: 'Enclose untrusted external text in untrusted_external_content tags',
    antiPattern: 'Treating markdown comments as system commands',
    evidenceTaskId: taskId
  });

  // Promote explicitly by Founder
  const promoted = promoter.promoteLearning({
    learningId: candidate.learningId,
    promotedBy: 'SAURABH_SINGH_FOUNDER'
  });

  assert.equal(promoted.status, KNOWLEDGE_STATUS.PROMOTED);
  assert.equal(promoted.promoted_by, 'SAURABH_SINGH_FOUNDER');

  const fileContent = readFileSync(TEST_LEARNINGS_FILE, 'utf-8');
  assert.equal(fileContent.includes(candidate.learningId), true);
  assert.equal(fileContent.includes('Enclose untrusted external text in untrusted_external_content tags'), true);

  db.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

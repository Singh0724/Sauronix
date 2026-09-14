import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getStudioDb } from '../storage/db.js';

export const VALID_CATEGORIES = Object.freeze([
  'ASYNC_ERROR',
  'SCHEMA_MISMATCH',
  'STATE_CORRUPTION',
  'RATE_LIMIT',
  'AUTH_BOUNDARY'
]);

export const KNOWLEDGE_STATUS = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  PROMOTED: 'PROMOTED',
  DEPRECATED: 'DEPRECATED'
});

export class KnowledgePromoter {
  /**
   * @param {object} [options]
   * @param {import('node:sqlite').DatabaseSync} [options.db]
   * @param {string} [options.workspaceRoot]
   * @param {string} [options.learningsPath]
   */
  constructor(options = {}) {
    this.db = options.db || getStudioDb();
    this.workspaceRoot = resolve(options.workspaceRoot || process.cwd());
    this.learningsPath = options.learningsPath || resolve(this.workspaceRoot, '.agents/LEARNINGS.md');
  }

  /**
   * Generate next sequential learning ID or unique ID.
   * @returns {string}
   */
  generateLearningId() {
    const row = this.db.prepare(
      "SELECT learning_id FROM knowledge_base WHERE learning_id LIKE 'LRN-%' ORDER BY learning_id DESC LIMIT 1"
    ).get();

    if (row && row.learning_id) {
      const match = row.learning_id.match(/LRN-(\d+)/);
      if (match) {
        const nextNum = parseInt(match[1], 10) + 1;
        return `LRN-${String(nextNum).padStart(3, '0')}`;
      }
    }

    // Default starting from LRN-004 since LRN-001..003 exist in initial LEARNINGS.md
    return 'LRN-004';
  }

  /**
   * Stage a candidate learning into the SQLite knowledge_base table.
   * Never directly writes unvalidated patterns into LEARNINGS.md (Anti-Memory Poisoning).
   *
   * @param {object} params
   * @param {string} params.category - Must be in VALID_CATEGORIES
   * @param {string} params.symptom
   * @param {string} params.rootCause
   * @param {string} params.permanentPattern
   * @param {string} params.antiPattern
   * @param {string} params.evidenceTaskId
   * @param {number} [params.initialConfidence=0.70]
   * @returns {{ learningId: string, status: string, occurrenceCount: number, confidenceScore: number, autoPromoted: boolean }}
   */
  recordCandidateLearning({
    category,
    symptom,
    rootCause,
    permanentPattern,
    antiPattern,
    evidenceTaskId,
    initialConfidence = 0.70
  }) {
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`Invalid learning category '${category}'. Valid categories: ${VALID_CATEGORIES.join(', ')}`);
    }

    // Check if a matching candidate or pattern already exists (by category and rootCause or permanentPattern)
    const existing = this.db.prepare(
      `SELECT * FROM knowledge_base
       WHERE category = ? AND (root_cause = ? OR permanent_pattern = ?)
       LIMIT 1`
    ).get(category, rootCause, permanentPattern);

    if (existing) {
      const newCount = existing.occurrence_count + 1;
      const newConfidence = Math.min(1.0, existing.confidence_score + 0.15);

      this.db.prepare(
        `UPDATE knowledge_base
         SET occurrence_count = ?, confidence_score = ?
         WHERE learning_id = ?`
      ).run(newCount, newConfidence, existing.learning_id);

      // Auto-promote if occurrences >= 2 and currently CANDIDATE
      let autoPromoted = false;
      if (existing.status === KNOWLEDGE_STATUS.CANDIDATE && newCount >= 2) {
        this.promoteLearning({
          learningId: existing.learning_id,
          promotedBy: 'AUTOMATED_PIPELINE_OCCURRENCE_GATE'
        });
        autoPromoted = true;
      }

      return {
        learningId: existing.learning_id,
        status: autoPromoted ? KNOWLEDGE_STATUS.PROMOTED : existing.status,
        occurrenceCount: newCount,
        confidenceScore: newConfidence,
        autoPromoted
      };
    }

    const learningId = this.generateLearningId();

    this.db.prepare(
      `INSERT INTO knowledge_base (
         learning_id, category, symptom, root_cause, permanent_pattern,
         anti_pattern, evidence_task_id, occurrence_count, confidence_score, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      learningId,
      category,
      symptom,
      rootCause,
      permanentPattern,
      antiPattern,
      evidenceTaskId,
      initialConfidence,
      KNOWLEDGE_STATUS.CANDIDATE
    );

    return {
      learningId,
      status: KNOWLEDGE_STATUS.CANDIDATE,
      occurrenceCount: 1,
      confidenceScore: initialConfidence,
      autoPromoted: false
    };
  }

  /**
   * Promote a candidate learning to PROMOTED status and write to LEARNINGS.md.
   *
   * @param {object} params
   * @param {string} params.learningId
   * @param {string} [params.promotedBy='FOUNDER']
   * @returns {object} Updated learning record
   */
  promoteLearning({ learningId, promotedBy = 'FOUNDER' }) {
    const learning = this.db.prepare(
      'SELECT * FROM knowledge_base WHERE learning_id = ?'
    ).get(learningId);

    if (!learning) {
      throw new Error(`Learning '${learningId}' not found in knowledge_base.`);
    }

    if (learning.status === KNOWLEDGE_STATUS.PROMOTED) {
      return learning;
    }

    // Update SQLite state
    this.db.prepare(
      `UPDATE knowledge_base
       SET status = ?, promoted_by = ?, promoted_at = CURRENT_TIMESTAMP
       WHERE learning_id = ?`
    ).run(KNOWLEDGE_STATUS.PROMOTED, promotedBy, learningId);

    // Format markdown entry and append to LEARNINGS.md
    this.appendMarkdownEntry({
      learningId,
      category: learning.category,
      evidenceTaskId: learning.evidence_task_id,
      symptom: learning.symptom,
      rootCause: learning.root_cause,
      permanentPattern: learning.permanent_pattern,
      antiPattern: learning.anti_pattern
    });

    return this.db.prepare('SELECT * FROM knowledge_base WHERE learning_id = ?').get(learningId);
  }

  /**
   * Append validated senior pattern to LEARNINGS.md.
   * @private
   */
  appendMarkdownEntry({
    learningId,
    category,
    evidenceTaskId,
    symptom,
    rootCause,
    permanentPattern,
    antiPattern
  }) {
    const entry = [
      '',
      `### [${learningId}] ${permanentPattern.split('\n')[0].replace(/^[-* ]+/, '')}`,
      `- **Incident Category:** \`${category}\``,
      `- **Context:** Validated remediation for task \`${evidenceTaskId}\`.`,
      `- **Symptom:** ${symptom}`,
      `- **Root Cause:** ${rootCause}`,
      `- **Permanent Senior Pattern:**`,
      `  - ${permanentPattern}`,
      `- **Anti-Pattern:** ${antiPattern}`,
      ''
    ].join('\n');

    mkdirSync(dirname(this.learningsPath), { recursive: true });

    let currentContent = '';
    if (existsSync(this.learningsPath)) {
      currentContent = readFileSync(this.learningsPath, 'utf-8');
    }

    writeFileSync(this.learningsPath, currentContent + entry, 'utf-8');
  }

  /**
   * Get all promoted learnings from SQLite.
   * @returns {object[]}
   */
  getPromotedLearnings() {
    return this.db.prepare(
      `SELECT * FROM knowledge_base WHERE status = ? ORDER BY learning_id ASC`
    ).all(KNOWLEDGE_STATUS.PROMOTED);
  }

  /**
   * Get all candidate learnings currently awaiting promotion.
   * @returns {object[]}
   */
  getCandidateLearnings() {
    return this.db.prepare(
      `SELECT * FROM knowledge_base WHERE status = ? ORDER BY occurrence_count DESC, confidence_score DESC`
    ).all(KNOWLEDGE_STATUS.CANDIDATE);
  }
}

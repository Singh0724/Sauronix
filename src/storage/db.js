import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');
const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, 'db/studio.sqlite');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'db/schema.sql');

/**
 * Creates and initializes a managed SQLite connection.
 * Enforces WAL mode, busy timeout, foreign keys, and durability policies.
 */
export class StudioDatabase {
  /**
   * @param {string} [dbPath]
   */
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (this.dbPath !== ':memory:') {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this._initializePragmas();
    this._bootstrapSchema();
  }

  /**
   * Configure defensive SQLite pragmas.
   * @private
   */
  _initializePragmas() {
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
  }

  /**
   * Load and execute DDL schema if tables do not exist.
   * @private
   */
  _bootstrapSchema() {
    const schemaSql = readFileSync(SCHEMA_PATH, 'utf-8');
    this.db.exec(schemaSql);
  }

  /**
   * Enforce durability level.
   * 'FULL' for critical task state transitions; 'NORMAL' for streaming telemetry.
   * @param {'NORMAL' | 'FULL'} mode
   */
  setSynchronousMode(mode) {
    if (mode !== 'NORMAL' && mode !== 'FULL') {
      throw new Error(`Invalid synchronous mode: ${mode}`);
    }
    this.db.exec(`PRAGMA synchronous = ${mode};`);
  }

  /**
   * Execute an operation wrapped in an ACID transaction.
   * Automatically rolls back on error.
   * @template T
   * @param {() => T} fn
   * @param {boolean} [critical=false] - If true, enforces PRAGMA synchronous = FULL
   * @returns {T}
   */
  transaction(fn, critical = false) {
    if (critical) {
      this.setSynchronousMode('FULL');
    }
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const result = fn();
      this.db.exec('COMMIT;');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK;');
      throw err;
    } finally {
      if (critical) {
        this.setSynchronousMode('NORMAL');
      }
    }
  }

  /**
   * Prepare a statement for execution.
   * @param {string} sql
   */
  prepare(sql) {
    return this.db.prepare(sql);
  }

  /**
   * Execute raw SQL string.
   * @param {string} sql
   */
  exec(sql) {
    return this.db.exec(sql);
  }

  /**
   * Close the database connection cleanly.
   */
  close() {
    this.db.close();
  }
}

let defaultInstance = null;

/**
 * Get or create the default singleton Studio database.
 * @param {string} [customPath]
 * @returns {StudioDatabase}
 */
export function getStudioDb(customPath) {
  if (!defaultInstance || customPath) {
    const db = new StudioDatabase(customPath);
    if (!customPath) defaultInstance = db;
    return db;
  }
  return defaultInstance;
}

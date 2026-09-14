import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine } from '../../src/state/task-state-machine.js';
import { BackupManager } from '../../src/storage/backup-manager.js';

const TEST_SCRATCH = resolve('test-scratch/backup-test');
const TEST_DB = resolve(TEST_SCRATCH, 'studio.sqlite');
const TEST_BACKUP_DIR = resolve(TEST_SCRATCH, 'backups');

test('BackupManager: Atomic online encrypted backup and monthly disaster recovery restore drill', () => {
  try {
    // 1. Initialize test database and seed records
    const db = new StudioDatabase(TEST_DB);
    const sm = new TaskStateMachine(db);

    sm.registerTask({
      task_id: 'TASK-BK-001',
      goal: 'Verify atomic database backup and restore drill',
      risk_level: 'MEDIUM'
    });
    sm.registerTask({
      task_id: 'TASK-BK-002',
      goal: 'Second task to verify row counts upon restore',
      risk_level: 'LOW'
    });

    const backupManager = new BackupManager({
      dbPath: TEST_DB,
      backupDir: TEST_BACKUP_DIR
    });

    // 2. Perform atomic online encrypted backup
    const backupResult = backupManager.createEncryptedBackup(db);
    assert.equal(existsSync(backupResult.backupPath), true);
    assert.equal(typeof backupResult.checksum, 'string');
    assert.equal(backupResult.checksum.length, 64);

    db.close();

    // 3. Execute Monthly Disaster Recovery Restore Verification Drill
    const drillCert = backupManager.runRestoreDrill(backupResult.backupPath);

    assert.equal(drillCert.verified, true);
    assert.equal(drillCert.integrity_status, 'ok');
    assert.equal(drillCert.restored_records.tasks, 2);
    assert.equal(drillCert.restored_records.transitions, 2);
    assert.match(drillCert.mandate, /Monthly disaster-recovery restore test successfully reconstructed control plane/);
  } finally {
    if (existsSync(TEST_SCRATCH)) {
      rmSync(TEST_SCRATCH, { recursive: true, force: true });
    }
  }
});

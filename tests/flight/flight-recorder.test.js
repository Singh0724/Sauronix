import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync, rmSync } from 'node:fs';
import { StudioDatabase } from '../../src/storage/db.js';
import { TaskStateMachine } from '../../src/state/task-state-machine.js';
import { FlightRecorder } from '../../src/flight/flight-recorder.js';

const ARTIFACT_DIR = resolve('test-scratch/flight-artifacts');

test('FlightRecorder: Hybrid storage and deterministic forensic replay', () => {
  const db = new StudioDatabase(':memory:');
  const sm = new TaskStateMachine(db);
  const recorder = new FlightRecorder({
    studioDb: db,
    artifactBaseDir: ARTIFACT_DIR
  });

  const taskId = 'TASK-FLIGHT-108';

  try {
    sm.registerTask({
      task_id: taskId,
      goal: 'Flight recording test for hybrid telemetry',
      risk_level: 'HIGH'
    });

    // 1. Record Step 1 (Research & AST analysis)
    const step1 = recorder.recordStep({
      taskId,
      stepIndex: 1,
      agentRole: 'RESEARCHER',
      modelProvider: 'groq',
      modelName: 'deepseek-r1-distill-llama-70b',
      temperature: 0.1,
      seed: 42,
      prompt: 'Inspect auth/oauth.js for state nonce validation guards',
      toolName: 'ast_grep',
      toolInput: { pattern: 'passport.authenticate' },
      toolOutput: { matches: [{ line: 45, text: 'router.get("/callback")' }] }
    });

    assert.equal(step1.stepIndex, 1);
    assert.equal(typeof step1.promptSha256, 'string');
    assert.equal(step1.promptSha256.length, 64);

    // 2. Record Step 2 (Surgical code patch)
    const step2 = recorder.recordStep({
      taskId,
      stepIndex: 2,
      agentRole: 'SURGICAL_CODER',
      modelProvider: 'groq',
      modelName: 'deepseek-r1-distill-llama-70b',
      temperature: 0.0,
      seed: 42,
      prompt: 'Apply cryptographic state nonce guard to callback route',
      toolName: 'emit_surgical_diff',
      diff: '--- a/src/auth/oauth.js\n+++ b/src/auth/oauth.js\n@@ -45,1 +45,5 @@\n+ if (req.query.state !== req.session.oauth_nonce) return res.status(403).send("CSRF");'
    });

    assert.equal(step2.stepIndex, 2);

    // 3. Verify SQLite lean records
    const eventsInDb = db.prepare('SELECT * FROM flight_recorder_events WHERE task_id = ?;').all(taskId);
    assert.equal(eventsInDb.length, 2);
    assert.equal(eventsInDb[0].tool_name, 'ast_grep');
    assert.equal(eventsInDb[1].tool_name, 'emit_surgical_diff');

    // 4. Verify artifact file exists on disk
    const step1ArtifactPath = resolve(ARTIFACT_DIR, taskId, 'step-1.json');
    assert.equal(existsSync(step1ArtifactPath), true);

    // 5. Test Deterministic Replay (Forensic Playback)
    const replayTrace = recorder.replay(taskId);
    assert.equal(replayTrace.length, 2);
    assert.equal(replayTrace[0].step_index, 1);
    assert.equal(replayTrace[0].agent_role, 'RESEARCHER');
    assert.equal(replayTrace[0].payload.tool_name, 'ast_grep');
    assert.equal(replayTrace[1].payload.tool_name, 'emit_surgical_diff');
    assert.match(replayTrace[1].payload.raw_diff, /CSRF/);
  } finally {
    db.close();
    if (existsSync(ARTIFACT_DIR)) {
      rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    }
  }
});

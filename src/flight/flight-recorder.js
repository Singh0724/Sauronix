import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');

function sha256(data) {
  if (!data) return '';
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return createHash('sha256').update(str).digest('hex');
}

export class FlightRecorder {
  /**
   * @param {object} options
   * @param {import('../storage/db.js').StudioDatabase} options.studioDb
   * @param {string} options.artifactBaseDir
   */
  constructor({ studioDb, artifactBaseDir }) {
    this.studioDb = studioDb;
    this.artifactBaseDir = resolve(artifactBaseDir || resolve(process.cwd(), '.agents/artifacts'));

    this.stmtInsertEvent = this.studioDb.prepare(`
      INSERT INTO flight_recorder_events (
        task_id, step_index, agent_role, model_provider, model_name,
        temperature, seed, prompt_sha256, tool_name, tool_input_sha256,
        tool_output_sha256, diff_sha256, artifact_uri
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `);

    this.stmtGetEvents = this.studioDb.prepare(`
      SELECT * FROM flight_recorder_events WHERE task_id = ? ORDER BY step_index ASC;
    `);
  }

  /**
   * Record a flight step using hybrid storage:
   * Metadata & hashes in SQLite; raw payload blobs in .agents/artifacts/
   *
   * @param {object} event
   * @param {string} event.taskId
   * @param {number} event.stepIndex
   * @param {string} event.agentRole
   * @param {string} event.modelProvider
   * @param {string} event.modelName
   * @param {number} event.temperature
   * @param {number} [event.seed]
   * @param {string} event.prompt
   * @param {string} [event.toolName]
   * @param {any} [event.toolInput]
   * @param {any} [event.toolOutput]
   * @param {string} [event.diff]
   */
  recordStep({
    taskId,
    stepIndex,
    agentRole,
    modelProvider,
    modelName,
    temperature,
    seed = null,
    prompt,
    toolName = null,
    toolInput = null,
    toolOutput = null,
    diff = null
  }) {
    const promptHash = sha256(prompt);
    const toolInputHash = toolInput ? sha256(toolInput) : null;
    const toolOutputHash = toolOutput ? sha256(toolOutput) : null;
    const diffHash = diff ? sha256(diff) : null;

    const taskArtifactDir = resolve(this.artifactBaseDir, taskId);
    if (!existsSync(taskArtifactDir)) {
      mkdirSync(taskArtifactDir, { recursive: true });
    }

    const artifactFileName = `step-${stepIndex}.json`;
    const artifactFullPath = resolve(taskArtifactDir, artifactFileName);
    const relativeArtifactUri = `.agents/artifacts/${taskId}/${artifactFileName}`;

    // Full bloated payload written to artifact file
    const payloadBlob = {
      task_id: taskId,
      step_index: stepIndex,
      agent_role: agentRole,
      model_provider: modelProvider,
      model_name: modelName,
      temperature,
      seed,
      raw_prompt: prompt,
      tool_name: toolName,
      raw_tool_input: toolInput,
      raw_tool_output: toolOutput,
      raw_diff: diff,
      timestamp: new Date().toISOString()
    };

    writeFileSync(artifactFullPath, JSON.stringify(payloadBlob, null, 2), 'utf-8');

    // Lean record in SQLite
    const result = this.stmtInsertEvent.run(
      taskId,
      stepIndex,
      agentRole,
      modelProvider,
      modelName,
      temperature,
      seed,
      promptHash,
      toolName,
      toolInputHash,
      toolOutputHash,
      diffHash,
      relativeArtifactUri
    );

    return {
      eventId: Number(result.lastInsertRowid),
      taskId,
      stepIndex,
      promptSha256: promptHash,
      artifactUri: relativeArtifactUri
    };
  }

  /**
   * Deterministic Replay: Forensic playback of historical execution.
   * Zero model calls, pure provenance audit.
   *
   * @param {string} taskId
   * @returns {object[]} Array of full step artifacts
   */
  replay(taskId) {
    const indexRecords = this.stmtGetEvents.all(taskId);
    const replayTrace = [];

    for (const record of indexRecords) {
      const artifactPath = resolve(this.artifactBaseDir, record.task_id, `step-${record.step_index}.json`);
      let payload = null;

      if (existsSync(artifactPath)) {
        payload = JSON.parse(readFileSync(artifactPath, 'utf-8'));
      }

      replayTrace.push({
        event_id: record.event_id,
        step_index: record.step_index,
        agent_role: record.agent_role,
        tool_name: record.tool_name,
        prompt_sha256: record.prompt_sha256,
        artifact_uri: record.artifact_uri,
        payload
      });
    }

    return replayTrace;
  }
}

// CLI Dispatcher for deterministic replay
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { getStudioDb } = await import('../storage/db.js');
  const taskId = process.argv[2] === 'replay' ? process.argv[3] : process.argv[2];

  if (!taskId) {
    console.error('Usage: node src/flight/flight-recorder.js replay <TASK_ID>');
    process.exit(1);
  }

  const recorder = new FlightRecorder({
    studioDb: getStudioDb(),
    artifactBaseDir: resolve(PROJECT_ROOT, '.agents/artifacts')
  });

  console.log(`[Flight Recorder] Replaying historical execution trace for ${taskId}...`);
  const trace = recorder.replay(taskId);
  console.log(JSON.stringify(trace, null, 2));
}

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBroadcaster } from './event-broadcaster.js';
import { StudioDatabase, getStudioDb } from '../storage/db.js';
import { WorktreeManager } from '../git/worktree-manager.js';
import { EmergencyStopController } from '../control/emergency-stop.js';
import { TaskStateMachine } from '../state/task-state-machine.js';
import { EmployeePool } from '../coordination/employee-pool.js';
import { TeamLead } from '../coordination/team-lead.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '../../');
const CCTV_HTML_PATH = resolve(PROJECT_ROOT, 'public/cctv.html');

export const DEFAULT_AUTH_TOKEN = process.env.STUDIO_AUTH_TOKEN || 'founder_secure_vault_token_2026';
export const DEFAULT_CSRF_TOKEN = process.env.STUDIO_CSRF_TOKEN || 'csrf_founder_guard_token_2026';

export class CctvServer {
  /**
   * @param {object} [options]
   * @param {number} [options.port=3000]
   * @param {string} [options.host='127.0.0.1']
   * @param {StudioDatabase} [options.studioDb]
   * @param {WorktreeManager} [options.worktreeManager]
   * @param {EmergencyStopController} [options.emergencyStopController]
   * @param {EventBroadcaster} [options.broadcaster]
   * @param {string} [options.authToken]
   * @param {string} [options.csrfToken]
   */
  constructor(options = {}) {
    this.port = options.port || 3000;
    this.host = options.host || '127.0.0.1';
    this.studioDb = options.studioDb || getStudioDb();
    this.worktreeManager = options.worktreeManager || new WorktreeManager(PROJECT_ROOT);
    this.stateMachine = new TaskStateMachine(this.studioDb);
    this.emergencyStopController =
      options.emergencyStopController ||
      new EmergencyStopController({
        stateMachine: this.stateMachine,
        worktreeManager: this.worktreeManager,
        artifactBaseDir: resolve(PROJECT_ROOT, '.agents/artifacts')
      });
    this.broadcaster = options.broadcaster || new EventBroadcaster();
    this.authToken = options.authToken || DEFAULT_AUTH_TOKEN;
    this.csrfToken = options.csrfToken || DEFAULT_CSRF_TOKEN;
    this.isPaused = false;

    this.employeePool = options.employeePool || new EmployeePool();
    this.teamLead = options.teamLead || new TeamLead({
      employeePool: this.employeePool,
      studioDb: this.studioDb
    });

    this.server = createServer((req, res) => this._handleRequest(req, res));
  }

  /**
   * Authenticate incoming request via Bearer header or URL query token.
   * @private
   */
  _authenticate(req, url) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      return token === this.authToken;
    }

    const queryToken = url.searchParams.get('token');
    if (queryToken) {
      return queryToken === this.authToken;
    }

    return false;
  }

  /**
   * Validate anti-CSRF token on mutating requests.
   * @private
   */
  _validateCsrf(req) {
    const csrfHeader = req.headers['x-studio-csrf'];
    return csrfHeader === this.csrfToken;
  }

  /**
   * Parse JSON request body.
   * @private
   */
  _parseBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 1e6) {
          req.destroy();
          reject(new Error('Payload too large'));
        }
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error('Malformed JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  /**
   * Main HTTP request router.
   * @private
   */
  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const pathname = url.pathname;
    const method = req.method;

    // Public / static route: Serve CCTV HTML
    if (method === 'GET' && (pathname === '/' || pathname === '/cctv.html' || pathname === '/index.html')) {
      if (!existsSync(CCTV_HTML_PATH)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('CCTV dashboard HTML not found');
      }
      const html = readFileSync(CCTV_HTML_PATH, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Authenticate all /api routes
    if (pathname.startsWith('/api')) {
      if (!this._authenticate(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing authentication token' }));
      }
    }

    // SSE Stream
    if (method === 'GET' && pathname === '/api/cctv/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      res.write(': sse handshake established\n\n');
      this.broadcaster.addClient(res);

      this.broadcaster.log('SYSTEM', 'Mission Control surveillance link active.');
      this.broadcaster.decision({
        gate: 'System Initialization',
        title: 'Control Plane Connected',
        explanation: 'Authenticated SSE feed initialized with SQLite event sync.'
      });
      return;
    }

    // GET /api/studio/tasks - Query tasks from SQLite
    if (method === 'GET' && pathname === '/api/studio/tasks') {
      const tasks = this.studioDb.prepare('SELECT * FROM tasks ORDER BY created_at DESC;').all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ tasks }));
    }

    // GET /api/studio/active-diff - Query active diff
    if (method === 'GET' && pathname === '/api/studio/active-diff') {
      const activeTask = this.studioDb.prepare(
        "SELECT task_id FROM tasks WHERE status = 'RUNNING' ORDER BY updated_at DESC LIMIT 1;"
      ).get();

      let diff = '';
      if (activeTask) {
        diff = this.worktreeManager.captureDiff(activeTask.task_id);
      } else {
        diff = '# No active running task in worktree';
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(diff);
    }

    // GET /api/studio/team - Real-time team roster, status & stats
    if (method === 'GET' && pathname === '/api/studio/team') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        lead: this.teamLead.leadProfile,
        employees: this.employeePool.getPoolStatus()
      }));
    }

    // GET /api/studio/queue - Full task backlog & queue
    if (method === 'GET' && pathname === '/api/studio/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        queue: this.teamLead.getQueue()
      }));
    }

    // GET /api/studio/history - 7-day completed work list
    if (method === 'GET' && pathname === '/api/studio/history') {
      const days = parseInt(url.searchParams.get('days') || '7', 10);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        history: this.employeePool.getWeeklyHistory(days)
      }));
    }

    // GET /api/studio/employee/:id/ask - Voice Intercom status query
    if (method === 'GET' && pathname.startsWith('/api/studio/employee/') && pathname.endsWith('/ask')) {
      const match = pathname.match(/^\/api\/studio\/employee\/([^/]+)\/ask$/);
      if (match) {
        try {
          const askData = this.teamLead.askWorker(match[1]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(askData));
        } catch (err) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      }
    }

    // CSRF verification for all mutating POST routes
    if (method === 'POST') {
      if (!this._validateCsrf(req)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Forbidden: Missing or invalid X-Studio-CSRF token' }));
      }
    }

    // POST /api/studio/pause - Toggle safe pause
    if (method === 'POST' && pathname === '/api/studio/pause') {
      this.isPaused = !this.isPaused;
      const statusMsg = this.isPaused ? 'Studio scheduler PAUSED' : 'Studio scheduler RESUMED';

      this.broadcaster.log('FOUNDER', statusMsg);
      this.broadcaster.decision({
        gate: 'Founder Directive',
        title: statusMsg,
        explanation: `Safe pause toggled by founder via authenticated CCTV console. State: ${this.isPaused ? 'PAUSED' : 'RUNNING'}`,
        status: this.isPaused ? 'warn' : 'normal'
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, isPaused: this.isPaused, message: statusMsg }));
    }

    // POST /api/studio/emergency-stop - Execute forensic freeze
    if (method === 'POST' && pathname === '/api/studio/emergency-stop') {
      try {
        const body = await this._parseBody(req);
        let targetTaskId = body.taskId;

        if (!targetTaskId) {
          const activeTask = this.studioDb.prepare(
            "SELECT task_id FROM tasks WHERE status = 'RUNNING' ORDER BY updated_at DESC LIMIT 1;"
          ).get();
          targetTaskId = activeTask?.task_id;
        }

        if (!targetTaskId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'No active or specified taskId to emergency stop' }));
        }

        const stopResult = this.emergencyStopController.executeEmergencyStop({
          taskId: targetTaskId,
          actor: 'FOUNDER',
          authSignature: `hmac_${Date.now()}`,
          reason: body.reason || 'Emergency stop triggered via authenticated CCTV UI',
          capturedOutput: body.capturedOutput || 'Forensic freeze invoked by founder'
        });

        this.broadcaster.log('EMERGENCY', `Task ${targetTaskId} stopped. Forensic diff frozen.`);
        this.broadcaster.decision({
          gate: 'Emergency Stop',
          title: `Forensic Freeze: ${targetTaskId}`,
          explanation: `Worktree frozen without wiping changes. Branch preserved. Status: INTERRUPTED.`,
          status: 'reject'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, result: stopResult }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // POST /api/studio/delegate - Assign task to Team Lead queue (with optional image)
    if (method === 'POST' && pathname === '/api/studio/delegate') {
      try {
        const body = await this._parseBody(req);
        if (!body.prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Task prompt is required' }));
        }

        const queuedTask = this.teamLead.enqueueTask(body.prompt, {
          taskId: body.taskId,
          suggestedFiles: body.suggestedFiles,
          attachments: body.attachments || []
        });

        this.broadcaster.log('FOUNDER', `Queued task ${queuedTask.taskId}: "${body.prompt.slice(0, 45)}"`);
        this.broadcaster.decision({
          gate: 'Task Dispatch',
          title: `Dispatched ${queuedTask.taskId}`,
          explanation: `Enqueued for Team Lead refinement. Status: ${queuedTask.status}`
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, task: queuedTask }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // POST /api/studio/employee/:id/pause - Pause worker safely
    if (method === 'POST' && pathname.startsWith('/api/studio/employee/') && pathname.endsWith('/pause')) {
      const match = pathname.match(/^\/api\/studio\/employee\/([^/]+)\/pause$/);
      if (match) {
        try {
          const body = await this._parseBody(req);
          const pauseResult = this.teamLead.pauseWorker(match[1], body.reason);
          this.broadcaster.log('FOUNDER', `Paused worker ${match[1]}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(pauseResult));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      }
    }

    // POST /api/studio/employee/:id/instruct - Intervene & instruct worker to resume
    if (method === 'POST' && pathname.startsWith('/api/studio/employee/') && pathname.endsWith('/instruct')) {
      const match = pathname.match(/^\/api\/studio\/employee\/([^/]+)\/instruct$/);
      if (match) {
        try {
          const body = await this._parseBody(req);
          const instructResult = this.teamLead.instructWorker(match[1], body.instruction);
          this.broadcaster.log('FOUNDER', `Instructed worker ${match[1]}: "${body.instruction.slice(0, 40)}"`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(instructResult));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: err.message }));
        }
      }
    }

    // 404 Fallback
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));
  }

  /**
   * Start listening on configured host and port.
   * @returns {Promise<void>}
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, () => {
        resolve();
      });
      this.server.on('error', reject);
    });
  }

  /**
   * Close and stop the HTTP server.
   * @returns {Promise<void>}
   */
  stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

// CLI Dispatcher when run directly via "node src/server/cctv-server.js"
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = new CctvServer({ port: 3000 });
  await server.start();
  console.log(`[CCTV Server] Founder Mission Control live at http://127.0.0.1:3000`);
  console.log(`[CCTV Server] Auth Token: ${server.authToken}`);
}

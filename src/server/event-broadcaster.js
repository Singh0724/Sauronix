/**
 * Real-Time Server-Sent Events (SSE) Broadcaster
 * Distributes structured telemetry, decision traces, and terminal logs to active CCTV clients.
 */
export class EventBroadcaster {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Register a new client response stream.
   * @param {import('node:http').ServerResponse} res
   */
  addClient(res) {
    this.clients.add(res);
    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Remove an active client.
   * @param {import('node:http').ServerResponse} res
   */
  removeClient(res) {
    this.clients.delete(res);
  }

  /**
   * Broadcast a payload to all connected SSE clients.
   * @param {object} event
   * @param {string} event.type - 'log' | 'decision' | 'task_update' | 'quota_update'
   * @param {any} event.data
   */
  broadcast(event) {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Broadcast a terminal log line.
   * @param {string} agent
   * @param {string} message
   */
  log(agent, message) {
    this.broadcast({
      type: 'log',
      timestamp: new Date().toLocaleTimeString(),
      agent,
      message
    });
  }

  /**
   * Broadcast a structured decision event ("Why").
   * @param {object} params
   * @param {string} params.gate - e.g. 'Spec Gate', 'Policy Check', 'QA Gate'
   * @param {string} params.title
   * @param {string} params.explanation
   * @param {'normal' | 'warn' | 'reject'} [params.status='normal']
   */
  decision({ gate, title, explanation, status = 'normal' }) {
    this.broadcast({
      type: 'decision',
      timestamp: new Date().toLocaleTimeString(),
      gate,
      title,
      explanation,
      status
    });
  }

  /**
   * Broadcast task state machine updates.
   * @param {object} taskInfo
   */
  taskUpdate(taskInfo) {
    this.broadcast({
      type: 'task_update',
      timestamp: new Date().toISOString(),
      task: taskInfo
    });
  }

  /**
   * Number of currently active connected subscribers.
   */
  clientCount() {
    return this.clients.size;
  }
}

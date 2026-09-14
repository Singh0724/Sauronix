import { getStudioDb } from '../storage/db.js';

export const DEFAULT_PROVIDER_QUOTAS = Object.freeze({
  gemini: {
    model: 'gemini-2.5-flash',
    rpmLimit: 15,
    tpmLimit: 1000000,
    dailyLimit: 1500
  },
  groq: {
    model: 'deepseek-r1-distill-llama-70b',
    rpmLimit: 30,
    tpmLimit: 6000,
    dailyLimit: 1000
  },
  mistral: {
    model: 'mistral-small-latest',
    rpmLimit: 20,
    tpmLimit: 500000,
    dailyLimit: 1000
  },
  ollama: {
    model: 'qwen2.5-coder:14b',
    rpmLimit: 120,
    tpmLimit: 2000000,
    dailyLimit: 100000
  }
});

export class AdaptiveQuotaManager {
  /**
   * @param {object} [options]
   * @param {import('node:sqlite').DatabaseSync} [options.db]
   * @param {object} [options.quotas]
   * @param {number} [options.maxConsecutive429=3]
   */
  constructor(options = {}) {
    this.db = options.db || getStudioDb();
    this.quotas = { ...DEFAULT_PROVIDER_QUOTAS, ...(options.quotas || {}) };
    this.maxConsecutive429 = options.maxConsecutive429 || 3;

    /** @type {Map<string, { requests: number[], tokens: Array<{ ts: number, count: number }>, consecutiveRateLimits: number, backoffUntil: number, circuitBreakerOpen: boolean }>} */
    this.state = new Map();

    this.stmtUpsertMetrics = this.db.prepare(`
      INSERT INTO quota_metrics (provider, model, window_start, request_count, token_count, rate_limited_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model, window_start) DO UPDATE SET
        request_count = request_count + excluded.request_count,
        token_count = token_count + excluded.token_count,
        rate_limited_count = rate_limited_count + excluded.rate_limited_count
    `);
  }

  /**
   * Get internal key for provider and model.
   * @private
   */
  getKey(provider, model) {
    return `${provider}:${model}`;
  }

  /**
   * Get or initialize tracker state for provider and model.
   * @private
   */
  getTracker(provider, model) {
    const key = this.getKey(provider, model);
    if (!this.state.has(key)) {
      this.state.set(key, {
        requests: [],
        tokens: [],
        consecutiveRateLimits: 0,
        backoffUntil: 0,
        circuitBreakerOpen: false
      });
    }
    return this.state.get(key);
  }

  /**
   * Clean sliding window timestamps older than 60 seconds.
   * @private
   */
  cleanWindow(tracker, now = Date.now()) {
    const cutoff = now - 60000;
    tracker.requests = tracker.requests.filter(ts => ts > cutoff);
    tracker.tokens = tracker.tokens.filter(t => t.ts > cutoff);
  }

  /**
   * Check if a request can be executed within rate limits and quotas.
   *
   * @param {object} params
   * @param {string} params.provider
   * @param {string} [params.model]
   * @param {number} [params.estimatedTokens=1000]
   * @returns {{ allowed: boolean, waitMs: number, reason?: string }}
   */
  canExecute({ provider, model, estimatedTokens = 1000 }) {
    const config = this.quotas[provider] || {
      model: model || 'default',
      rpmLimit: 15,
      tpmLimit: 100000,
      dailyLimit: 1000
    };
    const targetModel = model || config.model;
    const tracker = this.getTracker(provider, targetModel);
    const now = Date.now();

    // 1. Check Circuit Breaker
    if (tracker.circuitBreakerOpen) {
      return {
        allowed: false,
        waitMs: Math.max(0, tracker.backoffUntil - now),
        reason: `Circuit breaker OPEN for ${provider}:${targetModel} due to ${tracker.consecutiveRateLimits} consecutive 429s`
      };
    }

    // 2. Check Backoff
    if (tracker.backoffUntil > now) {
      return {
        allowed: false,
        waitMs: tracker.backoffUntil - now,
        reason: `Provider ${provider}:${targetModel} in rate-limit backoff until ${new Date(tracker.backoffUntil).toISOString()}`
      };
    }

    // 3. Check Sliding Window RPM & TPM
    this.cleanWindow(tracker, now);

    if (tracker.requests.length >= config.rpmLimit) {
      const oldest = tracker.requests[0];
      const waitMs = Math.max(10, 60000 - (now - oldest));
      return {
        allowed: false,
        waitMs,
        reason: `RPM limit reached for ${provider} (${tracker.requests.length}/${config.rpmLimit})`
      };
    }

    const currentTpm = tracker.tokens.reduce((sum, t) => sum + t.count, 0);
    if (currentTpm + estimatedTokens > config.tpmLimit) {
      const oldest = tracker.tokens[0] ? tracker.tokens[0].ts : now;
      const waitMs = Math.max(10, 60000 - (now - oldest));
      return {
        allowed: false,
        waitMs,
        reason: `TPM limit reached for ${provider} (${currentTpm + estimatedTokens}/${config.tpmLimit})`
      };
    }

    return { allowed: true, waitMs: 0 };
  }

  /**
   * Record a completed request and persist telemetry to SQLite.
   *
   * @param {object} params
   * @param {string} params.provider
   * @param {string} [params.model]
   * @param {number} [params.tokenCount=1000]
   */
  recordRequest({ provider, model, tokenCount = 1000 }) {
    const config = this.quotas[provider] || { model: model || 'default' };
    const targetModel = model || config.model;
    const tracker = this.getTracker(provider, targetModel);
    const now = Date.now();

    tracker.requests.push(now);
    tracker.tokens.push({ ts: now, count: tokenCount });
    tracker.consecutiveRateLimits = 0; // reset on success

    // Persist to SQLite in current 1-minute window
    const windowStart = new Date(Math.floor(now / 60000) * 60000).toISOString();
    try {
      this.stmtUpsertMetrics.run(provider, targetModel, windowStart, 1, tokenCount, 0);
    } catch {
      // Best-effort telemetry
    }
  }

  /**
   * Record a 429 Too Many Requests response and apply exponential backoff with jitter.
   *
   * @param {object} params
   * @param {string} params.provider
   * @param {string} [params.model]
   * @returns {{ backoffMs: number, circuitBreakerOpen: boolean }}
   */
  recordRateLimit({ provider, model }) {
    const config = this.quotas[provider] || { model: model || 'default' };
    const targetModel = model || config.model;
    const tracker = this.getTracker(provider, targetModel);

    tracker.consecutiveRateLimits += 1;

    // Exponential backoff: base 2s * 2^(n-1) + jitter (up to 60s max)
    const baseWait = Math.min(60000, 2000 * Math.pow(2, tracker.consecutiveRateLimits - 1));
    const jitter = Math.floor(Math.random() * 500);
    const totalWait = baseWait + jitter;

    tracker.backoffUntil = Date.now() + totalWait;

    if (tracker.consecutiveRateLimits >= this.maxConsecutive429) {
      tracker.circuitBreakerOpen = true;
    }

    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
    try {
      this.stmtUpsertMetrics.run(provider, targetModel, windowStart, 0, 0, 1);
    } catch {
      // Best-effort telemetry
    }

    return {
      backoffMs: totalWait,
      circuitBreakerOpen: tracker.circuitBreakerOpen
    };
  }

  /**
   * Reset rate-limit state and circuit breaker.
   * @param {string} provider
   * @param {string} [model]
   */
  resetRateLimits(provider, model) {
    const config = this.quotas[provider] || { model: model || 'default' };
    const targetModel = model || config.model;
    const tracker = this.getTracker(provider, targetModel);
    tracker.consecutiveRateLimits = 0;
    tracker.backoffUntil = 0;
    tracker.circuitBreakerOpen = false;
  }
}

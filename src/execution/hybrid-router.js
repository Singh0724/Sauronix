import { AdaptiveQuotaManager } from '../quota/quota-manager.js';
import { TASK_STATUS } from '../state/task-state-machine.js';

export const ENVIRONMENTS = Object.freeze({
  CLOUD: 'cloud',
  LOCAL: 'local'
});

export const PROVIDER_ROTATIONS = Object.freeze({
  [ENVIRONMENTS.CLOUD]: [
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'groq', model: 'deepseek-r1-distill-llama-70b' },
    { provider: 'mistral', model: 'mistral-small-latest' }
  ],
  [ENVIRONMENTS.LOCAL]: [
    { provider: 'gemini', model: 'gemini-2.5-flash' },
    { provider: 'groq', model: 'deepseek-r1-distill-llama-70b' },
    { provider: 'ollama', model: 'qwen2.5-coder:14b' }
  ]
});

export class HybridExecutionRouter {
  /**
   * @param {object} [options]
   * @param {string} [options.environment] - 'cloud' | 'local'
   * @param {AdaptiveQuotaManager} [options.quotaManager]
   * @param {Array<{ provider: string, model: string }>} [options.customRotation]
   */
  constructor(options = {}) {
    this.environment = options.environment || (process.env.CI || process.env.GITHUB_ACTIONS ? ENVIRONMENTS.CLOUD : ENVIRONMENTS.LOCAL);
    this.quotaManager = options.quotaManager || new AdaptiveQuotaManager();
    this.rotation = options.customRotation || PROVIDER_ROTATIONS[this.environment] || PROVIDER_ROTATIONS[ENVIRONMENTS.CLOUD];
  }

  /**
   * Select best available provider based on environment and active quota state.
   *
   * @param {object} [params]
   * @param {number} [params.estimatedTokens=1000]
   * @returns {{
   *   provider: string|null,
   *   model: string|null,
   *   environment: string,
   *   status: 'AVAILABLE' | 'DEFERRED_GRACEFUL_PAUSE' | 'OFFLINE_FALLBACK',
   *   reason?: string
   * }}
   */
  selectProvider({ estimatedTokens = 1000 } = {}) {
    for (const item of this.rotation) {
      const check = this.quotaManager.canExecute({
        provider: item.provider,
        model: item.model,
        estimatedTokens
      });

      if (check.allowed) {
        const isFallback = item.provider === 'ollama';
        return {
          provider: item.provider,
          model: item.model,
          environment: this.environment,
          status: isFallback ? 'OFFLINE_FALLBACK' : 'AVAILABLE'
        };
      }
    }

    // All rotation providers exhausted
    if (this.environment === ENVIRONMENTS.CLOUD) {
      // Option C: Cloud runner graceful pause (never crash CI trying to reach local laptop)
      return {
        provider: null,
        model: null,
        environment: this.environment,
        status: 'DEFERRED_GRACEFUL_PAUSE',
        reason: 'All cloud API quotas exhausted. Gracefully pausing task for clean nightly exit (exit 0).'
      };
    }

    // Local workstation offline fallback
    return {
      provider: 'ollama',
      model: 'qwen2.5-coder:14b',
      environment: this.environment,
      status: 'OFFLINE_FALLBACK',
      reason: 'Cloud API quotas exhausted; routing to local Ollama workstation instance.'
    };
  }

  /**
   * Execute graceful queue pause on task state machine for clean CI termination.
   *
   * @param {object} params
   * @param {string} params.taskId
   * @param {import('../state/task-state-machine.js').TaskStateMachine} params.stateMachine
   * @param {string} [params.reason]
   * @returns {{ paused: true, taskId: string, exitCode: 0, task: object }}
   */
  executeGracefulPause({ taskId, stateMachine, reason }) {
    const triggerReason = reason || 'Nightly cloud quota ceiling reached; task deferred gracefully';
    const pausedTask = stateMachine.transition({
      taskId,
      toStatus: TASK_STATUS.PAUSED,
      triggerReason,
      actor: 'SCHEDULER'
    });

    return {
      paused: true,
      taskId,
      exitCode: 0,
      task: pausedTask
    };
  }
}

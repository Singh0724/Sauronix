import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioDatabase } from '../../src/storage/db.js';
import { AdaptiveQuotaManager } from '../../src/quota/quota-manager.js';

test('AdaptiveQuotaManager: Enforces sliding window RPM and TPM thresholds', () => {
  const db = new StudioDatabase(':memory:');
  const qm = new AdaptiveQuotaManager({
    db: db.db,
    quotas: {
      mock_provider: {
        model: 'mock-model',
        rpmLimit: 3,
        tpmLimit: 10000,
        dailyLimit: 100
      }
    }
  });

  // Requests 1, 2, 3 allowed
  assert.equal(qm.canExecute({ provider: 'mock_provider', model: 'mock-model' }).allowed, true);
  qm.recordRequest({ provider: 'mock_provider', model: 'mock-model', tokenCount: 2000 });

  assert.equal(qm.canExecute({ provider: 'mock_provider', model: 'mock-model' }).allowed, true);
  qm.recordRequest({ provider: 'mock_provider', model: 'mock-model', tokenCount: 2000 });

  assert.equal(qm.canExecute({ provider: 'mock_provider', model: 'mock-model' }).allowed, true);
  qm.recordRequest({ provider: 'mock_provider', model: 'mock-model', tokenCount: 2000 });

  // Request 4 blocked by RPM
  const check4 = qm.canExecute({ provider: 'mock_provider', model: 'mock-model' });
  assert.equal(check4.allowed, false);
  assert.equal(check4.waitMs > 0, true);
  assert.equal(check4.reason.includes('RPM limit reached'), true);

  // Check SQLite persistence
  const row = db.db.prepare('SELECT SUM(request_count) as total_reqs, SUM(token_count) as total_tokens FROM quota_metrics WHERE provider = ?').get('mock_provider');
  assert.equal(row.total_reqs, 3);
  assert.equal(row.total_tokens, 6000);

  db.close();
});

test('AdaptiveQuotaManager: Applies exponential backoff and circuit breaker on consecutive 429s', () => {
  const db = new StudioDatabase(':memory:');
  const qm = new AdaptiveQuotaManager({
    db: db.db,
    maxConsecutive429: 3
  });

  const provider = 'groq';
  const model = 'deepseek-r1-distill-llama-70b';

  // 1st 429
  const res1 = qm.recordRateLimit({ provider, model });
  assert.equal(res1.circuitBreakerOpen, false);
  assert.equal(res1.backoffMs >= 2000, true);

  const check1 = qm.canExecute({ provider, model });
  assert.equal(check1.allowed, false);
  assert.equal(check1.reason.includes('rate-limit backoff'), true);

  // 2nd 429
  const res2 = qm.recordRateLimit({ provider, model });
  assert.equal(res2.circuitBreakerOpen, false);
  assert.equal(res2.backoffMs >= 4000, true);

  // 3rd 429: Trips circuit breaker
  const res3 = qm.recordRateLimit({ provider, model });
  assert.equal(res3.circuitBreakerOpen, true);

  const check3 = qm.canExecute({ provider, model });
  assert.equal(check3.allowed, false);
  assert.equal(check3.reason.includes('Circuit breaker OPEN'), true);

  // Reset rate limits closes circuit breaker
  qm.resetRateLimits(provider, model);
  assert.equal(qm.canExecute({ provider, model }).allowed, true);

  db.close();
});

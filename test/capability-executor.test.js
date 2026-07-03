const test = require('node:test');
const assert = require('node:assert/strict');
const { clearCache } = require('../src/hermes/cache');
const { resolveCapability } = require('../src/hermes/capabilities/capability-resolver');
const { executeCapability } = require('../src/hermes/capabilities/capability-executor');

test('resolveCapability matches clear daily revenue questions only', () => {
  const now = new Date('2026-07-03T12:00:00Z');
  const clearMatch = resolveCapability('Qual foi o faturamento de hoje?', { now, timeZone: 'America/Recife' });

  assert.equal(clearMatch.matched, true);
  assert.equal(clearMatch.matchType, 'clear');
  assert.equal(clearMatch.capabilityId, 'finance.daily_revenue');
  assert.equal(clearMatch.params.date, '2026-07-03');
  assert.equal(clearMatch.params.timeZone, 'America/Recife');

  const ambiguousMatch = resolveCapability('Qual foi o faturamento?', { now, timeZone: 'America/Recife' });
  assert.equal(ambiguousMatch.matched, false);

  const invalidDateMatch = resolveCapability('Qual foi o faturamento em 31/02/2026?', { now, timeZone: 'America/Recife' });
  assert.equal(invalidDateMatch.matched, false);
});

test('executeCapability runs finance.daily_revenue with cache-safe response', async () => {
  clearCache();
  let queryCount = 0;
  const context = {
    requestId: 'test-request',
    params: { date: '2026-07-03', dateLabel: '2026-07-03' },
    timeZone: 'America/Recife',
    queryTimeoutMs: 45000,
    log: () => {},
    queryDatabase: async (sql, params, options) => {
      queryCount += 1;
      assert.equal(params[0], '2026-07-03');
      assert.equal(params[1], 'America/Recife');
      assert.equal(options.statementTimeoutMs, 45000);
      assert.match(sql, /public\.vw_itens_vendidos/);
      return {
        rowCount: 1,
        rows: [{ loja: 'CALCADOS', qtd_vendas: 2, itens_vendidos: 3, faturamento: 150.5 }]
      };
    }
  };

  const first = await executeCapability('finance.daily_revenue', context);
  const second = await executeCapability('finance.daily_revenue', context);

  assert.equal(first.success, true);
  assert.equal(first.cacheStatus, 'miss');
  assert.match(first.text, /Faturamento diário/);
  assert.equal(second.success, true);
  assert.equal(second.cacheStatus, 'hit');
  assert.equal(queryCount, 1);
});

test('executeCapability does not run unsupported capabilities', async () => {
  const result = await executeCapability('finance.high_risk_report', {
    requestId: 'test-request',
    params: {},
    log: () => {},
    queryDatabase: async () => {
      throw new Error('query should not run');
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'capability_not_found');
});

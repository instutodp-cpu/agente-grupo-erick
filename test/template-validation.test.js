'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { validateTemplate, redactSensitive } = require('../src/hermes/template-validation');

// Pool/cliente falsos: registram as queries emitidas, sem tocar em banco real.
function makeFakePool({ failOn } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(text) {
      queries.push(text);
      if (failOn && text.includes(failOn)) {
        throw new Error('column "x" does not exist');
      }
      // A execução do SQL do template devolve um "resultado".
      if (/^\s*SELECT/i.test(text)) return { rows: [], rowCount: 7 };
      return {};
    },
    release() { released = true; }
  };
  return {
    queries,
    get released() { return released; },
    async connect() { return client; }
  };
}

const fakeTemplate = {
  name: 'fake_template',
  buildParams() { return {}; },
  values() { return []; },
  sql: 'SELECT loja FROM vw_faturamento_mensal'
};

test('validateTemplate: sucesso roda em transação READ ONLY e faz ROLLBACK', async () => {
  const pool = makeFakePool();
  const result = await validateTemplate(pool, fakeTemplate, { statementTimeoutMs: 15000 });

  assert.strictEqual(result.template, 'fake_template');
  assert.strictEqual(result.status, 'OK');
  assert.strictEqual(result.rowCount, 7);
  assert.strictEqual(result.error, null);
  assert.strictEqual(typeof result.durationMs, 'number');

  // Sequência somente-leitura obrigatória.
  assert.ok(pool.queries.includes('BEGIN'));
  assert.ok(pool.queries.includes('SET TRANSACTION READ ONLY'));
  assert.ok(pool.queries.some(q => q.startsWith('SET LOCAL statement_timeout')));
  assert.ok(pool.queries.includes('ROLLBACK'));
  assert.ok(pool.released, 'conexão devolvida ao pool');

  // Nunca deve emitir escrita.
  const escreveu = pool.queries.some(q => /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|COMMIT)\b/i.test(q));
  assert.strictEqual(escreveu, false);
});

test('validateTemplate: erro retorna ERRO com mensagem redigida e ainda faz ROLLBACK', async () => {
  const pool = makeFakePool({ failOn: 'vw_faturamento_mensal' });
  const result = await validateTemplate(pool, fakeTemplate, { statementTimeoutMs: 15000 });

  assert.strictEqual(result.status, 'ERRO');
  assert.strictEqual(result.rowCount, null);
  assert.match(result.error, /does not exist/);
  assert.ok(pool.queries.includes('ROLLBACK'), 'ROLLBACK mesmo em falha');
  assert.ok(pool.released);
});

test('redactSensitive: remove e-mail, CPF e DATABASE_URL', () => {
  const raw = 'erro em a@b.com cpf 123.456.789-00 url postgres://user:pass@host/db';
  const red = redactSensitive(raw);
  assert.ok(!red.includes('a@b.com'));
  assert.ok(!red.includes('123.456.789-00'));
  assert.ok(!red.includes('postgres://'));
});

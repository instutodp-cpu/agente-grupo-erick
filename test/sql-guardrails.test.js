'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { validateSql, DEFAULT_LIMIT } = require('../src/hermes/sql-guardrails');

// ── Consultas de leitura permitidas ──────────────────────────────────────────

test('SELECT simples permitido', () => {
  const r = validateSql('SELECT loja, faturamento_liquido FROM vw_faturamento_mensal');
  assert.strictEqual(r.ok, true);
});

test('SELECT qualificado por schema permitido', () => {
  assert.strictEqual(validateSql('SELECT * FROM public.vw_itens_vendidos LIMIT 5').ok, true);
  assert.strictEqual(validateSql('SELECT count(*) FROM softcom_import.contas_a_receber').ok, true);
});

test('CTE (WITH) de leitura permitida', () => {
  const r = validateSql('WITH x AS (SELECT loja FROM vw_faturamento_mensal) SELECT * FROM x');
  assert.strictEqual(r.ok, true);
});

test('subquery em FROM / IN / JOIN permitida', () => {
  assert.strictEqual(validateSql('SELECT * FROM (SELECT loja FROM vw_faturamento_mensal) t').ok, true);
  assert.strictEqual(
    validateSql('SELECT * FROM vw_itens_vendidos WHERE codigo_produto IN (SELECT codigo FROM vw_produtos_catalogo)').ok,
    true
  );
  assert.strictEqual(
    validateSql('SELECT a.loja FROM vw_faturamento_mensal a JOIN (SELECT loja FROM vw_contas_a_receber) b ON a.loja = b.loja').ok,
    true
  );
});

// ── Comandos perigosos bloqueados ────────────────────────────────────────────

test('INSERT / UPDATE / DELETE bloqueados', () => {
  assert.strictEqual(validateSql('INSERT INTO bloquetes VALUES (1)').ok, false);
  assert.strictEqual(validateSql('UPDATE contas_a_receber SET valor_pago = 0').ok, false);
  assert.strictEqual(validateSql('DELETE FROM vw_faturamento_mensal').ok, false);
});

test('DROP / ALTER / TRUNCATE bloqueados', () => {
  assert.strictEqual(validateSql('DROP TABLE vendas_efetuadas').ok, false);
  assert.strictEqual(validateSql('ALTER TABLE vendas_efetuadas ADD COLUMN x int').ok, false);
  assert.strictEqual(validateSql('TRUNCATE vendas_efetuadas').ok, false);
});

test('CREATE / GRANT / REVOKE bloqueados', () => {
  assert.strictEqual(validateSql('CREATE TABLE t (id int)').ok, false);
  assert.strictEqual(validateSql('GRANT ALL ON vw_itens_vendidos TO x').ok, false);
  assert.strictEqual(validateSql('REVOKE ALL ON vw_itens_vendidos FROM x').ok, false);
});

// ── Injeção / múltiplas statements / comentários ─────────────────────────────

test('múltiplas statements bloqueadas', () => {
  const r = validateSql('SELECT 1 FROM vw_faturamento_mensal; SELECT 2 FROM vw_itens_vendidos');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'multiple_statements');
});

test('ponto e vírgula final único é tolerado', () => {
  assert.strictEqual(validateSql('SELECT loja FROM vw_faturamento_mensal;').ok, true);
});

test('comentários (-- e /* */) bloqueados', () => {
  assert.strictEqual(validateSql('SELECT * FROM vw_faturamento_mensal -- comentário').ok, false);
  assert.strictEqual(validateSql('SELECT * FROM vw_faturamento_mensal /* bloco */').ok, false);
});

// ── Allowlist de schemas / relações ──────────────────────────────────────────

test('schema não permitido bloqueado', () => {
  assert.strictEqual(validateSql('SELECT * FROM pg_catalog.pg_tables').ok, false);
  assert.strictEqual(validateSql('SELECT * FROM information_schema.tables').ok, false);
});

test('tabela fora da allowlist bloqueada', () => {
  const r = validateSql('SELECT * FROM segredos');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'disallowed_relation');
});

// ── LIMIT padrão ─────────────────────────────────────────────────────────────

test('LIMIT padrão aplicado quando ausente', () => {
  const r = validateSql('SELECT loja FROM vw_faturamento_mensal');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.appliedLimit, true);
  assert.ok(r.sql.endsWith(`LIMIT ${DEFAULT_LIMIT}`), `esperava LIMIT ${DEFAULT_LIMIT}, veio: ${r.sql}`);
});

test('LIMIT existente é preservado (não duplica)', () => {
  const r = validateSql('SELECT loja FROM vw_faturamento_mensal LIMIT 3');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.appliedLimit, false);
  assert.strictEqual((r.sql.match(/limit/gi) || []).length, 1);
});

// ── Mensagem amigável ────────────────────────────────────────────────────────

test('bloqueio retorna mensagem amigável', () => {
  const r = validateSql('DELETE FROM vw_faturamento_mensal');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(typeof r.message, 'string');
  assert.ok(r.message.length > 0);
});

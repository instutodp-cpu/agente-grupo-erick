'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-contract');
const {
  DEFAULT_TABLE_NAME,
  INSERT_SQL,
  READINESS_SQL,
  SELECT_BY_ID_OR_DIGEST_SQL,
  AuthorityGrantPostgresPersistenceError,
  createCanonicalGovernanceAuthorityGrantPersistencePostgres,
  parseRow,
  rowValues,
  sameCanonicalGrant
} = require('../src/adapters/postgres/canonical-governance-authority-grant-persistence-postgres');

const INSTALLATION_ID = 'installation-persistence-unit';

function grant() {
  return buildAuthorityGrant({
    authority_grant_id: 'authority-grant-persistence-unit',
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: `governance-root::${INSTALLATION_ID}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'1'.repeat(64)}`,
    issuer_root_key_id: 'root-key-0',
    issuer_root_key_fingerprint: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'3'.repeat(64)}`,
    subject_type: 'AGENT',
    subject_id: 'agent-delegate-unit',
    authority_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-unit'],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    capabilities: ['GOVERNANCE_AUDIT_READ'],
    restrictions: {
      allow_further_delegation: false,
      allow_cross_tenant: false,
      allow_cross_organization: false,
      allow_cross_project: false
    },
    issued_at: '2026-09-09T12:00:00.000Z',
    not_before: '2026-09-09T12:00:00.000Z',
    expires_at: '2026-09-10T12:00:00.000Z'
  });
}

function rowFromGrant(value) {
  return {
    ...value,
    issuer_root_generation: String(value.issuer_root_generation),
    authority_scope: JSON.stringify(value.authority_scope),
    capabilities: JSON.stringify(value.capabilities),
    restrictions: JSON.stringify(value.restrictions),
    issued_at: new Date(value.issued_at),
    not_before: new Date(value.not_before),
    expires_at: new Date(value.expires_at),
    created_at: new Date(value.issued_at)
  };
}

test('adapter is pure in its construction, defaults to the canonical table and rejects unsafe identifiers', () => {
  const pool = { query() {}, connect() {} };
  const adapter = createCanonicalGovernanceAuthorityGrantPersistencePostgres({ pool });
  assert.equal(adapter.table_name, DEFAULT_TABLE_NAME);
  assert.throws(
    () => createCanonicalGovernanceAuthorityGrantPersistencePostgres({ pool, tableName: 'hermes.grants; DROP TABLE hermes.governance_authority_grants' }),
    /table_name_invalid/
  );
});

test('invalid grants are rejected before readiness, connection or database writes', async () => {
  let queries = 0;
  let connections = 0;
  const pool = {
    query() { queries += 1; },
    connect() { connections += 1; }
  };
  const adapter = createCanonicalGovernanceAuthorityGrantPersistencePostgres({ pool });
  const result = await adapter.persistAuthorityGrant({ ...grant(), grant_digest: 'sha256:tampered' });
  assert.equal(result.persistence_result.outcome, 'REJECTED');
  assert.equal(result.persistence_result.write_performed, false);
  assert.equal(queries, 0);
  assert.equal(connections, 0);
});

test('row reconstruction is contract-validated, frozen and canonical', () => {
  const candidate = grant();
  const persisted = parseRow(rowFromGrant(candidate));
  assert.equal(sameCanonicalGrant(candidate, persisted), true);
  assert.equal(Object.isFrozen(persisted), true);
  assert.equal(Object.isFrozen(persisted.authority_scope), true);
  assert.equal(Object.isFrozen(persisted.capabilities), true);
  assert.equal(Object.isFrozen(persisted.restrictions), true);
  assert.throws(() => parseRow({ ...rowFromGrant(candidate), grant_digest: `sha256:${'4'.repeat(64)}` }), AuthorityGrantPostgresPersistenceError);
});

test('SQL uses insert-or-read semantics and never performs semantic update or delete', () => {
  assert.match(INSERT_SQL, /INSERT INTO/);
  assert.match(INSERT_SQL, /ON CONFLICT DO NOTHING/);
  assert.match(SELECT_BY_ID_OR_DIGEST_SQL, /FOR UPDATE/);
  assert.doesNotMatch(INSERT_SQL, /UPDATE\s+hermes\./i);
  assert.doesNotMatch(INSERT_SQL, /DELETE\s+FROM\s+hermes\./i);
  assert.match(READINESS_SQL, /mutation_trigger_exists/);
});

test('row values contain only the #186 canonical fields plus no runtime semantics', () => {
  const values = rowValues(grant());
  assert.equal(values.length, 19);
  assert.equal(values[0], 'authority-grant-persistence-unit');
  assert.equal(values.at(-1).startsWith('sha256:'), true);
});

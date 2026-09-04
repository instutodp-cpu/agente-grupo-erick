'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { stablePayload } = require('../src/core/agent-identity-contract');
const { canonicalDigest, installationIdentityDigest, rootSpecDigest, buildBootstrapArtifact } = require('../src/core/canonical-governance-root-bootstrap-contract');
const { createCanonicalGovernanceRootBootstrapPostgres } = require('../src/adapters/postgres/canonical-governance-root-bootstrap-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/016_create_canonical_governance_root_bootstrap.sql');
const MIGRATION = fs.readFileSync(MIGRATION_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_governance_root_bootstrap_test';
const TEST_TABLES = Object.freeze({
  guard: `${TEST_SCHEMA}.installation_bootstrap_guard`,
  installations: `${TEST_SCHEMA}.installations`,
  bootstraps: `${TEST_SCHEMA}.installation_bootstraps`,
  roots: `${TEST_SCHEMA}.governance_root_subjects`,
  keys: `${TEST_SCHEMA}.governance_root_keys`,
  audit: `${TEST_SCHEMA}.governance_audit_events`
});

function safeDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(database);
  } catch {
    return false;
  }
}

function isolatedMigration(sql) {
  return sql.replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll('hermes.', `${TEST_SCHEMA}.`);
}

function identity(id = 'installation-test-1') {
  return {
    identity_version: 'installation_identity_v1',
    installation_id: id,
    deployment_target_id: `target-${id}`,
    environment: 'production',
    repository: 'instutodp-cpu/agente-grupo-erick',
    commit_sha: 'a'.repeat(40),
    release_digest: canonicalDigest({ release: id })
  };
}

function rootSpec(install, keyId = 'root-key-0') {
  const keyMaterial = { root_key_id: keyId, algorithm: 'Ed25519', public_key: `public-${keyId}` };
  const key = {
    ...keyMaterial,
    key_fingerprint: canonicalDigest({ algorithm: keyMaterial.algorithm, public_key: keyMaterial.public_key }),
    key_digest: canonicalDigest(keyMaterial)
  };
  return {
    root_subject_id: `governance-root::${install.installation_id}`,
    root_scope: {
      scope_type: 'installation', installation_id: install.installation_id,
      tenant_ids: [], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    },
    root_capabilities: [
      'GOVERNANCE_AUDIT_READ', 'GOVERNANCE_DELEGATE_AUTHORITY',
      'GOVERNANCE_REVOKE_AUTHORITY', 'GOVERNANCE_ROTATE_ROOT_KEY'
    ],
    delegation_policy: {
      max_depth: 1, wildcard_allowed: false, cross_tenant_allowed: false,
      cross_organization_allowed: false, cross_project_allowed: false,
      delegable_authority_classes: []
    },
    initial_key: key
  };
}

function artifact(id = 'installation-test-1', bootstrapId = `bootstrap-${id}`) {
  const install = identity(id);
  const root = rootSpec(install);
  return buildBootstrapArtifact({
    bootstrap_id: bootstrapId,
    installation_identity: install,
    root_spec: root,
    external_authorization: {
      authorization_id: `external-auth-${bootstrapId}`,
      boundary_type: 'EXTERNAL_DEPLOYMENT_BOUNDARY',
      operator_subject: 'operator-1', operator_key_id: 'operator-key-1',
      target_installation_id: install.installation_id,
      installation_identity_digest: installationIdentityDigest(install),
      authorized_action: 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP',
      authorized_artifact_digest: 'pending', root_spec_digest: rootSpecDigest(root),
      issued_at: '2026-09-03T12:00:00.000Z', expires_at: '2026-09-03T12:15:00.000Z',
      boundary_key_id: 'boundary-key-1', signature_algorithm: 'Ed25519',
      signature: 'signature-fixture', attestation_digest: 'pending'
    }
  });
}

function rootTransitionInput(first, action, overrides = {}) {
  const { authorization: authorizationOverrides = {}, ...otherOverrides } = overrides;
  const input = {
    installation_id: first.installation_id,
    root_subject_id: first.receipt.root_subject_id,
    expected_generation: first.receipt.root_generation,
    expected_root_digest: first.receipt.root_digest,
    authorization: {
      authorization_id: `transition-${action.toLowerCase()}`,
      action,
      actor_subject: 'root-operator-1',
      actor_key_id: 'root-key-0',
      signature: 'root-signature-fixture'
    },
    ...otherOverrides
  };
  input.authorization = { ...input.authorization, ...authorizationOverrides };
  const material = {
    action,
    installation_id: input.installation_id,
    root_subject_id: input.root_subject_id,
    expected_generation: input.expected_generation,
    expected_root_digest: input.expected_root_digest,
    ...(input.new_key ? { new_key: input.new_key } : {}),
    authorization_id: input.authorization.authorization_id,
    actor_subject: input.authorization.actor_subject,
    actor_key_id: input.authorization.actor_key_id
  };
  input.authorization.signature_digest = canonicalDigest(JSON.parse(stablePayload(material)));
  return input;
}

test('real PostgreSQL bootstrap is atomic, one-shot, replay-safe and concurrent', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(isolatedMigration(MIGRATION));
    await pool.query(isolatedMigration(MIGRATION));

    const authority = createCanonicalGovernanceRootBootstrapPostgres({
      pool,
      tables: TEST_TABLES,
      externalTrustVerifier: { verify: async () => ({ valid: true }) },
      rootTransitionVerifier: { verify: async () => ({ valid: true }) }
    });
    const firstArtifact = artifact();
    const first = await authority.bootstrap(firstArtifact);
    assert.equal(first.status, 'BOOTSTRAPPED');

    const counts = await pool.query(`
      SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.installations)::int AS installations,
             (SELECT count(*) FROM ${TEST_SCHEMA}.installation_bootstraps)::int AS bootstraps,
             (SELECT count(*) FROM ${TEST_SCHEMA}.governance_root_subjects)::int AS roots,
             (SELECT count(*) FROM ${TEST_SCHEMA}.governance_root_keys)::int AS keys,
             (SELECT count(*) FROM ${TEST_SCHEMA}.governance_audit_events)::int AS audits
    `);
    assert.deepEqual(counts.rows[0], { installations: 1, bootstraps: 1, roots: 1, keys: 1, audits: 3 });

    const triggerInventory = await pool.query(`
      SELECT table_name, trigger_name, function_name
      FROM (
        SELECT c.relname AS table_name, t.tgname AS trigger_name, p.proname AS function_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND n.nspname = $1
      ) AS triggers
      WHERE trigger_name IN (
        'installations_immutable_trigger',
        'installation_bootstraps_append_only_trigger',
        'governance_root_subjects_immutable_trigger',
        'governance_root_keys_immutable_trigger',
        'governance_audit_append_only_trigger',
        'governance_audit_delete_trigger'
      )
      ORDER BY trigger_name
    `, [TEST_SCHEMA]);
    assert.deepEqual(triggerInventory.rows, [
      { table_name: 'governance_audit_events', trigger_name: 'governance_audit_append_only_trigger', function_name: 'reject_governance_audit_update' },
      { table_name: 'governance_audit_events', trigger_name: 'governance_audit_delete_trigger', function_name: 'reject_governance_audit_delete' },
      { table_name: 'governance_root_keys', trigger_name: 'governance_root_keys_immutable_trigger', function_name: 'reject_governance_root_key_immutable_update' },
      { table_name: 'governance_root_subjects', trigger_name: 'governance_root_subjects_immutable_trigger', function_name: 'reject_governance_root_subject_immutable_update' },
      { table_name: 'installation_bootstraps', trigger_name: 'installation_bootstraps_append_only_trigger', function_name: 'reject_installation_bootstrap_update' },
      { table_name: 'installations', trigger_name: 'installations_immutable_trigger', function_name: 'reject_installation_immutable_update' }
    ]);

    const replay = await createCanonicalGovernanceRootBootstrapPostgres({
      pool,
      tables: TEST_TABLES,
      externalTrustVerifier: { verify: async () => ({ valid: true }) }
    }).bootstrap(firstArtifact);
    assert.equal(replay.status, 'REPLAY_ACCEPTED');
    assert.equal(replay.artifact_digest, first.artifact_digest);
    assert.deepEqual(replay.receipt, { ...first.receipt, replay: true });

    const divergent = await authority.bootstrap(artifact('installation-other', 'bootstrap-other'));
    assert.equal(divergent.status, 'CONFLICT');

    const newKeyMaterial = { root_key_id: 'root-key-1', algorithm: 'Ed25519', public_key: 'public-root-key-1' };
    const newKey = {
      ...newKeyMaterial,
      key_fingerprint: canonicalDigest({ algorithm: newKeyMaterial.algorithm, public_key: newKeyMaterial.public_key }),
      key_digest: canonicalDigest(newKeyMaterial)
    };
    const rotated = await authority.rotateRootKey(rootTransitionInput(first, 'GOVERNANCE_ROOT_ROTATION', { new_key: newKey }));
    assert.equal(rotated.status, 'ROTATED');
    assert.equal(rotated.generation, 1);
    const keyStates = await pool.query(`SELECT generation, lifecycle_state FROM ${TEST_SCHEMA}.governance_root_keys ORDER BY generation`);
    assert.deepEqual(keyStates.rows, [{ generation: 0, lifecycle_state: 'SUPERSEDED' }, { generation: 1, lifecycle_state: 'ACTIVE' }]);

    const revoked = await authority.revokeRoot(rootTransitionInput(first, 'GOVERNANCE_ROOT_REVOCATION', {
      expected_generation: 1,
      authorization: { ...rootTransitionInput(first, 'GOVERNANCE_ROOT_REVOCATION').authorization, actor_key_id: 'root-key-1' }
    }));
    assert.equal(revoked.status, 'REVOKED');
    const revokedBootstrap = await authority.bootstrap(artifact('installation-test-1', 'bootstrap-new-after-revocation'));
    assert.equal(revokedBootstrap.status, 'CONFLICT');

    await pool.query(`
      UPDATE ${TEST_SCHEMA}.installations
      SET lifecycle_state = 'RECOVERY_REQUIRED'
      WHERE installation_id = $1
    `, ['installation-test-1']);
    await pool.query(`
      UPDATE ${TEST_SCHEMA}.governance_root_subjects
      SET lifecycle_state = 'RECOVERY_REQUIRED'
      WHERE root_subject_id = $1
    `, [first.receipt.root_subject_id]);
    const recoveryBootstrap = await authority.bootstrap(artifact('installation-test-1', 'bootstrap-during-recovery'));
    assert.equal(recoveryBootstrap.status, 'CONFLICT');

    const invalidLifecycle = await authority.rotateRootKey(rootTransitionInput(first, 'GOVERNANCE_ROOT_ROTATION', { expected_generation: 1, new_key: { ...newKey, root_key_id: 'root-key-2', public_key: 'public-root-key-2', key_fingerprint: canonicalDigest({ algorithm: 'Ed25519', public_key: 'public-root-key-2' }), key_digest: canonicalDigest({ root_key_id: 'root-key-2', algorithm: 'Ed25519', public_key: 'public-root-key-2' }) } }));
    assert.equal(invalidLifecycle.status, 'INVALID_LIFECYCLE');

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => authority.bootstrap(firstArtifact)));
    assert.equal(concurrent.filter((result) => result.status === 'REPLAY_ACCEPTED').length, 8);

    const secondKey = await pool.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE lifecycle_state = 'ACTIVE')::int AS active
      FROM ${TEST_SCHEMA}.governance_root_keys
    `);
    assert.deepEqual(secondKey.rows[0], { total: 2, active: 0 });

    const immutableIdentity = await pool.query(`
      UPDATE ${TEST_SCHEMA}.installations SET installation_id = 'tampered' WHERE installation_id = $1
    `, ['installation-test-1']).catch((error) => error);
    assert.equal(immutableIdentity.code, 'P0001');
    assert.match(immutableIdentity.message, /governance_installation_identity_immutable/);

    const bootstrapUpdate = await pool.query(`
      UPDATE ${TEST_SCHEMA}.installation_bootstraps SET receipt = receipt
    `).catch((error) => error);
    assert.equal(bootstrapUpdate.code, 'P0001');
    assert.match(bootstrapUpdate.message, /governance_bootstrap_append_only/);

    const rootIdentity = await pool.query(`
      UPDATE ${TEST_SCHEMA}.governance_root_subjects
      SET root_digest = 'sha256:' || repeat('0', 64)
    `).catch((error) => error);
    assert.equal(rootIdentity.code, 'P0001');
    assert.match(rootIdentity.message, /governance_root_subject_immutable/);

    const rootKeyIdentity = await pool.query(`
      UPDATE ${TEST_SCHEMA}.governance_root_keys SET public_key = 'tampered'
    `).catch((error) => error);
    assert.equal(rootKeyIdentity.code, 'P0001');
    assert.match(rootKeyIdentity.message, /governance_root_key_immutable/);

    const auditUpdate = await pool.query(`
      UPDATE ${TEST_SCHEMA}.governance_audit_events SET actor_subject = 'tampered'
    `).catch((error) => error);
    assert.equal(auditUpdate.code, 'P0001');
    assert.match(auditUpdate.message, /governance_audit_append_only/);

    const auditDelete = await pool.query(`DELETE FROM ${TEST_SCHEMA}.governance_audit_events`).catch((error) => error);
    assert.equal(auditDelete.code, 'P0001');
    assert.match(auditDelete.message, /governance_audit_append_only/);
  } finally {
    try { await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { await pool.end(); }
  }
});

test('real PostgreSQL transaction rollback leaves no bootstrap or root', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(isolatedMigration(MIGRATION));
    const authority = createCanonicalGovernanceRootBootstrapPostgres({
      pool,
      tables: { ...TEST_TABLES, roots: `${TEST_SCHEMA}.missing_roots` },
      externalTrustVerifier: { verify: async () => true }
    });
    const result = await authority.bootstrap(artifact());
    assert.equal(result.status, 'PERSISTENCE_FAILURE');
    const rows = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_SCHEMA}.installations)::int AS installations, (SELECT count(*) FROM ${TEST_SCHEMA}.installation_bootstraps)::int AS bootstraps`);
    assert.deepEqual(rows.rows[0], { installations: 0, bootstraps: 0 });
  } finally {
    try { await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`); } finally { await pool.end(); }
  }
});

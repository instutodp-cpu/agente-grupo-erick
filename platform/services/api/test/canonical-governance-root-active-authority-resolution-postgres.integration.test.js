'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { canonicalDigest, buildBootstrapArtifact, installationIdentityDigest, rootSpecDigest } = require('../src/core/canonical-governance-root-bootstrap-contract');
const { buildCommandEnvelope, publicKeyFingerprint, rootKeyDigest, replayIdentity } = require('../src/core/canonical-governance-root-cryptographic-command-contract');
const { createCanonicalGovernanceRootBootstrapPostgres } = require('../src/adapters/postgres/canonical-governance-root-bootstrap-postgres');
const { createCanonicalGovernanceRootActiveAuthorityResolutionPostgres } = require('../src/adapters/postgres/canonical-governance-root-active-authority-resolution-postgres');

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_governance_root_active_resolution_test';
const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/016_create_canonical_governance_root_bootstrap.sql');
const TEST_TABLES = Object.freeze({
  installations: `${TEST_SCHEMA}.installations`, roots: `${TEST_SCHEMA}.governance_root_subjects`, keys: `${TEST_SCHEMA}.governance_root_keys`
});

function safeDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname) && /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(database);
  } catch { return false; }
}

function isolatedMigration(sql) {
  return sql.replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`).replaceAll('hermes.', `${TEST_SCHEMA}.`);
}

function bootstrapArtifact() {
  const installation = {
    identity_version: 'installation_identity_v1', installation_id: 'installation-resolution-1', deployment_target_id: 'target-resolution-1',
    environment: 'production', repository: 'instutodp-cpu/agente-grupo-erick', commit_sha: 'a'.repeat(40), release_digest: canonicalDigest({ release: 'resolution-1' })
  };
  const publicKey = 'A'.repeat(43);
  const keyMaterial = { root_key_id: 'root-key-resolution-0', algorithm: 'Ed25519', public_key: publicKey };
  const root = {
    root_subject_id: `governance-root::${installation.installation_id}`,
    root_scope: { scope_type: 'installation', installation_id: installation.installation_id, tenant_ids: [], organization_ids: [], project_ids: [], cross_tenant: false, cross_organization: false, cross_project: false },
    root_capabilities: [
      'GOVERNANCE_AUDIT_READ', 'GOVERNANCE_DELEGATE_AUTHORITY',
      'GOVERNANCE_REVOKE_AUTHORITY', 'GOVERNANCE_ROTATE_ROOT_KEY'
    ],
    delegation_policy: { max_depth: 1, wildcard_allowed: false, cross_tenant_allowed: false, cross_organization_allowed: false, cross_project_allowed: false, delegable_authority_classes: [] },
    initial_key: { ...keyMaterial, key_fingerprint: publicKeyFingerprint(publicKey), key_digest: rootKeyDigest(keyMaterial) }
  };
  return buildBootstrapArtifact({
    bootstrap_id: 'bootstrap-resolution-1', installation_identity: installation, root_spec: root,
    external_authorization: {
      authorization_id: 'external-auth-resolution-1', boundary_type: 'EXTERNAL_DEPLOYMENT_BOUNDARY', operator_subject: 'operator-1', operator_key_id: 'operator-key-1',
      target_installation_id: installation.installation_id, installation_identity_digest: installationIdentityDigest(installation), authorized_action: 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP',
      authorized_artifact_digest: 'pending', root_spec_digest: rootSpecDigest(root), issued_at: '2026-09-08T12:00:00.000Z', expires_at: '2026-09-08T12:15:00.000Z',
      boundary_key_id: 'boundary-key-1', signature_algorithm: 'Ed25519', signature: 'signature-fixture', attestation_digest: 'pending'
    }
  }, { now: '2026-09-08T12:05:00.000Z' });
}

function commandFor(artifact) {
  const publicKey = artifact.root_spec.initial_key.public_key;
  const command = buildCommandEnvelope({
    command_id: 'command-resolution-1', installation_id: artifact.installation_identity.installation_id, root_subject_id: artifact.root_spec.root_subject_id,
    root_generation: 0, root_digest: rootSpecDigest(artifact.root_spec), root_key_id: artifact.root_spec.initial_key.root_key_id,
    root_key_fingerprint: publicKeyFingerprint(publicKey), root_key_digest: rootKeyDigest(artifact.root_spec.initial_key), command_type: 'GOVERNANCE_ROOT_TEST',
    payload: { target: 'resolution' }, issued_at: '2026-09-08T12:00:00.000Z', expires_at: '2026-09-08T12:15:00.000Z', nonce: 'A'.repeat(22),
    signature_algorithm: 'Ed25519', signature: 'A'.repeat(86)
  });
  return { envelope: command, authentication: { authenticated: true, status: 'AUTHENTICATED', reason_code: null, command_digest: command.command_digest, replay_identity: replayIdentity(command) } };
}

test('real PostgreSQL resolves the canonical active root and performs no writes', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
  try {
    const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(isolatedMigration(migration));
    const artifact = bootstrapArtifact();
    const bootstrap = createCanonicalGovernanceRootBootstrapPostgres({ pool, tables: { guard: `${TEST_SCHEMA}.installation_bootstrap_guard`, installations: TEST_TABLES.installations, bootstraps: `${TEST_SCHEMA}.installation_bootstraps`, roots: TEST_TABLES.roots, keys: TEST_TABLES.keys, audit: `${TEST_SCHEMA}.governance_audit_events` }, externalTrustVerifier: { verify: async () => true }, clock: () => new Date('2026-09-08T12:05:00.000Z') });
    assert.equal((await bootstrap.bootstrap(artifact)).status, 'BOOTSTRAPPED');
    const before = await pool.query(`SELECT (SELECT count(*) FROM ${TEST_TABLES.installations})::int AS installations, (SELECT count(*) FROM ${TEST_TABLES.roots})::int AS roots, (SELECT count(*) FROM ${TEST_TABLES.keys})::int AS keys`);
    const resolver = createCanonicalGovernanceRootActiveAuthorityResolutionPostgres({ pool, tables: TEST_TABLES });
    const result = await resolver.resolve(commandFor(artifact));
    assert.equal(result.status, 'RESOLVED_ACTIVE_ROOT');
    assert.equal(result.root_generation, 0);
    assert.equal(result.root_key_id, artifact.root_spec.initial_key.root_key_id);
    assert.deepEqual((await pool.query(`SELECT (SELECT count(*) FROM ${TEST_TABLES.installations})::int AS installations, (SELECT count(*) FROM ${TEST_TABLES.roots})::int AS roots, (SELECT count(*) FROM ${TEST_TABLES.keys})::int AS keys`)).rows[0], before.rows[0]);

    const wrongInstallation = commandFor(artifact);
    wrongInstallation.envelope = buildCommandEnvelope({ ...wrongInstallation.envelope, installation_id: 'other-installation', root_subject_id: 'governance-root::other-installation' });
    wrongInstallation.authentication = { authenticated: true, status: 'AUTHENTICATED', reason_code: null, command_digest: wrongInstallation.envelope.command_digest, replay_identity: replayIdentity(wrongInstallation.envelope) };
    assert.equal((await resolver.resolve(wrongInstallation)).reason_code, 'UNKNOWN_INSTALLATION');
    const staleGeneration = commandFor(artifact);
    staleGeneration.envelope = buildCommandEnvelope({ ...staleGeneration.envelope, root_generation: 1, signature: 'A'.repeat(86) });
    staleGeneration.authentication = { authenticated: true, status: 'AUTHENTICATED', reason_code: null, command_digest: staleGeneration.envelope.command_digest, replay_identity: replayIdentity(staleGeneration.envelope) };
    assert.equal((await resolver.resolve(staleGeneration)).reason_code, 'ROOT_GENERATION_MISMATCH');
  } finally {
    await pool.end();
  }
});

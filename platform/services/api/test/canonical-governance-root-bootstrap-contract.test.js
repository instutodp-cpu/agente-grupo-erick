'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONTRACT_VERSION,
  IDENTITY_VERSION,
  ROOT_CAPABILITIES,
  buildBootstrapArtifact,
  canonicalDigest,
  installationIdentityDigest,
  rootSpecDigest,
  validateBootstrapRequest,
  validateScope
} = require('../src/core/canonical-governance-root-bootstrap-contract');

function identity(overrides = {}) {
  const base = {
    identity_version: IDENTITY_VERSION,
    installation_id: 'installation-test-1',
    deployment_target_id: 'deployment-target-1',
    environment: 'production',
    repository: 'instutodp-cpu/agente-grupo-erick',
    commit_sha: 'a'.repeat(40),
    release_digest: canonicalDigest({ release: 'test-release-1' })
  };
  return { ...base, ...overrides };
}

function key(overrides = {}) {
  const base = { root_key_id: 'root-key-0', algorithm: 'Ed25519', public_key: 'public-key-material-0' };
  return {
    ...base,
    key_fingerprint: canonicalDigest({ algorithm: base.algorithm, public_key: base.public_key }),
    key_digest: canonicalDigest({ root_key_id: base.root_key_id, algorithm: base.algorithm, public_key: base.public_key }),
    ...overrides
  };
}

function rootSpec(installation = identity(), overrides = {}) {
  return {
    root_subject_id: `governance-root::${installation.installation_id}`,
    root_scope: {
      scope_type: 'installation',
      installation_id: installation.installation_id,
      tenant_ids: [],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    root_capabilities: [...ROOT_CAPABILITIES],
    delegation_policy: {
      max_depth: 1,
      wildcard_allowed: false,
      cross_tenant_allowed: false,
      cross_organization_allowed: false,
      cross_project_allowed: false,
      delegable_authority_classes: []
    },
    initial_key: key(),
    ...overrides
  };
}

function authorization(install, root, overrides = {}) {
  return {
    authorization_id: 'external-auth-1',
    boundary_type: 'EXTERNAL_DEPLOYMENT_BOUNDARY',
    operator_subject: 'operator-1',
    operator_key_id: 'operator-key-1',
    target_installation_id: install.installation_id,
    installation_identity_digest: installationIdentityDigest(install),
    authorized_action: 'OWNER_CONTROLLED_INSTALLATION_BOOTSTRAP',
    authorized_artifact_digest: 'pending',
    root_spec_digest: rootSpecDigest(root),
    issued_at: '2026-09-03T12:00:00.000Z',
    expires_at: '2026-09-03T12:15:00.000Z',
    boundary_key_id: 'boundary-key-1',
    signature_algorithm: 'Ed25519',
    signature: 'signature-fixture',
    attestation_digest: 'pending',
    ...overrides
  };
}

function artifact(overrides = {}) {
  const install = identity();
  const root = rootSpec(install);
  return buildBootstrapArtifact({
    bootstrap_id: 'bootstrap-1',
    installation_identity: install,
    root_spec: root,
    external_authorization: authorization(install, root),
    ...overrides
  });
}

test('builds a deterministic bootstrap artifact and digest', () => {
  const first = artifact();
  const second = artifact();
  assert.deepEqual(first, second);
  assert.equal(first.contract_version, CONTRACT_VERSION);
  assert.equal(validateBootstrapRequest(first).valid, true);
});

test('semantic identity and root changes alter their canonical digests', () => {
  const install = identity();
  assert.notEqual(installationIdentityDigest(install), installationIdentityDigest({ ...install, deployment_target_id: 'deployment-target-2' }));
  const root = rootSpec(install);
  assert.notEqual(rootSpecDigest(root), rootSpecDigest({ ...root, root_subject_id: 'governance-root::different' }));
});

test('rejects invalid root scope, capability escalation and private key material', () => {
  const install = identity();
  const root = rootSpec(install);
  const scopeErrors = [];
  validateScope({ ...root.root_scope, tenant_ids: ['tenant-a'] }, install.installation_id, scopeErrors);
  assert.ok(scopeErrors.includes('root_scope_tenant_ids_must_be_empty'));
  assert.throws(() => artifact({ root_spec: { ...root, root_capabilities: [...ROOT_CAPABILITIES, 'EXECUTION_START'] } }), /bootstrap_request_invalid/);
  assert.throws(() => artifact({ root_spec: { ...root, initial_key: { ...root.initial_key, private_key: 'forbidden' } } }), /bootstrap_request_invalid/);
});

test('rejects provenance, external authorization and identity mismatches fail-closed', () => {
  const install = identity();
  const root = rootSpec(install);
  assert.throws(() => artifact({ installation_identity: { ...install, commit_sha: 'b'.repeat(40) } }), /bootstrap_request_invalid/);
  assert.throws(() => artifact({ external_authorization: authorization(install, root, { target_installation_id: 'installation-other' }) }), /bootstrap_request_invalid/);
  const valid = artifact();
  assert.equal(validateBootstrapRequest({ ...valid, artifact_digest: canonicalDigest({ divergent: true }) }).valid, false);
});

test('contract and migration contain no operational authority or private-key persistence', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/core/canonical-governance-root-bootstrap-contract.js'), 'utf8');
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/016_create_canonical_governance_root_bootstrap.sql'), 'utf8');
  assert.doesNotMatch(source, /execution_started\s*:\s*true|provider_called\s*:\s*true|tool_called\s*:\s*true|network_used\s*:\s*true/i);
  assert.doesNotMatch(migration, /private_key|secret_value|auth_token/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS governance_root_keys_one_active_idx/);
  assert.match(migration, /CREATE TRIGGER governance_audit_append_only_trigger/);
});

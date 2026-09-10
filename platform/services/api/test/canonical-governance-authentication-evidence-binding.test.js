'use strict';

const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const test = require('node:test');

const {
  ALGORITHM,
  COMMAND_DOMAIN,
  CONTRACT_VERSION: COMMAND_CONTRACT_VERSION,
  buildCommandEnvelope,
  canonicalSigningBytes,
  publicKeyFingerprint,
  rootKeyDigest
} = require('../src/core/canonical-governance-root-cryptographic-command-contract');
const {
  authenticateCanonicalGovernanceRootCommand
} = require('../src/core/canonical-governance-root-command-authentication');
const {
  buildAuthorizationRequest
} = require('../src/core/canonical-governance-authorization-request-contract');
const {
  AUTHENTICATION_EVIDENCE_BINDING_FIELDS,
  AUTHENTICATION_EVIDENCE_BINDING_INPUT_FIELDS,
  AUTHENTICATION_EVIDENCE_DOMAIN,
  AUTHENTICATION_EVIDENCE_STATUS,
  CONTRACT_VERSION,
  authenticationEvidenceDigest,
  buildAuthenticationEvidenceBinding,
  canonicalAuthenticationEvidenceBytes,
  validateAuthenticationEvidenceBinding,
  validateAuthenticationEvidenceBindingInput
} = require('../src/core/canonical-governance-authentication-evidence-binding');

const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;
const NONCE = 'A'.repeat(22);
const INSTALLATION_ID = 'installation-authentication-evidence-test';

function testKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  const raw = spki.subarray(spki.length - 32);
  return { privateKey, publicKey: raw.toString('base64url') };
}

function authenticatedFixture({ commandOverrides = {}, requestOverrides = {}, authenticationOverrides = {} } = {}) {
  const keyPair = testKeyPair();
  const commandBase = {
    contract_version: COMMAND_CONTRACT_VERSION,
    domain: COMMAND_DOMAIN,
    command_id: 'command-authentication-evidence-1',
    installation_id: INSTALLATION_ID,
    root_subject_id: `governance-root::${INSTALLATION_ID}`,
    root_generation: 0,
    root_digest: ROOT_DIGEST,
    root_key_id: 'root-key-0',
    root_key_fingerprint: publicKeyFingerprint(keyPair.publicKey),
    root_key_digest: rootKeyDigest({ root_key_id: 'root-key-0', algorithm: ALGORITHM, public_key: keyPair.publicKey }),
    command_type: 'GOVERNANCE_ROOT_TEST',
    payload: { operation: 'test' },
    issued_at: '2026-09-10T12:00:00.000Z',
    expires_at: '2026-09-10T12:15:00.000Z',
    nonce: NONCE,
    signature_algorithm: ALGORITHM,
    signature: 'A'.repeat(86),
    ...commandOverrides
  };
  const unsignedCommand = buildCommandEnvelope(commandBase);
  const signature = sign(null, canonicalSigningBytes(unsignedCommand), keyPair.privateKey).toString('base64url');
  const command = { ...unsignedCommand, signature };
  const authentication = {
    ...authenticateCanonicalGovernanceRootCommand({ envelope: command, public_key: keyPair.publicKey }),
    ...authenticationOverrides
  };
  const authorizationRequest = buildAuthorizationRequest({
    authorization_request_id: 'authorization-request-authentication-evidence-1',
    installation_id: INSTALLATION_ID,
    subject_type: 'AGENT',
    subject_id: 'agent-requester-1',
    requested_capability: 'GOVERNANCE_AUDIT_READ',
    requested_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-1'],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    source_command_id: command.command_id,
    source_command_digest: command.command_digest,
    ...requestOverrides
  });
  return { command, authentication, authorizationRequest, publicKey: keyPair.publicKey };
}

function bindingInput(fixture = authenticatedFixture()) {
  return {
    command: fixture.command,
    authentication: fixture.authentication,
    authorization_request: fixture.authorizationRequest,
    public_key: fixture.publicKey
  };
}

test('binds an authenticated #183 command to a source-bound #191 request', () => {
  const input = bindingInput();
  const binding = buildAuthenticationEvidenceBinding(input);

  assert.deepEqual(validateAuthenticationEvidenceBindingInput(input), { valid: true, errors: [] });
  assert.deepEqual(validateAuthenticationEvidenceBinding(binding, input), { valid: true, errors: [] });
  assert.deepEqual(Object.keys(binding).sort(), [...AUTHENTICATION_EVIDENCE_BINDING_FIELDS].sort());
  assert.deepEqual(Object.keys(input).sort(), [...AUTHENTICATION_EVIDENCE_BINDING_INPUT_FIELDS].sort());
  assert.equal(binding.contract_version, CONTRACT_VERSION);
  assert.equal(binding.authentication_evidence_domain, AUTHENTICATION_EVIDENCE_DOMAIN);
  assert.equal(binding.status, AUTHENTICATION_EVIDENCE_STATUS);
  assert.equal(binding.installation_id, input.command.installation_id);
  assert.equal(binding.command_id, input.command.command_id);
  assert.equal(binding.command_digest, input.command.command_digest);
  assert.equal(binding.authorization_request_id, input.authorization_request.authorization_request_id);
  assert.match(binding.authentication_evidence_digest, /^sha256:[0-9a-f]{64}$/);
});

test('binding digest and output are deterministic, immutable, and field-order independent', () => {
  const input = bindingInput();
  const first = buildAuthenticationEvidenceBinding(input);
  const reordered = {};
  for (const key of Object.keys(input).reverse()) {
    if (key === 'command' || key === 'authorization_request') continue;
    reordered[key] = input[key];
  }
  reordered.command = Object.fromEntries(Object.entries(input.command).reverse());
  reordered.authentication = Object.fromEntries(Object.entries(input.authentication).reverse());
  reordered.authorization_request = {
    ...input.authorization_request,
    requested_scope: Object.fromEntries(Object.entries(input.authorization_request.requested_scope).reverse())
  };

  const second = buildAuthenticationEvidenceBinding(reordered);
  assert.deepEqual(canonicalAuthenticationEvidenceBytes(first), canonicalAuthenticationEvidenceBytes(second));
  assert.equal(authenticationEvidenceDigest(first), first.authentication_evidence_digest);
  assert.equal(authenticationEvidenceDigest(first), authenticationEvidenceDigest(second));
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => {
    first.status = 'AUTHORIZED';
  }, TypeError);
});

test('requires exact command identity and request source binding', () => {
  const fixture = authenticatedFixture();
  const input = bindingInput(fixture);
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...input,
    command: { ...input.command, command_id: 'other-command' }
  }), /authentication_evidence_binding_invalid/);
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...input,
    command: { ...input.command, command_digest: `sha256:${'2'.repeat(64)}` }
  }), /authentication_evidence_binding_invalid/);

  const missingSource = authenticatedFixture({ requestOverrides: { source_command_id: null, source_command_digest: null } });
  assert.throws(() => buildAuthenticationEvidenceBinding(bindingInput(missingSource)), /source_command_binding_required/);

  const mismatchedSource = authenticatedFixture({ requestOverrides: { source_command_id: 'other-command' } });
  assert.throws(() => buildAuthenticationEvidenceBinding(bindingInput(mismatchedSource)), /source_command_id_mismatch/);
  const mismatchedDigest = authenticatedFixture({ requestOverrides: { source_command_digest: `sha256:${'3'.repeat(64)}` } });
  assert.throws(() => buildAuthenticationEvidenceBinding(bindingInput(mismatchedDigest)), /source_command_digest_mismatch/);
});

test('rejects request identity and digest tampering during result validation', () => {
  const input = bindingInput();
  const binding = buildAuthenticationEvidenceBinding(input);
  assert.equal(validateAuthenticationEvidenceBinding({
    ...binding,
    authorization_request_id: 'other-request'
  }, input).valid, false);
  assert.equal(validateAuthenticationEvidenceBinding({
    ...binding,
    authorization_request_digest: `sha256:${'4'.repeat(64)}`
  }, input).valid, false);
  assert.equal(validateAuthenticationEvidenceBinding({
    ...binding,
    authentication_evidence_digest: `sha256:${'5'.repeat(64)}`
  }).valid, false);
});

test('rejects cross-installation binding and non-successful authentication', () => {
  const fixture = authenticatedFixture({
    requestOverrides: {
      installation_id: 'other-installation',
      requested_scope: {
        scope_type: 'installation',
        installation_id: 'other-installation',
        tenant_ids: ['tenant-1'],
        organization_ids: [],
        project_ids: [],
        cross_tenant: false,
        cross_organization: false,
        cross_project: false
      }
    }
  });
  assert.throws(() => buildAuthenticationEvidenceBinding(bindingInput(fixture)), /installation_binding_mismatch/);

  const rejected = authenticatedFixture({ commandOverrides: { payload: { operation: 'tampered-before-signing' } } });
  const invalidAuthentication = {
    ...rejected.authentication,
    authenticated: false,
    status: 'REJECTED',
    reason_code: 'INVALID_SIGNATURE'
  };
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...bindingInput(rejected),
    authentication: invalidAuthentication
  }), /authentication_result_not_successful/);
});

test('revalidates cryptographic command and authentication evidence instead of trusting caller flags', () => {
  const input = bindingInput();
  const fakeAuthentication = {
    ...input.authentication,
    authenticated: true,
    command_digest: `sha256:${'6'.repeat(64)}`
  };
  assert.throws(() => buildAuthenticationEvidenceBinding({ ...input, authentication: fakeAuthentication }), /not_bound_to_command/);
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...input,
    authentication: { ...input.authentication, signature_valid: true }
  }), /authentication_evidence_binding_invalid/);
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...input,
    command: { ...input.command, payload: { operation: 'tampered' } }
  }), /command_invalid/);
  assert.throws(() => buildAuthenticationEvidenceBinding({
    ...input,
    authorization_request: { ...input.authorization_request, requested_capability: 'GOVERNANCE_REVOKE_AUTHORITY' }
  }), /authorization_request_invalid/);
});

test('rejects unknown fields and never emits later authorization outcomes', () => {
  const input = bindingInput();
  assert.throws(() => buildAuthenticationEvidenceBinding({ ...input, authenticated: true }), /authentication_evidence_binding_invalid/);
  const binding = buildAuthenticationEvidenceBinding(input);
  assert.equal(validateAuthenticationEvidenceBinding({ ...binding, authorized: true }).valid, false);
  for (const forbidden of ['AUTHORIZED', 'DENIED', 'ACTIVE', 'APPROVED', 'EXECUTED']) {
    assert.equal(Object.values(binding).includes(forbidden), false, forbidden);
  }
});

test('same canonical inputs produce the same evidence identity and digest', () => {
  const input = bindingInput();
  const first = buildAuthenticationEvidenceBinding(input);
  const second = buildAuthenticationEvidenceBinding({ ...input });
  assert.equal(first.authentication_evidence_id, second.authentication_evidence_id);
  assert.equal(first.authentication_evidence_digest, second.authentication_evidence_digest);
});

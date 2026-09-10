'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const { authenticateCanonicalGovernanceRootCommand } = require('../src/core/canonical-governance-root-command-authentication');
const { buildAuthorizationRequest } = require('../src/core/canonical-governance-authorization-request-contract');
const { buildAuthenticationEvidenceBinding } = require('../src/core/canonical-governance-authentication-evidence-binding');
const { buildAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-contract');
const { buildAuthorityGrantRevocation } = require('../src/core/canonical-governance-authority-grant-revocation-contract');
const {
  AUTHORIZATION_DECISION_FIELDS,
  AUTHORIZATION_DECISION_STATUS,
  AUTHORIZATION_REASON_CODES,
  authorizationDecisionDigest,
  canonicalAuthorizationDecisionBytes,
  evaluateCanonicalGovernanceAuthorizationDecision,
  validateAuthorizationDecision,
  validateAuthorizationDecisionInput
} = require('../src/core/canonical-governance-authorization-decision');
const { resolveCanonicalGovernanceAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-resolution');

const ROOT_DIGEST = `sha256:${'1'.repeat(64)}`;
const INSTALLATION_ID = 'installation-authorization-decision-test';

function testKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  return { privateKey, publicKey: spki.subarray(spki.length - 32).toString('base64url') };
}

function commandAndAuth() {
  const keyPair = testKeyPair();
  const commandBase = {
    contract_version: COMMAND_CONTRACT_VERSION,
    domain: COMMAND_DOMAIN,
    command_id: 'command-authorization-decision-1',
    installation_id: INSTALLATION_ID,
    root_subject_id: `governance-root::${INSTALLATION_ID}`,
    root_generation: 0,
    root_digest: ROOT_DIGEST,
    root_key_id: 'root-key-0',
    root_key_fingerprint: publicKeyFingerprint(keyPair.publicKey),
    root_key_digest: rootKeyDigest({ root_key_id: 'root-key-0', algorithm: ALGORITHM, public_key: keyPair.publicKey }),
    command_type: 'GOVERNANCE_ROOT_TEST',
    payload: { operation: 'authorization-decision-test' },
    issued_at: '2026-09-10T12:00:00.000Z',
    expires_at: '2026-09-10T12:15:00.000Z',
    nonce: 'A'.repeat(22),
    signature_algorithm: ALGORITHM,
    signature: 'A'.repeat(86)
  };
  const unsigned = buildCommandEnvelope(commandBase);
  const command = {
    ...unsigned,
    signature: sign(null, canonicalSigningBytes(unsigned), keyPair.privateKey).toString('base64url')
  };
  const authentication = authenticateCanonicalGovernanceRootCommand({ envelope: command, public_key: keyPair.publicKey });
  return { command, authentication, publicKey: keyPair.publicKey };
}

function decisionFixture({
  grantOverrides = {},
  requestOverrides = {},
  evaluationTime = '2026-09-10T12:05:00.000Z',
  revocations = [],
  resolutionInputOverrides = {}
} = {}) {
  const commandFixture = commandAndAuth();
  const grant = buildAuthorityGrant({
    authority_grant_id: 'authority-grant-authorization-decision-1',
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: `governance-root::${INSTALLATION_ID}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_id: 'root-key-decision-0',
    issuer_root_key_fingerprint: `sha256:${'3'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'4'.repeat(64)}`,
    subject_type: 'AGENT',
    subject_id: 'agent-requester-1',
    authority_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-1'],
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
    issued_at: '2026-09-10T12:00:00.000Z',
    not_before: '2026-09-10T12:00:00.000Z',
    expires_at: '2026-09-10T12:10:00.000Z',
    ...grantOverrides
  });
  const request = buildAuthorizationRequest({
    authorization_request_id: 'authorization-request-decision-1',
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
    source_command_id: commandFixture.command.command_id,
    source_command_digest: commandFixture.command.command_digest,
    ...requestOverrides
  });
  const authenticationEvidenceInput = {
    command: commandFixture.command,
    authentication: commandFixture.authentication,
    authorization_request: request,
    public_key: commandFixture.publicKey
  };
  const authenticationEvidence = buildAuthenticationEvidenceBinding(authenticationEvidenceInput);
  const grantResolutionInput = {
    installation_id: INSTALLATION_ID,
    authority_grant_id: grant.authority_grant_id,
    expected_grant_digest: grant.grant_digest,
    evaluation_time: evaluationTime,
    grant,
    revocations,
    ...resolutionInputOverrides
  };
  const grantResolution = resolveCanonicalGovernanceAuthorityGrant(grantResolutionInput);
  return {
    authorization_request: request,
    authentication_evidence: authenticationEvidence,
    authentication_evidence_input: authenticationEvidenceInput,
    grant_resolution: grantResolution,
    grant_resolution_input: grantResolutionInput,
    grant,
    commandFixture
  };
}

function decisionInput(fixture = decisionFixture()) {
  return {
    authorization_request: fixture.authorization_request,
    authentication_evidence: fixture.authentication_evidence,
    authentication_evidence_input: fixture.authentication_evidence_input,
    grant_resolution: fixture.grant_resolution,
    grant_resolution_input: fixture.grant_resolution_input
  };
}

function revocation(grant, overrides = {}) {
  return buildAuthorityGrantRevocation({
    authority_grant_revocation_id: 'revocation-authorization-decision-1',
    installation_id: grant.installation_id,
    target_authority_grant_id: grant.authority_grant_id,
    target_grant_digest: grant.grant_digest,
    issuer_root_subject_id: `governance-root::${grant.installation_id}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'5'.repeat(64)}`,
    issuer_root_key_id: 'root-key-decision-0',
    issuer_root_key_fingerprint: `sha256:${'6'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'7'.repeat(64)}`,
    reason_code: 'SECURITY',
    issued_at: '2026-09-10T12:00:00.000Z',
    effective_at: '2026-09-10T12:03:00.000Z',
    ...overrides
  });
}

test('active grant with exact subject, capability, scope, installation and shared evaluation time is AUTHORIZED', () => {
  const fixture = decisionFixture();
  const result = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(fixture));

  assert.equal(result.decision, AUTHORIZATION_DECISION_STATUS.AUTHORIZED);
  assert.equal(result.reason_code, 'within_validity_window_and_all_bindings_match');
  assert.equal(result.grant_resolution_status, 'RESOLVED_ACTIVE');
  assert.equal(result.evaluation_time, fixture.grant_resolution.evaluation_time);
  assert.equal(validateAuthorizationDecision(result).valid, true);
  assert.equal(validateAuthorizationDecisionInput(decisionInput(fixture)).valid, true);
  assert.deepEqual(Object.keys(result).sort(), [...AUTHORIZATION_DECISION_FIELDS].sort());
});

test('non-active resolution states never authorize', () => {
  const notYetActive = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(decisionFixture({
    grantOverrides: { not_before: '2026-09-10T12:06:00.000Z' }
  })));
  const expired = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(decisionFixture({
    grantOverrides: { expires_at: '2026-09-10T12:04:00.000Z' }
  })));
  const revokedFixture = decisionFixture();
  const revoked = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput({
    ...revokedFixture,
    grant_resolution_input: { ...revokedFixture.grant_resolution_input, revocations: [revocation(revokedFixture.grant)] },
    grant_resolution: resolveCanonicalGovernanceAuthorityGrant({
      ...revokedFixture.grant_resolution_input,
      revocations: [revocation(revokedFixture.grant)]
    })
  }));
  const notFoundFixture = decisionFixture();
  const notFoundInput = { ...notFoundFixture.grant_resolution_input, grant: null, revocations: [] };
  const notFound = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput({
    ...notFoundFixture,
    grant_resolution_input: notFoundInput,
    grant_resolution: resolveCanonicalGovernanceAuthorityGrant(notFoundInput)
  }));
  const rejectedFixture = decisionFixture({ resolutionInputOverrides: { expected_grant_digest: `sha256:${'f'.repeat(64)}` } });
  const rejected = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(rejectedFixture));

  for (const result of [notYetActive, expired, revoked, notFound]) {
    assert.notEqual(result.decision, AUTHORIZATION_DECISION_STATUS.AUTHORIZED);
    assert.equal(result.reason_code, 'grant_not_active');
  }
  assert.equal(rejected.decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
  assert.equal(rejected.reason_code, 'grant_resolution_invalid');
});

test('subject, capability, and exact canonical scope mismatches deny', () => {
  const subject = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(decisionFixture({
    grantOverrides: { subject_id: 'agent-other' }
  })));
  const capability = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(decisionFixture({
    requestOverrides: { requested_capability: 'GOVERNANCE_REVOKE_AUTHORITY' }
  })));
  const scope = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput(decisionFixture({
    requestOverrides: {
      requested_scope: {
        scope_type: 'installation', installation_id: INSTALLATION_ID,
        tenant_ids: ['tenant-2'], organization_ids: [], project_ids: [],
        cross_tenant: false, cross_organization: false, cross_project: false
      }
    }
  })));

  assert.deepEqual(
    [subject.reason_code, capability.reason_code, scope.reason_code],
    ['subject_mismatch', 'capability_mismatch', 'scope_mismatch']
  );
  assert.ok([subject, capability, scope].every((result) => result.decision === AUTHORIZATION_DECISION_STATUS.DENIED));
});

test('installation mismatch and evidence/request mismatches fail closed', () => {
  const fixture = decisionFixture();
  const foreignRequest = buildAuthorizationRequest({
    ...fixture.authorization_request,
    installation_id: 'other-installation',
    requested_scope: {
      scope_type: 'installation', installation_id: 'other-installation',
      tenant_ids: ['tenant-1'], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    }
  });
  const installationResult = evaluateCanonicalGovernanceAuthorizationDecision({
    ...decisionInput(fixture), authorization_request: foreignRequest
  });
  assert.equal(installationResult.decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
  assert.equal(installationResult.reason_code, 'evidence_mismatch');

  const mismatchedRequest = decisionFixture({ requestOverrides: { authorization_request_id: 'authorization-request-other' } });
  const mismatchResult = evaluateCanonicalGovernanceAuthorizationDecision({
    ...decisionInput(fixture),
    authorization_request: mismatchedRequest.authorization_request
  });
  assert.equal(mismatchResult.decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
  assert.equal(mismatchResult.reason_code, 'evidence_mismatch');
});

test('tampered request, authentication evidence, grant evidence, and grant identity are rejected', () => {
  const fixture = decisionFixture();
  const input = decisionInput(fixture);
  const tamperedRequest = { ...input.authorization_request, requested_capability: 'GOVERNANCE_REVOKE_AUTHORITY' };
  assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({ ...input, authorization_request: tamperedRequest }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED);

  const tamperedEvidence = { ...input.authentication_evidence, authentication_evidence_digest: `sha256:${'a'.repeat(64)}` };
  assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({ ...input, authentication_evidence: tamperedEvidence }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED);

  const tamperedGrantInput = {
    ...input.grant_resolution_input,
    grant: { ...input.grant_resolution_input.grant, subject_id: 'agent-tampered' }
  };
  assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({ ...input, grant_resolution_input: tamperedGrantInput }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED);

  const wrongDigestResolutionInput = {
    ...input.grant_resolution_input,
    expected_grant_digest: `sha256:${'b'.repeat(64)}`
  };
  const wrongDigestResolution = resolveCanonicalGovernanceAuthorityGrant(wrongDigestResolutionInput);
  assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({
    ...input,
    grant_resolution_input: wrongDigestResolutionInput,
    grant_resolution: wrongDigestResolution
  }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
});

test('capability and scope security remain exact and fail closed', () => {
  const fixture = decisionFixture();
  const prefix = evaluateCanonicalGovernanceAuthorizationDecision({
    ...decisionInput(fixture),
    authorization_request: { ...fixture.authorization_request, requested_capability: 'GOVERNANCE_AUDIT_READ_EXTRA' }
  });
  assert.equal(prefix.decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
  assert.throws(() => decisionFixture({ requestOverrides: { requested_capability: 'governance_audit_read' } }), /authorization_request_invalid/);
  assert.throws(() => decisionFixture({ requestOverrides: {
    requested_scope: {
      scope_type: 'installation', installation_id: INSTALLATION_ID,
      tenant_ids: ['*'], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    }
  } }), /authorization_request_invalid/);
  assert.throws(() => decisionFixture({ requestOverrides: {
    requested_scope: {
      scope_type: 'installation', installation_id: INSTALLATION_ID,
      tenant_ids: [], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    }
  } }), /authorization_request_invalid/);
});

test('caller authority booleans and unknown selectors cannot influence the decision', () => {
  const fixture = decisionFixture();
  const input = decisionInput(fixture);
  for (const field of [
    'authenticated', 'is_authenticated', 'authorized', 'is_authorized', 'grant_active',
    'is_active', 'scope_matches', 'capability_matches', 'subject_matches', 'approved',
    'budget_approved', 'execution_allowed'
  ]) {
    assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({ ...input, [field]: true }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED, field);
  }
  const unknownScope = {
    ...input.authorization_request,
    requested_scope: { ...input.authorization_request.requested_scope, unknown_selector: ['tenant-1'] }
  };
  assert.equal(evaluateCanonicalGovernanceAuthorizationDecision({ ...input, authorization_request: unknownScope }).decision, AUTHORIZATION_DECISION_STATUS.REJECTED);
});

test('decision is deterministic, immutable, and has no operational side effects', () => {
  const input = decisionInput();
  const first = evaluateCanonicalGovernanceAuthorizationDecision(input);
  const second = evaluateCanonicalGovernanceAuthorizationDecision({ ...input });
  assert.deepEqual(first, second);
  assert.deepEqual(canonicalAuthorizationDecisionBytes(first), canonicalAuthorizationDecisionBytes(second));
  assert.equal(authorizationDecisionDigest(first), first.authorization_decision_digest);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => { first.decision = 'EXECUTED'; }, TypeError);

  const source = fs.readFileSync(require.resolve('../src/core/canonical-governance-authorization-decision'), 'utf8');
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE)\b|fetch\s*\(|Math\.random|Date\.now|randomUUID|node:(?:net|http|https)/i);
});

test('decision contract stays closed and digest tampering is rejected', () => {
  const decision = evaluateCanonicalGovernanceAuthorizationDecision(decisionInput());
  assert.equal(validateAuthorizationDecision({ ...decision, unknown: true }).valid, false);
  assert.equal(validateAuthorizationDecision({ ...decision, authorization_decision_digest: `sha256:${'c'.repeat(64)}` }).valid, false);
  assert.equal(validateAuthorizationDecision({ ...decision, reason_code: 'AUTHORIZED' }).valid, false);
  assert.ok(AUTHORIZATION_REASON_CODES.includes(decision.reason_code));
});

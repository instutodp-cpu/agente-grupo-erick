'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { buildHermesMaintainerScmWriteIntent } = require('../src/core/hermes-maintainer-scm-write-intent');
const { fingerprintHermesMaintainerScmWriteIntent } = require('../src/core/hermes-maintainer-scm-write-intent-fingerprint');
const { buildHermesMaintainerScmWriteApprovalRequest } = require('../src/core/hermes-maintainer-scm-write-approval-request');
const { bindHermesMaintainerScmWriteApproval } = require('../src/core/hermes-maintainer-scm-write-approval-binding');
const { buildHermesMaintainerScmWriteAuthorizationRequest } = require('../src/core/hermes-maintainer-scm-write-authorization-request');
const { grantHermesMaintainerScmWriteAuthorization } = require('../src/core/hermes-maintainer-scm-write-authorization-grant');
const { buildHermesMaintainerSingleUseAuthorization } = require('../src/core/hermes-maintainer-single-use-execution-authorization');
const { prepareHermesMaintainerSafeWorkflowDurableTarget } = require('../src/core/hermes-maintainer-safe-workflow-durable-target');
const {
  BLOCKED,
  CAPABILITY_ID,
  CONTRACT_VERSION,
  ELIGIBLE,
  PROTECTED_ACTION_FIELDS,
  SOURCE_FAMILY,
  TARGET_TYPE,
  computeA3OperatorBindingDigest,
  computeA3TargetDigest,
  evaluateA3ScopedExternalActionEligibility,
  validateA3ScopedExternalActionEligibilityInput
} = require('../src/core/a3-scoped-external-action-eligibility');

const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const BASE_REF = 'main';
const BRANCH = 'hermes/a3-test-branch';
const BASE_SHA = 'd'.repeat(40);

function sourceChain() {
  const intent = buildHermesMaintainerScmWriteIntent({
    provider: 'GITHUB', operation: 'create_branch', repository: REPOSITORY,
    base_ref: BASE_REF, branch_name: BRANCH
  });
  const fingerprint = fingerprintHermesMaintainerScmWriteIntent(intent);
  const approvalRequest = buildHermesMaintainerScmWriteApprovalRequest(intent, fingerprint);
  const approvalBinding = bindHermesMaintainerScmWriteApproval(approvalRequest, {
    decision: 'APPROVED', intent_digest: approvalRequest.intent_digest,
    approval_reference: 'human-review-a3-1'
  });
  const authorizationRequest = buildHermesMaintainerScmWriteAuthorizationRequest(approvalBinding);
  const authorizationGrant = grantHermesMaintainerScmWriteAuthorization(authorizationRequest, {
    decision: 'AUTHORIZED', intent_digest: authorizationRequest.intent_digest,
    authorization_reference: 'control-plane-a3-1'
  });
  const stagingGate = {
    contract_version: 'hermes_maintainer_staging_gate_v1',
    mission_id: 'mission-a3-1', operation: 'create_branch', repository: REPOSITORY,
    base_ref: BASE_REF, status: 'MAINTAINER_STAGING_GATE_PASSED_SIMULATION',
    staging_gate_passed: true, real_execution_enabled: false, production_enabled: false,
    network_enabled: false, credentials_enabled: false, write_enabled: false,
    simulation: true, blockers: []
  };
  const singleUseAuthorization = buildHermesMaintainerSingleUseAuthorization(stagingGate, {
    authorization_id: 'single-use-a3-1',
    issued_at: '2026-10-16T02:55:00.000Z',
    expires_at: '2026-10-16T03:30:00.000Z'
  });
  return { approvalBinding, authorizationGrant, singleUseAuthorization };
}

function durableTarget(intentDigest) {
  const binding = {
    contract_version: 'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',
    mission_id: 'mission-a3-1', workflow_digest: `sha256:${'e'.repeat(64)}`,
    intent_digest: intentDigest, intent_count: 1,
    authorization_binding_digest: `sha256:${'f'.repeat(64)}`,
    workflow_operation: 'branch_prepare', durable_operation: 'create_branch',
    target_handoff_contract: 'hermes_maintainer_scm_write_durable_admission_handoff_v1',
    repository: REPOSITORY, base_ref: BASE_REF,
    ownership_source: 'DURABLE_PERSISTENCE_RECEIPT', ownership_key: 'a3-proof::attempt-ownership',
    persistence_key: 'a3-proof', attempt_reference: 'attempt-a3-1',
    status: 'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',
    ownership_bound: true, ownership_exclusive: true, durable_replay_protection: true,
    execution_eligible: false, execution_authorized: false, network_authorized: false,
    credentials_authorized: false, write_authorized: false, merge_authority: false,
    human_merge_required: true, simulation: true, production_allowed: false,
    executed: false, runtime_mutated: false, network_used: false, provider_called: false,
    secret_accessed: false, operational_authority_consumed: false, blockers: []
  };
  return prepareHermesMaintainerSafeWorkflowDurableTarget(binding, {
    operation: 'create_branch', repository: REPOSITORY, base_ref: BASE_REF,
    base_sha: BASE_SHA, branch_name: BRANCH
  });
}

function validInput() {
  const chain = sourceChain();
  const targetReference = {
    target_type: TARGET_TYPE,
    repository: REPOSITORY,
    base_ref: BASE_REF,
    base_sha: BASE_SHA,
    branch_name: BRANCH,
    target_digest: null
  };
  targetReference.target_digest = computeA3TargetDigest(targetReference);
  const operatorBinding = {
    operator_id: 'operator-a3-1',
    source_reference: 'operator-evidence-a3-1',
    identity_verified: true,
    scope_verified: true,
    operator_binding_digest: null
  };
  operatorBinding.operator_binding_digest = computeA3OperatorBindingDigest(operatorBinding);
  return {
    eligibility_id: 'a3-eligibility-1',
    capability_id: CAPABILITY_ID,
    environment: 'staging',
    operation: 'create_branch',
    target_reference: targetReference,
    action_intent_digest: chain.approvalBinding.intent_digest,
    operator_binding: operatorBinding,
    source_evidence: {
      family: SOURCE_FAMILY,
      approval_binding: chain.approvalBinding,
      authorization_grant: chain.authorizationGrant,
      single_use_authorization: chain.singleUseAuthorization,
      durable_target: durableTarget(chain.approvalBinding.intent_digest)
    },
    cost_control: { requested_units: 0, maximum_units: 0 },
    protected_actions: Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field => [field, false])),
    evaluation_time: '2026-10-16T03:00:00.000Z'
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('official approved + authorized + single-use maintainer chain is A3-eligible without granting execution', () => {
  const input = validInput();
  assert.deepEqual(validateA3ScopedExternalActionEligibilityInput(input), { valid: true, errors: [] });
  const result = evaluateA3ScopedExternalActionEligibility(input);
  assert.equal(result.contract_version, CONTRACT_VERSION);
  assert.equal(result.status, ELIGIBLE);
  assert.equal(result.a3_eligible, true);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.executed, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.a4_authority_granted, false);
  assert.equal(result.single_use_required, true);
  assert.equal(result.base_sha, BASE_SHA);
  assert.equal(result.durable_target_contract, 'hermes_maintainer_safe_workflow_durable_target_v1');
  assert.deepEqual(result.blockers, []);
  assert.match(result.eligibility_fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(Object.isFrozen(result), true);
});

test('production and unsupported capabilities fail closed', () => {
  const production = validInput();
  production.environment = 'production';
  assert.ok(evaluateA3ScopedExternalActionEligibility(production).blockers.includes('environment_must_be_staging'));

  const unsupported = validInput();
  unsupported.capability_id = 'generic-external-action';
  assert.ok(evaluateA3ScopedExternalActionEligibility(unsupported).blockers.includes('capability_not_supported'));
});

test('generic caller-declared authority cannot substitute the official source chain', () => {
  const input = validInput();
  input.source_evidence = {
    family: 'CALLER_SAYS_AUTHORIZED',
    approval_binding: { approved: true },
    authorization_grant: { authorized: true },
    single_use_authorization: { single_use: true }
  };
  const result = evaluateA3ScopedExternalActionEligibility(input);
  assert.equal(result.status, BLOCKED);
  assert.equal(result.a3_eligible, false);
  assert.ok(result.blockers.includes('source_evidence_family_not_supported'));
  assert.equal(result.execution_authorized, false);
});

test('human approval binding must be the official approved artifact and exact intent', () => {
  const missing = validInput();
  missing.source_evidence.approval_binding = {
    ...missing.source_evidence.approval_binding,
    human_approval_present: false
  };
  assert.ok(evaluateA3ScopedExternalActionEligibility(missing).blockers.includes('approval_binding_human_approval_required'));

  const drift = validInput();
  drift.action_intent_digest = `sha256:${'a'.repeat(64)}`;
  assert.ok(evaluateA3ScopedExternalActionEligibility(drift).blockers.includes('action_intent_not_bound_to_official_approval'));
});

test('SCM authorization grant must remain bound to the same approval, intent and target', () => {
  const input = validInput();
  input.source_evidence.authorization_grant = {
    ...input.source_evidence.authorization_grant,
    branch_name: 'hermes/other-branch'
  };
  const blockers = evaluateA3ScopedExternalActionEligibility(input).blockers;
  assert.ok(blockers.includes('approval_authorization_branch_name_mismatch'));
  assert.ok(blockers.includes('target_branch_name_not_bound_to_authorization_grant'));
});

test('single-use authorization must be official, unconsumed, unrevoked and unexpired', () => {
  const consumed = validInput();
  consumed.source_evidence.single_use_authorization = {
    ...consumed.source_evidence.single_use_authorization,
    consumed: true
  };
  assert.ok(evaluateA3ScopedExternalActionEligibility(consumed).blockers.includes('single_use_authorization_already_consumed'));

  const revoked = validInput();
  revoked.source_evidence.single_use_authorization = {
    ...revoked.source_evidence.single_use_authorization,
    revoked: true
  };
  assert.ok(evaluateA3ScopedExternalActionEligibility(revoked).blockers.includes('single_use_authorization_revoked'));

  const expired = validInput();
  expired.evaluation_time = expired.source_evidence.single_use_authorization.expires_at;
  assert.ok(evaluateA3ScopedExternalActionEligibility(expired).blockers.includes('single_use_authorization_expired'));
});

test('official single-use authorization fingerprint drift is rejected by its existing validator', () => {
  const input = validInput();
  input.source_evidence.single_use_authorization = {
    ...input.source_evidence.single_use_authorization,
    repository: 'other/repository'
  };
  const blockers = evaluateA3ScopedExternalActionEligibility(input).blockers;
  assert.ok(blockers.some(item => item === 'single_use_authorization_invalid::authorization_fingerprint_invalid'));
  assert.ok(blockers.includes('authorization_chain_repository_mismatch'));
});

test('target and operation must match the official authorization chain exactly', () => {
  const target = validInput();
  target.target_reference.branch_name = 'hermes/other-target';
  target.target_reference.target_digest = computeA3TargetDigest(target.target_reference);
  assert.ok(evaluateA3ScopedExternalActionEligibility(target).blockers.includes('target_branch_name_not_bound_to_authorization_grant'));

  const operation = validInput();
  operation.operation = 'update_file';
  assert.ok(evaluateA3ScopedExternalActionEligibility(operation).blockers.includes('operation_not_bound_to_authorization_chain'));
});

test('base SHA must be exact and bound to the official durable target', () => {
  const input = validInput();
  input.target_reference.base_sha = 'c'.repeat(40);
  input.target_reference.target_digest = computeA3TargetDigest(input.target_reference);
  const blockers = evaluateA3ScopedExternalActionEligibility(input).blockers;
  assert.ok(blockers.includes('durable_target_base_sha_mismatch'));

  const targetDrift = validInput();
  targetDrift.source_evidence.durable_target = {
    ...targetDrift.source_evidence.durable_target,
    intent_digest: `sha256:${'0'.repeat(64)}`
  };
  assert.ok(evaluateA3ScopedExternalActionEligibility(targetDrift).blockers.includes('durable_target_intent_mismatch'));
});

test('operator binding is explicit, digest-bound and cannot be replaced by a boolean', () => {
  const input = validInput();
  input.operator_binding.operator_id = 'operator-tampered';
  assert.ok(evaluateA3ScopedExternalActionEligibility(input).blockers.includes('operator_binding_digest_mismatch'));

  const unknown = { ...validInput(), operator_authorized: true };
  assert.equal(validateA3ScopedExternalActionEligibilityInput(unknown).valid, false);
});

test('cost must remain within explicit bounded budget', () => {
  const input = validInput();
  input.cost_control = { requested_units: 2, maximum_units: 1 };
  const result = evaluateA3ScopedExternalActionEligibility(input);
  assert.ok(result.blockers.includes('cost_budget_exceeded'));
  assert.equal(result.a3_eligible, false);
});

test('every protected A4 authority blocks independently', () => {
  for (const field of PROTECTED_ACTION_FIELDS) {
    const input = validInput();
    input.protected_actions[field] = true;
    const result = evaluateA3ScopedExternalActionEligibility(input);
    assert.ok(result.blockers.includes(`a4_boundary_forbidden::${field}`), field);
    assert.equal(result.a4_authority_granted, false);
  }
});

test('wildcard-like target selectors and unknown fields fail closed', () => {
  const input = validInput();
  input.target_reference.branch_name = 'hermes/*';
  input.target_reference.target_digest = computeA3TargetDigest(input.target_reference);
  const validation = validateA3ScopedExternalActionEligibilityInput(input);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('target_branch_name_invalid'));

  const extra = { ...validInput(), caller_authorized: true };
  assert.equal(validateA3ScopedExternalActionEligibilityInput(extra).valid, false);
});

test('implementation remains pure and is not imported by runtime endpoints', () => {
  const source = fs.readFileSync(require.resolve('../src/core/a3-scoped-external-action-eligibility'), 'utf8');
  assert.doesNotMatch(source, /require\(['"]node:(?:fs|http|https|net|tls|dns|child_process)['"]\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /process\.env/);
  assert.doesNotMatch(source, /Date\.now\s*\(/);
  assert.doesNotMatch(source, /Math\.random\s*\(/);
  assert.doesNotMatch(source, /setTimeout|setInterval|setImmediate/);

  const runtimeRoot = require('node:path').resolve(__dirname, '../src/runtime');
  for (const file of fs.readdirSync(runtimeRoot)) {
    if (!file.endsWith('.js')) continue;
    const runtimeSource = fs.readFileSync(require('node:path').join(runtimeRoot, file), 'utf8');
    assert.doesNotMatch(runtimeSource, /a3-scoped-external-action-eligibility/, file);
  }
});

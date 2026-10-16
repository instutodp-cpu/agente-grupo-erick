'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  PROTECTED_ACTION_FIELDS,
  TARGET_TYPE,
  CAPABILITY_ID,
  SOURCE_FAMILY,
  computeA3TargetDigest,
  computeA3OperatorBindingDigest
} = require('../src/core/a3-scoped-external-action-eligibility');
const {
  ADMITTED,
  BLOCKED,
  evaluateA3PreExecutionAdmission
} = require('../src/core/a3-scoped-external-action-pre-execution-admission');

const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const BASE_REF = 'main';
const BRANCH = 'hermes/canary/a3-admission-proof';
const BASE_SHA = '4c8de5e053c9c056e1a2fa00a463346533d56fe4';

function buildEvidence() {
  const intent = buildHermesMaintainerScmWriteIntent({
    provider: 'GITHUB', operation: 'create_branch', repository: REPOSITORY,
    base_ref: BASE_REF, branch_name: BRANCH
  });
  const fingerprint = fingerprintHermesMaintainerScmWriteIntent(intent);
  const approvalRequest = buildHermesMaintainerScmWriteApprovalRequest(intent, fingerprint);
  const approval = bindHermesMaintainerScmWriteApproval(approvalRequest, {
    decision: 'APPROVED', intent_digest: fingerprint.intent_digest,
    approval_reference: 'human-a3-pre-execution-admission'
  });
  const authorizationRequest = buildHermesMaintainerScmWriteAuthorizationRequest(approval);
  const grant = grantHermesMaintainerScmWriteAuthorization(authorizationRequest, {
    decision: 'AUTHORIZED', intent_digest: fingerprint.intent_digest,
    authorization_reference: 'control-a3-pre-execution-admission'
  });
  const stagingGate = {
    contract_version: 'hermes_maintainer_staging_gate_v1',
    mission_id: 'mission-a3-pre-execution-admission',
    operation: 'create_branch', repository: REPOSITORY, base_ref: BASE_REF,
    status: 'MAINTAINER_STAGING_GATE_PASSED_SIMULATION', staging_gate_passed: true,
    real_execution_enabled: false, production_enabled: false, network_enabled: false,
    credentials_enabled: false, write_enabled: false, simulation: true, blockers: []
  };
  const singleUse = buildHermesMaintainerSingleUseAuthorization(stagingGate, {
    authorization_id: 'single-a3-pre-execution-admission',
    issued_at: '2026-10-16T03:00:00.000Z', expires_at: '2026-10-16T04:00:00.000Z'
  });
  const ownership = {
    contract_version: 'hermes_maintainer_safe_workflow_durable_ownership_binding_v1',
    mission_id: 'mission-a3-pre-execution-admission',
    workflow_digest: `sha256:${'1'.repeat(64)}`,
    intent_digest: fingerprint.intent_digest,
    intent_count: 1,
    authorization_binding_digest: `sha256:${'2'.repeat(64)}`,
    workflow_operation: 'branch_prepare', durable_operation: 'create_branch',
    target_handoff_contract: 'hermes_maintainer_scm_write_durable_admission_handoff_v1',
    repository: REPOSITORY, base_ref: BASE_REF,
    ownership_source: 'DURABLE_PERSISTENCE_RECEIPT',
    ownership_key: 'a3-pre-execution-admission::ownership',
    persistence_key: 'a3-pre-execution-admission',
    attempt_reference: 'attempt-a3-pre-execution-admission',
    status: 'MAINTAINER_SAFE_WORKFLOW_DURABLE_OWNERSHIP_BOUND_SIMULATION',
    ownership_bound: true, ownership_exclusive: true, durable_replay_protection: true,
    execution_eligible: false, execution_authorized: false, network_authorized: false,
    credentials_authorized: false, write_authorized: false, merge_authority: false,
    human_merge_required: true, simulation: true, production_allowed: false,
    executed: false, runtime_mutated: false, network_used: false, provider_called: false,
    secret_accessed: false, operational_authority_consumed: false, blockers: []
  };
  const durableTarget = prepareHermesMaintainerSafeWorkflowDurableTarget(ownership, {
    operation: 'create_branch', repository: REPOSITORY, base_ref: BASE_REF,
    base_sha: BASE_SHA, branch_name: BRANCH
  });
  return { approval, grant, singleUse, durableTarget, intentDigest: fingerprint.intent_digest };
}

function admissionInput() {
  const evidence = buildEvidence();
  const target = {
    target_type: TARGET_TYPE, repository: REPOSITORY, base_ref: BASE_REF,
    base_sha: BASE_SHA, branch_name: BRANCH, target_digest: null
  };
  target.target_digest = computeA3TargetDigest(target);
  const operator = {
    operator_id: 'operator-a3-pre-execution-admission',
    source_reference: 'operator-proof-a3-pre-execution-admission',
    identity_verified: true, scope_verified: true, operator_binding_digest: null
  };
  operator.operator_binding_digest = computeA3OperatorBindingDigest(operator);
  return {
    admission_id: 'a3-pre-execution-admission-proof',
    eligibility_input: {
      eligibility_id: 'a3-pre-execution-eligibility-proof', capability_id: CAPABILITY_ID,
      environment: 'staging', operation: 'create_branch', target_reference: target,
      action_intent_digest: evidence.intentDigest, operator_binding: operator,
      source_evidence: {
        family: SOURCE_FAMILY,
        approval_binding: evidence.approval,
        authorization_grant: evidence.grant,
        single_use_authorization: evidence.singleUse,
        durable_target: evidence.durableTarget
      },
      cost_control: { requested_units: 0, maximum_units: 0 },
      protected_actions: Object.fromEntries(PROTECTED_ACTION_FIELDS.map(field => [field, false])),
      evaluation_time: '2026-10-16T03:15:00.000Z'
    },
    canary_request: {
      repository: REPOSITORY, operation: 'create_branch',
      ref: `refs/heads/${BRANCH}`, sha: BASE_SHA
    }
  };
}

function mutableCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

test('admits exact official eligibility + bounded canary target without granting execution', () => {
  const result = evaluateA3PreExecutionAdmission(admissionInput());
  assert.equal(result.status, ADMITTED);
  assert.equal(result.admission_valid, true);
  assert.equal(result.environment, 'staging');
  assert.equal(result.repository, REPOSITORY);
  assert.equal(result.operation, 'create_branch');
  assert.equal(result.ref, `refs/heads/${BRANCH}`);
  assert.equal(result.sha, BASE_SHA);
  assert.equal(result.authorization_consumed, false);
  assert.equal(result.authorization_revoked, false);
  assert.equal(result.execution_authorized, false);
  assert.equal(result.execution_started, false);
  assert.equal(result.executed, false);
  assert.equal(result.provider_invoked, false);
  assert.equal(result.external_network_called, false);
  assert.equal(result.network_call_performed, false);
  assert.equal(result.write_performed, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.a3_promoted, false);
  assert.equal(result.a4_authority_granted, false);
  assert.deepEqual(result.blockers, []);
});

test('fails closed on unknown admission fields', () => {
  const input = admissionInput();
  input.unexpected = true;
  const result = evaluateA3PreExecutionAdmission(input);
  assert.equal(result.status, BLOCKED);
  assert.equal(result.admission_valid, false);
  assert.ok(result.blockers.some(error => error.includes('admission_input')));
  assert.equal(result.execution_authorized, false);
  assert.equal(result.write_performed, false);
});

test('fails closed when canary SHA differs from the exact durable target SHA', () => {
  const input = admissionInput();
  input.canary_request.sha = 'b'.repeat(40);
  const result = evaluateA3PreExecutionAdmission(input);
  assert.equal(result.admission_valid, false);
  assert.ok(result.blockers.includes('canary_sha_not_bound_to_durable_base_sha'));
  assert.equal(result.network_call_performed, false);
  assert.equal(result.write_performed, false);
});

test('fails closed when canary ref differs from the eligibility branch', () => {
  const input = admissionInput();
  input.canary_request.ref = 'refs/heads/hermes/canary/other-proof';
  const result = evaluateA3PreExecutionAdmission(input);
  assert.equal(result.admission_valid, false);
  assert.ok(result.blockers.includes('canary_ref_not_bound_to_eligibility_branch'));
});

test('fails closed when the official single-use authorization is expired', () => {
  const input = mutableCopy(admissionInput());
  input.eligibility_input.evaluation_time = '2026-10-16T04:00:00.000Z';
  const result = evaluateA3PreExecutionAdmission(input);
  assert.equal(result.admission_valid, false);
  assert.ok(result.blockers.some(error => error.includes('single_use_authorization_expired')));
  assert.equal(result.execution_authorized, false);
});

test('fails closed when an A4 protected action is requested', () => {
  const input = admissionInput();
  input.eligibility_input.protected_actions.merge_main = true;
  const result = evaluateA3PreExecutionAdmission(input);
  assert.equal(result.admission_valid, false);
  assert.ok(result.blockers.some(error => error.includes('a4_boundary_forbidden::merge_main')));
  assert.equal(result.a4_authority_granted, false);
});

test('pre-execution admission boundary is not imported by runtime source files', () => {
  const srcRoot = path.join(__dirname, '..', 'src');
  const ownFile = path.join(srcRoot, 'core', 'a3-scoped-external-action-pre-execution-admission.js');
  const hits = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js') && absolute !== ownFile) {
        const content = fs.readFileSync(absolute, 'utf8');
        if (content.includes("a3-scoped-external-action-pre-execution-admission")) hits.push(path.relative(srcRoot, absolute));
      }
    }
  }
  walk(srcRoot);
  assert.deepEqual(hits, []);
});

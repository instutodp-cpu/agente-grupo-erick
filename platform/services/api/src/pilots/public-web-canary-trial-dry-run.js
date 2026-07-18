'use strict';

const publicWebAdapter = require('../adapters/public-web/public-web-read-only-adapter');
const { createReadOnlyAdapterRegistry } = require('../core/read-only-adapter-registry');
const { createLocalTestSecretResolver } = require('../core/provider-secret-resolver');
const { createPublicWebCanaryAuditSink } = require('../core/public-web-canary-audit-sink');
const { createPublicWebCanaryOperatorPolicy } = require('../core/public-web-canary-operator-policy');
const { buildPublicWebCanaryReport } = require('../core/public-web-canary-report');
const { createPublicWebCanarySessionRegistry } = require('../core/public-web-canary-session-registry');
const { hashCanaryEvidence } = require('../core/public-web-canary-session-contract');
const { createPublicWebCanaryTargetAllowlist } = require('../core/public-web-canary-target-allowlist');
const { createPublicWebPilotBudget } = require('../core/public-web-pilot-gate');
const { createPublicWebCanaryRunner } = require('./public-web-canary-runner');
const { runPublicWebCanaryTrialCleanup } = require('./public-web-canary-trial-cleanup');
const {
  ADAPTER_ID,
  CONFIGURATION_ID,
  CONNECTOR_ID,
  PROVIDER_ID,
  READINESS_CANDIDATE_ID
} = require('../core/public-web-transport-contract');
const { hashTrialEvidence, sanitizeTrialData } = require('../core/public-web-canary-trial-contract');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : String(value);
}

function plusMinutes(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60 * 1000).toISOString();
}

function defaultAdapterRegistry() {
  const registry = createReadOnlyAdapterRegistry();
  registry.registerAdapter(publicWebAdapter);
  return registry;
}

function defaultLifecycleRegistry(plan, version) {
  const connector = Object.freeze({
    connector_id: CONNECTOR_ID,
    provider_id: PROVIDER_ID,
    adapter_id: ADAPTER_ID,
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    lifecycle_state: 'readiness_passed',
    lifecycle_version: version,
    feature_flag_key: plan.feature_flag_key,
    kill_switch_key: plan.kill_switch_key
  });
  return Object.freeze({
    getConnector(id) {
      return id === connector.connector_id ? clone(connector) : null;
    }
  });
}

function defaultConfigurationRegistry(plan, version, secretReferenceId) {
  const configuration = Object.freeze({
    configuration_id: CONFIGURATION_ID,
    connector_id: CONNECTOR_ID,
    provider_id: PROVIDER_ID,
    adapter_id: ADAPTER_ID,
    readiness_candidate_id: READINESS_CANDIDATE_ID,
    workspace_type: plan.workspace_type,
    tenant_id: plan.tenant_id,
    user_id: plan.user_id,
    configuration_status: 'structurally_ready',
    configuration_version: version,
    secret_reference_descriptors: [{ reference_id: secretReferenceId, reference_type: 'local_test_double_reference' }]
  });
  return Object.freeze({
    getConfiguration(id) {
      return id === configuration.configuration_id ? clone(configuration) : null;
    }
  });
}

function defaultSecretReferenceRegistry(plan, secretReferenceId) {
  const reference = Object.freeze({
    reference_id: secretReferenceId,
    reference_type: 'local_test_double_reference',
    provider_id: PROVIDER_ID,
    workspace_type: plan.workspace_type,
    tenant_id: plan.tenant_id,
    environment: 'local_test',
    status: 'reference_registered',
    reference_version: 1,
    synthetic: true,
    disabled: false,
    revoked: false,
    created_at: nowIso({ clock: () => plan.created_at || new Date(0).toISOString() }),
    updated_at: nowIso({ clock: () => plan.created_at || new Date(0).toISOString() }),
    last_rotated_at: nowIso({ clock: () => plan.created_at || new Date(0).toISOString() }),
    expires_at: plusMinutes(plan.created_at || new Date(0).toISOString(), 60),
    rotation_due_at: plusMinutes(plan.created_at || new Date(0).toISOString(), 45),
    required_secret_names: ['public_web_test_handle'],
    metadata: { label: 'synthetic public web dry-run reference' }
  });
  return Object.freeze({
    getSecretReference(id) {
      return id === reference.reference_id ? clone(reference) : null;
    }
  });
}

function fakeDnsResolver() {
  return Object.freeze({
    async resolve() {
      return { allowed: true, approved_ip: '93.184.216.34', approved_ips: ['93.184.216.34'] };
    },
    resolveSyncForPolicy() {
      return ['93.184.216.34'];
    }
  });
}

function fakeNodeHttpsClient(response = {}) {
  let calls = 0;
  return Object.freeze({
    async execute(request) {
      calls += 1;
      if (response.throw_error) throw new Error('synthetic dry-run network error');
      return {
        status_code: 200,
        content_type: 'text/html',
        content_length: 96,
        remote_address: request.approved_ip,
        body_stream: (async function* stream() {
          yield '<html><title>Public Canary</title><p>Conteudo publico sintetico.</p></html>';
        }()),
        redirects: [],
        ...response
      };
    },
    calls() {
      return calls;
    }
  });
}

function ensureTargetPolicy(plan, context, suffix = 'operational') {
  const allowlist = context.targetAllowlist;
  if (!allowlist || typeof allowlist.registerTargetPolicy !== 'function') return { ok: true, target_policy: null, reused: true };
  if (typeof allowlist.getTargetPolicy === 'function') {
    const existing = allowlist.getTargetPolicy(plan.target_policy_id);
    if (existing) return { ok: true, target_policy: existing, reused: true };
  }
  const registered = allowlist.registerTargetPolicy({
    target_policy_id: plan.target_policy_id,
    environment: plan.environment,
    origin: plan.target_origin,
    allowed_path_prefixes: [plan.target_path],
    allowed_operations: [plan.operation],
    allowed_source_types: [plan.source_type],
    allowed_content_types: plan.requested_content_types,
    maximum_requests: plan.maximum_requests,
    maximum_response_bytes: plan.maximum_response_bytes,
    timeout_ms: plan.timeout_ms,
    redirects_allowed: false,
    enabled: true,
    revoked: false,
    expires_at: plan.session_expires_at || plusMinutes(nowIso(context), 30),
    approved_by: plan.approver_id,
    created_at: nowIso(context),
    version: 1,
    change_id: `${plan.trial_id}_${suffix}_target_policy`
  });
  return registered.ok ? { ...registered, reused: false } : registered;
}

function createSyntheticCanaryContext(plan, overrides = {}) {
  const lifecycleVersion = overrides.lifecycle_version || (overrides.preflight && overrides.preflight.binding_snapshot && overrides.preflight.binding_snapshot.lifecycle_version) || 1;
  const configurationVersion = overrides.configuration_version || (overrides.preflight && overrides.preflight.binding_snapshot && overrides.preflight.binding_snapshot.configuration_version) || 1;
  let readinessResult = overrides.readinessResult || {
    candidate_id: READINESS_CANDIDATE_ID,
    provider_id: PROVIDER_ID,
    adapter_id: ADAPTER_ID,
    ready: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false
  };
  const snapshotReadinessId = overrides.preflight && overrides.preflight.binding_snapshot && overrides.preflight.binding_snapshot.readiness_evidence_id;
  if (snapshotReadinessId && hashCanaryEvidence(readinessResult) !== snapshotReadinessId && overrides.readinessResult) {
    readinessResult = overrides.readinessResult;
  }
  const secretReferenceId = overrides.secret_reference_id || (overrides.preflight && overrides.preflight.binding_snapshot && overrides.preflight.binding_snapshot.secret_reference_id) || `${plan.trial_id}_secret_reference`;
  const targetAllowlist = overrides.targetAllowlist || createPublicWebCanaryTargetAllowlist({ clock: overrides.clock || (() => nowIso(overrides)) });
  const context = {
    canarySessionRegistry: overrides.canarySessionRegistry || createPublicWebCanarySessionRegistry({ clock: overrides.clock }),
    targetAllowlist,
    adapterRegistry: overrides.adapterRegistry || defaultAdapterRegistry(),
    lifecycleRegistry: overrides.lifecycleRegistry || defaultLifecycleRegistry(plan, lifecycleVersion),
    configurationRegistry: overrides.configurationRegistry || defaultConfigurationRegistry(plan, configurationVersion, secretReferenceId),
    secretReferenceRegistry: overrides.secretReferenceRegistry || defaultSecretReferenceRegistry(plan, secretReferenceId),
    secretResolver: overrides.secretResolver || createLocalTestSecretResolver({ now: nowIso(overrides) }),
    readinessResult,
    nodeHttpsClient: overrides.nodeHttpsClient || fakeNodeHttpsClient(overrides.fakeHttpsResponse),
    dnsResolver: overrides.dnsResolver || fakeDnsResolver(),
    rateLimitBudget: overrides.rateLimitBudget || createPublicWebPilotBudget({ clock: overrides.clock }),
    costBudget: overrides.costBudget || createPublicWebPilotBudget({ clock: overrides.clock }),
    featureFlagResolver: overrides.featureFlagResolver || (() => true),
    killSwitchResolver: overrides.killSwitchResolver || (() => false),
    tenantAllowlist: overrides.tenantAllowlist || [plan.tenant_id],
    workspaceAllowlist: overrides.workspaceAllowlist || [plan.workspace_type],
    userAllowlist: overrides.userAllowlist || [plan.user_id],
    operatorPolicy: overrides.operatorPolicy || createPublicWebCanaryOperatorPolicy(),
    auditSink: overrides.auditSink || createPublicWebCanaryAuditSink(),
    clock: overrides.clock,
    preflight: overrides.preflight
  };
  context.readiness_evidence_id = overrides.readiness_evidence_id || hashCanaryEvidence(context.readinessResult);
  return context;
}

function buildCanaryRequestFromPlan(plan, context, ids = {}) {
  const preflightSnapshot = context.preflight && context.preflight.binding_snapshot || {};
  return sanitizeTrialData({
    trace_id: ids.trace_id || `${plan.trial_id}_trace`,
    request_id: ids.request_id || `${plan.trial_id}_request_canary`,
    change_id: ids.change_id || `${plan.trial_id}_change_canary`,
    canary_session_id: plan.canary_session_id,
    connector_id: plan.connector_id,
    configuration_id: plan.configuration_id,
    adapter_id: plan.adapter_id,
    provider_id: plan.provider_id,
    readiness_candidate_id: plan.readiness_candidate_id,
    workspace_type: plan.workspace_type,
    tenant_id: plan.tenant_id,
    user_id: plan.user_id,
    operator_id: plan.operator_id,
    operator_role: plan.operator_role,
    environment: plan.environment,
    target_origin: plan.target_origin,
    target_path: plan.target_path,
    source_type: plan.source_type,
    operation: plan.operation,
    feature_flag_key: plan.feature_flag_key,
    feature_flag_enabled: true,
    kill_switch_key: plan.kill_switch_key,
    kill_switch_active: false,
    rollout_percentage: plan.rollout_percentage,
    maximum_requests: plan.maximum_requests,
    lifecycle_version: preflightSnapshot.lifecycle_version || plan.lifecycle_version,
    configuration_version: preflightSnapshot.configuration_version || plan.configuration_version,
    readiness_evidence_id: context.readiness_evidence_id || preflightSnapshot.readiness_evidence_id || plan.readiness_evidence_id,
    secret_reference_id: preflightSnapshot.secret_reference_id || plan.secret_reference_id,
    reason: plan.reason,
    requested_at: nowIso(context),
    expires_at: plan.session_expires_at,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
}

function buildApprovalFromSession(plan, session, context, ids = {}) {
  return sanitizeTrialData({
    trace_id: ids.approval_trace_id || `${plan.trial_id}_approval_trace`,
    request_id: ids.approval_request_id || `${plan.trial_id}_approval_request`,
    change_id: ids.approval_change_id || `${plan.trial_id}_approval_change`,
    canary_session_id: session.canary_session_id,
    session_id: session.canary_session_id,
    approval_id: ids.approval_id || `${plan.trial_id}_approval`,
    approved_by: plan.approver_id,
    approver_role: plan.approver_role,
    reason: plan.reason,
    scope: {
      canary_session_id: session.canary_session_id,
      tenant_id: session.tenant_id,
      workspace_type: session.workspace_type,
      user_id: session.user_id,
      target_origin: session.target_origin,
      operation: session.operation
    },
    environment: session.environment,
    target_origin: session.target_origin,
    target_path_hash: session.target_path_hash,
    operation: session.operation,
    source_type: session.source_type,
    maximum_requests: session.maximum_requests,
    rollout_percentage: session.rollout_percentage,
    tenant_id: session.tenant_id,
    workspace_type: session.workspace_type,
    user_id: session.user_id,
    feature_flag_enabled: true,
    kill_switch_active: false,
    evidence_snapshot_hash: session.readiness_evidence_id,
    lifecycle_version: session.lifecycle_version,
    configuration_version: session.configuration_version,
    approved_at: nowIso(context),
    expires_at: plan.approval_expires_at || session.expires_at,
    expected_version: session.version,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
}

function prepareOperationalCanarySession(plan, context = {}, ids = {}) {
  const targetPolicy = ensureTargetPolicy(plan, context, ids.suffix);
  if (!targetPolicy.ok) return { ok: false, stage: 'target_policy', result: targetPolicy };
  const request = buildCanaryRequestFromPlan(plan, context, ids);
  const created = context.canarySessionRegistry.requestCanary(request);
  if (!created.ok) return { ok: false, stage: 'request', result: created, request };
  const validated = context.canarySessionRegistry.validateCanary({
    canary_session_id: request.canary_session_id,
    change_id: `${request.change_id}:validate`,
    request_id: `${request.request_id}:validate`,
    expected_version: created.session.version
  }, context);
  if (!validated.ok) return { ok: false, stage: 'validate', result: validated, request };
  const approval = buildApprovalFromSession(plan, validated.session, context, ids);
  const approved = context.canarySessionRegistry.approveCanary(approval, context);
  if (!approved.ok) return { ok: false, stage: 'approve', result: approved, request, approval };
  const active = context.canarySessionRegistry.activateCanary({
    canary_session_id: request.canary_session_id,
    change_id: `${request.change_id}:activate`,
    request_id: `${request.request_id}:activate`,
    expected_version: approved.session.version
  }, context);
  if (!active.ok) return { ok: false, stage: 'activate', result: active, request, approval };
  return sanitizeTrialData({
    ok: true,
    request,
    approval,
    session: active.session,
    target_policy: targetPolicy.target_policy || (typeof context.targetAllowlist.getTargetPolicy === 'function' ? context.targetAllowlist.getTargetPolicy(plan.target_policy_id) : null)
  });
}

function buildRunnerRequest(plan, session, ids = {}) {
  return sanitizeTrialData({
    trace_id: ids.trace_id || `${plan.trial_id}_execution_trace`,
    request_id: ids.request_id || `${plan.trial_id}_execution_request`,
    change_id: ids.change_id || `${plan.trial_id}_execution_change`,
    canary_execution_id: ids.canary_execution_id || `${plan.trial_id}_execution`,
    canary_session_id: session.canary_session_id,
    target_path: session.target_path,
    expected_version: session.version,
    requested_content_types: plan.requested_content_types,
    timeout_ms: plan.timeout_ms,
    max_response_bytes: plan.maximum_response_bytes,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
}

async function runTrialDryRun(plan, context = {}) {
  const dryContext = createSyntheticCanaryContext(plan, {
    clock: context.clock,
    preflight: context.preflight,
    readinessResult: context.readinessResult,
    adapterRegistry: context.adapterRegistry,
    lifecycleRegistry: context.lifecycleRegistry,
    configurationRegistry: context.configurationRegistry,
    secretReferenceRegistry: context.secretReferenceRegistry,
    secretResolver: context.secretResolver,
    fakeHttpsResponse: context.fakeHttpsResponse
  });
  const prepared = prepareOperationalCanarySession(plan, dryContext, {
    suffix: 'dry_run',
    trace_id: `${plan.trial_id}_dry_run_trace`,
    request_id: `${plan.trial_id}_dry_run_request`,
    change_id: `${plan.trial_id}_dry_run_change`,
    approval_id: `${plan.trial_id}_dry_run_approval`
  });
  if (!prepared.ok) {
    return sanitizeTrialData({
      status: 'dry_run_failed',
      dry_run_passed: false,
      blocking_reasons: [`dry_run_${prepared.stage}_blocked`],
      fake_provider_calls: 0,
      fake_network_called: false,
      executed: false,
      real_provider_called: false,
      simulated: true,
      plan_hash: plan.plan_hash,
      evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash, prepared })
    });
  }
  const runner = createPublicWebCanaryRunner(dryContext);
  const runnerRequest = buildRunnerRequest(plan, prepared.session, {
    trace_id: `${plan.trial_id}_dry_run_execution_trace`,
    request_id: `${plan.trial_id}_dry_run_execution_request`,
    change_id: `${plan.trial_id}_dry_run_execution_change`,
    canary_execution_id: `${plan.trial_id}_dry_run_execution`
  });
  const result = await runner.runCanaryRequest(runnerRequest);
  const fakeCalls = dryContext.nodeHttpsClient && typeof dryContext.nodeHttpsClient.calls === 'function' ? dryContext.nodeHttpsClient.calls() : 0;
  const replay = await runner.runCanaryRequest(runnerRequest);
  const replayCalls = dryContext.nodeHttpsClient && typeof dryContext.nodeHttpsClient.calls === 'function' ? dryContext.nodeHttpsClient.calls() : 0;

  const killContext = createSyntheticCanaryContext(plan, {
    clock: context.clock,
    canarySessionRegistry: createPublicWebCanarySessionRegistry({ clock: context.clock }),
    targetAllowlist: createPublicWebCanaryTargetAllowlist({ clock: context.clock }),
    nodeHttpsClient: fakeNodeHttpsClient(),
    readinessResult: context.readinessResult,
    adapterRegistry: context.adapterRegistry,
    lifecycleRegistry: context.lifecycleRegistry,
    configurationRegistry: context.configurationRegistry,
    secretReferenceRegistry: context.secretReferenceRegistry,
    secretResolver: context.secretResolver,
    killSwitchResolver: () => false,
    preflight: context.preflight
  });
  const killPrepared = prepareOperationalCanarySession({ ...plan, canary_session_id: `${plan.canary_session_id}_kill_check` }, killContext, {
    suffix: 'dry_run_kill',
    trace_id: `${plan.trial_id}_dry_run_kill_trace`,
    request_id: `${plan.trial_id}_dry_run_kill_request`,
    change_id: `${plan.trial_id}_dry_run_kill_change`,
    approval_id: `${plan.trial_id}_dry_run_kill_approval`
  });
  let killResult = null;
  if (killPrepared.ok) {
    killContext.killSwitchResolver = () => true;
    killResult = await createPublicWebCanaryRunner(killContext).runCanaryRequest(buildRunnerRequest(plan, killPrepared.session, {
      trace_id: `${plan.trial_id}_dry_run_kill_execution_trace`,
      request_id: `${plan.trial_id}_dry_run_kill_execution_request`,
      change_id: `${plan.trial_id}_dry_run_kill_execution_change`,
      canary_execution_id: `${plan.trial_id}_dry_run_kill_execution`
    }));
  }
  const killCalls = killContext.nodeHttpsClient && typeof killContext.nodeHttpsClient.calls === 'function' ? killContext.nodeHttpsClient.calls() : 0;
  const cleanup = await runPublicWebCanaryTrialCleanup({ ...plan, canary_session_id: prepared.session.canary_session_id }, dryContext);
  const finalSession = dryContext.canarySessionRegistry.getCanarySession(prepared.session.canary_session_id);
  const report = buildPublicWebCanaryReport(finalSession, dryContext.auditSink.list({ canary_session_id: prepared.session.canary_session_id }));
  const passed = result.status === 'public_web_candidate_success' &&
    fakeCalls === 1 &&
    replayCalls === 1 &&
    replay.real_provider_called === false &&
    killPrepared.ok === true &&
    killResult &&
    killResult.error &&
    killResult.error.error_code === 'CANARY_KILL_SWITCH_ACTIVE' &&
    killCalls === 0 &&
    cleanup.status === 'cleanup_completed' &&
    finalSession &&
    !['active', 'executing'].includes(finalSession.canary_state) &&
    report.provider_calls === 1;

  const dryRun = sanitizeTrialData({
    status: passed ? 'dry_run_passed' : 'dry_run_failed',
    dry_run_passed: passed,
    blocking_reasons: passed ? [] : ['dry_run_real_harness_assertion_failed'],
    plan_hash: plan.plan_hash,
    evidence_hash: hashTrialEvidence({ plan_hash: plan.plan_hash, fakeCalls, replayCalls, killCalls, cleanup, report }),
    fake_provider_calls: fakeCalls,
    fake_network_called: fakeCalls === 1,
    expected_state: 'completed',
    actual_state: finalSession && finalSession.canary_state,
    canary_session_id: prepared.session.canary_session_id,
    canary_session_version: prepared.session.version,
    replay_blocked: replay.real_provider_called === false,
    kill_switch_blocked: killResult && killResult.error && killResult.error.error_code === 'CANARY_KILL_SWITCH_ACTIVE',
    audit_event_count: dryContext.auditSink.list({ canary_session_id: prepared.session.canary_session_id }).length,
    report_hash: hashTrialEvidence(report),
    cleanup_status: cleanup.status,
    executed: true,
    real_provider_called: false,
    simulated: true
  });
  if (dryContext.auditSink && typeof dryContext.auditSink.append === 'function') dryContext.auditSink.append({ event_name: 'public_web_canary_trial_dry_run', ...dryRun, trial_id: plan.trial_id });
  return dryRun;
}

function createPublicWebCanaryTrialDryRun(options = {}) {
  return Object.freeze({
    runTrialDryRun(plan, context = {}) {
      return runTrialDryRun(plan, { ...options, ...context });
    }
  });
}

module.exports = {
  buildCanaryRequestFromPlan,
  buildRunnerRequest,
  createPublicWebCanaryTrialDryRun,
  createSyntheticCanaryContext,
  fakeNodeHttpsClient,
  prepareOperationalCanarySession,
  runTrialDryRun
};

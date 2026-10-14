'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  VERSION, PROVIDER, REQUIRED_DENIED_ACTIONS,
  validateOperationalMissionEnvelope,
  buildOperationalMissionTrialConfig
} = require('../src/core/public-web-operational-mission-envelope');

function contract(overrides = {}) {
  const base = {
    contract_version:'1.0', mission_id:'mission-1', run_id:null, workspace_id:'workspace-1', project_id:null,
    objective:'Ler uma pagina publica e produzir um resumo seguro.',
    context:JSON.stringify({public_web:{
      target_url:'https://example.com/docs', operation:'fetch_public_page_summary', source_type:'public_documentation_page',
      requested_content_types:['text/html','text/plain'], maximum_requests:1, redirects_allowed:false,
      timeout_ms:5000, maximum_response_bytes:100000
    }}),
    expected_outputs:['resumo'], acceptance_criteria:['uma leitura publica'], priority:'media',
    approval_policy:'requer_aprovacao', allowed_tools:['public_web_read'], denied_actions:[...REQUIRED_DENIED_ACTIONS],
    budget:0, deadline:null, requested_by:{tipo:'usuario',id:'human:owner'},
    correlation_id:'corr-1', idempotency_key:'idem-1', callback:null,
    metadata:{tipo:'pesquisar',tags:'first-real-mission',issued_at:'2026-10-14T21:00:00.000Z',emitted_by:'human:owner'}
  };
  return { ...base, ...overrides };
}

function envelope(contractOverrides = {}, envelopeOverrides = {}) {
  const c = contract(contractOverrides);
  return {
    version:VERSION, provider:PROVIDER, environment:'staging', production_allowed:false, dispatch_simulated:false,
    mission_run_id:'run-1', dispatch_token:'dispatch-token-1', idempotency_key:c.idempotency_key,
    correlation_id:c.correlation_id, contract_hash:computeCanonicalContentDigest(c), contract:c,
    ...envelopeOverrides
  };
}

test('accepts Base44-compatible hashed read-only research mission and binds exact trial config', () => {
  const input = envelope();
  const validation = validateOperationalMissionEnvelope(input);
  assert.equal(validation.valid, true, validation.errors.join(','));
  assert.equal(validation.target_origin, 'https://example.com');
  assert.equal(validation.target_path, '/docs');
  const bound = buildOperationalMissionTrialConfig(input, {
    tenant_id:'grupo_erick', workspace_type:'corporate', workspace_id:'workspace-1',
    user_id:'human:owner', operator_id:'human:owner', approver_id:'human:owner', production_allowed:false
  });
  assert.equal(bound.ok, true);
  assert.equal(bound.status, 'PUBLIC_WEB_OPERATIONAL_MISSION_BOUND_NOT_EXECUTED');
  assert.equal(bound.config.maximum_requests, 1);
  assert.equal(bound.config.target_origin, 'https://example.com');
  assert.equal(bound.config.target_path, '/docs');
  assert.equal(bound.execution_authorized, false);
  assert.equal(bound.external_network_called, false);
  assert.equal(bound.production_allowed, false);
});

test('fails closed on divergent contract hash and dispatch bindings', () => {
  const bad = envelope({}, { contract_hash:`sha256:${'0'.repeat(64)}`, idempotency_key:'other', correlation_id:'other' });
  const errors = validateOperationalMissionEnvelope(bad).errors;
  assert.ok(errors.includes('mission_contract_hash_mismatch'));
  assert.ok(errors.includes('mission_idempotency_binding_mismatch'));
  assert.ok(errors.includes('mission_correlation_binding_mismatch'));
});

test('allows only pesquisar plus public_web_read and required denied actions', () => {
  const wrongTool = envelope({ allowed_tools:['public_web_read','email.send'] });
  assert.ok(validateOperationalMissionEnvelope(wrongTool).errors.includes('mission_allowed_tools_must_be_public_web_read_only'));
  const missingDenied = envelope({ denied_actions:['delete'] });
  assert.ok(validateOperationalMissionEnvelope(missingDenied).errors.some((e)=>e.startsWith('mission_denied_action_missing::')));
  const wrongType = envelope({ metadata:{...contract().metadata,tipo:'desenvolver'} });
  assert.ok(validateOperationalMissionEnvelope(wrongType).errors.includes('mission_metadata_invalid'));
});

test('blocks production redirects multiple requests query strings and oversized responses', () => {
  const c = contract();
  const ctx = JSON.parse(c.context);
  ctx.public_web.target_url='https://example.com/docs?q=unsafe';
  ctx.public_web.maximum_requests=2;
  ctx.public_web.redirects_allowed=true;
  ctx.public_web.maximum_response_bytes=100001;
  const input = envelope({ context:JSON.stringify(ctx) }, { production_allowed:true, environment:'production' });
  const errors = validateOperationalMissionEnvelope(input).errors;
  for (const expected of ['mission_environment_must_be_staging','mission_production_must_be_blocked','target_query_or_fragment_forbidden','maximum_requests_must_equal_one','redirects_must_be_disabled','response_limit_out_of_bounds']) {
    assert.ok(errors.includes(expected), `${expected}: ${errors.join(',')}`);
  }
});

test('trusted workspace binding cannot be widened by mission envelope', () => {
  const bound = buildOperationalMissionTrialConfig(envelope(), {
    tenant_id:'grupo_erick', workspace_type:'corporate', workspace_id:'workspace-other',
    user_id:'human:owner', operator_id:'human:owner', approver_id:'human:owner', production_allowed:false
  });
  assert.equal(bound.ok, false);
  assert.deepEqual(bound.errors, ['trusted_workspace_or_environment_binding_invalid']);
});

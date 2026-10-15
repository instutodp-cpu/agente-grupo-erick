'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runReadyOperationalMission, retryOperationalMissionCallback } = require('../src/core/public-web-operational-mission-runner');
const { reconcileOperationalMissionRealSuccess } = require('../src/core/public-web-operational-mission-reconciliation');
const { normalizeCanaryTelemetry } = require('../src/core/public-web-canary-telemetry');
const { hashCanaryEvidence } = require('../src/core/public-web-canary-session-contract');

function baseRecord() {
  return {
    inbox_id:'inbox-1', mission_id:'mission-1', mission_run_id:'run-1', contract_hash:`sha256:${'a'.repeat(64)}`,
    status:'ready_for_tty', evidence_key:`sha256:${'b'.repeat(64)}`, callback_state:'not_ready', callback_attempts:0,
    trial_config:{environment:'staging',maximum_requests:1}, result_digest:null, result_summary:null, error_code:null, cost_units:0,
    execution_id:null, request_id:null, completed_at:null, acknowledged_at:null
  };
}
function fakeInbox(record = baseRecord()) {
  const state = { record:{...record}, transitions:[] };
  return {
    state,
    async getByRun(id) { return id === state.record.mission_run_id ? {ok:true,record:{...state.record}} : {ok:false,reason:'mission_not_found'}; },
    async transition({mission_run_id,expected_status,next_status,patch={}}) {
      if (mission_run_id !== state.record.mission_run_id) return {ok:false,reason:'mission_not_found'};
      if (state.record.status !== expected_status) return {ok:false,reason:'mission_status_changed',current_status:state.record.status};
      state.record={...state.record,...patch,status:next_status};
      state.transitions.push({expected_status,next_status,patch:{...patch}});
      return {ok:true,record:{...state.record}};
    }
  };
}
function realResult({ok=true,status='PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED',requestId='request-1',runnerStatus='public_web_candidate_success'}={}) {
  return {
    ok,status,executed:true,real_provider_called:true,environment:'staging',production_effect:'ZERO',
    runner_result:{
      request_id:requestId,status:runnerStatus,safe_summary:'useful public result',simulated:false,executed:true,real_provider_called:true,
      provider_invoked:true,transport_invoked:true,external_network_called:true,redirects_followed:0,
      cost_metadata:{cost_units:0.25},error:ok?null:{code:'provider_failed',message:'provider failed'}
    }
  };
}
function reconciliationRecord() {
  return {
    ...baseRecord(),
    tenant_id:'grupo_erick', workspace_type:'corporate', target_origin:'https://api.github.com', target_path:'/',
    status:'failed_safe', callback_state:'not_ready', callback_attempts:0, callback_last_error:null, cost_units:0,
    trial_config:{environment:'staging',maximum_requests:1,user_id:'user-1',operator_id:'human:owner',operation:'fetch_public_metadata'},
    execution_id:'exec-1', request_id:'request-1', result_digest:`sha256:${'c'.repeat(64)}`, result_summary:'',
    error_code:'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_COMPLETED', completed_at:'2026-10-15T19:32:43.234Z'
  };
}
function durableSuccessAudit(record) {
  const common={
    request_id:record.request_id, canary_session_id:'session-1', trace_id:'trace-1', tenant_id:record.tenant_id,
    workspace_type:record.workspace_type, user_id:record.trial_config.user_id, operation:record.trial_config.operation,
    environment:'staging', target_origin_hash:hashCanaryEvidence({target_origin:record.target_origin}), can_trigger_real_execution:false
  };
  return [
    {event:{...common,event_name:'public_web_canary_request_started',status:'public_web_canary_request_started',occurred_at:'2026-10-15T19:32:42.854Z',current_state:'executing',operator_id:'human:owner',approved_by:'human:owner',simulated:true,executed:false,real_provider_called:false,provider_invoked:false,transport_invoked:false,external_network_called:false}},
    {event:{...common,event_name:'public_web_canary_request_succeeded',status:'public_web_candidate_success',occurred_at:'2026-10-15T19:32:43.212Z',current_state:'canary_allowed',operator_id:'operator_not_available',approved_by:null,simulated:false,executed:true,real_provider_called:true,provider_invoked:true,transport_invoked:true,external_network_called:true}}
  ];
}

test('real success persists once and acknowledges callback without replaying public web', async () => {
  const inbox=fakeInbox(); let executions=0; let callbacks=0;
  const result=await runReadyOperationalMission({
    inbox,mission_run_id:'run-1',execution_id:'exec-1',request_id:'request-1',clock:()=> '2026-10-14T22:40:00.000Z',
    execute:async()=>{executions+=1;return realResult();},
    callbackSender:{send:async envelope=>{callbacks+=1;assert.equal(envelope.status,'concluida');assert.equal(envelope.simulated,false);return {ok:true,acknowledged:true,status:'ACK'};}}
  });
  assert.equal(result.ok,true); assert.equal(executions,1); assert.equal(callbacks,1);
  assert.equal(inbox.state.record.status,'acknowledged'); assert.equal(inbox.state.record.callback_state,'acknowledged');
  assert.equal(inbox.state.record.cost_units,0.25); assert.equal(result.public_web_execution_repeated,false);
});

test('callback failure leaves durable retry and retry never invokes public web execution again', async () => {
  const inbox=fakeInbox(); let executions=0; let callbacks=0;
  const first=await runReadyOperationalMission({
    inbox,mission_run_id:'run-1',execution_id:'exec-1',request_id:'request-1',clock:()=> '2026-10-14T22:40:00.000Z',
    execute:async()=>{executions+=1;return realResult();},
    callbackSender:{send:async()=>{callbacks+=1;return {ok:false,reason:'temporary_callback_failure'};}}
  });
  assert.equal(first.ok,true); assert.equal(executions,1); assert.equal(callbacks,1);
  assert.equal(inbox.state.record.status,'succeeded'); assert.equal(inbox.state.record.callback_state,'retry');
  const retried=await retryOperationalMissionCallback({
    inbox,mission_run_id:'run-1',clock:()=> '2026-10-14T22:41:00.000Z',
    callbackSender:{send:async envelope=>{callbacks+=1;assert.equal(envelope.execution_id,'exec-1');return {ok:true,acknowledged:true};}}
  });
  assert.equal(retried.ok,true); assert.equal(executions,1); assert.equal(callbacks,2);
  assert.equal(retried.public_web_execution_repeated,false); assert.equal(retried.external_public_web_called,false);
  assert.equal(inbox.state.record.status,'acknowledged');
});

test('pre-network block fails safe and never emits a fake real callback', async () => {
  const inbox=fakeInbox(); let callbacks=0;
  const result=await runReadyOperationalMission({
    inbox,mission_run_id:'run-1',execution_id:'exec-1',request_id:'request-1',clock:()=> '2026-10-14T22:40:00.000Z',
    execute:async()=>({ok:false,status:'exact_human_confirmation_required',executed:false,real_provider_called:false}),
    callbackSender:{send:async()=>{callbacks+=1;return {ok:true,acknowledged:true};}}
  });
  assert.equal(result.ok,false); assert.equal(callbacks,0); assert.equal(result.status,'PUBLIC_WEB_OPERATIONAL_MISSION_FAILED_SAFE_NO_REAL_CALLBACK');
  assert.equal(inbox.state.record.status,'failed_safe'); assert.equal(inbox.state.record.callback_state,'not_ready');
  assert.equal(inbox.state.record.error_code,'exact_human_confirmation_required');
});

test('callback retry at durable maximum goes dead-letter without exceeding database bound or invoking public web', async () => {
  const record=baseRecord(); record.status='succeeded'; record.callback_state='retry'; record.callback_attempts=10;
  record.execution_id='exec-1'; record.request_id='request-1'; record.result_digest=`sha256:${'c'.repeat(64)}`; record.completed_at='2026-10-14T22:40:00.000Z';
  const inbox=fakeInbox(record); let callbacks=0;
  const result=await retryOperationalMissionCallback({
    inbox,mission_run_id:'run-1',clock:()=> '2026-10-14T22:41:00.000Z',
    callbackSender:{send:async()=>{callbacks+=1;return {ok:true,acknowledged:true};}}
  });
  assert.equal(result.ok,false); assert.equal(callbacks,0); assert.equal(inbox.state.record.callback_state,'dead_letter');
  assert.equal(inbox.state.record.callback_attempts,10); assert.equal(result.external_public_web_called,false);
});

test('real network failure can callback as falhou without retrying the public request', async () => {
  const inbox=fakeInbox(); let seen;
  const result=await runReadyOperationalMission({
    inbox,mission_run_id:'run-1',execution_id:'exec-1',request_id:'request-1',clock:()=> '2026-10-14T22:40:00.000Z',
    execute:async()=>realResult({ok:false,status:'PUBLIC_WEB_CANARY_REAL_NON_PRODUCTION_EXECUTION_FAILED_SAFE',runnerStatus:'provider_error_after_network_start'}),
    callbackSender:{send:async envelope=>{seen=envelope;return {ok:true,acknowledged:true};}}
  });
  assert.equal(result.ok,false); assert.equal(seen.status,'falhou'); assert.equal(seen.error_code,'provider_failed');
  assert.equal(result.external_network_called,true); assert.equal(result.public_web_execution_repeated,false);
  assert.equal(inbox.state.record.status,'acknowledged');
});

test('final telemetry overwrites stale simulated state after real provider transport and network evidence', () => {
  const stale={simulated:true};
  const normalized={...stale,...normalizeCanaryTelemetry({provider_invoked:true,transport_invoked:true,external_network_called:true})};
  assert.equal(normalized.provider_invoked,true);
  assert.equal(normalized.transport_invoked,true);
  assert.equal(normalized.external_network_called,true);
  assert.equal(normalized.simulated,false);
  assert.equal(normalizeCanaryTelemetry({provider_invoked:true,transport_invoked:true,external_network_called:false}).simulated,true);
});

test('durable real success can be reconciled and callback retried without another public web execution', async () => {
  const record=reconciliationRecord();
  const inbox=fakeInbox(record); let callbacks=0;
  const reconciled=await reconcileOperationalMissionRealSuccess({
    inbox,mission_run_id:record.mission_run_id,
    auditStore:{list:async()=>durableSuccessAudit(record)}
  });
  assert.equal(reconciled.ok,true);
  assert.equal(reconciled.public_web_execution_repeated,false);
  assert.equal(reconciled.external_public_web_called,false);
  assert.equal(inbox.state.record.status,'succeeded');
  assert.equal(inbox.state.record.callback_state,'pending');
  assert.equal(inbox.state.record.error_code,null);
  assert.match(inbox.state.record.result_digest,/^sha256:[0-9a-f]{64}$/);

  const retried=await retryOperationalMissionCallback({
    inbox,mission_run_id:record.mission_run_id,clock:()=> '2026-10-15T19:34:00.000Z',
    callbackSender:{send:async envelope=>{callbacks+=1;assert.equal(envelope.status,'concluida');assert.equal(envelope.execution_id,record.execution_id);assert.equal(envelope.request_id,record.request_id);return {ok:true,acknowledged:true};}}
  });
  assert.equal(retried.ok,true); assert.equal(callbacks,1);
  assert.equal(retried.external_public_web_called,false); assert.equal(retried.public_web_execution_repeated,false);
  assert.equal(inbox.state.record.status,'acknowledged');
});

test('reconciliation fails closed on duplicate or incomplete durable audit evidence', async () => {
  const record=reconciliationRecord();
  const inbox=fakeInbox(record);
  const duplicate=[...durableSuccessAudit(record),durableSuccessAudit(record)[1]];
  const result=await reconcileOperationalMissionRealSuccess({inbox,mission_run_id:record.mission_run_id,auditStore:{list:async()=>duplicate}});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'durable_audit_request_cardinality_mismatch');
  assert.equal(inbox.state.transitions.length,0);
  assert.equal(inbox.state.record.status,'failed_safe');
});

'use strict';
// Opt-in, staging-only Outlook metadata canary. Not wired to any public route,
// agent tool registry, Telegram command, scheduler, or production service.
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');
const {resolveMachineIdentity} = require('../core/machine-identity-resolver');

const MCP_URL = 'https://connect.composio.dev/mcp';
const SECRET_FILE = '/home/hermesadmin/.config/hermes/secrets/composio_api_key';
const ACCOUNT_ALIAS = 'outlook-inicial';
const TOOL_SLUG = 'OUTLOOK_LIST_MESSAGES';
const LIMIT = 10;
const safeId = value => typeof value === 'string' &&
  /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const denied = (status,network_call_performed=false) => Object.freeze({
  status,executed:false,network_call_performed,write_performed:false,
  messages_imported:0,content_read:false});

function readCredential(path = SECRET_FILE) {
  const stat = fs.statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 512)
    throw Error('credential_permissions_invalid');
  const key = fs.readFileSync(path, 'utf8');
  if (!/^ck_[^\s]{17,}$/.test(key)) throw Error('credential_format_invalid');
  return key;
}

// Resolve identity from the existing machine bearer registry plus a trusted
// server-side owner grant lookup. No identity or scope is accepted from prompts.
function createComposioOutlookOwnerIdentityResolver({registry,readOwnerGrant}={}) {
  if (!registry || typeof registry.findByDigest !== 'function' ||
      typeof readOwnerGrant !== 'function')
    throw TypeError('outlook_owner_identity_dependencies_invalid');
  return async ({authorization}={}) => {
    const machine=resolveMachineIdentity({authorization},registry);
    if (machine.tenant_id !== 'grupo_erick') throw Error('tenant_denied');
    const grant=await readOwnerGrant({tenant_id:machine.tenant_id,
      key_id:machine.key_id,principal_id:machine.principal.id});
    if (!grant || grant.status !== 'active' ||
        grant.source !== 'trusted_registry' ||
        grant.tenant_id !== 'grupo_erick' ||
        grant.key_id !== machine.key_id ||
        grant.principal_id !== machine.principal.id ||
        !safeId(grant.user_id))
      throw Error('owner_grant_invalid');
    return Object.freeze({tenant_id:'grupo_erick',workspace_type:'corporate',
      organization_id:'grupo_erick',connector_scope:'corporate_private',
      group_scope:'grupo_erick_all_companies',scope_source:'trusted_machine_owner_grant',
      company_id:null,store_id:null,principal:machine.principal,
      key_id:machine.key_id,user_id:grant.user_id,
      role:'admin',user_scope:'owner_director'});
  };
}

function parseMcpPayload(body, contentType) {
  if (typeof body !== 'string' || Buffer.byteLength(body) > 128 * 1024)
    throw Error('mcp_payload_invalid');
  let parsed;
  if (contentType.includes('text/event-stream')) {
    const lines = body.split(/\r?\n/).filter(line => line.startsWith('data:'));
    parsed = lines.map(line => {
      try { return JSON.parse(line.slice(5).trim()); }
      catch { return null; }
    }).find(item => item && (item.result || item.error));
  } else {
    parsed = JSON.parse(body);
  }
  if (!parsed || parsed.error || !parsed.result) throw Error('mcp_response_invalid');
  return parsed.result;
}

async function readBoundedMcpResponse(response,contentType) {
  if (!response.body || typeof response.body.getReader !== 'function')
    throw Error('mcp_body_missing');
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let bytes=0,body='';
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      bytes+=value.byteLength;
      if (bytes > 128 * 1024) throw Error('mcp_response_too_large');
      body+=decoder.decode(value,{stream:true});
      if (contentType.includes('text/event-stream') &&
          /\r?\n\r?\n/.test(body)) {
        try { parseMcpPayload(body,contentType); break; }
        catch { /* wait for a complete event or abort */ }
      }
    }
    return body+decoder.decode();
  } finally { try { await reader.cancel(); } catch { /* cleanup */ } }
}

async function mcpRequest(fetchImpl, key, method, params, sessionId) {
  const payload = {jsonrpc:'2.0', id:randomUUID(), method};
  if (params !== undefined) payload.params = params;
  const headers = {'x-consumer-api-key':key,
    'Content-Type':'application/json',
    'Accept':'application/json, text/event-stream'};
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const response = await fetchImpl(MCP_URL, {
    method:'POST', headers, body:JSON.stringify(payload),
    redirect:'error', signal:AbortSignal.timeout(10000)
  });
  if (!response || response.status !== 200) throw Error('mcp_http_failed');
  const contentType = String(response.headers?.get('content-type') || '');
  if (!contentType.includes('application/json') &&
      !contentType.includes('text/event-stream'))
    throw Error('mcp_content_type_invalid');
  const result = parseMcpPayload(
    await readBoundedMcpResponse(response,contentType),contentType);
  return {result, sessionId:response.headers?.get('mcp-session-id') || sessionId};
}

async function mcpNotifyInitialized(fetchImpl,key,sessionId) {
  const headers={'x-consumer-api-key':key,
    'Content-Type':'application/json',
    'Accept':'application/json, text/event-stream'};
  if (sessionId) headers['mcp-session-id']=sessionId;
  const response=await fetchImpl(MCP_URL,{
    method:'POST',headers,
    body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}}),
    redirect:'error',signal:AbortSignal.timeout(10000)
  });
  if (!response || (response.status !== 202 && response.status !== 200))
    throw Error('mcp_initialized_notification_failed');
}

function parseSummary(result) {
  const content = result?.content;
  if (!Array.isArray(content) || content.length !== 1 ||
      content[0]?.type !== 'text' || typeof content[0].text !== 'string')
    throw Error('tool_response_shape_invalid');
  const outer = JSON.parse(content[0].text);
  const calls = outer?.data?.results;
  if (outer?.successful !== true || !Array.isArray(calls) ||
      calls.length !== 1 || calls[0]?.tool_slug !== TOOL_SLUG ||
      calls[0]?.response?.successful !== true)
    throw Error('tool_response_invalid');
  const values = calls[0].response.data?.value;
  if (!Array.isArray(values) || values.length > LIMIT)
    throw Error('message_count_invalid');
  let unread = 0, attachments = 0;
  const dates = [];
  const forbidden=['body','bodyPreview','uniqueBody','subject','from',
    'sender','toRecipients','ccRecipients','bccRecipients',
    'internetMessageHeaders','attachments','replyTo','webLink',
    'internetMessageId'];
  for (const item of values) {
    if (!item || forbidden.some(field=>Object.hasOwn(item,field)))
      throw Error('unexpected_sensitive_message_fields');
    if (typeof item.isRead !== 'boolean' ||
        typeof item.hasAttachments !== 'boolean' ||
        typeof item.receivedDateTime !== 'string' ||
        !Number.isFinite(Date.parse(item.receivedDateTime)))
      throw Error('message_metadata_invalid');
    if (!item.isRead) unread++;
    if (item.hasAttachments) attachments++;
    dates.push(item.receivedDateTime.slice(0, 10));
  }
  return Object.freeze({
    sampled_messages:values.length,
    unread_messages:unread,
    messages_with_attachments:attachments,
    earliest_date:dates.length ? dates.sort()[0] : null,
    latest_date:dates.length ? dates.sort().at(-1) : null
  });
}

function createHermesComposioOutlookMetadataRead({
  environment=process.env, fetchImpl=globalThis.fetch,
  reserveAttempt, appendOutcome, resolveIdentity,
  credentialReader=readCredential, maxRequests=10
}={}) {
  if (typeof reserveAttempt !== 'function' || typeof appendOutcome !== 'function' ||
      typeof resolveIdentity !== 'function' ||
      typeof fetchImpl !== 'function' || typeof credentialReader !== 'function' ||
      !Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 20)
    throw TypeError('dependencies_invalid');
  let inFlight = false;
  const enabled = () =>
    environment.HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED === 'true' &&
    environment.HERMES_DEPLOYMENT_STAGE === 'staging' &&
    environment.HERMES_EXECUTION_ENABLED === 'false' &&
    environment.HERMES_EXECUTION_KILL_SWITCH === 'true' &&
    environment.HERMES_MISSION_INGRESS_ENABLED === 'false';
  async function run({authorization}={}) {
    if (!enabled()) return denied('disabled');
    let identity;
    try { identity=await resolveIdentity({authorization}); }
    catch { return denied('identity_unavailable'); }
    // The mailbox is a GROUP-SHARED corporate resource, not a store/company
    // mailbox. Access is owner-only, explicitly allowlisted, and cannot be
    // inherited by a store admin or a company's finance role.
    const ownerUserId = environment.HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID;
    if (!safeId(ownerUserId)) return denied('group_owner_not_configured');
    if (identity?.tenant_id !== 'grupo_erick' ||
        identity.workspace_type !== 'corporate' ||
        identity.organization_id !== 'grupo_erick' ||
        identity.connector_scope !== 'corporate_private' ||
        identity.group_scope !== 'grupo_erick_all_companies' ||
        identity.scope_source !== 'trusted_machine_owner_grant' ||
        identity.company_id != null || identity.store_id != null ||
        identity.principal?.type !== 'machine' ||
        !safeId(identity.principal.id) || !safeId(identity.key_id) ||
        identity.user_id !== ownerUserId ||
        identity.role !== 'admin' ||
        identity.user_scope !== 'owner_director')
      return denied('identity_scope_invalid');
    if (inFlight) return denied('already_in_flight');
    inFlight = true;
    try {
      const traceId = randomUUID();
      let reservation;
      try { reservation=await reserveAttempt({trace_id:traceId,
        user_id:identity.user_id,max_requests:maxRequests}); }
      catch { return denied('audit_reservation_unavailable'); }
      if (!reservation || reservation.reserved !== true ||
          reservation.trace_id !== traceId) {
        return denied(reservation?.reason === 'request_budget_exhausted' ?
          'request_budget_exhausted' : 'audit_reservation_unavailable');
      }
      let summary,networkStarted=false;
      try {
        const key = credentialReader();
        networkStarted=true;
        const init = await mcpRequest(fetchImpl, key, 'initialize', {
          protocolVersion:'2025-03-26', capabilities:{},
          clientInfo:{name:'hermes-outlook-readonly',version:'0.1'}
        });
        if (!init.result?.serverInfo && !init.result?.protocolVersion)
          throw Error('mcp_initialize_invalid');
        await mcpNotifyInitialized(fetchImpl,key,init.sessionId);
        const listed=await mcpRequest(fetchImpl,key,'tools/list',undefined,init.sessionId);
        if (!Array.isArray(listed.result?.tools) ||
            !listed.result.tools.some(tool=>tool?.name==='COMPOSIO_MULTI_EXECUTE_TOOL'))
          throw Error('composio_tool_not_advertised');
        const call = await mcpRequest(fetchImpl, key, 'tools/call', {
          name:'COMPOSIO_MULTI_EXECUTE_TOOL',
          arguments:{
            tools:[{tool_slug:TOOL_SLUG, account:ACCOUNT_ALIAS,
              arguments:{user_id:'me', folder:'inbox', top:LIMIT,
                select:['id','receivedDateTime','isRead','hasAttachments']}}],
            thought:'Read only bounded Outlook inbox metadata',
            sync_response_to_workbench:false,
            current_step:'OUTLOOK_METADATA_CANARY'
          }
        }, init.sessionId);
        summary = parseSummary(call.result);
      } catch {
        try {
          const outcome=await appendOutcome({trace_id:traceId,
            user_id:identity.user_id,outcome:'FAILED',sampled_messages:null});
          if (outcome?.persisted !== true || outcome.trace_id !== traceId)
            throw Error('audit_outcome_not_persisted');
        } catch { return denied('audit_unavailable_after_provider',networkStarted); }
        return denied('provider_failed',networkStarted);
      }
      try {
        const outcome=await appendOutcome({trace_id:traceId,
          user_id:identity.user_id,outcome:'SUCCEEDED',
          sampled_messages:summary.sampled_messages});
        if (outcome?.persisted !== true || outcome.trace_id !== traceId)
          throw Error('audit_outcome_not_persisted');
      } catch { return denied('audit_unavailable_after_provider',networkStarted); }
      return Object.freeze({status:'succeeded', trace_id:traceId,
        executed:true, network_call_performed:true, write_performed:false,
        messages_imported:0, content_read:false, ...summary});
    } finally { inFlight = false; }
  }
  return Object.freeze({run});
}
module.exports = {createHermesComposioOutlookMetadataRead,
  createComposioOutlookOwnerIdentityResolver, parseSummary, readCredential};

'use strict';
// Opt-in, staging-only Outlook metadata canary. Not wired to any public route,
// agent tool registry, Telegram command, scheduler, or production service.
const fs = require('node:fs');
const {randomUUID} = require('node:crypto');

const MCP_URL = 'https://connect.composio.dev/mcp';
const SECRET_FILE = '/home/hermesadmin/.config/hermes/secrets/composio_api_key';
const ACCOUNT_ALIAS = 'outlook-inicial';
const TOOL_SLUG = 'OUTLOOK_LIST_MESSAGES';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const LIMIT = 10;
const safeId = value => typeof value === 'string' &&
  /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const denied = status => Object.freeze({status, executed:false,
  network_call_performed:false, write_performed:false,
  messages_imported:0, content_read:false});

function readCredential(path = SECRET_FILE) {
  const stat = fs.statSync(path);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size > 512)
    throw Error('credential_permissions_invalid');
  const key = fs.readFileSync(path, 'utf8');
  if (!/^ck_[^\s]{17,}$/.test(key)) throw Error('credential_format_invalid');
  return key;
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
  const result = parseMcpPayload(await response.text(), contentType);
  return {result, sessionId:response.headers?.get('mcp-session-id') || sessionId};
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
  for (const item of values) {
    if (!item || typeof item.isRead !== 'boolean' ||
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
  appendAudit, readUsage, credentialReader=readCredential,
  clock=()=>Date.now(), maxRequests=10
}={}) {
  if (typeof appendAudit !== 'function' || typeof readUsage !== 'function' ||
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
  async function run({identity}={}) {
    if (!enabled()) return denied('disabled');
    const companyId = environment.HERMES_COMPOSIO_OUTLOOK_COMPANY_ID;
    if (!safeId(companyId)) return denied('company_scope_not_configured');
    if (identity?.tenant_id !== 'grupo_erick' ||
        identity.workspace_type !== 'corporate' ||
        identity.organization_id !== 'grupo_erick' ||
        identity.company_id !== companyId ||
        identity.principal?.type !== 'machine' ||
        !safeId(identity.principal.id) || !safeId(identity.key_id) ||
        !safeId(identity.user_id) ||
        !['admin','financeiro'].includes(identity.role))
      return denied('identity_scope_invalid');
    if (inFlight) return denied('already_in_flight');
    inFlight = true;
    try {
      const now = clock();
      if (!Number.isSafeInteger(now)) return denied('clock_unavailable');
      let count;
      try {
        count = await readUsage({tenant_id:'grupo_erick', company_id:companyId,
          provider:'COMPOSIO_OUTLOOK', since:new Date(now-WINDOW_MS).toISOString()});
      } catch { return denied('quota_store_unavailable'); }
      if (!Number.isInteger(count) || count < 0)
        return denied('quota_store_unavailable');
      if (count >= maxRequests) return denied('request_budget_exhausted');
      const traceId = randomUUID();
      const audit = {trace_id:traceId, tenant_id:'grupo_erick',
        company_id:companyId, provider:'COMPOSIO_OUTLOOK',
        operation:'METADATA_READ', resource:'inbox_summary',
        account_alias:ACCOUNT_ALIAS, write_performed:false,
        messages_imported:0, content_read:false};
      try {
        await appendAudit(Object.freeze({...audit, event:'attempt',
          at:new Date(now).toISOString()}));
      } catch { return denied('audit_unavailable'); }
      let summary, called = false;
      try {
        const key = credentialReader();
        called = true;
        const init = await mcpRequest(fetchImpl, key, 'initialize', {
          protocolVersion:'2025-03-26', capabilities:{},
          clientInfo:{name:'hermes-outlook-readonly',version:'0.1'}
        });
        if (!init.result?.serverInfo && !init.result?.protocolVersion)
          throw Error('mcp_initialize_invalid');
        const call = await mcpRequest(fetchImpl, key, 'tools/call', {
          name:'COMPOSIO_MULTI_EXECUTE_TOOL',
          arguments:{
            tools:[{tool_slug:TOOL_SLUG, account:ACCOUNT_ALIAS,
              arguments:{user_id:'me', folder:'inbox', top:LIMIT,
                select:['id','receivedDateTime','isRead','hasAttachments'],
                response_detail:'minimal'}}],
            thought:'Read only bounded Outlook inbox metadata',
            sync_response_to_workbench:false,
            current_step:'OUTLOOK_METADATA_CANARY'
          }
        }, init.sessionId);
        summary = parseSummary(call.result);
      } catch {
        try { await appendAudit(Object.freeze({...audit,event:'result',
          at:new Date(clock()).toISOString(), outcome:'FAILED',
          real_provider_called:called})); }
        catch { return denied('audit_unavailable_after_provider'); }
        return denied('provider_failed');
      }
      try { await appendAudit(Object.freeze({...audit,event:'result',
        at:new Date(clock()).toISOString(), outcome:'SUCCEEDED',
        real_provider_called:true, sampled_messages:summary.sampled_messages})); }
      catch { return denied('audit_unavailable_after_provider'); }
      return Object.freeze({status:'succeeded', trace_id:traceId,
        executed:true, network_call_performed:true, write_performed:false,
        messages_imported:0, content_read:false, ...summary});
    } finally { inFlight = false; }
  }
  return Object.freeze({run});
}
module.exports = {createHermesComposioOutlookMetadataRead,
  parseSummary, readCredential};

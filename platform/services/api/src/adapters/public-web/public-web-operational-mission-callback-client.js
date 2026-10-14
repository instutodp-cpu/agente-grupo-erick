'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'public_web_operational_mission_callback_client_v1';
const ACCEPTED = new Set([
  'HERMES_OPERATIONAL_MISSION_CALLBACK_APPLIED',
  'HERMES_OPERATIONAL_MISSION_CALLBACK_ALREADY_APPLIED'
]);

function blocked(reason) {
  return Object.freeze({ ok:false, status:'PUBLIC_WEB_OPERATIONAL_MISSION_CALLBACK_BLOCKED', reason, acknowledged:false, production_allowed:false });
}
function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.hostname.includes('.') || url.pathname === '/') return null;
  return url.toString();
}
function readProtectedToken(tokenFile) {
  if (typeof tokenFile !== 'string' || !path.isAbsolute(tokenFile)) throw new TypeError('callback_token_file_invalid');
  const st = fs.statSync(tokenFile);
  if ((st.mode & 0o777) !== 0o600) throw new TypeError('callback_token_file_permissions_invalid');
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (token.length < 32 || token.length > 4096 || /\s/.test(token)) throw new TypeError('callback_token_invalid');
  return token;
}

function createPublicWebOperationalMissionCallbackClient({ endpoint, tokenFile, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const exactEndpoint = validateEndpoint(endpoint);
  if (!exactEndpoint) throw new TypeError('callback_endpoint_invalid');
  if (typeof fetchImpl !== 'function') throw new TypeError('callback_fetch_required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10000) throw new TypeError('callback_timeout_invalid');

  async function send(envelope) {
    let token;
    try { token = readProtectedToken(tokenFile); }
    catch (_error) { return blocked('callback_credential_unavailable'); }
    let response;
    try {
      response = await fetchImpl(exactEndpoint, {
        method:'POST',
        redirect:'error',
        headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
        body:JSON.stringify(envelope),
        signal:AbortSignal.timeout(timeoutMs)
      });
    } catch (_error) {
      return blocked('callback_transport_failed');
    }
    if (response.status !== 200) return blocked(`callback_http_${response.status}`);
    let body;
    try { body = await response.json(); }
    catch { return blocked('callback_response_invalid'); }
    if (!body || body.ok !== true || body.acknowledged !== true || !ACCEPTED.has(body.status)
      || body.production_allowed !== false || body.mission_id !== envelope.mission_id
      || body.mission_run_id !== envelope.mission_run_id || body.contract_hash !== envelope.contract_hash
      || body.execution_id !== envelope.execution_id) {
      return blocked('callback_acknowledgement_invalid');
    }
    return Object.freeze({
      ok:true,
      status:'PUBLIC_WEB_OPERATIONAL_MISSION_CALLBACK_ACKNOWLEDGED',
      acknowledged:true,
      idempotent:body.idempotent === true,
      mission_id:envelope.mission_id,
      mission_run_id:envelope.mission_run_id,
      execution_id:envelope.execution_id,
      production_allowed:false
    });
  }

  return Object.freeze({ version:VERSION, endpoint:exactEndpoint, send });
}

module.exports = { VERSION, createPublicWebOperationalMissionCallbackClient };

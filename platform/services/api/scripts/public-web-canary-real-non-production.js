#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const { createPublicWebCanaryStagingBootstrap } = require('../src/pilots/public-web-canary-staging-bootstrap');
const {
  REQUIRED_CONFIRMATION,
  createPublicWebCanaryRealNonProductionExecutionBridge
} = require('../src/pilots/public-web-canary-real-non-production-execution-bridge');

const ALLOWED_FLAGS = new Set(['--bootstrap', '--preflight']);
const BOOTSTRAP_PATH = path.resolve(__dirname, '../config/public-web-canary-real-non-production.local.js');

function parseArgs(argv) {
  if (argv.length === 0) return { ok: true, bootstrapPath: BOOTSTRAP_PATH, preflight: false };
  let bootstrapPath = BOOTSTRAP_PATH; let preflight = false;
  for (let i=0;i<argv.length;i+=1) {
    const flag=argv[i]; if(!ALLOWED_FLAGS.has(flag)) return {ok:false,reason:'only_bootstrap_and_preflight_are_allowed'};
    if(flag==='--preflight'){ if(preflight)return {ok:false,reason:'duplicate_preflight'}; preflight=true; continue; }
    const value=argv[i+1]; if(!value||value.startsWith('--'))return {ok:false,reason:'bootstrap_path_required'}; bootstrapPath=path.resolve(value); i+=1;
  }
  return { ok: true, bootstrapPath, preflight };
}

function loadBootstrap(bootstrapPath) {
  if (!fs.existsSync(bootstrapPath)) return null;
  const loaded = require(bootstrapPath);
  return loaded && typeof loaded === 'object' ? loaded : null;
}

async function readExactConfirmation() {
  if (!input.isTTY || !output.isTTY) return '';
  output.write(`Digite exatamente: ${REQUIRED_CONFIRMATION}\n`);
  const rl = readline.createInterface({ input, output });
  try { return await rl.question('Confirmacao: '); }
  finally { rl.close(); }
}


async function preflightOperationalCanary(options = {}) {
  const raw = options.bootstrap;
  if (!raw) return { ok:false, status:'operational_bootstrap_not_configured', ready:false, network_called:false, secret_resolved:false };
  const runtime = createPublicWebCanaryStagingBootstrap(raw.runtime || {});
  if (!runtime.ok) return { ...runtime, status:'operational_runtime_blocked', ready:false, network_called:false, secret_resolved:false };
  const checks = [];
  const featureEnabled = await runtime.featureFlagResolver('public_web_canary_real_non_production');
  checks.push({check:'feature_flag',ok:featureEnabled===true});
  const killed = await runtime.killSwitchResolver('public_web_canary_real_non_production');
  checks.push({check:'kill_switch',ok:killed===false});
  checks.push({check:'durable_audit_contract',ok:runtime.requireDurableAudit===true && runtime.auditSink && runtime.auditSink.durable===true && typeof runtime.auditSink.appendDurably==='function' && typeof runtime.auditSink.ensureReady==='function'});
  if (checks.at(-1).ok) { try { const r=await runtime.auditSink.ensureReady(); checks.push({check:'durable_audit_ready',ok:!!r&&r.ok===true}); } catch { checks.push({check:'durable_audit_ready',ok:false}); } }
  checks.push({check:'secret_reference_only',ok:runtime.secretReferenceRegistry && runtime.secretResolver && typeof runtime.secretResolver.resolve==='function'});
  const ready=checks.every(x=>x.ok);
  return Object.freeze({ok:ready,status:ready?'OPERATIONAL_CANARY_PREFLIGHT_READY':'OPERATIONAL_CANARY_PREFLIGHT_BLOCKED',ready,checks:Object.freeze(checks.map(Object.freeze)),network_called:false,secret_resolved:false,execution_started:false,production_allowed:false});
}

async function executeOperationalCanary(options = {}) {
  const confirmationReader = options.confirmationReader || readExactConfirmation;
  const raw = options.bootstrap;
  if (!raw) return { ok: false, status: 'operational_bootstrap_not_configured', executed: false, real_provider_called: false };

  const runtime = createPublicWebCanaryStagingBootstrap(raw.runtime || {});
  if (!runtime.ok) return { ...runtime, status: 'operational_runtime_blocked', executed: false, real_provider_called: false };

  const featureEnabled = await runtime.featureFlagResolver('public_web_canary_real_non_production');
  if (featureEnabled !== true) return { ok: false, status: 'feature_flag_disabled', executed: false, real_provider_called: false };
  const killed = await runtime.killSwitchResolver('public_web_canary_real_non_production');
  if (killed !== false) return { ok: false, status: 'kill_switch_active', executed: false, real_provider_called: false };

  const confirmation = await confirmationReader();
  if (confirmation !== REQUIRED_CONFIRMATION) return { ok: false, status: 'exact_human_confirmation_required', executed: false, real_provider_called: false };

  const bridgeInput = Object.freeze({ ...(raw.bridgeInput || {}), activation_confirmation: confirmation });
  const bridge = createPublicWebCanaryRealNonProductionExecutionBridge({ clock: runtime.clock });
  return bridge.execute({ chain: raw.chain, bridgeInput, runtime });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) { output.write(JSON.stringify({ ok:false, status:'cli_blocked', reason:parsed.reason })+'\n'); process.exitCode=2; return; }
  const bootstrap = loadBootstrap(parsed.bootstrapPath);
  try {
    const result = parsed.preflight ? await preflightOperationalCanary({ bootstrap }) : await executeOperationalCanary({ bootstrap });
    output.write(JSON.stringify(result, null, 2)+'\n');
    process.exitCode = result && result.ok ? 0 : 2;
  } catch (_error) {
    output.write(JSON.stringify({ ok:false, status:'operational_canary_failed_safe', executed:false, real_provider_called:false })+'\n');
    process.exitCode=3;
  }
}

if (require.main === module) main();
module.exports = { BOOTSTRAP_PATH, parseArgs, preflightOperationalCanary, executeOperationalCanary };

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const MAP = path.join(ROOT, 'platform/docs/audits/HERMES_READINESS_MAP.json');

function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function loadMap() { return JSON.parse(fs.readFileSync(MAP, 'utf8')); }
function countFiles(rel, predicate = () => true) {
  const root = path.join(ROOT, rel);
  let count = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(rel, entry.name);
    if (entry.isDirectory()) count += countFiles(child, predicate);
    else if (predicate(child)) count += 1;
  }
  return count;
}

function collectEvidenceInventory() {
  const docsRoot = path.join(ROOT, 'platform/docs');
  const coreRoot = path.join(ROOT, 'platform/services/api/src/core');
  const testsRoot = path.join(ROOT, 'platform/services/api/test');
  const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(entry => {
    const child = path.join(rel, entry.name);
    return entry.isDirectory() ? walk(root, child) : [child.replaceAll('\\', '/')];
  });
  const docs = walk(docsRoot);
  const core = walk(coreRoot);
  const tests = walk(testsRoot);
  const contractDocs = docs.filter(file => /contract|registry|manifest/i.test(file));
  const contractCode = core.filter(file => /contract|registry|manifest/i.test(file));
  const families = {};
  for (const file of core) {
    const name = path.basename(file);
    const family = name
      .replace(/\.(js|json|yaml|yml)$/, '')
      .replace(/-(contract|registry|manifest|policy|adapter|engine|boundary|reference|composition|readiness|request|response|package|plan|audit).*$/, '');
    families[family] = families[family] || { implementation_files: 0, test_files: 0 };
    families[family].implementation_files += 1;
  }
  for (const file of tests) {
    const name = path.basename(file).replace(/\.test\.js$/, '');
    for (const family of Object.keys(families)) {
      if (name === family || name.startsWith(family + '-')) families[family].test_files += 1;
    }
  }
  const implementationWithoutTests = Object.entries(families)
    .filter(([, evidence]) => evidence.implementation_files > 0 && evidence.test_files === 0)
    .map(([family, evidence]) => ({ family, ...evidence }))
    .sort((a,b) => b.implementation_files - a.implementation_files || a.family.localeCompare(b.family));
  return {
    contract_docs: contractDocs.length,
    contract_code: contractCode.length,
    implementation_families: Object.keys(families).length,
    test_binding_candidates: implementationWithoutTests
  };
}

function collectDirectTestBindings() {
  const testsRoot = path.join(ROOT, 'platform/services/api/test');
  const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(entry => {
    const child = path.join(rel, entry.name);
    return entry.isDirectory() ? walk(root, child) : [child.replaceAll('\\\\', '/')];
  });
  const bindings = new Map();
  for (const testFile of walk(testsRoot)) {
    const source = fs.readFileSync(path.join(testsRoot, testFile), 'utf8');
    const pattern = /['"]\.\.\/src\/core\/([^'"]+)['"]/g;
    for (const match of source.matchAll(pattern)) {
      const implementation = match[1].replace(/\.js$/, '');
      if (!bindings.has(implementation)) bindings.set(implementation, new Set());
      bindings.get(implementation).add(testFile);
    }
  }
  return [...bindings.entries()]
    .map(([implementation, testFiles]) => ({ implementation, test_files: [...testFiles].sort() }))
    .sort((left, right) => left.implementation.localeCompare(right.implementation));
}

function validateAuthoritySeparation() {
  const router = fs.readFileSync(path.join(ROOT, 'platform/services/api/src/capabilities/registry.js'), 'utf8');
  const marketing = fs.readFileSync(path.join(ROOT, 'marketing/registry.yaml'), 'utf8');
  const errors = [];
  const readiness = fs.readFileSync(MAP, 'utf8');
  const routerAuthorityDefined =
    /autoridade apenas para disponibilidade no/.test(router) &&
    /NÃO é autoridade global de readiness/.test(router) &&
    /registros de domínio, readiness map e evidência de runtime/.test(router);
  if (!routerAuthorityDefined) errors.push({type:'router_authority_undefined'});
  if (!/status:\s*foundation/.test(marketing) || !/default_execution:\s*deny/.test(marketing)) errors.push({type:'marketing_domain_authority_undefined'});
  if (!/"planned"/.test(readiness) || !/"proven_e2e"/.test(readiness) || !/"operational"/.test(readiness)) {
    errors.push({type:'readiness_authority_undefined'});
  }
  return errors;
}

function validateEvidence(map) {
  const errors = [];
  const states = ['planned','contracted','implemented','tested','proven_e2e','operational'];
  for (const capability of map.capabilities || []) {
    let unknownSeen = false;
    let previous = true;
    for (const state of states) {
      const value = capability[state];
      if (value === null) unknownSeen = true;
      if (value === true && unknownSeen) errors.push({type:'evidence_gap', capability:capability.id, state});
      if (value === true && previous === false) errors.push({type:'non_monotonic_evidence', capability:capability.id, state});
      if (value !== null) previous = value;
    }
    if (capability.operational === true && capability.proven_e2e !== true) errors.push({type:'operational_without_e2e', capability:capability.id});
    if (capability.proven_e2e === true && capability.tested !== true) errors.push({type:'e2e_without_tests', capability:capability.id});
    if (capability.tested === true && capability.implemented !== true) errors.push({type:'tested_without_implementation', capability:capability.id});
    if (capability.operational === true && !capability.scope) errors.push({type:'missing_operational_scope', capability:capability.id});
    if (capability.proven_e2e === true && !capability.evidence_revision) errors.push({type:'missing_e2e_revision', capability:capability.id});
  }
  return errors;
}

function audit() {
  const map = loadMap();
  const errors = [];
  const required = [
    'platform/docs/PRD.md',
    'platform/docs/GOVERNANCE_CHECK_REPORT.md',
    'platform/services/api/src/capabilities/registry.js',
    'marketing/registry.yaml'
  ];
  for (const file of required) if (!exists(file)) errors.push({type:'missing_anchor', file});
  const observed = {
    platform_docs: countFiles('platform/docs'),
    core_source_files: countFiles('platform/services/api/src/core'),
    api_tests: countFiles('platform/services/api/test'),
    github_workflows: countFiles('.github/workflows'),
    marketing_files: countFiles('marketing')
  };
  for (const [key, expected] of Object.entries(map.inventory || {})) {
    if (typeof expected === 'number' && observed[key] !== expected) {
      errors.push({type:'inventory_drift', key, expected, observed:observed[key]});
    }
  }
  if (map.rules?.merge_authority !== false) errors.push({type:'unsafe_rule', rule:'merge_authority'});
  if (map.rules?.human_merge_required !== true) errors.push({type:'unsafe_rule', rule:'human_merge_required'});
  const canary = map.autonomy?.a2_canary;
  const a3Canary = map.autonomy?.a3_canary;
  const a2Authorized = map.autonomy?.authorized_now?.includes('A2') === true;
  const a3Authorized = map.autonomy?.authorized_now?.includes('A3') === true;
  const a2Candidate = map.autonomy?.candidate === 'A2';
  if (a2Authorized || a2Candidate) {
    const allowedStatuses = a2Authorized
      ? ['authorized_bounded']
      : ['ready_for_execution','proven_to_human_boundary'];
    if (!allowedStatuses.includes(canary?.status)) errors.push({type:'a2_canary_not_ready'});
    for (const control of ['isolated_branch','exact_revision_test','draft_pr_only','merge_authority_false','human_merge_required','production_false']) {
      if (!canary?.required_controls?.includes(control)) errors.push({type:'missing_a2_control', control});
    }
    for (const forbidden of ['merge','production_publish','financial_spend','customer_message','destructive_action','secret_or_permission_change']) {
      if (!canary?.forbidden?.includes(forbidden)) errors.push({type:'missing_a2_forbidden_boundary', boundary:forbidden});
    }
  }
  if (a3Authorized) {
    if (!a2Authorized) errors.push({type:'a3_without_a2_authority'});
    if (a3Canary?.status !== 'authorized_scoped') errors.push({type:'a3_canary_not_authorized_scoped'});
    if (a3Canary?.environment !== 'staging' || a3Canary?.operation !== 'create_branch' || a3Canary?.repository !== 'instutodp-cpu/agente-grupo-erick') errors.push({type:'a3_scope_invalid'});
    if (!/^[a-f0-9]{40}$/.test(a3Canary?.evidence_revision || '')) errors.push({type:'a3_evidence_revision_invalid'});
    if (!/^sha256:[a-f0-9]{64}$/.test(a3Canary?.promotion_evidence_digest || '')) errors.push({type:'a3_promotion_evidence_digest_invalid'});
    if (a3Canary?.provider_status !== 201 || a3Canary?.execution_status !== 'GITHUB_DURABLE_WRITE_EXECUTION_SUCCEEDED' || a3Canary?.receipt_status !== 'GITHUB_WRITE_DURABLE_FINALIZATION_CONFIRMED' || a3Canary?.closure_status !== 'E2E_DURABLE_WRITE_CLOSURE_CONFIRMED') errors.push({type:'a3_real_canary_evidence_invalid'});
    if (a3Canary?.human_promotion_authorized !== true) errors.push({type:'a3_human_promotion_authorization_missing'});
    for (const control of ['explicit_human_approval_per_action','explicit_human_authorization_per_action','staging_only','exact_repository_operation_branch_base_sha_binding','single_use_authorization','durable_replay_protection','one_bounded_provider_write','production_false','merge_authority_false','human_merge_required']) {
      if (!a3Canary?.required_controls?.includes(control)) errors.push({type:'missing_a3_control', control});
    }
    for (const forbidden of ['merge','production_publish','financial_spend','customer_message','destructive_action','secret_or_permission_change']) {
      if (!a3Canary?.forbidden?.includes(forbidden)) errors.push({type:'missing_a3_forbidden_boundary', boundary:forbidden});
    }
    if (map.autonomy?.current_max_level !== 'A3_authorized_scoped') errors.push({type:'a3_authority_state_mismatch'});
    if ((map.protected_levels || []).includes('A3')) errors.push({type:'a3_authorized_but_still_protected'});
    if (!(map.protected_levels || []).includes('A4')) errors.push({type:'a4_protection_missing'});
  } else if (a2Authorized && map.autonomy?.current_max_level !== 'A2_authorized_bounded') {
    errors.push({type:'a2_authority_state_mismatch'});
  }
  if (map.autonomy?.authorized_now?.includes('A4')) errors.push({type:'a4_authority_forbidden'});
  if ((a2Authorized || a3Authorized) && map.autonomy?.candidate != null) errors.push({type:'authorized_with_pending_candidate'});
  errors.push(...validateEvidence(map));
  errors.push(...validateAuthoritySeparation());
  const evidenceInventory = collectEvidenceInventory();
  return {status: errors.length ? 'blocked' : 'pass', audited_revision: map.audited_revision, capability_count:(map.capabilities||[]).length, finding_count:(map.findings||[]).length, observed_inventory: observed, evidence_inventory: evidenceInventory, errors};
}

if (require.main === module) {
  const result = audit();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
module.exports = { audit, validateEvidence, collectEvidenceInventory, collectDirectTestBindings, validateAuthoritySeparation };

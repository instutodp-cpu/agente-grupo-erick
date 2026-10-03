'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../../..');
const MAP = path.join(ROOT, 'platform/docs/audits/HERMES_READINESS_MAP.json');

function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function loadMap() { return JSON.parse(fs.readFileSync(MAP, 'utf8')); }

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
  if (map.rules?.merge_authority !== false) errors.push({type:'unsafe_rule', rule:'merge_authority'});
  if (map.rules?.human_merge_required !== true) errors.push({type:'unsafe_rule', rule:'human_merge_required'});
  for (const capability of map.capabilities || []) {
    const states = ['planned','contracted','implemented','tested','proven_e2e','operational'];
    let unknownSeen = false;
    for (const state of states) {
      const value = capability[state];
      if (value === null) unknownSeen = true;
      if (value === true && unknownSeen) errors.push({type:'evidence_gap', capability:capability.id, state});
    }
    if (capability.operational === true && !capability.scope) errors.push({type:'missing_operational_scope', capability:capability.id});
    if (capability.proven_e2e === true && !capability.evidence_revision) errors.push({type:'missing_e2e_revision', capability:capability.id});
  }
  return {status: errors.length ? 'blocked' : 'pass', audited_revision: map.audited_revision, capability_count:(map.capabilities||[]).length, finding_count:(map.findings||[]).length, errors};
}

if (require.main === module) {
  const result = audit();
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.status === 'pass' ? 0 : 1;
}
module.exports = { audit };

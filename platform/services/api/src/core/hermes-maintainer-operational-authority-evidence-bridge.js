'use strict';

const CONTRACT_VERSION = 'hermes_maintainer_operational_authority_evidence_bridge_v1';
const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const ADMISSIONS = Object.freeze({
  create_branch: 'hermes_maintainer_github_durable_write_admission_v1',
  update_file: 'hermes_maintainer_github_update_file_durable_admission_v1',
  create_pull_request: 'hermes_maintainer_github_create_pull_request_durable_admission_v1'
});
const CAPABILITIES = Object.freeze({
  create_branch: 'github_create_branch_staging',
  update_file: 'github_update_file_hermes_branch_staging',
  create_pull_request: 'github_create_pull_request_hermes_branch_staging'
});

function blocked(reason) {
  return Object.freeze({contract_version:CONTRACT_VERSION,status:'MAINTAINER_OPERATIONAL_AUTHORITY_EVIDENCE_BRIDGE_BLOCKED',bridge_valid:false,ownership:null,authority_evidence:null,production_used:false,merge_authority:false,human_merge_required:true,blockers:Object.freeze([reason])});
}

function bridgeHermesMaintainerOperationalAuthorityEvidence(admission, grant) {
  const operation=admission?.operation;
  if (!ADMISSIONS[operation] || admission?.contract_version!==ADMISSIONS[operation] || admission?.admission_valid!==true || admission?.execution_authorized!==true) return blocked('DURABLE_ADMISSION_INVALID');
  if (admission?.repository!==REPOSITORY || admission?.ownership_source!=='DURABLE_PERSISTENCE_RECEIPT' || typeof admission?.ownership_key!=='string' || admission.ownership_key!==admission?.persistence_key+'::attempt-ownership') return blocked('DURABLE_OWNERSHIP_INVALID');
  if (admission?.credential_material_present!==false || admission?.network_call_performed!==false || admission?.write_performed!==false || admission?.production_used!==false) return blocked('ADMISSION_SIDE_EFFECT_STATE_INVALID');

  if (grant?.contract_version!=='hermes_maintainer_scm_write_authorization_grant_v1' || grant?.status!=='SCM_WRITE_AUTHORIZATION_GRANTED' || grant?.authorization_valid!==true || grant?.execution_authorized!==true || grant?.authorization_consumed!==false) return blocked('AUTHORIZATION_GRANT_INVALID');
  if (grant?.operation!==operation || grant?.repository!==REPOSITORY || grant?.intent_digest!==admission.intent_digest) return blocked('AUTHORIZATION_SCOPE_MISMATCH');
  if (typeof grant?.approval_reference!=='string' || !grant.approval_reference.trim() || typeof grant?.authorization_reference!=='string' || !grant.authorization_reference.trim()) return blocked('HUMAN_AUTHORIZATION_EVIDENCE_MISSING');
  if (grant?.credential_material_present!==false || grant?.network_call_performed!==false || grant?.write_performed!==false || grant?.production_used!==false) return blocked('AUTHORIZATION_SIDE_EFFECT_STATE_INVALID');

  return Object.freeze({
    contract_version:CONTRACT_VERSION,
    status:'MAINTAINER_OPERATIONAL_AUTHORITY_EVIDENCE_BRIDGED',
    bridge_valid:true,
    operation,
    ownership:Object.freeze({
      contract_version:'hermes_maintainer_scm_write_durable_ownership_binding_v1',
      status:'SCM_WRITE_DURABLE_OWNERSHIP_BOUND',
      binding_valid:true,
      ownership_source:'DURABLE_PERSISTENCE_RECEIPT',
      ownership_key:admission.ownership_key,
      persistence_key:admission.persistence_key,
      intent_digest:admission.intent_digest,
      authorization_reference:grant.authorization_reference,
      consumption_reference:admission.persistence_key,
      attempt_reference:admission.attempt_reference,
      durable_replay_protection:true,
      ownership_exclusive:true,
      execution_authorized:false,
      credential_material_present:false,
      network_call_performed:false,
      write_performed:false,
      production_used:false,
      blockers:Object.freeze([])
    }),
    authority_evidence:Object.freeze({
      decision:'GRANTED',
      capability:CAPABILITIES[operation],
      intent_digest:admission.intent_digest,
      attempt_reference:admission.attempt_reference,
      capability_reference:admission.capability_reference,
      approval_reference:grant.approval_reference,
      authorization_reference:grant.authorization_reference
    }),
    production_used:false,
    merge_authority:false,
    human_merge_required:true,
    blockers:Object.freeze([])
  });
}

module.exports={CONTRACT_VERSION,bridgeHermesMaintainerOperationalAuthorityEvidence};

'use strict';

const EVIDENCE_VERSION='hermes_maintainer_github_provider_status_evidence_v1';

function collectHermesMaintainerGithubProviderStatusEvidence(response){
 const status=Number.isInteger(response?.status)?response.status:null;
 const requestIdPresent=typeof response?.headers?.get==='function'&&
  typeof response.headers.get('x-github-request-id')==='string'&&
  response.headers.get('x-github-request-id').length>0;
 return Object.freeze({
  evidence_version:EVIDENCE_VERSION,
  provider:'GITHUB',
  method:'GET',
  read_only:true,
  status,
  ok:response?.ok===true,
  github_request_id_present:requestIdPresent,
  credential_material_present:false,
  response_body_present:false,
  write_performed:false
 });
}

module.exports={EVIDENCE_VERSION,collectHermesMaintainerGithubProviderStatusEvidence};

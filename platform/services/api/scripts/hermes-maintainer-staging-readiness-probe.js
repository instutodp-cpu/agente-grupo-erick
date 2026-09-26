'use strict';

const {collectHermesMaintainerRuntimeReadinessEvidence}=require('../src/runtime/hermes-maintainer-runtime-readiness-evidence');

async function main(){
 const evidence=await collectHermesMaintainerRuntimeReadinessEvidence();
 process.stdout.write(JSON.stringify(evidence)+'\n');
 process.exitCode=evidence.ready===true?0:2;
}

main().catch(()=>{
 process.stdout.write(JSON.stringify({
  evidence_version:'hermes_maintainer_runtime_readiness_evidence_v1',
  environment:'staging',
  credential_reference:'github_read_only_staging',
  ready:false,
  credential_material_present:false,
  reason:'RUNTIME_UNAVAILABLE'
 })+'\n');
 process.exitCode=2;
});

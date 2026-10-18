'use strict';
const BRANCH='hermes/canary/e2e';
function approvalInput(branch=BRANCH){return{branch_name:branch,edit:{repository:'instutodp-cpu/agente-grupo-erick',branch,path:'docs/e2e.md',current_blob_sha:'a'.repeat(40),content:'trusted e2e update\n',message:'test(hermes): trusted e2e update'},pull_request:{repository:'instutodp-cpu/agente-grupo-erick',base:'main',head:branch,draft:true,title:'test(hermes): trusted e2e draft',body:'trusted e2e draft body'}};}
function minimalOperationalEvidence(branch=BRANCH){const x=approvalInput(branch);return{edit:{mutation_input:x.edit},pull_request:{mutation_input:x.pull_request}};}
module.exports={BRANCH,approvalInput,minimalOperationalEvidence};

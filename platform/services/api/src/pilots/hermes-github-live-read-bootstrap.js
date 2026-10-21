'use strict';
const fs=require('node:fs');
const {createMachineIdentityRegistry}=require('../core/machine-identity-registry');
const {createHermesGithubLiveReadPilot,createDurableJsonLineAudit}=
 require('../runtime/hermes-github-live-read-pilot');
// Importing or bootstrapping with flag off has no external effects.
function createHermesGithubLiveReadBootstrap({environment=process.env,fetchImpl}={}){
 if(environment.HERMES_GITHUB_READ_PILOT_ENABLED!=='true')
  return Object.freeze({machineIdentityRegistry:null,githubReadPilot:null});
 if(environment.HERMES_DEPLOYMENT_STAGE!=='staging'||
  environment.HERMES_EXECUTION_ENABLED!=='false'||
  environment.HERMES_EXECUTION_KILL_SWITCH!=='true'||
  environment.HERMES_MISSION_INGRESS_ENABLED!=='false')
  throw new TypeError('live_read_pilot_environment_denied');
 const identityFile=environment.HERMES_GITHUB_READ_PILOT_IDENTITY_FILE;
 const auditFile=environment.HERMES_GITHUB_READ_PILOT_AUDIT_FILE;
 if(typeof identityFile!=='string'||!identityFile.startsWith('/')||
   identityFile.includes('..')||typeof auditFile!=='string'||
   !auditFile.startsWith('/')||auditFile.includes('..'))
  throw new TypeError('live_read_pilot_files_not_configured');
 const st=fs.statSync(identityFile);
 if((st.mode&0o777)!==0o600||!st.isFile())
  throw new TypeError('live_read_pilot_identity_file_not_protected');
 const data=JSON.parse(fs.readFileSync(identityFile,'utf8'));
 const machineIdentityRegistry=createMachineIdentityRegistry(data);
 if(machineIdentityRegistry.size!==1)throw new TypeError('single_pilot_principal_required');
 const githubReadPilot=createHermesGithubLiveReadPilot({
  environment,fetchImpl,appendAudit:createDurableJsonLineAudit({filePath:auditFile})
 });
 return Object.freeze({machineIdentityRegistry,githubReadPilot});
}
module.exports={createHermesGithubLiveReadBootstrap};

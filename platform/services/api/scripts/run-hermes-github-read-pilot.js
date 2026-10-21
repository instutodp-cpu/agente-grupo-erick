'use strict';
// Loopback-only opt-in staging entrypoint. Never exposes a public socket.
const {createServer}=require('../src/index');
const {createHermesGithubLiveReadBootstrap}=
 require('../src/pilots/hermes-github-live-read-bootstrap');
const port=Number(process.env.HERMES_GITHUB_READ_PILOT_LOCAL_PORT||8091);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('safe_local_port_required');
const composition=createHermesGithubLiveReadBootstrap();
if(!composition.githubReadPilot||!composition.githubReadPilot.enabled())
 throw Error('pilot_explicitly_disabled');
const server=createServer({
 machineIdentityRegistry:composition.machineIdentityRegistry,
 githubReadPilot:composition.githubReadPilot
});
server.listen(port,'127.0.0.1',()=>{
 console.log(JSON.stringify({event:'hermes_github_read_pilot_started',
  binding:'loopback',port,staging_only:true,write_performed:false}));
});
for(const signal of ['SIGTERM','SIGINT']){
 process.on(signal,()=>server.close(()=>process.exit(0)));
}

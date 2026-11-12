'use strict';
// Staging-only, narrow loopback HTTP server; no company API routes, no body logs.
// The private archive storage gate stays CLOSED until separately authorized.
const http=require('node:http');
const {createPersonalArchiveIngressBootstrap}
 =require('./hermes-brain-personal-ingress-bootstrap');
const {PATH}=require('./hermes-brain-personal-private-ingress');
async function main(){
 if(process.env.HERMES_PERSONAL_ENVIRONMENT!=='staging'||
    process.env.HERMES_PERSONAL_IMPORT_WRITES_ENABLED==='true')
  throw Error('personal_staging_mode_denied');
 const env={...process.env,HERMES_PERSONAL_INGRESS_ENABLED:'true',
  HERMES_PERSONAL_IMPORT_WRITES_ENABLED:'false'};
 const composition=createPersonalArchiveIngressBootstrap({env});
 const server=http.createServer((req,res)=>{
  if(req.method==='GET'&&req.url==='/__private/ready'){
   const data='{"status":"ready","writes_enabled":false}';
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(data);
   return;
  }
  if(req.url===PATH){
   Promise.resolve(composition.ingress.handle(req,res)).catch(()=>{
    if(!res.headersSent){
     res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
     res.end('{"error":"personal_ingress_unavailable"}');
    }else res.destroy();
   });
   return;
  }
  res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});
  res.end('{"error":"not_found"}');
 });
 server.requestTimeout=12000;
 server.headersTimeout=15000;
 server.maxRequestsPerSocket=25;
 server.on('clientError',(_error,socket)=>{socket.destroy()});
 await new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(8107,'127.0.0.1',resolve);
 });
 // stdout status only; no request headers, JWTs or private bodies.
 process.stdout.write('HERMES_PERSONAL_STAGING_LISTENING_127_0_0_1_8107_WRITES_DISABLED\n');
 const shutdown=async()=>{
  server.close(()=>{});
  await composition.close();
  process.exit(0);
 };
 process.once('SIGTERM',shutdown);
 process.once('SIGINT',shutdown);
}
if(require.main===module){
 main().catch(()=>{process.stderr.write('PERSONAL_STAGING_START_FAILED\n');process.exitCode=1});
}
module.exports={main};

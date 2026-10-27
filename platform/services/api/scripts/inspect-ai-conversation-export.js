#!/usr/bin/env node
'use strict';
// Local-only dry-run. Never transmits, logs, stores or shares exported messages.
// This CLI DOES NOT prove authentication: --owner is only a preview namespace.
const fs=require('node:fs');
const path=require('node:path');
const {normalizeExport}=require('../src/runtime/hermes-ai-conversation-export-reader');
const MAX_JSON_BYTES=32*1024*1024;
function run(argv=process.argv.slice(2)){
 if(argv.length!==6||argv[0]!=='--provider'||argv[2]!=='--file'||
    argv[4]!=='--owner')throw Error('usage: --provider chatgpt|claude --file conversations.json --owner OWNER_ID');
 const [provider,file,owner]=[argv[1],argv[3],argv[5]];
 if(!['chatgpt','claude'].includes(provider)||
    !/^[A-Za-z0-9_-]{1,128}$/.test(owner))throw Error('preview_args_denied');
 const absolute=path.resolve(file);
 // No symbolic links, devices, huge payloads or non-JSON files.
 const stat=fs.lstatSync(absolute);
 if(!stat.isFile()||stat.isSymbolicLink()||
    stat.size>MAX_JSON_BYTES||stat.size<2||
    !/\.json$/i.test(absolute))throw Error('preview_file_denied');
 let parsed;
 try{parsed=JSON.parse(fs.readFileSync(absolute,'utf8'))}
 catch{throw Error('preview_json_invalid')}
 const data=Array.isArray(parsed)?parsed:
  (parsed&&Array.isArray(parsed.conversations)?parsed.conversations:null);
 if(!Array.isArray(data))throw Error('preview_export_format_denied');
 const result=normalizeExport({provider,conversations:data,grant:{
  authenticated:true,verified_session_selection:true,
  source_export_authorized:true,workspace_type:'personal',
  user_id:owner,tenant_id:'personal::'+owner,
  approved_provider:provider,authorization_ref:'local_untrusted_preview'
 }});
 // ONLY fixed-field aggregate statistics may leave the local process.
 const summary={mode:'local_untrusted_preview_no_upload',
  provider:result.provider,conversations:result.conversation_count,
  text_messages:result.message_count,
  unsupported_text_messages:result.unsupported_text_messages,
  omitted_nonuser_messages:result.omitted_nonuser_messages,
  coverage:result.coverage,memory_written:false,
  raw_export_persisted:false,credential_authorized:false,
  next_step:'trusted_owner_authenticated_review_and_storage_not_enabled'};
 process.stdout.write(JSON.stringify(summary)+'\n');
 return summary;
}
if(require.main===module){
 try{run()}
 catch(error){
  // Never print filenames, JSON contents or free-form exception messages.
  console.error('ai_export_local_preview_denied');
  process.exitCode=1;
 }
}
module.exports={run};

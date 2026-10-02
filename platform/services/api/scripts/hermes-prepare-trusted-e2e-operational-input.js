#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const {buildHermesMaintainerTrustedE2eOperationalInput}=require('../src/runtime/hermes-maintainer-trusted-e2e-operational-input-builder');
function main({argv=process.argv,readFile=fs.readFileSync,writeFile=fs.writeFileSync}={}){
 if(typeof argv[2]!=='string'||argv[2].length<1)throw new TypeError('authorized_input_path_required');
 if(typeof argv[3]!=='string'||argv[3].length<1)throw new TypeError('operational_output_path_required');
 const input=JSON.parse(readFile(argv[2],'utf8'));
 const built=buildHermesMaintainerTrustedE2eOperationalInput(input);
 if(built?.input_valid!==true)throw new TypeError('authorized_operational_input_invalid');
 writeFile(argv[3],JSON.stringify(built.operational,null,2)+'\n',{mode:0o600,flag:'wx'});
 return Object.freeze({status:'TRUSTED_E2E_OPERATIONAL_INPUT_PREPARED',prepared:true,output_path:argv[3],production_used:false,merge_authority:false,human_merge_required:true});
}
if(require.main===module){try{const result=main();process.stdout.write(JSON.stringify(result,null,2)+'\n');}catch(error){process.stdout.write(JSON.stringify({status:'TRUSTED_E2E_OPERATIONAL_INPUT_PREPARATION_FAILED_SAFE',prepared:false,reason:error?.message||'unknown_error',production_used:false,merge_authority:false,human_merge_required:true})+'\n');process.exitCode=2;}}
module.exports={main};
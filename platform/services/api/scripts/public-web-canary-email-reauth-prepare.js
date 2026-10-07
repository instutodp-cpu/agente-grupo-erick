#!/usr/bin/env node
'use strict';
const {createChallenge}=require('./public-web-canary-email-reauth-challenge');
async function prepare(options={}){if(process.argv.slice(2).length!==0)return Object.freeze({ok:false,status:'EMAIL_REAUTH_PREPARE_BLOCKED',reason:'arguments_not_allowed',execution_authorized:false,external_network_called:false,production_allowed:false});const result=await createChallenge(options);return Object.freeze({...result,entrypoint:'public_web_canary_email_reauth_prepare_v1',external_network_called:false,execution_authorized:false,production_allowed:false});}
if(require.main===module)prepare().then(x=>{console.log(JSON.stringify(x));if(!x.ok)process.exitCode=2}).catch(()=>{console.error(JSON.stringify({ok:false,status:'EMAIL_REAUTH_PREPARE_BLOCKED',reason:'preparation_failed_safe',execution_authorized:false,external_network_called:false,production_allowed:false}));process.exitCode=1});
module.exports={prepare};

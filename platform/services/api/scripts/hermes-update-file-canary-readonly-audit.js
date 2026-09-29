#!/usr/bin/env node
'use strict';
const {Pool}=require('pg');
const AUTH='authorization-update-file-real-canary-20260929';
const ATTEMPT='attempt-update-file-real-canary-20260929';
async function main(){
 const pool=new Pool({host:'127.0.0.1',port:Number(process.env.POSTGRES_PORT),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,max:1,connectionTimeoutMillis:5000,query_timeout:5000});
 try{
  const consumption=await pool.query('SELECT persistence_key,intent_digest,authorization_reference,consumption_reference FROM hermes.maintainer_scm_write_consumption WHERE authorization_reference=$1',[AUTH]);
  const ownership=await pool.query('SELECT ownership_key,persistence_key,intent_digest,attempt_reference FROM hermes.maintainer_scm_write_attempt_ownership WHERE attempt_reference=$1',[ATTEMPT]);
  process.stdout.write(JSON.stringify({status:'UPDATE_FILE_CANARY_READONLY_AUDIT',consumption_count:consumption.rowCount,ownership_count:ownership.rowCount,consumption:consumption.rows,ownership:ownership.rows})+'\n');
 } finally { await pool.end(); }
}
main().catch(error=>{process.stdout.write(JSON.stringify({status:'UPDATE_FILE_CANARY_READONLY_AUDIT_FAILED',reason:error.message})+'\n');process.exitCode=2;});

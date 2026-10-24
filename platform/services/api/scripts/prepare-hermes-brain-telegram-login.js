#!/usr/bin/env node
'use strict';
// Generate a staging-only SCRAM activation request WITHOUT printing the secret.
// No Supabase credential, text data, SQL grant or user token is committed here.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const folder='/home/hermesadmin/.hermes-telegram/secret';
const pwFile=path.join(folder,'brain-telegram-password');
const sqlFile=path.join(folder,'brain-telegram-login-activation.sql');
const expiry=new Date(Date.now()+75*24*60*60*1000).toISOString();
if(process.getuid()===0)throw Error('RUN_AS_HERMESADMIN_ONLY');
const st=fs.statSync(folder);
if(!st.isDirectory()||(st.mode&0o777)!==0o700||st.uid!==process.getuid())
 throw Error('UNSAFE_SECRET_DIRECTORY');
if(fs.existsSync(pwFile)||fs.existsSync(sqlFile))throw Error('ACTIVATION_PREPARED_ALREADY');
const password=crypto.randomBytes(54).toString('base64url');
const salt=crypto.randomBytes(16),iterations=4096;
const salted=crypto.pbkdf2Sync(password,salt,iterations,32,'sha256');
const clientKey=crypto.createHmac('sha256',salted).update('Client Key').digest();
const storedKey=crypto.createHash('sha256').update(clientKey).digest();
const serverKey=crypto.createHmac('sha256',salted).update('Server Key').digest();
const verifier='SCRAM-SHA-256$'+iterations+':'+salt.toString('base64')+'$'+
 storedKey.toString('base64')+':'+serverKey.toString('base64');
const sql=`-- PRIVATE STAGING CREDENTIAL ACTIVATION; NEVER COMMIT OR SHARE.
-- Verifier is one-way SCRAM, not the plaintext password.
BEGIN;
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
   WHERE rolname='hermes_telegram_brain_login'
   AND rolcanlogin=false AND rolinherit=false AND rolbypassrls=false)
 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
   WHERE rolname='hermes_telegram_brain_reader'
   AND rolcanlogin=false AND rolbypassrls=false)
 OR (SELECT count(*) FROM hermes_brain.memory_items
    WHERE tenant_id='grupo_erick' AND status='approved' AND expires_at>now())<>4
 OR NOT pg_catalog.pg_has_role('hermes_telegram_brain_login',
   'hermes_telegram_brain_reader','SET')
 OR pg_catalog.has_table_privilege('hermes_telegram_brain_login',
   'hermes_brain.memory_items','SELECT')
 THEN RAISE EXCEPTION 'HERMES_BRAIN_LOGIN_ACTIVATION_DENIED'; END IF;
END $guard$;
ALTER ROLE hermes_telegram_brain_login LOGIN PASSWORD '${verifier}'
 VALID UNTIL '${expiry}';
DO $postcheck$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
  WHERE rolname='hermes_telegram_brain_login' AND rolcanlogin=true
  AND rolbypassrls=false AND rolinherit=false)
 THEN RAISE EXCEPTION 'LOGIN_ACTIVATION_INVALID'; END IF;
END $postcheck$;
COMMIT;
SELECT rolcanlogin AS login_enabled FROM pg_catalog.pg_roles
 WHERE rolname='hermes_telegram_brain_login';
`;
fs.writeFileSync(pwFile,password+'\n',{mode:0o600,flag:'wx'});
try{fs.writeFileSync(sqlFile,sql,{mode:0o600,flag:'wx'});}
catch(e){fs.unlinkSync(pwFile);throw e;}
console.log('HERMES_BRAIN_PRIVATE_CREDENTIAL_PREPARED');
console.log('PASSWORD_FILE_MODE='+ (fs.statSync(pwFile).mode&0o777).toString(8));
console.log('ACTIVATION_FILE_MODE='+ (fs.statSync(sqlFile).mode&0o777).toString(8));
console.log('NO_PASSWORD_OR_HASH_PRINTED');

'use strict';
// Operator runs locally on the VPS after securely saving the BotFather token.
// Code is time-limited, never put into source, logs, or a GitHub comment.
const fs=require('node:fs');
const {randomBytes,createHash}=require('node:crypto');
const {checkStateDirectory,loadState,saveState}=
 require('./run-hermes-telegram-private');
const dir='/home/hermesadmin/.hermes-telegram/state';
if(require.main===module){
 try{
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  checkStateDirectory(dir);
  if(loadState(dir,'owner.json')!==null)
   throw Error('telegram_already_paired');
  const code=randomBytes(9).toString('base64url');
  if(code.length!==12)throw Error('pairing_code_generation_failed');
  const now=Date.now();
  saveState(dir,'pairing.json',{
   sha256:createHash('sha256').update(code).digest('hex'),
   expires_at:now+15*60*1000,attempts:0
  });
  console.log('Código de vínculo (15 minutos): '+code);
  console.log('No Telegram privado com seu bot, envie: /vincular '+code);
 }catch{
  console.error('Não foi possível gerar o vínculo. Confira as permissões ou o estado anterior.');
  process.exitCode=1;
 }
}

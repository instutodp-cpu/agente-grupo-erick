'use strict';
// Personal-only staging UI. Supabase Auth/JWT + SECURITY INVOKER RPC;
// no company tenant switching, secrets, import upload, service roles or memory publication.
(function () {
 const script=document.currentScript||document.querySelector('script[data-publishable-key]');
 const origin='https://hermes-staging.grupoerick.tech';
 const redirect=origin+'/brain/personal.html';
 const status=document.getElementById('status');
 const login=document.getElementById('loginArea');
 const owner=document.getElementById('ownerArea');
 const results=document.getElementById('results');
 const choice=new Set(['chatgpt','claude']);
 const statuses=new Map();
 let active=false;
 function notify(value){status.textContent=value;}
 function deny(){
  active=false;owner.hidden=true;login.hidden=false;
  results.replaceChildren();
  document.getElementById('previewInspect').disabled=true;
  document.getElementById('previewFile').value='';
  document.getElementById('previewReport').textContent='Nenhum arquivo conferido.';
 }
 function disablePersonalOperations(){
  active=false;
  statuses.clear();
  results.replaceChildren();
  for(const provider of choice){
   document.getElementById(provider+'Status').textContent=
    'Módulo pessoal não habilitado';
   document.getElementById(provider+'Grant').disabled=true;
   document.getElementById(provider+'Revoke').disabled=true;
  }
  document.getElementById('searchForm').querySelector('button').disabled=true;
  document.getElementById('erase').disabled=true;
  document.getElementById('previewInspect').disabled=true;
 }
 function enablePersonalOperations(){
  document.getElementById('searchForm').querySelector('button').disabled=false;
  document.getElementById('erase').disabled=false;
  document.getElementById('previewInspect').disabled=false;
 }
 if(location.origin!==origin||location.pathname!=='/brain/personal.html'||
   !script||!window.supabase||
   typeof window.supabase.createClient!=='function'||
   !/^sb_publishable_/.test(script.dataset.publishableKey||'')){
  deny();notify('Ambiente pessoal não autorizado. Nenhum recurso habilitado.');return;
 }
 const client=window.supabase.createClient(
  script.dataset.supabaseUrl,script.dataset.publishableKey,{
   auth:{flowType:'implicit',detectSessionInUrl:true,
    persistSession:false,autoRefreshToken:true}
  });
 async function checkedUser(){
  const r=await client.auth.getUser();
  if(r.error||!r.data.user)throw Error('personal_auth_denied');
  return r.data.user;
 }
 async function rpc(name,args){
  if(!active)throw Error('personal_session_not_verified');
  await checkedUser();
  const response=await client.rpc(name,args);
  if(response.error)throw Error('personal_operation_denied');
  return response.data;
 }
 async function refreshSources(){
  const data=await rpc('hermes_personal_source_status');
  if(!Array.isArray(data)||data.length!==2)throw Error('personal_source_status_invalid');
  const seen=new Set();
  for(const row of data){
   if(!row||!choice.has(row.provider)||seen.has(row.provider)||
     !['not_connected','authorized','revoked'].includes(row.status))
     throw Error('personal_source_status_invalid');
   seen.add(row.provider);statuses.set(row.provider,row.status);
   const label=document.getElementById(row.provider+'Status');
   const names={not_connected:'Não autorizada',authorized:'Autorizada',
    revoked:'Revogada — exclua antes de autorizar novamente'};
   label.textContent=names[row.status];
   document.getElementById(row.provider+'Grant').disabled=
    row.status!=='not_connected';
   document.getElementById(row.provider+'Revoke').disabled=
    row.status!=='authorized';
  }
  if(seen.size!==2)throw Error('personal_source_status_invalid');
 }
 async function unlock(){
  deny();
  let user;
  try{
   // Wait until the Supabase client finishes processing an OTP URL redirect.
   // getSession is NOT authority: getUser verifies the session with Auth.
   const session=await client.auth.getSession();
   if(session.error||!session.data?.session)
    throw Error('personal_session_missing');
   user=await checkedUser();
  }catch(_){
   deny();notify('Sem acesso pessoal confirmado. Solicite novo link de login.');
   return;
  }
  login.hidden=true;owner.hidden=false;
  document.getElementById('ownerIdentity').textContent=
   'Identidade confirmada pelo Supabase Auth: '+String(user.email||'usuário confirmado');
  active=true;
  try{
   await refreshSources();
   enablePersonalOperations();
   notify('Identidade verificada e módulo pessoal habilitado para esta sessão.');
  }catch(_){
   // An absent RPC or a denied RLS policy is a SERVICE READINESS failure.
   // Do not falsely tell the owner that the authenticated identity failed.
   disablePersonalOperations();
   notify('Identidade confirmada. O módulo pessoal ainda não está habilitado; '+
    'autorizações, pesquisa e importação permanecem bloqueadas.');
  }
 }
 document.getElementById('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const b=event.currentTarget.querySelector('button');b.disabled=true;
  try{
   const email=document.getElementById('email').value.trim();
   const r=await client.auth.signInWithOtp({email,options:{
    emailRedirectTo:redirect,shouldCreateUser:false
   }});
   if(r.error)throw r.error;
   notify('Se a conta existir, enviaremos um link de login para esse e-mail.');
  }catch(_){notify('Não foi possível solicitar login pessoal.');}
  finally{b.disabled=false;}
 });
 document.getElementById('logout').addEventListener('click',async()=>{
  deny();
  try{await client.auth.signOut({scope:'local'});}catch(_){}
  notify('Sessão encerrada neste navegador.');
 });
 for(const provider of choice){
  document.getElementById(provider+'Grant').addEventListener('click',async event=>{
   const b=event.currentTarget;
   if(statuses.get(provider)!=='not_connected'||
      !document.getElementById(provider+'Consent').checked){ 
    notify('Marque a autorização explícita desta fonte antes de continuar.');return;
   }
   b.disabled=true;
   try{
    const receipt=await rpc('hermes_personal_source_consent',{p_provider:provider});
    if(receipt!=='authorized'&&receipt!=='already_authorized')
     throw Error('unverified_grant');
    document.getElementById(provider+'Consent').checked=false;
    await refreshSources();notify('Fonte pessoal autorizada por sua identidade.');
   }catch(_){notify('Autorização não concluída. Nenhuma importação foi feita.');}
   finally{if(active)await refreshSources().catch(()=>deny());}
  });
  document.getElementById(provider+'Revoke').addEventListener('click',async event=>{
   if(statuses.get(provider)!=='authorized')return;
   const b=event.currentTarget;b.disabled=true;
   try{
    const receipt=await rpc('hermes_personal_source_revoke',{p_provider:provider});
    if(receipt!==true)throw Error('revoke_unverified');
    results.replaceChildren();await refreshSources();
    notify('Fonte revogada. Leitura e novas importações bloqueadas.');
   }catch(_){notify('Revogação não confirmada. Verifique sua sessão.');}
   finally{if(active)await refreshSources().catch(()=>deny());}
  });
 }
 document.getElementById('searchForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const provider=document.getElementById('provider').value;
  const query=document.getElementById('query').value.trim();
  if(!choice.has(provider)||statuses.get(provider)!=='authorized'||
   query.length<2||query.length>120){notify('Fonte não autorizada ou busca inválida.');return;}
  const b=event.currentTarget.querySelector('button');b.disabled=true;
  results.replaceChildren();
  try{
   const data=await rpc('hermes_personal_history_search',{
    p_provider:provider,p_query:query,p_limit:5
   });
   if(!Array.isArray(data)||data.length>5)throw Error('invalid_search');
   for(const item of data){
    if(!item||item.trust_level!=='unreviewed_personal_archive'||
      typeof item.content!=='string'||item.content.length>16000||
      typeof item.conversation_title!=='string'||
      !['selected','alternate','unknown','not_applicable'].includes(item.branch_status))
     throw Error('invalid_private_result');
    const article=document.createElement('article');
    const title=document.createElement('strong');
    title.textContent=item.conversation_title||'Conversa histórica';
    const content=document.createElement('p');
    content.textContent=item.content;
    const sub=document.createElement('small');
    sub.textContent='Fonte: '+provider+' · '+item.branch_status+
     ' · histórico não revisado';
    article.append(title,content,sub);results.appendChild(article);
   }
   notify(data.length?'Pesquisa pessoal concluída.':
    'Nenhum texto encontrado na fonte pessoal autorizada.');
  }catch(_){
   results.replaceChildren();notify('Pesquisa pessoal não autorizada ou indisponível.');
  }finally{b.disabled=false;}
 });
 // Staging-only local intake preview. No network calls, persistent storage,
 // import, or display of historical titles and text are permitted here.
 const previewReport=document.getElementById('previewReport');
 const previewFile=document.getElementById('previewFile');
 document.getElementById('previewInspect').addEventListener('click',async event=>{
  const button=event.currentTarget;
  const provider=document.getElementById('previewProvider').value;
  const file=previewFile.files&&previewFile.files[0];
  if(!active||!choice.has(provider)||statuses.get(provider)!=='authorized'){
   previewReport.textContent='Autorize a fonte e confirme sua sessão primeiro.';
   return;
  }
  if(!file||typeof file.name!=='string'||
    !/^[^\\/]+\\.json$/i.test(file.name)||
    !Number.isSafeInteger(file.size)||file.size<2||
    file.size>32*1024*1024||typeof file.text!=='function'){
   previewReport.textContent='Arquivo recusado. Escolha um JSON de até 32 MiB, nunca um ZIP.';
   return;
  }
  button.disabled=true;
  try{
   await checkedUser();
   const raw=JSON.parse(await file.text());
   const conversations=Array.isArray(raw)?raw:
    (raw&&Array.isArray(raw.conversations)?raw.conversations:null);
   if(!conversations||conversations.length<1||conversations.length>20000)
    throw Error('preview_unsupported_shape');
   const unique=new Set();
   let nodes=0;
   for(const conversation of conversations){
    if(!conversation||typeof conversation!=='object'||Array.isArray(conversation))
     throw Error('preview_invalid_conversation');
    const ref=provider==='chatgpt'?
     (conversation.conversation_id||conversation.id):
     (conversation.uuid||conversation.id);
    if(typeof ref!=='string'||!ref||ref.length>160||unique.has(ref))
     throw Error('preview_invalid_conversation_id');
    unique.add(ref);
    let count;
    if(provider==='chatgpt'){
     const mapping=conversation.mapping;
     if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))
      throw Error('preview_no_mapping');
     count=Object.keys(mapping).length;
    }else{
     if(!Array.isArray(conversation.chat_messages))
      throw Error('preview_no_messages');
     count=conversation.chat_messages.length;
    }
    if(count>1000)throw Error('preview_too_many_nodes');
    nodes+=count;
   }
   // This is structural coverage, NOT a normalized-message import receipt.
   previewReport.textContent='Prévia local: '+conversations.length+
    ' conversas, '+nodes+' nós/mensagens brutos. Estrutura reconhecida. '+
    'Nenhum conteúdo enviado ou importado. A contagem de textos válidos será '+
    'confirmada somente pela homologação do importador.';
  }catch(_){
   previewReport.textContent='Estrutura não reconhecida ou sessão indisponível. '+
    'Nada foi enviado ou importado.';
  }finally{
   button.disabled=!active;
   previewFile.value='';
  }
 });
 document.getElementById('erase').addEventListener('click',async event=>{
  const provider=document.getElementById('eraseProvider').value;
  const confirmation=document.getElementById('eraseConfirm').value;
  if(!choice.has(provider)||confirmation!=='EXCLUIR'){
   notify('Confirme exatamente EXCLUIR para apagar esta fonte.');return;
  }
  const b=event.currentTarget;b.disabled=true;
  try{
   const receipt=await rpc('hermes_personal_source_erase',{p_provider:provider});
   if(receipt!==true)throw Error('erase_unverified');
   document.getElementById('eraseConfirm').value='';
   results.replaceChildren();await refreshSources();
   notify('Fonte excluída no Hermes. O histórico associado foi apagado em cascata.');
  }catch(_){notify('Exclusão não confirmada. Verifique a sessão.');}
  finally{if(active)await refreshSources().catch(()=>deny());}
 });
 void unlock();
})();
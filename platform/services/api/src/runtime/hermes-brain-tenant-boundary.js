'use strict';
// Admission guard for the future durable Second Brain retrieval port.
// Receives an identity/membership produced by trusted AuthN, never by a
// user message, model or external provider. No persistence, network, LLM or
// permission to execute, merge or write any action.
const TYPES=Object.freeze(['personal','grupo_erick','external_client']);
const CLASSIFICATIONS=Object.freeze(['public','internal','confidential']);
const VISIBILITIES=Object.freeze(['owner_only','tenant_shared','scoped']);
const REGEX=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function id(v){return typeof v==='string'&&REGEX.test(v);}
function tenantMatches(tenant,type,user){
 if(type==='grupo_erick')return tenant==='grupo_erick';
 if(type==='personal')return typeof tenant==='string'&&tenant==='personal::'+user;
 if(type==='external_client')return typeof tenant==='string'&&
  /^client::[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(tenant);
 return false;
}
function ids(v){return Array.isArray(v)&&v.length<=100&&v.every(id)&&new Set(v).size===v.length;}
function code(reason){return Object.freeze({allowed:false,reason,executed:false});}
function authorizeRead({identity,workspace,item,now=Date.now()}={}){
 if(!identity||identity.authenticated!==true||!id(identity.user_id)||
  !Array.isArray(identity.memberships)||identity.memberships.length>100)
  return code('AUTH_CONTEXT_DENIED');
 // The workspace must come from a verified session selector.
 if(!workspace||workspace.verified_session_selection!==true||
  !TYPES.includes(workspace.workspace_type)||
  !tenantMatches(workspace.tenant_id,workspace.workspace_type,identity.user_id))
  return code('WORKSPACE_DENIED');
 const matched=identity.memberships.filter(x=>
  x&&x.tenant_id===workspace.tenant_id&&
  x.workspace_type===workspace.workspace_type&&
  x.user_id===identity.user_id&&x.status==='active');
 if(matched.length!==1)return code('MEMBERSHIP_DENIED');
 const member=matched[0];
 if(!ids(member.company_ids)||!ids(member.store_ids)||
  !ids(member.allowed_domains)||!ids(member.allowed_classifications)||
  !ids(member.allowed_visibilities))
  return code('MEMBERSHIP_SCOPE_DENIED');
 if(!item||item.tenant_id!==workspace.tenant_id||
  item.workspace_type!==workspace.workspace_type)
  return code('TENANT_BOUNDARY_DENIED');
 if(!id(item.id)||!id(item.owner_user_id)||!id(item.domain)||
  !VISIBILITIES.includes(item.visibility)||
  !CLASSIFICATIONS.includes(item.classification)||
  item.status!=='approved'||item.source_status!=='verified'||
  !Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(item.expires_at)||
  item.expires_at<=now)
  return code('MEMORY_TRUST_DENIED');
 if(!member.allowed_domains.includes(item.domain)||
  !member.allowed_classifications.includes(item.classification)||
  !member.allowed_visibilities.includes(item.visibility))
  return code('DOMAIN_OR_CLASSIFICATION_DENIED');
 if(item.visibility==='owner_only'&&item.owner_user_id!==identity.user_id)
  return code('OWNER_BOUNDARY_DENIED');
 if(item.visibility==='scoped'&&!item.company_id&&!item.store_id)
  return code('EMPTY_SCOPED_RECORD_DENIED');
 if(item.company_id!==null&&item.company_id!==undefined&&
  (!id(item.company_id)||!member.company_ids.includes(item.company_id)))
  return code('COMPANY_BOUNDARY_DENIED');
 if(item.store_id!==null&&item.store_id!==undefined&&
  (!id(item.store_id)||!member.store_ids.includes(item.store_id)))
  return code('STORE_BOUNDARY_DENIED');
 // Two independent allowlists do not prove that a store belongs to a company.
 // For a multi-company membership, require a trusted pair from AuthN.
 // A single-company membership cannot pair a store with an alternate company.
 if(item.company_id!=null&&item.store_id!=null&&member.company_ids.length>1){
  const pairs=member.store_company_bindings;
  if(!Array.isArray(pairs)||pairs.length>100||pairs.length===0||
   pairs.some(p=>!p||!id(p.company_id)||!id(p.store_id)||
    !member.company_ids.includes(p.company_id)||
    !member.store_ids.includes(p.store_id))||
   new Set(pairs.map(p=>p.company_id+'::'+p.store_id)).size!==pairs.length||
   pairs.filter(p=>p.company_id===item.company_id&&
    p.store_id===item.store_id).length!==1)
   return code('STORE_COMPANY_BINDING_DENIED');
 }
 // A scoped company/store must not be bypassed through broad tenant sharing.
 return Object.freeze({allowed:true,reason:'VERIFIED_SCOPE_ALLOWED',
  executed:false,tenant_id:workspace.tenant_id,memory_id:item.id});
}
module.exports={authorizeRead,TYPES,CLASSIFICATIONS,VISIBILITIES};

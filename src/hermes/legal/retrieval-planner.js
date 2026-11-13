const {getLegalSourcePolicy,rankAuthority}=require('./source-registry');
const {assessAuthorityAt}=require('./authority-temporal');

function planLegalRetrieval(query){
 const sourceOrder=query.purpose==='process_metadata'
  ? ['cnj_datajud','tribunal_official']
  : query.purpose==='legal_authority'
    ? ['planalto','lexml','stf','stj','tst','anpd','tribunal_official']
    : ['planalto','lexml','stf','stj','tst','anpd','tribunal_official','internal','open_web'];
 return {query_id:query.query_id,jurisdiction:query.jurisdiction,as_of:query.as_of,purpose:query.purpose,source_order:sourceOrder,hybrid:true,require_provenance:true,preserve_conflicts:true};
}
function jurisdictionScore(candidate,jurisdiction){
 if(candidate.jurisdiction===jurisdiction)return 3;
 if(candidate.jurisdiction==='BR' && jurisdiction.startsWith('BR'))return 2;
 return 0;
}
function temporalScore(candidate,asOf){
 if(!candidate.authority)return 1;
 return assessAuthorityAt(candidate.authority,asOf).applicable?3:0;
}
function rankLegalCandidates(query,candidates){
 return (candidates||[]).map(c=>{
   const policy=getLegalSourcePolicy(c.source_id);
   const authority=rankAuthority(c.source_id);
   const jurisdiction=jurisdictionScore(c,query.jurisdiction);
   const temporal=temporalScore(c,query.as_of);
   const relevance=Math.max(0,Math.min(1,Number(c.relevance)||0));
   const eligible=!!policy && jurisdiction>0 && temporal>0 && !(query.purpose==='legal_authority'&&!policy.allowedForAuthority);
   return {...c,eligible,score:eligible?(authority*100+jurisdiction*20+temporal*10+relevance):0};
 }).sort((a,b)=>b.score-a.score);
}
function buildRetrievalEvidence(query,ranked){
 return ranked.filter(x=>x.eligible).slice(0,query.max_results||10).map(x=>({
   evidence_id:'retrieval:'+x.candidate_id,
   evidence_type:x.evidence_type,
   source_snapshot_ref:x.source_snapshot_ref,
   supports:x.supports||[],
   contradicts:x.contradicts||[],
   integrity_status:x.integrity_status||'unverified',
   excerpt_ref:x.excerpt_ref||null
 }));
}
module.exports={planLegalRetrieval,rankLegalCandidates,buildRetrievalEvidence};

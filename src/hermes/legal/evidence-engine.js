const MATERIAL_TYPES=new Set(['legal_authority','precedent','recommendation']);
function indexEvidence(evidence){const map=new Map();for(const e of evidence||[])map.set(e.evidence_id,e);return map;}
function evaluateClaim(claim,evidence){
 const idx=indexEvidence(evidence);const refs=(claim.evidence_refs||[]).map(id=>idx.get(id)).filter(Boolean);
 const valid=refs.filter(e=>e.integrity_status==='verified');
 const supporting=valid.filter(e=>(e.supports||[]).includes(claim.claim_id));
 const contrary=valid.filter(e=>(e.contradicts||[]).includes(claim.claim_id));
 if(contrary.length) return {status:'conflicted',certifiable:false,supporting:supporting.map(x=>x.evidence_id),contrary:contrary.map(x=>x.evidence_id)};
 if(!supporting.length) return {status:'unsupported',certifiable:false,supporting:[],contrary:[]};
 if(MATERIAL_TYPES.has(claim.claim_type) && supporting.every(e=>['fact','internal_document','process_metadata'].includes(e.evidence_type))){
   return {status:'insufficient',certifiable:false,supporting:supporting.map(x=>x.evidence_id),contrary:[]};
 }
 return {status:'supported',certifiable:true,supporting:supporting.map(x=>x.evidence_id),contrary:[]};
}
function evaluateBundle({claims=[],evidence=[]}){
 const results=claims.map(c=>({claim_id:c.claim_id,...evaluateClaim(c,evidence)}));
 const conflicted=results.some(r=>r.status==='conflicted');
 const insufficient=results.some(r=>!r.certifiable);
 return {review_status:conflicted?'conflicted':insufficient?'insufficient':'verified',certifiable:!conflicted&&!insufficient,claims:results};
}
function renderClaimLabel(claim){return {fact:'FACT',internal_document:'INTERNAL_DOCUMENT',legal_authority:'LEGAL_AUTHORITY',precedent:'PRECEDENT',inference:'INFERENCE',recommendation:'RECOMMENDATION'}[claim.claim_type]||'UNKNOWN';}
module.exports={evaluateClaim,evaluateBundle,renderClaimLabel};

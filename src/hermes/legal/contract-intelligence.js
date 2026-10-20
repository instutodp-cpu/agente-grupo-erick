function requireFragments(entity){return Array.isArray(entity?.fragment_refs)&&entity.fragment_refs.length>0?{valid:true,reason:'traceable_to_document'}:{valid:false,reason:'missing_fragment_provenance'};}
function assessExtractedObligation(o){
 const trace=requireFragments(o);if(!trace.valid)return {usable:false,reason:trace.reason};
 if(o.review_status==='rejected')return {usable:false,reason:'obligation_rejected'};
 if(o.confidence<0.8)return {usable:false,reason:'low_extraction_confidence'};
 if(o.review_status!=='verified')return {usable:false,reason:'human_review_required'};
 return {usable:true,reason:'verified_obligation'};
}
function contractLifecycle(contract,asOf){
 if(!contract?.effective_from)return {state:'unknown',reason:'missing_effective_from'};
 const at=new Date(asOf+'T00:00:00Z'),from=new Date(contract.effective_from+'T00:00:00Z');
 if(Number.isNaN(at.getTime())||Number.isNaN(from.getTime()))return {state:'unknown',reason:'invalid_date'};
 if(at<from)return {state:'not_effective',reason:'before_effective_from'};
 if(contract.effective_until){const until=new Date(contract.effective_until+'T00:00:00Z');if(at>until)return {state:'expired',reason:'after_effective_until'};}
 return {state:'in_term',reason:'within_declared_term'};
}
function detectContractCandidates({clauses=[],obligations=[]}){
 return {renewal_clauses:clauses.filter(c=>c.clause_type==='renewal').map(c=>c.clause_id),termination_clauses:clauses.filter(c=>c.clause_type==='termination').map(c=>c.clause_id),penalty_clauses:clauses.filter(c=>c.clause_type==='penalty').map(c=>c.clause_id),obligations_requiring_review:obligations.filter(o=>!assessExtractedObligation(o).usable).map(o=>o.obligation_id)};
}
module.exports={requireFragments,assessExtractedObligation,contractLifecycle,detectContractCandidates};

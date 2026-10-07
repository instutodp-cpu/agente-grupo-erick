function validatePlaybookRule(rule){
 if(!rule)return {valid:false,reason:'missing_rule'};
 if(rule.policy_origin==='legal_authority_backed'&&!(rule.authority_refs||[]).length)return {valid:false,reason:'missing_authority_provenance'};
 if(rule.policy_origin==='internal_preference'&&(rule.authority_refs||[]).length)return {valid:false,reason:'internal_policy_must_not_impersonate_authority'};
 return {valid:true,reason:'playbook_rule_valid'};
}
function compareClauseToRule(clause,rule,observed={}){
 const vr=validatePlaybookRule(rule);if(!vr.valid)return {matched:false,risk:null,reason:vr.reason};
 if(clause.clause_type!==rule.clause_type)return {matched:false,risk:null,reason:'rule_not_applicable'};
 const violations=[];
 for(const [key,expected] of Object.entries(rule.conditions||{})){
   const actual=observed[key];
   if(expected?.max!=null&&Number(actual)>Number(expected.max))violations.push({field:key,type:'above_max',actual,expected:expected.max});
   if(expected?.min!=null&&Number(actual)<Number(expected.min))violations.push({field:key,type:'below_min',actual,expected:expected.min});
   if(expected?.equals!=null&&actual!==expected.equals)violations.push({field:key,type:'not_equal',actual,expected:expected.equals});
 }
 if(!violations.length)return {matched:true,risk:null,reason:'within_playbook'};
 const sourceKind=rule.policy_origin==='legal_authority_backed'?'authority_backed':'playbook_deviation';
 return {matched:true,reason:'deviation_detected',risk:{risk_id:'risk:'+rule.rule_id+':'+clause.clause_id,risk_type:'contract_clause_deviation',severity:rule.severity,source_kind:sourceKind,clause_ref:clause.clause_id,fragment_refs:clause.fragment_refs||[],playbook_rule_ref:rule.rule_id,authority_refs:rule.authority_refs||[],status:'candidate',explanation:JSON.stringify(violations)}};
}
function canPresentAsLegalViolation(risk){return !!risk&&risk.source_kind==='authority_backed'&&(risk.authority_refs||[]).length>0;}
module.exports={validatePlaybookRule,compareClauseToRule,canPresentAsLegalViolation};

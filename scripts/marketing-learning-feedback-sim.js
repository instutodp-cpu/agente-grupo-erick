const assert=require('node:assert/strict');const crypto=require('node:crypto');
const MIN=3,MAX_CONTRARY=.25;
function sameScope(items){if(!items.length)return false;const s=JSON.stringify(items[0].scope);return items.every(x=>JSON.stringify(x.scope)===s)}
function candidate(claim,observations){
 const supports=observations.filter(x=>x.direction==='support'),contrary=observations.filter(x=>x.direction==='contrary');
 const refs=[...new Set(observations.map(x=>x.evidence_ref))],distinct=refs.length===observations.length,scopeOk=sameScope(observations);
 const ratio=observations.length?contrary.length/observations.length:1;
 let status='hypothesis';if(supports.length>=1)status='tested_insight_candidate';if(supports.length>=MIN&&scopeOk&&distinct&&ratio<=MAX_CONTRARY)status='eligible_for_rule';if(supports.length>=MIN&&(!scopeOk||!distinct||ratio>MAX_CONTRARY))status='promotion_blocked';
 const scope=observations[0]?.scope||{channel:'unknown'};
 return {candidate_id:'lc-'+crypto.createHash('sha256').update(claim+JSON.stringify(scope)).digest('hex').slice(0,12),claim,scope,evidence_refs:refs,support_count:supports.length,contrary_count:contrary.length,status};
}
function promote(c,observations){
 if(c.status!=='eligible_for_rule')return null;
 const support=observations.filter(x=>x.direction==='support').map(x=>x.evidence_ref),contrary=observations.filter(x=>x.direction==='contrary').map(x=>x.evidence_ref);
 const confidence=Math.min(.9,Math.max(0,support.length*.2-contrary.length*.2));
 return {rule_id:'lr-'+crypto.createHash('sha256').update(c.candidate_id+support.join('|')+contrary.join('|')).digest('hex').slice(0,12),claim:c.claim,scope:c.scope,confidence,supporting_evidence_refs:support,contrary_evidence_refs:contrary,validity:'active',provenance:{promotion_policy:'learning-promotion-policy-v1',simulation_only:true}};
}
function run(){const scope={channel:'instagram',store_id:'barreiros',audience:'women-25-35',format:'reel'};
 const one=candidate('Product-led Reel CTA improves qualified WhatsApp contacts',[{direction:'support',evidence_ref:'e1',scope}]);assert.notEqual(one.status,'eligible_for_rule');assert.equal(promote(one,[]),null);
 const obs=['e1','e2','e3'].map(evidence_ref=>({direction:'support',evidence_ref,scope}));const c=candidate('Product-led Reel CTA improves qualified WhatsApp contacts',obs);assert.equal(c.status,'eligible_for_rule');const r=promote(c,obs);assert.equal(r.supporting_evidence_refs.length,3);assert.equal(r.provenance.simulation_only,true);
 console.log('Marketing C07 learning feedback simulation: PASS');
}
if(require.main===module)run();module.exports={candidate,promote};

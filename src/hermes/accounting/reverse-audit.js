'use strict';

const REVERSE_DOMAINS=Object.freeze(['BANK','FISCAL','INVENTORY','PAYROLL','CARD','AP_AR','LEDGER']);
function req(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function createReverseAuditRun(i={}){
 for(const f of ['runId','tenantId','companyId','period','domain','startedAt'])req(i[f],f);
 if(!REVERSE_DOMAINS.includes(i.domain))throw new Error('unsupported reverse audit domain');
 return Object.freeze({...i,status:i.status??'RUNNING'});
}
function bidirectionalTrace({sourceIds=[],ledgerIds=[]}={}){
 const source=new Set(sourceIds),ledger=new Set(ledgerIds);
 const missingFromLedger=sourceIds.filter(id=>!ledger.has(id));
 const unsupportedInLedger=ledgerIds.filter(id=>!source.has(id));
 return Object.freeze({missingFromLedger:Object.freeze(missingFromLedger),unsupportedInLedger:Object.freeze(unsupportedInLedger),pass:missingFromLedger.length===0&&unsupportedInLedger.length===0});
}
function traceExpectedChain({nodes=[],requiredTypes=[]}={}){
 const present=new Set(nodes.map(n=>n.type));
 const missing=requiredTypes.filter(t=>!present.has(t));
 const orphanNodes=nodes.filter(n=>n.parentId&& !nodes.some(p=>p.id===n.parentId)).map(n=>n.id);
 return Object.freeze({pass:missing.length===0&&orphanNodes.length===0,missingTypes:Object.freeze(missing),orphanNodeIds:Object.freeze(orphanNodes)});
}
function amountTieOut({upstreamCents,downstreamCents}={}){
 if(!Number.isSafeInteger(upstreamCents)||!Number.isSafeInteger(downstreamCents))throw new Error('amounts must be safe integer cents');
 const varianceCents=downstreamCents-upstreamCents;
 return Object.freeze({upstreamCents,downstreamCents,varianceCents,status:varianceCents===0?'MATCHED':'EXCEPTION'});
}
function createReverseAuditException(i={}){
 for(const f of ['exceptionId','runId','domain','kind','description'])req(i[f],f);
 return Object.freeze({...i,status:'OPEN',requiresHumanReview:true,autoCorrection:false,evidenceIds:Object.freeze([...(i.evidenceIds??[])])});
}
function assessReverseAudit({traces=[],tieOuts=[],exceptions=[]}={}){
 const failedTrace=traces.some(t=>t.pass!==true);
 const failedTie=tieOuts.some(t=>t.status!=='MATCHED');
 const open=exceptions.filter(e=>e.status!=='RESOLVED').length;
 return Object.freeze({status:failedTrace||failedTie||open?'EXCEPTIONS':'PASS',openExceptions:open});
}
module.exports={REVERSE_DOMAINS,createReverseAuditRun,bidirectionalTrace,traceExpectedChain,amountTieOut,createReverseAuditException,assessReverseAudit};

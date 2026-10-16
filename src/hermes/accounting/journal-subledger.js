'use strict';

const JOURNAL_STATUSES=Object.freeze(['DRAFT','NEEDS_REVIEW','VALIDATED','APPROVED','POSTED','BLOCKED']);
const JOURNAL_VALUE_TYPES=Object.freeze(['ACTUAL','FORECAST','PROVISION','ASSESSED','PAID']);

function required(v,f){if(v===undefined||v===null||v==='')throw new Error(`${f} is required`);}
function cents(v,f){if(!Number.isSafeInteger(v)||v<0)throw new Error(`${f} must be a non-negative safe integer`);}

function createJournalLine(i={}){
 for(const f of ['lineId','accountCode','side','amountCents'])required(i[f],f);
 if(!['DEBIT','CREDIT'].includes(i.side))throw new Error('side must be DEBIT or CREDIT');
 cents(i.amountCents,'amountCents');
 if(i.amountCents===0)throw new Error('zero journal line is not allowed');
 return Object.freeze({
  lineId:i.lineId,accountCode:i.accountCode,side:i.side,amountCents:i.amountCents,
  companyId:i.companyId??null,establishmentId:i.establishmentId??null,
  costCenterId:i.costCenterId??null,departmentId:i.departmentId??null,
  evidenceIds:Object.freeze([...(i.evidenceIds??[])])
 });
}
function validateBalanced(lines=[]){
 if(lines.length<2)throw new Error('journal requires at least two lines');
 const debit=lines.filter(x=>x.side==='DEBIT').reduce((s,x)=>s+x.amountCents,0);
 const credit=lines.filter(x=>x.side==='CREDIT').reduce((s,x)=>s+x.amountCents,0);
 return Object.freeze({debitCents:debit,creditCents:credit,balanced:debit===credit,varianceCents:debit-credit});
}
function createJournalEntry(i={}){
 for(const f of ['journalEntryId','tenantId','companyId','occurredAt','accountingRuleId','accountingRuleVersion','chartOfAccountsVersion'])required(i[f],f);
 if(!JOURNAL_VALUE_TYPES.includes(i.valueType??'ACTUAL'))throw new Error('unsupported journal value type');
 const lines=Object.freeze([...(i.lines??[])].map(createJournalLine));
 const balance=validateBalanced(lines);
 return Object.freeze({
  journalEntryId:i.journalEntryId,tenantId:i.tenantId,companyId:i.companyId,
  establishmentId:i.establishmentId??null,occurredAt:i.occurredAt,competence:i.competence??null,
  accountingRuleId:i.accountingRuleId,accountingRuleVersion:i.accountingRuleVersion,
  chartOfAccountsVersion:i.chartOfAccountsVersion,valueType:i.valueType??'ACTUAL',
  sourceFactIds:Object.freeze([...(i.sourceFactIds??[])]),evidenceIds:Object.freeze([...(i.evidenceIds??[])]),
  lines,status:balance.balanced?(i.status??'DRAFT'):'BLOCKED',balance
 });
}
function assertPostable(entry,{humanApproved=false}={}){
 if(!entry.balance?.balanced)throw new Error('UNBALANCED_JOURNAL_BLOCKED');
 if(entry.status==='BLOCKED')throw new Error('BLOCKED_JOURNAL');
 if(humanApproved!==true)throw new Error('HUMAN_APPROVAL_REQUIRED');
 return true;
}
function assertNoBalancingPlug(input={}){
 if(input.purpose==='MAKE_IT_BALANCE'||input.unsupported===true){
  const err=new Error('UNSUPPORTED_BALANCING_ENTRY_DENIED');err.code='DENIED';throw err;
 }
 return true;
}
function classifyAccount({proposedAccountCode,approvedMapping=false}={}){
 required(proposedAccountCode,'proposedAccountCode');
 return Object.freeze({accountCode:proposedAccountCode,status:approvedMapping?'DETERMINISTIC':'NEEDS_REVIEW'});
}
function createChartOfAccountsReference(i={}){
 for(const f of ['chartId','version','source','validatedBy'])required(i[f],f);
 if(i.source==='LLM_INVENTED')throw new Error('chart of accounts must come from an approved real source');
 return Object.freeze({...i});
}
module.exports={JOURNAL_STATUSES,JOURNAL_VALUE_TYPES,createJournalLine,validateBalanced,createJournalEntry,assertPostable,assertNoBalancingPlug,classifyAccount,createChartOfAccountsReference};

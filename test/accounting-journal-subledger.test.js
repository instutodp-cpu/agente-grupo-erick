'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {createJournalEntry,assertPostable,assertNoBalancingPlug,classifyAccount,createChartOfAccountsReference}=require('../src/hermes/accounting/journal-subledger');

const base={journalEntryId:'j1',tenantId:'t',companyId:'c',occurredAt:'2026-10-02',accountingRuleId:'sale',accountingRuleVersion:'1',chartOfAccountsVersion:'2026.1'};
const line=(id,account,side,amount)=>({lineId:id,accountCode:account,side,amountCents:amount});

test('balanced journal remains draft and preserves exact cents',()=>{
 const j=createJournalEntry({...base,lines:[line('1','1.1.1','DEBIT',10001),line('2','3.1.1','CREDIT',10001)]});
 assert.equal(j.balance.balanced,true);assert.equal(j.status,'DRAFT');assert.equal(j.balance.debitCents,10001);
});
test('one-cent imbalance is blocked',()=>{
 const j=createJournalEntry({...base,lines:[line('1','1','DEBIT',10001),line('2','2','CREDIT',10000)]});
 assert.equal(j.status,'BLOCKED');assert.equal(j.balance.varianceCents,1);
 assert.throws(()=>assertPostable(j,{humanApproved:true}),/UNBALANCED/);
});
test('human approval is required before posting',()=>{
 const j=createJournalEntry({...base,lines:[line('1','1','DEBIT',10000),line('2','2','CREDIT',10000)]});
 assert.throws(()=>assertPostable(j),/HUMAN_APPROVAL_REQUIRED/);
 assert.equal(assertPostable(j,{humanApproved:true}),true);
});
test('unsupported balancing plug is denied',()=>{
 assert.throws(()=>assertNoBalancingPlug({purpose:'MAKE_IT_BALANCE'}),e=>e.code==='DENIED');
 assert.throws(()=>assertNoBalancingPlug({unsupported:true}),/UNSUPPORTED_BALANCING/);
});
test('AI proposed classification stays reviewable until approved mapping exists',()=>{
 assert.equal(classifyAccount({proposedAccountCode:'5.1'}).status,'NEEDS_REVIEW');
 assert.equal(classifyAccount({proposedAccountCode:'5.1',approvedMapping:true}).status,'DETERMINISTIC');
});
test('chart of accounts cannot be invented by LLM',()=>{
 assert.throws(()=>createChartOfAccountsReference({chartId:'c',version:'1',source:'LLM_INVENTED',validatedBy:'x'}),/approved real source/);
 assert.equal(createChartOfAccountsReference({chartId:'c',version:'1',source:'ACCOUNTANT_IMPORT',validatedBy:'accountant'}).source,'ACCOUNTANT_IMPORT');
});
test('forecast provision assessed and paid are not silently collapsed',()=>{
 const common={...base,lines:[line('1','1','DEBIT',100),line('2','2','CREDIT',100)]};
 assert.equal(createJournalEntry({...common,valueType:'FORECAST'}).valueType,'FORECAST');
 assert.equal(createJournalEntry({...common,valueType:'PROVISION'}).valueType,'PROVISION');
 assert.equal(createJournalEntry({...common,valueType:'ASSESSED'}).valueType,'ASSESSED');
 assert.equal(createJournalEntry({...common,valueType:'PAID'}).valueType,'PAID');
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerSafeWorkflowAuthorizedMutationEntry}=require('../src/core/hermes-maintainer-safe-workflow-authorized-mutation-entry');
test('requires explicit mutation orchestration',()=>assert.throws(()=>createHermesMaintainerSafeWorkflowAuthorizedMutationEntry(),/mutationOrchestration_required/));
test('fails closed before mutation when authority evidence is absent',async()=>{let calls=0;const x=createHermesMaintainerSafeWorkflowAuthorizedMutationEntry({mutationOrchestration:{execute:async()=>{calls++;}}});const out=await x.execute({}, {}, {});assert.equal(out.status,'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_BLOCKED');assert.equal(out.stage,'authority_evidence');assert.equal(calls,0);assert.equal(out.merge_authority,false);assert.equal(out.human_merge_required,true);});

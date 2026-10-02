'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHermesMaintainerSafeWorkflowAuthorizedMutationFlow}=require('../src/core/hermes-maintainer-safe-workflow-authorized-mutation-flow');
test('requires explicit authorized mutation entry',()=>assert.throws(()=>createHermesMaintainerSafeWorkflowAuthorizedMutationFlow(),/authorizedMutationEntry_required/));
test('fails closed before authorized mutation when controlled execution is invalid',async()=>{let calls=0;const flow=createHermesMaintainerSafeWorkflowAuthorizedMutationFlow({authorizedMutationEntry:{execute:async()=>{calls++;}}});const out=await flow.execute({},{});assert.equal(out.status,'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_BLOCKED');assert.equal(out.stage,'authority_entry');assert.equal(calls,0);assert.equal(out.merge_authority,false);assert.equal(out.human_merge_required,true);});
test('does not expose an authority grant operation',()=>{const mod=require('../src/core/hermes-maintainer-safe-workflow-authorized-mutation-flow');assert.equal(typeof mod.grantAuthority,'undefined');assert.equal(typeof mod.authorize,'undefined');});

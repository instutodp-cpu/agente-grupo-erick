'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareHermesMaintainerSafeWorkflowAuthorityEntry}=require('../src/core/hermes-maintainer-safe-workflow-authority-entry-composition');
test('fails closed before ownership or authority when controlled execution is invalid',()=>{const out=prepareHermesMaintainerSafeWorkflowAuthorityEntry({},{});assert.equal(out.status,'MAINTAINER_SAFE_WORKFLOW_AUTHORITY_ENTRY_BLOCKED');assert.equal(out.stage,'operation_route');assert.equal(out.authority_requirement,null);assert.equal(out.merge_authority,false);assert.equal(out.human_merge_required,true);});
test('module does not expose an authority grant operation',()=>{const mod=require('../src/core/hermes-maintainer-safe-workflow-authority-entry-composition');assert.equal(typeof mod.grantAuthority,'undefined');assert.equal(typeof mod.authorize,'undefined');});

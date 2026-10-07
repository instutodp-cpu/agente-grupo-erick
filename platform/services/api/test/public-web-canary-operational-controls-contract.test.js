'use strict';const test=require('node:test');const assert=require('node:assert/strict');const {createPublicWebCanaryOperationalControls}=require('../src/pilots/public-web-canary-operational-controls');const {PROVIDER_ID}=require('../src/core/public-web-transport-contract');
test('operational staging reference uses canonical public web provider id',()=>{const c=createPublicWebCanaryOperationalControls({environment:{}});assert.equal(c.secretReference.provider_id,PROVIDER_ID);assert.equal(c.production_allowed,false);assert.equal(c.credential_material_present,false);});

test('operational secret resolver validates only canonical staging opaque reference without material',()=>{
 const c=createPublicWebCanaryOperationalControls({environment:{}});
 assert.equal(c.secretResolver.canResolve(c.secretReference),true);
 assert.equal(c.secretResolver.canResolve({...c.secretReference,environment:'production'}),false);
 assert.equal(c.secretResolver.canResolve({...c.secretReference,reference_type:'local_test_double_reference'}),false);
 const r=c.secretResolver.resolveReference(c.secretReference,{environment:'staging',purpose:'public_web_canary_execution'});
 assert.equal(r.resolved,true); assert.equal(r.exportable,false); assert.equal(r.credential_material_present,false);
 assert.equal(Object.hasOwn(r,'secret'),false); assert.equal(Object.hasOwn(r,'token'),false); assert.equal(Object.hasOwn(r,'password'),false);
});

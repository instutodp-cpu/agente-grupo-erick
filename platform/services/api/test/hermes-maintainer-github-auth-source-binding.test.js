'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {REFERENCE,createHermesMaintainerGithubAuthSourceBinding}=require('../src/core/hermes-maintainer-github-auth-source-binding');
test('binds the single staging reference to an injected trusted secret source',async()=>{let seen;const b=createHermesMaintainerGithubAuthSourceBinding({readSecret:async r=>(seen=r,'opaque')});assert.equal(await b.resolveSecret(REFERENCE),'opaque');assert.equal(seen,REFERENCE);});
test('rejects arbitrary references before secret source invocation',async()=>{let calls=0;const b=createHermesMaintainerGithubAuthSourceBinding({readSecret:async()=>{calls++;return 'opaque'}});await assert.rejects(()=>b.resolveSecret('other'),/REFERENCE_NOT_ALLOWED/);assert.equal(calls,0);});
test('fails closed when source returns no material',async()=>{const b=createHermesMaintainerGithubAuthSourceBinding({readSecret:async()=>''});await assert.rejects(()=>b.resolveSecret(REFERENCE),/SECRET_UNAVAILABLE/);});
test('binding exposes no credential material as metadata',()=>{const b=createHermesMaintainerGithubAuthSourceBinding({readSecret:async()=> 'opaque'});assert.equal(JSON.stringify(b).includes('opaque'),false);assert.equal(Object.prototype.hasOwnProperty.call(b,'token'),false);});

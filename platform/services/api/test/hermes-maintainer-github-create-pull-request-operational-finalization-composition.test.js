'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {COMPOSITION_VERSION,createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition}=require('../src/runtime/hermes-maintainer-github-create-pull-request-operational-finalization-composition');
test('requires explicit postgres pool',()=>{assert.throws(()=>createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition({}),/pool/i);});
test('exports isolated operational finalization version',()=>{assert.equal(COMPOSITION_VERSION,'hermes_maintainer_github_create_pull_request_operational_finalization_composition_v1');});

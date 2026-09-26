'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('production API image contains the maintainer staging readiness probe',()=>{
 const dockerfile=fs.readFileSync(path.join(__dirname,'../Dockerfile'),'utf8');
 assert.match(dockerfile,/COPY scripts\/hermes-maintainer-staging-readiness-probe\.js \.\/scripts\/hermes-maintainer-staging-readiness-probe\.js/);
});

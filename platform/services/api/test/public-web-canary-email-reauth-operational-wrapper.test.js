'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const p=path.join(__dirname,'../scripts/public-web-canary-email-reauth-operational-wrapper.sh');
test('operational wrapper is fixed, fail-closed and does not expose secret material',()=>{const s=fs.readFileSync(p,'utf8');assert.match(s,/arguments_not_allowed/);assert.match(s,/environment_file_permissions_invalid/);assert.match(s,/public-web-canary-email-reauth-prepare\.js/);assert.doesNotMatch(s,/eval|sh -c|bash -c/);assert.doesNotMatch(s,/cat .*ENV_FILE|env\s*$/);});

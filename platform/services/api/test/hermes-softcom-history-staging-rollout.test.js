'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const script=fs.readFileSync(
 path.resolve(__dirname,'../scripts/deploy-hermes-telegram-history-staging.sh'),'utf8');

test('history rollout accepts only the pinned repository or a protected release script mount',()=>{
 assert.match(script,/SCRIPT_SOURCE=.*docker inspect/);
 assert.match(script,/case "\$SCRIPT_SOURCE" in/);
 assert.match(script,/\$BASE"\/releases\/\*/);
 assert.match(script,/RELEASE_NAME=\\?\$\{SCRIPT_SOURCE#/);
 assert.match(script,/\^\[a-z0-9-\]\+-\[0-9a-f\]\{40\}\\\\\.js\$/);
 assert.match(script,/! -L "\$SCRIPT_SOURCE"/);
 assert.match(script,/stat -c '%a' "\$SCRIPT_SOURCE"/);
});

test('history rollout remains explicit, read-only in check mode, and fail-closed',()=>{
 assert.match(script,/PRECHECK_DATABASE_ONLY/);
 assert.match(script,/PRECHECK_OK_NO_CHANGES/);
 assert.match(script,/HERMES_HISTORY_LIVE_ENABLED=true/);
 assert.match(script,/HERMES_EXECUTION_ENABLED=false/);
 assert.match(script,/HERMES_EXECUTION_KILL_SWITCH=true/);
 assert.match(script,/deny\(\)/);
});

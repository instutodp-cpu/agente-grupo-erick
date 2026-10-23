'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname,'../brain-web/index.html'),'utf8');
const js = fs.readFileSync(path.join(__dirname,'../brain-web/app.js'),'utf8');
test('browser pilot is parseable and precisely staging-scoped', () => {
  assert.doesNotThrow(() => new Function(js));
  assert.match(js,/https:\/\/hermes-staging\.grupoerick\.tech\/brain\//);
  assert.match(js,/location\.origin !==/);
  assert.match(html,/name="robots" content="noindex,nofollow,noarchive"/);
});
test('login uses an existing user and never grants administrative access', () => {
  assert.match(js,/shouldCreateUser: false/);
  assert.match(js,/persistSession: false/);
  assert.match(js,/client\.auth\.getUser\(\)/);
  assert.match(js,/client\.rpc\('hermes_brain_search'/);
  assert.match(js,/client\.rpc\('hermes_brain_access_status'/);
  assert.match(js,/access\.authorized !== true/);
  assert.match(js,/workspace\.hidden = true/);
  assert.match(html,/id="accessPending" hidden/);
  assert.match(html,/id="workspace" hidden/);
  assert.match(js,/access\.can_propose_internal !== true/);
  assert.match(js,/client\.rpc\('hermes_brain_submit_note'/);
  assert.doesNotMatch(html+js,/sb_secret_|service_role|SECURITY DEFINER|approve.memory|localStorage|sessionStorage|innerHTML/i);
});
test('CSP, pinned third-party script and text rendering are required', () => {
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/integrity="sha384-/);
  assert.match(js,/\.textContent =/);
  assert.match(js,/results\.replaceChildren\(\)/);
  assert.match(js,/Nenhuma memória aprovada encontrada/);
});

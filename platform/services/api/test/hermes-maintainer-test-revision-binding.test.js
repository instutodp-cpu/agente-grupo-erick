'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { bindHermesMaintainerTestRevision } = require('../src/core/hermes-maintainer-test-revision-binding');

const SHA = 'a'.repeat(40);
const valid = () => ({
  repository: 'instutodp-cpu/agente-grupo-erick',
  ref: 'hermes/e2e-test-branch',
  revision_sha: SHA,
  test_id: 'hermes_core_smoke',
  edit_receipt: {
    receipt_valid: true,
    repository: 'instutodp-cpu/agente-grupo-erick',
    branch: 'hermes/e2e-test-branch',
    commit_sha: SHA,
    production_used: false,
    write_performed: false
  }
});

test('binds test identity to the exact durable update-file revision without authorizing execution', () => {
  const result = bindHermesMaintainerTestRevision(valid());
  assert.equal(result.status, 'MAINTAINER_TEST_REVISION_BOUND');
  assert.equal(result.binding_valid, true);
  assert.equal(result.ref, 'hermes/e2e-test-branch');
  assert.equal(result.revision_sha, SHA);
  assert.equal(result.checkout_authorized, false);
  assert.equal(result.test_execution_authorized, false);
  assert.equal(result.production_allowed, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});

test('fails closed when receipt branch or commit does not match requested test revision', () => {
  const wrongBranch = valid();
  wrongBranch.edit_receipt.branch = 'hermes/other';
  const wrongSha = valid();
  wrongSha.edit_receipt.commit_sha = 'b'.repeat(40);
  assert.equal(bindHermesMaintainerTestRevision(wrongBranch).binding_valid, false);
  assert.equal(bindHermesMaintainerTestRevision(wrongSha).binding_valid, false);
});

test('rejects main, malformed revisions and widened finalization state', () => {
  const main = valid(); main.ref = 'main'; main.edit_receipt.branch = 'main';
  const malformed = valid(); malformed.revision_sha = 'abc'; malformed.edit_receipt.commit_sha = 'abc';
  const widened = valid(); widened.edit_receipt.write_performed = true;
  assert.equal(bindHermesMaintainerTestRevision(main).binding_valid, false);
  assert.equal(bindHermesMaintainerTestRevision(malformed).binding_valid, false);
  assert.equal(bindHermesMaintainerTestRevision(widened).binding_valid, false);
});

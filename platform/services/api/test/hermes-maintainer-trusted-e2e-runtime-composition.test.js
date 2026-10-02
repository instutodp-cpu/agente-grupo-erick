'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('trusted E2E composition wires only official runtime/finalizer chain and preserves human-only merge', () => {
  const original = Module._load;
  const calls = [];
  const stub = (name, value) => ({ [name]: value });
  Module._load = function(request, parent, isMain) {
    if (request.endsWith('hermes-maintainer-github-durable-write-runtime-composition')) return stub('createHermesMaintainerGithubDurableWriteRuntimeComposition', () => ({ composition_version:'hermes_maintainer_github_durable_write_runtime_composition_v1', execute(){} }));
    if (request.endsWith('hermes-maintainer-github-update-file-runtime-composition')) return stub('createHermesMaintainerGithubUpdateFileRuntimeComposition', () => ({ composition_version:'hermes_maintainer_github_update_file_runtime_composition_v1', execute(){} }));
    if (request.endsWith('hermes-maintainer-github-create-pull-request-runtime-composition')) return stub('createHermesMaintainerGithubCreatePullRequestRuntimeComposition', () => ({ composition_version:'hermes_maintainer_github_create_pull_request_runtime_composition_v1', execute(){} }));
    if (request.endsWith('hermes-maintainer-github-write-operational-finalization-composition')) return stub('createHermesMaintainerGithubWriteOperationalFinalizationComposition', () => ({ composition_version:'hermes_maintainer_github_write_operational_finalization_composition_v1', finalize(){} }));
    if (request.endsWith('hermes-maintainer-github-update-file-operational-finalization-composition')) return stub('createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition', () => ({ composition_version:'hermes_maintainer_github_update_file_operational_finalization_composition_v1', finalize(){} }));
    if (request.endsWith('hermes-maintainer-github-create-pull-request-operational-finalization-composition')) return stub('createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition', () => ({ composition_version:'hermes_maintainer_github_create_pull_request_operational_finalization_composition_v1', finalize(){} }));
    if (request.endsWith('hermes-maintainer-safe-workflow-execution-invocation')) return stub('createHermesMaintainerSafeWorkflowExecutionInvocation', ({runtimes}) => { calls.push(['runtimes',Object.keys(runtimes)]); return {execute(){}}; });
    if (request.endsWith('hermes-maintainer-safe-workflow-finalization-invocation')) return stub('createHermesMaintainerSafeWorkflowFinalizationInvocation', ({finalizers}) => { calls.push(['finalizers',Object.keys(finalizers)]); return {finalize(){}}; });
    if (request.endsWith('hermes-maintainer-safe-workflow-mutation-orchestration')) return stub('createHermesMaintainerSafeWorkflowMutationOrchestration', () => ({execute(){}}));
    if (request.endsWith('hermes-maintainer-safe-workflow-authorized-mutation-entry')) return stub('createHermesMaintainerSafeWorkflowAuthorizedMutationEntry', () => ({execute(){}}));
    if (request.endsWith('hermes-maintainer-safe-workflow-authorized-mutation-flow')) return stub('createHermesMaintainerSafeWorkflowAuthorizedMutationFlow', () => ({execute(){}}));
    if (request.endsWith('hermes-maintainer-github-e2e-read-composition')) return stub('runHermesMaintainerGithubE2eRead', async () => ({outcome:'SUCCEEDED'}));
    if (request.endsWith('hermes-maintainer-revision-bound-test-runtime-composition')) return stub('createHermesMaintainerRevisionBoundTestRuntimeComposition', () => ({execute(){}}));
    if (request.endsWith('hermes-maintainer-revision-bound-e2e-orchestrator')) return stub('createHermesMaintainerRevisionBoundE2eOrchestrator', deps => { calls.push(['orchestrator',deps]); return {execute: async input => ({input})}; });
    return original(request,parent,isMain);
  };
  try {
    const path = require.resolve('../src/runtime/hermes-maintainer-trusted-e2e-runtime-composition');
    delete require.cache[path];
    const { createHermesMaintainerTrustedE2eRuntimeComposition } = require(path);
    const composition = createHermesMaintainerTrustedE2eRuntimeComposition({
      environment: {}, fetchImpl: async()=>{}, createTimeoutSignal:()=>{}, pool:{}, resolveReadAuthorization:async()=>{}
    });
    assert.equal(composition.composition_version,'hermes_maintainer_trusted_e2e_runtime_composition_v1');
    assert.equal(composition.environment,'staging');
    assert.equal(composition.production_allowed,false);
    assert.equal(composition.merge_authority,false);
    assert.equal(composition.human_merge_required,true);
    assert.deepEqual(calls[0],['runtimes',['create_branch','update_file','create_pull_request']]);
    assert.deepEqual(calls[1],['finalizers',['create_branch','update_file','create_pull_request']]);
    assert.equal(calls[2][1].branchMutation,calls[2][1].editMutation);
    assert.equal(calls[2][1].editMutation,calls[2][1].pullRequestMutation);
  } finally {
    Module._load = original;
  }
});

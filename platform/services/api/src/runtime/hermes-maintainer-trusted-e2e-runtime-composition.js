'use strict';

const { createHermesMaintainerSafeWorkflowExecutionInvocation } = require('../core/hermes-maintainer-safe-workflow-execution-invocation');
const { createHermesMaintainerSafeWorkflowFinalizationInvocation } = require('../core/hermes-maintainer-safe-workflow-finalization-invocation');
const { createHermesMaintainerSafeWorkflowMutationOrchestration } = require('../core/hermes-maintainer-safe-workflow-mutation-orchestration');
const { createHermesMaintainerSafeWorkflowAuthorizedMutationEntry } = require('../core/hermes-maintainer-safe-workflow-authorized-mutation-entry');
const { createHermesMaintainerSafeWorkflowAuthorizedMutationFlow } = require('../core/hermes-maintainer-safe-workflow-authorized-mutation-flow');
const { createHermesMaintainerRevisionBoundE2eOrchestrator } = require('../core/hermes-maintainer-revision-bound-e2e-orchestrator');
const { createHermesMaintainerGithubDurableWriteRuntimeComposition } = require('./hermes-maintainer-github-durable-write-runtime-composition');
const { createHermesMaintainerGithubUpdateFileRuntimeComposition } = require('./hermes-maintainer-github-update-file-runtime-composition');
const { createHermesMaintainerGithubCreatePullRequestRuntimeComposition } = require('./hermes-maintainer-github-create-pull-request-runtime-composition');
const { createHermesMaintainerGithubWriteOperationalFinalizationComposition } = require('./hermes-maintainer-github-write-operational-finalization-composition');
const { createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition } = require('./hermes-maintainer-github-update-file-operational-finalization-composition');
const { createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition } = require('./hermes-maintainer-github-create-pull-request-operational-finalization-composition');
const { runHermesMaintainerGithubE2eRead } = require('./hermes-maintainer-github-e2e-read-composition');
const { createHermesMaintainerRevisionBoundTestRuntimeComposition } = require('./hermes-maintainer-revision-bound-test-runtime-composition');

const COMPOSITION_VERSION = 'hermes_maintainer_trusted_e2e_runtime_composition_v1';

function createHermesMaintainerTrustedE2eRuntimeComposition({
  environment, fetchImpl, createTimeoutSignal, timeoutMs, pool, resolveReadAuthorization,
  workspaceSpawnImpl, testSpawnImpl, workspaceTimeoutMs, testTimeoutMs
} = {}) {
  if (environment?.NODE_ENV !== 'staging') throw new TypeError('staging_environment_required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl_required');
  if (typeof createTimeoutSignal !== 'function') throw new TypeError('createTimeoutSignal_required');
  if (!pool) throw new TypeError('pool_required');
  if (typeof resolveReadAuthorization !== 'function') throw new TypeError('resolveReadAuthorization_required');

  const runtimes = Object.freeze({
    create_branch: createHermesMaintainerGithubDurableWriteRuntimeComposition({ environment, fetchImpl, createTimeoutSignal, timeoutMs }),
    update_file: createHermesMaintainerGithubUpdateFileRuntimeComposition({ environment, fetchImpl, createTimeoutSignal, timeoutMs }),
    create_pull_request: createHermesMaintainerGithubCreatePullRequestRuntimeComposition({ environment, fetchImpl, createTimeoutSignal, timeoutMs })
  });
  const finalizers = Object.freeze({
    create_branch: createHermesMaintainerGithubWriteOperationalFinalizationComposition({ pool }),
    update_file: createHermesMaintainerGithubUpdateFileOperationalFinalizationComposition({ pool }),
    create_pull_request: createHermesMaintainerGithubCreatePullRequestOperationalFinalizationComposition({ pool })
  });
  const executionInvocation = createHermesMaintainerSafeWorkflowExecutionInvocation({ runtimes });
  const finalizationInvocation = createHermesMaintainerSafeWorkflowFinalizationInvocation({ finalizers });
  const mutationOrchestration = createHermesMaintainerSafeWorkflowMutationOrchestration({ executionInvocation, finalizationInvocation });
  const authorizedMutationEntry = createHermesMaintainerSafeWorkflowAuthorizedMutationEntry({ mutationOrchestration });
  const mutationFlow = createHermesMaintainerSafeWorkflowAuthorizedMutationFlow({ authorizedMutationEntry });
  const repositoryRead = Object.freeze({
    execute: () => runHermesMaintainerGithubE2eRead({ fetchImpl, resolveAuthorization: resolveReadAuthorization })
  });
  const revisionTest = createHermesMaintainerRevisionBoundTestRuntimeComposition({
    workspaceSpawnImpl, testSpawnImpl, workspaceTimeoutMs, testTimeoutMs
  });
  const mutationAdapter = Object.freeze({
    execute: input => mutationFlow.execute(input?.controlled_execution, {
      ownership: input?.ownership,
      target: input?.target,
      authority_evidence: input?.authority_evidence,
      mutation_input: input?.mutation_input
    })
  });
  const orchestrator = createHermesMaintainerRevisionBoundE2eOrchestrator({
    repositoryRead,
    branchMutation: mutationAdapter,
    editMutation: mutationAdapter,
    revisionTest,
    pullRequestMutation: mutationAdapter
  });

  return Object.freeze({
    composition_version: COMPOSITION_VERSION,
    environment: 'staging',
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    execute: input => orchestrator.execute(input)
  });
}

module.exports = { COMPOSITION_VERSION, createHermesMaintainerTrustedE2eRuntimeComposition };

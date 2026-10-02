'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const RUNTIME_VERSION = 'hermes_maintainer_test_revision_workspace_runtime_v1';
const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const BINDING_VERSION = 'hermes_maintainer_test_revision_binding_v1';
const ROOT = '/tmp/hermes-maintainer-test-workspaces';

function blocked(reason) {
  return Object.freeze({
    runtime_version: RUNTIME_VERSION,
    status: 'MAINTAINER_TEST_REVISION_WORKSPACE_BLOCKED',
    workspace_ready: false,
    workspace_path: null,
    revision_sha: null,
    production_used: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([reason])
  });
}

function createHermesMaintainerTestRevisionWorkspaceRuntime({ spawnImpl = spawn, root = ROOT, timeoutMs = 120000 } = {}) {
  if (root !== ROOT) throw new TypeError('fixed_workspace_root_required');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('positive_timeout_required');

  return Object.freeze({
    runtime_version: RUNTIME_VERSION,
    async materialize(binding = {}) {
      if (binding.contract_version !== BINDING_VERSION || binding.status !== 'MAINTAINER_TEST_REVISION_BOUND' || binding.binding_valid !== true) return blocked('revision_binding_invalid');
      if (binding.repository !== REPOSITORY || binding.test_id !== 'hermes_core_smoke') return blocked('revision_binding_scope_invalid');
      if (typeof binding.ref !== 'string' || !/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(binding.ref) || binding.ref.includes('..')) return blocked('revision_ref_invalid');
      if (typeof binding.revision_sha !== 'string' || !/^[a-f0-9]{40}$/.test(binding.revision_sha)) return blocked('revision_sha_invalid');
      if (binding.checkout_authorized !== false || binding.test_execution_authorized !== false || binding.production_allowed !== false || binding.merge_authority !== false || binding.human_merge_required !== true) return blocked('revision_binding_authority_invalid');

      const workspacePath = path.join(ROOT, binding.revision_sha);
      const steps = [
        ['clone', '--no-checkout', '--filter=blob:none', 'https://github.com/instutodp-cpu/agente-grupo-erick.git', workspacePath],
        ['-C', workspacePath, 'checkout', '--detach', binding.revision_sha],
        ['-C', workspacePath, 'rev-parse', 'HEAD']
      ];
      for (const args of steps) {
        const result = await runGit(spawnImpl, args, timeoutMs);
        if (!result.ok) return blocked(result.reason);
        if (args[2] === 'rev-parse' && result.stdout.trim() !== binding.revision_sha) return blocked('workspace_revision_mismatch');
      }
      return Object.freeze({
        runtime_version: RUNTIME_VERSION,
        status: 'MAINTAINER_TEST_REVISION_WORKSPACE_READY',
        workspace_ready: true,
        workspace_path: workspacePath,
        revision_sha: binding.revision_sha,
        test_id: binding.test_id,
        network_used_for_checkout: true,
        write_used_for_workspace: true,
        test_execution_authorized: false,
        production_used: false,
        merge_authority: false,
        human_merge_required: true,
        blockers: Object.freeze([])
      });
    }
  });
}

function runGit(spawnImpl, args, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    let stdout = '';
    const finish = (ok, reason) => { if (settled) return; settled = true; resolve({ ok, reason, stdout }); };
    const child = spawnImpl('git', args, { shell: false, stdio: ['ignore', 'pipe', 'ignore'], env: Object.freeze({ GIT_TERMINAL_PROMPT: '0' }) });
    if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('data', chunk => { stdout += String(chunk); });
    const timer = setTimeout(() => { if (settled) return; if (typeof child.kill === 'function') child.kill('SIGTERM'); finish(false, 'workspace_git_timeout'); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); finish(false, 'workspace_git_error'); });
    child.once('exit', code => { clearTimeout(timer); finish(code === 0, code === 0 ? null : 'workspace_git_failed'); });
  });
}

module.exports = { RUNTIME_VERSION, ROOT, createHermesMaintainerTestRevisionWorkspaceRuntime };

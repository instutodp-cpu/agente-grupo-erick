'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PLATFORM_ROOT = path.join(__dirname, '../../../');
const RUNBOOK_PATH = path.join(PLATFORM_ROOT, 'docs/HERMES_STAGING_HTTPS_DEPLOYMENT_RUNBOOK.md');
const MANIFEST_PATH = path.join(PLATFORM_ROOT, 'docs/HERMES_STAGING_HTTPS_DEPLOYMENT_MANIFEST.yaml');
const CADDYFILE_PATH = path.join(PLATFORM_ROOT, 'infra/staging-observation/Caddyfile');
const APPROVED_REVISION = '4e9655d341e3a79865b8d5136ee69307433f6a14';
const APPROVED_CADDYFILE_SHA256 = '23d959be214bc1c3e283d0e9118e4b646589a1cd78bedf1914ec5711be2a881a';
const OBSOLETE_REVISION = '5f175fd4ca58a4634e3a6e9b5fb8a5eef719d581';

function readContract() {
  return {
    runbook: fs.readFileSync(RUNBOOK_PATH, 'utf8'),
    manifest: fs.readFileSync(MANIFEST_PATH, 'utf8'),
    caddy: fs.readFileSync(CADDYFILE_PATH, 'utf8')
  };
}

test('H04G contract binds deployment to the approved artifact revision and staging placeholder', () => {
  const { runbook, manifest, caddy } = readContract();

  assert.match(runbook, new RegExp(APPROVED_REVISION));
  assert.match(manifest, new RegExp(`approved_revision: ${APPROVED_REVISION}`));
  assert.match(manifest, new RegExp(`approved_caddyfile_sha256: sha256:${APPROVED_CADDYFILE_SHA256}`));
  assert.match(runbook, /git merge-base --is-ancestor "\$APPROVED_DEPLOYMENT_REVISION" HEAD/);
  assert.match(runbook, /git diff --exit-code[\s\S]*platform\/infra\/staging-observation\/Caddyfile[\s\S]*platform\/docker-compose\.observation\.yml[\s\S]*platform\/services\/api\/src/);
  assert.match(runbook, new RegExp(APPROVED_CADDYFILE_SHA256));
  assert.match(runbook, /<STAGING_OBSERVATION_HOST>/);
  assert.match(manifest, /hostname_placeholder: <STAGING_OBSERVATION_HOST>/);
  assert.match(caddy, /staging-observation\.example\.invalid/);
  assert.doesNotMatch(manifest, /https?:\/\/|\b(?:\d{1,3}\.){3}\d{1,3}\b/);
});

test('H04G contract rejects regression to the obsolete self-referential merge pin', () => {
  const { runbook, manifest } = readContract();
  const contract = `${runbook}\n${manifest}`;

  assert.doesNotMatch(contract, new RegExp(OBSOLETE_REVISION));
  assert.doesNotMatch(runbook, new RegExp(`git rev-parse HEAD.*${OBSOLETE_REVISION}`));
});

test('H04G runbook contains ordered Caddy, DNS, UFW, TLS, smoke, and rollback gates', () => {
  const { runbook } = readContract();
  const sections = [
    '### A. VPS preflight',
    '### B. Caddy installation and configuration validation',
    '### C. DNS',
    '### D. Firewall',
    '### E. TLS and Caddy activation',
    '### F. Smoke tests and redacted logs',
    '### G. Direct 8080 and final gates',
    '## 4. Rollback'
  ];
  let previous = -1;
  for (const section of sections) {
    const position = runbook.indexOf(section);
    assert.ok(position > previous, `${section} must remain in sequence`);
    previous = position;
  }
  assert.match(runbook, /sudo caddy validate --config \/etc\/caddy\/Caddyfile --adapter caddyfile/);
  assert.match(runbook, /dl\.cloudsmith\.io\/public\/caddy\/stable/);
  assert.match(runbook, /sudo ufw allow 80\/tcp/);
  assert.match(runbook, /sudo ufw allow 443\/tcp/);
  assert.match(runbook, /must be 404/);
  assert.match(runbook, /direct external 8080 succeeds/i);
  assert.match(runbook, /systemctl disable --now caddy/);
});

test('H04G preflight activates observation profile and derives health container from Compose', () => {
  const { runbook } = readContract();
  const preflight = runbook.slice(runbook.indexOf('### A. VPS preflight'), runbook.indexOf('### B. Caddy installation'));
  const composeCommands = preflight.match(/^.*docker compose.*$/gm) || [];

  assert.ok(composeCommands.length >= 3, 'preflight must inspect Compose with explicit commands');
  for (const command of composeCommands) {
    assert.match(command, /sudo docker compose -f docker-compose\.observation\.yml --profile observation/);
  }
  assert.match(preflight, /HERMES_API_CONTAINER_ID="\$\(\s*sudo docker compose -f docker-compose\.observation\.yml --profile observation ps -q api\s*\)"/);
  assert.match(preflight, /test -n "\$HERMES_API_CONTAINER_ID"/);
  assert.match(preflight, /sudo docker inspect --format '\{\{\.State\.Health\.Status\}\}' "\$HERMES_API_CONTAINER_ID"/);
  assert.doesNotMatch(preflight, /<HERMES_API_CONTAINER>/);
});

test('H04G Caddy query removal uses supported syntax and forbids strip_query regression', () => {
  const { caddy, runbook } = readContract();

  assert.doesNotMatch(caddy, /\buri\s+strip_query\b/);
  assert.match(caddy, /rewrite \* \{path\}/);
  assert.match(runbook, /caddy validate --config \/etc\/caddy\/Caddyfile --adapter\s+caddyfile/);
});

test('H04G manifest exposes every required audit field with safe defaults', () => {
  const { manifest } = readContract();
  for (const field of [
    'deployment_id', 'approved_revision', 'approved_caddyfile_sha256', 'caddy_config_hash',
    'target_environment', 'hostname_placeholder', 'operator', 'rollback_owner',
    'window_started_at', 'window_ended_at', 'preflight_pass', 'dns_pass',
    'ufw_pass', 'tls_pass', 'route_tests_pass',
    'direct_8080_external_blocked', 'execution_enabled', 'kill_switch',
    'production_accessed'
  ]) {
    assert.match(manifest, new RegExp(`^${field}:`, 'm'), `missing ${field}`);
  }
  assert.match(manifest, /^target_environment: staging$/m);
  assert.match(manifest, /^execution_enabled: false$/m);
  assert.match(manifest, /^kill_switch: true$/m);
  assert.match(manifest, /^production_accessed: false$/m);
});

test('H04G documentation does not authorize forbidden state changes or leak deployment data', () => {
  const { runbook, manifest, caddy } = readContract();
  const checked = `${runbook}\n${manifest}\n${caddy}`;

  assert.doesNotMatch(manifest, /HERMES_EXECUTION_ENABLED\s*[:=]\s*["']?true["']?/i);
  assert.doesNotMatch(manifest, /(?:TWILIO|ELEVENLABS|OPENAI|BASE44)_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/i);
  assert.doesNotMatch(manifest, /(?:postgres|redis|qdrant|production\.com|prod\.)/i);
  assert.match(runbook, /does not authorize[\s\S]{0,40}VPS access/i);
  assert.match(runbook, /Confirmation changes/i);
  assert.match(runbook, /database\/cache\/vector/i);
  assert.match(runbook, /required next action\s+is `STOP`/i);
});

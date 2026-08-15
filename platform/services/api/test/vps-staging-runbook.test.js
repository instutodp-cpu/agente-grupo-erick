'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PLATFORM_ROOT = path.join(__dirname, '../../../');
const RUNBOOK_PATH = path.join(PLATFORM_ROOT, 'docs/HERMES_VPS_STAGING_INSTALLATION_RUNBOOK.md');
const PROFILE_PATH = path.join(PLATFORM_ROOT, 'docker-compose.observation.yml');

test('VPS runbook exists and declares the observation safety boundary', () => {
  const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');

  assert.match(runbook, /staging-only/i);
  assert.match(runbook, /observability-only|observation-only/i);
  assert.match(runbook, /production-blocked/i);
  assert.match(runbook, /HERMES_EXECUTION_ENABLED=false/);
  assert.match(runbook, /HERMES_EXECUTION_KILL_SWITCH=true/);
  assert.match(runbook, /127\.0\.0\.1/);
  assert.match(runbook, /firewall/i);
  assert.match(runbook, /redact|redaction/i);
  assert.match(runbook, /rollback/i);
  assert.match(runbook, /Confirmation v3/);
  assert.match(runbook, /tenant inference/i);
  assert.match(runbook, /H02/);
});

test('runbook start commands select only the observation compose profile', () => {
  const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');
  const bashBlocks = [...runbook.matchAll(/```bash([\s\S]*?)```/g)].map((match) => match[1]);
  const startCommands = bashBlocks
    .flatMap((block) => block.split(/\n(?=docker compose)/))
    .filter((command) => command.includes('--profile observation'));

  assert.ok(startCommands.length >= 2, 'expected foreground and detached observation start commands');
  for (const command of startCommands) {
    assert.match(command, /docker-compose\.observation\.yml/);
    assert.doesNotMatch(command, /docker-compose\.yml(?!\.observation\.yml)/);
  }
  assert.doesNotMatch(runbook, /docker compose\s+-f\s+docker-compose\.yml\s+[^\n]*--profile\s+observation/i);
});

test('runbook and observation profile contain no enabled execution or secret configuration', () => {
  const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');
  const profile = fs.readFileSync(PROFILE_PATH, 'utf8');
  const checkedText = `${runbook}\n${profile}`;

  assert.doesNotMatch(checkedText, /HERMES_EXECUTION_ENABLED\s*[:=]\s*["']?true["']?/i);
  assert.doesNotMatch(profile, /^\s*(postgres|redis|qdrant):/im);
  assert.doesNotMatch(profile, /DATABASE_URL|POSTGRES|REDIS|QDRANT/i);
  assert.doesNotMatch(checkedText, /(?:PROVIDER|DATABASE|REDIS|QDRANT|POSTGRES)_[A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN|URL)\s*[:=]\s*(?!["']?<|["']?$)[^\s`]+/i);
  assert.doesNotMatch(checkedText, /(?:OPENAI|TWILIO|ELEVENLABS|BASE44)_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)\s*[:=]/i);
  assert.doesNotMatch(runbook, /https?:\/\/[^\s/]*(?:prod|production)[^\s/]*/i);
});

test('observation profile remains local and dependency-free', () => {
  const profile = fs.readFileSync(PROFILE_PATH, 'utf8');

  assert.match(profile, /profiles:\s*\["observation"\]/);
  assert.match(profile, /127\.0\.0\.1:\$\{OBSERVATION_API_PORT/);
  assert.match(profile, /HERMES_EXECUTION_ENABLED:\s*"false"/);
  assert.match(profile, /HERMES_EXECUTION_KILL_SWITCH:\s*"true"/);
  assert.doesNotMatch(profile, /(?:DATABASE_URL|REDIS_URL|QDRANT_URL|MCP_GATEWAY_URL)/i);
  assert.doesNotMatch(profile, /(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY)/i);
});

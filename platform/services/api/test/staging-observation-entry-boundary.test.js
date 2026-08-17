'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PLATFORM_ROOT = path.join(__dirname, '../../../');
const CADDYFILE_PATH = path.join(PLATFORM_ROOT, 'infra/staging-observation/Caddyfile');
const DOC_PATH = path.join(PLATFORM_ROOT, 'docs/HERMES_STAGING_OBSERVATION_ENTRY_BOUNDARY.md');

function readBoundaryFiles() {
  return {
    caddy: fs.readFileSync(CADDYFILE_PATH, 'utf8'),
    docs: fs.readFileSync(DOC_PATH, 'utf8')
  };
}

test('staging boundary has a fixed loopback upstream and no public API bind', () => {
  const { caddy } = readBoundaryFiles();

  assert.equal((caddy.match(/reverse_proxy 127\.0\.0\.1:8080/g) || []).length, 1);
  assert.doesNotMatch(caddy, /0\.0\.0\.0:8080|localhost:\s*8080|host\.docker\.internal/i);
  assert.doesNotMatch(caddy, /\b(?:10|172\.1[6-9]|172\.2\d|172\.3[0-1]|192\.168)\.\d+\.\d+\.\d+\b/);
  assert.match(caddy, /staging-observation\.example\.invalid/);
  assert.doesNotMatch(caddy, /https?:\/\/[^\s)]+/i);
});

test('only observation routes are proxied and everything else is a terminal 404', () => {
  const { caddy, docs } = readBoundaryFiles();

  assert.match(caddy, /method POST[\s\S]*path \/message \/confirm/);
  assert.match(caddy, /method GET[\s\S]*path_regexp confirmation_id \^\/confirm\/\[\^\/\]\+\$/);
  assert.match(caddy, /method GET[\s\S]*path \/health \/ready/);
  assert.match(caddy, /handle \{\s*respond "not found" 404\s*\}/);
  assert.match(docs, /Route allowlist/i);
  assert.match(docs, /unsupported method.*return `404`/i);
  assert.match(docs, /\/metrics.*\/admin.*provider webhooks/i);
});

test('boundary forwards only safe observation hints and redacts access logs', () => {
  const { caddy, docs } = readBoundaryFiles();

  for (const header of ['Authorization', 'Proxy-Authorization', 'Cookie', 'Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto']) {
    assert.match(caddy, new RegExp(`header_up -${header}`));
  }
  assert.match(caddy, /header_up Host \{http\.request\.host\}/);
  assert.match(caddy, /header_up X-Forwarded-For \{http\.request\.remote\.host\}/);
  assert.match(caddy, /header_up X-Forwarded-Proto https/);
  assert.match(caddy, /header_up User-Agent \{http\.request\.header\.User-Agent\}/);
  assert.match(caddy, /header_down -Set-Cookie/);
  assert.match(caddy, /format filter[\s\S]*request>uri delete[\s\S]*request>headers delete[\s\S]*request>body delete[\s\S]*response>headers delete/);
  assert.match(docs, /Forwarded headers are OBSERVATION INPUT ONLY and MUST NOT authorize\s+tenant\/auth decisions/i);
  for (const redactedField of ['Authorization', 'bearer tokens', 'cookies', 'raw headers', 'bodies']) {
    assert.match(docs, new RegExp(redactedField, 'i'));
  }
});

test('boundary removes the complete query with supported Caddy syntax', () => {
  const { caddy, docs } = readBoundaryFiles();

  assert.doesNotMatch(caddy, /\buri\s+strip_query\b/);
  assert.match(caddy, /route\s*\{[\s\S]*rewrite \* \{path\}[\s\S]*handle @write_routes/);
  assert.match(docs, /removes the complete query string with the supported Caddy\s+`rewrite \* \{path\}` operation/i);
});

test('staging resource bounds and production block are explicit', () => {
  const { caddy, docs } = readBoundaryFiles();

  assert.match(caddy, /max_size 1MB/);
  assert.match(caddy, /dial_timeout 5s/);
  assert.match(caddy, /response_header_timeout 30s/);
  assert.match(caddy, /max_conns_per_host 32/);
  assert.match(docs, /staging-only.*production-blocked/i);
  assert.match(docs, /rate-limit/i);
  assert.match(docs, /dedicated non-production staging subdomain/i);
});

test('boundary contains no deployment secrets, providers, execution enablement, or migrations', () => {
  const { caddy, docs } = readBoundaryFiles();
  const checked = `${caddy}\n${docs}`;

  assert.doesNotMatch(caddy, /secret|token|password|credential|private_key/i);
  assert.doesNotMatch(checked, /HERMES_EXECUTION_ENABLED\s*[:=]\s*["']?true["']?/i);
  assert.doesNotMatch(caddy, /(?:TWILIO|ELEVENLABS|BASE44|OPENAI)_[A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)/i);
  assert.doesNotMatch(caddy, /(?:postgres|redis|qdrant|migration|docker-compose\.yml)/i);
  assert.match(docs, /No VPS change, deploy, firewall change, DNS change, certificate creation/i);
  assert.match(docs, /solve H02 by itself/i);
  assert.match(docs, /authorize Confirmation v3/i);
});

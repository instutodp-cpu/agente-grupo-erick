'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const registryPath = path.resolve(__dirname, '../../../docs/SKILL_CANDIDATE_REGISTRY.md');
const fixturePath = path.resolve(__dirname, 'fixtures/hermes-skill-candidates.json');

const ALLOWED_DOMAINS = new Set([
  'compras',
  'financeiro',
  'treinamento',
  'marketing',
  'desenvolvimento'
]);

const REQUIRED_FORBIDDEN_FIELDS = [
  'token',
  'secret',
  'env',
  'headers',
  'cookies',
  'credentials',
  'payload',
  'rawMessage',
  'userMessage'
];

const PROHIBITED_STATUSES = new Set([
  'active_real',
  'execute_real',
  'production_autonomous'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

test('skill candidate registry document exists and documents the safety contract', () => {
  const registry = readText(registryPath);

  assert.match(registry, /skill candidate/i);
  assert.match(registry, /draft/i);
  assert.match(registry, /mock/i);
  assert.match(registry, /executed:false/i);
  assert.match(registry, /human review/i);
  assert.match(registry, /Permission Matrix/i);
  assert.match(registry, /Golden Scenarios/i);
  assert.match(registry, /forbidden fields/i);
  assert.match(registry, /active_real/i);
  assert.match(registry, /execute_real/i);
  assert.match(registry, /production_autonomous/i);
});

test('skill candidate fixture is mock-first and domain-safe', () => {
  const skills = readJson(fixturePath);
  const ids = new Set();

  for (const skill of skills) {
    ids.add(skill.skill_id);

    assert.ok(skill.skill_id);
    assert.ok(skill.domain);
    assert.equal(ALLOWED_DOMAINS.has(skill.domain), true);
    assert.match(skill.adapter_id, /^mock-/);
    assert.equal(skill.adapter_mode, 'mock');
    assert.equal(skill.executed, false);
    assert.equal(skill.human_review_required, true);
    assert.ok(skill.forbidden_fields);
    assert.ok(Array.isArray(skill.forbidden_fields));
    assert.equal(skill.forbidden_fields.length >= REQUIRED_FORBIDDEN_FIELDS.length, true);

    for (const field of REQUIRED_FORBIDDEN_FIELDS) {
      assert.equal(skill.forbidden_fields.includes(field), true);
    }

    assert.equal(PROHIBITED_STATUSES.has(skill.status), false);
  }

  assert.equal(ids.size, skills.length);
});


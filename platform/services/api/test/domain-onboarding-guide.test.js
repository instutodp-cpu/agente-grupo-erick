'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guidePath = path.resolve(__dirname, '../../../docs/DOMAIN_ONBOARDING.md');

test('domain onboarding guide documents the required safety contract', () => {
  const guide = fs.readFileSync(guidePath, 'utf8');

  assert.match(guide, /executed:false/);
  assert.match(guide, /mock-first/i);
  assert.match(guide, /Permission Matrix/i);
  assert.match(guide, /Golden Scenarios/i);
  assert.match(guide, /execu[cç][aã]o real/i);
  assert.match(guide, /forbidden fields/i);
  assert.match(guide, /(segredos?|secrets?)/i);
  assert.match(guide, /(tokens?|token)/i);
  assert.match(guide, /env/i);
  assert.match(guide, /headers/i);
  assert.match(guide, /cookies/i);
  assert.match(guide, /credentials/i);
});

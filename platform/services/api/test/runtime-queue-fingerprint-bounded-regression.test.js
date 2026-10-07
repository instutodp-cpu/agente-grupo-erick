'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const CONTRACT_FILES = [
  'runtime-queue-admission-entry-reference.js',
  'runtime-queue-admission-order-reference.js',
  'runtime-queue-admission-package.js',
  'runtime-queue-materialization-entry-reference.js',
  'runtime-queue-materialization-order-reference.js',
  'runtime-queue-materialization-package.js',
  'runtime-queue-placement-entry-reference.js',
  'runtime-queue-placement-group-reference.js',
  'runtime-queue-placement-order-reference.js',
  'runtime-queue-placement-package.js'
];

test('queue fingerprints remain bounded canonical digests instead of embedded canonical payloads', () => {
  for (const file of CONTRACT_FILES) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', file), 'utf8');
    assert.match(source, /return computeCanonicalContentDigest\(rest\);/, `${file} must fingerprint with canonical digest`);
    assert.doesNotMatch(source, /return stablePayload\(rest\);/, `${file} must not embed canonical payload as fingerprint`);
  }
});

'use strict';

const { createHash } = require('node:crypto');

const DIGEST_ALGORITHM = 'sha256';
const DIGEST_PREFIX = `${DIGEST_ALGORITHM}:`;
const DIGEST_INVALID_PREFIX = 'digest_invalid';

function updateCanonicalHash(hash, value, seen = new WeakSet()) {
  if (value === null) { hash.update('null'); return; }
  const type = typeof value;
  if (type === 'string' || type === 'boolean') { hash.update(JSON.stringify(value)); return; }
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number_not_serializable');
    hash.update(JSON.stringify(value)); return;
  }
  if (type === 'undefined') throw new TypeError('undefined_not_serializable');
  if (type === 'function') throw new TypeError('function_not_serializable');
  if (type === 'symbol') throw new TypeError('symbol_not_serializable');
  if (type === 'bigint') throw new TypeError('bigint_not_serializable');
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) throw new TypeError('binary_not_serializable');
  if (value instanceof Date) throw new TypeError('date_not_serializable');
  if (!Array.isArray(value) && (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)) throw new TypeError('non_plain_object_not_serializable');
  if (seen.has(value)) throw new TypeError('cyclic_reference_not_serializable');
  seen.add(value);
  if (Array.isArray(value)) {
    hash.update('[');
    value.forEach((item, index) => {
      if (index) hash.update(',');
      updateCanonicalHash(hash, item, seen);
    });
    hash.update(']');
  } else {
    hash.update('{');
    Object.keys(value).sort().forEach((key, index) => {
      if (index) hash.update(',');
      hash.update(JSON.stringify(key));
      hash.update(':');
      updateCanonicalHash(hash, value[key], seen);
    });
    hash.update('}');
  }
  seen.delete(value);
}

function computeCanonicalContentDigest(value) {
  try {
    const hash = createHash(DIGEST_ALGORITHM);
    updateCanonicalHash(hash, value === undefined ? null : value);
    return `${DIGEST_PREFIX}${hash.digest('hex')}`;
  } catch (error) {
    return `${DIGEST_INVALID_PREFIX}::${error.message}`;
  }
}

function isCanonicalContentDigest(value) {
  return typeof value === 'string' && new RegExp(`^${DIGEST_PREFIX}[0-9a-f]{64}$`).test(value);
}

module.exports = {
  DIGEST_ALGORITHM,
  DIGEST_INVALID_PREFIX,
  DIGEST_PREFIX,
  computeCanonicalContentDigest,
  isCanonicalContentDigest
};

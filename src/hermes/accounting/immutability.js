'use strict';

function cloneAndFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map(cloneAndFreeze));

  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    clone[key] = cloneAndFreeze(child);
  }
  return Object.freeze(clone);
}

module.exports = { cloneAndFreeze };

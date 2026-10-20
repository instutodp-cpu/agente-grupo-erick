'use strict';

function required(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
}

function createRuleVersion(input = {}) {
  for (const field of ['ruleId','authority','obligation','version','effectiveFrom','officialSource','schemaHash','validatedAt']) {
    required(input[field], field);
  }
  if (input.effectiveUntil && Date.parse(input.effectiveUntil) < Date.parse(input.effectiveFrom)) {
    throw new Error('effectiveUntil cannot precede effectiveFrom');
  }
  return Object.freeze({
    ruleId: input.ruleId,
    authority: input.authority,
    obligation: input.obligation,
    documentType: input.documentType ?? null,
    version: input.version,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil ?? null,
    officialSource: input.officialSource,
    schemaHash: input.schemaHash,
    downloadedAt: input.downloadedAt ?? null,
    validatedAt: input.validatedAt,
    supersedes: input.supersedes ?? null
  });
}

function isRuleEffective(rule, instant) {
  const t = Date.parse(instant);
  if (Number.isNaN(t)) throw new Error('instant must be a valid date');
  const from = Date.parse(rule.effectiveFrom);
  const until = rule.effectiveUntil ? Date.parse(rule.effectiveUntil) : Infinity;
  return t >= from && t <= until;
}

function selectEffectiveRule(rules, { authority, obligation, instant }) {
  const matches = rules.filter(r =>
    r.authority === authority &&
    r.obligation === obligation &&
    isRuleEffective(r, instant)
  );
  if (matches.length !== 1) {
    throw new Error(matches.length === 0 ? 'no effective rule found' : 'ambiguous effective rule');
  }
  return matches[0];
}

module.exports = { createRuleVersion, isRuleEffective, selectEffectiveRule };

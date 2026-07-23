'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const AGENT_CORE_FORBIDDEN_KEY_TOKENS = Object.freeze([
  'api', 'apikey', 'key', 'secret', 'token', 'password', 'authorization', 'bearer',
  'jwt', 'oauth', 'cookie', 'filesystem',
  'endpoint', 'url', 'uri', 'hostname', 'host', 'ip', 'port', 'env',
  'function', 'callback', 'handler', 'execute', 'invoke',
  'runtime', 'bootstrap', 'startup', 'plugin', 'prompt', 'sdk',
  'eval', 'vm', 'childprocess', 'workerthreads'
]);
// Longer, distinctive tokens are also matched as substrings inside a single unseparated
// segment (e.g. "myapikey", "apikey12345") since word-boundary/segment splitting alone
// cannot detect a forbidden term glued to other characters with no case or separator
// signal. Short/common tokens (api, key, ip, env, url, uri, vm, jwt, host, port, ...) are
// deliberately excluded here: matching them as bare substrings would reintroduce the exact
// false-positive class already fixed once (e.g. "port" inside "transport"). "execute" and
// "invoke" are also excluded: their past-tense/gerund forms ("executed", "invoked",
// "invoking") are legitimate, extremely common safe-flag field names throughout this
// codebase (e.g. executed, fallback_executed, escalation_executed, selection_executed) and
// would collide as substrings.
const AGENT_CORE_SUBSTRING_KEY_TOKENS = Object.freeze([
  'apikey', 'secret', 'password', 'authorization', 'bearer', 'oauth', 'filesystem',
  'endpoint', 'hostname', 'callback', 'runtime', 'bootstrap',
  'startup', 'childprocess', 'workerthreads'
]);
const AGENT_CORE_ALLOWLISTED_KEY_NAMES = Object.freeze(new Set([
  'authorization_state',
  'runtime_enabled',
  'runtime_mutated',
  'secret_material_present',
  'maximum_model_calls',
  'requested_model_calls',
  'model_calls_within_limit',
  'runtime_connected',
  'prompt_generated',
  'requires_secret',
  'requires_filesystem',
  'requires_runtime',
  // Execution Authorization Boundary (PR #97) field names: "authorization" here always means
  // the declarative decision boundary this PR defines, never a credential or auth header.
  'authorization_request_id',
  'authorization_request_version',
  'authorization_policy',
  'authorization_policy_id',
  'authorization_policy_version',
  'authorization_scope',
  'authorization_scope_id',
  'budget_authorization_reference',
  'budget_authorization_id',
  'budget_authorization_version',
  'budget_authorization_validated',
  'authorization_created_sequence',
  'authorization_mutated',
  'authorization_evaluated',
  'authorization_decision_id',
  // Spec-mandated PR #97 fixture scenario names (used only as object keys in the fixture file).
  'expired-authorization',
  'replay-authorization',
  'require_unexpired_authorization'
]));
const AGENT_CORE_FORBIDDEN_VALUE_PATTERN = /\b(api[_-]?key|private[_-]?key|access[_-]?key|secret|token|password|authorization|bearer|jwt|oauth|cookie|filesystem|endpoint|hostname|callback|handler|execute|invoke|runtime|bootstrap|startup|plugin|tool_call|system_prompt|prompt|model|provider|sdk|eval)\b/i;
const AGENT_CORE_FORBIDDEN_VALUE_SHAPES = Object.freeze([
  [/^(https?|wss?|grpc):\/\//i, 'operational_url_value'],
  [/process\.env/i, 'process_env_value'],
  [/\bimport\s*\(/i, 'dynamic_import_value'],
  [/\brequire\s*\(/i, 'require_call_value'],
  [/=>/, 'arrow_function_value'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, 'ipv4_value'],
  [/(?:^|:)(?:[a-f0-9]{0,4}:){2,}[a-f0-9]{0,4}(?:$|:)/i, 'ipv6_value'],
  [/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0|::1)\b/i, 'local_address_value'],
  [/^[a-z0-9.-]+:\d{2,5}$/i, 'host_port_value'],
  [/(mongodb|postgres|mysql|redis):\/\//i, 'connection_string_value'],
  [/\.(js|ts|mjs|cjs|py|sh|exe|dll|so|bat|cmd|ps1)(\?|$)/i, 'executable_path_value'],
  [/^\.{0,2}[\\/]/, 'filesystem_path_value']
]);
// Best-effort Unicode hardening: strip zero-width characters and fold the small set of
// Cyrillic/Greek letters that are visually indistinguishable from Latin letters (the
// exact classes used in real-world homoglyph obfuscation) back to their Latin lookalike
// before matching. This is not a full Unicode confusables table (that is a much larger,
// separately-maintained dataset) — it covers the common single-letter substitutions.
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF\u2060]/g;
// Cyrillic/Greek letters that are visually indistinguishable from Latin letters, mapped to
// their Latin lookalike. Written as explicit \u escapes (rather than raw characters) so the
// mapping stays reviewable and immune to editor/encoding mangling.
const CONFUSABLE_CHAR_MAP = Object.freeze({
  '\u0430': 'a', // CYRILLIC SMALL LETTER A (U+0430)
  '\u0410': 'A', // CYRILLIC CAPITAL LETTER A (U+0410)
  '\u0435': 'e', // CYRILLIC SMALL LETTER IE (U+0435)
  '\u0415': 'E', // CYRILLIC CAPITAL LETTER IE (U+0415)
  '\u043e': 'o', // CYRILLIC SMALL LETTER O (U+043E)
  '\u041e': 'O', // CYRILLIC CAPITAL LETTER O (U+041E)
  '\u0440': 'p', // CYRILLIC SMALL LETTER ER (U+0440)
  '\u0420': 'P', // CYRILLIC CAPITAL LETTER ER (U+0420)
  '\u0441': 'c', // CYRILLIC SMALL LETTER ES (U+0441)
  '\u0421': 'C', // CYRILLIC CAPITAL LETTER ES (U+0421)
  '\u0445': 'x', // CYRILLIC SMALL LETTER HA (U+0445)
  '\u0425': 'X', // CYRILLIC CAPITAL LETTER HA (U+0425)
  '\u0443': 'y', // CYRILLIC SMALL LETTER U (U+0443)
  '\u0423': 'Y', // CYRILLIC CAPITAL LETTER U (U+0423)
  '\u0456': 'i', // CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I (U+0456)
  '\u0406': 'I', // CYRILLIC CAPITAL LETTER BYELORUSSIAN-UKRAINIAN I (U+0406)
  '\u0455': 's', // CYRILLIC SMALL LETTER DZE (U+0455)
  '\u0405': 'S', // CYRILLIC CAPITAL LETTER DZE (U+0405)
  '\u0458': 'j', // CYRILLIC SMALL LETTER JE (U+0458)
  '\u0408': 'J', // CYRILLIC CAPITAL LETTER JE (U+0408)
  '\u03b1': 'a', // GREEK SMALL LETTER ALPHA (U+03B1)
  '\u0391': 'A', // GREEK CAPITAL LETTER ALPHA (U+0391)
  '\u03bf': 'o', // GREEK SMALL LETTER OMICRON (U+03BF)
  '\u039f': 'O', // GREEK CAPITAL LETTER OMICRON (U+039F)
  '\u03c1': 'p', // GREEK SMALL LETTER RHO (U+03C1)
  '\u03a1': 'P', // GREEK CAPITAL LETTER RHO (U+03A1)
  '\u03c5': 'y', // GREEK SMALL LETTER UPSILON (U+03C5)
  '\u03a5': 'Y', // GREEK CAPITAL LETTER UPSILON (U+03A5)
});

function normalizeForDetection(text) {
  const withoutZeroWidth = String(text).normalize('NFKC').replace(ZERO_WIDTH_PATTERN, '');
  let result = '';
  for (const char of withoutZeroWidth) {
    result += CONFUSABLE_CHAR_MAP[char] || char;
  }
  return result;
}

function splitCamelCaseBoundaries(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');
}

function keySegments(key) {
  const normalized = normalizeForDetection(key);
  const camelSplit = splitCamelCaseBoundaries(normalized);
  return camelSplit.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function isForbiddenAgentCoreKey(key) {
  if (AGENT_CORE_ALLOWLISTED_KEY_NAMES.has(key)) return false;
  const segments = keySegments(key);
  if (segments.some((segment) => AGENT_CORE_FORBIDDEN_KEY_TOKENS.includes(segment))) return true;
  return segments.some((segment) => AGENT_CORE_SUBSTRING_KEY_TOKENS.some((token) => segment.includes(token)));
}

function looksLikeOperationalValue(rawValue) {
  const value = normalizeForDetection(rawValue);
  if (AGENT_CORE_FORBIDDEN_VALUE_PATTERN.test(value)) return 'forbidden_word_value';
  for (const [pattern, reason] of AGENT_CORE_FORBIDDEN_VALUE_SHAPES) {
    if (pattern.test(value)) return reason;
  }
  return null;
}

function findAgentCoreOperationalMaterial(value) {
  const found = [];
  const seen = new WeakSet();
  function visit(entry, path) {
    if (entry === null) return;
    const type = typeof entry;
    if (type === 'string') {
      const reason = looksLikeOperationalValue(entry);
      if (reason) found.push(`${reason}::${path || 'value'}`);
      return;
    }
    if (type === 'number') {
      if (!Number.isFinite(entry)) found.push(`non_finite_number::${path || 'value'}`);
      return;
    }
    if (type === 'boolean') return;
    if (type === 'bigint') return found.push(`forbidden_bigint::${path || 'value'}`);
    if (type === 'symbol') return found.push(`forbidden_symbol::${path || 'value'}`);
    if (type === 'function') return found.push(`forbidden_function::${path || 'value'}`);
    if (entry === undefined) return found.push(`forbidden_undefined::${path || 'value'}`);
    if (Buffer.isBuffer(entry) || entry instanceof ArrayBuffer || ArrayBuffer.isView(entry)) {
      return found.push(`forbidden_binary::${path || 'value'}`);
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) return found.push('forbidden_cycle::array');
      seen.add(entry);
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      seen.delete(entry);
      return;
    }
    if (!isPlainObject(entry)) return found.push(`forbidden_non_plain_object::${path || 'value'}`);
    if (seen.has(entry)) return found.push('forbidden_cycle::object');
    seen.add(entry);
    for (const [key, nested] of Object.entries(entry)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (isForbiddenAgentCoreKey(key)) {
        found.push(`forbidden_key::${nestedPath}`);
        continue;
      }
      visit(nested, nestedPath);
    }
    seen.delete(entry);
  }
  visit(value, '');
  return uniqueSorted(found);
}

function stableCanonicalize(value, seen = new WeakSet()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number_not_serializable');
    return value;
  }
  if (type === 'undefined') throw new TypeError('undefined_not_serializable');
  if (type === 'function') throw new TypeError('function_not_serializable');
  if (type === 'symbol') throw new TypeError('symbol_not_serializable');
  if (type === 'bigint') throw new TypeError('bigint_not_serializable');
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new TypeError('binary_not_serializable');
  }
  if (value instanceof Date) throw new TypeError('date_not_serializable');
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('cyclic_reference_not_serializable');
    seen.add(value);
    const canonical = value.map((item) => stableCanonicalize(item, seen));
    seen.delete(value);
    return canonical;
  }
  if (!isPlainObject(value)) throw new TypeError('non_plain_object_not_serializable');
  if (seen.has(value)) throw new TypeError('cyclic_reference_not_serializable');
  seen.add(value);
  const canonical = {};
  for (const key of Object.keys(value).sort()) {
    canonical[key] = stableCanonicalize(value[key], seen);
  }
  seen.delete(value);
  return canonical;
}

function stablePayload(value) {
  return JSON.stringify(stableCanonicalize(value));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function cloneFrozen(value) {
  return deepFreeze(JSON.parse(JSON.stringify(stableCanonicalize(value))));
}

function exactFields(value, fields, prefix, errors) {
  const allowed = new Set(fields);
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

const AGENT_IDENTITY_CONTRACT_VALIDATOR_VERSION = 'agent_identity_contract_validator_v1';
const AGENT_SYSTEM_TENANT_ID = 'SYSTEM';
const AGENT_IDENTITY_FIELDS = Object.freeze([
  'agent_id',
  'agent_slug',
  'agent_version',
  'tenant_id',
  'organization_id',
  'agent_type',
  'display_name',
  'description',
  'owner_type',
  'owner_id',
  'visibility',
  'status',
  'created_at_logical',
  'identity_version',
  'validator_version'
]);
const AGENT_TYPES = Object.freeze([
  'GENERAL_ASSISTANT',
  'DOMAIN_ASSISTANT',
  'OPERATIONS_AGENT',
  'ANALYTICS_AGENT',
  'AUDIT_AGENT',
  'TRAINING_AGENT',
  'ROUTING_AGENT',
  'SUPERVISOR_AGENT',
  'SPECIALIST_AGENT',
  'SYSTEM_AGENT'
]);
const AGENT_OWNER_TYPES = Object.freeze(['TENANT', 'ORGANIZATION', 'SYSTEM']);
const AGENT_VISIBILITIES = Object.freeze(['PRIVATE', 'TENANT', 'ORGANIZATION', 'SYSTEM_INTERNAL']);
const FORBIDDEN_AGENT_VISIBILITIES = Object.freeze(['PUBLIC']);
const AGENT_STATUSES = Object.freeze(['DRAFT', 'REGISTERED_SIMULATION', 'SUSPENDED', 'ARCHIVED']);
const FORBIDDEN_AGENT_STATUSES = Object.freeze(['ACTIVE', 'RUNNING', 'EXECUTING', 'PRODUCTION', 'ENABLED', 'LIVE']);
const AGENT_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DISPLAY_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

function isSystemIdentity(identity) {
  return identity.agent_type === 'SYSTEM_AGENT' && identity.owner_type === 'SYSTEM';
}

function validateAgentIdentity(identity) {
  const errors = [];
  if (!isPlainObject(identity)) return { valid: false, errors: ['agent_identity_must_be_object'] };
  exactFields(identity, AGENT_IDENTITY_FIELDS, 'agent_identity', errors);
  for (const field of ['agent_id', 'agent_slug', 'tenant_id', 'organization_id', 'display_name', 'description', 'owner_id', 'validator_version']) {
    if (!isNonEmptyString(identity[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(identity.agent_version) || identity.agent_version < 1) errors.push('agent_version_invalid');
  if (!Number.isInteger(identity.identity_version) || identity.identity_version < 1) errors.push('identity_version_invalid');
  if (isNonEmptyString(identity.agent_slug) && !AGENT_SLUG_PATTERN.test(identity.agent_slug)) errors.push('agent_slug_not_normalized');
  if (!AGENT_TYPES.includes(identity.agent_type)) errors.push(`agent_type_not_allowed::${identity.agent_type}`);
  if (!AGENT_OWNER_TYPES.includes(identity.owner_type)) errors.push(`owner_type_not_allowed::${identity.owner_type}`);
  if (!AGENT_VISIBILITIES.includes(identity.visibility)) errors.push(`visibility_not_allowed::${identity.visibility}`);
  if (FORBIDDEN_AGENT_VISIBILITIES.includes(identity.visibility)) errors.push(`visibility_forbidden::${identity.visibility}`);
  if (!AGENT_STATUSES.includes(identity.status)) errors.push(`status_not_allowed::${identity.status}`);
  if (FORBIDDEN_AGENT_STATUSES.includes(identity.status)) errors.push(`status_forbidden::${identity.status}`);
  if (isNonEmptyString(identity.display_name) && identity.display_name.length > MAX_DISPLAY_NAME_LENGTH) errors.push('display_name_too_long');
  if (isNonEmptyString(identity.description) && identity.description.length > MAX_DESCRIPTION_LENGTH) errors.push('description_too_long');
  if (!(isNonEmptyString(identity.created_at_logical) || (Number.isInteger(identity.created_at_logical) && identity.created_at_logical >= 0))) {
    errors.push('created_at_logical_invalid');
  }
  if (identity.validator_version !== AGENT_IDENTITY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  if (isPlainObject(identity) && !isSystemIdentity(identity) && isNonEmptyString(identity.tenant_id) && isNonEmptyString(identity.organization_id)) {
    if (!identity.organization_id.startsWith(`${identity.tenant_id}:`)) errors.push('organization_id_not_compatible_with_tenant');
  }
  if (isSystemIdentity(identity) && identity.tenant_id !== AGENT_SYSTEM_TENANT_ID && isNonEmptyString(identity.tenant_id)) {
    if (isNonEmptyString(identity.organization_id) && !identity.organization_id.startsWith(`${identity.tenant_id}:`)) {
      errors.push('organization_id_not_compatible_with_tenant');
    }
  }
  try {
    stablePayload(identity);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(identity));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_CORE_ALLOWLISTED_KEY_NAMES,
  AGENT_CORE_FORBIDDEN_KEY_TOKENS,
  AGENT_IDENTITY_CONTRACT_VALIDATOR_VERSION,
  AGENT_IDENTITY_FIELDS,
  AGENT_OWNER_TYPES,
  AGENT_SLUG_PATTERN,
  AGENT_STATUSES,
  AGENT_SYSTEM_TENANT_ID,
  AGENT_TYPES,
  AGENT_VISIBILITIES,
  FORBIDDEN_AGENT_STATUSES,
  FORBIDDEN_AGENT_VISIBILITIES,
  cloneFrozen,
  deepFreeze,
  exactFields,
  findAgentCoreOperationalMaterial,
  isForbiddenAgentCoreKey,
  isSystemIdentity,
  stableCanonicalize,
  stablePayload,
  validateAgentIdentity
};

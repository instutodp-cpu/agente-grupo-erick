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
  'require_unexpired_authorization',
  // Execution Plan Contracts (PR #98) field names -- same rationale as PR #97's own entries
  // above: "authorization" here always refers to this declarative decision boundary.
  'authorization_decision_reference',
  'authorization_decision_fingerprint',
  'authorization_fingerprint',
  'authorization_validated',
  // idempotency_key_reference is a synthetic, normalized identifier, never a real secret or
  // API key -- see execution-plan-idempotency.js's own IDEMPOTENCY_KEY_PATTERN and its
  // "não armazenar chave operacional ou segredo" rule.
  'idempotency_key_reference',
  // Spec-mandated PR #98 fixture scenario name (used only as an object key in the fixture file).
  'authorization-blocked-plan',
  // Execution Reference Binding and Authorization Provenance (PR #100) field names -- same
  // rationale as PR #97/#98's own entries above: "authorization" here always refers to this
  // declarative decision/provenance/scope boundary, never a real credential.
  'authorization_provenance_reference_id',
  'authorization_provenance_reference_version',
  'authorization_provenance_fingerprint',
  'authorization_provenance_validated',
  'authorization_scope_reference_id',
  'authorization_scope_reference_version',
  'authorization_scope_fingerprint',
  'authorization_scope_validated',
  'authorization_request_fingerprint',
  'authorization_policy_fingerprint',
  'budget_authorization_fingerprint',
  'authorization_provenance_reference',
  'authorization_scope_reference',
  // Execution Gateway Boundary Simulation (PR #102) field names -- same rationale as PR #97/#98/
  // #100's own entries above: "authorization" here always refers to this declarative decision/
  // provenance/scope boundary the Gateway cross-checks, never a real credential.
  'require_authorization_provenance',
  'require_authorization_scope',
  'authorization_expired_logically',
  // Runtime Execution Simulation Contracts (PR #103) field names -- "runtime" here always refers
  // to this PR's own declarative Runtime Execution Simulation package/decision/registry, never a
  // real interpreter, VM, or execution runtime. Every field below is a compound name this PR's
  // exact-fields lists mandate; none of them enable, start, or reference a real runtime.
  'allow_runtime_package_preparation_simulation', 'expected_runtime_registry_version',
  'from_runtime_stage_id', 'to_runtime_stage_id', 'ordered_runtime_stage_ids',
  'runtime_admitted_in_simulation', 'runtime_artifact_plan_reference', 'runtime_artifact_plan_reference_id',
  'runtime_artifact_plan_reference_version', 'runtime_artifact_plan_fingerprint', 'runtime_budget_fingerprint',
  'runtime_budget_reference', 'runtime_budget_reference_id', 'runtime_budget_reference_version',
  'runtime_compensation_fingerprints', 'runtime_compensation_reference_id', 'runtime_compensation_reference_version',
  'runtime_compensation_references', 'runtime_compensation_reference_ids', 'runtime_decision_id',
  'runtime_decision_fingerprint', 'runtime_dependency_count', 'runtime_dependency_ids',
  'runtime_dependency_manifest_fingerprint', 'runtime_dependency_manifest_id', 'runtime_dependency_manifest_reference',
  'runtime_dependency_manifest_version', 'runtime_dependency_reference_id', 'runtime_dependency_reference_ids',
  'runtime_dependency_references', 'runtime_dependency_reference_version', 'runtime_event_plan_fingerprint',
  'runtime_event_plan_reference', 'runtime_event_plan_reference_id', 'runtime_event_plan_reference_version',
  'runtime_evaluated', 'runtime_execution_package_id', 'runtime_execution_package_version', 'runtime_package_digest',
  'runtime_package_fingerprint', 'runtime_package_prepared_in_simulation', 'runtime_policy', 'runtime_policy_id',
  'runtime_policy_version', 'runtime_request_fingerprint', 'runtime_request_id', 'runtime_request_version',
  'runtime_result_id', 'runtime_stage_count', 'runtime_stage_manifest_fingerprint', 'runtime_stage_manifest_id',
  'runtime_stage_manifest_reference', 'runtime_stage_manifest_version', 'runtime_stage_reference_id',
  'runtime_stage_reference_ids', 'runtime_stage_references', 'runtime_stage_reference_version', 'runtime_status',
  'runtime_stop_count', 'runtime_stop_fingerprints', 'runtime_stop_reference_id', 'runtime_stop_reference_ids',
  'runtime_stop_references', 'runtime_stop_reference_version', 'runtime_stop_count', 'runtime_compensation_count',
  // 'execute' (exact segment) is forbidden even though 'executed' is not (see the substring-token
  // comment above) -- stage_would_execute is a forced-false declarative flag, never a real
  // execution trigger; documented explicitly in runtime-stage-simulation-reference.js.
  'stage_would_execute',
  // Runtime Readiness and Admission Boundary (PR #104) field names -- "runtime"/"authorization"
  // here always refer to this PR's own declarative Readiness/Admission policy, request, decision,
  // capacity/concurrency/freshness/replay reference, and audit contracts, exactly the same
  // "declarative reference, never a real interpreter/credential" rationale as every PR #97-#103
  // entry above. Every field below is a compound name this PR's exact-fields lists mandate; none
  // of them enable, start, or reference a real runtime or credential.
  'runtime_readiness_policy_id', 'runtime_readiness_policy_version', 'require_runtime_package_prepared',
  'require_authorization_valid', 'require_authorization_scope_valid',
  'runtime_admission_policy_id', 'runtime_admission_policy_version', 'allow_runtime_admission_simulation',
  'require_runtime_ready_simulation',
  'runtime_capacity_snapshot_reference_id', 'runtime_capacity_snapshot_reference_version',
  'runtime_environment_reference_id', 'runtime_registry_snapshot_reference_id',
  'runtime_concurrency_reference_id', 'runtime_concurrency_reference_version',
  'runtime_readiness_freshness_reference_id', 'runtime_readiness_freshness_reference_version',
  'authorization_decision_id', 'authorization_created_logical_sequence', 'maximum_authorization_valid_sequences',
  'runtime_readiness_replay_reference_id', 'runtime_readiness_replay_reference_version',
  'runtime_readiness_request_id', 'runtime_readiness_request_version', 'runtime_readiness_policy',
  'runtime_execution_package_reference', 'runtime_execution_simulation_decision_reference',
  'runtime_execution_simulation_result_reference', 'runtime_capacity_snapshot_reference',
  'runtime_concurrency_reference', 'runtime_readiness_freshness_reference', 'runtime_readiness_replay_reference',
  'runtime_readiness_decision_id', 'runtime_readiness_request_fingerprint', 'runtime_execution_package_fingerprint',
  'runtime_execution_package_digest', 'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint',
  'runtime_freshness_fingerprint', 'runtime_replay_fingerprint', 'runtime_package_validated',
  'authorization_validated', 'runtime_readiness_evaluated', 'runtime_ready_in_simulation',
  'runtime_admission_request_id', 'runtime_admission_request_version', 'runtime_admission_policy',
  'runtime_readiness_request_reference', 'runtime_readiness_decision_reference',
  'runtime_admission_decision_id', 'runtime_admission_request_fingerprint', 'runtime_readiness_decision_fingerprint',
  'readiness_validated', 'runtime_admission_evaluated',
  'runtime_admission_result_id', 'runtime_admission_decision_fingerprint',
  // Runtime Scheduler Simulation Contracts (PR #105) field names -- "runtime"/"scheduler" here
  // always refer to this PR's own declarative scheduling plan (policy, request, stage/dependency/
  // parallel-group/approval-wait references, capacity/queue plan, package, decision, result), never
  // a real interpreter or an operational job/queue/worker scheduler. Every field below is a
  // compound name this PR's exact-fields lists mandate; none of them enable, start, or reference a
  // real runtime or scheduler ("scheduler"/"queue"/"job"/"worker"/"dispatch" are not forbidden
  // tokens on their own -- only "runtime" segments need this allowlist).
  'runtime_scheduler_policy_id', 'runtime_scheduler_policy_version', 'require_runtime_admitted_simulation',
  'runtime_scheduler_request_id', 'runtime_scheduler_request_version', 'runtime_scheduler_policy',
  'runtime_admission_request_reference', 'runtime_admission_decision_reference', 'runtime_admission_result_reference',
  'runtime_freshness_reference', 'runtime_replay_reference',
  'runtime_scheduler_package_id', 'runtime_scheduler_package_version',
  'source_runtime_dependency_reference_id', 'source_runtime_stage_reference_ids',
  'runtime_freshness_reference_id', 'runtime_replay_reference_id', 'runtime_admission_result_fingerprint',
  'runtime_scheduler_decision_id', 'runtime_scheduler_request_fingerprint', 'runtime_scheduler_package_fingerprint',
  'runtime_scheduler_package_digest', 'runtime_scheduler_result_id', 'runtime_scheduler_decision_fingerprint',
  // 'token' (exact segment, singular) is forbidden even though 'tokens' (plural) is not -- the
  // Scheduler Capacity Plan's own spec-mandated field name uses the singular form for this one
  // declarative within-limit flag; it never holds or references a credential.
  'token_capacity_within_limit',
  // Runtime Worker Assignment Simulation Contracts (PR #106) field names -- "runtime"/"worker"/
  // "secret" here always refer to this PR's own declarative worker reference/policy/compatibility/
  // candidate-set/assignment contracts, never a real interpreter, executor, or credential. This PR
  // never resolves a secret or starts a worker; "secret_policy" fields only ever compare two
  // declarative policy identifiers against each other.
  'runtime_worker_assignment_policy_id', 'runtime_worker_assignment_policy_version',
  'require_secret_policy_match', 'fail_on_secret_policy_mismatch',
  'runtime_worker_reference_id', 'runtime_worker_reference_version', 'runtime_environment_reference_id',
  'runtime_registry_snapshot_reference_id',
  // 'token' (exact segment, singular) again -- Runtime Worker Capacity Reference's own
  // spec-mandated field names use the singular form for this one declarative capacity dimension.
  'maximum_token_capacity', 'used_token_capacity', 'available_token_capacity',
  // Runtime Worker Reference's own declarative policy-reference-ID field -- "secret" here is a
  // pointer to a declarative secret policy identity, never a real secret; this PR never resolves
  // one (see "Não implementar" -- secret resolution).
  'secret_policy_reference_id', 'secret_policy_match', 'secret_policy_mismatch',
  // Runtime Worker Assignment Request/Package/Decision/Result (PR #106) field names -- "runtime"
  // here always refers to this PR's own declarative worker-assignment request/package/decision/
  // result contracts, never a real interpreter or executor.
  'runtime_worker_assignment_request_id', 'runtime_worker_assignment_request_version',
  'runtime_worker_assignment_policy', 'runtime_worker_assignment_package_id',
  'runtime_worker_assignment_package_version', 'runtime_worker_assignment_decision_id',
  'runtime_worker_assignment_result_id', 'runtime_worker_assignment_request_fingerprint',
  'runtime_worker_assignment_package_fingerprint', 'runtime_worker_assignment_package_digest',
  'runtime_worker_assignment_decision_fingerprint',
  'runtime_scheduler_decision_reference', 'runtime_scheduler_package_reference', 'runtime_scheduler_request_reference',
  'runtime_scheduler_result_reference',
  'runtime_worker_capability_references', 'runtime_worker_capacity_references', 'runtime_worker_health_references',
  'runtime_worker_references',
  // pr106fix: RuntimeWorkerNetworkPolicyReference/RuntimeWorkerSecretPolicyReference field names --
  // "secret"/"token" here always refer to this PR's own declarative, 1:1-bound policy identity
  // reference contract, never a real credential or resolved secret material. Replaces the previous
  // string-presence pass-through with genuine ID/version/fingerprint/tenant/org/project comparison.
  'runtime_worker_network_policy_references', 'runtime_worker_secret_policy_references',
  'worker_network_policy_fingerprints', 'worker_secret_policy_fingerprints',
  'worker_network_policy_reference_id', 'worker_network_policy_reference_version',
  'network_policy_reference_id', 'network_policy_version', 'network_policy_reference_valid', 'network_policy_fingerprint',
  'worker_secret_policy_reference_id', 'worker_secret_policy_reference_version',
  'secret_policy_version', 'secret_policy_reference_valid', 'secret_policy_fingerprint',
  'worker_health_expired_at_assignment_sequence', 'worker_health_sequence_regressive',
  'worker_health_status_not_healthy', 'worker_health_binding_invalid',
  'worker_network_policy_id_mismatch', 'worker_network_policy_version_mismatch', 'worker_network_policy_fingerprint_mismatch',
  'worker_network_policy_tenant_mismatch', 'worker_network_policy_organization_mismatch', 'worker_network_policy_project_mismatch',
  'worker_network_policy_environment_mismatch', 'worker_network_policy_reference_missing', 'worker_network_policy_reference_invalid',
  'worker_secret_policy_id_mismatch', 'worker_secret_policy_version_mismatch', 'worker_secret_policy_fingerprint_mismatch',
  'worker_secret_policy_tenant_mismatch', 'worker_secret_policy_organization_mismatch', 'worker_secret_policy_project_mismatch',
  'worker_secret_policy_environment_mismatch', 'worker_secret_policy_reference_missing', 'worker_secret_policy_reference_invalid',
  // pr106fix2: the RuntimeWorkerNetworkPolicyReference/RuntimeWorkerSecretPolicyReference bindings
  // above now must themselves bind to the official, pre-existing Network Permission Boundary
  // (`transcription-network-permission-boundary.js`) and Secret Resolution Boundary
  // (`transcription-secret-resolution-boundary.js`) declarative policy objects -- "official" here
  // always means those two already-audited PR #75/#76 contracts, reused verbatim via their own real
  // validators, never a second self-declared policy and never a real credential.
  'network_permission_policy_references', 'secret_resolution_policy_references',
  'official_network_policy_reference_id', 'official_network_policy_version', 'official_network_policy_fingerprint',
  'official_secret_policy_reference_id', 'official_secret_policy_version', 'official_secret_policy_fingerprint',
  'worker_network_official_policy_missing', 'worker_network_official_policy_version_mismatch',
  'worker_network_official_policy_fingerprint_mismatch', 'worker_network_official_policy_scope_mismatch',
  'worker_network_official_policy_not_allowed',
  'worker_secret_official_policy_missing', 'worker_secret_official_policy_version_mismatch',
  'worker_secret_official_policy_fingerprint_mismatch', 'worker_secret_official_policy_scope_mismatch',
  'worker_secret_official_policy_not_allowed',
  'network_official_policy_registry_duplicate', 'secret_official_policy_registry_duplicate',
  // pr106fix2: field names belonging to the official, pre-existing
  // `TranscriptionNetworkDestinationReference`/`TranscriptionSecretReference` contracts
  // (`transcription-network-permission-boundary.js`/`transcription-secret-resolution-boundary.js`,
  // PR #75/#76) -- reused verbatim as-is inside `network_permission_policy_references`/
  // `secret_resolution_policy_references`. Every one of these is a forced-false presence flag or a
  // declarative reference identifier, never a real endpoint/host/port/url/secret value; that
  // invariant is already enforced by the official contract's own validator before it ever reaches
  // this scan.
  'endpoint_present', 'hostname_present', 'ip_present', 'port_present', 'url_present',
  'secret_alias', 'secret_ref_id', 'secret_ref_version', 'secret_type',
  // pr106fix3: RuntimeWorkerStagePolicyRequirementReference field names plus the new cross-check
  // reason codes -- "the official policy's own content genuinely authorizes this stage's
  // requirement," never inferred from mere existence/version/fingerprint match.
  'stage_policy_requirement_references',
  'stage_policy_requirement_reference_id', 'stage_policy_requirement_reference_version',
  'stage_domain', 'provider_slug', 'requirement_reference_fingerprint',
  'stage_policy_requirement_registry_duplicate',
  'worker_network_official_policy_provider_mismatch', 'worker_network_official_policy_destination_mismatch',
  'worker_network_official_policy_domain_mismatch', 'worker_network_policy_requirement_unresolvable',
  'worker_secret_official_policy_provider_mismatch', 'worker_secret_official_policy_purpose_mismatch',
  'worker_secret_official_policy_domain_mismatch', 'worker_secret_policy_requirement_unresolvable'
]));
// Field *values* that are legitimate, closed-enum identifiers rather than operational material --
// mirrors AGENT_CORE_ALLOWLISTED_KEY_NAMES above, but for values instead of keys. Kept
// deliberately tiny: only exact, known-safe enum values belong here, never a prefix or pattern
// that could also match a real credential.
// Validation Semantics and Architecture Gates (PR #101): 'AUTHORIZATION' is one of the 22
// canonical ValidationStage values (validation-outcome.js) -- unlike 'AUTHORIZATION_PROVENANCE'/
// 'AUTHORIZATION_SCOPE' (which never match the word-boundary pattern below, since the character
// immediately after "AUTHORIZATION" in those two is '_', not a boundary), the bare stage name
// 'AUTHORIZATION' is an exact whole-string match for the forbidden word pattern's own
// \bauthorization\b and needs an explicit exemption the same way several field *names* already
// needed one in PR #97-#100.
// pr106fix2: 'mock-provider-a'/'mock-provider-b'/'mock-provider-c' are the closed-enum
// `ALLOWED_CAPABILITY_PROVIDER_SLUGS` from the official, pre-existing transcription provider
// capability matrix -- legitimate declarative identifiers a `TranscriptionNetworkDestinationReference`/
// `TranscriptionSecretReference` (reused verbatim by this PR's Worker Assignment policy binding) is
// structurally required to carry, never a real credential. The hyphen boundaries around "provider"
// inside these exact strings are what trip the generic forbidden-word-value pattern; exempted the
// same way 'AUTHORIZATION' already needed to be.
const AGENT_CORE_ALLOWLISTED_VALUE_NAMES = Object.freeze(new Set([
  'AUTHORIZATION',
  'mock-provider-a', 'mock-provider-b', 'mock-provider-c'
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

// A fingerprint or a composite id (e.g. ValidationLedger's `${stage}::${validator_id}` outcome
// ids, or a `stablePayload` serialization embedding them) is built entirely out of sibling fields
// that were already individually scanned when `visit()` reached each of them directly. So a
// known-safe allowlisted value (e.g. 'AUTHORIZATION', a real ValidationStage enum member) that
// reappears as an exact-case whole word inside such a derived string is not new operational
// material, only the same already-cleared value re-serialized or re-joined with punctuation.
// Stripping is deliberately exact-case and whole-word (never a bare case-insensitive substring
// match), so this can never launder a real secret that merely contains "authorization" in a
// different case or as part of a longer, otherwise-unsafe token.
function stripAllowlistedValueSubstrings(value) {
  let result = value;
  for (const allowlisted of AGENT_CORE_ALLOWLISTED_VALUE_NAMES) {
    const escaped = allowlisted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`\\b${escaped}\\b`, 'g'), '');
  }
  return result;
}

function looksLikeOperationalValue(rawValue) {
  const value = normalizeForDetection(rawValue);
  if (AGENT_CORE_ALLOWLISTED_VALUE_NAMES.has(rawValue)) return null;
  if (AGENT_CORE_FORBIDDEN_VALUE_PATTERN.test(stripAllowlistedValueSubstrings(value))) return 'forbidden_word_value';
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

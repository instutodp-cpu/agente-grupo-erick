# Hermes Agent Core — P1 Audit Fixes

Companion to `platform/docs/audits/HERMES_AGENT_CORE_ARCHITECTURE_AUDIT_79_84.md` and `HERMES_AGENT_CORE_CONSOLIDATION_BACKLOG.md`. This PR fixes exclusively the four P1 findings from the PR #85 audit. No new functionality, no public API changes beyond what each fix strictly requires, no behavior changes unrelated to the four P1s.

## P1-1 — Operational Material Detector (AUDIT-001)

**Problem:** `findAgentCoreOperationalMaterial` in `agent-identity-contract.js` relied only on separator-based key segmentation (`[^a-z0-9]+`) and word-boundary (`\b`) regex matching for values. Any forbidden term embedded in a camelCase/PascalCase identifier (`apiKeyValue`, `ApiKeyValue`) or fully glued with no separator or case transition (`myapikey`) evaded detection entirely.

**Fix:**
- `keySegments()` now splits on camelCase/PascalCase boundaries (lowercase→uppercase and acronym→word transitions) in addition to the existing non-alphanumeric split, closing the `apiKeyValue`/`ApiKeyValue` class of bypass.
- `isForbiddenAgentCoreKey()` gained a second, narrower check: a curated list of longer, distinctive tokens (`apikey`, `secret`, `password`, `authorization`, `bearer`, `oauth`, `filesystem`, `endpoint`, `hostname`, `callback`, `runtime`, `bootstrap`, `startup`, `childprocess`, `workerthreads`) is also matched as a substring within a single unseparated segment, closing the `myapikey` class of bypass.
- `execute`/`invoke` were deliberately **excluded** from the substring list: their past-tense/gerund forms (`executed`, `invoked`, `invoking`) are extremely common, legitimate safe-flag field names throughout this codebase (`executed`, `fallback_executed`, `escalation_executed`, `selection_executed`, and 90+ other files use `executed`-shaped fields). Including them caused a real, empirically-caught false positive during implementation (see Compatibility below) and was reverted before merge.
- Short/common tokens (`api`, `key`, `ip`, `env`, `url`, `uri`, `vm`, `jwt`, `host`, `port`, ...) remain excluded from substring matching — matching them as bare substrings would reintroduce the exact false-positive class already fixed once in PR #83 (`port` inside `transport`).
- `normalizeForDetection()` is a new best-effort Unicode hardening step, applied to both keys and values before matching: NFKC normalization, zero-width character stripping (`​`–`‍`, `﻿`, `⁠`), and a small, explicit confusables table (written as `\u` escapes, not raw characters, for reviewability) folding the common Cyrillic/Greek single-letter homoglyphs (а, е, о, р, с, х, у, і, ѕ, ј, ԁ and their Greek counterparts) back to their Latin lookalike. This is not a full Unicode confusables table — that is a much larger, separately-maintained dataset — but it covers the exact bypass class demonstrated in the audit (`sеcret` with Cyrillic е).

**Explicitly not changed (scope discipline):** value-level (free-text) camelCase splitting and substring matching were **not** added. Free-text values (descriptions, display names) have a much higher risk of legitimate camelCase-shaped words (`iPhone`-style brand names, etc.), and the audit itself flagged this as the highest false-positive-risk item in the backlog. The fix stays scoped to keys, which are structured identifiers, not prose.

**Coverage added:** `apiKeyValue`, `ApiKeyValue`, `myapikey`, `api_key_value`, `api-key-value`, `api_key` (all now caught), plus a Cyrillic-homoglyph value case, plus explicit non-regression assertions for every previously-known collision-prone field name (`transport_binding_valid`, `executed`, `fallback_executed`, `escalation_executed`, `selection_executed`, `model_id`, `provider_id`).

## P1-2 — Organization Rebinding (AUDIT-002)

**Problem:** `agent-registry.js` and `agent-policy-registry.js` (PR #79/#80, the two oldest registries) had no `organization_id` reassignment check at all — a version-bumped re-registration of the same `agent_id`/`policy_id` under the same tenant but a different `organization_id` was silently accepted. Every registry from PR #81 onward (`agent-session-registry.js`, `agent-memory-registry.js`, `model-provider-registry.js`, `model-selection-registry.js`) already blocks this with `ORGANIZATION_BLOCKED`.

**Fix:** both files now track `organization_id` alongside `tenant_id` in their stored record metadata, and reject a reassignment attempt with `ORGANIZATION_BLOCKED` at the same point in the register flow where the existing `TENANT_BLOCKED` check already lives (immediately after the version-conflict/downgrade checks, before the record is overwritten). `ORGANIZATION_BLOCKED` was added to both files' `*_REGISTRY_STATUSES` enum.

**Guaranteed preserved (verified by direct probe, not assumed):**
- `organization_id` can never be changed once registered (new test).
- `tenant_id` immutability is unaffected — the pre-existing `TENANT_BLOCKED` check and its position in the check order were not touched.
- Replay (`REPLAY_ACCEPTED` on an identical payload) still works.
- Optimistic concurrency (`expected_version` mismatch → `VERSION_CONFLICT`) still works.
- A blocked reassignment attempt never mutates the stored record — the registry stays at its last successfully-registered version.

## P1-3 — Candidate Ranking (AUDIT-003)

**Problem:** `model-selection-ranking.js`'s local `isOrderedUniqueStringList` only checked `Array.isArray` + length + `isNonEmptyString` — unlike the four other independent copies of the same-named function elsewhere in the codebase (`agent-policy-decision.js`, `model-provider-decision.js`, `model-selection-decision.js`), it never checked for duplicates or sort order. A `context.candidates` array with a duplicate `candidate_id` produced a ranking where `fallback_candidate_ids` could be identical to `primary_candidate_id`, and `validateModelSelectionRanking` reported it as valid.

**Fix:**
- `buildModelSelectionRanking()` now validates the input `candidates` array up front: every candidate must have a non-empty `candidate_id`, and no `candidate_id` may repeat. A duplicate or missing id throws immediately (`model_selection_ranking_duplicate_candidate_id::<id>` / `model_selection_ranking_candidate_id_missing`), consistent with this function's existing construction-time-throw pattern.
- Split the old single helper into `isUniqueStringList` (uniqueness only — correct for `eligible_candidate_ids`, `ordered_candidate_ids`, `fallback_candidate_ids`, `escalation_candidate_ids`, all of which are intentionally ordered by *rank*, not alphabetically) and `isOrderedUniqueStringList` (uniqueness **and** lexicographic order — correct only for `ineligible_candidate_ids`, which genuinely is alpha-sorted by the builder). Applying the stricter alphabetical check to the rank-ordered fields would have been a new bug of its own, since ranking order isn't alphabetical by design.
- `validateModelSelectionRanking()` gained three new explicit cross-field invariants: `fallback_candidate_ids` must never contain `primary_candidate_id`; `escalation_candidate_ids` must never contain `primary_candidate_id`; `escalation_candidate_ids` must never overlap `fallback_candidate_ids`. A count-consistency check (`ordered_candidate_ids.length === eligible + ineligible`) was also added.

**Coverage added:** duplicate `candidate_id` rejection, missing `candidate_id` rejection, fallback-never-equals-primary, escalation-never-equals-primary, escalation-never-overlaps-fallback, `ordered_candidate_ids` duplicate rejection — all as both direct unit assertions and full `validateModelSelectionRanking` schema checks.

## P1-4 — Cost Validation (AUDIT-004)

**Problem:** `validateModelSelectionCandidate` had no cross-field check between a candidate's `cost_tier` and its `estimated_cost_minor_units`. A candidate declaring `cost_tier: 'ZERO_COST_REFERENCE'` with `estimated_cost_minor_units: 5000` (or `cost_tier: 'VERY_LOW'` with a `PREMIUM`-range cost) passed validation cleanly, and — because `model-selection-ranking.js` compares `cost_tier` rank before the raw cost amount — the mis-declared candidate could out-rank an honestly-labeled cheaper one, directly undermining the engine's documented "lowest eligible cost wins" guarantee.

**Fix:** a new deterministic, non-overlapping range table (`COST_TIER_RANGES`, minor units) is checked whenever `cost_tier` is not `UNKNOWN_BLOCKED`:

| Tier | Range (minor units) |
|---|---|
| `ZERO_COST_REFERENCE` | `[0, 0]` |
| `VERY_LOW` | `[1, 99]` |
| `LOW` | `[100, 499]` |
| `MODERATE` | `[500, 1999]` |
| `HIGH` | `[2000, 99999]` |
| `PREMIUM` | `[100000, 1000000000]` |
| `UNKNOWN_BLOCKED` | exempt — already blocked elsewhere by `candidate_status` resolution in the engine, per the existing "UNKNOWN continua bloqueando" rule |

A mismatch (e.g. `VERY_LOW` with a cost in `PREMIUM`'s range) produces `cost_tier_inconsistent_with_estimated_cost::<tier>` and fails validation. The ranges were chosen to comfortably contain every value already used across the PR84 fixture (`VERY_LOW`=50, `LOW`=100–200, `MODERATE`=500–800, `HIGH`=2000–5000) with margin.

**Compatibility fix required:** the `budget-blocked-selection` fixture scenario declared a candidate with `cost_tier: 'HIGH'` and `estimated_cost_minor_units: 999999` — a deliberate extreme outlier used to trigger `BUDGET_BLOCKED`, but genuinely inconsistent with the new `HIGH` range. Relabeled to `cost_tier: 'PREMIUM'` (semantically correct — a near-1,000,000-minor-unit single-task cost is premium-priced, not merely "high") in `test/fixtures/hermes-model-selection-engine.json`. The scenario's expected outcome (`NO_ELIGIBLE_CANDIDATE`, via the constraint's `maximum_cost_minor_units` ceiling) is unchanged and still passes.

**Coverage added:** `VERY_LOW` rejecting a `PREMIUM`-range cost, `ZERO_COST_REFERENCE` rejecting a non-zero cost, `UNKNOWN_BLOCKED` remaining exempt, every tier's exact min/max boundary accepted, one value just above/below a boundary rejected.

## Files Changed

| File | P1 | Change |
|---|---|---|
| `platform/services/api/src/core/agent-identity-contract.js` | P1-1 | camelCase/PascalCase key splitting, scoped substring matching, Unicode normalization |
| `platform/services/api/src/core/agent-registry.js` | P1-2 | `ORGANIZATION_BLOCKED` check + status enum entry |
| `platform/services/api/src/core/agent-policy-registry.js` | P1-2 | `ORGANIZATION_BLOCKED` check + status enum entry |
| `platform/services/api/src/core/model-selection-ranking.js` | P1-3 | duplicate-id rejection, split uniqueness/order helpers, cross-field invariants |
| `platform/services/api/src/core/model-selection-candidate.js` | P1-4 | `COST_TIER_RANGES` + `isCostConsistentWithTier` cross-field check |
| `platform/services/api/test/agent-core-contracts.test.js` | P1-2 | organization-rebinding regression test |
| `platform/services/api/test/agent-policy-boundary.test.js` | P1-2 | organization-rebinding regression test |
| `platform/services/api/test/model-selection-engine.test.js` | P1-3, P1-4 | ranking-duplicate + cost-validation regression tests |
| `platform/services/api/test/agent-core-architecture-audit.test.js` | P1-1, P1-2, P1-3, P1-4 | the four PR #85 characterization tests rewritten as fixed-behavior regression tests |
| `platform/services/api/test/fixtures/hermes-model-selection-engine.json` | P1-4 | one candidate's `cost_tier` relabeled for internal consistency (see above) |
| `platform/services/api/package.json` | — | new test file registration |
| `platform/docs/audits/HERMES_AGENT_CORE_ARCHITECTURE_AUDIT_79_84.md` | — | P1 findings marked resolved |

## New Tests

10 new/rewritten tests: 4 tests added directly (P1-2 ×2, P1-3 ×1, P1-4 ×1) plus 4 architectural characterization tests converted to fixed-behavior regression tests (one per P1), for a net of **+4 tests** (1124 → 1128) since the converted tests replace existing test bodies rather than adding new ones.

## Impact

- No public contract field, enum value, or exported function signature was removed or renamed.
- Two new registry status values were added (`ORGANIZATION_BLOCKED` to `agent-registry.js`/`agent-policy-registry.js`'s status enums) — additive, not breaking, since no caller could previously receive this status.
- One new validation error reason string was added to `model-selection-candidate.js` (`cost_tier_inconsistent_with_estimated_cost::<tier>`) and to `model-selection-ranking.js` (three new cross-field error reasons) — additive.
- `buildModelSelectionRanking` can now throw where it previously silently accepted malformed input (duplicate/missing `candidate_id`). This is an intentional behavior change scoped exactly to P1-3's requirement ("candidate_id único... adicionar validação explícita"); no current caller in this codebase passes duplicate candidate ids, confirmed by running the full test suite before and after.
- One test fixture value was relabeled for internal consistency (see P1-4 above); its expected test outcome is unchanged.

## Compatibility

`node --check` passes on every changed file. Full `npm test` suite: **1128/1128 passing**, zero regressions across PRs #79–#85 and the transcription boundaries. No production behavior outside the four P1 fixes was altered — verified by running the complete pre-existing test suite (1124 tests, unmodified assertions) against every intermediate state of this PR's changes.

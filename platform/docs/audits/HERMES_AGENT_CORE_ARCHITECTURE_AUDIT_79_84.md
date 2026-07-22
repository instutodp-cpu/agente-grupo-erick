# Hermes Agent Core — Architecture Audit (PRs #79–#84)

Audit branch: `audit/hermes-agent-core-architecture-79-84`. Base: `main` at merge of PR #84 (`5e0e306`). This is a diagnostic PR only — no production behavior, contract, enum, decision, or fingerprint was changed to produce this report.

> **Update (PR #86):** all four P1 findings below (AUDIT-001, AUDIT-002, AUDIT-003, AUDIT-004) have been fixed. See `platform/docs/audits/HERMES_AGENT_CORE_AUDIT_FIXES.md` for the fix details, files changed, and test coverage. The findings are left below exactly as originally reported, each annotated `Status: RESOLVED in PR #86`, so this document remains an accurate historical record of the PR #85 audit.

## 1. Resumo Executivo

PRs #79–#84 (Agent Core Contracts, Agent Policy Boundary, Agent Session Boundary, Agent Memory Contracts, Model Provider Contracts, Model Selection Engine) were audited end-to-end: 163 files under `src/core/`, 64 test files (1113 tests), 44 fixtures, and 6 domain docs.

**No P0 finding.** No path was found — by inspection or by live probe — capable of returning `simulation=false`, `production_blocked=false`, `executed=true`, or any of the other twelve execution-shaped flags as `true` where it must be forced `false`. Safe-flag objects are spread last (or hardcoded as literals) in every decision and audit builder across all six PRs, and every registry independently re-validates and rejects hand-crafted records that try to bypass the builders. This is the single most important conclusion of the audit: **the core simulation invariant holds.**

That said, the audit found **4 P1 findings** that are real, reproducible defects — not style issues — and should be fixed before the codebase takes on real integration surface area:

- A confirmed bypass of the shared operational-material detector via camelCase/glued identifiers (`apiKeyValue`, `myapikey` both evade detection entirely).
- The two oldest registries (`agent-registry.js`, PR #79; `agent-policy-registry.js`, PR #80) have **no `organization_id` reassignment check at all** — every registry from PR #81 onward blocks this, but these two don't, a genuine regression-in-place against the architecture's own stated invariant.
- `model-selection-ranking.js`'s local `isOrderedUniqueStringList` doesn't actually check uniqueness or order (unlike four sibling implementations of the same name elsewhere in the codebase) — duplicate `candidate_id`s silently produce a ranking where the "fallback" candidate is identical to the "primary" one.
- `ModelSelectionCandidate` has no cross-field check between `cost_tier` and `estimated_cost_minor_units` — a candidate that mis-declares its cost tier can out-rank an honestly-labeled cheaper candidate, undermining the engine's headline guarantee.

Additionally: **5 P2**, **7 P3**, and **9 INFO** findings, mostly around shared-utility duplication (11 byte-identical `fingerprint()` copies, 10 files with locally-duplicated `isOrderedUniqueStringList`/`isOrderedUniqueEnumList`), naming inconsistencies, and a shared root-cause gap (`isPlainObject` not rejecting `Map`/`Set`/`RegExp`/`Error`/class instances) that quietly affects both fingerprint collision-resistance and the operational-material detector.

**Recommendation: GO WITH FIXES.** The architecture is sound — layering is clean (zero circular dependencies, zero contract-depends-on-engine/registry violations across 163 files), fingerprints are correctly documented as canonical serializations (never claimed as cryptographic hashes anywhere), and the simulation invariant is provably intact. But the four P1s are concrete bugs, two of them (`SELECTION-1`, `SELECTION-2`) sitting directly in the Model Selection Engine that PR #86 (Context Assembly Engine) will build on top of, and one (`REGISTRIES-1`) sitting in the foundational Agent Core registry. All four should be fixed — each is small (S/S/S/S–M effort) and isolated — before proceeding.

## 2. Escopo e Metodologia

**Scope:** every `agent-*.js`, `model-provider-*.js`, `model-selection-*.js`, and `model-*.js` (leaf contracts) file under `platform/services/api/src/core/`, plus every utility file they import (`agent-identity-contract.js`, `read-only-adapter-contract.js`, `agent-metadata-contract.js`, `agent-context-contract.js`, `agent-lifecycle-contract.js`, `agent-core-contract.js`), the corresponding test files and fixtures, the six PR #79–84 docs, `package.json`'s test script, and `.github/workflows/` for CI. Transcription/connector-boundary modules were only checked for coupling into the audited scope, not audited in their own right.

**Methodology:** static analysis (full `require()` graph traced by direct grep, not assumed), line-by-line reading of every contract/registry/decision/audit file in scope, and live `node -e` execution against the real exported functions for every claim that could be empirically verified (canonicalization behavior, detector bypasses, override-attack probes against decision builders, computed Model Selection Engine ranking examples, duplicate-ID probes). No claim in this report is based on reading code and assuming behavior where a probe was feasible — where a probe was run, its output is quoted.

Work was split into three parallel research passes (dependency graph + shared utilities + operational-material detector; contract conformance + registries + fingerprints; security invariants + Model Selection Engine + performance + tests/CI + docs), then synthesized into this single report with deduplicated, consistently-numbered findings.

## 3. Baseline

Captured on the audit branch, before any file was added:

- `git log --oneline` confirms merge commits for PR #79 (`2cb643f`/`bf712cc`), #80 (`6248624`/`38a84bb`), #81 (`d3ef14a`/`b5a8211`), #82 (`043787b`/`89f7a24`), #83 (`ef95f9b`, squash), #84 (`5e0e306`, squash) — all present on `main`.
- `git status`: clean except the untracked `prompts/` directory (out of version control by convention throughout this whole series).
- `npm test`: **1113 tests, 1113 passing, 0 failing**, `duration_ms: ~10350` (node-reported), ~17.6s wall including `npm`/`node` process startup.
- Agent Core file count: 38 `agent-*.js` files.
- Model Provider file count: 11 files (`model-provider-*.js` + the 7 leaf contracts `model-contract.js`, `model-capability-contract.js`, `model-pricing-contract.js`, `model-limits-contract.js`, `model-availability-contract.js`, `model-privacy-contract.js`, `model-health-contract.js`, plus `model-selection-reference.js` which is a PR #83 file despite its name colliding with PR #84's engine).
- Model Selection Engine file count: 12 `model-selection-*.js` files.
- Total `src/core/*.js`: 163 files.
- Registries in the whole codebase: 18 files matching `*registry*.js`; 6 are in PR #79–84 scope (`agent-registry.js`, `agent-policy-registry.js`, `agent-session-registry.js`, `agent-memory-registry.js`, `model-provider-registry.js`, `model-selection-registry.js`).
- Test files: 64 (`test/*.test.js`); fixtures: 44 (`test/fixtures/*.json`).
- Contracts (files exporting a `validate*` function against an exact-fields array): 40 in the audited scope.
- Decision-bearing files: 5 (`agent-policy-decision.js`, `agent-session-decision.js`, `agent-memory-decision.js`, `model-provider-decision.js`, `model-selection-decision.js`).
- Audit-bearing files: 5 (`agent-policy-audit.js`, `agent-session-audit.js`, `agent-memory-audit.js`, `model-provider-audit.js`, `model-selection-audit.js`), plus `agent-core-audit.js` for a 6th.

## 4. Mapa de Módulos

| PR | Domain | Core files | Registry | Decision | Audit | Test file | Fixture |
|---|---|---|---|---|---|---|---|
| #79 | Agent Core Contracts | agent-core-contract.js, agent-identity-contract.js, agent-capability-contract.js, agent-lifecycle-contract.js, agent-response-contract.js, agent-context-contract.js, agent-metadata-contract.js | agent-registry.js | — (contract-only; validation, no decision engine) | agent-core-audit.js | agent-core-contracts.test.js | hermes-agent-core-contracts.json |
| #80 | Agent Policy Boundary | agent-policy-contract.js, -rule-contract.js, -scope.js, -request.js, -limits.js, -budget.js | agent-policy-registry.js | agent-policy-decision.js (+ evaluator) | agent-policy-audit.js | agent-policy-boundary.test.js | hermes-agent-policy-boundary.json |
| #81 | Agent Session Boundary | agent-session-contract.js, -reference.js, -request.js, -state.js, -transition.js, -expiration.js | agent-session-registry.js | agent-session-decision.js | agent-session-audit.js | agent-session-boundary.test.js | hermes-agent-session-boundary.json |
| #82 | Agent Memory Contracts | agent-memory-item-contract.js, -scope.js, -policy-reference.js, -retrieval-reference.js, -contract.js, -request.js | agent-memory-registry.js | agent-memory-decision.js (+ evaluator) | agent-memory-audit.js | agent-memory-contracts.test.js | hermes-agent-memory-contracts.json |
| #83 | Model Provider Contracts | model-capability/-pricing/-limits/-availability/-privacy/-health-contract.js, model-contract.js, model-provider-contract.js, model-selection-reference.js | model-provider-registry.js | model-provider-decision.js (+ evaluator) | model-provider-audit.js | model-provider-contracts.test.js | hermes-model-provider-contracts.json |
| #84 | Model Selection Engine | model-selection-task-profile.js, -constraints.js, -candidate.js, -request.js, -score.js, -ranking.js, -escalation-plan.js | model-selection-registry.js | model-selection-decision.js (evaluator in model-selection-engine.js) | model-selection-audit.js | model-selection-engine.test.js | hermes-model-selection-engine.json |

Shared kernel (imported by all 163 files, directly or transitively): `agent-identity-contract.js` (canonicalization, freeze, exact-fields, operational-material detection — see §9) and `read-only-adapter-contract.js` (base primitives — `isPlainObject`, `isNonEmptyString`, `uniqueSorted`).

## 5. Grafo e Matriz de Dependências

Full `require('./...')` graph traced by direct grep across all 81 `agent-*`/`model-*` files (not estimated). Result: **zero circular dependencies found**, and **zero contract files import an engine, decision-evaluator, or registry file** — the dependency direction is uniformly registry/engine → contract, decision → contract, never the reverse. `agent-identity-contract.js` is imported by all 81 files and itself only imports `read-only-adapter-contract.js` — it introduces no upward or domain-specific coupling.

| Module | Depends on | Type | Assessment |
|---|---|---|---|
| agent-identity-contract.js | read-only-adapter-contract.js | base primitives | correta |
| agent-registry.js | agent-core-contract.js | registry → contract | correta |
| agent-session-reference.js | agent-policy-decision.js, agent-core-contract.js | cross-domain enum reuse | aceitável temporariamente (§9-AUDIT-010) |
| agent-memory-policy-reference.js | agent-policy-decision.js | cross-domain enum reuse (read-only) | correta |
| model-provider-contract.js, model-privacy-contract.js | agent-memory-item-contract.js | cross-domain enum reuse (`RETENTION_CLASSES`) | aceitável temporariamente |
| model-selection-*.js (candidate/constraints/task-profile/decision/ranking) | model-contract.js, model-capability-contract.js, model-availability-contract.js, model-health-contract.js | leaf-contract enum reuse | correta |
| model-selection-engine.js | model-selection-{candidate,decision,escalation-plan,ranking,request,score}.js | engine → contracts | correta |
| model-selection-registry.js | model-selection-{candidate,constraints,decision,escalation-plan,ranking,task-profile}.js | registry → contracts | correta |
| model-provider-decision.js | model-selection-reference.js | contract → contract (PR #83-internal; **not** a coupling to PR #84's engine, despite the name collision) | correta, but naming is confusing — see AUDIT-010 note |
| All 163 files | agent-identity-contract.js | shared kernel utilities | correta functionally; file's own scope/naming doesn't reflect its role (see §9, AUDIT-005) |

No dependency was found needing outright removal. Two are marked "aceitável temporariamente" — legitimate reuse of an enum/status list across domains, correct today, but a candidate for relocating the shared vocabulary (`RETENTION_CLASSES`, `DECISION_STATUSES`) into a neutral module rather than leaving it homed in one domain's contract file, once a consolidation pass happens.

## 6. Matriz de Conformidade dos Contratos

All 40 contract-bearing files use `exactFields()` uniformly (zero hand-rolled field-presence checks found), return `{ valid, errors }` uniformly, and pipe `errors` through `uniqueSorted()` uniformly. That baseline is solid.

Deviations found:

| Check | Conformant | Deviation |
|---|---|---|
| `X_VALIDATOR_VERSION` naming | 36/40 | `agent-policy-audit.js`, `agent-session-audit.js`, `agent-memory-audit.js`, `model-provider-audit.js` use bare `X_AUDIT_VERSION` instead — `model-selection-audit.js` (the newest) correctly uses the full suffix, so even the 5-file "audit" family is 4-vs-1 split (AUDIT-014) |
| `organization_id` namespace check where both `tenant_id`+`organization_id` are top-level fields | all applicable files | none found missing (leaf/reference files without both fields correctly have no check — not a gap) |
| Builder applies `cloneFrozen` | all `build*` functions | none found missing |
| `validate*` calls `findAgentCoreOperationalMaterial` on its own payload | all applicable contracts | none found missing |
| Evaluator co-located in decision file vs. separate boundary/engine file | inconsistent by design, not by accident | `agent-policy-decision.js`/`agent-memory-decision.js` co-locate; `agent-session-boundary.js`/`model-selection-engine.js` separate it out — both patterns work and are tested (AUDIT-020, documentation-only) |
| `simulation_context` (nested object) vs. flat `simulation`/`production_blocked` booleans | PR79–82 aggregate contracts use nested `simulation_context`; PR83–84 decision/audit/leaf objects use flat booleans | internally consistent per generation, not a defect, but undocumented as a deliberate pattern choice |

No P0/P1 contract-conformance finding. See §15 for the full severity-tagged list.

## 7. Matriz dos Registries

All six registries (`agent-registry.js`, `agent-policy-registry.js`, `agent-session-registry.js`, `agent-memory-registry.js`, `model-provider-registry.js`, `model-selection-registry.js`) instantiate their `Map`s **inside** `createXRegistry()` — confirmed by reading every factory function. **No module-level singleton state found anywhere** — every registry is correctly instance-scoped, so tests get full isolation between files (AUDIT-021, positive finding).

| Registry (PR) | `FINGERPRINT_CONFLICT` | `ORGANIZATION_BLOCKED` on reassignment | ID-reused-for-different-owner status | Cross-field conflict check (`extraConflictCheck`) |
|---|---|---|---|---|
| agent-registry.js (#79) | ✗ | **✗ — missing (AUDIT-002, P1)** | none | n/a |
| agent-policy-registry.js (#80) | ✗ | **✗ — missing (AUDIT-002, P1)** | `POLICY_CONFLICT` | n/a |
| agent-session-registry.js (#81) | ✓ | ✓ | `SESSION_CONFLICT` | n/a |
| agent-memory-registry.js (#82) | ✓ | ✓ | `ITEM_CONFLICT` | n/a |
| model-provider-registry.js (#83) | ✓ | ✓ | `ITEM_CONFLICT` | ✓ (`provider_id` reassignment blocked on model store) |
| model-selection-registry.js (#84) | ✓ | ✓ | none wired | ✗ — candidate store has no `extraConflictCheck` despite reusing the same factory shape as #83 |

The single most significant registry finding: **`agent-registry.js` has zero references to `organization_id` anywhere in the file** (confirmed by grep — 0 occurrences). Its tenant-reassignment block exists (`existing.tenant_id !== tenantId → TENANT_BLOCKED`) but has no organization equivalent, so a version-bumped re-registration of the same `agent_id` under the same tenant but a different organization is silently accepted. `agent-policy-registry.js` has the identical gap. Every registry from PR #81 onward closes this. This is AUDIT-002 (P1) — see §15.

Defensive clone / deep freeze is uniform across all six on both write and read paths; no indirect-mutation path was found (nested arrays inside frozen records are also frozen, confirmed against `deepFreeze`'s recursive implementation). No registry caps total stored-entry count — `MAX_LIST_RESULTS`-style constants only bound a single `listX()` call's *returned* size, not the underlying `Map`'s size — flagged as a performance item (§12), not a correctness defect.

`model-provider-registry.js` and `model-selection-registry.js` already share a hand-copied `createEntityStore(config)` factory (~70 lines each, near-identical). `agent-memory-registry.js` (single-entity) is structurally close enough to fold in. `agent-session-registry.js` and `agent-policy-registry.js` are more idiosyncratic (expiration logic; two related entity types). `agent-registry.js` additionally has a slug-uniqueness side-index not present anywhere else. **Recommendation: bring `agent-registry.js`/`agent-policy-registry.js` up to parity (fix AUDIT-002, standardize conflict-status naming) before or as part of any Registry Kernel consolidation, not after** — folding a known gap into a shared kernel would just propagate it to all six.

## 8. Auditoria de Fingerprints

**Confirmed: "fingerprint" in this codebase is a canonical JSON serialization, never a cryptographic hash.** `stablePayload(value)` = `JSON.stringify(stableCanonicalize(value))`. No `crypto.createHash`, checksum, or digest exists anywhere in the call chain (grep for `crypto` across `src/core/` returns zero matches). This matches what the two newest docs (`HERMES_MODEL_PROVIDER_CONTRACTS.md`, `HERMES_MODEL_SELECTION_ENGINE.md`) already state explicitly; no doc in the six-doc set was found describing a fingerprint as a hash.

Live-probed canonicalization behavior against the real `agent-identity-contract.js` implementation:

| Input | Behavior | Verdict |
|---|---|---|
| Key order (`{b:1,a:2}` vs `{a:2,b:1}`) | Identical canonical string | ✓ stable |
| Array order (`[1,2,3]` vs `[3,2,1]`) | **Different** canonical strings — arrays are preserved in input order, never sorted | ✓ correct/intentional — every contract needing order-independence pre-sorts via `uniqueSorted`/`isOrderedUniqueStringList` before the field is fingerprinted; no violation found |
| `undefined` | Throws `TypeError: undefined_not_serializable` | ✓ |
| `null` | Passes through as `null` | ✓ |
| `-0` | Serializes identically to `0` | ✓ standard JSON behavior, no collision risk |
| `NaN` / `Infinity` | Throws `TypeError: non_finite_number_not_serializable` | ✓ |
| `BigInt` | Throws `TypeError: bigint_not_serializable` | ✓ |
| `Symbol` | Throws `TypeError: symbol_not_serializable` | ✓ |
| Function | Throws `TypeError: function_not_serializable` | ✓ |
| Cycle | Throws `TypeError: cyclic_reference_not_serializable` | ✓ |
| `Date` | Explicit `instanceof Date` check, throws `TypeError: date_not_serializable` | ✓ deliberate, not a fallthrough |
| `Map` / `Set` / `RegExp` / `Error` / class instance | **Silently canonicalizes to `{}` or an own-properties subset — does not throw** | ✗ see AUDIT-008 |

The `Map`/`Set`/`RegExp`/`Error` gap is real and demonstrated: `stablePayload({a: new Map([['x',1]])})` → `'{"a":{}}'`, same as an actually-empty object — a genuine semantic-collision risk for any loosely-typed field (in-scope today: only `metadata`-style free-form fields, e.g. `agent-context-contract.js`'s `metadata`, are exposed to this, since every other field has a stricter type/enum check). Root cause is `isPlainObject` (`read-only-adapter-contract.js`) having no prototype check. **This is the same root cause that makes these types invisible to `findAgentCoreOperationalMaterial`** (§9) — one fix in the shared `isPlainObject` helper (or explicit reject-listing in both call sites) closes both gaps at once. See AUDIT-008.

Caller-supplied opaque `*_fingerprint` fields (small reference-pointer structs) and independently-computed fingerprints (via `stablePayload(actualObject)` at decision/audit time) are never confused — no code path treats an inbound opaque string as independently re-derived; decision/registry code always computes its own fingerprint for conflict detection.

Two duplication findings: **11 byte-identical local `fingerprint`/`safeFingerprint` helper copies** (`agent-core-audit.js`, `agent-memory-audit.js`, `agent-memory-decision.js`, `agent-policy-audit.js`, `agent-policy-boundary.js`, `agent-session-audit.js`, `agent-session-boundary.js`, `model-provider-audit.js`, `model-provider-decision.js`, `model-selection-audit.js`, `model-selection-engine.js`) — same 6-line body, only the function name differs (`fingerprint` in audit files, `safeFingerprint` in decision/boundary/engine files); and `cloneFrozen` performs a redundant `JSON.parse(JSON.stringify(...))` round-trip on a tree that `stableCanonicalize` already returned fully detached — a performance observation, not a correctness one (§12).

## 9. Auditoria do Detector Operacional

`findAgentCoreOperationalMaterial` in `agent-identity-contract.js` uses two independent strategies: **key matching** (lowercase + split on `/[^a-z0-9]+/`, then check whether any *whole segment* exactly equals one of 35 forbidden tokens — this is why `transport_binding_valid` doesn't false-positive on `port`) and **value matching** (a single case-insensitive `\b(...)\b` word-boundary alternation over 27 tokens, plus 12 shape patterns for URLs/IPs/host:port/connection-strings/`process.env`/dynamic-import/arrow-functions). The 8-entry allowlist was checked against real usage — every entry maps to a currently-used field name in 2+ production files; nothing speculative or unused.

**Live-confirmed bypass (P1, AUDIT-001):** both the key-matching and value-matching strategies rely on explicit separators/boundaries, so any forbidden term embedded in a camelCase or fully-glued alphanumeric identifier evades detection completely:

```
f({ 'a-p-i-k-e-y': 'x' })    -> []   (segments a,p,i,k,e,y — none match)
f({ apiKeyValue: 'x' })      -> []   (camelCase glues to one segment "apikeyvalue")
f({ myapikey: 'x' })         -> []   (no separator at all)
f({ note: 'myApiKeyIsX' })   -> []   (value glued — \b never matches mid-identifier)
f({ note: 'apikey12345' })   -> []   (trailing digits break the trailing \b)
```

No current PR #79–84 fixture or contract triggers this (field-naming convention is consistently snake_case), so it is **latent, not actively exploited** — but nothing at the detector level enforces that convention, and the bypass is real and reproducible.

**Secondary, lower-severity bypasses confirmed:** Unicode homoglyph (`sеcret` with Cyrillic е) and zero-width-character insertion both evade the value pattern (P3, AUDIT-013). `Map`/`Set`/`RegExp`/`Error`/class-instance values are invisible to the detector for the same `isPlainObject`-prototype-check reason documented in §8 (merged into AUDIT-008, P2, since it affects both fingerprinting and detection).

**Confirmed correct / no false positive:** `f({ model_id: 'hermes-neo-x-ref' })` → `[]` (no bare "model" word in the value) but `f({ note: 'the model is great' })` → flagged — confirming PR #83's removal of `'model'`/`'provider'` from the KEY-token list has not drifted into the VALUE pattern, which still correctly catches free-text mentions. NaN/Infinity/-0/BigInt/Symbol/function/cycle all behave exactly as expected (see §11 for the full probe transcript). Arrays and nested structures are correctly recursed into (`f({list:[{api_key:'x'}]})` → flags `list[0].api_key`).

**No leak path found:** grepped all 96 call sites across 38 files — every pushed error string is `${reason}::${path}`; the raw detected *value* is never included in any error array or audit record.

**Plausible-but-unconfirmed gaps (P2, AUDIT-006):** neither list contains `credential`/`credentials`, `webhook`, `database`/`dsn`, or `socket`/`websocket` as bare key tokens (value-level shape patterns do catch actual connection-string/`wss://` values, so this is a key-name-only gap). No current field uses these names — forward-looking, not demonstrated.

Case table (representative subset; full set in the fork transcripts referenced by this synthesis):

| Input | Current result | Expected | Risk |
|---|---|---|---|
| `{apiKeyValue:'x'}` | `[]` | flag | P1 |
| `{note:'myApiKeyIsX'}` | `[]` | flag | P1 |
| `{note:'sеcret value'}` (Cyrillic е) | `[]` | flag | P3 |
| `{a: new Map([['api_key','x']])}` | `[]` | flag | P2 (merged, AUDIT-008) |
| `{model_id:'hermes-neo-x-ref'}` | `[]` | `[]` | none — correct |
| `{v: NaN}` | `non_finite_number::v` | flag | none — correct |
| `{v: 10n}` | `forbidden_bigint::v` | flag | none — correct |
| cyclic object | `forbidden_cycle::...` | flag | none — correct |
| `{list:[{api_key:'x'}]}` | `forbidden_key::list[0].api_key` | flag | none — correct |

## 10. Auditoria do Model Selection Engine

All claims below were verified by running `node -e` against the real exported functions of `model-selection-engine.js`, `model-selection-ranking.js`, `model-selection-score.js`, `model-selection-candidate.js`, `model-selection-decision.js` — not by reading code alone.

**Confirmed correct, with computed evidence:**
- The 9-criterion ordering chain (cost tier → estimated cost → capability count → quality → privacy → latency → availability → health → locality → canonical `model_id` tie-break) was stress-tested one criterion at a time (all others tied) and produced the documented winner in every case.
- `NO_LLM` beats a tied-cost real candidate — its branch fires in the comparator before cost is even compared.
- Order independence: two permutations of the same 4-candidate set (including `NO_LLM`) produced byte-identical `ordered_candidate_ids`.
- `cost_tier: UNKNOWN_BLOCKED` → `BUDGET_BLOCKED`; `health_status`/`availability_status: UNKNOWN_BLOCKED` → `HEALTH_BLOCKED`/`AVAILABILITY_BLOCKED`. None silently pass.
- `risk_classification: HIGH` and `complexity_tier: TIER_5_CRITICAL` both correctly force `minimum_quality_tier >= ADVANCED` at the task-profile validator.
- Fallback/escalation counts respect `maximum_fallbacks`/`maximum_escalations` exactly; `fallback_executed`/`escalation_executed` are always `false`.
- **`total_score` (from `model-selection-score.js`) has zero influence on selection**, confirmed by construction: a candidate scoring `480` beat a candidate scoring `640` in the actual ranking, because `model-selection-ranking.js`'s comparator never reads `total_score` — it uses its own independent multi-key comparator. This matches the documented "informational only" design (AUDIT-024, INFO) but means the score is pure computed overhead today with no consumer.

**Two demonstrated defects (P1):**

**AUDIT-003 (`SELECTION-1`):** `model-selection-ranking.js`'s local `isOrderedUniqueStringList` only checks `Array.isArray` + length + `isNonEmptyString` — it never checks `new Set(list).size !== list.length` or sort order, unlike the identically-named function in `agent-policy-decision.js`, `model-provider-decision.js`, and `model-selection-decision.js`, which all do. Probe: two candidates both given `candidate_id: 'dup-1'` (both `ELIGIBLE_SIMULATION`) produces `eligible_candidate_ids: ["dup-1","dup-1"]` and, critically, `fallback_candidate_ids: ["dup-1"]` **identical to** `primary_candidate_id: "dup-1"` — `validateModelSelectionRanking` reports `{"valid":true,"errors":[]}` on this. Root cause: `model-selection-engine.js` never deduplicates `context.candidates` by `candidate_id` before building the pool. This is exactly the kind of drift the widespread duplication of this helper (§6/§9's utility findings) makes possible — one of ten independent local copies silently diverged from its siblings.

**AUDIT-004 (`SELECTION-2`):** No cross-field check exists between a candidate's declared `cost_tier` and its `estimated_cost_minor_units`. A candidate declaring `cost_tier: 'ZERO_COST_REFERENCE'` with `estimated_cost_minor_units: 5000` passes `validateModelSelectionCandidate` cleanly (`{"valid":true,"errors":[]}`). Ranked against an honestly-labeled `cost_tier: 'VERY_LOW'`, `estimated_cost_minor_units: 200` candidate, **the mis-declared one wins** — because the comparator checks `cost_tier` rank before `estimated_cost_minor_units`. This directly undermines the engine's headline documented guarantee ("o motor seleciona... a alternativa elegível de menor custo"). Latent today (nothing in-tree currently synthesizes `ModelCandidate` objects from real `ModelPricingContract` data — that bridge doesn't exist yet), but real once one is built.

No duplicate-candidate detection, no cost/tier cross-check — both are small, isolated fixes (see backlog, §17).

## 11. Segurança e Invariantes

**Proved, not assumed.** In every one of the five `build*Decision` functions (`agent-policy-decision.js:155,180`; `agent-session-decision.js:112,127`; `agent-memory-decision.js:118,132`; `model-provider-decision.js:128,147`; `model-selection-decision.js:158,174`), the safe-flags constant is spread **last** in both the success path and the validation-failure fallback path, so it always wins over caller-supplied overrides. All five `build*Audit` functions don't even use a spread — `simulation: true`, `production_blocked: true`, `executed: false` are hardcoded literals, unreachable by any override — the safest possible pattern.

**Live override-attack probe:** ran `node -e` against all 5 `build*Decision` functions, passing `executed: true, network_used: true, simulation: false, production_blocked: false, runtime_enabled: true` (plus every other forbidden flag) as overrides. **Every flag came back correctly forced in all 5 outputs. Zero bypasses found.**

**Exception-path check:** passed a `BigInt` into a cost field (a value `stablePayload` can't serialize) to `buildModelSelectionDecision`. No throw escaped — `Number.isInteger` rejects the value before serialization, defaults safely, and the returned object is still frozen with every flag correctly forced.

**Registry defense-in-depth, confirmed empirically (AUDIT-023, INFO):** registered a hand-crafted decision object directly into `model-selection-registry.js`, bypassing `buildModelSelectionDecision` entirely, with `executed: true, simulation: false` set directly. The registry's own `validate()` call independently re-checked every safe flag and **rejected it outright** (`VALIDATION_FAILED`, 11 errors, nothing stored, `getById` returns `null`). Registries are not passive stores — they are a second, independent enforcement layer.

**Fixture grep:** zero hits for any forbidden `true`/`false` literal across the 6 in-scope fixtures. (Three fixtures from *pre-PR79* domains — connector-lifecycle, public-web read-only, out of this audit's scope — do contain `executed:true`/`runtime_enabled:true`, noted only as an observation since those domains model already-connected mock scenarios by design, not a PR79-84 finding.)

**No P0 in this section.** The core invariant this entire six-PR architecture is built around — nothing can ever claim to have actually executed — holds under both static inspection and live adversarial probing.

## 12. Performance

No blocking (P0/P1) performance finding. Everything below is either "recomendada antes do runtime" or "prematura":

- **`model-selection-registry.js`'s (and, by the same pattern, the other five registries') `listAll`/`listByTenant`**: linear scan over the full `Map`, early-`break`s at `MAX_LIST_RESULTS=200` — but only once 200 *matching* results are found. If the target tenant/filter has few matches among a large multi-tenant `Map`, the scan is O(n) over *all* records ever registered, not O(200). The underlying `Map` itself has no cap or eviction. **Classificação: recomendada antes do runtime** — no in-tree caller produces large N today, but this will matter once a real registry-backed service accumulates records across many requests. (AUDIT-016)
- **`cloneFrozen` double-serializes redundantly**: `stableCanonicalize` already returns a fully-detached, freshly-allocated tree; `cloneFrozen` then performs `JSON.parse(JSON.stringify(...))` on top of that — a redundant second full-tree pass, paid on every registry write, every registry read, and every decision/audit build (one of the hottest call paths in the codebase). **Classificação: recomendada antes do runtime.** (AUDIT-016, merged with the above under one performance backlog item)
- No redundant `stablePayload`/`cloneFrozen` calls found on the *same* object within a single `evaluateModelSelectionRequest` pass — each candidate is fingerprinted once, scored once.
- Caps are checked before expensive work where it matters: `MAX_CANDIDATE_REFERENCES=200`, `MAX_CANDIDATES=200`, and the engine does a bounded `.slice()` rather than an unbounded iteration.
- Test suite cost: 1113 tests in ~8.9–10.4s (varies slightly run to run) — no individual file stands out as conspicuously slow. **Classificação: prematura** to optimize.

## 13. Testes e CI

`package.json`'s manual, space-separated `test` script is **currently perfectly in sync with disk — 64/64**, verified by direct comparison. But **no automated safety net enforces this going forward** — it's a plain string literal, not a glob or a disk-diff check. This exact manual registration step has been performed by hand 6 times in a row (once per PR #79–84); a forgotten registration would silently produce a test file that never runs, with fully green CI. (AUDIT-009, P2)

CI (`.github/workflows/`) runs the identical `npm test` command from the identical working directory as local development — no divergence on the unit-test step. CI additionally runs a broader `node --check` over every `.js` file (not just new ones) and a real `docker compose` + smoke-script pass that local development couldn't always exercise (Docker was unavailable locally during this session's PR #83/#84 work, confirmed by direct `docker info` probes at the time — smoke ran in CI only, as reported in both PRs).

No test duplication, no generic/weak-assertion problem, and no happy-path-only file was found among the six PR #79–84 test files — each was built with an explicit "missing/extra field," "invalid enum," and "forbidden literal" test, a pattern consistent across all six. No `Date.now()`/`new Date()`/`setTimeout`/`setInterval`/`Math.random()` was found in any PR #79–84 core file (independently re-verified per-PR by each test file's own regression test).

## 14. Documentação

Fingerprint terminology is correct throughout — both docs that discuss fingerprints in depth (`HERMES_MODEL_PROVIDER_CONTRACTS.md`, `HERMES_MODEL_SELECTION_ENGINE.md`) explicitly state "not a cryptographic hash." No doc in the six-doc set claims fingerprints are hashes. The "Next Steps" chain across all six docs is fully consistent and gapless: Core Contracts → Policy Boundary → Session Boundary → Memory Contracts → Model Provider Contracts → Model Selection Engine → (declared) Context Assembly Engine — each doc's stated next step matches the following PR's actual delivered title. No promise/behavior spot-checked against source was found unsupported. **No documentation/code divergence found.**

## 15. Achados P0–P3

**P0: none found.**

**P1 (4):**

| ID | Domain | Files | Summary | Status |
|---|---|---|---|---|
| AUDIT-001 | Operational material detector | agent-identity-contract.js | camelCase/glued key or value identifiers bypass detection entirely | **RESOLVED in PR #86** |
| AUDIT-002 | Registries | agent-registry.js, agent-policy-registry.js | no `organization_id` reassignment block, unlike every registry from PR #81 onward | **RESOLVED in PR #86** |
| AUDIT-003 | Model Selection Engine | model-selection-ranking.js, model-selection-engine.js | local `isOrderedUniqueStringList` doesn't check uniqueness/order; duplicate `candidate_id` produces a ranking where fallback == primary | **RESOLVED in PR #86** |
| AUDIT-004 | Model Selection Engine | model-selection-candidate.js, model-selection-ranking.js | no cross-field check between `cost_tier` and `estimated_cost_minor_units`; a mis-declared cheap tier out-ranks an honestly-priced cheaper candidate | **RESOLVED in PR #86** |

**P2 (5):**

| ID | Domain | Files | Summary |
|---|---|---|---|
| AUDIT-005 | Shared utilities | agent-identity-contract.js | hosts the shared kernel (canonicalization/freeze/detector) under a single-domain-sounding name; used by all 163 files |
| AUDIT-006 | Operational material detector | agent-identity-contract.js | forbidden-token lists lack `credential`/`credentials`, `webhook`, `database`/`dsn`, `socket`/`websocket` |
| AUDIT-007 | Registries | agent-policy-registry.js, agent-session-registry.js, agent-memory-registry.js, model-provider-registry.js, model-selection-registry.js | 3 different names (`POLICY_CONFLICT`/`SESSION_CONFLICT`/`ITEM_CONFLICT`) for the same concept; `model-selection-registry.js`'s candidate store has no `extraConflictCheck` unlike its PR #83 sibling |
| AUDIT-008 | Fingerprints + detector (shared root cause) | read-only-adapter-contract.js (`isPlainObject`), agent-identity-contract.js (`stableCanonicalize`, `findAgentCoreOperationalMaterial`) | `Map`/`Set`/`RegExp`/`Error`/class instances silently canonicalize to `{}` (fingerprint collision risk) and are simultaneously invisible to the operational-material detector |
| AUDIT-009 | Tests and CI | package.json | test-script file list is manually maintained with no automated sync check |

**P3 (7):**

| ID | Domain | Files | Summary |
|---|---|---|---|
| AUDIT-010 | Dependency graph | agent-session-reference.js | de facto shared reference kernel, mislabeled/scoped as Session-domain-only |
| AUDIT-011 | Shared utilities | 10 files (model-selection-*, agent-policy-decision.js, model-provider-decision.js) | `isOrderedUniqueStringList`/`isOrderedUniqueEnumList` duplicated independently; directly enabled AUDIT-003's drift |
| AUDIT-012 | Shared utilities (out-of-scope note) | read-only-adapter-contract.js | an older, less rigorous, independently-evolved forbidden-material detector (`findForbiddenFields`) coexists with `findAgentCoreOperationalMaterial`; never called by PR79-84 code, but a live inconsistency in the wider codebase |
| AUDIT-013 | Operational material detector | agent-identity-contract.js | Unicode homoglyph / zero-width-character bypass of the value pattern |
| AUDIT-014 | Contract conformance | agent-policy-audit.js, agent-session-audit.js, agent-memory-audit.js, model-provider-audit.js | validator-version constant named `X_AUDIT_VERSION` instead of `X_AUDIT_VALIDATOR_VERSION` (model-selection-audit.js, the newest, uses the correct pattern) |
| AUDIT-015 | Fingerprints | 11 files | byte-identical local `fingerprint`/`safeFingerprint` helper duplicated 11 times |
| AUDIT-016 | Performance | agent-identity-contract.js (`cloneFrozen`), all 6 registries (`listAll`/`listByTenant`) | redundant double-serialization in `cloneFrozen`; unbounded linear registry scan as record count grows |
| AUDIT-020 | Contract conformance (documentation-only) | agent-policy-decision.js/agent-memory-decision.js vs. agent-session-boundary.js/model-selection-engine.js | evaluator co-location pattern varies per PR with no stated rule (no code change implied) |

**INFO (9):** clean layering / zero circular deps (AUDIT-017, merges DEPS-1+DEPS-2); no raw-value leakage from the detector into errors/audit (AUDIT-018); allowlist fully justified against real usage (AUDIT-019); no module-level registry singleton state (AUDIT-021); safe-flag spread-order verified live across all 5 decision builders with zero bypass (AUDIT-022); registries independently re-validate/reject hand-crafted malicious records — defense in depth confirmed empirically (AUDIT-023); `total_score` computed on every request but has zero influence on ranking by design (AUDIT-024); documentation terminology and "Next Steps" chain fully consistent (AUDIT-025).

## 16. Riscos Aceitos

- **Registry unbounded growth (AUDIT-016, performance half).** Accepted for now: no long-lived process holds these registries yet; every current caller is a test creating a fresh registry per file. Must be revisited before any runtime service holds a registry across many real requests.
- **Evaluator co-location inconsistency (AUDIT-020).** Accepted as a documentation gap, not a functional defect — both patterns (co-located vs. separate boundary/engine file) are correct and tested. No code risk.
- **`agent-session-reference.js` as an unlabeled shared kernel (AUDIT-010) and cross-domain enum reuse of `RETENTION_CLASSES`/`DECISION_STATUSES` (§5 dependency matrix).** Accepted as correct-but-suboptimally-located; relocating is a naming/organization improvement, not a bug fix, and carries its own (small) regression risk if done carelessly. Scheduled for the Shared Contract Primitives consolidation PR, not before.
- **Older `findForbiddenFields` detector in `read-only-adapter-contract.js` (AUDIT-012).** Explicitly out of PR79-84's domain scope (predates it, not called by any of the audited files). Accepted as a known inconsistency for a future, separate cross-codebase pass.

## 17. Plano de Consolidação

See the companion document `platform/docs/audits/HERMES_AGENT_CORE_CONSOLIDATION_BACKLOG.md` for the full, PR-by-PR breakdown. Summary sequence, ordered by urgency:

1. ~~**Registry Organization Isolation Fix** (fixes AUDIT-002, P1)~~ — **done in PR #86.**
2. ~~**Model Selection Candidate Integrity Fixes** (fixes AUDIT-003, AUDIT-004, both P1)~~ — **done in PR #86** (as two combined fixes, P1-3 and P1-4).
3. ~~**Operational Material Detector Hardening** (fixes AUDIT-001 P1, part of AUDIT-013 P3)~~ — **done in PR #86**, scoped to the P1 bypass classes plus best-effort Unicode homoglyph hardening; AUDIT-006 (missing tokens like `credential`/`webhook`) remains open as a separate, smaller follow-up since it wasn't part of the original P1 finding.
4. **Shared Contract Primitives** (fixes AUDIT-005 P2, AUDIT-008 P2, AUDIT-011 P3, AUDIT-015 P3) — medium; pure-move extraction of already-identical code, low behavioral risk. Still open.
5. **Registry Kernel** (fixes AUDIT-007 P2, part of AUDIT-016 perf) — medium–large; its dependency on item 1 landing first is now satisfied. Still open.
6. **Contract API Consistency** (fixes AUDIT-014 P3) — small, mechanical. Still open.
7. **Test Discovery and Architecture Gates** (fixes AUDIT-009 P2) — small; this audit's own optional architectural test file is a first step toward this. Still open.

## 18. Critérios para Seguir ao Context Assembly Engine

> **Update:** PR #86 was used to fix the four P1 findings themselves (`fix/hermes-critical-architecture-p1`, see `HERMES_AGENT_CORE_AUDIT_FIXES.md`), rather than starting the Context Assembly Engine directly. The criteria below, written at audit time, are preserved as originally stated; all of the "Required" and "Strongly recommended" items are now satisfied.

Before Context Assembly Engine begins:

- **Required:** AUDIT-002, AUDIT-003, AUDIT-004 fixed and tested (all P1, all small, all isolated — no reason to carry known correctness bugs into the next engine layer that will consume `ModelSelectionDecision`/candidate data). — **Done in PR #86.**
- **Strongly recommended:** AUDIT-001 fixed or explicitly risk-accepted with a documented mitigation, since Context Assembly will likely handle more free-form/derived data than the strictly-enumerated contracts audited here, raising the odds of the camelCase bypass actually mattering. — **Done in PR #86.**
- **Not required, but should be scheduled soon after:** the Shared Contract Primitives and Registry Kernel consolidation PRs (§17, items 4–5) — no urgency to block Context Assembly Engine, but the longer they wait, the more the 10–11-file duplication patterns (AUDIT-011, AUDIT-015) will grow by copy-paste into whatever comes next. Still open.
- **No blocker exists for starting the Context Assembly Engine on the current `main`** — there is no P0, the four P1s are now fixed, and the remaining P2/P3 consolidation backlog items are debt-reduction, not correctness blockers.

# Hermes Agent Core — Consolidation Backlog

Derived from `platform/docs/audits/HERMES_AGENT_CORE_ARCHITECTURE_AUDIT_79_84.md`. Each item below is scoped to be a small, independent PR — none require changing a public contract shape, an enum, a decision outcome, or an existing fingerprint. Ordered by recommended sequence, not strictly by severity (a P1 that's more entangled can reasonably follow a P2 that unblocks it — see notes per item).

Every item lists: the findings it resolves, why it's sized the way it is, what must NOT change, and a rough test-impact estimate.

---

## 1. Registry Organization Isolation Fix

**Resolves:** AUDIT-002 (P1)

**Problem:** `agent-registry.js` and `agent-policy-registry.js` have no `organization_id` reassignment check on re-registration — every registry from PR #81 onward (`agent-session-registry.js`, `agent-memory-registry.js`, `model-provider-registry.js`, `model-selection-registry.js`) blocks this with `ORGANIZATION_BLOCKED`; these two silently accept it.

**Scope:** add the same `ORGANIZATION_BLOCKED` reassignment check (compare `existing.organization_id !== payload.organization_id` at the same point the existing `TENANT_BLOCKED` check lives) to both `agent-registry.js` and `agent-policy-registry.js`. Purely additive — a new rejection path for a case that was previously silently accepted. No existing valid registration flow submits a changed `organization_id`, confirmed by grep across `agent-core-contracts.test.js`/`agent-policy-boundary.test.js` — no existing test reassigns organization on re-registration, so nothing currently green should turn red.

**Must not change:** `TENANT_BLOCKED` behavior, registration result shape for any other status, replay/version-conflict semantics.

**Test impact:** add 2 new test cases (one per file) asserting `ORGANIZATION_BLOCKED` on an org-changing re-registration; no existing test should need modification.

**Effort:** S. **Priority:** land first — this is the only P1 sitting in already-shipped, foundational (PR #79/#80) registry code that any future caller could already be relying on the (incorrect) permissive behavior of.

---

## 2. Model Selection Candidate Integrity Fixes

**Resolves:** AUDIT-003, AUDIT-004 (both P1)

**Problem (AUDIT-003):** `model-selection-ranking.js`'s local `isOrderedUniqueStringList` doesn't actually check uniqueness or sort order (unlike the 4 sibling implementations elsewhere), so duplicate `candidate_id`s in `context.candidates` silently produce a ranking where `fallback_candidate_ids` can equal `primary_candidate_id`.

**Problem (AUDIT-004):** `validateModelSelectionCandidate` has no cross-field check between `cost_tier` and `estimated_cost_minor_units`, so a candidate that mis-declares a cheap tier with a high actual cost can out-rank an honestly-priced cheaper candidate.

**Scope:**
- Fix `isOrderedUniqueStringList` in `model-selection-ranking.js` to match the other four implementations (add the `new Set(...).size !== list.length` and sort-order checks). This alone only affects the ranking's own self-validation (`validateModelSelectionRanking`) — it does not change ranking *behavior*.
- Separately, have `model-selection-engine.js` reject (not silently dedupe) a `context.candidates` array containing duplicate `candidate_id`s before building the pool — this is a behavior addition (a previously-silent case now surfaces as a validation failure), so it needs explicit sign-off that "reject on duplicate" (vs. "dedupe by keeping first/last") is the desired semantics. Recommend reject, since silently dropping a caller-supplied candidate is a worse failure mode than telling them their input was malformed.
- Add a cross-field check to `validateModelSelectionCandidate`: `cost_tier === 'ZERO_COST_REFERENCE'` requires `estimated_cost_minor_units === 0`; consider a documented monotonic bound between tier and cost range for the other tiers (needs a small design decision on where the tier boundaries sit — check against `model-pricing-contract.js`'s existing tier semantics from PR #83 for consistency before picking numbers).

**Must not change:** any *currently passing* ranking outcome for non-duplicate, tier-consistent candidates (i.e. every existing fixture scenario in `hermes-model-selection-engine.json` must still resolve to the same `expected_status`) — verify by re-running `model-selection-engine.test.js` unchanged against the fixed code before touching the fixture.

**Test impact:** add duplicate-`candidate_id` and tier/cost-mismatch cases to `model-selection-engine.test.js` and the fixture; all 20 existing scenarios must remain green.

**Effort:** S (ranking fix) + S–M (candidate cross-field check + engine dedup decision). **Priority:** second — both sit directly in the PR #84 engine that PR #86 (Context Assembly Engine) will consume.

---

## 3. Operational Material Detector Hardening

**Resolves:** AUDIT-001 (P1), AUDIT-006 (P2), AUDIT-013 (P3)

**Problem:** camelCase/glued key or value identifiers (`apiKeyValue`, `myapikey`, `myApiKeyIsX`) bypass both the key-segment matcher and the value word-boundary regex entirely (AUDIT-001). The forbidden-token lists are also missing plausible terms (`credential`, `webhook`, `database`/`dsn`, `socket`/`websocket` — AUDIT-006), and Unicode homoglyph/zero-width-character obfuscation bypasses the value pattern (AUDIT-013).

**Scope — needs a design pass, not a quick patch:**
- Extend `keySegments()` in `agent-identity-contract.js` to also split on camelCase boundaries (insert a segment break before each uppercase-following-lowercase transition) before the existing non-alphanumeric split.
- For the value pattern, consider a secondary substring-level scan (without `\b` boundaries) gated by an explicit allowlist of legitimate compounds, to avoid reintroducing the exact false-positive problem PR #83 already fixed once (`transport`/`port`, `require`/`finance-require-approval-policy` — see the audit's dependency history). **This is the highest-risk item in this whole backlog for false-positive regressions** — every one of PR #79–84's 40 contracts must be re-run against the tightened detector before merging, not just the new test cases, since a stricter detector could newly flag a currently-passing fixture.
- Add `credential`/`credentials` and `webhook` to `AGENT_CORE_FORBIDDEN_KEY_TOKENS` — small, additive, same false-positive risk class as above but narrower (only two new tokens).
- Add Unicode NFKC normalization + zero-width-character stripping before pattern matching (lower priority within this item; can be split into its own follow-up if the camelCase fix alone takes a full review cycle).

**Must not change:** any currently-valid contract/fixture must remain valid after the detector is tightened — this is the item's primary acceptance criterion, more important than closing the bypass itself.

**Test impact:** full `npm test` run (all 1113+ tests) must stay green; add explicit bypass-closed test cases (`apiKeyValue`, `myapikey`, homoglyph cases) plus explicit false-positive regression cases for every field name flagged in PR #79–84's own commit history as a prior collision (`secret_material_present`, `runtime_enabled`, `finance-require-approval-policy`-shaped slugs, `model_id`/`provider_id`, etc.).

**Effort:** M. **Priority:** third — real bypass, but latent (no current fixture is camelCase-named), and the false-positive risk means this needs the most careful review of anything in this backlog.

---

## 4. Shared Contract Primitives

**Resolves:** AUDIT-005 (P2), AUDIT-008 (P2), AUDIT-011 (P3), AUDIT-015 (P3)

**Problem:** `agent-identity-contract.js` hosts the shared kernel (`exactFields`, `stableCanonicalize`, `stablePayload`, `deepFreeze`, `cloneFrozen`, `findAgentCoreOperationalMaterial`) under a name that reads as a single-domain contract file, even though all 163 files in scope depend on it purely for the kernel half (AUDIT-005). Separately, `isPlainObject` (in `read-only-adapter-contract.js`, consumed by the kernel) doesn't reject `Map`/`Set`/`RegExp`/`Error`/class instances, causing both a fingerprint-collision risk and an operational-material-detector blind spot from one shared root cause (AUDIT-008). Two helper shapes are independently duplicated across 10–11 files each: `isOrderedUniqueStringList`/`isOrderedUniqueEnumList` (AUDIT-011) and `fingerprint`/`safeFingerprint` (AUDIT-015).

**Scope:**
- Extract the kernel portion of `agent-identity-contract.js` into a new neutral module (suggested name: `agent-core-primitives.js`), re-exported from `agent-identity-contract.js` for backward compatibility so no import site needs to change in this same PR (a pure move + re-export, zero behavioral risk).
- In the same pass, add the extracted `isOrderedUniqueStringList`/`isOrderedUniqueEnumList` and `fingerprint`/`safeFingerprint` helpers to the new neutral module (bodies are already byte-identical across all duplicates — this is a zero-behavior-change extraction), and update the 10–11 duplicate call sites to import instead of locally redefining. **Do this file-by-file with the full test suite green after each one**, not as one giant diff — safest way to catch an accidental behavioral difference between "identical-looking" duplicates that turns out not to be identical (this is exactly how AUDIT-003 happened).
- Fix `isPlainObject` (or add explicit `Date`/`Map`/`Set`/`RegExp`/`Error` rejection alongside the existing `Date` check) in the same neutral module, closing AUDIT-008's two consequences (fingerprint collision + detector blind spot) with one change.

**Must not change:** every existing fingerprint value for every existing fixture (since this touches `stableCanonicalize`'s type-checking, re-verify no currently-valid fixture contains a `Map`/`Set`/`RegExp`/`Error`/class-instance value that would newly start throwing — grep confirms none do today, but re-confirm at implementation time).

**Test impact:** should be entirely internal — no test file needs new assertions unless AUDIT-008's `isPlainObject` fix is bundled in, in which case add a small number of new "rejects Map/Set/RegExp" probe tests.

**Effort:** M. **Priority:** fourth — real duplication risk (as AUDIT-003 already demonstrated), but no active bug beyond what items 1–3 already cover; safe to do carefully rather than urgently.

---

## 5. Registry Kernel

**Resolves:** AUDIT-007 (P2), the registry-listing half of AUDIT-016 (P3, performance)

**Problem:** three different names (`POLICY_CONFLICT`/`SESSION_CONFLICT`/`ITEM_CONFLICT`) exist for the same "ID reused for a different owner" concept across the six registries, and `model-selection-registry.js`'s candidate store has no `extraConflictCheck` wired up despite reusing the same `createEntityStore`-shaped factory pattern `model-provider-registry.js` already established with one.

**Scope:** standardize on `ITEM_CONFLICT` (already used by 2 of 6, reads domain-neutral) across all six; wire an `extraConflictCheck` into `model-selection-registry.js`'s candidate store (e.g. blocking `provider_id`/`model_id` reassignment under an existing `candidate_id`, mirroring `model-provider-registry.js`'s `provider_id`-reassignment check). Optionally (separate sub-item, can slip to a follow-up): fold `agent-memory-registry.js` into the shared `createEntityStore` factory now used by `model-provider-registry.js`/`model-selection-registry.js`, since it's structurally the closest fit among the remaining three.

**Depends on:** Item 1 (Registry Organization Isolation Fix) landing first — folding `agent-registry.js`/`agent-policy-registry.js` into any shared kernel before their organization-isolation gap is fixed would propagate that gap into the kernel itself, per the audit's explicit recommendation.

**Must not change:** any existing registration result's `status` string for currently-passing test cases other than the deliberate `POLICY_CONFLICT`/`SESSION_CONFLICT` → `ITEM_CONFLICT` rename (which IS a public-API-shape change for those two registries' error responses — flag this explicitly to whoever reviews, since the audit's parent PR (#85) is not allowed to make this change itself, only recommend it).

**Test impact:** update any test asserting the literal string `POLICY_CONFLICT`/`SESSION_CONFLICT` to expect `ITEM_CONFLICT` instead; add a new test for the model-selection-registry candidate cross-field conflict.

**Effort:** M–L (touches 4+ files and their tests; the optional `agent-memory-registry.js` kernel-fold sub-item adds more). **Priority:** fifth.

---

## 6. Contract API Consistency

**Resolves:** AUDIT-014 (P3)

**Problem:** `agent-policy-audit.js`, `agent-session-audit.js`, `agent-memory-audit.js`, `model-provider-audit.js` declare `X_AUDIT_VERSION` instead of the `X_AUDIT_VALIDATOR_VERSION` pattern every other validator-version constant in the codebase (including `model-selection-audit.js`, the newest) uses.

**Scope:** rename the 4 constants (and their literal string values, since nothing external depends on the old value — confirm via grep before renaming) to match the established pattern.

**Must not change:** the constants are self-referential (each file only checks its own constant against itself) — confirmed no cross-file comparison exists, so this is a purely mechanical, low-risk rename.

**Test impact:** none expected beyond the existing tests continuing to pass unchanged (they reference the constant by import, not by literal string, in every case checked).

**Effort:** S. **Priority:** sixth — purely cosmetic, safe to do whenever convenient.

---

## 7. Test Discovery and Architecture Gates

**Resolves:** AUDIT-009 (P2)

**Problem:** `package.json`'s `test` script is a manually-maintained, space-separated file list with no automated check that it stays in sync with `test/*.test.js` on disk. This exact manual step has been performed correctly 6 times in a row (once per PR #79–84) by hand, with no safety net if it's ever missed.

**Scope:** two options, pick one after evaluating compatibility (per the audit prompt's explicit caution — "avaliar substituição futura ... mas não mudar nesta PR sem evidência de que é totalmente compatível," already respected in PR #85 by not doing this):
  - (a) Replace the manual list with `node --test test/*.test.js` (glob-based discovery) — verify first that Node's test runner glob behavior on this exact toolchain/OS (Windows, PowerShell/Git Bash mixed environment per this project's tooling) doesn't silently miss or duplicate files, and that ordering doesn't matter for any test (no test currently should depend on execution order — confirmed by the audit's Section 10, but re-verify explicitly with the glob before switching).
  - (b) Keep the manual list but add a small CI/lint check (`scripts/verify-test-registration.js` or similar) that asserts every `test/*.test.js` file on disk appears in `package.json`'s script, failing CI loudly instead of silently skipping.

Recommend starting with (b) — strictly additive, cannot change what currently runs, closes the "silently forgotten" risk immediately — and evaluating (a) as a separate, later follow-up once (b) has had a chance to prove there's no discovery-order dependency lurking.

**This audit's own optional architectural test file** (`platform/services/api/test/agent-core-architecture-audit.test.js`, added in this PR if included) is a natural first building block for option (b) — it already exercises some of the "expected exports present" and "no forbidden imports" checks a future gate would want.

**Must not change:** which tests currently run — option (b) only adds a new failure mode for a currently-impossible-to-detect class of mistake; option (a), if chosen later, must be proven behaviorally identical before switching.

**Test impact:** adds one new small check/script; no existing test file changes.

**Effort:** S. **Priority:** seventh — lowest urgency of the P1/P2 items, but cheap and worth doing soon given the manual step's 6-PR track record of "so far, so good" is exactly the kind of streak that eventually breaks.

---

## Sequencing rationale (why this order, not pure severity order)

Items 1–2 are P1s sitting in code that's either already shipped to `main` and could already have real callers relying on its (wrong) permissive behavior (item 1), or sits directly beneath the very next planned PR (#86, Context Assembly Engine — item 2). Item 3 is also P1 but is deliberately sequenced after 1–2 because it carries the highest false-positive-regression risk in the whole backlog and needs the most careful review — rushing it ahead of the two more contained, lower-risk P1 fixes would be the wrong tradeoff. Items 4–7 are consolidation/quality work with no currently-active bug; sequenced by dependency (5 depends on 1) and by how much duplication risk they carry the longer they wait (4's duplicated helpers already caused a real bug — item 2's AUDIT-003 — so it's positioned ahead of the purely-cosmetic items 6–7).

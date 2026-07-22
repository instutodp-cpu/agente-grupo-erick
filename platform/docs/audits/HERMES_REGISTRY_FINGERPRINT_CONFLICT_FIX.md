# Hermes Agent Core — Registry Fingerprint Conflict Consistency

Companion to `platform/docs/audits/HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md`. This PR fixes exclusively the `CAND-REG-01` finding from the PR #90 audit. No new functionality, no registry kernel, no helper extraction, no renaming, no change to the operational-material detector, Model Selection Engine, Context Assembly Engine, Tool Contracts, or Workflow Contracts, and no change to any existing fingerprint computation.

## Achado Original

`HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md` §7/§16, `CAND-REG-01` (P2): `agent-registry.js` (PR #79) and `agent-policy-registry.js` (PR #80) — the two oldest registries — had no `FINGERPRINT_CONFLICT` status and never checked an `options.expected_fingerprint` guard, unlike all 7 later registries (`agent-session-registry.js` onward through `workflow-registry.js`), which all independently implement the identical `resolveRegistration`-style check: `if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) return { ok: false, status: 'FINGERPRINT_CONFLICT', ... }`. This is a distinct, still-open asymmetry from the `ORGANIZATION_BLOCKED` gap the same two files had, which PR #86 already fixed.

## Impacto

An Orchestrator (or any caller) that uniformly passes `expected_fingerprint` as an optimistic-concurrency guard when registering into any of the 9 registries would silently get no protection for Agent Core / Agent Policy registrations — the option was accepted without error but had no effect, since neither registry read it. This is not a security bypass (both registries still correctly enforce replay/payload-mismatch/version-conflict/tenant/organization isolation), but it is a real behavioral gap that would surprise a caller who assumed `expected_fingerprint` behaves the same way across all 9 domains.

## Semântica Adotada

Both files now implement the exact same check present in every registry from `agent-session-registry.js` onward, reusing the established `resolveRegistration` semantics inline (no shared helper extracted — this PR does not build a registry kernel, per its own scope restriction):

```js
if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
  return safe({ ok: false, status: 'FINGERPRINT_CONFLICT', errors: [...] });
}
```

`FINGERPRINT_CONFLICT` was added to `AGENT_REGISTRY_STATUSES` and `AGENT_POLICY_REGISTRY_STATUSES`. `agent-policy-registry.js` applies the identical check twice — once in `registerPolicy`, once in `registerRule` — since the file stores both entity types, each with its own independent fingerprint.

A rejected `FINGERPRINT_CONFLICT` never mutates the stored record — the registry stays at its last successfully-registered version and fingerprint, verified directly (not assumed) by new tests that re-fetch the record after a rejected conflict and assert its version/content is unchanged.

## Precedência dos Conflitos

The audit spec proposed an illustrative order (validation → tenant → organization → expected version → expected fingerprint → replay → payload mismatch → accepted), but explicitly instructed: *"Não inventar uma ordem diferente se o padrão consolidado no código atual já definir outra. Nesse caso, seguir o padrão real e documentá-lo."* The real, consolidated order already implemented identically across all 7 later registries (confirmed by reading `model-selection-registry.js`'s `resolveRegistration`, the pattern's clearest reference implementation) is:

1. validation failure (`VALIDATION_FAILED`, checked before any registry lookup)
2. tenant mismatch (`TENANT_BLOCKED`)
3. organization mismatch (`ORGANIZATION_BLOCKED`)
4. replay — identical fingerprint (`REPLAY_ACCEPTED`)
5. payload mismatch — same version, different fingerprint (`PAYLOAD_MISMATCH`)
6. expected version conflict — optimistic concurrency (`VERSION_CONFLICT`)
7. expected fingerprint conflict (`FINGERPRINT_CONFLICT`)
8. version downgrade (`VERSION_CONFLICT`)
9. registro aceito em simulação (`REGISTERED_SIMULATION`)

Replay is checked **before** payload mismatch, and expected-version conflict is checked **before** expected-fingerprint conflict — this is the real precedence in every one of the 7 later registries, not the spec's illustrative ordering, and this PR follows it. `agent-registry.js` and `agent-policy-registry.js` previously had tenant/organization checks positioned **after** replay/payload-mismatch/version-conflict (the inverse of the consolidated order) — this PR reorders them to match steps 2–3 above, ahead of steps 4–8. This reordering has no observable behavioral effect on any existing valid/invalid input: a genuine tenant or organization reassignment necessarily changes the fingerprinted payload (`tenant_id`/`organization_id` are part of the canonicalized contract/policy), so no input that previously reached `REPLAY_ACCEPTED`/`PAYLOAD_MISMATCH`/`VERSION_CONFLICT` before the tenant/organization checks could have been a genuine reassignment attempt — confirmed by the full pre-existing test suite passing unchanged after the reorder, plus the new tests explicitly asserting that a tenant/organization change is now correctly rejected *before* an accompanying (deliberately mismatched) `expected_fingerprint` value is even considered.

## Arquivos Alterados

| File | Change |
|---|---|
| `platform/services/api/src/core/agent-registry.js` | Added `FINGERPRINT_CONFLICT` to `AGENT_REGISTRY_STATUSES`; reordered the `existing`-record branch of `registerAgentContract` to check tenant/organization before replay/payload/version (matching the consolidated pattern); added the `expected_fingerprint` check between `VERSION_CONFLICT` (optimistic) and `VERSION_CONFLICT` (downgrade) |
| `platform/services/api/src/core/agent-policy-registry.js` | Added `FINGERPRINT_CONFLICT` to `AGENT_POLICY_REGISTRY_STATUSES`; same reorder + fingerprint check in `registerPolicy`; same fingerprint check added to `registerRule` (rules have no tenant/organization field of their own, so no reorder was needed there) |
| `platform/services/api/test/agent-core-contracts.test.js` | One new test covering `FINGERPRINT_CONFLICT` (correct/incorrect `expected_fingerprint`, record unchanged after a rejected conflict, replay/payload-mismatch/version-conflict/tenant/organization checks all still function and take precedence) |
| `platform/services/api/test/agent-policy-boundary.test.js` | Same coverage for both `registerPolicy` and `registerRule` |
| `platform/docs/audits/HERMES_INTEGRATION_ARCHITECTURE_AUDIT_79_89.md` | `CAND-REG-01` marked resolved (report body otherwise unchanged) |
| `platform/docs/audits/HERMES_AGENT_ORCHESTRATOR_READINESS.md` | The `CAND-REG-01` asymmetry note in §1 marked resolved |

## Testes Adicionados

Two new tests (one per file), each covering: expected fingerprint correct (accepted), expected fingerprint incorrect (`FINGERPRINT_CONFLICT`, frozen result, correct safe flags), replay idempotent (`REPLAY_ACCEPTED`, still works), same-id-same-version-different-payload (`PAYLOAD_MISMATCH`, still works), stale `expected_version` (`VERSION_CONFLICT`, still works), tenant mismatch (`TENANT_BLOCKED`, takes precedence over a simultaneously-supplied wrong `expected_fingerprint`), organization mismatch (`ORGANIZATION_BLOCKED`, same precedence), organization/tenant rebinding attempts confirmed to never mutate the stored record, and — for the policy registry — the identical set of checks repeated for `registerRule`. Net: **+2 tests** (1303 → 1305).

## Compatibilidade

- No public contract field, enum value beyond the additive `FINGERPRINT_CONFLICT` status, or exported function signature was removed or renamed.
- `FINGERPRINT_CONFLICT` is purely additive to both status enums — no existing caller could previously receive this status, so nothing that worked before can now fail differently; a caller that never passes `expected_fingerprint` sees no behavior change at all.
- The tenant/organization-check reordering has no observable effect on any existing valid or invalid input, per the precedence analysis above, and is confirmed by the complete pre-existing test suite passing unchanged.
- `node --check` passes on both changed files. Full `npm test`: **1305/1305 passing**, zero regressions across PRs #79–#90 and the transcription boundaries. The PR #85 architectural test (`agent-core-architecture-audit.test.js`, 11 tests) and the PR #90 architectural/end-to-end test (`hermes-integration-architecture-audit.test.js`, 20 tests) both pass unchanged.
- No registry other than `agent-registry.js`/`agent-policy-registry.js` was touched. No production runtime file was touched.

## Limitações

- `CAND-REG-02` (4 newer registries lack `extraConflictCheck` support) and `CAND-REG-03` (two different "list by organization" calling conventions across registry generations) remain open — out of scope for this PR, which fixes only `CAND-REG-01`.
- This fix does not build a shared registry kernel or extract a common `resolveRegistration` helper, per its own scope restriction — the two files still contain independent, hand-written implementations of the same semantics as the other 7 registries. A future Registry Kernel consolidation (already tracked in the PR85 audit backlog) remains the right place to deduplicate this.
- `agent-registry.js`'s slug-uniqueness side-index (`idBySlug`) and `agent-policy-registry.js`'s `POLICY_CONFLICT` dangling-rule check are unique to these two files and were left untouched — they are unrelated to `CAND-REG-01`.

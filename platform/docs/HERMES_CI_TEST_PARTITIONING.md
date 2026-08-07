# Hermes CI: test partitioning, concurrency, and the required check

This document explains how `.github/workflows/hermes-core-smoke.yml` splits the test suite
across parallel jobs, and the guarantees behind that split. It exists because the CI
optimization PR (`ci(agent-core): eliminate duplicate tests and parallelize Hermes CI`)
changed *how* the suite runs without changing *what* it covers, and that guarantee needs to
be documented somewhere other than the workflow YAML itself.

## Problem this solves

Before this change, the workflow ran 8 of the heaviest test files twice per CI run: once in
their own dedicated step (`node --test test/<file>.test.js` or `npm run test:runtime-*`),
and again inside the final `npm test` step, which discovers and runs every `test/*.test.js`
file unconditionally. Those 8 files alone accounted for roughly 62.7 of the ~99.6 minutes of
total wall-clock time on the last fully-measured run before this change; `npm test` itself
added another ~35.8 minutes re-running all 90 files, including those same 8. There was also
no `concurrency` configuration, so pushing a new commit to an in-flight PR left the previous
(now-obsolete) run going to completion instead of being cancelled -- observed directly during
PR #110's own review, where two full ~100-minute runs ran back-to-back for the same PR.

## The canonical manifest

`platform/services/api/scripts/ci-test-groups.js` is the single source of truth for which
test files belong to which CI job. It exports:

- `GROUPS` -- an object mapping a job name (`fast-gates`, `runtime-contracts`,
  `readiness-admission`, `scheduler`, `worker-assignment`, `queue-admission`,
  `queue-materialization`, `queue-placement`) to the exact `test/<file>.test.js` path(s) that
  job runs. These are the same 8 files/groups that previously ran twice.
- `getResidualFiles()` -- every file `discoverTestFiles()` (from `scripts/discover-tests.js`)
  finds that is **not** named in `GROUPS`. This runs in its own `residual-suite` job via
  `npm run test:ci:residual` (`scripts/run-residual-tests.js`).
- `validatePartition()` -- checks that every file named in `GROUPS` still exists on disk,
  that no file is claimed by two groups, and that the union of `GROUPS` and the residual set
  is exactly equal to the full discovered suite. Both the residual runner and the meta-test
  below call this and fail closed if it doesn't hold.

**Every discovered test file now runs in exactly one CI job.** Nothing runs twice; nothing is
silently dropped.

### Why unclassified files fall into "residual" instead of failing the build

`scripts/discover-tests.js` was itself built (PR #100 era) specifically so that a new test
file is *always* picked up automatically -- its own header comment describes the incident
this was meant to prevent: a 87-test file that had silently never run under `npm test` because
a hand-maintained file list had drifted. `ci-test-groups.js` deliberately continues that
contract: a new test file that nobody has classified into a named group does not fail CI or
get skipped -- it simply runs inside `residual-suite`, the same as roughly 80 other files
already do. This is not a new fallback invented for this PR; it's the project's existing
open-discovery contract, reused at the group level. `test/ci-test-group-partition.test.js`
is the proof that this reuse is sound: it fails if the manifest and the real `test/`
directory ever disagree (a rename, a deletion, a duplicate group entry), which is the one way
this design *could* silently go wrong.

## Jobs and the required check

The workflow has 10 jobs: `fast-gates`, `runtime-contracts`, `readiness-admission`,
`scheduler`, `worker-assignment`, `queue-admission`, `queue-materialization`,
`queue-placement`, `residual-suite`, and `docker-e2e` -- all independent, all running in
parallel on their own runner. A final `hermes-required-ci` job depends on all 10 via `needs:`
and fails if any of them failed, was cancelled, or was skipped; it succeeds only when every
one of them succeeded.

**Branch protection should require only `Hermes Required CI`.** Adding, removing, or
renaming a group only ever means editing the `needs:` list in that one job -- never touching
the repository's branch protection settings.

## Concurrency

```yaml
concurrency:
  group: hermes-ci-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

Pushing a new commit to a PR cancels whatever run is still in flight for that same PR --
only the latest commit's result is ever kept. The group key falls back to `github.ref` for
the `push` (post-merge, `main`) trigger, which is a different key from any PR's group, so a
merge to `main` never cancels an unrelated PR's run, and different PRs never cancel each
other.

## What did not change

- `npm test` (local, full suite) still delegates to `scripts/discover-tests.js` and runs
  every test file, undivided -- exactly as before this PR.
- Every individual test file, its assertions, its fixtures, and its expected outcomes are
  unchanged. This PR touches only CI orchestration: the workflow, `scripts/ci-test-groups.js`,
  `scripts/run-residual-tests.js`, the new partition meta-test, and this document.
- Architecture gates, fingerprints, contracts, and simulation boundaries are untouched.

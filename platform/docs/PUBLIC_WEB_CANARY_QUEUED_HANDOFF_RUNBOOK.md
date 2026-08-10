# Public Web Canary Queued Simulation Handoff Runbook

## Purpose

This runbook defines the safe operating procedure for the Hermes Public Web
Canary queued simulation handoff.

The handoff proves that the existing Public Web Canary capability can move
through the Hermes runtime pipeline and produce a deterministic, auditable,
simulation-only result. It does not execute a real canary and does not authorize
production behavior.

## Current State

- The handoff is simulation-only.
- It does not execute a real canary.
- It does not call a real provider.
- It does not use real network access.
- It does not resolve secrets.
- `production_effect` must remain `ZERO`.
- Any real canary requires explicit future authorization in a separate
  checkpoint.

## Operational Flow

The expected simulated path is:

1. Runtime contracts remain simulation-only and fail-closed.
2. Readiness / Admission confirms the request can be considered in simulation.
3. Queue Admission prepares the queue admission package.
4. Queue Materialization prepares the queue materialization package.
5. Queue Placement prepares the queue placement package.
6. Scheduler preserves the declarative execution order.
7. Worker Assignment recommends a simulated worker reference.
8. Dispatch prepares a simulated dispatch package.
9. Public Web Canary queued simulation handoff consumes the prepared envelope.
10. The handoff returns structured evidence and audit data.
11. CI and post-merge audit confirm that no real operation occurred.

The handoff must consume work already prepared by Hermes. It must not bypass
Admission, Materialization, Placement, Worker Assignment, or Dispatch.

## Preconditions

Before creating or reviewing a PR that touches this area, confirm:

- The branch and HEAD are the expected ones for the checkpoint.
- `origin/main` is known and the branch is based on the intended main SHA.
- The working tree has no tracked or staged changes outside the checkpoint.
- Any untracked environmental report file is identified and remains outside Git.
- CI for the target SHA is green before merge.
- The diff has no production code changes.
- The diff has no workflow changes.
- The diff has no package or lockfile changes.
- No provider, network, secret, or runtime production path is enabled.
- No fingerprint, digest, package ID, or contract field changes outside scope.

## Guardrails

Expected handoff and result flags:

- `simulation_mode=true`
- `production_blocked=true`
- `runtime_enabled=false` when present
- `executed=false` for the real canary
- `real_provider_called=false`
- `network_used=false`
- `secret_resolved=false`

Expected identity and audit preservation:

- `request_id` is preserved when applicable.
- `correlation_id` is preserved when applicable.
- `trace_id` is preserved when applicable.
- Package IDs remain bound to their upstream Hermes packages.
- Fingerprints and digests remain deterministic.
- Evidence records the simulated canary result without raw provider output,
  secrets, headers, cookies, full URLs, or executable payloads.

## Decision Matrix

| Decision | Condition | Permitted action | Prohibited action | Required evidence |
| --- | --- | --- | --- | --- |
| `PASS_LOCAL_VALIDATION` | Focused canary and documentation checks pass | Prepare PR scope review | Treat local pass as merge approval | Test output and clean diff |
| `READY_FOR_REVIEW` | Draft PR has correct scope and CI is green | Mark PR ready for review | Merge without final audit | PR file list, checks, HEAD SHA |
| `READY_FOR_MERGE` | Final pre-merge audit passes | Request explicit merge authorization | Enable auto-merge or deploy | Required checks success on exact SHA |
| `POST_MERGE_CI_GREEN` | Main push CI completes successfully | Close checkpoint and review branch cleanup | Run real canary automatically | Main SHA, run ID, job conclusions |
| `STOP_ON_DIRTY_STATE` | Tracked or staged changes are unexpected | Stop and report | Stage, commit, or clean blindly | `git status --short` and diff summary |
| `STOP_ON_PRODUCTION_EFFECT` | Any path enables production behavior | Stop and report | Continue implementation | Diff and guardrail failure |
| `STOP_ON_REAL_CANARY_REQUEST` | A real canary would be executed | Stop and require separate authorization | Run canary from this checkpoint | Explicit human authorization is absent |
| `STOP_ON_WORKFLOW_CHANGE` | CI workflow changes appear unexpectedly | Stop and report | Hide workflow changes in docs PR | PR file list and diff |
| `STOP_ON_PACKAGE_LOCK_CHANGE` | Package or lockfile changes appear | Stop and report | Commit dependency churn | PR file list and diff |
| `STOP_ON_UNEXPECTED_DIFF` | Any non-doc file changes in docs checkpoint | Stop and report | Commit mixed scope | `git diff --name-status` |
| `STOP_ON_MISSING_EVIDENCE` | CI, scope, or identity cannot be proven | Stop and gather evidence | Infer success | GitHub PR/check data |

## Pre-PR Checklist

- Confirm branch name and base SHA.
- Confirm tracked/staged changes are limited to the intended documentation.
- Confirm untracked environmental files remain outside Git.
- Confirm `src/**` is unchanged.
- Confirm `platform/services/api/test/**` is unchanged.
- Confirm workflows are unchanged.
- Confirm package and lockfiles are unchanged.
- Confirm no secrets, URLs with credentials, tokens, headers, cookies, or local
  config values were added.
- Run `git diff --check`.
- If a lightweight docs check exists and does not mutate lockfiles, run it.

## Pre-Merge Checklist

- Confirm PR state is open and not draft when ready for final review.
- Confirm base branch is `main`.
- Confirm head SHA is exactly the SHA that passed CI.
- Confirm mergeability is clean.
- Confirm all required checks completed successfully.
- Confirm no check is pending, failed, cancelled, skipped unexpectedly, or stale.
- Confirm the remote diff still contains only the approved documentation files.
- Confirm `production_effect=ZERO`.
- Confirm no real canary, provider, network, deploy, or secret resolution ran.

## Post-Merge Checklist

- Confirm the PR is merged.
- Confirm `origin/main` advanced to the merge or squash SHA.
- Confirm the integrated diff matches the approved documentation scope.
- Confirm the post-merge CI run on `main` is green.
- Confirm the local working tree has zero tracked and staged changes.
- Confirm environmental untracked files remain outside Git.
- Confirm branch cleanup only after a separate safety review.
- Confirm no real canary was executed as part of merge or post-merge audit.

## Abort Conditions

Stop immediately if any of these conditions appear:

- Tracked or staged changes are unexpected.
- Any `src/**` file changes.
- Any test helper or runtime test changes in this docs checkpoint.
- Any GitHub Actions workflow changes.
- Any package or lockfile changes.
- Any production flag is enabled.
- Any real provider can be called.
- Any real network path is introduced.
- Any secret can be resolved.
- Any canary real execution is requested without explicit separate
  authorization.
- Any fingerprint, digest, or contract change is needed.
- CI identity cannot be tied to the exact PR HEAD SHA.
- Required checks are missing, pending, failed, cancelled, stale, or skipped
  unexpectedly.

## Expected Status Examples

Expected text statuses for checkpoint reports:

- `LOCAL_VALIDATION_PASS`
- `READY_FOR_REVIEW`
- `READY_FOR_MERGE`
- `POST_MERGE_CI_GREEN`
- `CHECKPOINT_CLOSED_AND_BRANCH_CLEANED`
- `STOP_AFTER_RUNBOOK_UPDATE`

These labels are reporting states only. They do not execute, deploy, or approve
a real canary.

## Non-Goals

This runbook does not:

- implement a real canary;
- change runtime behavior;
- change CI workflows;
- change package dependencies;
- change production contracts;
- optimize performance;
- execute a provider;
- enable network access;
- resolve secrets;
- replace human authorization;
- authorize production.

## Related References

- `platform/docs/PUBLIC_WEB_CANARY_OPERATIONAL_TRIAL.md`
- `platform/docs/PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md`
- `platform/docs/HERMES_RUNTIME_DISPATCH_SIMULATION_CONTRACTS.md`
- `platform/docs/HERMES_RUNTIME_QUEUE_ADMISSION_SIMULATION_CONTRACTS.md`
- `platform/docs/HERMES_RUNTIME_QUEUE_MATERIALIZATION_SIMULATION_CONTRACTS.md`
- `platform/docs/HERMES_RUNTIME_QUEUE_PLACEMENT_SIMULATION_CONTRACTS.md`
- `platform/docs/HERMES_RUNTIME_WORKER_ASSIGNMENT_SIMULATION_CONTRACTS.md`
- `platform/services/api/test/public-web-canary-queued-simulation-handoff.test.js`

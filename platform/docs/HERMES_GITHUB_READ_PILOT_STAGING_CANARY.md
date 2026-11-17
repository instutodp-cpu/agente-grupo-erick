# Hermes GitHub Read Pilot — Controlled Staging Canary

Status: `staging-only`, `read-only`, `fail-closed`, `production-blocked`

Checkpoint: `PR-D4-H05R`

This document is a proposal for a separately approved staging canary. It is not
authorization to merge, deploy, access a provider, read private data, or change
permissions.

## 1. Boundary

This checkpoint is separate from the observation profile. Do not add the
read-pilot to `docker-compose.observation.yml`; that profile must remain
dependency-free and must not contain provider configuration.

The canary may contain only the GitHub read-pilot runtime. It must not perform
writes, mutations, messages, issue changes, pull request changes, repository
administration, execution, mission ingress, Supabase access, database access,
cache access, or generic tool discovery.

Required runtime gates:

- `HERMES_DEPLOYMENT_STAGE=staging`;
- `HERMES_EXECUTION_ENABLED=false`;
- `HERMES_EXECUTION_KILL_SWITCH=true`;
- `HERMES_MISSION_INGRESS_ENABLED=false`;
- `HERMES_GITHUB_READ_PILOT_ENABLED=true` only during an explicitly approved
  read-only canary window;
- loopback binding on `127.0.0.1` only;
- no public port, reverse proxy, tunnel, webhook, or external ingress.

No Supabase project, real database, private repository data, secret contents,
token values, or raw provider payload may be copied into evidence.

## 2. Preconditions

Before any operator starts the canary, the approval record must contain:

- the exact Git commit and image digest;
- confirmation that the target is staging and not production;
- a named reviewer and rollback owner;
- the start and end of the observation window;
- confirmation that only read-only GitHub access is in scope;
- the allowed repository scope and maximum request budget;
- a redacted evidence destination.

If any item is missing, stop.

The active runtime must remain untouched while the candidate is validated. The
candidate must be built from a clean detached checkout; do not use a mutable
worktree mount as the application directory.

## 3. Candidate image acceptance

These commands are documentary acceptance checks. They use synthetic inputs and
must not mount credentials or use a real provider call.

The image must contain the read-pilot entrypoint:

```bash
docker run --rm --network none --entrypoint sh IMAGE \
  -c 'test -f /app/scripts/run-hermes-github-read-pilot.js'
```

The entrypoint must parse:

```bash
docker run --rm --network none --entrypoint node IMAGE \
  --check /app/scripts/run-hermes-github-read-pilot.js
```

The disabled path must fail closed:

```bash
docker run --rm --network none \
  -e HERMES_GITHUB_READ_PILOT_ENABLED=false \
  --entrypoint node IMAGE /app/scripts/run-hermes-github-read-pilot.js
```

The expected result is a non-zero exit containing
`pilot_explicitly_disabled`. Any listener or successful startup in this test
is a failure.

## 4. Canary procedure

This section remains documentary until the preconditions are approved.

1. Start one candidate container with the approved immutable image and
   loopback-only port.
2. Keep execution disabled, the kill switch active, and mission ingress
   disabled.
3. Check local health and the protected read-pilot route with synthetic
   requests only.
4. Confirm that missing authentication is rejected and that unsupported
   methods are rejected.
5. Do not send a GitHub request in this checkpoint. A future real read requires
   a new explicit checkpoint covering data minimization, repository scope,
   rate-limit budget, retention, and reviewer approval.
6. Stop immediately on any public bind, write-capable route, unexpected provider
   request, raw payload, secret, private data, tenant inference, or execution
   signal.

The current service is not replaced by this document. There is no automatic
merge, deploy, restart, or permission change.

## 5. Evidence and rollback

Keep only redacted evidence: commit, image digest, gate values, bind address,
health result, route status, timestamps, and boolean safety outcomes. Never
retain authorization headers, tokens, cookies, private keys, request bodies,
raw URLs, provider payloads, message text, or stack traces.

Rollback means stopping and removing only the named candidate container. Do not
run global Docker cleanup, remove unrelated containers, erase audit files, or
change firewall rules.

## 6. Exit criteria

The checkpoint closes only when:

- the candidate is stopped or the window end is recorded;
- the active runtime remains unchanged;
- no unexpected candidate container remains;
- evidence is redacted and reviewed;
- the exact commit and image digest are recorded;
- deviations are recorded as a separate incident or checkpoint.

Until those conditions and a separate approval are complete, the required state
is `STOP`.

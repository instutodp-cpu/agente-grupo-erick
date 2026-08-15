# Hermes VPS Staging Installation Runbook

Status: `staging-only`, `observability-only`, `production-blocked`

Checkpoint: `PR-D4-H04D`

Approved revision: `30aceb8da0789222fde0200b6d2529f118895a81`

This is a documentary runbook. It describes a future installation of the
Hermes Observation profile on an isolated staging VPS; it does not authorize
or perform installation, server access, secret creation, provider setup,
database setup, deployment, or production publication.

## 0. Non-negotiable boundary

The only allowed composition for this runbook is
`platform/docker-compose.observation.yml` with the `observation` profile.
The profile is deliberately narrow:

- staging-only, observation-only, and production-blocked;
- `HERMES_EXECUTION_ENABLED=false`;
- `HERMES_EXECUTION_KILL_SWITCH=true`;
- API bound to `127.0.0.1` only;
- no Postgres, Redis, Qdrant, provider, gateway, webhook, queue, worker, or
  durable observation store;
- no real provider, credential, token, secret, or external service
  configuration;
- no mandatory database or cache;
- no authentication enforcement change;
- no Confirmation v3, Confirmation storage, or Confirmation policy change;
- no tenant inference and no authorization for H02.

The profile does not execute real actions. A local `/message` smoke request is
synthetic route exercise only; it does not resolve a real caller, establish
identity, authorize a tenant, or authorize execution. A real-caller observation
window requires a separate, explicit checkpoint.

Do not convert this runbook into a production procedure. Do not add a public
listener, reverse proxy, tunnel, webhook, provider, credential, database,
cache, migration, authentication policy, Confirmation behavior, or execution
flag change under this checkpoint.

## 1. Preconditions and authorization

Nothing in this section is being performed by this checkpoint. Before a human
operator may execute the procedure, the change owner must record all of the
following in the approval ticket:

- the exact VPS IP address or host name;
- the SSH user name and confirmation that it is non-root with `sudo`;
- confirmation that the target is staging and is not production;
- confirmation that the requested purpose is observation only;
- authorization to install Docker Engine and the Docker Compose Plugin;
- authorization to clone the repository and checkout the approved revision;
- authorization to start only the observation profile;
- the start and end of the observation window;
- the person responsible for reviewing redacted logs;
- the stop/rollback owner and the evidence-retention location.

If any item is missing, stop. This document alone is not an authorization to
access a VPS.

## 2. VPS prerequisites

The target should be a dedicated or otherwise isolated Ubuntu LTS VPS. Ubuntu
24.04 LTS or a newer LTS supported by the selected Docker release is
recommended. Confirm the following before installation:

- 64-bit Ubuntu LTS with enough disk, memory, and CPU for one small API
  container and its build cache;
- a named non-root operator account with `sudo`; do not use a root login;
- SSH key authentication tested from the approved operator workstation;
- host firewall active before Docker is installed;
- only the minimum inbound port, SSH, permitted from approved administrative
  source addresses;
- no inbound API port rule; the API remains local to the VPS;
- Docker Engine and the Docker Compose Plugin available from the official
  Docker repository;
- Git installed;
- a documented timezone. UTC is recommended for evidence correlation.

The repository must contain no credentials or secret material. Do not copy an
`.env` file, provider configuration, database URL, cache URL, private key, or
token to the VPS. The observation compose file is intentionally self-contained
and must not be supplemented with an environment file.

### 2.1 Host preparation (documentary commands)

Run these only during an approved installation window on the approved staging
VPS:

```bash
sudo apt-get update
sudo apt-get -y upgrade
sudo apt-get install -y ca-certificates curl git gnupg ufw
sudo timedatectl set-timezone UTC
timedatectl status
```

If the project explicitly approves another timezone, record that choice in the
ticket before replacing `UTC`.

## 3. Security model and firewall

The network boundary is part of the staging safety model. Docker-published
ports can interact with host firewall behavior, so verify the bind address and
the host firewall after Compose validation. The required policy is:

- allow SSH only, preferably restricted to the approved administrative source;
- deny other inbound traffic by default;
- do not allow TCP `8080` from the network;
- do not expose the API through a public IP, DNS name, tunnel, or reverse
  proxy;
- keep the Compose port mapping on `127.0.0.1`, never `0.0.0.0`;
- if a future tunnel or reverse proxy is desired, stop and open a separate
  checkpoint covering its host, TLS, authentication, firewall, and rollback.

Documentary UFW example:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw --force enable
sudo ufw status verbose
```

Do not add an API-port allow rule. Confirm the effective Docker mapping before
starting the container:

```bash
docker compose -f docker-compose.observation.yml config
docker compose -f docker-compose.observation.yml config | grep -F '127.0.0.1:'
```

The second command must show the local bind. If it does not, stop.

## 4. Base installation

The following commands are an execution plan only. They are not run by
`PR-D4-H04D`.

### 4.1 Docker Engine and Compose Plugin

Use the official Docker apt repository and install the Compose Plugin, not the
legacy standalone Compose binary:

```bash
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<'DOCKER_SOURCES'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
DOCKER_SOURCES

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo systemctl is-enabled docker
sudo systemctl is-active docker
docker --version
docker compose version
```

The `Suites` and `Architectures` values above are examples for an approved
Ubuntu Noble amd64 VPS. Resolve them against the actual approved LTS and
architecture before execution; do not blindly apply them to another host.
Do not run a convenience installer or install an unapproved package source.

If the operator is granted Docker group access, that authorization must be
separately reviewed because Docker group membership is effectively privileged.
Using `sudo docker ...` is acceptable for the documented procedure.

### 4.2 Repository and approved revision

Use the repository URL approved in the ticket. The placeholder below is not a
production host and must be replaced only during an approved window:

```bash
export HERMES_REPO_URL='<approved repository URL>'
export HERMES_APPROVED_COMMIT='30aceb8da0789222fde0200b6d2529f118895a81'

git clone --no-tags "$HERMES_REPO_URL" hermes
cd hermes
git fetch --no-tags origin "$HERMES_APPROVED_COMMIT"
git checkout --detach "$HERMES_APPROVED_COMMIT"
git status --short
git rev-parse HEAD
```

The final `git rev-parse HEAD` must equal the approved revision. Do not use a
branch tip, unreviewed local changes, or a different checkpoint commit.

Before starting Compose, inspect the selected profile and confirm that the
checkout contains no untracked secret material:

```bash
cd platform
git diff --exit-code
git status --short
sed -n '1,220p' docker-compose.observation.yml
```

Do not create `.env`, provider config, credentials, or a migration. Do not run
database initialization commands.

## 5. Start only staging observation

From the `platform` directory, validate and start only the observation
profile:

```bash
cd /path/to/hermes/platform
docker compose -f docker-compose.observation.yml config
docker compose -f docker-compose.observation.yml --profile observation up --build
```

For a detached observation window, the approved operator may use:

```bash
docker compose -f docker-compose.observation.yml --profile observation up --build --detach
docker compose -f docker-compose.observation.yml --profile observation ps
```

These are the only permitted Compose start commands for this runbook. They
must use `docker-compose.observation.yml` and the `observation` profile. They
must not use `docker-compose.yml` (the development composition), a second
compose file, an env-file, or an override file. The profile must remain free of Postgres, Redis, Qdrant,
provider configuration, and external hosts. Never change the execution flags
to enable execution; the kill switch must remain active.

Expected properties after `config`:

- one API service only;
- host bind `127.0.0.1:${OBSERVATION_API_PORT:-8080}:8080`;
- staging `NODE_ENV`;
- execution disabled and kill switch active;
- no database, cache, vector store, provider, or secret environment entry.

## 6. Read-only logs and redaction

Logs are evidence, not an authorization source. Collect only structured
`hermes.caller_observation` events and project them to the explicitly allowed
fields before storing or sharing them. Never share the unfiltered Compose
stream.

Allowed evidence is limited to: event version, route and method, safe request
and trace correlation IDs, timestamp, authentication presence and scheme,
presence-only identity metadata, sanitized user-agent family,
provider/gateway header-presence hints, candidate classification and low
confidence, HTTP outcome, duration, and boolean safety markers.

Never collect, retain in the shared evidence, or paste into a ticket:

- `Authorization`, bearer/basic values, tokens, cookies, secrets, or private
  keys;
- request bodies, message text, phone numbers, email addresses, or raw headers;
- raw URLs, query strings, provider responses, exception payloads, or stack
  traces;
- a full `confirmation_id`; retain presence or a separately approved
  redacted reference only;
- inferred tenant data or an authorization decision.

Documentary redaction pipeline (read-only with respect to containers):

```bash
cd /path/to/hermes/platform
umask 077
mkdir -p logs
docker compose -f docker-compose.observation.yml logs --no-color --no-log-prefix api \
  | jq -c 'fromjson? | select(.event_name == "hermes.caller_observation") | {
      event_name,
      event_version,
      route_id,
      method,
      request_id,
      trace_id,
      timestamp,
      auth: {
        authorization_present: .auth.authorization_present,
        auth_scheme: .auth.auth_scheme,
        credential_value_logged: .auth.credential_value_logged
      },
      identity: {
        present: .identity.present,
        principal_type: .identity.principal_type,
        principal_id_present: .identity.principal_id_present,
        tenant_id_present: .identity.tenant_id_present
      },
      caller,
      outcome,
      safety
    }' > logs/caller-observation-redacted.ndjson
```

Review the redacted file manually before sharing. If any forbidden field or
unexpected value appears, stop the profile, preserve the evidence, and open a
separate incident/checkpoint. Do not “clean” the original in place or delete
evidence without authorization.

## 7. Local VPS smoke test

This is an optional, non-production, local-only smoke test. It uses synthetic
data and must not contain a real caller, phone number, email, tenant, token,
provider header, or Confirmation identifier:

```bash
curl --fail-with-body --silent --show-error \
  http://127.0.0.1:8080/health

curl --fail-with-body --silent --show-error \
  -H 'Content-Type: application/json' \
  -X POST http://127.0.0.1:8080/message \
  --data '{"message":"synthetic observation smoke"}'
```

The first request verifies local health only. The second exercises message
classification with synthetic text only; it does not resolve a real caller,
prove identity, infer a tenant, or authorize H02, Confirmation v3, or real
execution. Do not send `/confirm`, use real data, or test from outside the
VPS under this checkpoint. A real-caller observation must happen only in a
separately approved window with an explicit reviewer.

If the port was intentionally changed for an approved local-only reason, use
the approved `OBSERVATION_API_PORT` consistently and still target
`127.0.0.1`; do not publish it.

## 8. Stop and rollback

Rollback is documentary here and must be performed only by the approved
operator. First stop the API, then remove the profile's container and
orphaned Compose resources without removing unrelated Docker data:

```bash
cd /path/to/hermes/platform
docker compose -f docker-compose.observation.yml stop api
docker compose -f docker-compose.observation.yml rm --force api
docker compose -f docker-compose.observation.yml ps --all
docker ps --all --filter 'label=com.docker.compose.project=hermes-staging-observation'
```

The final checks must show no running observation container. Preserve the
redacted log file, command transcript, approved revision, and timestamps in
the approved evidence location. Do not run `docker system prune`, remove
volumes globally, erase logs, or delete evidence without a separate approval.

If a public bind, execution request, external call, secret, provider, database,
raw payload, tenant inference, auth change, or Confirmation change is observed,
stop immediately and escalate. Do not continue troubleshooting by changing
the profile.

## 9. Exit criteria and handoff

The observation window may close only when:

- the container is stopped or the owner has explicitly recorded the active
  window end time;
- no observation container remains unexpectedly running;
- redacted evidence is preserved and reviewed by the named reviewer;
- no forbidden data appears in shared evidence;
- the observed revision and Compose file hash are recorded;
- all deviations are recorded as a separate checkpoint or incident.

This runbook does not authorize production, a public endpoint, provider
configuration, authentication enforcement, Confirmation v3, H02, PostgreSQL,
Redis, Qdrant, migrations, or execution. The next action for this checkpoint
is `STOP`.

## References

- [Hermes staging observation profile](../docker-compose.observation.yml)
- [Hermes caller observability boundary](HERMES_CALLER_OBSERVABILITY.md)
- [Docker Engine installation on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Docker Compose installation overview](https://docs.docker.com/compose/install/)

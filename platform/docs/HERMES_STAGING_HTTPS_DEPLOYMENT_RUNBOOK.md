# Hermes Staging HTTPS Deployment Contract

Status: `documentary-only`, `staging-only`, `production-blocked`.

Checkpoint: `PR-D4-H04G`.

This is an execution contract for a later, separately authorized manual
change window. It was not executed in this checkpoint. It does not authorize
VPS access, DNS changes, UFW changes, Caddy installation, certificate
issuance, Docker or Compose changes, runtime changes, provider connections,
secret creation, Confirmation changes, auth enforcement, execution, or
database/cache/vector services.

## 1. Approved inputs and immutable safety boundary

The approved deployment artifact revision is the implementation commit from
PR #156, not the merge commit that may later bring it to `main`:

```text
4e9655d341e3a79865b8d5136ee69307433f6a14
```

A staging checkout may use this exact revision or a descendant merge commit
that contains it in full. A descendant is eligible only when all of these
gates pass: `git merge-base --is-ancestor` proves the approved revision is an
ancestor of `HEAD`, the working tree is clean, the approved Caddyfile hash is
exact, and no critical deployment file has diverged from the approved
revision. This policy deliberately does not require advance knowledge of the
future merge commit SHA.

The Caddy source artifact is
`platform/infra/staging-observation/Caddyfile`. Its upstream must remain
exactly `127.0.0.1:8080`; do not replace it with a container address, public
IP, `localhost`, or `0.0.0.0`. The repository artifact retains the
non-routable `.invalid` site label. A real hostname may be substituted only in
the deployment copy during the approved window and must never be committed.
The approved repository artifact SHA-256 is:

```text
23d959be214bc1c3e283d0e9118e4b646589a1cd78bedf1914ec5711be2a881a
```

The observation API remains loopback-only with:

```text
HERMES_EXECUTION_ENABLED=false
HERMES_EXECUTION_KILL_SWITCH=true
```

There must be no Postgres, Redis, Qdrant, provider, webhook, queue, worker,
secret, migration, auth-enforcement, tenant-inference, or Confirmation
behavior change in this operation.

The hostname contract is one dedicated non-production subdomain represented
in this document and the manifest as `<STAGING_OBSERVATION_HOST>`:

- exclusive to this staging VPS;
- never a production hostname;
- never reused by another service;
- DNS A and/or AAAA records only for the approved staging VPS;
- no production wildcard or shared routing record.

## 2. Stop rule and evidence discipline

The operator stops immediately on any stop condition in section 6. No
operator should continue by weakening a gate, changing the Caddyfile, opening
8080, changing execution flags, or adding a service. Record redacted command
output and the manifest; do not record secrets, tokens, request bodies,
cookies, raw headers, full confirmation IDs, or real caller data.

The runbook uses placeholders only. Replace `<STAGING_VPS_PUBLIC_IP>`,
`<STAGING_OBSERVATION_HOST>`, `<OPERATOR>`, `<ROLLBACK_OWNER>`, and timestamps
only in the approved operator transcript and manifest copy. Do not replace
them in this repository.

## 3. Exact deployment sequence

### A. VPS preflight

Run on the approved staging VPS as the non-root operator with `sudo`:

```bash
set -euo pipefail
cd /path/to/hermes
APPROVED_DEPLOYMENT_REVISION='4e9655d341e3a79865b8d5136ee69307433f6a14'
APPROVED_CADDYFILE_SHA256='23d959be214bc1c3e283d0e9118e4b646589a1cd78bedf1914ec5711be2a881a'
git merge-base --is-ancestor "$APPROVED_DEPLOYMENT_REVISION" HEAD
test -z "$(git status --porcelain)"
git diff --exit-code "$APPROVED_DEPLOYMENT_REVISION" HEAD -- \
  platform/infra/staging-observation/Caddyfile \
  platform/docker-compose.observation.yml \
  platform/services/api/src
git status --short --branch

cd platform
HERMES_API_CONTAINER_ID="$(sudo docker compose -f docker-compose.observation.yml --profile observation ps -q api)"
test -n "$HERMES_API_CONTAINER_ID"
sudo docker compose -f docker-compose.observation.yml --profile observation ps --format json
test "$(sudo docker inspect --format '{{.State.Health.Status}}' "$HERMES_API_CONTAINER_ID")" = healthy
curl --fail --silent --show-error http://127.0.0.1:8080/health
curl --fail --silent --show-error http://127.0.0.1:8080/ready
sudo docker compose -f docker-compose.observation.yml --profile observation config
sudo ss -lntup
sudo ufw status verbose
```

The evidence must prove the expected HEAD, clean tree, healthy Hermes API,
loopback-only `127.0.0.1:8080`, `HERMES_EXECUTION_ENABLED=false`,
`HERMES_EXECUTION_KILL_SWITCH=true`, active UFW, and absence of Postgres,
Redis, and Qdrant. A public `8080` listener is an immediate stop.

Capture and enforce the approved source hash before copying it:

```bash
test "$(sha256sum infra/staging-observation/Caddyfile | awk '{print $1}')" = "$APPROVED_CADDYFILE_SHA256"
sha256sum infra/staging-observation/Caddyfile
```

### B. Caddy installation and configuration validation

Use the official Caddy Debian/Ubuntu stable package repository on Ubuntu
24.04. Capture the installed version and package provenance. The package may
start its systemd unit automatically, so stop and disable it before the
deployment copy is prepared; do not let an unvalidated configuration serve:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
sudo systemctl disable --now caddy
caddy version
apt-cache policy caddy
```

Validate the hostname before substitution. It must be a dedicated staging
hostname, not a production name, and must contain no slash, whitespace, port,
wildcard, URL scheme, or shell metacharacter. Substitute only the deployment
copy, never the repository artifact:

```bash
export STAGING_OBSERVATION_HOST='<STAGING_OBSERVATION_HOST>'
if [[ ! "$STAGING_OBSERVATION_HOST" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo 'invalid dedicated staging hostname'; exit 1
fi
if [[ "$STAGING_OBSERVATION_HOST" =~ (^|\.)(prod|production)(\.|$) ]]; then
  echo 'production hostname is forbidden'; exit 1
fi

sudo install -d -m 0755 /etc/caddy
sudo install -m 0644 infra/staging-observation/Caddyfile /etc/caddy/Caddyfile
sudo sed -i "s/staging-observation\.example\.invalid/${STAGING_OBSERVATION_HOST}/g" /etc/caddy/Caddyfile
sudo grep -F 'reverse_proxy 127.0.0.1:8080' /etc/caddy/Caddyfile
! sudo grep -E '0\.0\.0\.0:8080|localhost:8080|https?://|\.invalid' /etc/caddy/Caddyfile
sudo sha256sum /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

`caddy validate` must pass before any `reload` or `start`. If the installed
version does not support a directive in the approved artifact, stop and
escalate; do not rewrite the boundary in the window. The source artifact can
also be validated in a disposable official `caddy:<approved-version>`
container with `caddy validate --config /etc/caddy/Caddyfile --adapter
caddyfile`, but that is only a syntax check and must not modify the Hermes
Compose project or deployment.

### C. DNS

Only after section A passes and the Caddy deployment copy passes validation,
create the single approved staging A/AAAA record. Do not create a wildcard,
production record, or record for another service. The DNS owner must verify
that every returned address belongs to the approved staging VPS before the
firewall or Caddy start gate proceeds:

```bash
dig +short A "$STAGING_OBSERVATION_HOST"
dig +short AAAA "$STAGING_OBSERVATION_HOST"
```

Compare the result out-of-band to the approved `<STAGING_VPS_PUBLIC_IP>` and
record the redacted pass/fail result in the manifest. A wrong, stale,
production, wildcard, or unexpected address is an immediate stop.

### D. Firewall

Capture the state before changing it. Keep the existing approved SSH rule;
permit only TCP 80 and 443 for the HTTPS/ACME window. Do not permit 8080 or
change unrelated rules:

```bash
sudo ufw status numbered
sudo ss -lntup
sudo ufw allow 80/tcp comment 'H04G staging Caddy HTTP ACME redirect'
sudo ufw allow 443/tcp comment 'H04G staging Caddy HTTPS'
sudo ufw status numbered
sudo ss -lntup
```

Record the before/after rule sets. If UFW is inactive, if an unexpected
inbound rule appears, or if 8080 is exposed, stop and revert only the
H04G-owned 80/443 rules after recording evidence.

### E. TLS and Caddy activation

After DNS and UFW pass, start the validated systemd service and capture the
service/version/config state:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl is-active caddy
sudo systemctl status --no-pager caddy
sudo journalctl -u caddy --since '<WINDOW_STARTED_AT>' --no-pager
```

Caddy automatic HTTPS must obtain and renew the certificate for the dedicated
staging hostname. Verify the certificate chain and SAN from an independent
client, and verify that HTTP only redirects or serves ACME challenge traffic;
it must never proxy API content:

```bash
curl --fail --silent --show-error --proto '=https' --tlsv1.2 \
  --resolve "$STAGING_OBSERVATION_HOST:443:<STAGING_VPS_PUBLIC_IP>" \
  "https://$STAGING_OBSERVATION_HOST/health"
curl --silent --show-error --dump-header /tmp/h04g-http.headers \
  --resolve "$STAGING_OBSERVATION_HOST:80:<STAGING_VPS_PUBLIC_IP>" \
  "http://$STAGING_OBSERVATION_HOST/health"
openssl s_client -connect "<STAGING_VPS_PUBLIC_IP>:443" \
  -servername "$STAGING_OBSERVATION_HOST" -verify_return_error </dev/null
```

The HTTPS response must be from the approved hostname and valid chain. The
HTTP request must be a redirect/challenge response and must not be a 2xx API
response. Do not use `-k` for the pass condition.

### F. Smoke tests and redacted logs

Run from an independent client with synthetic data only:

```bash
curl --fail --silent --show-error "https://$STAGING_OBSERVATION_HOST/health"
curl --fail --silent --show-error "https://$STAGING_OBSERVATION_HOST/ready"
curl --silent --show-error -o /dev/null -w '%{http_code}\n' \
  -X POST "https://$STAGING_OBSERVATION_HOST/health"  # must be 404
curl --silent --show-error -o /dev/null -w '%{http_code}\n' \
  "https://$STAGING_OBSERVATION_HOST/admin"             # must be 404
curl --silent --show-error -o /dev/null -w '%{http_code}\n' \
  "https://$STAGING_OBSERVATION_HOST/metrics"           # must be 404
curl --silent --show-error -o /dev/null -w '%{http_code}\n' \
  -X GET "https://$STAGING_OBSERVATION_HOST/message"    # must be 404
```

Exercise only the approved route surface with synthetic payloads if the
separate observation approval allows it: `POST /message`, `POST /confirm`,
and `GET /confirm/<single-segment-id>` using a non-sensitive synthetic ID.
Do not infer success from a route status alone; preserve the API's existing
behavior and do not change Confirmation.

Inspect a bounded, redacted Caddy/API log sample. The sample must not contain
`Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, bearer/basic
credential values, request bodies, raw query strings, tokens, telephone
numbers, email addresses, or full confirmation IDs. Forwarded headers are
observation hints only and never identity or authorization:

```bash
sudo journalctl -u caddy --since '<WINDOW_STARTED_AT>' --no-pager \
  | jq -c 'fromjson? | del(.request.uri, .request.headers, .request.body, .response.headers)'
```

### G. Direct 8080 and final gates

From an independent network, verify that connecting to
`<STAGING_VPS_PUBLIC_IP>:8080` fails or times out. A successful HTTP response,
open TCP port, public listener, or Docker-published 8080 is an immediate
stop. On the VPS, repeat `ss`, `ufw`, Compose health/config, and execution
flag checks. Complete the manifest only when all gates pass.

## 4. Rollback

The rollback owner may execute this only in the approved window:

```bash
sudo systemctl disable --now caddy
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
sudo ufw status numbered
sudo ss -lntup
```

Remove or disable the staging DNS record only if the approved rollback plan
requires it. Keep Hermes running on its existing loopback-only bind if the
API remains healthy; if the API must be stopped, use only the existing
observation profile procedure. Do not alter Docker/Compose, data, migrations,
Confirmation, providers, secrets, or execution flags. Do not expose 8080 as
part of rollback. Preserve redacted diagnostics and the manifest.

## 5. Required audit manifest

Copy `HERMES_STAGING_HTTPS_DEPLOYMENT_MANIFEST.yaml` for the authorized
window. The copy may contain operator identity and timestamps, but never a
real hostname in this repository, an IP address, a secret, or a certificate
private key. Every boolean gate is false until independently evidenced.

## 6. Stop conditions

Stop immediately if any of these occurs:

- the approved revision is not an ancestor of `HEAD`, the VPS working tree is
  dirty, the approved Caddyfile hash differs, or a critical deployment file
  diverges from the approved revision;
- the Hermes container is not healthy or 8080 is public;
- `HERMES_EXECUTION_ENABLED=true` or the kill switch is false;
- Postgres, Redis, Qdrant, or another unexpected service appears;
- Caddy validation fails, the upstream differs from `127.0.0.1:8080`, or the
  deployment copy contains a real secret, unapproved IP, or wrong hostname;
- the hostname is production, reused, wildcard-routed, or DNS points to the
  wrong host;
- UFW is inactive or exposes an unexpected port/rule;
- TLS issuance, chain, SAN, renewal, or HTTPS verification fails;
- HTTP proxies API content, an unsupported path/method is not blocked, or
  direct external 8080 succeeds;
- logs reveal `Authorization`, request/body content, cookies, tokens, raw
  headers, or a full confirmation identifier;
- any provider, Twilio, ElevenLabs, auth-enforcement, Confirmation, tenant,
  migration, database, cache, vector, or execution change is requested.

## 7. Checkpoint outcome

This H04G checkpoint is contract/documentation only. The required next action
is `STOP` pending review and a separate deployment authorization.

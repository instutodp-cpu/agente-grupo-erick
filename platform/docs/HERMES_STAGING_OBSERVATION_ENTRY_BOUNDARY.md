# Hermes Controlled Caller Observation Entry Boundary

Status: `staging-only`, `observation-only`, `production-blocked`.

This document and `infra/staging-observation/Caddyfile` are repository design
artifacts for a future observation window. They do not install a proxy, change
the VPS, deploy a container, open a firewall, create DNS, obtain a certificate,
configure a provider, create secrets, or connect Twilio/ElevenLabs.

The authoritative implementation base for the H04F boundary audit and the
H04G deployment contract is:
`5f175fd4ca58a4634e3a6e9b5fb8a5eef719d581`.

## Architecture

```text
INTERNET
   |
HTTPS :443 (future, dedicated staging hostname)
   |
REVERSE PROXY STAGING (Caddy)
   |
127.0.0.1:8080
   |
HERMES OBSERVATION API
```

The existing observation Compose profile remains the only API composition for
the VPS staging state. Its API bind remains loopback-only at `127.0.0.1:8080`.
The proxy must never target a Docker-published public port or a container
address. The API is therefore not directly internet-accessible.

## Proxy selection: Caddy over Nginx

Caddy is selected for this staging-only boundary because one small, declarative
site block provides automatic TLS behavior for a future real hostname,
`reverse_proxy` to the fixed loopback upstream, JSON access logging with field
filters, and a straightforward one-file rollback. Nginx is mature and viable,
but automatic ACME/TLS renewal and safe structured redaction would require
additional tooling and more distributed configuration for this narrow use.

The standard Caddy build is intentionally used as a simple proxy. No rate-limit
plugin or provider module is introduced. The Caddyfile therefore implements
the simple controls that are auditable here: a 1 MiB request-body limit, a 5 s
upstream dial timeout, a 30 s response-header timeout, and a 32-connection
upstream cap. A future activation must add an approved edge/host rate-limit
control before real callers are admitted; this checkpoint does not install or
configure it.

## HTTPS and hostname policy

The Caddyfile uses `staging-observation.example.invalid` as a non-routable
placeholder. It is not a real domain, production hostname, VPS address, or
certificate configuration. The explicit TLS site block is HTTPS-only; there is
no HTTP reverse-proxy site. During a future ACME activation, port 80 may be
needed for the ACME HTTP challenge and/or an HTTPS redirect, but port 80 must
never proxy the API.

Production is explicitly blocked. A production hostname, production DNS, or a
production Caddy/Nginx site is outside this artifact and must fail review.

## Route allowlist

Only the following method/path pairs are forwarded:

| Method | Path | Reason |
| --- | --- | --- |
| `POST` | `/message` | Caller observation input |
| `POST` | `/confirm` | Existing confirmation observation input; behavior is unchanged |
| `GET` | `/confirm/<single-segment-id>` | Confirmation status observation |
| `GET` | `/health` | Liveness check |
| `GET` | `/ready` | Readiness/config-presence check |

The proxy removes the complete query string with the supported Caddy
`rewrite * {path}` operation before forwarding. The route matcher for
`/confirm/<single-segment-id>` does not accept a nested path. All other paths,
including `/`, `/metrics`, `/admin`, provider webhooks, arbitrary `/confirm/*`
paths, and every unsupported method, return `404` at the proxy. This is an
allowlist, not an API-wide reverse proxy.

The API's own route handling remains authoritative after the proxy. No route,
request schema, Confirmation behavior, tenant behavior, or auth behavior was
changed by this checkpoint.

## Header and identity policy

The upstream receives only the minimum observation/protocol hints needed for
this boundary: original `Host`, Caddy-derived `X-Forwarded-For`, fixed
`X-Forwarded-Proto: https`, `User-Agent`, and ordinary `Content-Type`/`Accept`
protocol headers. Caller-supplied `Forwarded`, `X-Forwarded-For`,
`X-Forwarded-Host`, and `X-Forwarded-Proto` values are removed before Caddy
sets its own values. `Authorization`, `Proxy-Authorization`, and `Cookie` are
not sent upstream; `Set-Cookie` and `Authorization` response headers are
removed.

**Forwarded headers are OBSERVATION INPUT ONLY and MUST NOT authorize
tenant/auth decisions.** `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, and
`User-Agent` are hints for `hermes.caller_observation`, not trusted identity,
tenant selection, authentication, authorization, or provider verification.
This checkpoint does not enable auth enforcement.

## Logging and redaction

Caddy access logs are structured JSON. The configured filter deletes the URI,
all raw request headers, request body field, and response headers. This means
access logs do not retain query strings, `Authorization` values, bearer tokens,
cookies, `Set-Cookie`, raw headers, bodies, telephone numbers, email addresses,
message content, transcripts, or complete confirmation IDs.

The API's existing `hermes.caller_observation` event remains the safe source of
caller hints. It records presence/scheme and bounded classifications rather than
credential values, body content, raw URLs, or full confirmation identifiers.
No proxy log is an authorization record.

## Threat model and boundary limits

- **Direct API bypass:** the Compose profile's loopback bind remains the
  required control; do not expose `8080` or change it to `0.0.0.0`.
- **Route expansion:** the explicit matcher allowlist and terminal `404` block
  prevent accidental publication of unrelated API routes.
- **Header spoofing:** caller-supplied forwarding headers are discarded and
  replaced by proxy-derived hints; even those derived hints remain untrusted.
- **Sensitive logging:** access-log fields are deleted; API observation logs
  remain independently redacted.
- **Resource exhaustion:** body size, upstream dial/response timeouts, and the
  upstream connection cap provide a modest staging boundary. They are not a
  complete DDoS mitigation or a substitute for an approved rate limiter.
- **TLS/DNS confusion:** `.invalid` prevents accidental certificate issuance in
  this checkpoint. A future hostname must be dedicated to staging.
- **Configuration drift:** production hostnames, provider settings, secrets,
  database/cache/vector services, and enabled execution are forbidden in this
  boundary.

This entry boundary does **not** solve H02 by itself. It only creates a
controlled transport boundary and observational evidence. It does not prove
caller identity, resolve tenant ownership, add required auth, or define a safe
rollout policy.

It also does **not** authorize Confirmation v3. Existing Confirmation routes
are allowlisted solely because they are part of the declared observation
surface; Confirmation behavior, persistence, schema, authorization, and
tenant scoping remain unchanged and require a separate approved checkpoint.

## Future activation runbook (not executed here)

Activation requires a separate deploy authorization that names the exact
revision, staging host, operator, rollback owner, observation purpose, and
window. The operator must complete these gates in order:

1. Provision a dedicated non-production staging subdomain. Do not reuse a
   production hostname or wildcard that can route production traffic.
2. Create DNS A/AAAA records pointing that hostname to the approved staging
   VPS. DNS creation is a future action; no real domain is present here.
3. Install and validate the approved Caddy package on the VPS. Replace the
   `.invalid` placeholder only in the approved deployment copy; do not commit
   a real domain, IP, certificate, or secret to this repository.
4. Permit only the required future host ingress in UFW: SSH according to the
   existing policy, plus TCP `80` and `443` for the approved TLS window. Do not
   open `8080`; it must remain loopback-only. Firewall changes are not made by
   this checkpoint.
5. Run Caddy configuration validation and a local proxy test. Confirm that
   `/health`, `/ready`, `/message`, `/confirm`, and a valid
   `/confirm/<single-segment-id>` route behave as expected, while an unsupported
   path/method returns proxy `404`.
6. Validate TLS and DNS externally, then verify the upstream is still exactly
   `127.0.0.1:8080`, no public `8080` listener exists, access logs are JSON and
   redacted, and the API still reports execution disabled with the kill switch
   active.
7. Apply an approved basic rate limit/connection policy before any real caller
   observation window. Record only redacted evidence. Do not add provider
   credentials, Twilio/ElevenLabs configuration, tenant inference, or auth
   enforcement as part of this activation.

Required future evidence includes the validated revision, Caddy config hash,
DNS result, UFW result, local and external route tests, TLS result, redacted
log sample, direct-8080 exposure check, and rollback readiness. None of these
future activation steps was executed for this checkpoint.

## Rollback

The future rollback is intentionally small: stop/disable the Caddy site or
restore the last approved Caddyfile, remove the observation DNS record only in
the approved change window, and keep the API running only on its existing
loopback bind. Do not roll back by exposing `8080`, changing execution flags,
changing Confirmation, or deleting unrelated Docker data. If the proxy is
unhealthy, leave the API private and collect redacted diagnostics.

## Authorization boundary and non-goals

This repository change authorizes review of a declarative staging entry design
only. A later deployment checkpoint must separately authorize DNS, UFW 80/443,
TLS, Caddy installation, the exact staging hostname, rate limiting, and an
observation window. It must not infer authorization for production, provider
configuration, secrets, auth enforcement, tenant changes, Confirmation v3,
PostgreSQL, Redis, Qdrant, migrations, or execution.

No VPS change, deploy, firewall change, DNS change, certificate creation,
provider configuration, secret creation, production access, auth enforcement,
Confirmation change, PostgreSQL change, migration, or execution enablement was
performed in this checkpoint.

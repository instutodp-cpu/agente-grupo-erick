# Hermes Safe Staging Observation Runbook

Status: `observability-only`, `staging-only`, `production-blocked`.

This runbook defines a future, read-only observation profile for the
`hermes.caller_observation` event. It does not authorize deployment, H02,
Confirmation v3, runtime execution, provider calls, tenant inference, or any
production operation. The profile is evidence collection only and must not be
treated as an authorization boundary.

## Profile

The declarative profile is
`platform/docker-compose.observation.yml`. It contains only the API service,
binds to localhost, and writes logs to the container stdout/stderr stream.
It has no Postgres, Redis, Qdrant, provider, gateway, SSH, DNS, or production
host dependency. Do not run it as part of this checkpoint.

Required safety properties:

- `HERMES_EXECUTION_ENABLED=false`.
- The execution kill switch remains active.
- No database URL, cache URL, provider configuration, secret, credential, or
  token is defined.
- No authentication enforcement is enabled or changed.
- No Confirmation behavior, storage, schema, or endpoint is changed.
- No tenant is inferred from caller hints or classification candidates.
- No real execution, network provider call, queue, worker, scheduler, or
  durable observation store is enabled.

## Observation event

Filter only structured lines with:

```text
event_name = hermes.caller_observation
```

The observed route identifiers are `message.post`, `confirm.post`, and
`confirm.get`. A missing event is not evidence of an unauthorized caller, and
an event classification is never a trust or authorization decision.

Allowed fields are the event version, route and method, safe request/trace
correlation IDs, timestamp, authentication presence and scheme, limited
identity metadata already resolved upstream, sanitized user-agent family,
provider/gateway header-presence hints, candidate classification and low
confidence, HTTP outcome, duration, and the boolean safety markers.

The following are forbidden in observation output: authorization values,
bearer/basic credentials, digests, cookies, secrets, tokens, request bodies,
message content, phone numbers, full confirmation IDs, raw URLs or query
strings, provider responses, exception payloads, and inferred tenant or
authorization decisions.

## Review boundary

Observation results may be reviewed to inventory caller shapes and identify
follow-up design work. They do not by themselves authorize H02, required
identity, Confirmation tenant scoping, Confirmation v3, production rollout,
or any change to authentication or Confirmation. Any such change requires a
separate explicitly approved checkpoint.

## Stop conditions

Stop and keep the profile disabled if any of the following appears: execution
enabled, a production host or public binding, a database/cache/provider URL,
secret material, a raw payload or message, a full confirmation identifier,
tenant inference, an auth-enforcement change, a Confirmation change, or any
real external request.


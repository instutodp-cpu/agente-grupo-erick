# Hermes Caller Observability

This boundary emits `hermes.caller_observation` events for `message.post`,
`confirm.post` and `confirm.get`. It is observational only: it does not
authenticate callers, select a tenant, change route behavior or prove that a
caller is trusted.

Events contain stable route and method identifiers, safe request/trace IDs,
authentication presence and scheme, limited identity metadata when the
request already has a resolved identity, sanitized user-agent family,
provider/gateway header-presence hints, candidate classification, HTTP status
and duration.

The following are never recorded: authorization values, bearer credentials,
digests, cookies, secrets, request bodies, message content, phone numbers,
full confirmation IDs, raw URLs with query strings, or exception payloads.
Provider-like and gateway-like headers are hints only. `PROVIDER_LIKE`,
`BROWSER_LIKE`, `INTERNAL_SERVER_LIKE`, `LOCAL_SMOKE`, `TEST_ONLY` and
`UNKNOWN` are candidate classifications with conservative confidence; none is
an authorization decision.

Use these events in a future read-only observation window to inventory real
callers, determine trusted identity paths and define the H02 rollout. A caller
must not be migrated to required identity or Confirmation tenant scoping based
on candidate classification alone.

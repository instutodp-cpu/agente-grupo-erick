# Hermes Core Public Web Read-Only Adapter Pilot

Official pilot contract for the first Public Web read-only adapter foundation.

This PR creates adapter, transport, policy, gate, fixture and tests only. It
does not activate a provider, does not call external networks in CI, does not
register the adapter in `src/index.js`, does not change `/message` or
`/confirm`, does not add OAuth, tokens, API keys or secrets, and does not permit
write/action/send/publish/delete.

## Objective

The Public Web Read-Only Adapter Pilot defines a controlled, non-production
path for future public web reads. It is limited to public content, read-only
operations, sanitized structured output and safe audit metadata.

It explicitly blocks login, authentication, form submit, checkout, cart,
purchase, reservation, payment, raw HTML storage, raw provider response storage,
browser automation and arbitrary JavaScript execution.

## Provider Strategy

The official logical identities are:

- `provider_id: public_web_provider_candidate`
- `adapter_id: public_web_read_only_adapter_v1`
- `readiness_candidate_id: public_web_read_only_candidate_v1`
- `connector_id: public_web_read_only_connector_v1`
- `configuration_id: public_web_read_only_configuration_v1`

The code does not depend on a commercial provider name. Any future provider
must be isolated behind the transport contract and must pass lifecycle,
readiness, configuration, feature flag, kill switch and pilot gate checks.

## Operational Modes

- `disabled`
- `fixture_only`
- `mock_transport`
- `non_production_candidate`
- `canary_pending`
- `canary_blocked`
- `canary_allowed`
- `production_blocked`
- `kill_switch_blocked`

In this PR, only fixture and mock transports are executable in tests. The real
transport candidate is default-off and requires explicit injected dependencies.
`canary_allowed` never means automatic provider execution. Production remains
blocked.

## Allowed Operations

- `fetch_public_page_summary`
- `fetch_public_metadata`
- `search_public_information`
- `compare_public_results`
- `inspect_public_price`
- `inspect_public_promotion`
- `inspect_public_supplier`
- `inspect_public_competitor`
- `inspect_public_travel_listing`
- `inspect_public_hotel_listing`
- `inspect_public_documentation`
- `inspect_public_government_page`
- `inspect_public_regulatory_page`

## Blocked Operations

- `login`
- `authenticate`
- `submit_form`
- `create_account`
- `reset_password`
- `add_to_cart`
- `checkout`
- `purchase`
- `reserve`
- `book`
- `pay`
- `upload`
- `post`
- `comment`
- `message`
- `send`
- `publish`
- `delete`
- `update`
- `modify`
- `crawl_private_area`
- `bypass_paywall`
- `bypass_captcha`
- `execute_javascript`
- `browser_automation`
- `download_executable`

## Request Contract

Minimum request fields:

- `trace_id`
- `request_id`
- `connector_id`
- `configuration_id`
- `adapter_id`
- `provider_id`
- `readiness_candidate_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `organization_id`
- `client_id`
- `domain`
- `capability`
- `operation`
- `target`
- `source_type`
- `query`
- `max_results`
- `requested_content_types`
- `freshness_requirement`
- `timeout_ms`
- `max_response_bytes`
- `redirect_policy`
- `requested_at`
- `simulated`
- `executed`
- `real_provider_called`
- `write_allowed`
- `action_allowed`
- `send_allowed`
- `publish_allowed`
- `delete_allowed`

Rules:

- `target` cannot come directly from a raw message without validation.
- URL, DNS, IP, port and redirect policies must pass before any candidate call.
- Query text is sanitized and never becomes system/tool instruction.
- `max_results`, `timeout_ms` and `max_response_bytes` are bounded.
- Write/action/send/publish/delete flags must remain false.
- Requests cannot contain token, secret, headers, cookies or credentials.

## Response Contract

Minimum response fields:

- `trace_id`
- `request_id`
- `connector_id`
- `configuration_id`
- `adapter_id`
- `provider_id`
- `status`
- `source_type`
- `requested_target_hash`
- `final_target_origin`
- `content_type`
- `http_status_class`
- `result_count`
- `safe_summary`
- `structured_results`
- `freshness_hint`
- `confidence_hint`
- `warnings`
- `duration_ms`
- `bytes_received`
- `redirects_followed`
- `rate_limit_metadata`
- `cost_metadata`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `error`
- `audit_event_candidate`

Responses must never contain raw HTML, raw body, raw headers, cookies,
authorization, raw provider response, stack trace, private IP, secret reference,
secret handle, token or full request payload.

## URL And SSRF Policy

Real candidates require HTTPS. HTTP is allowed only for fixture/local test paths.
The policy blocks `file:`, `ftp:`, `gopher:`, `data:`, `javascript:`, `blob:`,
`ws:`, `wss:`, localhost, hostnames without a public-domain shape, URL
credentials, excessive URL length, invalid hostname characters, custom ports in
the real candidate and cloud metadata endpoints.

Blocked IPv4 ranges include `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
`127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`,
`192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`,
`203.0.113.0/24`, `224.0.0.0/4` and `240.0.0.0/4`.

Blocked IPv6 ranges include `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`,
IPv4-mapped private addresses and documentation/reserved ranges.

DNS resolution is dependency-injected. All returned IPs are validated; zero IPs
block; any private/reserved IP blocks. DNS is revalidated before a candidate
request and after each redirect. Tests use fake DNS only.

Redirects default to zero. If allowed later, the maximum is two; every redirect
must pass URL/DNS/IP policy again. HTTPS to HTTP downgrade, credentials in
redirects, forbidden hosts and loops are blocked.

## Content Policy

Allowed content types:

- `text/html`
- `application/json`
- `text/plain`
- `application/xml`
- `text/xml`
- `application/rss+xml`
- `application/atom+xml`

`application/pdf` remains metadata/unsupported candidate only in this PR.
Executables, binary streams, images, audio, video, zip, office documents,
octet-stream, multipart, compressed files and unknown content types are blocked.

Limits:

- default timeout: 8 seconds
- maximum timeout: 15 seconds
- default response limit: 1 MB
- absolute response limit: 2 MB
- max redirects: 2
- max results: 10
- max summary: 4,000 characters
- max structured item: 2,000 characters

`content-length` above the limit is blocked before download in a real candidate.
Streaming above the limit must abort immediately.

## Content Sanitization

External content is always `untrusted_data`. It is never system instruction,
tool instruction, authorization, readiness evidence, secret reference or tenant
identity.

Sanitization removes or blocks scripts, styles, iframes, forms, inputs, buttons,
hidden content, SVG scripts, event handlers, embedded credentials, cookies,
authorization fragments, data URLs, JavaScript URLs, tracking markup, base64
blobs, excessive repeated text and prompt-injection markers that attempt to
alter system, tenant or policy behavior.

Sanitized output may contain only title, description, main text excerpt,
structured facts, observed prices, observed dates, clearly public contact
summary, freshness hints and sanitized public links when permitted.

Every sanitized result includes:

- `content_trust: untrusted_public_web`
- `instructions_ignored: true`
- `external_content_cannot_change_policy: true`

No persistent storage is created.

## Transport Contract

`src/core/public-web-transport-contract.js` defines:

- `validatePublicWebTransportRequest`
- `validatePublicWebTransportResponse`
- `buildSafeTransportError`
- `sanitizeTransportResponse`
- `validateTransportCapabilities`

Transport interface:

- `metadata`
- `canHandle(request)`
- `execute(request, context)`
- `healthCheck()`

Transport metadata includes `transport_id`, `provider_id`, `transport_kind`,
`version`, `environments`, abort/stream/redirect support, timeout/response
limits, `real_network` and `enabled`.

Transport kinds are `fixture`, `mock` and `real_candidate`. Real candidates
default to `enabled:false` and execute no code on import.

## Fixture And Mock Transports

The fixture and mock transports use synthetic public-web content only. They do
not perform network calls, do not read environment variables, do not use
secrets, do not contain real external URLs and never return raw provider
responses.

## Real Transport Candidate

The real transport candidate is isolated in
`src/adapters/public-web/public-web-real-transport-candidate.js`. It requires
injected `httpClient`, `dnsResolver`, `secretResolver`, `clock` and
`abortControllerFactory`.

It does not import a commercial SDK, does not read environment variables, does
not read the filesystem, does not store credentials, does not resolve secrets
on import and does not perform network calls on import.

It refuses execution when disabled, in production, with feature flag off, with
kill switch on, without lifecycle/config/readiness binding, without a complete
secret access context, with rollout at zero, with an unsafe target or with
missing injected dependencies.

The candidate passes only a bounded connection descriptor to `httpClient`:
`url`, approved IPs, selected `approved_ip`, hostname, port, protocol, SNI
server name, Host header, `redirect_mode:manual`, `follow_redirects:false`,
timeout, maximum bytes and abort signal. The HTTP client must not perform free
DNS resolution. The returned `remote_address` must match `approved_ip`; any
mismatch is treated as DNS rebinding and blocked.

Redirects are not followed automatically in this PR. A 3xx response is audited
as a real provider call, then blocked before any second request. Future manual
redirect support must validate the next URL, DNS, IPs, downgrade, credentials,
loops and limits before each additional call.

When the `httpClient` starts, `executed:true` and
`real_provider_called:true` are used in the response and audit event, including
timeout, 429, provider error, content-type block and response-size block. Any
block before the network call remains `executed:false` and
`real_provider_called:false`.

The real candidate requires a streaming response. It validates content length
before reading, reads chunks incrementally, aborts immediately above the byte
limit, owns the timeout timer, clears it in `finally`, and never returns chunks,
raw body or provider raw response.

## Adapter

`public_web_read_only_adapter_v1` is a `real_read_only_candidate`,
`enabled:false`, with feature flag `HERMES_PUBLIC_WEB_READ_ONLY_ENABLED` and
kill switch `HERMES_PUBLIC_WEB_READ_ONLY_KILL_SWITCH`. It supports personal,
corporate and external-client workspaces but is not registered in the runtime
entrypoint.

The existing read-only adapter runtime still blocks non-mock execution.

## Pilot Gate

`src/core/public-web-pilot-gate.js` validates adapter registry binding,
connector lifecycle, readiness evidence, configuration readiness, active secret
reference, environment, feature flag, kill switch, canary authorization,
rollout, workspace/tenant/user allowlists, operation, URL policy, cost budget,
rate limit and audit availability.

This PR caps rollout at 1%, one tenant, one workspace and one synthetic user.
Production is always blocked. The gate never executes the provider.

## Cost And Rate Limit

The pilot policy allows at most 5 requests per hour, 20 per day and concurrency
1. The real candidate reserves rate and cost budget before the HTTP call,
compensates partial reservations, releases concurrency in `finally`, and counts
timeouts/provider errors after network start. There is no retry, no retry after
timeout, no automatic retry on 429, no fallback to another provider and no
persistent Redis/database limiter in this PR.

## Audit

Audit event candidates include event name, trace, request, connector,
configuration, adapter, provider, workspace, tenant, user, domain, capability,
operation, source type, target origin hash, status, blocked reason,
environment, feature flag, kill switch, lifecycle, readiness, configuration,
canary, rollout, fixed execution flags, duration, bytes, redirects, result
count, cost units and occurrence time.

Audit never includes the full URL with query, raw page, HTML, raw body, headers,
cookies, credentials, tokens, secrets, secret handles, provider response,
sensitive query, internal IP or stack trace.

## Relationship With Existing Contracts

- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: source and output safety baseline.
- `REAL_PROVIDER_CONFIGURATION_BOUNDARY.md`: configuration and secret reference
  boundary.
- `CONNECTOR_LIFECYCLE_RUNTIME_REGISTRY.md`: lifecycle and phase ceiling.
- `READ_ONLY_ADAPTER_INTERFACE_RUNTIME.md`: adapter metadata, registry and
  runtime behavior.
- `REAL_READ_ONLY_ADAPTER_READINESS_GATE.md`: readiness evidence before future
  real read-only work.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider candidate registry.
- `INTEGRATION_SECURITY_BOUNDARY.md`: boundary for external data.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability mapping.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: audit, cost and rate controls.
- `TENANT_WORKSPACE_ISOLATION.md`: tenant and workspace isolation.
- `PERMISSION_MATRIX.md`: permissions remain authoritative.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe changes.
- `OPERATOR_RUNBOOK.md`: operator checklist before any pilot canary.

## Default State After Merge

- feature flag off
- runtime disabled
- real provider disabled
- rollout percentage 0
- canary inactive
- production blocked
- no secrets
- no provider calls in CI
- no automatic runtime registration
- `/message` and `/confirm` unchanged

## Non-Production Canary Activation

`PUBLIC_WEB_NON_PRODUCTION_CANARY_ACTIVATION.md` extends this foundation with a
manual development/staging canary path. It requires a temporal session,
explicit scoped approval, exact target allowlist, safe DNS/HTTPS binding,
budget reserve/release, sanitized audit and a post-canary report. It does not
authorize production, endpoints, schedulers or automatic runtime registration.

# Composio Outlook — Grupo Erick metadata-only canary (Draft)

Status: **code and mock tests only; disabled by default; not deployed**.
This is a narrowly scoped staging candidate, not an activation of the
Composio provider in the legacy mock-only registry. Production, Telegram,
Second Brain ingestion, scheduling and all generic Composio tools remain blocked.

## Verified prerequisite (outside this code)
- Consumer Composio Connect uses https://connect.composio.dev/mcp
  and header x-consumer-api-key with ck_ prefix, **not** the Platform ak_ API.
- The shared Grupo Erick Outlook account was authorized under the alias
  outlook-inicial in the user's Composio For You workspace.
- VPS read-only MCP compatibility check: initialize returned HTTP 200,
  notifications/initialized returned HTTP 202, tools/list returned HTTP 200
  and advertised **12 tools**, including COMPOSIO_MULTI_EXECUTE_TOOL.
  An earlier diagnostic incorrectly counted zero tools because it did not
  fully parse the streaming SSE response; the corrected probe verified them.
  The adapter still fails closed if the expected tool is not advertised.
  No Outlook message was accessed in this compatibility probe.
- The consumer key is stored on the VPS under
  /home/hermesadmin/.config/hermes/secrets/composio_api_key, owner
  hermesadmin, mode 0600. Never copy it to Git, logs, Docker build
  contexts or test fixtures.

## Contract
- One **fixed** Composio meta-tool: COMPOSIO_MULTI_EXECUTE_TOOL.
- One **fixed** underlying action: OUTLOOK_LIST_MESSAGES, account alias
  outlook-inicial, folder inbox, top 10, select ONLY
  id, receivedDateTime, isRead, hasAttachments. The Composio action schema
  was checked directly: these are valid fields. The earlier undocumented
  response_detail argument was removed. Unexpected subject, body, sender,
  recipient or other sensitive fields cause fail-closed rejection.
- No tool discovery from untrusted prompts, no generic MCP pass-through,
  no dynamic action names, no body, preview, sender, recipient, subject,
  attachments or message ID in outputs or audit.
- Return only count, unread count, attachment count and date bounds.
- No message persistence, ingestion, embedding, RAG, write, send,
  delete, flag, move or mark-as-read.
- User confirmed the Outlook mailbox serves **all Grupo Erick companies and
  stores**. It is a **group-shared corporate source**, not an Erick Calcados
  or individual-store/company source.
- The connector's source boundary is tenant_id=grupo_erick,
  organization_id=grupo_erick, workspace_type=corporate,
  connector_scope=corporate_private, group_scope=grupo_erick_all_companies,
  scope_type=group_shared. No company_id or store_id is attributed.
- Access is **owner/director only**: authenticated machine identity with
  scope_source=trusted_machine_owner_grant, user_scope=owner_director,
  role=admin, and exact user_id allowlisted in
  HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID. This grant is NOT equivalent to
  a currently authenticated human session; separate Maestro owner approval
  remains mandatory before any real mailbox access.
  No store manager, company admin or company finance user inherits access.
- Identity is resolved using the existing machine bearer registry plus a
  trusted server-side owner grant lookup; run() accepts an authorization
  credential, **not** a caller-supplied identity object. The private
  staging bootstrap re-reads a mode-0600 owner grant file on every attempt,
  allowing immediate revocation. The confirmed owner mapping is staged
  privately with status=pending and is not yet authorized for use.
  Callers and prompts cannot construct or elevate these fields.
- No automatic assignment of messages to a company/store. Future per-company
  classification or sharing needs evidence, explicit owner-approved rules,
  RLS, audit and separate authorization; this pilot returns aggregates only.
- Quota and audit are tenant/group-shared; company_id and store_id are null.
  A mailbox display name alone is not evidence of company ownership.
- Never grant the full Composio MCP server to an LLM/agent directly.

## Fail-closed gates
HERMES_COMPOSIO_OUTLOOK_METADATA_ENABLED=true **and**
HERMES_DEPLOYMENT_STAGE=staging **and**
HERMES_EXECUTION_ENABLED=false **and**
HERMES_EXECUTION_KILL_SWITCH=true **and**
HERMES_MISSION_INGRESS_ENABLED=false.

Default is disabled. Additional requirements for a future live trial:
- Explicit governance/security review of this scoped read-only exception
  to the legacy mock-only Composio provider policy.
- Migration 051 defines append-only PostgreSQL audit with RLS and revoked
  public/anonymous/authenticated/service_role grants. Applied on 2026-11-11
  to Supabase hermes-brain as create_composio_outlook_metadata_audit_v1;
  verified zero rows, both mutation guard triggers, and eight existing
  hermes_brain tables preserved. No runtime access grant was added.
- The PostgreSQL adapter reserves the group-shared 24-hour quota atomically
  using a transaction plus advisory lock before any provider request; it
  persists outcome separately, bound to the same trace and owner.
- The private staging bootstrap now wires the audit adapter, strict TLS
  PostgreSQL pool configuration, machine bearer registry and revocable
  owner grant lookup. It is not imported by the deployed runtime.
- A trusted Maestro authorizeRead callback must consume a fresh (max 5 min),
  one-time owner approval for exactly this provider, account, tenant, action,
  metadata-only scope and maximum 10 messages. The callback must also verify
  the separately reviewed governance exception. If absent, revoked, expired
  or mismatched, no DB reservation or Composio request occurs. The deployed
  bootstrap supplies NO approval callback by default.
- Only id/receivedDateTime/isRead/hasAttachments are accepted in provider
  message objects. Unexpected fields are rejected; IDs are never returned.
  The 24-hour request quota cannot be raised above 10 in this canary.
- A dedicated LOGIN role and its private password file are **not provisioned**;
  the existing personal ingress DB account and Supabase admin/service_role
  credentials must never be reused for corporate Outlook auditing.
- The owner UUID and machine grant must be independently verified before
  staging activation. A machine grant alone does not prove a human session.
- A separately approved, non-public staging entrypoint; no automatic
  startup, cron, Telegram command, or production endpoint.
- Network egress only to the Composio Connect endpoint; timeout and
  maximum response size; secret file must remain private.
- Bounded budget (default 10 attempts per 24h), shared across the entire group.
- Kill-switch drill and rollback verification.

## Verified restricted-role rollback test (2026-11-11)
- Supabase SQL transaction temporarily enabled SET ROLE for the administrative
  postgres session, then used SET LOCAL ROLE hermes_outlook_audit_writer.
- Under that restricted role, INSERT succeeded; UPDATE privilege was false.
- ROLLBACK reverted the synthetic insert AND the temporary role-grant change.
  A separate query confirmed zero persisted audit rows and SET option=false.
- This is a real database permission test, NOT a VPS runtime connection test.

## Private staging bootstrap (not activated)
- Module: src/runtime/hermes-composio-outlook-staging-bootstrap.js
- The module is not imported into any public API or deployed service.
- All original staging/kill-switch gates remain mandatory.
- Requires an exact verified owner UUID, one machine registry entry, and one
  owner grant in separate owner-controlled mode-0600 files. The grant must
  bind tenant, machine key, principal, group scope and owner identity.
- The grant file is re-read for every attempt so revocation takes effect
  immediately. Machine registry key revocation requires process restart.
- Database login MUST be hermes_outlook_audit_login (or its project-qualified
  pooler variant) against only project asceucchdnuoaqgdjbtg.
- Database password is loaded from a separate private mode-0600 file.
  TLS requires a verified Supabase project CA and hostname verification.
  No SSL bypass, postgres login, service_role or personal ingress login.
- Every audit transaction issues SET LOCAL ROLE hermes_outlook_audit_writer
  before quota check or insert. Missing role membership denies the attempt.
- Migration 053 prepared the dedicated database role with NOLOGIN and NULL
  password. It has only SET (no INHERIT) membership in the restricted writer.
- The one active Grupo Erick membership was checked against auth.users:
  existing, email confirmed, not banned or deleted. The user confirmed
  that this membership belongs to the group's owner/director.
- The VPS holds a separate mode-0700 Outlook directory with private 0600
  machine bearer, one-entry registry (active=false), owner grant
  (status=pending), and disabled staging env. The real owner UUID is NOT
  committed to Git. No DB password has been provisioned.
- A copy of the public Supabase Root 2021 CA certificate was installed in
  the isolated Outlook directory (mode 0600). A passwordless PostgreSQL
  STARTTLS probe from the VPS to the exact hermes-brain database host
  established TLS 1.3 with hostname/certificate verification OK.
  This proves network/TLS only, NOT database authentication or RLS.
- The private-config drill verified: disabled gate, inactive bearer denial,
  pending owner grant denial; zero DB connections and provider requests.
- On 2026-11-11 the user approved PREPARATION of a single metadata-only
  trial, not automatic execution. A synthetic public-key credential exchange
  passed, but automatic provisioning of the real database credential was
  blocked by the tool security policy. The login was explicitly reset to
  NOLOGIN/PASSWORD NULL and independently verified; no credential file was
  installed. The temporary exchange key was removed. Do not bypass this
  policy; provisioning requires a separate user-controlled secure workflow.
- Maestro owner authorization, the governance exception, database password
  installation and a scoped staging trial remain pending. Do not activate.

## Scoped governance exception proposal — PENDING, not approved

The existing provider registry and permission overlay classify `composio`
as `mock_only`. This draft does not override that contract. A future
exception must be reviewed by the Maestro security/governance authority
before any real Outlook message metadata is requested.

- Provider: `composio` / `app_integration_hub`; critical risk.
- Tenant and source: `grupo_erick`, group-shared corporate Outlook,
  account alias `outlook-inicial`; no store/company inference.
- Allowed action candidate: `OUTLOOK_LIST_MESSAGES`, inbox only,
  `top=10`, `select=id,receivedDateTime,isRead,hasAttachments`.
- Output: aggregate counts and date bounds only; no IDs, subjects,
  senders, recipients, bodies, attachments, persistence or Second Brain import.
- Forbidden: all other Composio tools, email send/write, calendar modification,
  generic tool execution, production and automated schedules.
- Human approval: owner/director verified in an authenticated session;
  Maestro must consume a fresh one-time approval with a five-minute window.
- Technical gates: staging-only, private machine grant, dedicated TLS
  PostgreSQL login, committed append-only audit and shared 10/24h quota.
- Rollback: revoke owner grant, deactivate machine registry entry,
  disable pilot and revoke the dedicated database LOGIN.
- Decision: **PENDING GOVERNANCE REVIEW**. User confirmation in chat is
  approval to prepare, not a governance exception or Maestro authorization.

## How to test safely

From the isolated worktree:

    cd platform/services/api
    node --test test/hermes-composio-outlook-metadata-*.test.js test/hermes-composio-outlook-staging-bootstrap.test.js

Tests use synthetic responses and a fixture key only. No provider call.
The module is not imported into the public API. No environment variable
is enabled in the deployed runtime.

## Next review / activation gate
1. The one active Grupo Erick membership is confirmed by the user as owner;
   auth.users shows a verified, unblocked identity. Its UUID is staged only
   in the VPS private configuration, with grant=pending and machine=inactive.
   Separate explicit Maestro approval and an authenticated owner-session
   attestation are still required before activation.
2. Migrations 051, 052 and 053 are applied in hermes-brain. The restricted
   writer has SELECT/INSERT only under Grupo Erick RLS; audit has zero rows.
   The dedicated role exists but is NOLOGIN with NULL password and no
   inherited writer privileges. Provision the password via a secure channel,
   enable LOGIN only after review, then test a dedicated VPS connection
   and audit reservation/outcome with rollback. The CA is already installed
   and its TLS handshake verified, but authentication remains blocked.
3. Only after those prerequisites, wire a non-public staging entrypoint
   with explicit Maestro authorization and a kill-switch drill.
4. The MCP meta-tool is advertised from the VPS; verify the underlying
   Outlook action and response shape in a separately approved real metadata
   read only after the authenticated owner and durable audit are wired.
5. Only then consider an audited, group-scoped operational reader.
   Raw email content ingestion requires a **separate** explicit approval,
   retention policy, LGPD review and opt-in.

# Composio Outlook — Grupo Erick metadata-only canary (Draft)

Status: **code and mock tests only; disabled by default; not deployed**.
This is a narrowly scoped staging candidate, not an activation of the
Composio provider in the legacy mock-only registry. Production, Telegram,
Second Brain ingestion, scheduling and all generic Composio tools remain blocked.

## Verified prerequisite (outside this code)
- Consumer Composio Connect uses https://connect.composio.dev/mcp
  and header x-consumer-api-key with ck_ prefix, **not** the Platform ak_ API.
- A private Outlook account was authorized under the alias outlook-inicial
  in the user's Composio For You workspace.
- The consumer key is stored on the VPS under
  /home/hermesadmin/.config/hermes/secrets/composio_api_key, owner
  hermesadmin, mode 0600. Never copy it to Git, logs, Docker build
  contexts or test fixtures.

## Contract
- One **fixed** Composio meta-tool: COMPOSIO_MULTI_EXECUTE_TOOL.
- One **fixed** underlying action: OUTLOOK_LIST_MESSAGES, account alias
  outlook-inicial, folder inbox, top 10, select ONLY
  id, receivedDateTime, isRead, hasAttachments.
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
  scope_source=authenticated_session, user_scope=owner_director, role=admin,
  and exact user_id allowlisted in HERMES_COMPOSIO_OUTLOOK_OWNER_USER_ID.
  No store manager, company admin or company finance user inherits access.
- Identity must be supplied by trusted authenticated context; callers and
  prompts must not be allowed to construct or elevate these fields.
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
- Durable audit and durable 24-hour usage store wired into the canary.
  Attempt reservation must succeed **before** any external request.
- Confirmed corporate company ID and identity from trusted session context,
  not from prompt text.
- A separately approved, non-public staging entrypoint; no automatic
  startup, cron, Telegram command, or production endpoint.
- Network egress only to the Composio Connect endpoint; timeout and
  maximum response size; secret file must remain private.
- Bounded budget (default 10 attempts per 24h), per-company.
- Kill-switch drill and rollback verification.

## How to test safely

From the isolated worktree:

    cd platform/services/api
    node --test test/hermes-composio-outlook-metadata-read.test.js

Tests use synthetic responses and a fixture key only. No provider call.
The module is not imported into the public API. No environment variable
is enabled in the deployed runtime.

## Next review / activation gate
1. Confirm the real owner/director user ID in the authenticated corporate
   session and configure the exact allowlist without placing it in Git.
2. Bind the group-shared tenant scope in the durable audit/usage store;
   do not synthesize a company or store ID for this shared mailbox.
3. Attach a durable attempt/audit store and validate the MCP response
   shape in a separately approved staging trial.
4. Only then consider an audited, group-scoped operational reader.
   Raw email content ingestion requires a **separate** explicit approval,
   retention policy, LGPD review and opt-in.

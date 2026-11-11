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
- Corporate scope requires authenticated machine identity, tenant and
  organization grupo_erick, workspace_type=corporate, explicit matching
  company_id, user_id, role=admin|financeiro.
- Company ID must be **explicitly approved and configured** in
  HERMES_COMPOSIO_OUTLOOK_COMPANY_ID; the mailbox display name alone is
  not proof of company ownership.
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
1. Confirm whether the authorized Outlook mailbox belongs to only one
   company or is shared by multiple Grupo Erick companies.
2. Bind an authorized corporate company ID.
3. Attach a durable attempt/audit store and validate the MCP response
   shape in a separately approved staging trial.
4. Only then consider an audited, tenant-scoped operational reader.
   Raw email content ingestion requires a **separate** explicit approval,
   retention policy, LGPD review and opt-in.

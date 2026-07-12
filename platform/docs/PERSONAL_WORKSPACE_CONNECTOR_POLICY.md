# Hermes Core Personal Workspace Connector Policy

Official contract for future personal workspace connectors.

This document is a contract only. It does not implement Gmail, Google Calendar,
Drive, Contacts, Docs, Sheets, GitHub, MCP, OAuth, tokens, secrets, external API
calls, real providers, real adapters, storage, memory, runtime changes,
send/write/delete/share/action, `executed:true` or `real_provider_called:true`.

## What It Is

Personal Workspace Connector Policy defines how Hermes Core may use future
personal connectors inside the `personal` workspace. It covers future personal
Gmail, Calendar, Drive, Contacts, documents, files, notes, tasks and personal
MCP candidates.

It guarantees that Hermes Pessoal does not mix personal data with Grupo Erick,
that Grupo Erick does not use personal data as operational context and that
external clients cannot access personal connectors. In this phase it is only
documentation, fixture and test.

## Objectives

- Separate personal connectors from corporate connectors.
- Define future personal connector candidates.
- Define safe read-only and draft-only modes.
- Block real send, delete, share, edit and write actions in this phase.
- Require `tenant_id=personal::<user_id>` for the personal workspace.
- Block personal data leakage to Grupo Erick or external clients.
- Prepare future personal MCP scope with clear boundaries.
- Require human review for future drafts.
- Require governance review for sensitive connectors.

## Official Workspace And Tenant

- `workspace_type`: `personal`
- `tenant_id`: `personal::<user_id>`
- `user_id`: required
- `connector_scope`: `personal_private`

Rules:

- Personal connectors always belong to the personal workspace.
- Personal connectors never belong to `grupo_erick`.
- Personal connectors never belong to `external_client`.
- Prompts cannot alter `tenant_id`.
- Providers/connectors cannot alter `tenant_id`.
- Personal data cannot become corporate memory.
- Corporate data cannot become personal memory.

## Official Connector Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `draft_only_candidate`
- `blocked_by_workspace`
- `blocked_by_tenant_isolation`
- `blocked_by_security_boundary`
- `blocked_by_permission_overlay`
- `blocked_by_governance`
- `blocked_by_human_review`
- `blocked_by_oauth_policy`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true` in this phase.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode permits real send, write, delete or share.
- No mode calls a real API.
- `draft_only_candidate` means future draft only, never automatic send.

## Personal Connector Candidates

- `gmail_personal_read_candidate`
- `gmail_personal_draft_candidate`
- `calendar_personal_read_candidate`
- `calendar_personal_draft_candidate`
- `drive_personal_read_candidate`
- `docs_personal_read_candidate`
- `sheets_personal_read_candidate`
- `contacts_personal_read_candidate`
- `tasks_personal_read_candidate`
- `notes_personal_read_candidate`
- `files_personal_read_candidate`
- `personal_mcp_manual_fixture`

Rules:

- None of these candidates are implemented in this PR.
- Future Gmail starts read-only and draft-only.
- Future Calendar starts read-only and draft-only.
- Future Drive, Docs and Sheets start read-only.
- Future Contacts starts read-only.
- Real send, create, edit and delete require a future readiness gate.
- Tokens/OAuth require their own future policy.

## Allowed Future Personal Operations

- `search_email_summary`
- `read_email_summary`
- `summarize_thread`
- `draft_email_response`
- `list_calendar_summary`
- `summarize_calendar_day`
- `draft_calendar_event`
- `search_drive_metadata`
- `summarize_document`
- `summarize_sheet`
- `lookup_contact_summary`
- `summarize_task_list`
- `summarize_personal_note`
- `second_brain_candidate`
- `personal_reminder_candidate`

Rules:

- Output is always sanitized.
- Drafts are never sent automatically.
- Events are never created automatically.
- Files are never edited automatically.
- Documents are never shared automatically.
- Any second brain candidate requires Memory Policy and review.

## Blocked Personal Operations

- `send_email`
- `forward_email_real`
- `delete_email`
- `archive_email_real`
- `apply_label_real`
- `create_calendar_event_real`
- `update_calendar_event_real`
- `delete_calendar_event_real`
- `invite_attendee_real`
- `share_drive_file_real`
- `edit_drive_file_real`
- `delete_drive_file_real`
- `create_doc_real`
- `edit_doc_real`
- `create_sheet_real`
- `edit_sheet_real`
- `export_sensitive_file_real`
- `download_private_file_real`
- `sync_contacts_real`
- `create_contact_real`
- `update_contact_real`
- `delete_contact_real`
- `oauth_token_exchange`
- `refresh_token_use`
- `cross_workspace_context_use`
- `cross_tenant_context_use`

## Future Allowed Use Cases

### Hermes Pessoal

- summarize personal email
- draft email replies without sending
- summarize personal calendar
- draft calendar events without creating them
- summarize authorized personal documents and sheets
- look up contact summaries
- organize personal tasks
- create personal memory candidates with review

### Grupo Erick

- cannot use personal Gmail as operational source
- cannot use personal Calendar as operational source
- cannot use personal Drive as operational source
- must use corporate connectors only through a future specific PR
- cannot mix personal memory with company data

### Clientes Externos

- cannot access personal connectors
- cannot use personal context
- cannot inherit personal tokens
- require their own tenant-scoped connector policy

## Future Personal Connector Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `connector_id`
- `connector_type`
- `connector_mode`
- `connector_scope`
- `domain`
- `capability`
- `intent`
- `operation_type`
- `read_allowed`
- `draft_allowed`
- `write_allowed`
- `action_allowed`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `requires_human_review`
- `requires_governance_review`
- `requires_security_boundary`
- `requires_permission_overlay`
- `requires_tenant_isolation`
- `requires_oauth_policy`
- `sanitized_input`
- `blocked_reason`

Rules:

- `workspace_type` must be `personal`.
- `tenant_id` must start with `personal::`.
- `user_id` is required.
- `connector_scope` must be `personal_private`.
- `write_allowed:false`.
- `action_allowed:false`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `sanitized_input` cannot contain raw messages, raw payloads, tokens, secrets,
  headers, cookies or credentials.

## Future Personal Connector Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `connector_id`
- `connector_type`
- `connector_mode`
- `connector_scope`
- `domain`
- `capability`
- `operation_type`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `safe_summary`
- `sanitized_result`
- `draft_candidate`
- `second_brain_candidate`
- `sensitivity_level`
- `data_minimization_applied`
- `blocked_reason`
- `error_code`
- `audit_event_candidate`
- `next_review_step`
- `human_review_required`
- `governance_review_required`

Rules:

- `simulated:true`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `can_trigger_real_execution:false`.
- `safe_summary` must be sanitized.
- `sanitized_result` must be limited.
- `draft_candidate` is never sent automatically.
- `second_brain_candidate` is never saved automatically.
- Responses cannot contain tokens, secrets, raw email bodies, raw files, raw
  payloads, headers or cookies.

## Official Statuses

- `personal_connector_mock_success`
- `personal_connector_mock_blocked`
- `personal_connector_mock_error_safe`
- `personal_connector_requires_human_review`
- `personal_connector_requires_governance_review`
- `personal_connector_workspace_blocked`
- `personal_connector_permission_blocked`
- `personal_connector_sensitive_data_blocked`
- `personal_connector_write_blocked`
- `personal_connector_action_blocked`
- `personal_connector_oauth_policy_missing`
- `personal_connector_not_supported`
- `personal_connector_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `safe_summary`
- `sanitized_result`
- `email_summary`
- `thread_summary`
- `calendar_summary`
- `document_summary`
- `sheet_summary`
- `contact_summary`
- `task_summary`
- `note_summary`
- `draft_email_candidate`
- `draft_event_candidate`
- `second_brain_candidate`
- `reminder_candidate`
- `freshness_hint`
- `sensitivity_hint`
- `confidence_hint`

Blocked output fields include raw email body, raw thread body, raw calendar
payload, raw drive file, raw document, raw sheet, raw contact payload, raw
payload, raw message, tokens, secrets, headers, cookies, credentials,
passwords, authorizations, access tokens, refresh tokens, private URLs, raw
attachments, full file dumps and personal sensitive data without policy.

## Future OAuth And Token Policy

- This PR does not implement OAuth.
- Tokens cannot enter fixtures.
- Tokens cannot be saved in memory.
- Tokens cannot appear in audit.
- Refresh tokens require future secure storage.
- OAuth scopes must be minimal.
- Revocation must be defined before real OAuth.
- Real connectors require a future readiness gate.
- Real connectors require secret management.
- Real connectors require operator runbook.
- Real connectors require sanitized audit.

## Tenant And Workspace Rules

- Every future personal connector request needs `workspace_type=personal`.
- `tenant_id` is always `personal::<user_id>`.
- Grupo Erick cannot use personal connectors.
- External clients cannot use personal connectors.
- Personal data cannot be attached to corporate context.
- Personal data cannot be sent to external client context.
- Providers/connectors cannot alter `tenant_id`.
- Prompts cannot alter `tenant_id`.
- Future personal connector cache needs namespace by `user_id` and `tenant_id`.
- Future memory derived from a personal connector requires consent, review and
  policy.

## Permission And Review Rules

- Read-only still requires scope.
- Draft-only requires human review before any future real action.
- Send/delete/share/update/create require a future readiness gate.
- Sensitive data requires governance review.
- Personal data requires minimization.
- Second brain candidates require Memory Policy and review.
- Role never authorizes real execution by itself.
- Personal owner does not authorize real action in this phase.

## Blocking Rules

Future PRs must be blocked when they:

- implement real Gmail before readiness gate
- implement real Calendar before readiness gate
- implement real Drive before readiness gate
- implement real Contacts before readiness gate
- implement real OAuth without policy
- add tokens or secrets
- store refresh tokens
- send real email
- create real calendar events
- edit real files
- share real files
- delete real data
- download private files
- use personal connectors in `grupo_erick`
- use personal connectors in `external_client`
- mix personal data with corporate context
- mix personal data with external client context
- remove required `tenant_id`
- remove required `workspace_type`
- allow prompts to alter `tenant_id`
- allow providers to alter `tenant_id`
- allow cross-tenant leakage
- store raw email bodies
- store raw files
- store raw payloads
- store sensitive data without policy
- allow `executed:true`
- allow `real_provider_called:true`
- allow `write_allowed:true`
- allow `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: personal connectors must remain personal.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: connector candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: personal connector data must stay inside
  security boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: future connectors need audit,
  cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web reads do not unlock personal
  connectors.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription intake does not unlock
  personal connectors.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: internal business data remains separate
  from personal connectors.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe connector changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future connector flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: personal output cannot become memory without policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: personal connector output can only become
  future inbox candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve connector
  calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable personal
  connector agents.
- `OPERATOR_RUNBOOK.md`: operators must validate future connector changes.

## Security And LGPD

- Data minimization.
- Personal data stays in the personal workspace.
- Personal data cannot become corporate context.
- Personal data cannot leak to external clients.
- Corporate data cannot enter personal memory without policy.
- Retention must be defined before real storage.
- Future OAuth requires explicit consent and minimal scopes.
- Draft is not send.
- Read is not action authorization.

## Social Media Draft-Only Approval

`docs/SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md` documents the contract-only policy
for future social media draft generation and approval. It keeps all output as
draft content, separates personal, Grupo Erick and external client brand scopes,
and does not implement real social providers, OAuth, tokens, publishing,
scheduling, comments, DMs, media storage, scheduler, adapters or runtime
changes. It keeps `simulated:true`, `executed:false`,
`real_provider_called:false`, `publish_allowed:false` and `send_allowed:false`
mandatory.

## External Client Workspace Connector Policy

`docs/EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future external client SaaS connectors. It keeps every connector
scoped to `workspace_type=external_client`, `tenant_id=client::<client_id>` and
`client_id`, blocks cross-client access, and does not implement real connectors,
OAuth, tokens, APIs, storage, cache, memory, providers, adapters or runtime
changes. It keeps mock-first, read-only first, human review, governance review,
`simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and `publish_allowed:false` mandatory.


## Corporate Workspace Connector Policy

`docs/CORPORATE_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future Grupo Erick corporate connectors. It keeps corporate access
scoped to `workspace_type=corporate`, `tenant_id=grupo_erick` and
`organization_id=grupo_erick`, blocks personal and external-client context,
and does not implement real corporate connectors, OAuth, tokens, APIs, storage,
cache, memory, providers, adapters or runtime changes. It keeps mock-first,
read-only first, human review, governance review, `simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and
`publish_allowed:false` mandatory.

## Real Read-Only Adapter Readiness Gate

`docs/REAL_READ_ONLY_ADAPTER_READINESS_GATE.md` documents the first executable readiness gate for future real read-only adapters. This PR creates a deterministic, deny-by-default and fail-closed gate, fixture and tests only. It does not create a real adapter, call a provider, activate an integration, enable a feature flag, add OAuth or secrets, or change `/message` or `/confirm`. `READY` means only eligible for a future integration PR; `executed:false`, `real_provider_called:false` and `can_trigger_real_execution:false` remain mandatory in this PR.

# Hermes Core Corporate Workspace Connector Policy

Official contract for future Grupo Erick corporate workspace connectors.

This document is a contract only. It does not implement real corporate Gmail,
Google Calendar, Google Drive, Base44, Supabase, Postgres, ERP/Linx, GitHub,
Codex, Claude Code, MCP, providers, adapters, OAuth, tokens, secrets, API
calls, database, storage, cache, memory, RAG, runtime changes, write/action,
send, publish, delete, share, `executed:true` or `real_provider_called:true`.

## What It Is

Corporate Workspace Connector Policy defines how Hermes Core may use future
Grupo Erick corporate connectors. The official corporate workspace uses
`workspace_type=corporate`; the official tenant uses `tenant_id=grupo_erick`;
the official organization uses `organization_id=grupo_erick`.

It covers future corporate email, calendar, documents, files, Base44,
Supabase, ERP, GitHub, automation, support, marketing, training and operations
connectors. Corporate connectors cannot access Hermes Pessoal or external
clients. This policy does not replace Tenant Workspace Isolation, Permission
Matrix, Security Boundary, Internal Business API Read-Only, human review,
governance review or `executed:false`.

## Objectives

- Separate corporate connectors from personal connectors.
- Separate corporate connectors from external client connectors.
- Require `tenant_id=grupo_erick`.
- Require `workspace_type=corporate`.
- Require `organization_id=grupo_erick`.
- Require `user_id` and `role`.
- Define future corporate connector candidates.
- Define read-only and draft-only operations.
- Block real write, send, publish, delete and share operations.
- Block personal tokens and external client tokens.
- Require scope by company, store, department, user and brand.
- Prepare a safe operational path for Grupo Erick.

## Official Workspace And Tenant

- `workspace_type`: `corporate`
- `tenant_id`: `grupo_erick`
- `organization_id`: `grupo_erick`
- `user_id`: required
- `role`: required
- `connector_scope`: `corporate_private`

Rules:

- Every corporate connector belongs to Grupo Erick.
- No corporate connector belongs to `personal`.
- No corporate connector belongs to `external_client`.
- Prompts cannot alter `tenant_id` or `organization_id`.
- Providers/connectors cannot alter `tenant_id`.
- `organization_id` cannot come from free-form prompt text alone.
- Future corporate context must come from authenticated session context.
- Switching to corporate must be explicit and auditable.

## Official Corporate Connector Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `draft_only_candidate`
- `blocked_by_workspace`
- `blocked_by_tenant_isolation`
- `blocked_by_permission_matrix`
- `blocked_by_permission_overlay`
- `blocked_by_security_boundary`
- `blocked_by_governance`
- `blocked_by_human_review`
- `blocked_by_oauth_policy`
- `blocked_by_store_scope`
- `blocked_by_department_scope`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true`.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode allows real action.
- No mode calls a real API.
- Read-only never changes state.
- Draft-only never sends or publishes.
- Store and department scope cannot be expanded by prompt.

## Corporate Connector Candidates

- `corporate_gmail_read_candidate`
- `corporate_gmail_draft_candidate`
- `corporate_calendar_read_candidate`
- `corporate_calendar_draft_candidate`
- `corporate_drive_read_candidate`
- `corporate_docs_read_candidate`
- `corporate_sheets_read_candidate`
- `corporate_contacts_read_candidate`
- `corporate_base44_read_candidate`
- `corporate_supabase_read_candidate`
- `corporate_postgres_read_candidate`
- `corporate_erp_read_candidate`
- `corporate_linx_read_candidate`
- `corporate_crm_read_candidate`
- `corporate_helpdesk_read_candidate`
- `corporate_github_read_candidate`
- `corporate_codex_read_candidate`
- `corporate_claude_code_read_candidate`
- `corporate_social_draft_candidate`
- `corporate_web_read_candidate`
- `corporate_transcription_candidate`
- `corporate_mcp_manual_fixture`

Rules:

- No candidate is implemented in this PR.
- Candidates start read-only or draft-only.
- Gmail draft does not send.
- Calendar draft does not create real events.
- Base44, Supabase, Postgres, ERP and Linx are read-only.
- GitHub, Codex and Claude Code start as read/context only.
- Social remains draft-only.
- Transcription does not process real audio in this PR.
- Any real integration requires a future readiness gate.

## Future Allowed Operations

- `read_email_summary`
- `draft_email_response`
- `summarize_calendar`
- `draft_calendar_event`
- `search_drive_metadata`
- `summarize_document`
- `summarize_sheet`
- `lookup_contact_summary`
- `base44_summary`
- `supabase_summary`
- `postgres_summary`
- `erp_summary`
- `linx_summary`
- `crm_summary`
- `helpdesk_summary`
- `github_repository_summary`
- `github_pull_request_summary`
- `development_context_summary`
- `social_content_draft`
- `public_web_summary`
- `transcription_summary_candidate`
- `business_report_candidate`
- `executive_summary_candidate`
- `audit_summary_candidate`
- `training_summary_candidate`
- `store_performance_candidate`
- `supplier_summary_candidate`
- `second_brain_candidate`
- `alert_candidate`
- `dashboard_summary_candidate`

Rules:

- Only read-only or draft-only.
- Summaries never execute actions.
- `second_brain_candidate` requires Memory Policy and review.
- `alert_candidate` does not send a real notification.
- Reports do not export raw sensitive data.
- GitHub summary does not create issues, PRs, commits or merges.
- `development_context_summary` does not alter code.

## Blocked Operations

- `send_email_real`
- `forward_email_real`
- `delete_email_real`
- `create_calendar_event_real`
- `update_calendar_event_real`
- `delete_calendar_event_real`
- `share_drive_file_real`
- `edit_drive_file_real`
- `delete_drive_file_real`
- `base44_write_real`
- `supabase_write_real`
- `postgres_write_real`
- `run_raw_sql_real`
- `erp_writeback_real`
- `linx_writeback_real`
- `create_crm_record_real`
- `update_crm_record_real`
- `delete_crm_record_real`
- `create_helpdesk_ticket_real`
- `update_helpdesk_ticket_real`
- `close_helpdesk_ticket_real`
- `create_invoice_real`
- `payment_action_real`
- `purchase_action_real`
- `stock_update_real`
- `credit_limit_update_real`
- `create_github_issue_real`
- `update_github_issue_real`
- `create_pull_request_real`
- `merge_pull_request_real`
- `push_commit_real`
- `change_repository_settings_real`
- `run_codex_write_real`
- `run_claude_code_write_real`
- `publish_social_real`
- `send_social_message_real`
- `upload_media_real`
- `create_user_real`
- `change_role_real`
- `oauth_token_exchange`
- `refresh_token_use`
- `use_personal_credentials`
- `use_external_client_credentials`
- `cross_workspace_context_use`
- `cross_tenant_context_use`
- `bypass_store_scope`
- `bypass_department_scope`
- `bypass_permission_matrix`

## Future Allowed Use Cases

Grupo Erick may eventually summarize corporate email, draft replies without
sending, summarize corporate calendar, draft events without creating them,
summarize authorized documents and sheets, query Base44/Supabase/ERP read-only,
generate executive summaries by store, analyze purchases, stock, sales and
suppliers, query training progress, query GitHub and development context in
read-only mode, generate social drafts without publishing, and generate alert
or report candidates. It must never execute real action automatically.

Hermes Pessoal cannot use corporate connectors without explicit workspace
switch, cannot use corporate data as personal memory and cannot inherit
corporate tokens.

External clients cannot use corporate connectors, access Grupo Erick data,
credentials, memory, cache or storage, or inherit corporate tokens.

## Official Corporate Connector Scopes

- `corporate_private`
- `corporate_global`
- `corporate_company`
- `corporate_store`
- `corporate_department`
- `corporate_user`
- `corporate_brand`
- `corporate_development`
- `corporate_financial`
- `corporate_hr`
- `corporate_training`
- `corporate_manual_fixture`

Rules:

- `connector_scope` is required.
- `organization_id` is required.
- `company_id`, `store_id`, `department_id` or `brand_id` may be required.
- Scope must match role and tenant.
- Prompts cannot expand scope.
- Role cannot expand scope by itself.
- Future super_admin does not remove audit or tenant isolation.

## Minimum Future Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `organization_id`
- `user_id`
- `role`
- `company_id`
- `store_id`
- `department_id`
- `brand_id`
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
- `send_allowed`
- `publish_allowed`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `requires_human_review`
- `requires_governance_review`
- `requires_security_boundary`
- `requires_permission_matrix`
- `requires_permission_overlay`
- `requires_tenant_isolation`
- `requires_oauth_policy`
- `sanitized_input`
- `blocked_reason`

Rules:

- `workspace_type` must be `corporate`.
- `tenant_id` must be `grupo_erick`.
- `organization_id` must be `grupo_erick`.
- `user_id`, `role` and `connector_scope` are required.
- `write_allowed:false`, `action_allowed:false`, `send_allowed:false` and
  `publish_allowed:false` are mandatory.
- `executed:false` and `real_provider_called:false` are mandatory.
- `sanitized_input` cannot contain tokens, secrets, raw payloads, raw messages,
  headers, cookies, credentials, personal data or external client data.

## Minimum Future Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `organization_id`
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
- `report_candidate`
- `alert_candidate`
- `second_brain_candidate`
- `sensitivity_level`
- `data_minimization_applied`
- `send_allowed`
- `publish_allowed`
- `blocked_reason`
- `error_code`
- `audit_event_candidate`
- `next_review_step`
- `human_review_required`
- `governance_review_required`

Rules:

- `simulated:true`.
- `executed:false`.
- `real_provider_called:false`.
- `can_trigger_real_execution:false`.
- `send_allowed:false`.
- `publish_allowed:false`.
- `safe_summary` must be sanitized.
- `draft_candidate` never executes.
- `alert_candidate` never sends a real alert.
- `second_brain_candidate` is never saved automatically.
- Responses cannot contain tokens, secrets, raw payloads, raw files, raw
  database payloads, credentials, personal data or external client data.

## Official Statuses

- `corporate_connector_mock_success`
- `corporate_connector_mock_blocked`
- `corporate_connector_mock_error_safe`
- `corporate_connector_requires_human_review`
- `corporate_connector_requires_governance_review`
- `corporate_connector_workspace_blocked`
- `corporate_connector_scope_blocked`
- `corporate_connector_store_scope_blocked`
- `corporate_connector_department_scope_blocked`
- `corporate_connector_permission_blocked`
- `corporate_connector_sensitive_data_blocked`
- `corporate_connector_write_blocked`
- `corporate_connector_action_blocked`
- `corporate_connector_send_blocked`
- `corporate_connector_publish_blocked`
- `corporate_connector_oauth_policy_missing`
- `corporate_connector_not_supported`
- `corporate_connector_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `safe_summary`
- `sanitized_result`
- `email_summary`
- `calendar_summary`
- `document_summary`
- `sheet_summary`
- `base44_summary`
- `supabase_summary`
- `postgres_summary`
- `erp_summary`
- `linx_summary`
- `crm_summary`
- `helpdesk_summary`
- `github_summary`
- `development_context_summary`
- `social_draft_candidate`
- `public_web_summary`
- `transcription_summary_candidate`
- `business_report_candidate`
- `executive_summary_candidate`
- `audit_summary_candidate`
- `training_summary_candidate`
- `store_performance_candidate`
- `supplier_summary_candidate`
- `alert_candidate`
- `dashboard_summary_candidate`
- `second_brain_candidate`
- `freshness_hint`
- `sensitivity_hint`
- `confidence_hint`

Forbidden output includes raw email, calendar, drive, document, sheet, Base44,
Supabase, Postgres, ERP, Linx, CRM, helpdesk, database, GitHub, social,
transcript, audio, payload and message content; tokens; secrets; credentials;
private URLs; full dumps; personal workspace data; external client data; and
cross-tenant memory, cache or storage.

## Future OAuth And Token Policy

- This PR does not implement OAuth.
- Corporate credentials belong only to Grupo Erick.
- Personal tokens cannot be used.
- External client tokens cannot be used.
- Tokens cannot appear in fixtures, logs or memory.
- Refresh tokens require future secure storage namespaced for corporate use.
- OAuth scopes must be minimal.
- Revocation must exist before real integration.
- Secret management, readiness gate, sanitized audit and kill switch are
  mandatory before any real connector.

## Tenant And Corporate Isolation Rules

- Every request needs `workspace_type=corporate`.
- `tenant_id` is always `grupo_erick`.
- `organization_id` is always `grupo_erick`.
- `user_id` and `role` are required.
- A connector belongs to Grupo Erick.
- Grupo Erick cannot use personal or external client tokens.
- Hermes Pessoal cannot access corporate connectors without explicit,
  authenticated workspace switch.
- External clients cannot access corporate connectors.
- Providers and prompts cannot alter `tenant_id` or `organization_id`.
- Future cache, storage, memory and RAG need corporate/grupo_erick namespaces.
- Logs and audit must include tenant, user, role and scopes without sensitive
  payloads.

## Permission And Review Rules

- Read-only requires permission checks.
- Draft-only requires human review before any future real action.
- Financeiro, RH, lotericas, crediario and caixa require governance review.
- Role does not authorize real execution by itself.
- Store managers cannot access other stores without scope.
- Department users cannot expand scope.
- Corporate admin does not remove tenant isolation.
- Future super_admin does not remove audit.
- Human confirmation does not replace readiness gate.

## Blocking Rules

Future PRs must be blocked when they:

- implement real corporate connectors before readiness gate
- implement real OAuth without policy
- add tokens or secrets without secret management
- use personal or external client tokens in corporate context
- execute real send, publish, create, update, delete, Base44/Supabase/Postgres
  write, raw SQL, ERP/Linx writeback, payment, purchase, stock or credit changes
- create or alter real GitHub issues, PRs, commits or merges
- execute Codex or Claude Code with real write access
- use corporate connectors in personal or external client workspaces
- query personal or external client data
- remove required `organization_id`, `tenant_id` or `workspace_type`
- allow prompts/providers to alter `tenant_id` or `organization_id`
- bypass store scope, department scope or Permission Matrix
- store raw payloads, raw files, raw database payloads or sensitive data without
  policy
- allow `send_allowed:true`, `publish_allowed:true`, `executed:true`,
  `real_provider_called:true`, `write_allowed:true` or `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: corporate work remains tenant-scoped.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: connector candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: corporate connector data must stay inside
  identity, secret and payload boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: future connectors need audit,
  cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web reads stay read-only.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription remains sanitized.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: corporate business data stays read-only.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connectors stay separate.
- `SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md`: social output remains draft-only.
- `EXTERNAL_CLIENT_WORKSPACE_CONNECTOR_POLICY.md`: client connectors stay
  isolated from corporate connectors.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe connector changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future corporate flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: connector output cannot become memory without policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: connector output can only become future
  inbox candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve actions.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable connectors.
- `OPERATOR_RUNBOOK.md`: operators must validate future connector changes.

## Security And LGPD

- Data minimization.
- Grupo Erick is an isolated corporate tenant.
- Corporate credentials cannot leave the corporate workspace.
- No personal tokens.
- No external client tokens.
- No personal data without explicit workspace switch and policy.
- No external client data.
- No raw payload.
- No raw file.
- No real storage in this phase.
- No real OAuth.
- Read is not action authorization.
- Draft is not execution.

## Real Read-Only Adapter Readiness Gate

`docs/REAL_READ_ONLY_ADAPTER_READINESS_GATE.md` documents the first executable readiness gate for future real read-only adapters. This PR creates a deterministic, deny-by-default and fail-closed gate, fixture and tests only. It does not create a real adapter, call a provider, activate an integration, enable a feature flag, add OAuth or secrets, or change `/message` or `/confirm`. `READY` means only eligible for a future integration PR; `executed:false`, `real_provider_called:false` and `can_trigger_real_execution:false` remain mandatory in this PR.

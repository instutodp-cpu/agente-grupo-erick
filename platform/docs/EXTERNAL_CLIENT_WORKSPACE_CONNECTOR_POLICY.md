# Hermes Core External Client Workspace Connector Policy

Official contract for future external client workspace connectors.

This document is a contract only. It does not implement real connectors, real
providers, real adapters, OAuth, tokens, secrets, external API calls, storage,
cache, memory, database access, runtime changes, write/action, send, publish,
delete, share, `executed:true` or `real_provider_called:true`.

## What It Is

External Client Workspace Connector Policy defines how Hermes Core may use
future connectors that belong to external SaaS clients. Each external client
uses `workspace_type=external_client`, `tenant_id=client::<client_id>` and its
own connectors, credentials, data, brands and memory.

No external client can access Grupo Erick, Hermes Pessoal or another external
client. This phase uses only documentation, fixtures and tests.

This policy does not replace Tenant Workspace Isolation, Provider Registry,
Security Boundary, Permission Matrix, human review, governance review or
`executed:false`.

## Objectives

- Separate connectors by external client.
- Require `client_id` in every external client flow.
- Require `tenant_id=client::<client_id>`.
- Define future connector candidates.
- Define read-only and draft-only operations.
- Block real write, send, publish, delete and share operations.
- Block token inheritance between clients.
- Block Grupo Erick credentials in external client contexts.
- Block personal credentials in external client contexts.
- Require tenant namespaces for future cache, storage, memory and logs.
- Prepare a safe path for multi-tenant SaaS.

## Official Workspace And Tenant

- `workspace_type`: `external_client`
- `tenant_id`: `client::<client_id>`
- `client_id`: required
- `user_id`: required
- `connector_scope`: `external_client_private`

Rules:

- Every external client connector belongs to exactly one `client_id`.
- `tenant_id` must match `client_id`.
- Client connectors never belong to `grupo_erick`.
- Client connectors never belong to `personal`.
- Client A connectors never belong to client B.
- Prompts cannot alter `tenant_id` or `client_id`.
- Providers/connectors cannot alter `tenant_id`.
- `client_id` cannot be resolved from free-form prompt text alone.
- Future `client_id` resolution must come from authenticated context.

## Official Connector Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `draft_only_candidate`
- `blocked_by_workspace`
- `blocked_by_client_scope`
- `blocked_by_tenant_isolation`
- `blocked_by_permission_matrix`
- `blocked_by_permission_overlay`
- `blocked_by_security_boundary`
- `blocked_by_governance`
- `blocked_by_human_review`
- `blocked_by_oauth_policy`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true`.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode allows real action.
- No mode calls a real API.
- Draft-only never sends or publishes.
- Read-only never changes state.

## External Client Connector Candidates

- `client_gmail_read_candidate`
- `client_gmail_draft_candidate`
- `client_calendar_read_candidate`
- `client_calendar_draft_candidate`
- `client_drive_read_candidate`
- `client_docs_read_candidate`
- `client_sheets_read_candidate`
- `client_contacts_read_candidate`
- `client_crm_read_candidate`
- `client_helpdesk_read_candidate`
- `client_erp_read_candidate`
- `client_business_api_read_candidate`
- `client_social_draft_candidate`
- `client_web_read_candidate`
- `client_transcription_candidate`
- `client_mcp_manual_fixture`

Rules:

- No candidate is implemented in this PR.
- Candidates start read-only or draft-only.
- `client_social_draft_candidate` does not publish.
- `client_gmail_draft_candidate` does not send.
- `client_calendar_draft_candidate` does not create real events.
- `client_erp_read_candidate` does not write.
- `client_transcription_candidate` does not process real audio in this PR.
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
- `crm_summary`
- `helpdesk_summary`
- `erp_summary`
- `business_api_summary`
- `social_content_draft`
- `public_web_summary`
- `transcription_summary_candidate`
- `second_brain_candidate`
- `report_candidate`
- `alert_candidate`
- `dashboard_summary_candidate`

Rules:

- Only read-only or draft-only.
- Draft never executes.
- Summaries are always sanitized.
- `second_brain_candidate` requires Memory Policy and review.
- `alert_candidate` does not send a real notification in this phase.
- `report_candidate` does not export raw sensitive data.

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
- `create_crm_record_real`
- `update_crm_record_real`
- `delete_crm_record_real`
- `create_helpdesk_ticket_real`
- `update_helpdesk_ticket_real`
- `close_helpdesk_ticket_real`
- `erp_writeback_real`
- `create_invoice_real`
- `payment_action_real`
- `publish_social_real`
- `send_social_message_real`
- `upload_media_real`
- `create_user_real`
- `change_role_real`
- `oauth_token_exchange`
- `refresh_token_use`
- `copy_token_between_clients`
- `use_grupo_erick_credentials`
- `use_personal_credentials`
- `cross_client_context_use`
- `cross_client_data_query`
- `cross_client_memory_use`
- `cross_client_cache_use`
- `cross_client_storage_use`

## Future Allowed Use Cases

External clients may eventually:

- summarize their own email.
- draft email replies without sending.
- summarize their own calendar.
- draft calendar events without creating them.
- summarize authorized documents.
- read CRM/helpdesk summaries.
- read ERP/internal API summaries.
- generate social drafts for their own brand.
- read public web information.
- generate report and alert candidates.
- never execute real action automatically.

Grupo Erick cannot use external client connectors, inherit client tokens or
access client storage, memory or cache. Global templates can only be reused when
sanitized.

Hermes Pessoal cannot access external client connectors, use client data as
personal memory or inherit client tokens.

## Official Client Connector Scopes

- `external_client_private`
- `external_client_company`
- `external_client_store`
- `external_client_department`
- `external_client_user`
- `external_client_brand`
- `external_client_manual_fixture`

Rules:

- `connector_scope` is required.
- `client_id` is required.
- `company_id`, `store_id`, `department_id` or `brand_id` may be required by
  the connector type.
- Scope must match the tenant.
- Prompts cannot expand scope.
- Role cannot expand scope by itself.

## Minimum Future Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `client_id`
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

- `workspace_type` must be `external_client`.
- `tenant_id` must be `client::<client_id>`.
- `client_id`, `user_id` and `connector_scope` are required.
- `write_allowed:false`, `action_allowed:false`, `send_allowed:false` and
  `publish_allowed:false` are mandatory.
- `executed:false` and `real_provider_called:false` are mandatory.
- `sanitized_input` cannot contain tokens, secrets, raw payloads, raw messages,
  headers, cookies, credentials or another tenant's data.

## Minimum Future Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `client_id`
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
- Responses cannot contain tokens, secrets, raw payloads, raw files,
  credentials or another client's data.

## Official Statuses

- `external_client_connector_mock_success`
- `external_client_connector_mock_blocked`
- `external_client_connector_mock_error_safe`
- `external_client_connector_requires_human_review`
- `external_client_connector_requires_governance_review`
- `external_client_connector_workspace_blocked`
- `external_client_connector_client_scope_blocked`
- `external_client_connector_permission_blocked`
- `external_client_connector_sensitive_data_blocked`
- `external_client_connector_write_blocked`
- `external_client_connector_action_blocked`
- `external_client_connector_send_blocked`
- `external_client_connector_publish_blocked`
- `external_client_connector_oauth_policy_missing`
- `external_client_connector_not_supported`
- `external_client_connector_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `safe_summary`
- `sanitized_result`
- `email_summary`
- `calendar_summary`
- `document_summary`
- `sheet_summary`
- `crm_summary`
- `helpdesk_summary`
- `erp_summary`
- `business_api_summary`
- `social_draft_candidate`
- `public_web_summary`
- `transcription_summary_candidate`
- `report_candidate`
- `alert_candidate`
- `dashboard_summary_candidate`
- `second_brain_candidate`
- `freshness_hint`
- `sensitivity_hint`
- `confidence_hint`

Forbidden output includes raw email, calendar, drive, document, sheet, CRM,
helpdesk, ERP, database, social, transcript, audio, payload and message content;
tokens; secrets; credentials; private URLs; full dumps; other client data; Grupo
Erick data; personal workspace data; cross-tenant memory, cache or storage.

## Future OAuth And Token Policy

- This PR does not implement OAuth.
- Each client will need its own future credentials.
- Tokens can never be shared between clients.
- Grupo Erick tokens cannot be used by external clients.
- Personal tokens cannot be used by external clients.
- Tokens cannot appear in fixtures, logs or memory.
- Refresh tokens require future secure storage namespaced by `client_id`.
- OAuth scopes must be minimal.
- Revocation must exist before real integration.
- Secret management, readiness gate, sanitized audit and kill switch are
  mandatory before any real connector.

## Tenant And Client Isolation Rules

- Every request needs `workspace_type=external_client`.
- `tenant_id` is always `client::<client_id>`.
- `client_id` and `user_id` are required.
- A connector belongs to one client only.
- Client A cannot query client B.
- Client A cannot use client B tokens, memory, cache or storage.
- Grupo Erick cannot query external clients through client connectors.
- Hermes Pessoal cannot query external clients through client connectors.
- Providers and prompts cannot alter `tenant_id` or `client_id`.
- Future cache, storage, memory and RAG need namespaces by `tenant_id` and
  `client_id`.
- Logs and audit must include `tenant_id` and `client_id` without sensitive
  payloads.

## Permission And Review Rules

- Read-only requires scope and permission checks.
- Draft-only requires human review before any future real action.
- Sensitive content requires governance review.
- Role does not authorize real execution by itself.
- Client admin does not remove tenant isolation.
- Future super_admin does not remove audit or authorize cross-client access.
- Client owner does not authorize write/action in this phase.
- Human confirmation does not replace readiness gate.

## Blocking Rules

Future PRs must be blocked when they:

- implement real client connectors before readiness gate
- implement real OAuth without policy
- add tokens or secrets without secret management
- share tokens between clients
- use Grupo Erick or personal tokens in external client context
- execute real send, publish, create, update, delete, ERP writeback, payment or
  user/role changes
- use client A connector for client B
- query another client's data
- use another client's memory, cache or storage
- use Grupo Erick data or personal data
- remove required `client_id`, `tenant_id` or `workspace_type`
- allow prompts/providers to alter `tenant_id` or `client_id`
- allow cross-client leakage
- store raw payloads, raw files, raw database payloads or sensitive data without
  policy
- allow `send_allowed:true`, `publish_allowed:true`, `executed:true`,
  `real_provider_called:true`, `write_allowed:true` or `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: external clients are isolated tenants.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: connector candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: client connector data must stay inside
  identity, secret and payload boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: future connectors need audit,
  cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web reads stay tenant-scoped.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription remains sanitized and
  tenant-scoped.
- `INTERNAL_BUSINESS_API_READ_ONLY.md`: client business data remains read-only.
- `PERSONAL_WORKSPACE_CONNECTOR_POLICY.md`: personal connectors are separate.
- `SOCIAL_MEDIA_DRAFT_ONLY_APPROVAL.md`: client social connectors remain
  draft-only in this phase.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe client connector
  changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future client flows need safe scenarios.
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
- External clients are isolated tenants.
- Credentials are exclusive per client.
- No shared tokens.
- No other-client data.
- No Grupo Erick data.
- No personal data.
- No raw payload.
- No raw file.
- No real storage in this phase.
- No real OAuth.
- Read is not action authorization.
- Draft is not execution.


## Corporate Workspace Connector Policy

`docs/CORPORATE_WORKSPACE_CONNECTOR_POLICY.md` documents the contract-only
policy for future Grupo Erick corporate connectors. It keeps corporate access
scoped to `workspace_type=corporate`, `tenant_id=grupo_erick` and
`organization_id=grupo_erick`, blocks personal and external-client context,
and does not implement real corporate connectors, OAuth, tokens, APIs, storage,
cache, memory, providers, adapters or runtime changes. It keeps mock-first,
read-only first, human review, governance review, `simulated:true`, `executed:false`, `real_provider_called:false`, `send_allowed:false` and
`publish_allowed:false` mandatory.

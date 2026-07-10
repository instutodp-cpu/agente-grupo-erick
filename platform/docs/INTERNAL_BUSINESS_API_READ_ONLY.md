# Hermes Core Internal Business API Read-Only

Official contract for future safe read-only access to internal business data.

This document is a contract only. It does not implement Supabase, Base44,
Postgres, Linx, ERP, a real Internal Business API, database queries,
migrations, RLS, real providers, real adapters, external API calls, OAuth,
secrets, storage, RAG/vector database, scheduler, cron, runtime changes, write,
action, `executed:true` or `real_provider_called:true`.

## What It Is

Internal Business API Read-Only defines how Hermes Core may safely query
internal business data in the future. It applies to Grupo Erick and external
SaaS clients, always separated by tenant and workspace.

Future data may include compras, financeiro, estoque, vendas, lojas,
fornecedores, RH, treinamento, atendimento, marketing and operations. This
phase uses only mocks and fixtures. It does not call Supabase, Base44, ERP/Linx
or any real database.

## Objectives

- Define which internal domains may be queried in future read-only mode.
- Define allowed query types and blocked action types.
- Require `tenant_id`, `workspace_type` and `user_id` for every future query.
- Separate Hermes Pessoal, Grupo Erick and external clients.
- Prepare a future base for Supabase/Postgres, Base44 Apps and ERP/Linx exports.
- Block write, edit, delete, approve, pay, purchase, send or mutate operations.
- Block tenant leakage.
- Block raw payloads, secrets, tokens and sensitive data without scope.

## Official API Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `blocked_by_tenant_isolation`
- `blocked_by_permission_matrix`
- `blocked_by_security_boundary`
- `blocked_by_permission_overlay`
- `blocked_by_governance`
- `blocked_by_cost_rate_limit`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true` in this phase.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode permits write.
- No mode permits action.
- No mode calls a real API.
- No mode accesses a real database.
- No mode executes a real query.

## Allowed Future Data Domains

- `compras`
- `financeiro`
- `estoque`
- `vendas`
- `lojas`
- `fornecedores`
- `produtos`
- `clientes`
- `crediario`
- `caixa`
- `rh`
- `treinamento`
- `atendimento`
- `marketing`
- `operacoes`
- `desenvolvimento`
- `lotericas`
- `indicadores`
- `auditoria`

Rules:

- financeiro, caixa, crediario and compras are sensitive.
- clientes and RH may contain personal data.
- lotericas may contain highly sensitive data.
- every domain requires `tenant_id`.
- every domain starts read-only.
- any write remains prohibited in this phase.

## Allowed Future Query Types

- `list_summary`
- `get_summary`
- `aggregate_report`
- `trend_report`
- `ranking_report`
- `anomaly_candidate`
- `due_date_summary`
- `inventory_summary`
- `sales_summary`
- `purchase_summary`
- `financial_summary`
- `training_progress_summary`
- `customer_service_summary`
- `audit_summary`
- `store_performance_summary`
- `supplier_performance_summary`

Rules:

- Read-only only.
- Output is always sanitized.
- Aggregated data is preferred.
- Sensitive details require role and scope.
- No query may mutate state.

## Blocked Query And Action Types

- `create_record`
- `update_record`
- `delete_record`
- `approve_record`
- `reject_record`
- `pay_invoice`
- `create_purchase`
- `cancel_purchase`
- `modify_credit`
- `modify_limit`
- `modify_stock`
- `create_user`
- `change_user_role`
- `send_message`
- `export_sensitive_raw_data`
- `run_raw_sql`
- `run_admin_query`
- `bypass_rls`
- `cross_tenant_query`
- `full_database_dump`
- `writeback_to_erp`
- `webhook_action`

## Future Read-Only Use Cases

### Grupo Erick

- supplier purchase summaries
- invoice due-date summaries
- sales rankings
- inactive product candidates
- critical inventory summaries
- cash-flow summaries
- store indicators
- training progress
- discount/deletion audit candidates
- supplier analysis
- crediario summaries
- never pay, approve, purchase, delete or mutate automatically

### Hermes Pessoal

- does not access Grupo Erick internal data by default
- may access corporate data only after a future authenticated workspace switch
- never mixes personal memory with corporate data

### Clientes Externos

- each client accesses only `client::<client_id>`
- reports and indicators for that client only
- never accesses Grupo Erick
- never accesses another client
- templates may be global only when sanitized

## Future Business API Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `company_id`
- `store_id`
- `client_id`
- `domain`
- `capability`
- `intent`
- `provider_id`
- `provider_type`
- `api_mode`
- `data_domain`
- `query_type`
- `read_allowed`
- `write_allowed`
- `action_allowed`
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
- `requires_cost_rate_limit`
- `sanitized_filters`
- `blocked_reason`

Rules:

- `workspace_type`, `tenant_id`, `user_id`, `data_domain` and `query_type` are
  required.
- `write_allowed:false`.
- `action_allowed:false`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `sanitized_filters` cannot contain raw SQL, secrets, tokens, headers,
  cookies, raw payloads or raw messages.
- `tenant_id` cannot come from a prompt.
- `tenant_id` cannot come from an external provider without validation.

## Future Business API Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `domain`
- `capability`
- `provider_id`
- `provider_type`
- `api_mode`
- `data_domain`
- `query_type`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `safe_summary`
- `aggregate_result`
- `sanitized_rows_sample`
- `row_count_hint`
- `freshness_hint`
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
- `aggregate_result` is preferred.
- `sanitized_rows_sample` must be limited.
- Responses cannot contain a full dump.
- Responses cannot contain raw database payloads.
- Responses cannot contain secrets or tokens.
- Responses cannot contain sensitive personal data without policy.

## Official Statuses

- `business_api_mock_success`
- `business_api_mock_blocked`
- `business_api_mock_error_safe`
- `business_api_requires_human_review`
- `business_api_requires_governance_review`
- `business_api_tenant_scope_blocked`
- `business_api_permission_blocked`
- `business_api_sensitive_data_blocked`
- `business_api_write_blocked`
- `business_api_raw_query_blocked`
- `business_api_not_supported`
- `business_api_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `safe_summary`
- `aggregate_result`
- `sanitized_rows_sample`
- `metric_summary`
- `trend_summary`
- `ranking_summary`
- `anomaly_candidate_summary`
- `due_date_summary`
- `inventory_summary`
- `sales_summary`
- `purchase_summary`
- `financial_summary`
- `training_progress_summary`
- `audit_summary`
- `store_performance_summary`
- `supplier_performance_summary`
- `freshness_hint`
- `sensitivity_hint`
- `confidence_hint`

Blocked output fields include raw SQL, raw queries, raw database payloads, full
database dumps, raw payloads, raw messages, secrets, tokens, headers, cookies,
credentials, passwords, authorizations, full CPF/CNPJ, full card numbers, bank
accounts, payment credentials, sensitive personal data, private employee data,
customer private data and cross-tenant data.

## Related Provider Candidates

- `supabase_read_only_candidate`
- `postgres_read_only_candidate`
- `base44_read_only_candidate`
- `erp_export_fixture`
- `linx_read_only_candidate`
- `internal_business_api_manual_fixture`

Rules:

- None of these providers are implemented in this PR.
- Future Supabase starts read-only.
- Future Postgres requires RLS/tenant policy first.
- Future Base44 requires its own boundary.
- Future ERP/Linx requires mapping and data policy.
- Any real provider requires a future readiness gate.
- No integration may write to ERP in this phase.

## Tenant And Workspace Rules

- Every future request needs `workspace_type`, `tenant_id` and `user_id`.
- Hermes Pessoal uses `personal::<user_id>`.
- Grupo Erick uses `grupo_erick`.
- External clients use `client::<client_id>`.
- Grupo Erick internal data always uses `tenant_id=grupo_erick`.
- External client data always uses `tenant_id=client::<client_id>`.
- Providers cannot alter `tenant_id`.
- Prompts cannot alter `tenant_id`.
- Responses can return only data from the source tenant.
- Cross-tenant queries are blocked.
- Future internal-data cache needs tenant namespace.
- Future RAG/vector DB for internal data needs tenant namespace.

## Permission And Role Rules

- Role never authorizes real execution by itself.
- financeiro requires authorized role and high review.
- compras requires authorized role and confirmation.
- RH requires authorized role and minimization.
- crediario/clientes require minimization and clear policy.
- loja may require `store_id`.
- multi-company scope may require `company_id`.
- external_client requires `client_id`.
- Future super_admin does not remove audit.
- Future super_admin does not remove `tenant_id`.
- Future super_admin does not authorize write in this phase.

## Audit, Cost, Rate And Security Rules

- Every future sandbox needs an audit event candidate.
- Every future sandbox needs `data_domain`.
- Every future sandbox needs `sensitivity_level`.
- Every future sandbox needs `tenant_id`.
- Every future sandbox needs permission check.
- Provider with unknown risk cannot become real.
- Fallback cannot call another real provider.
- Automatic real retry is prohibited.
- This PR does not create a real rate limiter, budget tracker, API, database or
  storage.

## Blocking Rules

Future PRs must be blocked when they:

- add real Supabase before readiness gate
- add real Postgres before readiness gate
- add real Base44 before readiness gate
- add real ERP/Linx before readiness gate
- add real queries
- add raw SQL
- add writeback
- add create/update/delete
- add real approval/rejection
- add real payment
- add real purchase
- add real stock modification
- add real credit/limit modification
- remove required `tenant_id`
- remove required `workspace_type`
- allow prompts to alter `tenant_id`
- allow providers to alter `tenant_id`
- allow cross-tenant leakage
- save a full database dump
- save raw database payloads
- save sensitive data without policy
- allow `executed:true`
- allow `real_provider_called:true`
- allow `write_allowed:true`
- allow `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: every future query must stay tenant-scoped.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: internal business data must stay inside
  security boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: every future sandbox needs
  audit, cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web reads do not unlock internal
  data.
- `TRANSCRIPTION_INTAKE_SANDBOX.md`: transcription intake does not unlock
  internal data.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe internal API
  changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future internal read flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: internal output cannot become memory without policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: internal output can only become future
  inbox candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve provider
  calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable business API
  agents.
- `OPERATOR_RUNBOOK.md`: operators must validate future internal API changes.

## Security And LGPD

- Data minimization.
- Internal data is sensitive by default.
- Personal data must stay in the smallest possible scope.
- Client data requires tenant isolation.
- Grupo Erick data cannot leak to Hermes Pessoal.
- Grupo Erick data cannot leak to external clients.
- External client data cannot leak to another external client.
- Retention must be defined before real storage.
- Sensitive export requires its own future policy.
- Write remains prohibited in this phase.

## Personal Workspace Connector Policy

`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md` covers future personal
connectors. Internal business read-only work cannot use personal Gmail,
Calendar, Drive, Contacts, OAuth tokens or personal memory as corporate
operational context.

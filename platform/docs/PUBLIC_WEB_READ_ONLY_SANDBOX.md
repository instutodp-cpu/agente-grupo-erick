# Hermes Core Public Web Data Read-Only Sandbox

Official contract for future public web data read-only sandbox behavior.

This document is a contract only. It does not implement Firecrawl, Bright Data,
Scrapeless, real crawling, real scraping, real provider calls, real adapters,
OAuth, secrets, storage, RAG/vector database, scheduler, cron, runtime changes
or any path to `executed:true` or `real_provider_called:true`.

## What It Is

Public Web Data Read-Only Sandbox defines how Hermes Core may safely read public
web data in the future. It is intended for public prices, promotions,
suppliers, competitors, travel, lodging, public documents and market research.

In this phase it uses only contracts, fixtures and tests. It does not call real
providers, does not scrape real pages, does not store raw HTML, does not create
a database and does not replace Provider Registry, Security Boundary,
Permission Overlay, Mock Adapter Harness, Audit/Cost/Rate Limit or Tenant
Workspace Isolation.

## Objectives

- Define which public data may be read in the future.
- Define allowed and blocked public source types.
- Define sanitized output for public data.
- Block raw HTML, raw pages, raw payloads and authenticated content.
- Block private or sensitive data collection.
- Block login, checkout, cart, form submit, purchase, reservation and payment.
- Require `workspace_type`, `tenant_id` and `user_id` for every future read.
- Require audit, cost and rate limit contracts before any real provider.
- Prepare a safe future path for Firecrawl read-only without implementing it.

## Official Sandbox Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `blocked_by_registry`
- `blocked_by_security_boundary`
- `blocked_by_permission_overlay`
- `blocked_by_tenant_isolation`
- `blocked_by_cost_rate_limit`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true` in this phase.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- Every mode keeps `can_trigger_real_execution:false`.
- No mode permits write/action.
- No mode logs in, submits forms, checks out, purchases, reserves or pays.
- No mode calls a real provider.

## Allowed Public Web Source Types

- `public_product_page`
- `public_price_page`
- `public_supplier_page`
- `public_competitor_page`
- `public_market_article`
- `public_documentation_page`
- `public_travel_listing`
- `public_hotel_listing`
- `public_promotion_page`
- `public_search_result_summary`
- `public_government_page`
- `public_regulatory_page`

Rules:

- Public content only.
- Read-only only.
- No authentication.
- No private data.
- No paywall bypass.
- No aggressive scraping.
- No mass collection.
- No raw HTML storage.

## Blocked Source Types

- `authenticated_page`
- `private_dashboard`
- `customer_portal`
- `employee_portal`
- `bank_portal`
- `payment_page`
- `checkout_page`
- `cart_page`
- `order_creation_page`
- `login_page`
- `password_reset_page`
- `private_api_response`
- `raw_social_dm`
- `private_social_content`
- `age_restricted_content`
- `sensitive_personal_data_page`
- `confidential_document`
- `malware_or_phishing_page`

## Future Read-Only Use Cases

### compras

- public supplier research
- public price comparison
- public product checks
- public promotion analysis
- public availability monitoring
- never buy, reserve, order or negotiate automatically

### financeiro

- public market information
- public indicators
- never access banks, financial portals, accounts, payments or private data
- external finance remains high/critical review

### marketing

- public competitor research
- campaign inspiration
- public trend analysis
- public promotion reading
- never post, comment, reply to DMs or interact publicly

### treinamento

- public educational content
- public documentation
- sanitized summaries
- never copy protected content extensively

### desenvolvimento

- public documentation
- public issue/docs summaries
- never write to repositories, open PRs, merge or change code automatically

### Hermes Pessoal

- public travel research
- public lodging
- public promotions
- public documents
- never mix with Grupo Erick without explicit authenticated workspace switch

### Clientes Externos

- public reading inside the client's tenant
- public research for that client
- never access Grupo Erick
- never access another client

## Future Sandbox Request Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `role`
- `domain`
- `capability`
- `intent`
- `provider_id`
- `provider_type`
- `sandbox_mode`
- `source_type`
- `query_intent`
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
- `requires_permission_overlay`
- `requires_tenant_isolation`
- `requires_cost_rate_limit`
- `confirmation_required`
- `sanitized_input`
- `blocked_reason`

Rules:

- `workspace_type`, `tenant_id` and `user_id` are required.
- `write_allowed:false`.
- `action_allowed:false`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `sanitized_input` cannot contain raw messages, internal payloads or secrets.

## Future Sandbox Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `domain`
- `capability`
- `provider_id`
- `provider_type`
- `sandbox_mode`
- `source_type`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `safe_summary`
- `public_result_snippet`
- `sanitized_output`
- `source_freshness_hint`
- `confidence_hint`
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
- `safe_summary` cannot contain raw HTML.
- `public_result_snippet` must be short and sanitized.
- `sanitized_output` cannot contain raw pages, raw payloads, raw HTML or
  sensitive data.
- `audit_event_candidate` must follow the audit/cost/rate limit contract.

## Official Statuses

- `sandbox_mock_success`
- `sandbox_mock_blocked`
- `sandbox_mock_error_safe`
- `sandbox_requires_human_review`
- `sandbox_requires_governance_review`
- `sandbox_source_not_allowed`
- `sandbox_source_not_public`
- `sandbox_not_supported`
- `sandbox_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `safe_summary`
- `public_result_snippet`
- `comparison_summary`
- `price_observation`
- `promotion_observation`
- `supplier_public_summary`
- `competitor_public_summary`
- `travel_public_summary`
- `documentation_summary`
- `market_public_summary`
- `freshness_hint`
- `confidence_hint`

Blocked output fields include raw HTML, full page text, raw payloads, raw user
messages, private URLs, checkout data, cart data, payment data, login data,
credentials, tokens, secrets, cookies and headers.

## Related Provider Candidates

- `firecrawl`
- `bright_data`
- `scrapeless`
- `public_web_manual_fixture`

Rules:

- None of these providers are implemented in this PR.
- Future Firecrawl starts read-only.
- Bright Data and Scrapeless require high review.
- Any paid provider requires budget/cost/rate limit before use.
- Any real provider requires a future readiness gate.

## Tenant And Workspace Rules

- Every future public web request needs `workspace_type`, `tenant_id` and
  `user_id`.
- Hermes Pessoal uses `personal::<user_id>`.
- Grupo Erick uses `grupo_erick`.
- External clients use `client::<client_id>`.
- Public output can be used only in the tenant-scoped workspace.
- Future public research cache requires a clear policy.
- Sensitive or personalized data cannot go to global cache.
- Providers cannot alter `tenant_id`.
- Prompts cannot alter `tenant_id`.
- External clients cannot query Grupo Erick context.
- Grupo Erick cannot use personal memory as operational context.

## Audit, Cost And Rate Limit Rules

- Every future sandbox needs an audit event candidate.
- Every future sandbox needs `cost_risk`.
- Every future sandbox needs `rate_limit_risk`.
- Provider with unknown cost risk cannot become real sandbox.
- Provider with unknown rate-limit risk cannot become real sandbox.
- Fallback cannot call another real provider.
- Automatic real retry is prohibited.
- This PR does not create a real rate limiter or budget tracker.

## Blocking Rules

Future PRs must be blocked when they:

- add real provider calls
- add real Firecrawl before readiness gate
- add real Bright Data before readiness gate
- add real Scrapeless before readiness gate
- add real scraping
- add real crawling
- add OAuth or secrets
- access authenticated pages
- access private portals
- access checkout, cart or payment pages
- submit forms
- purchase, reserve or order
- store raw HTML
- store full page text without policy
- store sensitive data
- remove required `tenant_id`
- remove required `workspace_type`
- allow providers to alter `tenant_id`
- allow prompts to alter `tenant_id`
- allow cross-tenant leakage
- allow `executed:true`
- allow `real_provider_called:true`
- allow `write_allowed:true`
- allow `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: every future read must stay tenant-scoped.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: public web data must stay inside security
  boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: every future sandbox needs
  audit, cost and rate-limit rules.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe sandbox changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future public web flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: public output cannot become memory without policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: public output can only become future inbox
  candidates after sanitization.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve provider
  calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable web agents.
- `OPERATOR_RUNBOOK.md`: operators must validate future public web changes.

## Security And LGPD

- Public data only.
- Data minimization.
- No sensitive personal data.
- No private data.
- No authentication.
- No raw storage.
- Retention must be defined before real storage.
- External clients remain isolated.
- Grupo Erick remains isolated.
- Hermes Pessoal remains isolated.

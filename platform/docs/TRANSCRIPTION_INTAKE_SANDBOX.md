# Hermes Core Transcription Intake Sandbox

Official contract for future audio, video and transcript intake in a safe
sandbox.

This document is a contract only. It does not implement AssemblyAI, Whisper,
real providers, real adapters, external API calls, uploads, downloads, audio
processing, real transcription, raw audio storage, raw transcript storage,
storage, RAG/vector database, scheduler, cron, queue, runtime changes or any
path to `executed:true` or `real_provider_called:true`.

## What It Is

Transcription Intake Sandbox defines how Hermes Core may safely accept audio,
video and transcript inputs in the future. It is intended for training,
meetings, customer service samples, WhatsApp audio candidates, internal
podcasts and sanitized summaries.

In this phase it uses only contracts, fixtures and tests. It does not call
AssemblyAI, does not call Whisper, does not process real files, does not save
audio, does not save raw transcripts, does not create storage and does not
replace Tenant Workspace Isolation, Security Boundary, Provider Registry,
Permission Overlay, Mock Adapter Harness or Audit/Cost/Rate Limit.

## Objectives

- Define which audio, video and transcript inputs may be accepted in the future.
- Define allowed and blocked source types.
- Define mandatory sanitized output.
- Block raw audio, raw transcripts, raw payloads and sensitive data.
- Block retention without policy.
- Require `tenant_id`, `workspace_type` and `user_id` for every future flow.
- Prepare a safe future path for AssemblyAI read-only/sanitized behavior.
- Require human review and governance review for sensitive content.

## Official Intake Modes

- `disabled`
- `mock_only`
- `read_only_candidate`
- `sanitized_transcription_candidate`
- `blocked_by_registry`
- `blocked_by_security_boundary`
- `blocked_by_permission_overlay`
- `blocked_by_tenant_isolation`
- `blocked_by_cost_rate_limit`
- `blocked_by_retention_policy`
- `safe_fixture_response`
- `safe_error_response`

Rules:

- Every mode keeps `simulated:true` in this phase.
- Every mode keeps `executed:false`.
- Every mode keeps `real_provider_called:false`.
- No mode uploads real audio.
- No mode stores real audio.
- No mode stores raw transcripts.
- No mode calls a real provider.
- No mode permits write/action.

## Allowed Future Source Types

- `audio_meeting_recording`
- `audio_training_content`
- `audio_customer_service_sample`
- `audio_whatsapp_message_candidate`
- `video_training_content`
- `video_meeting_recording`
- `podcast_training_content`
- `manual_transcript_fixture`
- `sanitized_transcript_text`
- `synthetic_audio_fixture`

Rules:

- This phase uses synthetic fixtures only.
- Future real audio requires `tenant_id`, `user_id`, `retention_policy` and
  `consent_policy`.
- Future WhatsApp audio requires a specific policy before any real use.
- Internal training content must remain scoped to Grupo Erick or the external
  client tenant.
- Hermes Pessoal must remain isolated from Grupo Erick.

## Blocked Source Types

- `raw_audio_without_consent`
- `raw_audio_without_tenant`
- `raw_audio_without_retention_policy`
- `raw_transcript_without_sanitization`
- `medical_sensitive_audio`
- `financial_sensitive_audio`
- `payment_or_card_audio`
- `password_or_secret_audio`
- `legal_confidential_audio`
- `employee_private_audio`
- `customer_private_audio_without_policy`
- `child_audio_without_policy`
- `unknown_source_audio`
- `external_client_cross_tenant_audio`

## Future Sandbox Use Cases

### treinamento

- transform class or audio content into a sanitized summary
- create a module outline
- create a quiz draft
- extract main points
- never save raw transcripts in this phase

### atendimento

- summarize support interactions with minimized data
- identify general intent
- generate a draft response suggestion
- never expose sensitive data

### RH

- summarize internal training
- identify recurring questions
- never process a private employee conversation without policy

### marketing

- turn audio into draft content
- generate campaign ideas
- never publish automatically

### desenvolvimento

- summarize technical meetings
- generate PR checklist candidates
- never change code automatically

### Hermes Pessoal

- summarize personal audio
- organize personal notes
- never mix with Grupo Erick

### Clientes Externos

- summarize content inside the client tenant
- never access Grupo Erick
- never access another client

## Future Intake Request Fields

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
- `intake_mode`
- `source_type`
- `media_type`
- `language_hint`
- `duration_hint_seconds`
- `sensitivity_level`
- `consent_policy`
- `retention_policy`
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
- `sanitized_input`
- `blocked_reason`

Rules:

- `workspace_type`, `tenant_id` and `user_id` are required.
- `consent_policy` is required for future real audio.
- `retention_policy` is required for future real audio.
- `write_allowed:false`.
- `action_allowed:false`.
- `executed:false`.
- `real_provider_called:false` in this phase.
- `sanitized_input` cannot contain raw messages, raw audio, raw transcripts,
  internal payloads or secrets.

## Future Intake Response Fields

- `trace_id`
- `workspace_type`
- `tenant_id`
- `user_id`
- `domain`
- `capability`
- `provider_id`
- `provider_type`
- `intake_mode`
- `source_type`
- `status`
- `simulated`
- `executed`
- `real_provider_called`
- `can_trigger_real_execution`
- `sanitized_summary`
- `transcript_quality_hint`
- `language_detected_hint`
- `duration_hint_seconds`
- `action_items_candidate`
- `quiz_candidate`
- `training_module_candidate`
- `sensitive_content_flags`
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
- `sanitized_summary` cannot contain a raw transcript.
- `action_items_candidate` is always draft.
- `quiz_candidate` is always draft.
- `training_module_candidate` is always draft.
- `sensitive_content_flags` cannot expose raw sensitive data.
- `audit_event_candidate` must follow the audit/cost/rate limit contract.

## Official Statuses

- `transcription_mock_success`
- `transcription_mock_blocked`
- `transcription_mock_error_safe`
- `transcription_requires_human_review`
- `transcription_requires_governance_review`
- `transcription_source_not_allowed`
- `transcription_missing_consent_policy`
- `transcription_missing_retention_policy`
- `transcription_sensitive_content_blocked`
- `transcription_not_supported`
- `transcription_deprecated`

No status authorizes real execution.

## Allowed Sanitized Output

- `sanitized_summary`
- `transcript_quality_hint`
- `language_detected_hint`
- `duration_hint`
- `topic_summary`
- `action_items_candidate`
- `training_module_candidate`
- `quiz_candidate`
- `faq_candidate`
- `customer_intent_summary`
- `sentiment_hint`
- `sensitive_content_flags`
- `confidence_hint`

Blocked output fields include raw audio, raw transcripts, full transcripts, raw
payloads, raw messages, private URLs, audio URLs, file URLs, download URLs,
credentials, tokens, secrets, cookies, headers, payment data, card data,
password data, medical data and legal sensitive data.

## Related Provider Candidates

- `assemblyai`
- `whisper_candidate`
- `transcription_manual_fixture`
- `synthetic_audio_fixture`

Rules:

- None of these providers are implemented in this PR.
- Future AssemblyAI starts sanitized/read-only.
- Future Whisper requires its own boundary review.
- Any paid provider requires budget/cost/rate limit before use.
- Any real provider requires a future readiness gate.
- No provider may save raw audio or raw transcripts without approved policy.

## Tenant And Workspace Rules

- Every future transcription request needs `workspace_type`, `tenant_id` and
  `user_id`.
- Hermes Pessoal uses `personal::<user_id>`.
- Grupo Erick uses `grupo_erick`.
- External clients use `client::<client_id>`.
- Output can only be used in the source tenant.
- Providers cannot alter `tenant_id`.
- Prompts cannot alter `tenant_id`.
- External clients cannot query Grupo Erick content.
- Grupo Erick cannot use personal audio or personal memory as operational
  context.

## Audit, Cost, Rate And Retention Rules

- Every future sandbox needs an audit event candidate.
- Every future sandbox needs `cost_risk`.
- Every future sandbox needs `rate_limit_risk`.
- Every future real-audio sandbox needs `retention_policy`.
- Every future real-audio sandbox needs `consent_policy`.
- Provider with unknown cost risk cannot become real sandbox.
- Provider with unknown rate-limit risk cannot become real sandbox.
- Fallback cannot call another real provider.
- Automatic real retry is prohibited.
- This PR does not create a real rate limiter, budget tracker, upload path or
  storage.

## Blocking Rules

Future PRs must be blocked when they:

- add real provider calls
- add real AssemblyAI before readiness gate
- add real Whisper before readiness gate
- upload real audio
- download real audio
- add real transcription
- store raw audio
- store raw transcripts
- store full transcripts without policy
- store sensitive data
- process audio without `tenant_id`
- process audio without `workspace_type`
- process audio without `user_id`
- process audio without `consent_policy`
- process audio without `retention_policy`
- allow providers to alter `tenant_id`
- allow prompts to alter `tenant_id`
- allow cross-tenant leakage
- allow `executed:true`
- allow `real_provider_called:true`
- allow `write_allowed:true`
- allow `action_allowed:true`

## Relationship With Existing Contracts

- `TENANT_WORKSPACE_ISOLATION.md`: every future intake must stay tenant-scoped.
- `EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`: provider candidates must be
  registered before sandbox work.
- `INTEGRATION_SECURITY_BOUNDARY.md`: audio and transcript intake must stay
  inside security boundaries.
- `EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md`: provider/domain/capability use
  must pass overlay rules.
- `EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md`: this phase uses only safe mock
  and fixture behavior.
- `EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md`: every future sandbox needs
  audit, cost, rate and stop-condition rules.
- `PUBLIC_WEB_READ_ONLY_SANDBOX.md`: public web and transcription sandboxes
  share read-only and no-real-provider requirements.
- `GOVERNANCE_CHECK_REPORT.md`: governance can block unsafe transcription
  changes.
- `PERMISSION_MATRIX.md`: domain permissions remain primary.
- `GOLDEN_SCENARIOS.md`: future transcription flows need safe scenarios.
- `DOMAIN_ONBOARDING.md`: new domains still require onboarding.
- `MEMORY_POLICY.md`: transcript-derived output cannot become memory without
  policy.
- `USER_PEER_MEMORY_SCOPES.md`: user/peer memory remains scoped.
- `SECOND_BRAIN_INBOX_CONTRACT.md`: sanitized summaries can only become future
  inbox candidates after review.
- `QUALITY_SCORE_FEEDBACK_LOOP.md`: quality scores cannot approve provider
  calls.
- `SKILL_CANDIDATE_REGISTRY.md`: skills cannot become executable transcription
  agents.
- `OPERATOR_RUNBOOK.md`: operators must validate future transcription changes.

## Security And LGPD

- Data minimization.
- No raw audio in this phase.
- No raw transcripts in this phase.
- No sensitive personal data without policy.
- No private data without scope.
- No raw storage.
- Retention must be defined before real storage.
- Consent must be defined before real audio.
- External clients remain isolated.
- Grupo Erick remains isolated.
- Hermes Pessoal remains isolated.

## Internal Business API Read-Only

`docs/INTERNAL_BUSINESS_API_READ_ONLY.md` covers future internal business data
queries. Transcription intake does not authorize internal database queries, raw
SQL, writeback, tenant crossing or real provider calls.

## Personal Workspace Connector Policy

`docs/PERSONAL_WORKSPACE_CONNECTOR_POLICY.md` covers future personal
connectors. Transcription intake does not authorize Gmail, Calendar, Drive,
OAuth, token storage, send/write/delete/share or real connector calls.

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

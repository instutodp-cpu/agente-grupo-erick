# Hermes Core Quality Score + Feedback Loop

Contrato oficial do Quality Score + Feedback Loop do Hermes Core. Nesta fase
isto e apenas documentacao/contrato: nao usa LLM real, nao usa storage real,
nao altera runtime e nao autoriza `executed:true`.

## O que e o Quality Score

Quality Score e um contrato futuro para avaliar qualidade de respostas, planos,
mocks, sugestoes, inbox items e skill candidates. Ele pode medir:

- utilidade
- seguranca
- aderencia ao dominio
- completude
- clareza
- risco
- necessidade de revisao humana
- sinais de skill candidate

## Dimensoes oficiais

- `usefulness_score`
- `safety_score`
- `domain_fit_score`
- `completeness_score`
- `clarity_score`
- `risk_score`
- `human_review_score`
- `skill_candidate_signal_score`

Cada dimensao vai de `0` a `100`.

## Score final

- `quality_score_total` tambem varia de `0` a `100`
- score baixo nao executa nada
- score alto tambem nao autoriza execucao real nesta fase
- score alto pode apenas sugerir memory candidate ou skill candidate signal
- qualquer acao sensivel continua exigindo confirmacao humana

## Faixas

- `90` a `100`: `excellent`
- `75` a `89`: `good`
- `60` a `74`: `usable_with_review`
- `40` a `59`: `weak_needs_revision`
- `0` a `39`: `rejected_or_unsafe`

Regras:

- `rejected_or_unsafe` nunca pode virar skill candidate
- `weak_needs_revision` precisa de revisao humana
- `usable_with_review` pode ser usado so como rascunho
- `good` e `excellent` podem sugerir memory candidate ou skill candidate
  signal, nunca execucao real

## Tipos de feedback

- `positive`
- `negative`
- `correction`
- `unsafe`
- `incomplete`
- `wrong_domain`
- `needs_more_context`
- `approved_as_draft`
- `rejected`

Cada feedback pode indicar motivo, dominio, risco, se precisa correcao, se pode
virar learning signal, se pode gerar skill candidate signal e se deve bloquear
repeticao.

## Feedback loop

1. Hermes gera resposta, plano, mock ou sugestao.
2. Usuario ou operador da feedback.
3. Feedback e sanitizado.
4. Feedback e classificado.
5. Se seguro, vira learning signal.
6. Se repetido, pode sugerir skill candidate signal.
7. Humano revisa.
8. Nada executa real automaticamente.

## Relacao com outros contratos

- Second Brain Inbox pode receber feedback como `audit_event` ou
  `skill_candidate_signal` no futuro.
- Memory Policy e User / Peer Memory Scopes continuam obrigatorios.
- Skill Candidate Registry continua em `draft`, `mock-first` e com revisao
  humana.
- Permission Matrix e Golden Scenarios continuam como base de expansao.

## Seguranca

- nao guardar `rawMessage`
- nao guardar `payload` interno
- nao guardar `secret`
- nao guardar `stack trace` completo
- nao guardar `token`, `env`, `headers`, `cookies` ou `credentials`
- feedback sensivel exige revisao humana
- LGPD: minimizacao e retencao limitada

## Default rules

- `executed = false`
- `real_execution_allowed = false`
- `llm_scoring_implemented = false`
- `storage_implemented = false`
- `automatic_learning_allowed = false`
- `human_review_required_for_sensitive_feedback = true`
- `mock_first = true`

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` pode consumir este contrato como area de
checagem. O Quality Score nao substitui governanca e nao autoriza execucao
real.

## External Integration Provider Registry

Provider-related feedback or quality signals must reference
`docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` before any future integration
work. Quality scores do not approve provider calls, OAuth scopes, real writes
or `executed:true`.

## Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` applies before provider-related quality
signals can influence future work. Quality scores cannot loosen boundary rules,
approve secrets, approve writes or authorize `executed:true`.

## External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` applies before quality or
feedback signals can suggest future provider work. Scores cannot override the
overlay or approve writes, actions or `executed:true`.

## External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` can provide synthetic outputs
for future quality checks. Quality scores cannot convert mock results into real
provider calls.

## External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` can inform future quality or
feedback review, but scores cannot approve cost, retry, fallback or real
provider calls.

## Tenant and Workspace Isolation

`docs/TENANT_WORKSPACE_ISOLATION.md` keeps future feedback and learning signals
scoped by workspace and tenant. Quality scores cannot approve cross-tenant
context use.

## Public Web Data Read-Only Sandbox

`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md` may provide synthetic public web outputs
for future quality review. Quality scores cannot approve real scraping, provider
calls, checkout, form submit or raw storage.

## Transcription Intake Sandbox

`docs/TRANSCRIPTION_INTAKE_SANDBOX.md` may provide synthetic or sanitized
transcription outputs for future quality review. Quality scores cannot approve
real transcription providers, uploads, audio processing, raw transcript storage
or `executed:true`.

# Hermes Core External Integration Provider Registry

Contrato oficial do External Integration Provider Registry do Hermes Core.
Esta fase apenas documenta e valida como provedores externos futuros devem ser
catalogados antes de qualquer integracao real.

Esta PR nao implementa provider real, adapter real, OAuth real, secrets, scanner
real, CI gate real, storage real, chamadas externas ou qualquer mudanca de
runtime. Nenhum status deste registry autoriza `executed:true`.

## O que e

External Integration Provider Registry e um contrato futuro para catalogar
provedores externos e classificar:

- risco
- dominios permitidos
- tipos de dados acessados
- custo
- compliance
- OAuth e secrets
- fallback
- permissoes
- requisitos de auditoria

O registry nao executa integracao real, nao cria adapter, nao autoriza escrita,
nao substitui Permission Matrix, nao substitui confirmacao humana e nao autoriza
`executed:true`.

## Tipos oficiais de provedores

### public_web_scraping

Exemplos futuros: Firecrawl, Bright Data, Scrapeless.

Uso futuro: pesquisa publica, paginas, precos, fornecedores, hoteis, passagens
e produtos.

Risco: `medium` ou `high`, dependendo do site, custo, volume e compliance.
Escrita e acao real sao proibidas. Requer compliance, rate limit e fallback
policy antes de qualquer sandbox.

### app_integration_hub

Exemplo futuro: Composio.

Uso futuro: Gmail, Calendar, GitHub, Slack, Notion e outros apps.

Risco: `high` ou `critical`. Escrita bloqueada nesta fase. Requer OAuth, escopo
granular, tenant isolation e confirmacao humana.

### transcription_provider

Exemplo futuro: AssemblyAI.

Uso futuro: transcricao de reunioes, videos, treinamentos e audios.

Risco: `medium` ou `high` por dados pessoais. Storage bruto e proibido sem
politica. Deve gerar apenas `sanitized_summary` para inbox futuro.

### social_media_provider

Exemplos futuros: social media API, Zernio-like, Buffer-like, Meta, LinkedIn e
TikTok.

Uso futuro: rascunho, agendamento, leitura de comentarios ou DMs.

Risco: `high` ou `critical`. Postagem real e resposta publica automatica sao
proibidas nesta fase.

### direct_platform_api

Exemplo futuro: X/Twitter direto.

Uso futuro: leitura publica ou rascunho de post.

Risco: `high`. Post real e proibido. Pode ter custo alto e impacto
reputacional.

### internal_business_api

Exemplos futuros: ERP, CRM, Supabase, Base44, apps do Grupo Erick, sistema de
compras, financeiro e treinamento.

Uso futuro: leitura operacional controlada.

Risco: `high` ou `critical`. Escrita real e proibida nesta fase. Requer tenant,
role, audit, confirmacao e kill switch.

### internal_mcp_server

Exemplo futuro: MCP proprio para dados internos.

Uso futuro: expor ferramentas internas de forma governada.

Risco: `critical` se tiver actions. Deve comecar read-only e mock-first. Nunca
deve expor secrets, tokens, env ou payload interno.

### developer_platform

Exemplos futuros: GitHub connector, Linear, Figma e Canva.

Uso futuro: leitura de PRs, issues, docs e designs.

Risco: `medium` ou `high`. Escrita real e proibida nesta fase. Qualquer mudanca
em repositorio exige confirmacao e PR separada.

## Campos minimos de um provider registry item

- `provider_id`
- `provider_name`
- `provider_type`
- `description`
- `risk_level`
- `allowed_domains`
- `blocked_domains`
- `read_allowed`
- `write_allowed`
- `action_allowed`
- `requires_oauth`
- `requires_secret`
- `requires_tenant_isolation`
- `requires_user_scope`
- `requires_human_confirmation`
- `requires_governance_review`
- `stores_external_data`
- `stores_raw_content`
- `can_trigger_real_execution`
- `executed`
- `cost_risk`
- `compliance_risk`
- `data_retention_risk`
- `rate_limit_risk`
- `fallback_policy`
- `audit_requirements`
- `forbidden_use_cases`
- `allowed_use_cases`
- `status`

Regras obrigatorias:

- `can_trigger_real_execution = false` sempre
- `executed = false` sempre
- `write_allowed = false` nesta fase
- `action_allowed = false` nesta fase
- `stores_raw_content = false` nesta fase
- `requires_human_confirmation = true` para `medium`, `high` e `critical`
- `requires_governance_review = true` para qualquer provider externo
- provider com OAuth ou secrets deve ser `high` ou `critical`
- provider de rede social com postagem e `critical`
- provider interno financeiro ou compras e `critical`
- provider que acessa Gmail ou Calendar e `high` ou `critical`

## Status oficiais

- `proposed`
- `documented`
- `approved_for_mock_only`
- `approved_for_read_only_sandbox`
- `blocked`
- `deprecated`

Regras:

- nenhum status autoriza execucao real
- `approved_for_read_only_sandbox` ainda nao permite escrita
- `blocked` impede evolucao
- `deprecated` nao deve ser usado em novos fluxos

## Provider candidates iniciais

Estes itens sao candidatos documentais. Nenhum deles e integrado nesta PR.

| provider_id | provider_type | risco | uso futuro | write/action |
| --- | --- | --- | --- | --- |
| `firecrawl` | `public_web_scraping` | high quando exigir secret | scrape/search publico | false |
| `bright_data` | `public_web_scraping` | high | fallback scraping/serp/datasets | false |
| `scrapeless` | `public_web_scraping` | high | fallback/proxy/scraping dificil | false |
| `composio` | `app_integration_hub` | critical | apps e OAuth hub | false |
| `google_workspace_super` | `app_integration_hub` | critical | Gmail/Calendar/Docs/Meet | false |
| `assemblyai` | `transcription_provider` | high | transcricao | false |
| `social_media_api` | `social_media_provider` | critical | rascunho/agendamento/comentarios | false |
| `x_direct_api` | `direct_platform_api` | high | leitura publica/rascunho | false |
| `internal_business_api` | `internal_business_api` | critical | ERP/CRM/Supabase/Base44/apps internos | false |
| `internal_mcp_server` | `internal_mcp_server` | critical | ferramentas internas governadas | false |
| `github_connector` | `developer_platform` | high | leitura PR/issues/repos | false |

## Regras por dominio

### compras

Pode futuramente ler fornecedor, produto e preco publico. Nao pode criar compra
real, alterar fornecedor real ou escrever em ERP.

### financeiro

Pode futuramente ler relatorio controlado. Nao pode movimentar dinheiro, pagar
conta, alterar caixa ou conectar banco real sem PR especifica.

### treinamento

Pode futuramente ler ou transcrever conteudo e gerar rascunho de modulo. Nao
pode publicar treinamento obrigatorio sem revisao.

### marketing

Pode futuramente gerar rascunho. Nao pode postar em redes sociais sem aprovacao
humana e nao pode responder cliente automaticamente.

### desenvolvimento

Pode ler PRs, docs e issues. Nao pode fazer push, merge ou alteracao real sem
PR especifica e confirmacao.

## Bloqueios obrigatorios

Fica `blocked` qualquer provider tentando:

- `write_allowed = true` nesta fase
- `action_allowed = true` nesta fase
- `can_trigger_real_execution = true`
- incluir secret, token ou env em docs ou fixtures
- permitir escrita real em financeiro
- permitir postagem real em rede social
- permitir envio ou alteracao real em Gmail/Calendar
- fazer scraping sem compliance, rate limit ou fallback policy
- guardar raw audio ou transcript sem politica
- expor MCP interno com tools de acao antes de read-only sandbox
- vazar dados entre tenant, usuario ou dominio

## Relacao com Governance Check Report

Governance deve checar todo provider externo futuro. Novo provider precisa de
registry entry. Provider `high` ou `critical` exige human review. Provider com
OAuth ou secrets exige revisao critica. Governance nao aprova execucao real
sozinha.

## Relacao com Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` define a fronteira obrigatoria entre
este registry e qualquer mock, sandbox ou adapter futuro. Provider registrado
continua bloqueado se tentar expor secrets, raw payload, cross-tenant data,
write/action real ou `executed:true`.

## Relacao com External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` cruza provider_id, provider_type,
dominio, capability, risco e permissoes. Um provider registrado aqui continua
bloqueado se o overlay nao permitir o dominio/capability solicitado.

## Relacao com External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` define como provider candidates
deste registry podem ser simulados com fixtures seguras. O harness nao chama
provider real e nao substitui registry, security boundary ou permission overlay.

## Relacao com External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` define como provider
candidates devem documentar audit fields, cost risk, rate limit risk, budget
scopes, fallback policies e stop conditions antes de qualquer sandbox.

## Relacao com Tenant and Workspace Isolation

`docs/TENANT_WORKSPACE_ISOLATION.md` define como provider candidates devem
respeitar `workspace_type`, `tenant_id` e `user_id`. Provider externo nao pode
inferir, alterar ou atravessar tenant/workspace.

## Relacao com Permission Matrix e Domain Onboarding

Provider nao libera dominio novo. Dominio novo ainda precisa Domain Onboarding.
Capability sensivel ainda precisa Permission Matrix. Provider Registry nao
substitui Golden Scenarios.

## Relacao com Second Brain Inbox e Memory Policy

Output de provider pode virar inbox candidate futuro. Output deve ser
sanitizado. Raw content nao deve ser salvo nesta fase. Transcricoes e scraping
devem respeitar retencao e LGPD. Nenhuma memoria real e gravada nesta PR.

## Seguranca e LGPD

- nao armazenar tokens, secrets, env, headers, cookies ou credentials
- nao armazenar rawPayload, rawMessage, userMessage ou request body completo
- usar minimizacao de dados
- definir retencao antes de storage real
- toda integracao externa precisa isolamento por tenant, usuario e dominio
- logs devem ser sanitizados
- custos devem ter limite antes de execucao real

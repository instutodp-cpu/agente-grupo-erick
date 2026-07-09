# Hermes Core User / Peer Memory Scopes

Este documento detalha a camada `user_peer` da política de memória do Hermes
Core. Ele define contratos e limites para contexto por pessoa, papel e relação
operacional, mas **não implementa memória real** nesta PR.

## O que é User / Peer Memory

- Memória associada a uma pessoa, papel ou relacionamento operacional.
- Deve guardar apenas contexto aprovado, seguro e útil.
- Deve ajudar o Hermes a adaptar tom, permissões, preferências e escopo.
- Não substitui a Permission Matrix.
- Não autoriza execução real.
- Não ignora confirmação humana.

## Escopos oficiais

### `personal_user`

- Para agente pessoal.
- Exemplos: preferências pessoais, agenda, viagens, projetos, saúde/fitness.
- Não misturar com dados corporativos sem autorização explícita.

### `owner_director`

- Para dono/diretor.
- Exemplos: visão multi-loja, estratégia, indicadores, aprovações.
- Escopo alto, mas ainda com confirmação para ações sensíveis.

### `finance_user`

- Para financeiro.
- Exemplos: caixa, vencimentos, duplicatas, conciliação.
- Threshold alto, dados sensíveis, nunca executar real nesta fase.

### `manager_user`

- Para gerente/supervisor.
- Exemplos: loja vinculada, equipe, metas, treinamento, operação.
- Escopo limitado por loja/tenant no futuro.

### `buyer_user`

- Para comprador.
- Exemplos: fornecedores, compras, prazos, produtos.
- Exige confirmação em ações de compra.

### `collaborator_user`

- Para colaborador.
- Exemplos: treinamentos, tarefas, comunicados.
- Escopo restrito.

### `external_client_user`

- Para possível cliente externo no futuro.
- Exemplo: uso SaaS/multiempresa.
- Deve ter isolamento rígido por `tenant_id`, `client_id` ou `company_id`.

## Campos permitidos

Campos seguros que podem aparecer em memória por usuário/peer:

- `user_scope`
- `role`
- `preferred_tone`
- `allowed_domains`
- `denied_domains`
- `risk_profile`
- `confirmation_policy`
- `preferred_language`
- `store_scope`
- `tenant_scope`
- `approved_preferences`
- `reviewed_notes`

## Campos proibidos

Nenhuma memória de usuário/peer pode armazenar ou expor:

- `token`
- `secret`
- `env`
- `headers`
- `cookies`
- `credentials`
- `password`
- `authorization`
- `payload`
- `rawPayload`
- `rawMessage`
- `userMessage`
- `requiredAdapters`
- stack trace completo
- request body completo
- dados pessoais sensíveis sem base legal ou consentimento
- CPF/CNPJ completo sem necessidade operacional e política clara
- dados financeiros sensíveis sem escopo e autorização

## Regras obrigatórias

- Memória por usuário deve ser isolada por `user_id` no futuro.
- Memória corporativa deve respeitar `tenant_id`, `client_id` e `company_id` no futuro.
- Memória de usuário não pode vazar entre usuários.
- Memória pessoal não pode vazar para empresa.
- Memória de empresa não pode vazar para agente pessoal.
- Memória de um cliente externo não pode vazar para outro cliente.
- Memória de usuário não pode promover skill.
- Memória de usuário não pode executar adapter.
- Memória de usuário não pode alterar Permission Matrix.
- Memória de usuário não pode autorizar `executed:true`.
- `executed:false` continua obrigatório nesta fase.

## Relação com Permission Matrix

- `allowed_domains` do usuário precisa ser compatível com `docs/PERMISSION_MATRIX.md`.
- `role` nunca concede execução real sozinho.
- domínio sensível sempre exige confirmação.
- financeiro e compras críticas exigem threshold mais alto.

## Relação com Skill Candidate Registry

- user/peer memory pode ajudar a sugerir skill candidate.
- não pode criar skill executável.
- não pode aprovar skill.
- toda skill continua `draft`, `mock-first` e `human-review`.

## Relação com segundo cérebro futuro

- esta PR não implementa segundo cérebro.
- peer memory no futuro poderá apontar para um segundo cérebro autorizado.
- todo acesso futuro deve respeitar escopo, tenant, domínio e papel.

## Referências

- `docs/MEMORY_POLICY.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/GOLDEN_SCENARIOS.md`
- `docs/DOMAIN_ONBOARDING.md`
- `docs/SKILL_CANDIDATE_REGISTRY.md`
- `docs/SECOND_BRAIN_INBOX_CONTRACT.md`

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` verifies that user/peer memory scopes stay
isolated and do not leak across users or tenants. It does not change the scope
contract.

## External Integration Provider Registry

External providers that depend on user, role or tenant scope must be documented
in `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`. Provider registry entries
do not bypass user isolation, tenant isolation, confirmation or
`executed:false`.

## Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` keeps user, tenant, role, store and
company scopes inside the identity boundary. Future integrations cannot use
peer memory to bypass scope, confirmation, governance or `executed:false`.

## External Provider Permission Overlay

`docs/EXTERNAL_PROVIDER_PERMISSION_OVERLAY.md` maps future provider use to
domain and capability permissions. It cannot bypass user scope, tenant scope or
peer memory isolation.

## External Provider Mock Adapter Harness

`docs/EXTERNAL_PROVIDER_MOCK_ADAPTER_HARNESS.md` must keep mock examples
synthetic and scoped. Mock data cannot bypass user, peer, tenant or role
boundaries.

## External Provider Audit, Cost and Rate Limit

`docs/EXTERNAL_PROVIDER_AUDIT_COST_RATE_LIMIT.md` keeps provider audit, cost and
rate-limit metadata scoped. Audit metadata cannot bypass user, peer, tenant or
role boundaries.

## Tenant and Workspace Isolation

`docs/TENANT_WORKSPACE_ISOLATION.md` defines how user/peer memory must be scoped
by `workspace_type`, `tenant_id` and `user_id`. Peer memory cannot cross
personal, Grupo Erick or external client workspaces.

## Public Web Data Read-Only Sandbox

`docs/PUBLIC_WEB_READ_ONLY_SANDBOX.md` must respect user/peer memory boundaries.
Public web summaries cannot use personal memory as corporate context or client
memory across tenants.

## Transcription Intake Sandbox

`docs/TRANSCRIPTION_INTAKE_SANDBOX.md` must respect user/peer memory
boundaries. Transcription summaries cannot use personal audio as corporate
context or client content across tenants.

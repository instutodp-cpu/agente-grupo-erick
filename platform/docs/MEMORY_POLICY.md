# Hermes Core Memory Policy

Esta é a política oficial de memória do Hermes Core. Ela define contratos e
limites para futuras camadas de memória, mas **não implementa storage real**
nesta PR.

## Camadas oficiais

### Session Memory

- Escopo: conversa atual / fluxo atual.
- Duração: curta.
- Uso: manter contexto temporário.
- Pode conter: domínio detectado, intenção, `confirmation_id`, status e
  próximos passos.
- Não pode conter: `token`, `secret`, `payload`, `rawMessage`, `userMessage`,
  `credentials`.

### User / Peer Memory

- Escopo: pessoa específica.
- Uso: preferências, tom, papel, permissões e histórico aprovado.
- Deve ser isolada por usuário.
- Não pode ser compartilhada entre usuários sem regra explícita.

### Domain / Company Memory

- Escopo: domínio ou tenant.
- Uso: regras de negócio, vocabulário, políticas e fluxos aprovados.
- Deve respeitar `tenant_id`, `client_id` ou `company_id` no futuro.
- Não pode misturar empresas, clientes ou domínios.

### Audit / Learning Memory

- Escopo: eventos seguros, padrões e aprendizados.
- Uso: identificar skill candidates, erros recorrentes, confirmações, mocks e
  bloqueios.
- Deve usar somente eventos sanitizados.
- Não pode guardar `payload`, `rawMessage`, `token`, `secret`, `env`,
  `headers`, `cookies` ou `credentials`.

## Thresholds de contexto

- `0.90` = contexto extremamente confiável
- `0.80` = contexto forte
- `0.70` = contexto útil
- `0.60` = contexto moderado
- `0.50` = contexto fraco / brainstorming

Regras iniciais:

- `financeiro` e `compras` usam thresholds mais altos e contexto mais restrito.
- `marketing` e brainstorming podem usar contexto mais amplo.
- `desenvolvimento` deve usar contexto versionado e auditável.
- qualquer ação sensível exige confirmação humana.
- contexto nunca autoriza `executed:true` nesta fase.

## Política por domínio

- `compras`: threshold recomendado `0.80` a `0.90`; requer confirmação; não
  executa real.
- `financeiro`: threshold recomendado `0.90`; requer confirmação forte; não
  expõe dados sensíveis; não executa real.
- `treinamento`: threshold recomendado `0.70` a `0.80`; pode sugerir módulo em
  draft; não executa real.
- `marketing`: threshold recomendado `0.60` a `0.80`; pode sugerir
  ideias/campanhas; não publica real.
- `desenvolvimento`: threshold recomendado `0.80`; pode planejar PR/tarefa;
  não altera runtime sem PR/revisão.

## Forbidden memory fields

Nenhuma camada de memória pode armazenar ou expor:

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

## Relação com Skill Candidate Registry

- memória pode sugerir skill candidate no futuro
- memória não pode criar skill executável sozinha
- memória não pode promover skill para produção
- toda skill candidate continua com `draft` primeiro, `mock-first`,
  `human-review` e `executed:false`
- quando houver risco sensível, a revisão humana deve ocorrer com human review
  explícito antes de qualquer uso futuro

## Segundo cérebro futuro

- não implementado nesta PR
- futura implementação deve ser por tenant, empresa, domínio e usuário
- deve ter isolamento rígido
- deve ter política de retenção
- deve ter revisão humana
- deve evitar dados sensíveis desnecessários
- deve respeitar LGPD

## Referências

- `docs/PERMISSION_MATRIX.md`
- `docs/GOLDEN_SCENARIOS.md`
- `docs/DOMAIN_ONBOARDING.md`
- `docs/SKILL_CANDIDATE_REGISTRY.md`

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` checks that memory policy remains safe. It
cannot create memory storage, RAG, vector DB or second brain behavior by
itself.

## External Integration Provider Registry

Future provider output can become a memory candidate only after the provider is
documented in `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md` and sanitized.
The registry does not create memory storage, does not retain raw provider
content and does not permit real execution.

## Integration Security Boundary

`docs/INTEGRATION_SECURITY_BOUNDARY.md` defines the boundary that provider
output must cross before any future inbox or memory candidate. Raw payloads,
raw transcripts, secrets and cross-user or cross-tenant leakage remain blocked.

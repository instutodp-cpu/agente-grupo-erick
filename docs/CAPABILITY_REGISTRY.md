# Capability Registry

## Objetivo

Um **registro central e padronizado** das capacidades do Hermes, para evitar
duplicação quando novos domínios entrarem — Financeiro, Compras, RH, Marketing,
Diretoria, Auditoria, Base44 Hub e futuros módulos. Ele padroniza **como uma
capacidade é registrada, descoberta e (futuramente) executada**.

## Esta PR não muda comportamento

O registry apenas guarda metadados e **referências** (handler/responseBuilder).
Nesta PR ele **não** está ligado ao `/api/chat` e não altera SQL, cache, Claude
ou frontend. A execução via registry será conectada em PRs seguintes.

## Contrato de uma capability

Campos **obrigatórios** (validados no registro):

| Campo     | Tipo       | Descrição                                             |
| --------- | ---------- | ----------------------------------------------------- |
| `id`      | string     | Identificador único, no formato `dominio.nome`.       |
| `domain`  | string     | Domínio dono (ex.: `finance`, `compras`, `rh`).       |
| `title`   | string     | Título legível.                                       |
| `intents` | string[]   | Intenções que a capacidade atende (não vazio).        |
| `status`  | enum       | `integrated` \| `available` \| `partial` \| `planned`.|

Campos **opcionais** (com default):

| Campo             | Default | Descrição                                              |
| ----------------- | ------- | ------------------------------------------------------ |
| `description`     | `''`    | Descrição de negócio.                                  |
| `riskLevel`       | `low`   | `low` \| `medium` \| `high`.                           |
| `requiresApproval`| `false` | Se a execução exige aprovação humana.                  |
| `templateName`    | `null`  | SQL Template associado, se houver.                     |
| `cacheProfile`    | `null`  | Perfil de cache (ex.: `current_day`).                  |
| `permissions`     | `[]`    | Permissões necessárias (ex.: `finance:read`).          |
| `handler`         | `null`  | Função que produz a execução (ex.: `buildFinanceExecution`). |
| `responseBuilder` | `null`  | Função que formata a resposta.                         |

## API (`src/hermes/capabilities/capability-registry.js`)

- `registerCapability(capability)` — valida o contrato, **impede ids
  duplicados** e retorna a capacidade normalizada (com defaults).
- `getCapability(id)` — retorna a capacidade ou `null`.
- `listCapabilities()` — todas as capacidades registradas.
- `findCapabilitiesByDomain(domain)` — filtra por domínio.
- `findCapabilitiesByIntent(intent)` — filtra por intenção atendida.
- `resetRegistry()` — restaura o estado inicial (útil em testes).

Erros de validação e id duplicado lançam `Error` com mensagem clara.

## Capacidade embutida

A capacidade já existente é registrada como a primeira:

```js
{
  id: 'finance.daily_revenue',
  domain: 'finance',
  title: 'Faturamento do dia',
  intents: ['daily_revenue'],
  status: 'integrated',
  templateName: 'finance_daily_revenue',
  cacheProfile: 'current_day',
  permissions: ['finance:read'],
  handler: buildFinanceExecution,       // referência (não invocada aqui)
  responseBuilder: buildFinancialResponse
}
```

## Próximos passos

1. Registrar as demais capacidades do Financeiro conforme forem ativadas.
2. Ligar o `/api/chat` para **descobrir** a capacidade pela intenção via
   `findCapabilitiesByIntent` e executar via `handler`/`responseBuilder`,
   respeitando `permissions`, `riskLevel` e `requiresApproval`.
3. Registrar novos domínios (Compras, RH, Marketing, Diretoria, Auditoria,
   Base44 Hub) sem duplicar infraestrutura.

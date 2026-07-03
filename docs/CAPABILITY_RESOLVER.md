# Capability Resolver

## Objetivo

Permitir que a Hermes Intelligence Layer **descubra qual Capability** atenderia
uma pergunta — **sem executar nada**. É o passo entre "entendi a intenção" e
"executar a capacidade" (que virá em PRs seguintes).

## Esta PR só resolve

- **Não** executa a capability nem chama `handler`/`responseBuilder`.
- **Não** altera o `/api/chat`, SQL, cache ou Claude.
- Apenas descobre o candidato e devolve metadados.

## API (`src/hermes/capabilities/capability-resolver.js`)

### `resolveCapability(question)`

Retorna o candidato ou `null`:

```js
{
  capabilityId,  // ex.: "finance.daily_revenue"
  confidence,    // 0..1
  reason,        // explicação legível (inclui o caminho da HIL)
  domain,        // ex.: "finance"
  status         // ex.: "integrated"
}
```

## Pipeline

```
pergunta
   │
   ├─ HIL (classify)              → contexto/recommendedPath (enriquece o reason)
   │
   ├─ intent (mapas de domínio)   → ex.: financial-intent-map → "daily_revenue"
   │
   └─ Capability Registry         → findCapabilitiesByIntent(intent)
                                        │
                                        └─ { capabilityId, domain, status, ... }
```

- Se nenhum intent de domínio casar → `null`.
- Se o intent casar mas **não houver capability registrada** para ele → `null`
  (o resolver segue o registry: só resolve o que está registrado).

## Sobre a confiança e a HIL

O classificador da HIL ainda **não conhece** os intents dos domínios (ex.:
`daily_revenue`), então sua confiança é baixa para perguntas financeiras. Por
isso a **confiança do resolver** vem do match **determinístico** do mapa de
domínio (regex), e a HIL é usada para **enriquecer o `reason`** (mostra qual
caminho a HIL recomendaria). Quando, no futuro, a HIL passar a reconhecer os
intents de domínio diretamente, a confiança poderá ser derivada dela.

## Exemplos

| Pergunta                          | Resultado                         |
| --------------------------------- | --------------------------------- |
| "quanto vendemos hoje?"           | `finance.daily_revenue` (integrated) |
| "faturamento de hoje"             | `finance.daily_revenue`           |
| "faturamento do mês"              | `null` (monthly ainda não registrada) |
| "me fale algo sobre o universo"   | `null`                            |
| "" / entrada inválida             | `null`                            |

## Próximos passos

1. Registrar mais capacidades (monthly_revenue, accounts_receivable, …) para o
   resolver passar a descobri-las automaticamente.
2. Ligar o `/api/chat` para **executar** a capability resolvida via
   `handler`/`responseBuilder`, respeitando `permissions`, `riskLevel` e
   `requiresApproval` — sempre com fallback seguro.

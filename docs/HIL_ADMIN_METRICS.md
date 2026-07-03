# HIL Admin Metrics

## O que é

Expõe, nos endpoints administrativos, as decisões que a HIL toma em **shadow
mode** — de forma **agregada**, para acompanhar quanto do tráfego já poderia
evitar o Claude, sem depender de ler logs no Railway.

> As métricas são **contadores em memória** (voláteis: zeram a cada restart) e
> contêm **apenas rótulos/contagens** — **nunca o texto real das perguntas**.
> Não substituem a camada de aprendizado persistente (`question_statistics`).

## Endpoint

### `GET /admin/hil/metrics`

Protegido por `ADMIN_SECRET` (header `x-admin-secret`), igual aos demais
`/admin/*`: sem `ADMIN_SECRET` → `503`; segredo ausente/errado → `401`.

Resposta:

```json
{
  "totalClassifications": 128,
  "sinceMs": 3600000,
  "byRecommendedPath": {
    "response_library": 12,
    "semantic_cache": 0,
    "sql_template": 61,
    "workflow": 4,
    "knowledge": 9,
    "claude": 42
  },
  "wouldCallClaude":       { "true": 42, "false": 86 },
  "wouldUseTemplate":      { "true": 61, "false": 67 },
  "wouldUseSemanticCache": { "true": 0,  "false": 128 },
  "topIntents": [
    { "intent": "monthly_revenue_by_store", "count": 40 },
    { "intent": "smalltalk", "count": 12 },
    { "intent": "unknown", "count": 42 }
  ]
}
```

Campos:

| Campo                   | Descrição                                             |
| ----------------------- | ----------------------------------------------------- |
| `totalClassifications`  | Total de decisões HIL registradas.                    |
| `sinceMs`               | Há quanto tempo (ms) os contadores estão acumulando.  |
| `byRecommendedPath`     | Contagem por caminho recomendado.                     |
| `wouldCallClaude`       | Quantas decisões chamariam / não chamariam o Claude.  |
| `wouldUseTemplate`      | Quantas usariam / não usariam SQL Template.           |
| `wouldUseSemanticCache` | Quantas usariam / não usariam o Semantic Cache.       |
| `topIntents`            | Intenções mais comuns (rótulos do classificador).     |

## Como é alimentado

No shadow mode do `/api/chat`, depois de `simulateDecision()`, o servidor chama
`recordDecision(classification, decision)` (em `src/hermes/intelligence/
metrics.js`), que incrementa os contadores. Isso **não altera o chat**: a
resposta ao usuário continua exatamente a mesma.

## Privacidade

- Guarda apenas `intent` (rótulo do classificador, ex.: `sql_template`,
  `smalltalk`, `unknown`), caminhos e flags booleanas.
- **Nunca** guarda a pergunta, parâmetros, SQL ou a resposta.
- A agregação é o único formato exposto — não há endpoint que liste eventos
  individuais.

## Limitações

- Em memória: reinícios/instâncias múltiplas não compartilham contadores. Para
  histórico durável, use a camada de aprendizado (`question_statistics`) quando
  ela for ativada.

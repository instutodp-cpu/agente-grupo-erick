# HIL Decision Report

## O que é

Um relatório administrativo simples que responde: **o Hermes está economizando
IA ou ainda depende demais do Claude?** Ele deriva dos contadores já coletados
pelo HIL Admin Metrics (shadow mode) e traduz os números numa **recomendação
operacional**.

> Usa apenas os contadores agregados — **nenhuma pergunta real** é exposta.

## Endpoint

### `GET /admin/hil/report`

Protegido por `ADMIN_SECRET` (header `x-admin-secret`): sem `ADMIN_SECRET` →
`503`; segredo ausente/errado → `401`.

Resposta:

```json
{
  "totalClassifications": 128,
  "enoughData": true,
  "percentages": {
    "response_library": 9.4,
    "semantic_cache": 0,
    "sql_template": 47.7,
    "workflow": 3.1,
    "knowledge": 7,
    "claude": 32.8
  },
  "claudePercent": 32.8,
  "sqlTemplatePercent": 47.7,
  "semanticCachePercent": 0,
  "topIntents": [
    { "intent": "monthly_revenue_by_store", "count": 40 },
    { "intent": "unknown", "count": 42 }
  ],
  "recommendation": "Distribuição equilibrada; continuar monitorando.",
  "recommendations": ["Distribuição equilibrada; continuar monitorando."]
}
```

## Como a recomendação é decidida

A partir dos percentuais recomendados (shadow mode):

| Condição                          | Recomendação                                             |
| --------------------------------- | -------------------------------------------------------- |
| `total` < 30 (poucos dados)       | "Coletar mais dados antes de decidir."                   |
| Claude > 50%                      | "Criar mais SQL Templates ou respostas reutilizáveis."   |
| SQL Template > 50%                | "Boa oportunidade para otimizar cache e materialized views." |
| Semantic Cache > 20%              | "Priorizar ativação do semantic cache."                  |
| nenhuma acima (dados suficientes) | "Distribuição equilibrada; continuar monitorando."       |

- `recommendation` é a recomendação principal (primeira aplicável).
- `recommendations` lista todas as aplicáveis (podem ser mais de uma).
- Poucos dados **sempre** têm prioridade: com `total < 30`, o relatório pede
  mais dados antes de qualquer conclusão.

## Privacidade

- Deriva só de contadores/rótulos (`intent`, caminhos, flags). **Nunca** expõe a
  pergunta, parâmetros, SQL ou resposta.
- `topIntents` contém apenas rótulos do classificador (ex.: `sql_template`,
  `smalltalk`, `unknown`).

## Relação com os outros endpoints

- `GET /admin/hil/metrics` — os números crus (contadores agregados).
- `GET /admin/hil/report` — a leitura desses números + recomendação.

# HIL Analytics — camada de aprendizado do Hermes

## O que é

A camada de **aprendizado** da Hermes Intelligence Layer (HIL) mede **como o
sistema é usado**: para cada pergunta respondida, registra qual caminho a HIL
recomendaria e qual caminho foi de fato usado (SQL Template, cache ou Claude),
com custo, latência e sucesso.

O objetivo é ter dados reais para, no futuro, **calibrar as decisões da HIL** —
sem, por enquanto, mudar nenhuma decisão.

## Importante: esta fundação só mede (e nem isso ainda)

Esta PR cria **apenas a fundação e as interfaces**. Nada é calculado, persistido
ou integrado:

- Não altera o chat, o frontend, o SQL, o cache, o Claude nem a HIL.
- `recordQuestionStatistics()` é um **no-op** (retorna `false`).
- Os agregadores retornam **array vazio**.

A ativação real (persistir estatísticas e calcular agregados) virá em PRs
seguintes, junto com a decisão de onde chamar o registro no fluxo.

## Componentes

- Tabela documentada: `docs/sql/QUESTION_STATISTICS.sql` (**não aplicada
  automaticamente**).
- Módulo: `src/hermes/intelligence/statistics.js`.

### `recordQuestionStatistics(stats)`

Interface para registrar uma pergunta respondida. Campos previstos (espelham a
tabela `question_statistics`):

`intent`, `normalizedQuestion`, `recommendedPath`, `complexity`,
`estimatedCost`, `estimatedLatency`, `usedSqlTemplate`, `usedCache`,
`usedClaude`, `responseTimeMs`, `success`, `errorType`.

> Não registra o texto livre da resposta nem dados sensíveis — apenas metadados.

### Agregadores (interfaces)

Cada um devolverá, no futuro, um array ordenado de itens agregados. Hoje
retornam `[]`:

| Função                    | Pergunta que responde                          |
| ------------------------- | ---------------------------------------------- |
| `getTopIntents`           | Quais intenções mais aparecem?                 |
| `getTopQuestions`         | Quais perguntas normalizadas mais aparecem?    |
| `getTopTemplates`         | Quais SQL Templates mais são usados?           |
| `getHighestCost`          | O que mais custa (custo estimado)?             |
| `getHighestLatency`       | O que tem maior latência?                      |
| `getMostCacheHits`        | O que mais bate no cache?                      |
| `getMostClaudeFallback`   | O que mais cai no fallback Claude?             |

## Por que isso importa para reduzir o uso de IA

Sabendo **quais perguntas mais caem no Claude** e **quais mais se repetem**, é
possível priorizar o que promover para caminhos baratos (Response Library,
Semantic Cache, novos SQL Templates). A camada de aprendizado é o que torna a
HIL capaz de melhorar com base no uso real, em vez de heurísticas fixas.

## Tabela `question_statistics` (resumo)

| Campo               | Tipo         | Descrição                                    |
| ------------------- | ------------ | -------------------------------------------- |
| `id`                | identidade   | PK                                           |
| `intent`            | text         | Intenção classificada                        |
| `normalized_question` | text       | Pergunta normalizada                         |
| `recommended_path`  | text         | Caminho recomendado pela HIL                 |
| `complexity`        | text         | Complexidade estimada                        |
| `estimated_cost`    | numeric      | Custo estimado                               |
| `estimated_latency` | integer      | Latência estimada (ms)                       |
| `used_sql_template` | boolean      | Usou SQL Template?                           |
| `used_cache`        | boolean      | Usou cache?                                  |
| `used_claude`       | boolean      | Caiu no fallback Claude?                      |
| `response_time_ms`  | integer      | Tempo real de resposta (ms)                  |
| `success`           | boolean      | Resposta bem-sucedida?                        |
| `error_type`        | text         | Tipo de erro, se houver                       |
| `created_at`        | timestamptz  | Quando foi registrado                        |

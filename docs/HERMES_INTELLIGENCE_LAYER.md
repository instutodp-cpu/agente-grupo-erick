# Hermes Intelligence Layer (HIL)

## O que é

A **Hermes Intelligence Layer (HIL)** é a camada de inteligência do Hermes,
iniciada na Fase 2 da arquitetura. Ela fica **antes** do modelo e decide, para
cada pergunta, qual é a forma mais barata e rápida de responder com qualidade.

## O objetivo é reduzir o uso de IA, não aumentar

Este é o ponto central e contra-intuitivo da HIL:

> O objetivo da HIL **não** é adicionar mais IA. É **reduzir** o uso de IA.

Cada chamada ao Claude custa dinheiro, adiciona latência e é não-determinística.
Muitas perguntas do dia a dia são repetitivas, previsíveis ou já foram
respondidas antes. Para essas, chamar um LLM é desperdício. A HIL existe para
responder primeiro pelos caminhos determinísticos e baratos, deixando o Claude
como **última** opção.

## Ordem de preferência (cascata)

A HIL tenta responder na seguinte ordem, do mais barato para o mais caro:

| # | Caminho            | O que é                                                        | Custo/Latência |
| - | ------------------ | -------------------------------------------------------------- | -------------- |
| 1 | `response_library` | Respostas prontas e aprovadas para perguntas recorrentes.      | ~0 / muito baixa |
| 2 | `semantic_cache`   | Respostas semelhantes já geradas, recuperadas por similaridade. | ~0 / muito baixa |
| 3 | `sql_template`     | Consulta determinística parametrizada (já existe hoje).         | baixo / baixa  |
| 4 | `workflow`         | Ação/rotina orquestrada (gerar, enviar, exportar, agendar).     | médio / média  |
| 5 | `knowledge`        | Busca em conhecimento curado (políticas, procedimentos).        | médio / média  |
| 6 | `claude`           | Raciocínio livre do modelo. **Última opção.**                   | alto / alta    |

Só se um caminho não puder responder é que se desce para o próximo. O Claude só
é acionado quando nada mais consegue.

## Componentes desta fundação (Fase 2, PR inicial)

Esta primeira PR cria **apenas a fundação** — nada está integrado ao fluxo do
chat e o comportamento atual não muda.

- `src/hermes/intelligence/intent-classifier.js` — `classify(question)` retorna:
  ```js
  { intent, confidence, complexity, estimatedCost, estimatedLatency, recommendedPath }
  ```
  onde `recommendedPath` é um de:
  `response_library | semantic_cache | sql_template | workflow | knowledge | claude`.
- `src/hermes/intelligence/response-library.js` — `findReusableResponse()`:
  **interface apenas**, sempre retorna `null` (miss). A tabela correspondente
  está em `docs/sql/RESPONSE_LIBRARY.sql` (não aplicada automaticamente).
- `src/hermes/intelligence/should-call-claude.js` — `shouldCallClaude(input)`:
  retorna `true`/`false` com base na classificação (Claude só quando o caminho
  recomendado é `claude` ou a confiança é baixa demais).

> As heurísticas e os números de custo/latência são **placeholders**. Serão
> substituídos por medições reais quando cada caminho for implementado.

## Modo observação (integração inicial ao `/api/chat`)

A HIL é integrada ao `/api/chat` em **modo observação** antes de rotear qualquer
coisa. No início da requisição, o servidor chama `classify(question)` **apenas
para registrar** a decisão que a HIL *tomaria*, sem usá-la para alterar o fluxo:

- Emite o log estruturado `hil_classification` com `requestId`, `mode: "observe"`,
  `intent`, `confidence`, `complexity`, `estimatedCost`, `estimatedLatency` e
  `recommendedPath`.
- O `recommendedPath` **não** é usado para decidir nada nesta etapa. O fluxo
  atual continua idêntico: SQL Templates → cache → fallback Claude.
- A chamada é envolvida em `try/catch` (`hil_classification_error`) para nunca
  impactar o `/api/chat`.

O objetivo do modo observação é **coletar dados reais**: comparar o que a HIL
recomendaria com o que o fluxo atual efetivamente faz, para calibrar heurísticas,
custos e latências antes de deixar a HIL rotear de fato (fases seguintes).

## O que esta camada NÃO faz (ainda)

- Não chama o Claude de forma nova.
- Não usa o `recommendedPath` para rotear (apenas observa e loga).
- Não popula nem lê a Response Library (só define a interface).
- Não remove nada existente (SQL Templates, cache, guardrails seguem iguais).

## Próximos passos (fases seguintes)

1. Implementar a Response Library (persistência + lookup por
   `intent + normalized_question + parameter_signature`).
2. Implementar o Semantic Cache (embeddings + similaridade).
3. Integrar a cascata da HIL no `/api/chat`, medindo custo/latência reais.
4. Adicionar Workflows e Knowledge como caminhos de primeira classe.
5. Telemetria de "taxa de desvio do Claude" (quantas respostas evitaram o LLM).

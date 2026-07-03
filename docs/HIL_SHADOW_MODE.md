# HIL Shadow Mode

## O que é

O **Shadow Mode** é o passo em que a Hermes Intelligence Layer (HIL) começa a
**tomar decisões em paralelo** ao fluxo atual — mas apenas para registrar qual
caminho ela *teria* escolhido. É a evolução natural do modo observação:

- **Observação** (PR anterior): só classifica e loga (`hil_classification`).
- **Shadow** (esta PR): classifica **e simula a decisão de roteamento**,
  logando `hil_shadow_decision`.

> O usuário continua recebendo **exatamente a mesma resposta de hoje**. Nada da
> decisão simulada é usado para rotear. Nenhuma resposta muda, nenhum fluxo
> muda, o Claude não é chamado de forma diferente, e nem o Semantic Cache nem a
> Response Library são integrados.

## Por que rodar em shadow

Antes de deixar a HIL decidir de verdade, precisamos de confiança. O Shadow Mode
permite comparar, com tráfego real, **o que a HIL decidiria** com **o que o
fluxo atual efetivamente faz** — medindo acertos, divergências e quanto do
tráfego já poderia evitar o Claude. Só depois dessa validação a decisão passa a
valer.

## Como funciona

No início do `/api/chat`, depois de `classify(question)`, o servidor chama:

```js
simulateDecision(classification, question, context)
```

`src/hermes/intelligence/shadow.js` — função **pura**, sem efeitos colaterais,
que retorna:

```js
{
  recommendedPath,          // response_library | semantic_cache | sql_template | workflow | knowledge | claude
  confidence,               // 0..1
  reason,                   // explicação curta e legível
  wouldCallClaude,          // boolean
  wouldUseTemplate,         // boolean
  wouldUseSemanticCache,    // boolean
  wouldUseResponseLibrary,  // boolean
  wouldUseKnowledge         // boolean
}
```

A chamada é feita dentro do mesmo `try/catch` da HIL, então nunca impacta o
`/api/chat`.

## Log estruturado

Evento `hil_shadow_decision`, correlacionado por `requestId`:

| Campo                     | Descrição                                  |
| ------------------------- | ------------------------------------------ |
| `requestId`               | Correlação com os demais logs da requisição |
| `intent`                  | Intenção classificada                       |
| `recommendedPath`         | Caminho que a HIL escolheria                |
| `confidence`              | Confiança da decisão                        |
| `reason`                  | Motivo legível da escolha                   |
| `wouldCallClaude`         | Chamaria o Claude?                          |
| `wouldUseTemplate`        | Usaria um SQL Template?                     |
| `wouldUseSemanticCache`   | Usaria o Semantic Cache?                    |
| `wouldUseResponseLibrary` | Usaria a Response Library?                  |
| `wouldUseKnowledge`       | Usaria Knowledge?                           |

Sequência de logs numa requisição:
`chat_request_received → hil_classification → hil_shadow_decision → (fluxo atual)`.

## O que esta PR NÃO faz

- Não altera nenhuma resposta nem o fluxo.
- Não chama o Claude de forma diferente.
- Não integra o Semantic Cache nem a Response Library.
- Apenas simula decisões e as registra.

## Próximo passo

Analisar os logs de `hil_shadow_decision` vs. o comportamento real (SQL Template
/ cache / Claude efetivamente usados, já registráveis pela camada de
aprendizado) e, com confiança suficiente, promover a decisão para valer —
começando pelos caminhos mais seguros e baratos.

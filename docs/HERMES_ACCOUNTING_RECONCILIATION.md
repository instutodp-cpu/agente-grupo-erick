# Hermes Accounting — reconciliação C6 (simulada)

## Escopo

C6 compara fatos canônicos sem transformar hipótese probabilística em fato contábil. A camada produz uma decisão sintética, evidências vinculadas e exceções explícitas; não grava em banco, não altera fonte e não faz chamada de LLM.

A escada de matching é:

1. identidade forte;
2. composição determinística;
3. janela temporal determinística;
4. agrupamento 1:1, 1:N, N:1 ou N:M;
5. fuzzy, somente geração de candidato;
6. IA, somente hipótese ou explicação.

Fuzzy e IA sempre resultam em `NEEDS_REVIEW`, mesmo com confiança alta. Nenhum score promove a hipótese para `MATCHED`.

## Estados

`MATCHED | PARTIAL | UNMATCHED | CONFLICT | NEEDS_REVIEW | EXPLAINED_VARIANCE | BLOCKED`

Uma divergência contratual pode ser `EXPLAINED_VARIANCE`, mas a diferença em centavos permanece registrada. Divergência sem explicação fica `PARTIAL`; entrada insuficiente ou inválida fica `BLOCKED`.

## Exceções e aprendizado

Exceções são registros de primeira classe com motivo, severidade, evidências e revisão humana. Evidência tardia deve criar uma nova versão no armazenamento futuro, sem reescrever silenciosamente o histórico.

Resoluções humanas podem melhorar a geração de candidatos, mas a promoção de heurística exige ground truth, simulação e aprovação humana. O contrato C6 bloqueia essa promoção.

## Limites

Este C6 não implementa:

- persistência ou scheduler;
- similaridade fuzzy ou chamada de LLM;
- resolução automática de exceções;
- write-back em banco, banco, fiscal, cartão ou fonte bancária;
- contabilização automática ou efeito monetário.

As cadeias SALE–NF-e–PAYMENT–BANK, PURCHASE–NF-e–PAYABLE–BANK e crediário são apenas contextos futuros; neste PR somente os totais sintéticos são reconciliados.

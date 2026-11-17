# C20 — Reverse Audit (reconstruído sobre o main atual)

O Reverse Audit procura incompletude contábil nos dois sentidos, sem presumir que
a ingestão de origem capturou tudo.

## Traçados

Fluxo normal:

`SOURCE → CANONICAL FACT → RECONCILIATION → JOURNAL → LEDGER`

Fluxo reverso:

`LEDGER / BANK / FISCAL / INVENTORY / PAYROLL → EXPECTED SOURCE AND CHAIN`

O contrato C20 cobre:

- execução estritamente tenant/company-scoped, com competência `YYYY-MM` e instante UTC;
- rastreio bidirecional de IDs, detectando origem omitida e registro sem suporte;
- cadeia esperada com tipos ausentes, IDs duplicados e nós órfãos;
- tie-out exato em centavos inteiros, sem arredondamento;
- exceção aberta com evidência opcional, revisão humana obrigatória e sem autocorreção;
- resultado `PASS` somente quando todos os traçados, tie-outs e exceções estão resolvidos.

## Autoridade

O Reverse Audit lê, rastreia, explica e bloqueia. Não corrige origem, diário,
pagamento ou obrigação fiscal, e não chama provedor externo.

## Limites

Este contrato não implementa persistência de grafo, linkage probabilístico,
correção automática, adaptação plena por domínio ou promoção para produção.

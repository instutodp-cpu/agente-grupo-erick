# Hermes Accounting — subledger de cartão e adquirência C7 (simulado)

## Escopo

C7 modela o ciclo do cartão como subledger, sem comparar diretamente venda bruta com liquidação bancária líquida:

`SALE → CARD_TRANSACTION → CARD_RECEIVABLE / INSTALLMENTS → ACQUIRER_SCHEDULE → FEES / MDR → OPTIONAL ANTICIPATION → SETTLEMENT → BANK`

Os fatos são somente sintéticos e preservam tenant, empresa, adquirente, estabelecimento/terminal, NSU ou código de autorização, bandeira, modalidade, parcelas e evidências.

## Valores e contrato

Venda bruta, MDR, outras taxas, líquido esperado e líquido observado são campos distintos. A taxa deve ser auditada contra contrato versionado do adquirente. Divergência retorna `NEEDS_REVIEW`; nenhum número é ajustado silenciosamente.

Antecipação é evento econômico separado, com recebíveis selecionados, bruto, taxa, líquido e data. A aritmética fecha exatamente em centavos inteiros.

## Chargeback

Chargeback é evento separado, vinculado à transação original e às evidências. O contrato permite apenas preparar um pacote externo; `externalDefenseAuthority` permanece `PREPARE` e exige aprovação humana. Não há envio autônomo, estorno ou write-back.

## Limites

Este C7 não implementa:

- conector ou credencial de adquirente;
- captura, cobrança, pagamento, estorno ou defesa automática;
- persistência de liquidação;
- capacidade de escrita bancária;
- resolução automática de divergência;
- integração real com cartão, adquirente ou banco.

Cancelamento de venda, fiscal, adquirente e banco devem ser cruzados em camadas futuras; uma fonte não apaga silenciosamente as demais.

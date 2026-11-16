# C8 — Contas a pagar, contas a receber e crediário

C8 mantém separadas as fases:

    DOCUMENTO != OBRIGAÇÃO != PAGAMENTO != LIQUIDAÇÃO

O contrato é sintético, somente leitura/análise/preparação e não faz conexão externa, persistência, agendamento ou efeito financeiro.

## Contas a pagar

A cadeia de referência é:

    PEDIDO → DOCUMENTO FISCAL → RECEBIMENTO → OBRIGAÇÃO → PARCELAS
    → PREPARAÇÃO DE PAGAMENTO → PAGAMENTO BANCÁRIO → LIQUIDAÇÃO

C8 chega no máximo a READY_FOR_PAYMENT. A prontidão exige, de forma determinística, documento, recebimento, valor, beneficiário, ausência de duplicidade e evidência completa. Qualquer check ausente ou diferente de true produz BLOCKED.

## Contas a receber e crediário

Uma obrigação preserva empresa, contraparte, documento de origem, parcela, valor original, valor recebido, saldo, vencimento, estado e evidências. Crediário é identificado como RECEIVABLE com canal CREDIARIO e permanece separado de captura ou liquidação bancária.

Recebimentos sintéticos criam nova versão imutável; não alteram o objeto anterior. Um recebimento repetido por identidade é IGNORE_IDENTICAL, e um recebimento com os mesmos identificadores e fatos diferentes falha como conflito.

Faixas de aging:

- A_VENCER
- 1_30
- 31_60
- 61_90
- 91_120
- 120_PLUS

## Duplicidade, crédito e cobrança

A identidade de uma obrigação inclui tenant, tipo, empresa, contraparte, documento de origem, parcela e moeda. Mesma identidade com mesmo valor e vencimento é duplicidade; colisão com fatos financeiros diferentes é conflito crítico. O ID técnico não decide a identidade.

Políticas de crédito são versionadas. Limite, desconto, renegociação e negativação exigem aprovação humana. O Hermes pode analisar e preparar um caso de cobrança, mas não pode enviar cobrança, restringir cliente ou alterar política automaticamente.

## Previsão

A previsão de caixa é analítica, determinística e cumulativa para janelas de 7, 14, 30, 60 e 90 dias. Ela não muda estado de obrigação, não liquida título e não escreve em banco.

## Fora de escopo

- execução de pagamento, cobrança, captura ou liquidação;
- alteração automática de limite, desconto, renegociação ou negativação;
- escrita em banco, ERP, fonte fiscal ou Segundo Cérebro;
- conector, segredo, rede, persistência ou scheduler;
- chamada de LLM para determinar valor ou estado financeiro.

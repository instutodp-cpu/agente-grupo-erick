# C21 — Payment Preparation (reconstruído sobre o main atual)

C21 prepara uma instrução de pagamento sem conceder autoridade de movimentação
financeira. PREPARE não é EXECUTE.

`OBLIGATION`
→ `DOCUMENT / GOODS / AMOUNT MATCH`
→ `BENEFICIARY + DESTINATION VERIFICATION`
→ `DUPLICATE CHECK`
→ `EVIDENCE`
→ `PAYMENT INSTRUCTION`
→ `HUMAN REVIEW`
→ `SEGREGATED APPROVAL`
→ `READY_TO_EXECUTE`

## Gates

A instrução só chega a `READY_FOR_REVIEW` quando obrigação, valor, beneficiário,
destino, duplicidade, evidência e vencimento estão confirmados.

A identidade de duplicidade inclui tenant, empresa, obrigação, beneficiário, valor,
vencimento e referência opaca do destino. Valores são centavos inteiros positivos;
datas e instantes são estritos.

## Autoridade

A instrução, aprovação e envelope permanecem `simulationOnly`, com
`executionAuthorityGranted = false` e `externalEffectAllowed = false`.
Execução bancária/Pix, armazenamento de credenciais, idempotência persistente e
estornos permanecem fora deste contrato.

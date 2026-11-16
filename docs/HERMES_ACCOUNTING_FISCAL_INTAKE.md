# Hermes Accounting — entrada fiscal C4 (simulada)

## Escopo

C4 preserva e classifica documentos fiscais eletrônicos em um fluxo sintético, somente leitura e sem integração com SEFAZ. O contrato serve para testar imutabilidade, idempotência e fronteiras de autoridade antes de qualquer integração externa.

O fluxo lógico é:

`RECEIVED → PRESERVED → SIGNATURE_CHECK → SCHEMA_CHECK → BUSINESS_VALIDATION → NORMALIZED → ENTITY_RESOLUTION → RECONCILIATION → READY_FOR_ACCOUNTING`

Qualquer assinatura ou esquema ausente, inválido ou não verificado vai para `QUARANTINED`. A implementação desta etapa não realiza rede, consulta certificados, baixa schemas, persiste dados ou lança contabilização.

## Preservação e conflito

- O XML original é mantido sem transformação e recebe hash SHA-256 estável.
- Mesma chave de acesso e mesmo hash resultam em `IGNORE_IDENTICAL`.
- Mesma chave de acesso com bytes diferentes resulta em `CRITICAL_CONFLICT`; o documento anterior não é sobrescrito.
- Eventos fiscais são registros vinculados ao documento e não alteram o XML preservado.
- Datas, tipo documental, chave de acesso e payload inválidos falham fechados.

## Eventos e autoridade

Cancelamento e carta de correção são classificados como `ANALYZE`. Manifestação do destinatário — `SCIENCE`, `CONFIRMATION`, `UNKNOWN_OPERATION` ou `OPERATION_NOT_PERFORMED` — é classificada como `FISCAL_SUBMIT` e exige aprovação humana fora deste contrato.

## Limites

Este C4 não:

- acessa SEFAZ, certificado, fila, banco ou provedor fiscal;
- valida correção tributária, transmite manifestação ou cancela documento;
- cria lançamento contábil;
- importa automaticamente dados para o Segundo Cérebro;
- substitui a descoberta independente de endpoints e o gate do Maestro.

Os testes usam XML sintético e cobrem regressões de mutação, timestamps inválidos, quarentena, idempotência e conflito crítico.

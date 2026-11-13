# Hermes Contábil — Constituição do domínio

## Objetivo

Adicionar Contabilidade como domínio especializado do Hermes, sem criar outro agente, outro control plane ou uma arquitetura paralela. Hermes continua sendo um único sistema; este documento fixa apenas invariantes do domínio `accounting`.

## Princípios

1. Evolução, não recriação: o domínio reutiliza Capability Registry, autorização, auditoria, idempotência, observabilidade e human-in-the-loop.
2. Maestro é Control Plane; Hermes é Execution Plane.
3. ERP, documentos oficiais, bancos, sistemas governamentais, evidências e regras versionadas prevalecem sobre inferência do LLM.
4. O LLM interpreta; código determinístico calcula valores contábeis, fiscais, trabalhistas e financeiros autoritativos.
5. Toda conclusão ou ação material exige evidência e proveniência suficientes.
6. Novas capacidades críticas passam por simulação, ground truth e shadow mode antes de produção controlada.
7. Ausência de autorização, evidência, regra válida ou dependência obrigatória bloqueia a ação.
8. Regras de negócio têm uma única fonte e vigência explícita.
9. O histórico original é imutável; correções geram versão ou retificação.

## Autoridade

O domínio usa níveis explícitos:

`READ | ANALYZE | PREPARE | WRITE | MONEY | FISCAL_SUBMIT`

`MONEY` e `FISCAL_SUBMIT` exigem autorização humana forte. Esta fundação não concede autonomia para pagamento, movimentação, lançamento automático ou submissão fiscal.

## Invariantes

```text
self_approval = false
silent_fiscal_write = false
silent_money_movement = false
evidence_required = true
source_provenance_required = true
audit_log_required = true
simulation_first = true
fail_closed = true
merge_authority = false
human_merge_required = true
```

## Estados financeiros

`FORECAST`, `EXPECTED`, `ASSESSED`, `PAID` e `RECONCILED` permanecem distintos. Uma previsão não é obrigação apurada; uma guia emitida não prova pagamento; pagamento não prova conciliação.

## Fora de escopo desta fundação

- integração com Seta/Linx;
- pagamentos, lançamentos automáticos ou alteração de estoque;
- transmissão fiscal ou trabalhista;
- mudança no `/api/chat`, permissões ou runtime;
- conectores, banco real, segredos ou deploy.

Cada camada futura deve declarar autoridade, evidência obrigatória, bloqueios fail-closed, testes determinísticos, auditoria e idempotência. Nenhuma camada concede merge ao Hermes.

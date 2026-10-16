# Hermes Contábil — Constituição do Domínio

## Objetivo

Adicionar Contabilidade como domínio especializado do Hermes, sem criar outro agente, outro control plane ou uma arquitetura paralela.

Hermes permanece um único sistema. Este documento define apenas invariantes do domínio `accounting` e deve reutilizar os contratos oficiais já existentes, incluindo Capability Registry, autorização, auditoria, idempotência, observabilidade e human-in-the-loop.

## Princípios

1. **Evolução, não recriação.** O domínio contábil estende Hermes; não substitui componentes existentes.
2. **Maestro = Control Plane; Hermes = Execution Plane.**
3. **Fonte da verdade fora do modelo.** ERP, documentos oficiais, bancos, sistemas governamentais, evidências e regras versionadas prevalecem sobre inferência do LLM.
4. **LLM interpreta; código calcula.** Valores contábeis, fiscais, trabalhistas e financeiros autoritativos exigem cálculo determinístico.
5. **Evidência antes de efeito.** Toda conclusão ou ação material deve apontar para evidência e proveniência suficientes.
6. **Simulation First.** Novas capacidades críticas passam por simulação, ground truth e shadow mode antes de produção controlada.
7. **Fail closed.** Ausência de autorização, evidência, regra válida ou dependência obrigatória bloqueia a ação.
8. **Uma regra de negócio, uma fonte.** Não duplicar regras entre prompts, skills, SQL, dashboards e código.
9. **Temporalidade obrigatória.** Regras fiscais, trabalhistas, comissões e classificações que mudam no tempo são versionadas por vigência.
10. **Histórico imutável.** Correções geram nova versão/retificação; não apagam a evidência original.

## Autoridade

O domínio usa níveis explícitos:

- `READ` — consultar fonte autorizada.
- `ANALYZE` — reconciliar, validar, detectar anomalias e explicar.
- `PREPARE` — preparar lançamento, obrigação, pacote ou ação para revisão.
- `WRITE` — alterar sistema de domínio quando política explícita permitir.
- `MONEY` — produzir efeito financeiro.
- `FISCAL_SUBMIT` — transmitir declaração/evento fiscal ou trabalhista oficial.

Invariantes críticos:

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

`MONEY` e `FISCAL_SUBMIT` exigem autorização humana forte até que uma política futura, explícita e aprovada defina escopo diferente. Esta constituição não concede essa autonomia.

## Cálculo e regras oficiais

```text
llm_may_interpret = true
llm_may_calculate_authoritative_amounts = false
deterministic_calculation_required = true
official_source_required_for_fiscal_rules = true
original_document_immutable = true
rule_version_required = true
```

Confiança probabilística nunca substitui validação determinística obrigatória.

## Estados financeiros

Valores com naturezas distintas não podem ser colapsados:

- `FORECAST` — projeção.
- `EXPECTED` — valor esperado pelos fatos/regras internas.
- `ASSESSED` — valor apurado por fonte oficial/autoritativa.
- `PAID` — valor efetivamente pago.
- `RECONCILED` — pagamento e obrigação conciliados com evidência.

Exemplo: uma previsão de DAS não é uma obrigação oficialmente apurada; uma guia emitida não significa pagamento; pagamento não significa conciliação concluída.

## Segregação de responsabilidades

O mesmo ator/capacidade não deve preparar e aprovar silenciosamente uma ação crítica. Quando aplicável:

```text
PREPARER != APPROVER
```

Retificações, reaberturas de período, pagamentos e submissões oficiais devem preservar solicitante, aprovador, motivo e evidências.

## Escopo incremental

As próximas camadas podem incluir modelo contábil canônico, Evidence Ledger, Rule Registry, adaptadores read-only, documentos fiscais, bancos/Pix, reconciliação, cartões, AP/AR, estoque, fechamento, journal preparation, fiscal/SPED, folha/comissões, tributos, obrigações oficiais, inteligência contábil e avaliação ground-truth.

Esta PR não implementa essas camadas. Ela apenas fixa os invariantes que todas deverão respeitar.

## Fora de escopo desta fundação

- integração com Seta/Linx;
- cálculo tributário;
- transmissão eSocial/EFD-Reinf/SPED;
- pagamentos;
- lançamentos automáticos;
- alteração de estoque/crediário;
- novo agente ou novo runtime;
- mudança no `/api/chat`;
- mudança de permissões existentes.

## Critério de evolução

Cada camada futura deve:

1. reutilizar contratos oficiais do Hermes;
2. ter escopo pequeno e reversível;
3. declarar autoridade necessária;
4. declarar evidências obrigatórias;
5. definir bloqueios fail-closed;
6. possuir testes determinísticos;
7. preservar auditoria e idempotência;
8. não conceder merge ao Hermes.

# Hermes Core Second Brain Inbox Contract

Este documento define o contrato oficial do futuro Second Brain Inbox do Hermes
Core. Nesta PR ele existe apenas como contrato e documentação: não implementa
storage real, RAG real, vector database, segundo cérebro real ou conexão com
ferramentas externas.

## O que é o Second Brain Inbox

O Second Brain Inbox é uma entrada segura e governada para contexto futuro.
Ele pode receber informações de mensagens, reuniões, documentos, notas, tickets,
relatórios, e-mails ou uploads.

Nesta fase:

- é apenas contrato/documentação
- não implementa armazenamento
- não implementa busca semântica
- não implementa RAG
- não implementa vector database
- não conecta ferramentas reais

## Princípios obrigatórios

- Inbox não executa ação.
- Inbox não chama adapter.
- Inbox não autoriza `executed:true`.
- Inbox não altera Permission Matrix.
- Inbox não aprova skill candidate.
- Inbox não vaza dados entre usuários.
- Inbox não vaza dados entre tenants/clientes.
- Inbox não armazena secrets.
- Tudo deve ser sanitizado antes de virar memória ou aprendizado.
- Conteúdo sensível exige revisão humana e política clara.

## Tipos de entrada futuros

### `user_note`

- Descrição: nota de usuário com contexto pessoal ou operacional.
- Risco: baixo.
- Exige sanitização: sim.
- Exige revisão humana: não obrigatória por padrão; pode ser ativada por risco.
- Pode sugerir skill candidate: sim.
- Pode virar memória: apenas como candidato sanitizado no futuro.
- Pode executar ação real: false.

### `meeting_transcript`

- Descrição: transcrição ou resumo bruto de reunião.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: apenas como candidato sanitizado no futuro.
- Pode executar ação real: false.

### `document_summary`

- Descrição: resumo de documento, contrato, proposta ou política.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: sim para conteúdo sensível.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, quando aprovado.
- Pode executar ação real: false.

### `support_ticket`

- Descrição: chamado de suporte, incidente ou solicitação operacional.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, quando aprovado.
- Pode executar ação real: false.

### `operational_report`

- Descrição: relatório operacional, KPI ou observação de operação.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, quando aprovado.
- Pode executar ação real: false.

### `audit_event`

- Descrição: evento seguro de auditoria ou aprendizado.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: quando houver contexto sensível.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, somente se sanitizado.
- Pode executar ação real: false.

### `skill_candidate_signal`

- Descrição: pista de padrão recorrente que pode virar skill candidate no futuro.
- Risco: medium.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, como sinal sanitizado.
- Pode executar ação real: false.

### `domain_context_update`

- Descrição: atualização de contexto de domínio ou tenant.
- Risco: high.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, se respeitar isolamento.
- Pode executar ação real: false.

### `external_source_summary`

- Descrição: resumo de fonte externa futura.
- Risco: high.
- Exige sanitização: sim.
- Exige revisão humana: sim.
- Pode sugerir skill candidate: sim.
- Pode virar memória: sim, apenas em formato sanitizado.
- Pode executar ação real: false.

## Campos mínimos de um inbox item

Contrato público mínimo esperado:

```json
{
  "inbox_item_id": "string",
  "source_type": "user_note",
  "source_label": "string",
  "tenant_scope": "string",
  "user_scope": "string",
  "domain": "financeiro",
  "risk_level": "low",
  "confidence_threshold": 0.8,
  "sanitized_summary": "string",
  "classification_status": "received",
  "human_review_required": true,
  "can_create_skill_candidate": false,
  "can_update_memory": false,
  "can_trigger_real_execution": false,
  "forbidden_fields_removed": ["token", "secret"],
  "created_at": "ISO-8601",
  "retention_policy": "string",
  "notes": "string"
}
```

Regras obrigatórias:

- `can_trigger_real_execution = false` sempre.
- `human_review_required = true` para riscos `medium`, `high` e `critical`.
- `forbidden_fields_removed` deve existir.
- raw content não deve ser armazenado nesta fase.
- `sanitized_summary` não pode conter `token`, `secret`, `env`, `payload` ou `rawMessage`.

## Estados permitidos

- `received`
- `sanitized`
- `classified`
- `needs_human_review`
- `approved_for_memory_candidate`
- `approved_for_skill_candidate_signal`
- `rejected`
- `expired`

## Estados proibidos

- `executed`
- `active_real`
- `production_autonomous`
- `adapter_executed`
- `memory_written_real`

## Roteamento futuro

O inbox deve ser roteado por:

- `tenant_scope`
- `user_scope`
- `domain`
- `source_type`
- `risk_level`

Regras iniciais:

- `financeiro` + risco `high` = revisão humana obrigatória.
- `compras` + risco `medium/high` = confirmação e revisão.
- `marketing` + risco `low/medium` = pode virar ideia/campanha draft.
- `treinamento` + risco `medium` = pode virar módulo draft.
- `desenvolvimento` + risco `high` = só plano/PR, nunca alteração direta.

## Relação com Memory Policy

- O inbox pode gerar memory candidate no futuro.
- O inbox não grava memória real nesta PR.
- Toda memória futura precisa respeitar `docs/MEMORY_POLICY.md`.
- Toda memória futura precisa respeitar `docs/USER_PEER_MEMORY_SCOPES.md`.

## Relação com Skill Candidate Registry

- O inbox pode sugerir `skill_candidate_signal`.
- Não pode criar skill executável.
- Não pode aprovar skill.
- Skill continua `draft`, `mock-first` e `human-review`.

## Relação com Permission Matrix e Golden Scenarios

- O inbox não expande permissão.
- Domínio novo precisa passar por Domain Onboarding.
- Qualquer novo fluxo precisa de Golden Scenario.
- Qualquer capability sensível precisa de confirmação humana.

## LGPD e segurança

- minimização de dados
- retenção limitada
- revisão humana para dados sensíveis
- isolamento por tenant, usuário e domínio
- não guardar dados pessoais sensíveis sem base clara
- não guardar CPF/CNPJ completo sem necessidade operacional clara
- não guardar dados financeiros sensíveis sem escopo claro

## Referências

- `docs/MEMORY_POLICY.md`
- `docs/USER_PEER_MEMORY_SCOPES.md`
- `docs/SKILL_CANDIDATE_REGISTRY.md`
- `docs/PERMISSION_MATRIX.md`
- `docs/GOLDEN_SCENARIOS.md`
- `docs/DOMAIN_ONBOARDING.md`

## Governance Check Report

`docs/GOVERNANCE_CHECK_REPORT.md` treats the inbox contract as a review area.
It does not turn the inbox into storage, search or execution.

## User / Peer Memory Scopes

`docs/USER_PEER_MEMORY_SCOPES.md` continua sendo a referencia para isolamento,
roles e proibicoes de memoria por usuario/peer. O inbox nao substitui esse
contrato e nao permite vazamento entre usuarios ou tenants.

## External Integration Provider Registry

Outputs from future providers can become inbox candidates only after the
provider is documented in `docs/EXTERNAL_INTEGRATION_PROVIDER_REGISTRY.md`.
Provider output must be sanitized first; raw content is not stored in this phase
and no provider call can trigger real execution.

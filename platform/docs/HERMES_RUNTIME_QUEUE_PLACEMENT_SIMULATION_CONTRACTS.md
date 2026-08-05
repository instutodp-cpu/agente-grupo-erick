# Hermes Agent Core - Runtime Queue Placement Simulation Contracts

## Objetivo

Criar a camada declarativa de agrupamento lógico do Hermes, construída sobre um Queue Materialization Package já `QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION` (PR #109). Recebe apenas o pacote `QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION` (mais os exatos objetos que ele já registrou via seus próprios IDs/fingerprints: Materialization Entries, sua própria Order Reference, Queue Class References) e produz uma representação puramente declarativa de: a qual grupo lógico simulado cada entrada materializada pertenceria; qual posição relativa ela ocuparia dentro desse grupo; que a ordem global e a ordem intra-grupo permanecem coerentes com a ordem soberana já estabelecida pela PR109 — nunca fila real, nunca item de fila, nunca enqueue, nunca broker, nunca worker, nunca job, nunca execução.

"QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION significa somente que entradas materializadas foram associadas declarativamente a grupos lógicos simulados, com posição relativa dentro de cada grupo. Nenhuma fila ou item de fila foi criado."

## Auditoria arquitetural — por que esta camada existe

A auditoria de código (não apenas de nomenclatura) que precedeu esta PR encontrou que `runtime-queue-admission-entry-reference.js` (PR #108) já carrega `runtime_queue_partition_reference_id`, apontando para `runtime-queue-partition-reference.js`, que já possui um mecanismo determinístico de `partition_key_type`/`partition_key_value` — o mesmo conceito de "placement key" que se poderia supor já resolvido. Porém `runtime-queue-materialization-entry-reference.js` (PR #109) **não propaga** essa referência de partição adiante — carrega apenas `runtime_queue_class_reference_id` — e a PR109 produz uma única lista global ordenada, sem nenhum agrupamento nem ordem relativa dentro de grupo. A pergunta "a qual grupo lógico pertence esta entrada materializada, e qual sua ordem relativa dentro desse grupo?" não estava respondida por nenhum contrato existente — não é renomear campo, é uma decisão genuinamente nova.

## Queue Materialization Package ≠ Queue Placement Package

```
QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION ≠ QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION
  ≠ QUEUE_PLACEMENT_PACKAGE_PREPARED_SIMULATION ≠ QUEUE_CREATED ≠ QUEUE_ITEM_CREATED
  ≠ QUEUE_ITEM_ENQUEUED ≠ BROKER_PUBLISHED ≠ WORKER_NOTIFIED ≠ JOB_CREATED ≠ EXECUTED
```

Esta camada **nunca recalcula**: admissão, prioridade, fairness, capacidade, quota, Queue Class compatibility, ordem canônica, `materialization_position`, `materialization_status`, `admission_status`, grafo de predecessores ou identidade. Ela valida a integridade dessas decisões já tomadas — nunca as substitui.

## Escopo deliberadamente mínimo — apenas uma dimensão de agrupamento

Seguindo a instrução explícita "Não use todas [as dimensões] automaticamente. Inclua somente dimensões necessárias e já oficializadas", esta camada agrupa exclusivamente por `runtime_queue_class_reference_id` — a única dimensão que a Materialization Entry Reference já carrega oficialmente. Tenant/organização/projeto/agente/provider/model/tool/workflow/priority não são usados como dimensão de agrupamento nesta versão, por não haver necessidade demonstrada por nenhum teste real.

## Placement Key — mecanismo canônico, nunca concatenação de string

`deriveQueuePlacementGroupKey(queueClassReferenceId)` (`runtime-queue-placement-boundary.js`) deriva a chave via `computeCanonicalContentDigest({ queue_class_reference_id })` — o mesmo mecanismo canônico de serialização/hashing já usado em toda a linhagem, nunca uma string concatenada ambígua. Determinístico, reproduzível, sem relógio, sem estado externo, sem aleatoriedade — a mesma Queue Class sempre produz a mesma chave.

## Referências declarativas de placement

`runtime-queue-placement-entry-reference.js` (23 campos exatos) materializa, por Materialization Entry, se e em qual grupo ela seria posicionada. `placement_status` (2 valores: `QUEUE_PLACEMENT_PREPARED_SIMULATION`/`QUEUE_PLACEMENT_BLOCKED_SIMULATION`) é derivado estruturalmente do `materialization_status` já herdado — nunca declarado independentemente. `placement_position`/`runtime_queue_placement_group_reference_id` são obrigatoriamente `null` quando não colocado, e um inteiro/string quando colocado — qualquer divergência é rejeitada. `queue_created`/`queue_item_created`/`queue_item_enqueued`/`queue_position_reserved` são sempre `false`.

`runtime-queue-placement-group-reference.js` (11 campos exatos) representa um agrupamento lógico puro — nunca uma fila, tópico ou partição real. `ordered_queue_placement_entry_reference_ids` é sempre uma subsequência genuína da ordem canônica global (nunca ordenada independentemente por grupo, chave ou qualquer critério incidental); `group_order_preserved` é genuinamente re-verificado (nunca afirmado `true` por construção) via `checkGroupOrderPreserved`, que prova que `placement_position` cresce estritamente monotônico entre os membros do grupo.

`runtime-queue-placement-order-reference.js` (25 campos exatos) preserva `ordered_queue_materialization_entry_reference_ids` copiado verbatim da PR109 — nunca re-ordenado. `ordered_queue_placement_group_reference_ids` ordena os grupos pela posição global do seu primeiro membro na ordem canônica — uma derivação genuína da ordem soberana, nunca um sort incidental por chave. Duas flags de preservação (`materialization_order_preserved`/`predecessor_order_preserved`) — a segunda é a AND de todos os `group_order_preserved` individuais, provando que o agrupamento nunca inverte a ordem relativa que quaisquer duas entradas já tinham.

### Fonte soberana para predecessor order

O input boundary desta camada exclui deliberadamente arestas de dependência cruas. A fonte soberana é `RuntimeQueueMaterializationOrderReference.predecessor_order_preserved` (já provada verdadeira pela própria PR109), combinada com `queue_materialization_order_validated`. Como os grupos são ordenados pela posição global do primeiro membro, e a ordem global de predecessores já foi garantida pela PR109, a coerência predecessor-grupo ("um predecessor precisa estar no mesmo grupo ou em grupo anterior") decorre estruturalmente — nunca exige arestas brutas que este boundary corretamente não vê.

## Runtime Queue Placement Request

`runtime-queue-placement-request.js` (13 campos exatos) agrega o Queue Materialization Package oficial mais seus próprios sub-objetos comprometidos (Materialization Entries/Order/Queue Classes), mesmo padrão non-substitution da PR109. `simulation_context` nunca é lido para nenhuma decisão.

## Runtime Queue Placement Boundary

`runtime-queue-placement-boundary.js`'s `evaluateRuntimeQueuePlacementRequest(request, context)` segue a ordem de precedência estabelecida:

1-3. Request/toda referência aninhada contra seu validador oficial.
4. Queue Materialization Package genuinamente `QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION`.
6. Identidade (`checkIdentity`) — mesma limitação honesta documentada na PR109 (a Order Reference materializada não carrega campos de identidade; proteção real vem da auto-consistência de fingerprint do Package).
7-8. Não-substituição: Materialization Entries e Queue Class References produzem exatamente o mesmo conjunto de IDs/fingerprints já registrado pelo Package; a Order Reference bundled é genuinamente a mesma.
9. Ordem canônica — a lista já duplicada pelo Package corresponde exatamente à lista da própria Order Reference.
10. Predecessor order — o fato soberano herdado deve ser genuinamente `true`.
11. Elegibilidade — toda entrada referenciada pela ordem canônica deve estar presente.
12-13. Derivação de placement em duas passagens: a primeira determina elegibilidade + chave de grupo + posição-dentro-do-grupo iterando a ordem canônica (um `Map` usado apenas como índice por ID, nunca para ordem de iteração); a segunda constrói os objetos `PlacementEntryReference` já com o ID do grupo real conhecido. Uma entrada elegível sem `runtime_queue_class_reference_id` real bloqueia o pacote inteiro (`QUEUE_PLACEMENT_GROUP_BLOCKED`) — nunca convertida em bloqueio parcial permissivo.
14-15. Construção dos Placement Groups e da Placement Order, com as duas flags de preservação re-verificadas.
16. Invariantes de não-execução.

Emissão final de Package/Decision/Result/Audit. Qualquer inconsistência bloqueia fail-closed.

## Runtime Queue Placement Package / Decision / Result / Audit

`runtime-queue-placement-package.js` (57 campos exatos) é o envelope final imutável, mesmo padrão de dois campos excluídos progressivamente (fingerprint/digest) já estabelecido em toda a linhagem.

`runtime-queue-placement-decision.js` define seu próprio vocabulário de 12 status (6 próprios + 6 de identidade), incluindo `QUEUE_PLACEMENT_GROUP_BLOCKED` — status dedicado para incompatibilidade estrutural de agrupamento, nunca confundido com os bloqueios de ordem/predecessor. 12 flags `*_validated`. `runtime-queue-placement-result.js` é o envelope mais amplo (20 flags operacionais seguras).

`runtime-queue-placement-audit.js` registra apenas IDs/fingerprints/digest, status/decision/next_state, bindings de identidade, IDs de Queue Class/grupo, `entry_counts`, blockers, reason codes, logical sequence — **nunca payload completo, prompt, mensagem, memória, segredo, credencial, argumentos de tool ou código.**

## Registry

`runtime-queue-placement-registry.js` cria 8 registros privados e sintéticos (request, entry, group, order, package, decision, result, audit) — mesmo padrão `createEntityStore`/`resolveRegistration` já estabelecido em toda a linhagem. Sem persistência.

## Architecture gates

Nenhum gate novo foi necessário: `FORBIDDEN_QUEUE_CLIENT_IMPORT` (adicionado pela PR #109) já escaneia todo o diretório `src/core`, cobrindo automaticamente os novos arquivos desta camada. Confirmado por teste de regressão (`runAllGates()` retorna zero findings incluindo todos os módulos da PR110).

## Fixture

`test/fixtures/hermes-runtime-queue-placement-simulation-contracts.json` (versão 1) contém 2 cenários gerados programaticamente a partir do próprio `evaluateRuntimeQueuePlacementRequest` real: o caminho feliz com todas as entradas colocadas em um único grupo, e um plano sequencial com uma entrada ainda bloqueada (nunca colocada, mas presente na ordem com posição `null`). Apenas a `decision` de cada cenário é persistida — mesma razão documentada nas PRs #108/#109 (o encadeamento de fingerprints por camada faz o objeto completo crescer rapidamente). A cauda longa de cenários é coberta inline em `test/runtime-queue-placement-simulation-contracts.test.js` (54 testes).

## Confirmação de nenhuma execução real

Em todo status producível: `queue_placement_applied`, `queue_created`, `queue_item_created`, `queue_item_enqueued`, `queue_item_dequeued`, `queue_position_reserved`, `broker_published`, `broker_subscribed`, `worker_notified`, `worker_started`, `lease_created`, `lock_created`, `job_created`, `dispatch_authorized`, `dispatch_executed`, `network_used`, `secret_resolved`, `executed` permanecem sempre `false`; `simulation=true`; `production_blocked=true`; `rollout_percentage=0`. Nenhuma fila, tópico, broker ou consumer real é criado; nenhum item de fila é inserido; nenhum job é criado; nenhum worker é notificado; nenhuma rede é usada; nenhum segredo é resolvido; nenhuma execução real ocorre em nenhum caminho desta implementação.

## Limitações

- `checkIdentity` contra a Materialization Order Reference é estruturalmente um no-op — mesma limitação honesta já documentada na PR109, herdada porque a Order Reference materializada nunca carregou campos de identidade em nenhuma camada.
- Os grupos são ordenados pela posição global do primeiro membro — se uma futura camada precisar de uma ordem de grupos independente da ordem de aparição (ex.: por prioridade agregada do grupo), essa é uma decisão nova, fora do escopo desta PR.
- Nenhum worker real, processo, thread, container, fila, tópico, broker, consumer, producer, job, cron, timer, retry, polling ou child_process é usado ou referenciado em qualquer módulo desta PR.

"A próxima etapa, após auditoria e merge, permanece em aberto — nenhuma camada de execução, dispatch real ou infraestrutura de fila deve ser assumida sem nova auditoria arquitetural."

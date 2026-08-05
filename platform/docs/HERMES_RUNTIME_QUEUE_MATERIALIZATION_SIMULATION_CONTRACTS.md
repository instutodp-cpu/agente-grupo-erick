# Hermes Agent Core - Runtime Queue Materialization Simulation Contracts

## Objetivo

Criar a camada declarativa de materialização em fila do Hermes, construída sobre um Queue Admission Package já `QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION` (PR #108). Recebe apenas o pacote `QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION` (mais os exatos objetos que ele já registrou via seus próprios IDs/fingerprints: Admission Entries, sua própria Order Reference, Queue Class References) e produz uma representação puramente declarativa de: como cada intent admitida seria representada e posicionada em uma futura fila de runtime; qual posição lógica (`materialization_position`) cada entrada admitida ocuparia; quais entradas nunca recebem posição (por não terem sido genuinamente admitidas); a ordem determinística de materialização, derivada exclusivamente da ordem já oficial da Queue Admission; que a ordem de predecessores herdada permanece preservada — nunca fila real, nunca item de fila, nunca enqueue, nunca mensagem publicada em broker, nunca notificação de worker, nunca job criado, nunca lease, nunca lock, nunca dispatch autorizado ou executado, nunca rede usada, nunca segredo resolvido.

"QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION significa somente que intents admitidas foram representadas declarativamente com posições lógicas na fila. Nenhuma fila ou item de fila foi criado."

## Queue Admission Package ≠ Queue Materialization Package

`QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION` (PR #108) prova que, para cada Dispatch Intent preparada, uma decisão de admissão em fila lógica foi tomada — nunca definiu como essa entrada admitida seria efetivamente posicionada em uma fila de runtime. `QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION` é a camada seguinte: recebe um Queue Admission Package já preparado como pré-condição obrigatória e produz exclusivamente uma representação declarativa de posição por entrada — nunca fila, nunca item, nunca enqueue.

```
QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION ≠ QUEUE_MATERIALIZATION_PACKAGE_PREPARED_SIMULATION
  ≠ QUEUE_CREATED ≠ QUEUE_ITEM_CREATED ≠ QUEUE_ITEM_ENQUEUED ≠ BROKER_PUBLISHED
  ≠ WORKER_NOTIFIED ≠ JOB_CREATED ≠ DISPATCH_AUTHORIZED ≠ DISPATCH_EXECUTED ≠ EXECUTED
```

Esta camada **nunca recalcula** compatibilidade de Queue Class, capacidade de worker, elegibilidade de quota, elegibilidade de fairness, elegibilidade de prioridade, limites de admissão ou o próprio `admission_status` — apenas valida a integridade dessas decisões já tomadas pela Queue Admission layer, herdando-as verbatim.

## Não-substituição por bundling, não por recarga bruta

A especificação proíbe aceitar diretamente Dispatch/Scheduler/Worker Assignment, "admission entries avulsas" ou "Queue Class avulsa". A Queue Materialization Request resolve essa restrição não recarregando a proveniência bruta, mas empacotando o Queue Admission Package junto aos exatos sub-objetos que ele já comprometeu via suas próprias listas de ID/fingerprint (`runtime-queue-materialization-request.js`, 13 campos exatos): `runtime_queue_admission_package_reference` (o Package oficial), `runtime_queue_admission_entry_references` (lista), `runtime_queue_admission_order_reference` (a própria Order Reference da Admission), `runtime_queue_class_references` (lista) — cada um validado contra seu próprio validador real, e depois cross-provado pelo boundary contra as listas de ID/fingerprint que o Package já registrou. Isso não é "aceitar entradas avulsas": os sub-objetos nunca são uma fonte independente, sempre cross-validados contra o Package oficial que os acompanha.

"A única entrada de negócio válida deve ser o contrato oficial produzido pela PR108: QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION."

## Referências declarativas de materialização

`runtime-queue-materialization-entry-reference.js` (23 campos exatos) materializa, por Admission Entry, se e onde ela seria posicionada. `materialization_status` (2 valores: `QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION`/`QUEUE_MATERIALIZATION_BLOCKED_BY_ADMISSION_REFERENCE`) é derivado estruturalmente — nunca declarado independentemente pelo caller — a partir do fato já herdado `admission_status === QUEUE_ADMISSION_ACCEPTED_SIMULATION && queue_admission_validated === true`. `materialization_position` é obrigatoriamente `null` quando não preparado, e um inteiro ≥ 0 quando preparado — qualquer divergência (posição forjada num bloqueado, posição ausente num preparado) é rejeitada. `queue_materialization_applied`/`queue_created`/`queue_item_created`/`queue_item_enqueued`/`queue_position_reserved` são sempre `false`, mesmo para uma entrada preparada.

"QUEUE_ITEM_MATERIALIZATION_PREPARED_SIMULATION significa somente que uma entrada admitida foi representada declarativamente com uma posição lógica na fila. Nenhum item de fila real foi criado."

Toda Admission Entry, admitida ou não, produz exatamente uma Materialization Entry — cardinalidade 1:1 preservada "para preservar cardinalidade; auditabilidade; identidade; explicação da decisão", nunca omitindo as bloqueadas.

`runtime-queue-materialization-order-reference.js` (23 campos exatos) copia `ordered_queue_admission_entry_reference_ids` verbatim da Order Reference da Admission — nunca re-ordenada — e mantém `ordered_queue_materialization_entry_reference_ids` como espelho posicional 1:1 com os IDs desta camada. As duas listas de partição (`materialized`/`not_materialized_queue_materialization_entry_reference_ids`) cobrem a lista ordenada por completo, sem sobreposição e sem lacuna — verificado estruturalmente pelo próprio validador (`entry_partition_lists_overlap`/`entry_partition_lists_do_not_cover_ordered_entries`). Apenas duas flags de preservação existem aqui (`admission_order_preserved`/`predecessor_order_preserved`), ao contrário das quatro do Admission layer — esta camada nunca reordena por prioridade ou fairness, apenas materializa a ordem já decidida.

### Fonte soberana para predecessor order

O input boundary desta camada exclui deliberadamente a cadeia bruta Dispatch/Scheduler — nunca vê arestas de dependência cruas. A fonte soberana para "ordem de predecessores preservada" é `RuntimeQueueAdmissionOrderReference.required_predecessor_order_preserved`, já provada verdadeira pelo próprio boundary da PR108. Esta camada:

1. Re-verifica a autenticidade desse fato herdado (via o próprio fingerprint recomputado da Order Reference, já coberto pela validação de referência aninhada do Request).
2. Independentemente, prova o único fato relacionado a predecessores genuinamente derivável neste nível sem ver arestas cruas: que `materialization_position` cresce estritamente monotônico à medida que a ordem canônica é percorrida entre as entradas materializadas (`checkPredecessorOrderPreserved`, `runtime-queue-materialization-boundary.js` — função pura, exportada, testável isoladamente).

Nunca fabrica uma lista de predecessores por-aresta sem dado real por trás dela.

## Runtime Queue Materialization Request

`runtime-queue-materialization-request.js` (13 campos exatos) agrega o Queue Admission Package oficial mais seus próprios sub-objetos comprometidos (Admission Entries/Order/Queue Classes), `correlation_id`/`causation_id`/`trace_id`/`logical_sequence`/`expected_queue_materialization_registry_version`/`simulation_context`. `simulation_context` nunca é lido para nenhuma decisão.

### Prova de não-substituição por fingerprint/ID-set

O boundary prova que as Admission Entries e Queue Class References que a request de fato carrega produzem exatamente o mesmo conjunto de IDs/fingerprints já registrado pelo Queue Admission Package — nunca uma lista independentemente substituída pelo caller — mais que a Order Reference bundled é genuinamente a mesma (ID e fingerprint) que o Package já registrou. `idSetMatches`/`fingerprintSetMatches` (`runtime-queue-materialization-boundary.js`) reutilizam verbatim o mesmo padrão de toda a linhagem.

## Runtime Queue Materialization Boundary

`runtime-queue-materialization-boundary.js`'s `evaluateRuntimeQueueMaterializationRequest(request, context)` segue a ordem de precedência estabelecida (identidade antes de dados herdados, dados herdados antes de ordem/predecessores, ordem/predecessores antes do outcome preparado):

1-3. Request/toda referência aninhada (Package, Order, cada Entry, cada Queue Class) contra seu validador oficial.
4. Queue Admission Package genuinamente `QUEUE_ADMISSION_PACKAGE_PREPARED_SIMULATION` — qualquer outro status real bloqueia `QUEUE_MATERIALIZATION_BLOCKED_BY_INHERITED_DATA`.
6. Identidade (`checkIdentity`, mesma função de toda a linhagem), avaliada cedo.
7-8. Não-substituição: Admission Entries e Queue Class References produzem exatamente o mesmo conjunto de IDs/fingerprints que o Package já registrou; a Order Reference bundled é genuinamente a mesma que o Package já vinculou; cardinalidade (contagem declarada bate com a contagem real).
9. Ordem canônica — a lista já duplicada pelo Package deve corresponder exatamente à lista carregada pela própria Order Reference, sem duplicata, com o mesmo tamanho das Entries.
10. Predecessor order — o fato soberano herdado (`required_predecessor_order_preserved`) deve ser genuinamente `true`.
11. Elegibilidade — toda entrada referenciada pela ordem canônica deve estar presente na request.
Derivação por entrada, iterando a ordem canônica: cada Admission Entry produz exatamente uma Materialization Entry; `materialization_position` atribuído sequencialmente apenas às entradas genuinamente `QUEUE_ADMISSION_ACCEPTED_SIMULATION && queue_admission_validated === true`, na mesma iteração que constrói todas as entradas (materializadas ou não).
12-13. Queue Materialization Order — subsequência genuína da ordem canônica, com as duas flags de preservação re-verificadas (nunca afirmadas `true` por construção); qualquer falha bloqueia `QUEUE_MATERIALIZATION_ORDER_BLOCKED`/`QUEUE_MATERIALIZATION_PREDECESSOR_BLOCKED`.
15. Invariantes de não-execução.

Emissão final de Package/Decision/Result/Audit. Qualquer inconsistência bloqueia fail-closed.

## Runtime Queue Materialization Package / Decision / Result / Audit

`runtime-queue-materialization-package.js` (49 campos exatos) é o envelope final imutável: IDs upstream (Request/Queue Admission Package/Queue Admission Order/própria Order), identidade canônica, 2 listas de ID derivadas (entries/Queue Classes), 2 listas de ordem genuína, 2 listas de partição, 3 contagens, 4 fingerprints upstream (Package/digest/Order da Admission, Order desta camada), 3 listas de fingerprints derivados (entradas de admissão/Queue Class/entradas de materialização), 18 flags operacionais nomeadas explicitamente contra cada proibição da seção 3 da especificação (`queue_created`/`queue_item_enqueued`/`broker_published`/`worker_notified`/`job_created`/`dispatch_executed`/etc., todas permanentemente `false`), e `queue_materialization_package_fingerprint`/`_digest` recalculados (mesmo padrão de dois campos excluídos progressivamente já estabelecido em toda a linhagem).

`runtime-queue-materialization-decision.js` define seu próprio vocabulário de 11 status (5 próprios + os 6 de identidade já reutilizados de toda a linhagem), com sua própria `QUEUE_MATERIALIZATION_PRECEDENCE_ORDER` e `STATUS_OUTCOME_MAP`. 11 flags `*_validated` mapeiam 1:1 nas seções de cross-check do boundary; apenas uma se torna verdadeira em conjunto com o outcome (`queue_materialization_package_prepared_in_simulation`), enquanto toda flag operacional permanece sempre `false`. `runtime-queue-materialization-result.js` é um envelope mais amplo (20 flags operacionais seguras, incluindo `queue_item_dequeued`/`broker_subscribed`/`worker_started`/`lease_created`/`lock_created`/`dispatch_authorized`/`network_used`/`secret_resolved`), o mesmo padrão de dois níveis já estabelecido entre Decision/Result em toda a linhagem.

`runtime-queue-materialization-audit.js` registra apenas IDs/fingerprints/digest, status/decision/next_state, bindings de identidade, IDs de Queue Class, `entry_counts`, blockers, reason codes, logical sequence — **nunca payload completo, prompt, mensagem, memória, segredo, credencial, argumentos de tool ou código.**

## Registry

`runtime-queue-materialization-registry.js` cria 7 registros privados e sintéticos (request, entry, order, package, decision, result, audit) — reutilizando o mesmo padrão `createEntityStore`/`resolveRegistration` já estabelecido em toda a linhagem (replay → payload mismatch → conflito de versão esperada → conflito de fingerprint esperado → downgrade de versão → aceito). Sem persistência.

## Escopo deliberadamente mínimo

Nenhum contrato de Policy, Replay, Idempotency, Freshness, Registry Snapshot ou Group foi introduzido nesta PR — "não introduza... sem necessidade arquitetural demonstrável" — e nenhum deles tem justificativa arquitetural genuína neste nível: nenhum novo limite é introduzido (Queue Admission Policy já governa contagens); nenhuma nova semântica de "tentativa" exige proteção de replay; agrupamento por Queue Class já está disponível via o próprio `runtime_queue_class_reference_id` herdado de cada entrada.

## Fixture

`test/fixtures/hermes-runtime-queue-materialization-simulation-contracts.json` (versão 1) contém 2 cenários gerados programaticamente a partir do próprio `evaluateRuntimeQueueMaterializationRequest` real (nunca objetos JSON forjados à mão), via `test/helpers/runtime-queue-materialization-simulation-test-data.js`: o caminho feliz com todas as entradas admitidas e materializadas, e um plano sequencial com uma entrada ainda aguardando dependência (nunca materializada, mas presente na Order com posição `null`). Apenas a `decision` de cada cenário é persistida — mesma razão documentada em `HERMES_RUNTIME_QUEUE_ADMISSION_SIMULATION_CONTRACTS.md`: o encadeamento de fingerprints por camada (cada `_fingerprint` é o texto canônico completo da camada anterior, não um hash) faz o objeto completo crescer rapidamente, então o número de cenários no fixture é mantido deliberadamente pequeno. A cauda longa de cenários — bloqueios de ordem, predecessor, identidade, fingerprint, fail-closed e side-channel — é coberta inline em `test/runtime-queue-materialization-simulation-contracts.test.js` (47 testes).

## Novo gate de arquitetura: FORBIDDEN_QUEUE_CLIENT_IMPORT

A especificação exige provar, via gates de arquitetura, que nenhum cliente real de fila/broker (Redis, RabbitMQ, Kafka, SQS, Bull/BullMQ) é importado por qualquer contrato desta camada. Nenhum gate existente cobria esse vocabulário — os gates de padrão pré-existentes cobrem rede/filesystem/child_process/eval/dynamic-import/runtime/provider-SDK/env/timer/global-mutável/endpoint, mas nenhum termo específico de fila. `FORBIDDEN_QUEUE_CLIENT_IMPORT` (`architecture-gate-rules.js`) foi adicionado como o 13º pattern gate (22 gates no total, 13 de padrão + 9 estruturais), cobrindo `require('ioredis'|'redis'|'amqplib'|'amqp-connection-manager'|'kafkajs'|'node-rdkafka'|'bull'|'bullmq'|'bee-queue'|'@aws-sdk/client-sqs'|'sqs-consumer'|'sqs-producer')`.

## Confirmação de nenhuma execução real

Em todo status producível: `queue_materialization_applied`, `queue_created`, `queue_item_created`, `queue_item_enqueued`, `queue_item_dequeued`, `queue_position_reserved`, `broker_published`, `broker_subscribed`, `worker_notified`, `worker_started`, `lease_created`, `lock_created`, `job_created`, `dispatch_authorized`, `dispatch_executed`, `network_used`, `secret_resolved`, `executed` permanecem sempre `false`; `simulation=true`; `production_blocked=true`; `rollout_percentage=0`. Nenhuma fila, tópico, broker ou consumer real é criado; nenhum item de fila é inserido; nenhuma posição é reservada de fato; nenhum job é criado; nenhum dispatch é autorizado ou executado; nenhum worker é notificado; nenhuma rede é usada; nenhum segredo é resolvido; nenhuma execução real ocorre em nenhum caminho desta implementação.

## Limitações

- `checkIdentity(admissionOrderRef, canonical, ...)` é estruturalmente um no-op nesta camada: `RuntimeQueueAdmissionOrderReference` (PR #108) nunca carrega campos de identidade (`tenant_id`/`organization_id`/etc.), e `checkIdentity` só bloqueia quando o campo está presente E diverge. A proteção real contra identidade forjada vem transitivamente da auto-consistência de fingerprint do Queue Admission Package (qualquer alteração de `tenant_id` sem recomputar `queue_admission_package_fingerprint` já é rejeitada na validação da referência aninhada do Request) e da prova de não-substituição por ID/fingerprint de cada sub-objeto — não desta chamada específica. Documentado honestamente em vez de reivindicar uma garantia que essa chamada isolada não produz.
- Esta camada herda `admission_status`/`queue_admission_validated` verbatim da Queue Admission Entry — nunca reavalia se a admissão original permanece válida sob condições atuais (capacidade/quota/fairness já podem ter mudado desde que a Admission foi preparada); essa reavaliação, se necessária, pertence à Admission layer, não a esta.
- Nenhum worker real, processo, thread, container, fila, tópico, broker, consumer, job, cron, timer, retry, polling ou child_process é usado ou referenciado em qualquer módulo desta PR. Nenhuma rede é usada e nenhum segredo é resolvido em nenhum caminho desta avaliação.

"A próxima etapa, após auditoria e merge, é a camada seguinte da simulação de runtime, ainda sem fila ou item real."

# Hermes Agent Core - Runtime Scheduler Simulation Contracts

## Objetivo

Criar os contratos declarativos do futuro scheduler do Hermes. Esta PR recebe somente um pacote cujo resultado de admissão seja `RUNTIME_ADMITTED_SIMULATION` (PR #104) e produz um plano declarativo de scheduling: quais estágios seriam elegíveis, em qual ordem seriam considerados, quais dependências precisariam estar satisfeitas, quais estágios poderiam formar grupos paralelos, quais estágios aguardariam aprovação, quais prioridades seriam aplicadas, quais slots declarativos seriam necessários, quais limites de concorrência seriam respeitados, quais condições impediriam o agendamento, e quais eventos/artefatos seriam apenas referenciados.

**SCHEDULER_PACKAGE_PREPARED_SIMULATION significa somente que uma representação declarativa da ordem e elegibilidade dos estágios foi preparada. Nenhum scheduler foi iniciado.**

## Admission ≠ Scheduler Package

`RUNTIME_ADMITTED_SIMULATION` (PR #104) prova que um Runtime Execution Package pode ser admitido — identidade, capacidade, concorrência, freshness, replay e idempotência genuinamente revalidados. Isso nunca definiu ordem de scheduling, grupos paralelos, estágios bloqueados por dependência, estágios aguardando aprovação, prioridades ou limites de slots declarativos. `SCHEDULER_PACKAGE_PREPARED_SIMULATION` é a camada seguinte: recebe um pacote já admitido como pré-condição obrigatória e produz exclusivamente uma representação declarativa de scheduling — nunca dispatch, nunca job, nunca fila, nunca worker.

Distinção preservada explicitamente em todo o código e testes:

```
RUNTIME_PACKAGE_PREPARED_SIMULATION ≠ RUNTIME_READY_SIMULATION ≠ RUNTIME_ADMITTED_SIMULATION
  ≠ SCHEDULER_PACKAGE_PREPARED_SIMULATION ≠ SCHEDULER_STARTED ≠ JOB_CREATED
  ≠ STAGE_DISPATCHED ≠ STAGE_STARTED ≠ EXECUTED
```

## Runtime Scheduler Policy

`runtime-scheduler-policy.js` (60 campos exatos). Nenhuma policy pode habilitar scheduler ou execução: `allow_scheduler_package_preparation_simulation=true`, `allow_external_effect_reference=false`, `allow_irreversible_reference=false`, todos os 19 `require_*` e os 16 `fail_on_*`/`fail_closed` são estruturalmente forçados `true`. Os 8 `allow_*_stage_reference` restantes (required/optional/parallel/approval/model/tool/workflow/state-change) são genuinamente configuráveis e revalidados pelo boundary contra a composição real do Runtime Stage Manifest — o mesmo padrão que `runtime-readiness-policy.js`'s próprios `allow_*_package` já estabeleceu. Os 9 `maximum_*` são limites reais comparados contra contagens honestamente derivadas, nunca reservados nem consumidos.

## Runtime Scheduler Request

`runtime-scheduler-request.js` (27 campos exatos) agrega toda referência que o boundary precisa: a cadeia de Admission já admitida (`runtime_admission_request_reference`/`_decision_reference`/`_result_reference`), a Readiness Decision, o Runtime Execution Package, os manifests de Stage e Dependency, o Runtime Budget, e as referências de Capacity/Concurrency/Freshness/Replay/Idempotency — **reutilizadas verbatim** das PRs #104/#98, nunca contratos paralelos: `runtime_freshness_reference` é a mesma `RuntimeReadinessFreshnessReference`; `runtime_replay_reference` é a mesma `RuntimeReadinessReplayReference`; `idempotency_reference` é a mesma `ExecutionPlanIdempotencyReference`. `context` nunca é lido para nenhuma decisão.

O request fingerprint (calculado pelo boundary, nunca um campo próprio do contrato — o mesmo padrão de `runtime-readiness-request.js`/`runtime-admission-request.js`) exclui `runtime_replay_reference` da sua própria canonicalização para evitar dependência circular, exatamente o mesmo `omitReplayReference` que toda a linhagem PR #104 já estabeleceu, aplicado aqui ao campo com o nome específico desta camada.

## Runtime Scheduler Stage Reference

`runtime-scheduler-stage-reference.js` (56 campos exatos). Materialização 1:1 minimizada de uma `RuntimeStageSimulationReference` (PR #103) para fins de scheduling — preserva integralmente stage IDs, sequence, type, priority, optional, parallelizable, approval_required, capabilities, modalities, bindings, tokens, custo, side effect e risk classification. Um self-fingerprint válido nunca substitui o cross-check 1:1 (`runtime-scheduler-boundary.js`'s próprio teste de preservação).

### Scheduler Stage Status / Eligibility Status

Dois vocabulários paralelos, mapeados 1:1 (`STATUS_ELIGIBILITY_MAP`): `SCHEDULER_STAGE_ELIGIBLE_SIMULATION`/`ELIGIBLE_REFERENCE_SIMULATION`, `SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE`/`WAITING_DEPENDENCY_REFERENCE`, `SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE`/`WAITING_APPROVAL_REFERENCE`, `SCHEDULER_STAGE_OPTIONAL_REFERENCE`/`OPTIONAL_REFERENCE`, `SCHEDULER_STAGE_BLOCKED`/`BLOCKED_REFERENCE`, `SCHEDULER_STAGE_NOT_EVALUATED`/`NOT_EVALUATED_REFERENCE`.

**Estágios com dependências required permanecem WAITING_DEPENDENCY_REFERENCE porque nenhuma dependência é satisfeita nesta PR.** A derivação de elegibilidade (`runtime-scheduler-boundary.js`'s `deriveStageStatus`) segue, nesta ordem: (1) violação estrutural/policy (efeito externo/irreversível, tipo de stage não permitido pela policy) → `BLOCKED`; (2) qualquer dependência de entrada (nenhuma jamais satisfeita nesta PR) → `WAITING_DEPENDENCY_REFERENCE`; (3) `approval_required=true` → `WAITING_APPROVAL_REFERENCE`; (4) `optional=true` → `OPTIONAL_REFERENCE`; (5) caso contrário → `ELIGIBLE_REFERENCE_SIMULATION`. "Isso ainda não significa que será executado" — nenhum flag operacional (`job_created`, `queue_used`, `worker_assigned`, `stage_dispatched`, `stage_started`, `stage_completed`, `stage_failed`, `scheduler_stage_applied`) é jamais forçado `true`, independentemente do status.

## Runtime Scheduler Dependency Reference

`runtime-scheduler-dependency-reference.js` (20 campos exatos). Materialização 1:1 de uma `RuntimeDependencySimulationReference` (PR #103) — preserva source dependency ID, from/to endpoints, type, required, cardinalidade e fingerprints. Não redireciona endpoints (`fail_on_dependency_redirection`). `would_block_target=true` somente quando a dependência é `required` (nunca satisfeita nesta PR); `dependency_satisfied`/`dependency_applied`/`would_allow_target` permanecem sempre `false`.

## Runtime Scheduler Parallel Group Reference

`runtime-scheduler-parallel-group-reference.js` (25 campos exatos). **Parallel groups são derivados do grafo upstream e não podem ser fornecidos livremente pelo caller.** `runtime-scheduler-boundary.js` computa a profundidade topológica real de cada estágio (maior caminho a partir de qualquer raiz, sobre o grafo de dependências completo) e agrupa candidatos `parallelizable=true` + `ELIGIBLE_REFERENCE_SIMULATION` que compartilham a mesma profundidade — membros no mesmo nível topológico nunca têm uma aresta direta entre si, por definição de profundidade, então "nenhuma dependência sequencial entre membros do mesmo grupo" é uma garantia estrutural, não uma checagem adicional. `parallel_group_validated` exige `capacity_within_limit`/`concurrency_within_limit`/`budget_within_limit` simultaneamente `true`. `parallel_group_applied`/`_started`/`_completed` permanecem sempre `false`.

## Runtime Scheduler Approval Wait Reference

`runtime-scheduler-approval-wait-reference.js` (18 campos exatos). **Derivar exclusivamente de `approval_required`.** Um estágio com `approval_required=true` sempre produz `waiting_for_approval=true` e `approval_status=WAITING_APPROVAL_REFERENCE`; a validação do próprio contrato rejeita qualquer combinação divergente. **Estágios que exigem aprovação permanecem WAITING_APPROVAL_REFERENCE. Nenhuma aprovação é concedida ou consumida** — `approval_granted`/`approval_consumed`/`approval_applied` são permanentemente forçados `false`.

## Runtime Scheduler Capacity Plan Reference

`runtime-scheduler-capacity-plan-reference.js` (34 campos exatos). `requested_*` (8 dimensões: package/stage/parallel/model/tool/workflow slots, tokens, custo) são derivados do Runtime Stage Manifest real — nunca aceitos como declarados livremente pelo chamador. `available_*` são derivados da Capacity Snapshot real. Cada dimensão produz seu próprio `*_within_limit` recalculado (`available >= requested`); `capacity_plan_validated` exige todas as 8 simultaneamente. Nenhuma capacidade é reservada, nenhum slot é consumido (`capacity_reserved`/`slots_consumed`/`capacity_plan_applied` sempre `false`).

## Runtime Scheduler Queue Plan Reference

`runtime-scheduler-queue-plan-reference.js` (25 campos exatos). **RuntimeSchedulerQueuePlanReference não representa uma fila real. Nenhum item é enfileirado.** É apenas uma lista declarativa ordenada (`ordered_scheduler_stage_reference_ids`) mais 5 listas de categoria (eligible/waiting-dependency/waiting-approval/optional/blocked) que devem particionar completamente a lista ordenada — todo estágio aparece em exatamente uma categoria, nunca ausente, nunca duplicado (`partitionMatches`). `queue_created`/`queue_used`/`job_created`/`scheduler_started` permanecem sempre `false`.

### Ordem determinística obrigatória

`runtime-scheduler-boundary.js`'s `schedulerSortKey` aplica, nesta ordem exata: (1) estágios bloqueados por último; (2) estágios sem dependência required antes dos que aguardam dependência; (3) estágios sem `approval_required` antes dos que aguardam aprovação; (4) required antes de optional; (5) maior `priority` primeiro; (6) menor `stage_sequence` primeiro; (7) menor `runtime_stage_reference_id` lexicograficamente como desempate canônico. Nenhum `context` altera a ordem. **Nenhum job, queue, worker ou dispatch é criado.**

Como nenhum predecessor é jamais concluído nesta PR, todo estágio-alvo de uma dependência permanece `WAITING_DEPENDENCY_REFERENCE`, enquanto seu predecessor (se não também bloqueado/aguardando) ordena antes dele — preservando a semântica do grafo sem exigir uma ordenação topológica completa entre estágios mutuamente `WAITING_DEPENDENCY_REFERENCE` (a classificação em si já reflete corretamente que nenhum deles está pronto; reordenação artificial entre eles não é tentada).

## Runtime Scheduler Package / Decision / Result

`runtime-scheduler-package.js` (89 campos exatos) é o envelope final imutável: todo ID/fingerprint upstream, as 4 listas de referências derivadas, o resumo de partição da queue plan, contagens agregadas, e `scheduler_package_fingerprint`/`scheduler_package_digest` recalculados (padrão idêntico ao `runtime-capacity-snapshot-reference.js`'s `computeFingerprint`/`computeDigest`, dois campos excluídos progressivamente).

`runtime-scheduler-decision.js` define seu próprio vocabulário de 27 status (21 próprios + os 6 de identidade já reutilizados de toda a linhagem), com sua própria `RUNTIME_SCHEDULER_PRECEDENCE_ORDER` e `STATUS_OUTCOME_MAP` — separado, nunca fundido a `validation-taxonomy.js` nem ao vocabulário de nenhuma camada anterior, o mesmo padrão que as PRs #102-#104 já estabeleceram. 22 flags `*_validated` mapeiam 1:1 nas seções de cross-check do boundary. `runtime-scheduler-result.js` é um envelope fino sobre a decisão.

## Runtime Scheduler Boundary

`runtime-scheduler-boundary.js`'s `evaluateRuntimeSchedulerRequest(request, context)` segue a ordem real de precedência (identidade antes de policy — a mesma distinção "ordem declarada ≠ ordem de avaliação" de toda camada anterior):

1. Request/simulation_context/policy/toda referência aninhada contra seu validador oficial.
2. Identidade (`checkIdentity`, mesma função de `runtime-execution-package.js`).
3. Scheduler Policy — `allow_*_stage_reference` contra a composição real, mais os limites de contagem/tokens/custo computáveis diretamente do manifest.
4. Cadeia de Admission genuinamente admitida (status, flags, IDs encadeados).
5. Runtime Package ainda não mutado (stops/compensações/artifact/event plan cross-checados aqui, sem slot próprio de precedência).
6. Stage Manifest / Dependency Manifest contra o que o Runtime Package declara.
7. Budget, Capacity Snapshot, Concurrency — ainda a mesma referência que a Admission usou.
8. Freshness recalculada na sequência do próprio Scheduler Request (nunca a `current_logical_sequence` congelada).
9. Replay — a `RuntimeReadinessReplayReference` reutilizada é vinculada ao `runtime_admission_request_reference` real deste request (fingerprint recomputado via `computeAdmissionRequestFingerprint`, mesma exclusão de duas passadas que `runtime-admission-boundary.js` já estabeleceu), nunca apenas "o mesmo objeto que a Admission já usou".
10. Idempotency — a `ExecutionPlanIdempotencyReference` deste request é provada ser a mesma que fluiu através da Readiness Request embutida na cadeia de Admission (`runtime_admission_request_reference.runtime_readiness_request_reference.idempotency_reference`), mais seu próprio self-fingerprint recomputado.
11. Derivação: Scheduler Stage References → Scheduler Dependency References → Parallel Groups → Approval Waits → Capacity Plan → Queue Plan, com os limites de policy dependentes de dados derivados (`maximum_parallel_group_count`, `maximum_stages_per_parallel_group`, `maximum_waiting_approval_stage_count`) verificados após a derivação interna, mas retornando `SCHEDULER_POLICY_BLOCKED` (posição de precedência mais cedo que os status `SCHEDULER_PARALLEL_GROUP_BLOCKED`/`SCHEDULER_APPROVAL_WAIT_BLOCKED`) — o mesmo "declarar primeiro, avaliar na ordem real de precedência depois" já estabelecido.
12. Invariantes de não-execução.
13. Emissão de Decision/Result/Audit.

Qualquer inconsistência bloqueia fail-closed.

## Registry

`runtime-scheduler-registry.js` cria 11 registros privados e sintéticos (scheduler requests, scheduler stages, scheduler dependencies, parallel groups, approval waits, capacity plans, queue plans, scheduler packages, decisions, results, audits) — reutilizando o mesmo padrão `createEntityStore`/`resolveRegistration` que `runtime-admission-registry.js` já estabeleceu (replay → payload mismatch → conflito de versão esperada → conflito de fingerprint esperado → downgrade de versão → aceito). Sem persistência. A prevenção genuína de duplicação de scheduler package (`duplicate-scheduler-package`/`scheduler-attempt-exceeded`) é fornecida por este registry (replay/payload-mismatch sobre `runtime_scheduler_package_id`), não por um contrato de replay paralelo — a `RuntimeReadinessReplayReference` reutilizada no Scheduler Request continua a provar apenas a continuidade genuína com a cadeia de Admission, nunca reaproveitada como se `admission_request_fingerprint` descrevesse o próprio Scheduler Request.

## Auditoria

`runtime-scheduler-audit.js` registra apenas IDs, fingerprints, digest, status/decision/next_state, bindings de identidade, contagens de stage/dependency/parallel-group/approval-wait, contagens de elegibilidade/waiting, flags declarativas de limite de capacidade, estimativas de tokens/custo, blockers, reason codes, logical sequence, `simulation=true`, `production_blocked=true`, `executed=false` — **nunca payload completo, StageRecords, conteúdo, prompts, memória, mensagens, argumentos de tool, respostas, secrets, tokens reais, endpoints, código ou output de provider.**

## Fixture

`test/fixtures/hermes-runtime-scheduler-simulation-contracts.json` contém 17 cenários curados: 4 caminhos `SCHEDULER_PACKAGE_PREPARED_SIMULATION` (sem LLM, model/tool/workflow reference), um caminho com dependência (estágio-alvo permanece waiting), e representantes de cada categoria principal de bloqueio (admissão não admitida, runtime package mutado, stage/dependency manifest divergente, capacidade divergente, freshness expirada, replay não vinculado, idempotência divergente, limite de policy excedido, mismatch de tenant, side-channel hostil, ordem canônica). A cauda longa de adulterações campo-a-campo é coberta inline em `test/runtime-scheduler-simulation-contracts.test.js`, construída via `test/helpers/runtime-scheduler-simulation-test-data.js` sobre o "golden bundle" já admitido que `runtime-readiness-admission-test-data.js` (PR #104) já fornece.

## Confirmação de nenhuma execução real

Em todo status producível: `scheduler_started`, `scheduler_loop_started`, `job_created`, `queue_created`, `queue_used`, `worker_started`, `worker_assigned`, `stage_dispatched`, `stage_started`, `stage_completed`, `stage_failed`, `runtime_enabled`, `execution_authorized`, `execution_started`, `dependency_satisfied`, `dependency_applied`, `parallel_group_started`, `tokens_reserved`, `tokens_consumed`, `cost_reserved`, `cost_consumed`, `capacity_applied`, `concurrency_applied`, `executed` permanecem sempre `false`; `simulation=true`; `production_blocked=true`; `rollout_percentage=0`. Nenhuma capacidade é aplicada; nenhum slot é consumido; nenhuma fila é criada; nenhum job é criado; nenhum worker é iniciado; nenhum estágio é despachado; nenhum scheduler é iniciado; nenhuma execução real ocorre em nenhum caminho desta implementação.

## Limitações

- `SCHEDULER_VERSION_BLOCKED`, `SCHEDULER_CONFLICT_BLOCKED` e `SCHEDULER_UNKNOWN_STATUS_BLOCKED` existem no vocabulário de status (`runtime-scheduler-decision.js`) para completude e paridade com toda a linhagem PR #102-#104, mas o boundary evaluator (`evaluateRuntimeSchedulerRequest`) não os produz diretamente nesta PR — reservados para conflitos de versão/fingerprint que só se manifestam através do Registry (o mesmo padrão que `RUNTIME_VERSION_BLOCKED`/`RUNTIME_CONFLICT_BLOCKED` já seguem uma camada abaixo).
- A derivação de grupos paralelos usa profundidade topológica simples (maior caminho a partir de qualquer raiz) para aproximar "mesmo nível topológico" — suficiente para o grafo de dependências desta PR, mas não uma implementação genérica de particionamento por antichains.
- Nenhum scheduler real, fila, worker, job, cron, timer, retry, polling, thread ou child_process é usado ou referenciado em qualquer módulo desta PR.

**A próxima etapa, após auditoria e merge, é Runtime Worker Assignment Simulation Contracts, ainda sem worker real.**

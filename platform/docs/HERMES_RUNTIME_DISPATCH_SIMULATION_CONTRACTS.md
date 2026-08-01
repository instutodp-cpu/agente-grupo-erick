# Hermes Agent Core - Runtime Dispatch Simulation Contracts

## Objetivo

Criar a camada declarativa de dispatch do Hermes, construída sobre um Worker Assignment Package já `WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION` (PR #106). Recebe apenas o pacote `WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION` (mais toda a cadeia Scheduler/Runtime que o sustenta) e produz uma representação declarativa de: quais Scheduler Stages estariam prontos para intenção de dispatch; qual Worker Reference recomendado por stage; quais stages continuam aguardando dependência/aprovação; quais stages opcionais são apenas referenciados; quais estão bloqueados; a ordem determinística de intenção de dispatch; quais dependências/capacidades/policies/budgets/autorizações permanecem válidas; quais referências de payload seriam encaminhadas a uma futura camada operacional; quais blockers impediriam a preparação; e qual envelope declarativo seria preparado para uma futura fila/executor — nunca dispatch real, nunca mensagem enviada, nunca job/fila/item de fila criado, nunca worker reservado, nunca slot de worker consumido, nunca conexão aberta, nunca processo/thread criado, nunca container/worker/scheduler iniciado.

"DISPATCH_PACKAGE_PREPARED_SIMULATION significa somente que envelopes declarativos de dispatch foram preparados. Nenhum dispatch foi autorizado, aplicado ou enviado."

## Worker Assignment Package ≠ Dispatch Package

`WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION` (PR #106) prova que, para cada estágio elegível de um Scheduler Package já preparado, um worker declarativo compatível foi avaliado e, quando possível, recomendado — nunca definiu se esse estágio estaria efetivamente pronto para uma intenção de dispatch (dependências/aprovações pendentes, capacidade/budget/payload ainda válidos, ordem determinística de disparo). `DISPATCH_PACKAGE_PREPARED_SIMULATION` é a camada seguinte: recebe um pacote de Worker Assignment já preparado como pré-condição obrigatória e produz exclusivamente uma representação declarativa de intenção de dispatch por estágio — nunca lease, nunca envio, nunca reserva, nunca fila, nunca job, nunca processo, nunca thread, nunca container.

Distinção preservada explicitamente em todo o código e testes:

```
RUNTIME_PACKAGE_PREPARED_SIMULATION ≠ RUNTIME_READY_SIMULATION ≠ RUNTIME_ADMITTED_SIMULATION
  ≠ SCHEDULER_PACKAGE_PREPARED_SIMULATION ≠ WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION
  ≠ DISPATCH_PACKAGE_PREPARED_SIMULATION ≠ DISPATCH_AUTHORIZED ≠ DISPATCH_APPLIED ≠ JOB_CREATED
  ≠ QUEUE_ITEM_CREATED ≠ WORKER_RESERVED ≠ STAGE_DISPATCHED ≠ STAGE_STARTED ≠ EXECUTED
```

## Runtime Dispatch Policy

`runtime-dispatch-policy.js` (65 campos exatos). Nenhuma policy pode habilitar dispatch, autorização ou execução real: os 22 `require_*` e os 21 `fail_on_*`/`fail_closed` são estruturalmente forçados `true`; `allow_external_effect_reference=false` e `allow_irreversible_reference=false` são permanentes. Os 7 `allow_*` (no-LLM/model/tool/workflow dispatch reference, optional/parallel stage dispatch reference, state-change reference) são genuinamente configuráveis. Os 7 `maximum_*` (intenções de dispatch total/model/tool/workflow/parallel, tokens/custo estimado) são limites reais comparados contra contagens honestamente agregadas durante a avaliação — hoje, apenas `maximum_dispatch_intent_count` é efetivamente aplicado pelo boundary (ver "Limitações").

## Contratos declarativos por estágio

`runtime-dispatch-stage-reference.js` (campos exatos) materializa, por Scheduler Stage, o `dispatch_stage_status` (7 valores: `DISPATCH_STAGE_ELIGIBLE_SIMULATION`/`DISPATCH_STAGE_OPTIONAL_REFERENCE`/`DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE`/`DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE`/`DISPATCH_STAGE_NO_WORKER_BLOCKED`/`DISPATCH_STAGE_BLOCKED`/`DISPATCH_STAGE_NOT_EVALUATED`), derivado estruturalmente do `assignment_status` que o Worker Stage Assignment (PR #106) já produziu para esse mesmo estágio — nunca recalculado a partir de dependências/aprovações brutas.

"Stages aguardando dependência ou aprovação não geram intents preparadas."

Um estágio com `assignment_status === WORKER_RECOMMENDED_SIMULATION` só se torna `DISPATCH_STAGE_ELIGIBLE_SIMULATION` quando `stage.optional !== true`; um estágio opcional recomendado torna-se `DISPATCH_STAGE_OPTIONAL_REFERENCE` — nunca automaticamente elegível para dispatch operacional. `stage_dispatched`/`stage_started` são sempre `false`.

`runtime-dispatch-worker-binding-reference.js` revalida, na sequência lógica do próprio Dispatch Request (uma camada além da sequência do Worker Assignment), que o worker recomendado continua: no conjunto de candidatos compatíveis; com Compatibility Reference válida; saudável (reutilizando `evaluateHealthAtAssignment` do PR #106, agora aplicado a esta sequência mais tardia); com capacidade suficiente; no mesmo tenant/organização/projeto.

"Worker recomendado não constitui reserva, lease ou contato com worker."

`worker_reserved`/`worker_started`/`worker_connection_opened`/`worker_binding_applied` são sempre `false`.

`runtime-dispatch-dependency-gate-reference.js`/`runtime-dispatch-approval-gate-reference.js` derivam `dispatch_allowed_by_dependencies`/`dispatch_allowed_by_approval` diretamente dos campos `dependency_reference_ids`/`blocking_dependency_reference_ids`/`approval_required` que o próprio `RuntimeSchedulerStageReference` (PR #105) já carrega pré-resolvidos — nunca a partir de uma `RuntimeSchedulerDependencyReference`/`RuntimeSchedulerApprovalWaitReference` bruta separada (a Dispatch Request não carrega essas referências brutas como campos próprios; a especificação desta PR também não as exige). `dependency_reference_ids` do Scheduler não distingue dependências "opcionais", então `optional_dependency_reference_ids` é sempre `[]` — uma simplificação documentada honestamente. `dependencies_satisfied`/`dependencies_applied`/`approval_granted`/`approval_consumed`/`approval_applied` são sempre `false`.

`runtime-dispatch-capacity-reference.js` reaproveita a mesma aritmética por-dimensão (`available_X >= requested_X`) que o `capacity_match` do Worker Assignment já usa para capacidade em nível de worker; em nível de runtime, `RuntimeCapacitySnapshotReference` expõe apenas um `capacity_available` agregado único (não há quebra por dimensão hoje) e `RuntimeConcurrencyReference` expõe flags por dimensão (`parallel_slots_available`/`model_slots_available`/`tool_slots_available`/`workflow_slots_available`) — reutilizados diretamente. `capacity_applied`/`capacity_reserved`/`slots_consumed` são sempre `false`.

`runtime-dispatch-budget-reference.js` deriva `budget_validated` de 4 flags (`input_within_limit`/`output_within_limit`/`total_within_limit`/`cost_within_limit`), cada uma `estimated_X <= remaining_X`. Como nenhum contrato upstream expõe "quanto já foi consumido por outros estágios", `remaining_*` usa o teto `maximum_*` do próprio `RuntimeBudgetSimulationReference` do plano inteiro como aproximação — uma limitação honesta e documentada (ver "Limitações"). `tokens_reserved`/`tokens_consumed`/`cost_reserved`/`cost_consumed` são sempre `false`.

`runtime-dispatch-payload-reference.js` carrega somente IDs/fingerprints/tipos/estimativas — nunca conteúdo:

"RuntimeDispatchPayloadReference contém somente referências e fingerprints. Não contém prompt, mensagem, memória, segredo, credencial, argumentos de ferramenta, endpoint ou código executável."

Os 10 `*_included` (`payload_content_included`, `prompt_included`, `message_included`, `memory_content_included`, `secret_included`, `credential_included`, `tool_arguments_included`, `provider_output_included`, `executable_code_included`, `endpoint_included`) são permanentemente forçados `false`, mesmo que o input de build tente declará-los `true` — e o boundary, em defesa adicional, roda `findAgentCoreOperationalMaterial` sobre cada Payload Reference construída como um "gate" de payload genuíno, nunca apenas confiando nas flags seguras. `payload_applied`/`payload_sent` são sempre `false`.

`runtime-dispatch-intent-reference.js` (9 valores de `dispatch_intent_status`) só produz `DISPATCH_INTENT_PREPARED_SIMULATION` quando os 6 gates (`dependency_gate_passed`/`approval_gate_passed`/`capacity_gate_passed`/`budget_gate_passed`/`worker_gate_passed`/`payload_gate_passed`) são simultaneamente verdadeiros — qualquer outro status exige que nem todos sejam verdadeiros (consistência bidirecional verificada pelo próprio validador). `dispatch_authorized`/`dispatch_applied`/`dispatch_sent`/`dispatch_acknowledged`/`dispatch_lease_created` são sempre `false`.

`runtime-dispatch-order-reference.js` preserva a ordem genuína de entrada em `ordered_dispatch_stage_reference_ids`/`ordered_dispatch_intent_reference_ids` — nunca reordenada alfabeticamente, ao contrário de toda outra lista de ID nesta linhagem, porque a ordem é o próprio conteúdo que este contrato existe para preservar:

"A ordem de dispatch é uma subsequência estável da ordem topológica do Scheduler Package."

As 5 listas de partição (`prepared_*`/`waiting_dependency_*`/`waiting_approval_*`/`optional_*`/`blocked_intent_reference_ids`) particionam completamente `ordered_dispatch_intent_reference_ids`, sem sobreposição e sem lacuna. `dispatch_order_applied` é sempre `false`.

`runtime-dispatch-replay-reference.js` (28 campos exatos, próprio deste layer — nunca a Replay Reference de Admission/Worker Assignment reutilizada "como se fosse" Dispatch Replay) prova, por ID+fingerprint+digest, vínculo genuíno ao Worker Assignment Package, ao Scheduler Package e ao Runtime Execution Package que esta avaliação está usando, mais ao mesmo `idempotency_reference` da cadeia. `replay_allowed` é derivado (`expected_dispatch_attempt <= maximum_dispatch_attempts && duplicate_dispatch_preparation_blocked !== true`), nunca declarado livremente pelo caller. `replay_consumed` é sempre `false`. `omitDispatchReplayReference` (exportado por `runtime-dispatch-request.js`) exclui apenas este campo do cálculo do fingerprint do próprio Dispatch Request — a mesma exclusão canônica já estabelecida para Replay References em toda a linhagem, resolvendo a circularidade auto-referencial explicitamente sinalizada pela especificação.

## Runtime Dispatch Request

`runtime-dispatch-request.js` (37 campos exatos) agrega toda a cadeia Worker Assignment + Scheduler + Runtime já preparada (reutilizadas verbatim, nunca contratos paralelos), Capacity Snapshot/Concurrency/Budget/Freshness/Replay/Idempotency/Registry Snapshot, os catálogos de Worker/Compatibility/Candidate-Set/Stage-Assignment/Stage-Policy-Requirement e as policies oficiais de Network/Secret já produzidas pelo Worker Assignment (reutilizadas verbatim, nunca re-derivadas), mais a própria `runtime_dispatch_policy` e `runtime_dispatch_replay_reference`. `context` nunca é lido para nenhuma decisão.

### Prova de não-substituição por fingerprint/ID-set

A Dispatch Request não carrega novamente todos os campos brutos de proveniência que o Worker Assignment já validou (Model-Selection/Tool-Contract/Workflow-Contract oficiais, por exemplo) — em vez disso, o boundary prova que as listas que a Dispatch Request de fato carrega (`runtime_worker_references`, `runtime_worker_compatibility_references`, `runtime_worker_candidate_set_references`, `runtime_worker_stage_assignment_references`, `runtime_worker_stage_policy_requirement_references`, `network_permission_policy_references`, `secret_resolution_policy_references`) produzem exatamente o mesmo conjunto de fingerprints/IDs já registrado no `RuntimeWorkerAssignmentPackage` (`worker_reference_ids`, `worker_compatibility_reference_ids`, `worker_candidate_set_reference_ids`, `worker_stage_assignment_reference_ids`, `stage_policy_requirement_fingerprints`, `official_network_policy_fingerprints`, `official_secret_policy_fingerprints`) — nunca uma lista independentemente substituída pelo caller. `fingerprintSetMatches`/`idSetMatches` (`runtime-dispatch-boundary.js`) implementam essa prova.

"Dispatch não pode ser apenas stage ID + worker ID."

## Runtime Dispatch Package / Decision / Result / Audit

`runtime-dispatch-package.js` é o envelope final imutável: IDs upstream de toda a cadeia, as 8 listas de referências derivadas por ID (ordenadas, sem duplicata), as 2 listas de ordem genuína (`ordered_*`, nunca reordenadas), as 5 listas de partição, 11 contagens agregadas, 4 estimativas (tokens/custo — somadas apenas sobre intenções genuinamente `DISPATCH_INTENT_PREPARED_SIMULATION`), 14 fingerprints upstream únicos, 16 listas de fingerprints derivados, e `dispatch_package_fingerprint`/`_digest` recalculados (mesmo padrão de dois campos excluídos progressivamente já estabelecido em toda a linhagem).

"Nenhum dispatch foi autorizado, aplicado ou enviado — mesmo quando o pacote alcança DISPATCH_PACKAGE_PREPARED_SIMULATION."

`runtime-dispatch-decision.js` define seu próprio vocabulário de 31 status (25 próprios + os 6 de identidade já reutilizados de toda a linhagem), com sua própria `DISPATCH_PRECEDENCE_ORDER` e `STATUS_OUTCOME_MAP` — separado, nunca fundido ao vocabulário de nenhuma camada anterior. 25 flags `*_validated` mapeiam 1:1 nas seções de cross-check do boundary; apenas uma se torna verdadeira em conjunto com o outcome (`dispatch_package_prepared_in_simulation`), enquanto toda flag operacional (`dispatch_authorized`, `dispatch_applied`, `dispatch_sent`, `worker_reserved`, `job_created`, `queue_created`, `stage_dispatched`, etc. — 14 flags na Decision) permanece sempre `false`. `runtime-dispatch-result.js` é um envelope mais amplo (27 flags operacionais seguras — soma as 14 da Decision a `worker_connection_opened`, `worker_process_created`, `worker_thread_created`, `container_started`, `scheduler_started`, `stage_completed`, `stage_failed`, `runtime_enabled`, `execution_authorized`, `execution_started`, `network_used`, `secret_resolved`, `queue_used`), o mesmo padrão de dois níveis já estabelecido entre Decision/Result em toda a linhagem.

`runtime-dispatch-audit.js` registra apenas IDs/fingerprints/digest, status/decision/next_state, bindings de identidade, `stage_intent_counts`, `estimate_summary`, `worker_reference_ids`, outcomes de dependency/approval gate, blockers, reason codes, logical sequence — **nunca payload completo, prompt, mensagem, memória, segredo, credencial, argumentos de tool ou código.**

## Runtime Dispatch Boundary

`runtime-dispatch-boundary.js`'s `evaluateRuntimeDispatchRequest(request, context)` segue a ordem de precedência estabelecida (identidade antes de policy, cadeias upstream antes de derivação local):

1-2. Request/toda referência aninhada contra seu validador oficial.
3. Dispatch Policy marcada (limites aplicados no passo 33).
9. Identidade (`checkIdentity`, mesma função de toda a linhagem), avaliada cedo para casar a precedência real.
4-7. Cadeia de Worker Assignment genuinamente `WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION` (status/flags/IDs encadeados) mais a prova de não-substituição por fingerprint/ID-set.
8-11. Cadeia de Scheduler genuinamente `SCHEDULER_PACKAGE_PREPARED_SIMULATION`, incluindo o cross-check de que o Scheduler Package referenciado é o mesmo que o Worker Assignment Package já registrou.
12. Runtime Execution Package ainda o mesmo, nunca mutado.
14. Freshness recalculada na sequência do próprio Dispatch Request.
15. Dispatch Replay — prova de vínculo genuíno aos fingerprints/digests de Worker Assignment/Scheduler/Runtime Execution Package que esta avaliação está usando, e ao mesmo idempotency reference.
16. Idempotency reutilizado verbatim da Worker Assignment Request, self-fingerprint recomputado.
17. Registry Snapshot — mesmo snapshot que o Worker Assignment Package já vinculou (ou ausência consistente em ambas as camadas).
18-19. Reafirmação de que nenhuma policy oficial de Network/Secret é `PRODUCTION`; Stage Policy Requirements já provados não-substituídos.
20-31. Derivação por estágio: Dispatch Stage Reference → Dependency/Approval Gate (sempre, para todo estágio) → quando elegível/opcional: Worker Binding (revalidado na sequência do Dispatch Request) → Capacity → Budget → Payload → Dispatch Intent (status derivado por prioridade: waiting-dependency > waiting-approval > sem-worker > bloqueado/não-avaliado > opcional > capacidade-bloqueada > budget-bloqueado > qualquer gate falso > preparado).
32. Dispatch Order — subsequência estável da ordem do Scheduler Package.
33. Limites de policy (hoje, apenas `maximum_dispatch_intent_count`; ver "Limitações").
36. Invariantes de não-execução.

Emissão final de Package/Decision/Result/Audit. Qualquer inconsistência bloqueia fail-closed.

## Registry

`runtime-dispatch-registry.js` cria 15 registros privados e sintéticos (request, stage, worker-binding, dependency-gate, approval-gate, capacity, budget, payload, intent, order, replay, package, decision, result, audit) — reutilizando o mesmo padrão `createEntityStore`/`resolveRegistration` já estabelecido em toda a linhagem (replay → payload mismatch → conflito de versão esperada → conflito de fingerprint esperado → downgrade de versão → aceito). Sem persistência.

## Fixture

`test/fixtures/hermes-runtime-dispatch-simulation-contracts.json` contém um conjunto inicial curado de 7 cenários — o caminho feliz determinístico, mismatch na cadeia de Worker Assignment, mismatch na cadeia de Scheduler, freshness expirada, Dispatch Replay não vinculado, limite de policy de contagem de intenções excedido, e um contexto hostil provando inércia de side-channel — gerados programaticamente a partir do próprio `evaluateRuntimeDispatchRequest` real (nunca objetos JSON forjados à mão), via `test/helpers/runtime-dispatch-simulation-test-data.js`. A cauda longa de cenários — incluindo stages waiting-dependency/waiting-approval/opcionais, todas as combinações de gate bloqueado, adulteração campo-a-campo de cada um dos 17 contratos, integridade do Dispatch Package, e side-channels adicionais — é coberta inline em `test/runtime-dispatch-simulation-contracts.test.js` (37 testes). Um conjunto de fixtures mais amplo (aproximando o inventário de cenários da especificação original) é um trabalho de continuação natural, não incluído nesta PR inicial — mesmo ritmo "PR inicial + rodadas de fix" já estabelecido em PR #106.

## Confirmação de nenhuma execução real

Em todo status producível: `dispatch_authorized`, `dispatch_applied`, `dispatch_sent`, `dispatch_acknowledged`, `dispatch_lease_created`, `worker_reserved`, `worker_started`, `worker_connection_opened`, `worker_process_created`, `worker_thread_created`, `container_started`, `scheduler_started`, `job_created`, `queue_created`, `queue_item_created`, `queue_used`, `stage_dispatched`, `stage_started`, `stage_completed`, `stage_failed`, `dependency_satisfied`, `dependency_applied`, `approval_granted`, `approval_consumed`, `tokens_reserved`, `tokens_consumed`, `cost_reserved`, `cost_consumed`, `capacity_applied`, `concurrency_applied`, `runtime_enabled`, `execution_authorized`, `execution_started`, `agent_executed`, `model_called`, `provider_called`, `tool_called`, `workflow_executed`, `network_used`, `secret_resolved`, `memory_read`, `memory_written`, `stop_condition_evaluated`, `stop_applied`, `compensation_executed`, `artifact_created`, `event_emitted`, `executed` permanecem sempre `false`; `simulation=true`; `production_blocked=true`; `rollout_percentage=0`. Nenhum worker é reservado, iniciado ou conectado; nenhum processo, thread ou container é criado; nenhuma fila, item de fila ou job é criado; nenhum estágio é despachado; nenhuma rede é usada; nenhum segredo é resolvido; nenhuma execução real ocorre em nenhum caminho desta implementação.

## Limitações

- `DISPATCH_VERSION_BLOCKED`/`DISPATCH_CONFLICT_BLOCKED`/`DISPATCH_UNKNOWN_STATUS_BLOCKED` existem no vocabulário de status para completude e paridade com toda a linhagem, mas o boundary evaluator não os produz diretamente nesta PR — reservados para conflitos que só se manifestam através do Registry.
- **Limites de policy incompletos**: apenas `maximum_dispatch_intent_count` é hoje aplicado pelo boundary (passo 33). `maximum_model_dispatch_intent_count`/`maximum_tool_dispatch_intent_count`/`maximum_workflow_dispatch_intent_count`/`maximum_parallel_dispatch_intent_count`/`maximum_estimated_tokens`/`maximum_estimated_cost_minor_units` estão declarados no `RuntimeDispatchPolicy` e agregados no `RuntimeDispatchPackage` (`model_intent_count`/`tool_intent_count`/`workflow_intent_count`/`parallel_intent_count`/`estimated_total_tokens`/`estimated_total_cost_minor_units`), mas ainda não são comparados contra o limite correspondente — trabalho de continuação natural para uma rodada de fix.
- **Preservação de ordem do Scheduler assumida, não recomputada**: `scheduler_order_preserved`/`required_predecessor_order_preserved`, no Dispatch Order Reference, são hoje afirmados `true` porque os IDs de estágio são emitidos na exata ordem que `schedulerResultRef.scheduler_stage_references` já carrega (já topologicamente ordenada pelo PR #105) — o boundary ainda não caminha o grafo de dependências para detectar uma violação de ordem genuína de forma independente. Documentado honestamente como simplificação, não uma checagem inventada.
- **Budget "remaining" aproximado pelo teto do plano inteiro**: nenhum contrato upstream expõe "quanto já foi consumido por outros estágios já preparados", então `remaining_input_tokens`/`remaining_output_tokens`/`remaining_total_tokens`/`remaining_cost_minor_units` usam os campos `maximum_*` do `RuntimeBudgetSimulationReference` do plano inteiro como teto — uma aproximação honesta, não uma contabilidade real de consumo incremental.
- **Capacidade de runtime em granularidade única**: `runtime_stage_capacity_available`/`runtime_token_capacity_available`/`runtime_cost_capacity_available` reutilizam o mesmo `capacity_available` agregado único do `RuntimeCapacitySnapshotReference`, porque esse contrato não expõe uma quebra por dimensão além de suas próprias `CAPACITY_NUMERIC_FIELDS` já estruturadas para outro propósito.
- Nenhum worker real, processo, thread, container, fila, job, cron, timer, retry, polling ou child_process é usado ou referenciado em qualquer módulo desta PR. Nenhuma rede é usada e nenhum segredo é resolvido em nenhum caminho desta avaliação.

"A próxima etapa, após auditoria e merge, é Runtime Queue Admission Simulation Contracts, ainda sem fila ou job real."

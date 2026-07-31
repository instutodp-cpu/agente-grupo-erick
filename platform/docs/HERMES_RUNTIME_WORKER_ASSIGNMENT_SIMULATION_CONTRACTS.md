# Hermes Agent Core - Runtime Worker Assignment Simulation Contracts

## Objetivo

Criar a camada declarativa de seleção de worker do Hermes, construída sobre um Scheduler Package já `SCHEDULER_PACKAGE_PREPARED_SIMULATION` (PR #105). Recebe um catálogo declarativo de `RuntimeWorkerReference`s (com suas referências de capability, capacity e health) e produz, para cada estágio elegível do plano, uma recomendação declarativa de qual worker o atenderia — nunca reserva, nunca inicia, nunca despacha, nunca conecta.

"WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION significa apenas que workers declarativos compatíveis foram avaliados e, quando possível, recomendados. Nenhum worker foi reservado, iniciado ou contatado."

## Scheduler Package ≠ Worker Assignment Package

`SCHEDULER_PACKAGE_PREPARED_SIMULATION` (PR #105) prova que um Runtime Execution Package já admitido tem uma ordem declarativa de estágios, elegibilidade, grupos paralelos e waits de aprovação genuinamente derivados. Isso nunca definiu qual worker atenderia qual estágio, se algum worker declarativo é sequer compatível, ou quantos candidatos existiriam. `WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION` é a camada seguinte: recebe um pacote de scheduler já preparado como pré-condição obrigatória e produz exclusivamente uma recomendação declarativa de worker por estágio — nunca lease, nunca reserva, nunca dispatch, nunca processo, nunca thread, nunca container, nunca fila, nunca job.

Distinção preservada explicitamente em todo o código e testes:

```
SCHEDULER_PACKAGE_PREPARED_SIMULATION ≠ SCHEDULER_STARTED
  ≠ WORKER_ASSIGNMENT_PACKAGE_PREPARED_SIMULATION ≠ WORKER_RESERVED ≠ WORKER_STARTED
  ≠ WORKER_CONNECTION_OPENED ≠ STAGE_DISPATCHED ≠ STAGE_STARTED ≠ EXECUTED
```

## Runtime Worker Assignment Policy

`runtime-worker-assignment-policy.js` (72 campos exatos). Nenhuma policy pode habilitar worker ou execução real: os 26 `require_*` e os 20 `fail_on_*`/`fail_closed` são estruturalmente forçados `true`; `allow_external_effect_reference=false` e `allow_irreversible_reference=false` são permanentes. Os 10 `allow_*` (local/remote/shared/dedicated worker reference, no-LLM/model/tool/workflow/parallel stage, state-change reference) são genuinamente configuráveis e revalidados pelo boundary contra a composição real do plano e o tipo real de cada worker. Os 8 `maximum_*` são limites reais (candidatos por estágio; estágios/paralelos/model/tool/workflow por worker; tokens/custo estimado por worker) comparados contra contagens honestamente agregadas durante a avaliação, nunca reservados nem consumidos.

## Runtime Worker Reference / Capability / Capacity / Health

`runtime-worker-reference.js` (38 campos exatos) declara `worker_type` (LOCAL/REMOTE/SHARED/DEDICATED_REFERENCE), `worker_classification` (DETERMINISTIC/MODEL/TOOL/WORKFLOW/MULTI_CAPABILITY_WORKER_REFERENCE), escopo nullable (tenant/organization/project — `null` significa não restrito; workers `DEDICATED_REFERENCE` exigem os três preenchidos), e ponteiros para sua própria capability/capacity/health reference.

"RuntimeWorkerReference é uma descrição declarativa. Ela não comprova que um processo, container ou host real existe."

`worker_registered` é sempre forçado `true` (é apenas um registro declarativo válido); `worker_reserved`/`worker_started`/`worker_connection_opened` são sempre forçados `false`.

`runtime-worker-capability-reference.js` (24 campos exatos) declara quais `capability_ids`/`modality_ids`/`stage_type_ids`/`model_provider_ids`/`model_ids`/`tool_ids`/`workflow_ids` um worker suportaria, mais 8 flags `supports_*` — `supports_external_effect_reference`/`supports_irreversible_reference` são permanentemente forçados `false`, os mesmos dois efeitos já globalmente bloqueados em toda a linhagem.

`runtime-worker-capacity-reference.js` (35 campos exatos) declara 7 dimensões de capacidade (stage/parallel/model/tool/workflow assignments, tokens, custo em minor units), cada uma como tripla `[maximum, current, available]` com consistência aritmética recalculada — nunca aceita `available` declarado livremente. `capacity_applied`/`capacity_reserved`/`slots_consumed` são sempre `false`.

`runtime-worker-health-reference.js` (20 campos exatos) declara `health_status` (5 valores: HEALTHY_REFERENCE_SIMULATION/DEGRADED/UNHEALTHY/UNKNOWN/EXPIRED_REFERENCE) mais 5 flags de binding (`configuration_valid`/`registration_valid`/`capability_reference_valid`/`capacity_reference_valid`/`policy_references_valid`) e freshness lógica recalculada a partir de `logical_sequence` (nunca `Date`/timer). `health_validated` exige status healthy, todos os bindings válidos, e não expirado simultaneamente.

## Worker Compatibility

`runtime-worker-compatibility-reference.js` (32 campos exatos) materializa, para um par (estágio, worker), 17 dimensões de match booleano independentes: `tenant_match`/`organization_match`/`project_match`/`agent_scope_match` (escopo `null` = irrestrito), `stage_type_match`, `capability_match`, `modality_match`, `model_support_match`, `tool_support_match` (subconjunto completo exigido, nunca interseção parcial), `workflow_support_match`, `network_policy_match`/`secret_policy_match` (ver "Network e Secret Policy Match" abaixo), `effect_policy_match` (verdadeiro salvo quando o estágio já teria sido bloqueado globalmente por efeito externo/irreversível), `health_match` (ver "Worker Health na Sequência do Assignment" abaixo), `capacity_match` (multi-dimensão: só verifica as dimensões que o estágio realmente exigiria), `concurrency_match`, `freshness_match`. "Worker compatibility é recalculada campo a campo; o boundary não confia em flags soltas." `worker_compatible` é a conjunção das 17 dimensões, sempre recomputada pelo próprio `validateRuntimeWorkerCompatibilityReference`, nunca confiada ao valor de entrada.

### Network e Secret Policy Match (pr106fix / pr106fix2 / pr106fix3)

"Network e secret policy matches são derivados de referências declarativas oficiais. A presença de um ID não constitui compatibilidade."

"RuntimeWorkerNetworkPolicyReference e RuntimeWorkerSecretPolicyReference são bindings minimizados. A fonte de verdade é a Network Permission Policy e a Secret Resolution Policy oficial, validadas pelos contratos originais."

"Uma policy oficial íntegra não implica compatibilidade com qualquer stage. O boundary compara provider, domínio, destination/purpose e ambiente contra o requisito derivado do stage."

"As Transcription Network/Secret References são aplicáveis somente ao domínio que seus contratos representam. Elas não são policies universais de runtime."

`runtime-worker-network-policy-reference.js`/`runtime-worker-secret-policy-reference.js` (17 campos exatos cada) descrevem, com binding 1:1 genuíno a um `RuntimeWorkerReference`, a policy de rede/secret que esse worker teria: ID/versão/fingerprint próprios, mais `tenant_id`/`organization_id`/`project_id` (nullable) e `runtime_environment_reference_id`. Esses são bindings *minimizados* — eles próprios nunca são a fonte de verdade. Cada um também carrega `official_network_policy_reference_id`/`_version`/`_fingerprint` (respectivamente `official_secret_policy_*`), apontando para a referência oficial real que o binding alega descrever.

**A fonte de verdade é sempre a policy oficial já existente, reutilizada verbatim.** Rede: `transcription-network-permission-boundary.js`'s própria `TranscriptionNetworkDestinationReference`, validada pelo seu próprio `validateDestinationReference` (PR #75). Secret: `transcription-secret-resolution-boundary.js`'s própria `TranscriptionSecretReference`, validada pelo seu próprio `validateSecretReference` (PR #76) — nenhum contrato paralelo foi criado. O `RuntimeWorkerAssignmentRequest` carrega essas referências oficiais em `network_permission_policy_references`/`secret_resolution_policy_references` (até 200 itens cada), além das próprias `runtime_worker_network_policy_references`/`runtime_worker_secret_policy_references` (bindings, até 200 itens cada, opcionais por worker — nem todo worker precisa de uma).

`runtime-worker-assignment-boundary.js`'s `evaluatePolicyReferenceMatch` separa explicitamente três gates — `official_policy_valid`, `official_policy_applicable_to_stage`, `official_policy_authorizes_stage_requirement` — e só produz match quando os três, em ordem, forem verdadeiros:

1. **`official_policy_valid`**: o binding aponta para o próprio worker (`network_policy_reference_id === worker.network_policy_reference_id`) e carrega tenant/organização/projeto/ambiente corretos; a policy oficial referenciada existe (`worker_network_official_policy_missing` se não); `official_network_policy_version === officialPolicy.destination_ref_version` (`worker_network_official_policy_version_mismatch` se não); o fingerprint recomputado da policy oficial — usando o canonicalizador do próprio módulo oficial (`transcription-provider-contract-registry.js`'s `stablePayload`, nunca uma reimplementação paralela) — bate com `official_network_policy_fingerprint` (`worker_network_official_policy_fingerprint_mismatch` se não; isso captura tanto adulteração do conteúdo oficial quanto um binding com fingerprint desatualizado); tenant para secret (`TranscriptionSecretReference` carrega `tenant_id` nativamente); `officialPolicy.environment !== 'PRODUCTION'` (`worker_*_official_policy_not_allowed`).
2. **`official_policy_applicable_to_stage`**: `deriveStagePolicyRequirement(stage, upstreamHint)` classifica estruturalmente qual elemento do stage gerou o requisito (`MODEL`/`TOOL`/`WORKFLOW`) — apenas `MODEL` pode ser autorizado pelas policies oficiais reutilizadas nesta PR; `TOOL`/`WORKFLOW` são sempre `worker_*_official_policy_domain_mismatch`, porque nenhuma policy oficial de domínio tool/workflow existe neste codebase. Para `MODEL`, exige adicionalmente `provider_slug`/`stage_domain` genuinamente resolvidos (nunca inferidos — ver "Stage Policy Requirement" abaixo) e `stage_domain === 'TRANSCRIPTION_DOMAIN'` (`worker_*_official_policy_domain_mismatch` caso contrário, ex.: `GENERIC_DOMAIN`).
3. **`official_policy_authorizes_stage_requirement`**: `officialPolicy.provider_slug === requirement.provider_slug` (`worker_*_official_policy_provider_mismatch` se não); `officialPolicy.scope === requirement.destination_class` (rede: `worker_network_official_policy_destination_mismatch`; secret: `worker_secret_official_policy_purpose_mismatch`).

`network_policy_reference_valid`/`secret_policy_reference_valid` continuam existindo como flags derivadas de conveniência — nunca a fonte de verdade, e nenhuma delas mascara os gates 2/3.

### Stage Policy Requirement (pr106fix3)

`runtime-worker-stage-policy-requirement-reference.js` (9 campos exatos) fornece a única peça genuinamente externa do requisito de um stage que a cadeia upstream deste codebase não resolve hoje: `stage_domain` (`TRANSCRIPTION_DOMAIN`/`GENERIC_DOMAIN`) e `provider_slug`. Confirmado por inspeção: `model_selection_reference_id`/`tool_reference_ids`/`workflow_reference_id` permanecem ponteiros de ID opacos do `RuntimeSchedulerStageReference` até o `RuntimeExecutionPackage` — nenhum Model Selection/Tool Contract/Workflow Contract resolvido, com `provider_slug` ou classificação de domínio, é alcançável a partir desta camada. O `RuntimeWorkerAssignmentRequest` carrega esses hints em `stage_policy_requirement_references` (até 200 itens, no máximo um por `scheduler_stage_reference_id` — duplicata é incoerência global, `WORKER_ASSIGNMENT_POLICY_BLOCKED`/`stage_policy_requirement_registry_duplicate`).

`deriveStagePolicyRequirement(stage, upstreamHint)` é pura e determinística: nunca lê `context`, nunca inventa dado ausente. `destination_class`/`secret_purpose` são derivados estruturalmente de qual elemento (model/tool/workflow) gerou o requisito — mapeados no mesmo enum `DESTINATION_SCOPES`/`SECRET_SCOPES` que as próprias policies oficiais já usam, nunca um enum inventado. **A ausência de um hint (ou de `provider_slug`/`stage_domain` genuinamente resolvidos nele) para um stage que exige model/tool/workflow não é `NOT_APPLICABLE` — é `worker_*_policy_requirement_unresolvable`, e bloqueia o worker.** Um stage puramente determinístico (sem model/tool/workflow) continua `NOT_APPLICABLE` independentemente de qualquer hint presente ou ausente.

Uma policy oficial com ID duplicado dentro de `network_permission_policy_references`/`secret_resolution_policy_references` é, da mesma forma, uma incoerência global (`WORKER_ASSIGNMENT_POLICY_BLOCKED`, `network_official_policy_registry_duplicate`/`secret_official_policy_registry_duplicate`), distinta de um mismatch por-worker (`WORKER_ASSIGNMENT_NO_CANDIDATE_BLOCKED` quando nenhum worker restar compatível). Nenhum segredo é resolvido; nenhuma rede é usada; `evaluatePolicyReferenceMatch`/`deriveStagePolicyRequirement` nunca contatam um provedor real.

### Worker Health na Sequência do Assignment (pr106fix)

"Worker health é reavaliada na sequência lógica do Worker Assignment Request. Uma referência saudável em uma sequência anterior pode expirar antes da atribuição."

`runtime-worker-assignment-boundary.js`'s `evaluateHealthAtAssignment` nunca confia isoladamente em `health.health_validated`/`health.health_expired_logically` (calculados pela própria `RuntimeWorkerHealthReference` contra sua sequência congelada) — recalcula, usando `runtime_worker_assignment_request.logical_sequence`: (1) uma referência cuja `current_logical_sequence`/`health_created_logical_sequence` estejam à frente do próprio request é uma inconsistência estrutural (`worker_health_sequence_regressive`), bloqueando o request inteiro como `WORKER_ASSIGNMENT_HEALTH_BLOCKED`; (2) caso contrário, `healthExpiredAtAssignment = (request.logical_sequence - health.health_created_logical_sequence) > health.maximum_valid_sequences` — se expirado, ou se `health_status` não for `HEALTHY_REFERENCE_SIMULATION`, ou se qualquer um dos 5 bindings (`configuration_valid`/`registration_valid`/`capability_reference_valid`/`capacity_reference_valid`/`policy_references_valid`) for inválido, `health_match=false` para esse worker especificamente (dimensão de compatibilidade, não bloqueio total do request — outro worker pode continuar saudável).

`runtime-worker-candidate-set-reference.js` (21 campos exatos) particiona, por estágio, os workers avaliados em `compatible_worker_reference_ids`/`incompatible_worker_reference_ids` (partição completa, sem sobreposição, sem lacuna) e produz `recommended_worker_reference_id` — `null` quando não há candidato compatível, ou obrigatoriamente um membro do conjunto compatível quando há.

`runtime-worker-stage-assignment-reference.js` (29 campos exatos) materializa a recomendação final por estágio em 6 status (`WORKER_RECOMMENDED_SIMULATION`, `WORKER_NOT_REQUIRED_REFERENCE`, `WORKER_WAITING_APPROVAL_REFERENCE`, `WORKER_WAITING_DEPENDENCY_REFERENCE`, `WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED`, `WORKER_ASSIGNMENT_BLOCKED`) — `recommended_worker_reference_id` só pode ser não-nulo quando `WORKER_RECOMMENDED_SIMULATION`.

"recommended_worker_reference_id não constitui lease, reserva ou autorização de dispatch."

`worker_assignment_applied`/`worker_reserved`/`worker_started`/`stage_dispatched`/`stage_started` são sempre `false`.

### Seleção determinística de 9 níveis

Quando múltiplos workers são compatíveis com um estágio, `runtime-worker-assignment-boundary.js`'s `selectionSortKey`/`compareSortKeys` escolhem deterministicamente, nesta ordem: (1) worker dedicado ao tenant/org/project antes de compartilhado; (2) `worker_classification` exatamente correspondente ao tipo do estágio (MODEL/TOOL/WORKFLOW/DETERMINISTIC) antes de `MULTI_CAPABILITY_WORKER_REFERENCE`; (3) maior `available_stage_assignments`; (4) maior `available_parallel_assignments`; (5) maior `available_token_capacity`; (6) maior `available_cost_capacity_minor_units`; (7) menor `current_stage_assignments`; (8) menor `current_parallel_assignments`; (9) menor `runtime_worker_reference_id` lexicograficamente. A ordem de entrada dos workers nunca altera o resultado.

"Stages waiting dependency ou approval continuam waiting, ainda que exista worker compatível." Um estágio herdado do Scheduler Package como `SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE`/`SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE`/`SCHEDULER_STAGE_BLOCKED` nunca recebe `WORKER_RECOMMENDED_SIMULATION`; produz `WORKER_WAITING_DEPENDENCY_REFERENCE`/`WORKER_WAITING_APPROVAL_REFERENCE`/`WORKER_ASSIGNMENT_BLOCKED` respectivamente, preservando o status herdado sem reavaliar a dependência ou aprovação em si, mesmo quando um worker compatível existiria.

## Runtime Worker Assignment Request

`runtime-worker-assignment-request.js` (30 campos exatos) agrega toda a cadeia do Scheduler já preparado (`runtime_scheduler_request_reference`/`_decision_reference`/`_result_reference`/`_package_reference`), o Runtime Execution Package e Stage Manifest, Capacity Snapshot/Concurrency/Freshness — **reutilizados verbatim**, nunca contratos paralelos — mais os 9 catálogos declarativos: `runtime_worker_references`/`_capability_references`/`_capacity_references`/`_health_references` (pr106), `runtime_worker_network_policy_references`/`_secret_policy_references` (bindings minimizados, pr106fix), `network_permission_policy_references`/`secret_resolution_policy_references` (as próprias policies oficiais reutilizadas verbatim, pr106fix2), e `stage_policy_requirement_references` (hints de domínio/provider por estágio, pr106fix3) — até 200 itens cada. `runtime_replay_reference`/`idempotency_reference` são a mesma `RuntimeReadinessReplayReference`/`ExecutionPlanIdempotencyReference` que fluiu desde a Admission — a continuidade é provada exigindo byte-identidade (mesmo fingerprint) com o par carregado pelo próprio `runtime_scheduler_request_reference`, nunca uma re-derivação independente. `context` nunca é lido para nenhuma decisão.

## Runtime Worker Assignment Package / Decision / Result / Audit

`runtime-worker-assignment-package.js` (61 campos exatos) é o envelope final imutável: IDs/fingerprints upstream, as 4 listas de referências derivadas por ID, contagens agregadas, as 9 listas de fingerprints derivados (incluindo `worker_network_policy_fingerprints`/`worker_secret_policy_fingerprints`, pr106fix), e `worker_assignment_package_fingerprint`/`_digest` recalculados (mesmo padrão de dois campos excluídos progressivamente já estabelecido em toda a linhagem).

`runtime-worker-assignment-decision.js` define seu próprio vocabulário de 25 status (19 próprios + os 6 de identidade já reutilizados de toda a linhagem), com sua própria `WORKER_ASSIGNMENT_PRECEDENCE_ORDER` e `STATUS_OUTCOME_MAP` — separado, nunca fundido a `validation-taxonomy.js` nem ao vocabulário de nenhuma camada anterior. 19 flags `*_validated` mapeiam 1:1 nas seções de cross-check do boundary. A Decision carrega 8 flags operacionais seguras (`worker_assignment_applied`, `worker_reserved`, `worker_started`, `stage_dispatched`, `stage_started`, `executed`, `simulation`, `production_blocked`), sempre forçadas ao valor seguro. `runtime-worker-assignment-result.js` é um envelope mais amplo (20 flags operacionais seguras — soma as 8 da Decision a `worker_connection_opened`, `worker_process_created`, `worker_thread_created`, `container_started`, `job_created`, `queue_created`, `queue_used`, `stage_completed`, `stage_failed`, `runtime_enabled`, `execution_authorized`, `execution_started`), o mesmo padrão de dois níveis já estabelecido entre `runtime-admission-decision.js`/`runtime-admission-result.js`.

`runtime-worker-assignment-audit.js` (30 campos exatos) registra apenas fingerprints, digest, bindings de identidade, contagens (stage/worker, candidatos, assignments), IDs de worker recomendado, códigos de mismatch de capability, status de health, resumo de capacidade, status/decision/next_state, blockers, reason codes, logical sequence — **nunca payload completo, prompts, memória, mensagens, argumentos de tool, respostas, secrets, tokens reais, endpoints, código ou output de provider.**

## Runtime Worker Assignment Boundary

`runtime-worker-assignment-boundary.js`'s `evaluateRuntimeWorkerAssignmentRequest(request, context)` segue a ordem real de precedência (identidade antes de policy):

1. Request/toda referência aninhada contra seu validador oficial.
2. Identidade (`checkIdentity`, mesma função de toda a linhagem).
3. Worker Assignment Policy — `allow_*` contra a composição real do plano e o tipo real de cada worker declarado.
4. Cadeia de Scheduler genuinamente `SCHEDULER_PACKAGE_PREPARED_SIMULATION` (status, flags, IDs encadeados).
5. Runtime Execution Package ainda o mesmo que o Scheduler preparou (fingerprint/digest).
6. Registro de workers — sem ID duplicado; workers `DEDICATED_REFERENCE` com escopo genuinamente declarado.
7. Bindings 1:1 de capability/capacity/health — cada referência aponta de volta para o `runtime_worker_reference_id` declarado.
8. Freshness recalculada na sequência do próprio Worker Assignment Request.
9. Replay/Idempotency — provados byte-idênticos ao par carregado pelo Scheduler Request original.
10. Derivação: compatibilidade (17 dimensões) × cada par (estágio elegível, worker) → conjunto de candidatos por estágio → seleção determinística de 9 níveis → assignment por estágio, respeitando estágios waiting/blocked herdados do Scheduler.
11. Limites de policy dependentes de dados derivados (candidatos por estágio, agregados por worker recomendado) verificados após a derivação interna, retornando `WORKER_ASSIGNMENT_POLICY_BLOCKED`.
12. Invariantes de não-execução.
13. Emissão de Decision/Result/Audit.

Qualquer inconsistência bloqueia fail-closed.

## Registry

`runtime-worker-assignment-registry.js` cria 12 registros privados e sintéticos (workers, capabilities, capacities, healths, compatibilities, candidate sets, stage assignments, requests, packages, decisions, results, audits) — reutilizando o mesmo padrão `createEntityStore`/`resolveRegistration` já estabelecido em toda a linhagem (replay → payload mismatch → conflito de versão esperada → conflito de fingerprint esperado → downgrade de versão → aceito). Sem persistência.

## Fixture

`test/fixtures/hermes-runtime-worker-assignment-simulation-contracts.json` contém 21 cenários curados: o caminho feliz (deterministic, um worker compatível), worker dedicado preferido sobre compartilhado, fallback para worker compartilhado quando o dedicado não é compatível, worker multi-capability, desempate determinístico entre dois workers equivalentes, e representantes de cada categoria principal de bloqueio (scheduler não preparado, runtime package divergente, registro de worker vazio, worker unhealthy, mismatch de binding capability/capacity, mismatch de tipo de estágio, capacidade exaurida, ID de worker duplicado, freshness expirada, replay não vinculado, idempotência divergente, mismatch de tenant, side-channel hostil, health expirada entre criação e assignment, health com sequência regressiva). A cauda longa de adulterações campo-a-campo — incluindo toda a matriz de mismatch de network/secret policy (ID/version/fingerprint/tenant/organization/project/environment, tanto do binding minimizado quanto da policy oficial), de health-na-sequência-do-assignment, e de provider/domínio/destination/purpose do requisito do stage — é coberta inline em `test/runtime-worker-assignment-simulation-contracts.test.js` (134 testes), construída via `test/helpers/runtime-worker-assignment-test-data.js` sobre o "golden bundle" já `SCHEDULER_PACKAGE_PREPARED_SIMULATION` que `runtime-scheduler-simulation-test-data.js` (PR #105) já fornece.

## Confirmação de nenhuma execução real

Em todo status producível: `worker_assignment_applied`, `worker_reserved`, `worker_started`, `worker_connection_opened`, `worker_process_created`, `worker_thread_created`, `container_started`, `job_created`, `queue_created`, `queue_used`, `stage_dispatched`, `stage_started`, `stage_completed`, `stage_failed`, `runtime_enabled`, `execution_authorized`, `execution_started`, `executed` permanecem sempre `false`; `simulation=true`; `production_blocked=true`; `rollout_percentage=0`. Nenhum worker é contatado, reservado, iniciado ou conectado; nenhum processo, thread ou container é criado; nenhuma fila ou job é criado; nenhum estágio é despachado; nenhuma execução real ocorre em nenhum caminho desta implementação.

## Limitações

- `WORKER_ASSIGNMENT_VERSION_BLOCKED`/`WORKER_ASSIGNMENT_CONFLICT_BLOCKED`/`WORKER_ASSIGNMENT_UNKNOWN_STATUS_BLOCKED` existem no vocabulário de status para completude e paridade com toda a linhagem, mas o boundary evaluator não os produz diretamente nesta PR — reservados para conflitos que só se manifestam através do Registry.
- `runtime-scheduler-result.js` (PR #105) ganhou o campo `scheduler_stage_references` nesta PR — modificação explicitamente autorizada pela especificação, necessária porque a camada de Worker Assignment precisa revalidar cada `RuntimeSchedulerStageReference` completa (capabilities, modalidades, estimativas), não apenas seus IDs. A mudança foi verificada sem quebrar nenhum dos 87 testes pré-existentes de `test/runtime-scheduler-simulation-contracts.test.js`.
- (pr106fix) `network_policy_match`/`secret_policy_match` deixaram de ser pass-through declarativo — agora comparam genuinamente `RuntimeWorkerNetworkPolicyReference`/`RuntimeWorkerSecretPolicyReference` (ID/versão/fingerprint/tenant/organização/projeto/ambiente) contra o requisito real de cada estágio, derivado das próprias referências oficiais upstream (model/tool/workflow).
- (pr106fix) Worker health deixou de confiar isoladamente em `health_validated`/`health_expired_logically` — é reavaliada na sequência lógica do próprio Worker Assignment Request. Ver "Worker Health na Sequência do Assignment" acima.
- (pr106fix2) `RuntimeWorkerNetworkPolicyReference`/`RuntimeWorkerSecretPolicyReference` deixaram de ser contratos autodeclarados — agora vinculam-se obrigatoriamente às policies oficiais já existentes (`TranscriptionNetworkDestinationReference`/`TranscriptionSecretReference`, PR #75/#76), reutilizadas verbatim via seus próprios validadores. Ver "Network e Secret Policy Match" acima.
- (pr106fix3) O binding a uma policy oficial estruturalmente válida deixou de implicar compatibilidade — `evaluatePolicyReferenceMatch` agora também compara `provider_slug`, domínio (`TRANSCRIPTION_DOMAIN` é o único que as policies oficiais reutilizadas podem autorizar) e destination class/purpose contra o requisito real do stage, derivado por `deriveStagePolicyRequirement`. Ver "Network e Secret Policy Match" e "Stage Policy Requirement" acima.
- (pr106fix3) Como as policies oficiais reutilizadas são do domínio de transcrição, apenas um requisito de elemento `MODEL` pode ser autorizado por elas nesta PR — todo requisito `TOOL`/`WORKFLOW` é estruturalmente um domain mismatch, já que nenhuma policy oficial de domínio tool/workflow existe neste codebase. Documentado honestamente como limitação de domínio (não uma checagem inventada); uma PR futura que reutilize outras policies oficiais (ou receba `RuntimeWorkerStagePolicyRequirementReference`s de outros domínios) poderia estender essa autorização.
- (pr106fix3) `provider_slug`/`stage_domain` nunca são inferidos ou derivados automaticamente de `model_selection_reference_id`/`tool_reference_ids`/`workflow_reference_id` — são fornecidos explicitamente via `stage_policy_requirement_references`. Um stage que exige model/tool/workflow sem um hint correspondente (ou com um hint incompleto) é `unresolvable`, nunca `NOT_APPLICABLE` e nunca um match silencioso.
- Nenhum worker real, processo, thread, container, fila, job, cron, timer, retry, polling ou child_process é usado ou referenciado em qualquer módulo desta PR. Nenhuma rede é usada e nenhum segredo é resolvido ao avaliar network/secret policy match.

"A próxima etapa, após auditoria e merge, é Runtime Dispatch Simulation Contracts, ainda sem fila, job, worker ou dispatch real."

# Hermes Core Transcription Provider Contract Boundary

## Objetivo

Esta PR cria a fronteira contratual documental para o provider primario recomendado para revisao contratual, `deepgram`, e prepara compatibilidade futura para o fallback documental `google_cloud_speech`.

## Escopo

- provider contract;
- capabilities contract;
- secret reference boundary;
- configuration boundary;
- synthetic request and response contracts;
- normalized synthetic response;
- safe error taxonomy;
- mock-parity adapter;
- contract readiness;
- private in-memory registry;
- synthetic fixtures and tests.

## Nao Objetivos

Esta PR nao integra Deepgram, Google Cloud Speech ou qualquer provider real. Ela nao chama rede, nao adiciona SDK, nao cria endpoint, nao aceita audio real, nao faz upload, nao cria storage, nao cria banco, nao altera `/message`, nao altera `/confirm` e nao registra adapter no runtime principal.

## Providers

- Primary contract candidate: `deepgram`
- Fallback contract candidate: `google_cloud_speech`

Esses providers sao apenas candidatos documentais. Nenhum deles esta habilitado para execucao.

## Contrato

O contrato exige versoes explicitas, role consistente, operacoes sinteticas, limites de duracao/tamanho/timeout, consentimento, budget, retention, deletion, network allowlist, secret reference e transporte. Mesmo assim, todos os controles de execucao permanecem desligados.

Operacoes permitidas:

- `simulate_provider_request`
- `validate_provider_request`
- `normalize_provider_response`
- `classify_provider_error`

Operacoes proibidas:

- `transcribe_real_audio`
- `call_provider`
- `execute_provider`
- `production_transcription`

## Capabilities

Capabilities obrigatorias ausentes, `unknown`, `incomplete` ou com runtime habilitado bloqueiam readiness. Nenhuma capability habilita provider real.

## Secret Reference Boundary

A camada aceita apenas referencia metadata-only. Campos como secret value, API key, token, private key, credentials, authorization, headers, cookie e password sao bloqueados recursivamente. Nenhuma secret e resolvida nesta PR.

## Configuration Boundary

Configuration nao pode conter endpoint, URL, hostname, transporte habilitado, secret resolvida, network allowlist operacional, production ou rollout maior que 0. `model_reference` e apenas identificador documental.

## Request e Response

Requests aceitam somente payload sintetico por referencia interna. Audio, bytes, buffer, blob, base64, file path, stream, upload, URL, endpoint, provider payload, token, secret e raw transcript sao bloqueados antes de qualquer sanitizacao.

Responses normalizadas sao sinteticas e nao carregam raw provider response, headers, request ID real, billing payload, transcript bruto, audio ou dado pessoal.

## Error Taxonomy

A taxonomia classifica erros sinteticos com mensagens seguras, sem stack, payload, secret ou endpoint. `retryable` e false por padrao e nenhuma classificacao inicia retry real.

## Mock-Parity Adapter

O adapter `mock_parity` simula a interface futura do provider primario sem rede e sem SDK. Ele cobre sucesso, timeout, rate limit, rejeicao, capability unavailable e budget blocked. O adapter nao e importado pelo runtime principal.

## Readiness

Decisoes permitidas:

- `NOT_READY`
- `INCOMPLETE`
- `READY_FOR_MOCK_PARITY_REVIEW`
- `READY_FOR_SECRET_REFERENCE_REVIEW`
- `READY_FOR_TRANSPORT_CONTRACT_REVIEW`

Decisoes nunca permitidas:

- `READY_FOR_NETWORK`
- `READY_FOR_REAL_PROVIDER`
- `READY_FOR_EXECUTION`
- `READY_FOR_PRODUCTION`

A decisao maxima desta PR e `READY_FOR_TRANSPORT_CONTRACT_REVIEW`, que permite apenas desenhar uma futura PR de transporte sem ativa-lo.

## Registry

O registry e privado, em memoria, com defensive clone, Object.freeze, replay protection, payload mismatch detection e bloqueio de downgrade de versao. Nao existe persistencia nem estado de execucao real.

## Seguranca

Todos os caminhos preservam:

- `simulated: true`
- `executed: false`
- `real_provider_called: false`
- `external_network_called: false`
- `can_trigger_real_execution: false`
- `rollout_percentage: 0`
- `production_blocked: true`
- `provider_runtime_enabled: false`
- `provider_selected_for_execution: false`
- `secret_resolved: false`
- `transport_enabled: false`

## Criterios para PR #71

Uma futura PR pode desenhar o contrato de transporte, mas ainda nao deve habilitar rede, provider real, secret real, audio real, runtime integration ou producao sem nova revisao explicita.

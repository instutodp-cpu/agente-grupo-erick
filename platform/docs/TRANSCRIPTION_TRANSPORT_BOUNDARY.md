# Transcription Transport Boundary

## Objetivo

Esta camada define o contrato arquitetural para um transporte futuro entre o Hermes Core e providers de transcricao. Ela existe para permitir revisao de desenho antes de qualquer integracao operacional.

## Escopo

- Contrato de transporte futuro.
- Politica fail-closed.
- Validator deterministico.
- Registry privado em memoria.
- Lifecycle documental.
- Readiness de revisao.
- Mock deterministico sem conexao.
- Testes e fixtures sinteticas.

## Nao objetivos

Esta PR nao integra Deepgram, Google Speech ou qualquer provider. Ela nao cria SDK, endpoint, hostname, OAuth, secret, upload, download, worker, queue, scheduler, storage, banco ou registro no runtime principal.

## Ausencia de rede

O contrato aceita apenas tipos futuros (`http_future`, `grpc_future`, `websocket_future`) como metadados. Nenhum modulo abre socket, resolve DNS, cria client, cria sessao, cria canal ou executa retry real.

## Politica fail-closed

Todas as tentativas conceituais de transporte sao bloqueadas por contrato:

- abrir socket;
- abrir conexao;
- resolver DNS;
- criar client;
- criar sessao;
- criar canal.

## Rollout e producao

Todos os resultados preservam `rollout_percentage: 0`, `production_blocked: true`, `simulated: true`, `executed: false`, `external_network_called: false` e `secret_resolved: false`.

## Readiness

As decisoes permitidas sao somente:

- `NOT_READY`;
- `READY_FOR_TRANSPORT_REVIEW`;
- `READY_FOR_PROVIDER_ADAPTER_REVIEW`.

Nunca ha readiness para rede, provider real ou producao.

## Integracao futura

Uma PR futura podera desenhar um adapter de provider sobre este contrato, mas ainda devera passar por revisao separada de secret, network allowlist, transporte, consentimento, budget, retencao e canary controlado.

# Hermes Core Mock Transcription Orchestrator

## Objetivo

Esta PR cria o primeiro fluxo completo e deterministico de transcricao do Hermes Core usando somente contratos e mocks locais. O orquestrador conecta request, consentimento, contrato de provider, contrato de adapter, contrato de transporte, lifecycle seguro, mock provider adapter, resultado sanitizado, auditoria e resposta.

## Escopo

O fluxo e puramente arquitetural. Ele valida fronteiras ja existentes e produz uma resposta simulada imutavel. Nenhum modulo desta PR registra endpoint, altera `/message`, altera `/confirm`, integra runtime principal ou habilita provider real.

## Pipeline

As etapas oficiais sao:

1. `validateRequest`
2. `validateConsent`
3. `validateProvider`
4. `validateAdapter`
5. `validateTransport`
6. `validateLifecycle`
7. `executeMock`
8. `sanitizeResult`
9. `buildAudit`
10. `buildResponse`

Cada etapa recebe um contexto e retorna um novo contexto. O pipeline nao muta o input do chamador e para de executar validacoes operacionais quando existe blocker.

## Invariantes

Todos os caminhos preservam:

- `simulation: true`
- `executed: false`
- `provider_called: false`
- `network_used: false`
- `rollout_percentage: 0`
- `production_blocked: true`

## Nao objetivos

Esta PR nao integra Deepgram, Google, Azure, OpenAI ou AssemblyAI. Tambem nao adiciona SDK, HTTP, WebSocket, upload, audio real, storage, worker, queue, scheduler, banco, secret, token, OAuth, endpoint operacional ou leitura de `process.env` para provider.

## Auditoria

O audit record e sanitizado e contem somente ids, versoes, steps, decisao, blockers e flags de simulacao. Nao ha persistencia.

## Limitacoes

O transcript retornado e um placeholder sintetico. A proxima etapa pode evoluir criterios de orquestracao, mas qualquer provider real ainda precisa de PR separada, revisao de transporte, segredo real autorizado e liberacoes explicitas.

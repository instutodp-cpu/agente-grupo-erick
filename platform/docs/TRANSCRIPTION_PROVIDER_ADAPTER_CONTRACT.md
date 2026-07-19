# Transcription Provider Adapter Contract

## Objetivo

Esta camada define a interface oficial que qualquer adapter futuro de transcricao devera implementar antes de ser considerado para revisao de provider.

## Arquitetura

A fronteira e composta por:

- contrato de metadata do adapter;
- contrato de entrada e saida para cada metodo;
- validator deterministico e fail-closed;
- readiness propria para revisao de provider;
- registry privado em memoria;
- mock oficial sem execucao real.

## Invariantes

Todos os caminhos preservam:

- `simulated: true`;
- `executed: false`;
- `runtime_enabled: false`;
- `provider_enabled: false`;
- `network_enabled: false`;
- `production_blocked: true`;
- `rollout_percentage: 0`.

## Interface Obrigatoria

Todo adapter futuro deve expor:

- `metadata()`;
- `validate()`;
- `health()`;
- `transcribe()`;
- `cancel()`;
- `capabilities()`;
- `supportedFormats()`;
- `supportedLanguages()`;
- `estimateCost()`;
- `estimateLatency()`.

## Fail-Closed

O contrato rejeita campos extras, campos ausentes, valores nao serializaveis, referencias ciclicas, versoes invalidas, provider desconhecido, rollout diferente de zero e qualquer sinal de runtime, provider ou rede habilitados.

## Registry

O registry documental usa armazenamento privado em memoria, fingerprint canonico, replay protection, payload mismatch detection, optimistic concurrency, clone defensivo e congelamento profundo.

## Readiness

As decisoes permitidas sao:

- `NOT_READY`;
- `READY_FOR_PROVIDER_REVIEW`.

Nao existe readiness para producao, rede, runtime ou execucao de provider.

## Mock

O mock oficial implementa a interface completa, mas retorna apenas respostas simuladas. `transcribe()` e `cancel()` permanecem bloqueados para trabalho real.

## Limitacoes

Esta PR nao integra Deepgram, Google, Azure, OpenAI, AssemblyAI ou qualquer provider. Nao ha transporte real, endpoint, credencial, segredo, upload, audio, armazenamento, scheduler, fila ou runtime registration.

## Proximos Passos

Uma PR futura podera usar este contrato para revisar um adapter especifico, ainda sem habilitar rede ou producao, e somente apos passar pelas fronteiras de provider, transporte, consentimento, budget e canary.

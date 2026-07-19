# Hermes Core Provider Capability Matrix

## Objetivo

Esta PR cria a matriz oficial e deterministica de capacidades declaradas para providers futuros de transcricao do Hermes Core.

## Capability Profile

Cada provider futuro deve possuir um `Capability Profile` validado antes de participar de selecao documental. O profile registra suporte declarado para batch, streaming, resultados parciais, timestamps, diarizacao, deteccao de idioma, traducao, pontuacao, vocabulario customizado, confidence score, idiomas, formatos, sample rates, canais, limites, custo estimado e latencia estimada.

## Invariantes

Todos os profiles permanecem em modo `REVIEW_ONLY` com:

- `simulation=true`
- `network_enabled=false`
- `provider_enabled=false`
- `runtime_enabled=false`
- `production_blocked=true`
- `rollout_percentage=0`

## Catalogo

O catalogo lista providers, idiomas e formatos apenas a partir de profiles validados. Ele nao le configuracao externa, nao consulta rede e nao registra provider em runtime.

## Comparacao

O comparator compara providers por idiomas, formatos, streaming, timestamps, diarizacao, latencia, custo e limites. A comparacao e imutavel, deterministica e sem efeitos colaterais.

## Registry

O registry e privado em memoria e aplica fingerprint canonico, optimistic concurrency, replay protection, payload mismatch, versionamento, clone defensivo e deep freeze.

## Limitacoes

A fixture desta PR usa somente providers sinteticos (`mock-provider-a`, `mock-provider-b`, `mock-provider-c`). Ela nao declara Deepgram, Google, Azure, OpenAI ou qualquer outro provider real como integrado.

## Proximos passos

Uma PR futura podera mapear capabilities documentais de providers reais, ainda sem execucao, depois de revisao humana e mantendo rollout zero ate autorizacao explicita.

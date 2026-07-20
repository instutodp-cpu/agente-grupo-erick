# Hermes Core Provider Selection Engine

## Objetivo

O Provider Selection Engine escolhe, de forma deterministica e auditavel, qual provider sintetico seria mais adequado para uma solicitacao de transcricao.

## Fluxo

1. Validar `Selection Request` com exact fields.
2. Carregar capability profiles sinteticos ja validados.
3. Rejeitar candidatos incompatíveis ou inseguros.
4. Pontuar candidatos elegiveis.
5. Aplicar desempate deterministico.
6. Gerar resultado imutavel e audit record.

## Filtros

Um provider e rejeitado quando idioma, formato, sample rate, canais, duracao, tamanho ou capability obrigatoria nao atendem a request. Tambem e rejeitado por allowlist, denylist, profile invalido, flags inseguras, rollout diferente de zero ou producao desbloqueada.

## Scoring

Os componentes sao:

- compatibility_score
- feature_score
- language_score
- format_score
- limit_score
- latency_score
- cost_score
- quality_score
- policy_score
- total_score

Todos ficam entre 0 e 100.

## Pesos

- `BALANCED`: compatibilidade 20, features 15, idioma 10, formato 10, limites 10, latencia 10, custo 10, qualidade 10, politica 5.
- `LOW_COST`: custo 25, compatibilidade 20, idioma 10, formato 10, limites 10, features 10, latencia 5, qualidade 5, politica 5.
- `LOW_LATENCY`: latencia 25, compatibilidade 20, idioma 10, formato 10, limites 10, features 10, custo 10, qualidade 0, politica 5.
- `HIGH_QUALITY`: qualidade 30, compatibilidade 20, features 15, idioma 10, formato 5, limites 5, latencia 5, custo 5, politica 5.
- `MAX_COMPATIBILITY`: compatibilidade 30, features 25, limites 15, idioma 10, formato 10, qualidade 5, politica 5.

## Desempate

A ordem de desempate e:

1. maior total_score;
2. maior compatibility_score;
3. maior feature_score;
4. menor custo estimado;
5. menor latencia estimada;
6. maior capability_profile_version;
7. provider_slug em ordem alfabetica.

## Resultado e Auditoria

O resultado nunca retorna selecao real. O audit registra fingerprint da request, fingerprints dos candidatos, filtros, rejeicoes, pontuacao, pesos, desempates e decisao.

## Integracao com Orchestrator

O Mock Transcription Orchestrator aceita `provider_slug=AUTO` e chama exclusivamente o Provider Selection Engine com dependencias sinteticas em memoria. O provider selecionado e registrado no execution context e na auditoria, sem executar provider real.

## Fail-Closed

Qualquer erro retorna status seguro, sem fallback silencioso e com `simulation=true`, `network_used=false`, `provider_called=false`, `executed=false`, `production_blocked=true` e `rollout_percentage=0`.

## Limitacoes

Esta PR nao integra provider real, nao usa SDK, nao abre rede, nao usa endpoint externo, nao usa credenciais e nao executa transcricao real.

# Hermes Core Transcription Provider Selection Matrix

## Objetivo

Esta PR cria uma camada estática, sintética e fail-closed para comparar candidatos futuros de transcrição antes de qualquer contrato de provider real.

## Escopo

- contrato de candidato de provider;
- critérios oficiais e pesos;
- scoring determinístico;
- matriz de compatibilidade;
- registro de riscos;
- seleção documental de primário e fallback para revisão contratual;
- relatório de decisão;
- registry documental em memória para replay/versionamento;
- fixture sintética versionada;
- testes contratuais.

## Não objetivos

Esta camada não integra provider real, não chama API, não pesquisa internet, não consulta preço atual, não cria endpoint, não recebe áudio, não faz upload, não cria storage, não cria secret e não registra nada no runtime principal.

## Providers Candidatos

O dataset inicial contém candidatos documentais para:

- openai
- deepgram
- assemblyai
- google_cloud_speech
- microsoft_azure_speech
- aws_transcribe

Esses nomes não significam aprovação, integração, habilitação ou recomendação de produção.

## Metodologia

A matriz usa um snapshot sintético versionado. Campos sem evidência documental completa devem permanecer `unknown` ou `null` e gerar bloqueio ou status incompleto. Nenhum dado é buscado em runtime.

## Critérios e Pesos

Os pesos somam 100:

- qualidade e pt-BR: 20
- privacidade/LGPD: 20
- segurança: 15
- retenção/deleção: 10
- custo: 10
- confiabilidade: 10
- compatibilidade técnica: 5
- operação/observabilidade: 5
- governança: 3
- fallback/portabilidade: 2

Requisitos obrigatórios não podem ser compensados por pontuação. Custo baixo não compensa falha de privacidade. Qualidade alta não compensa retenção incompatível.

## Matriz e Scoring

O scoring é puro, determinístico e limitado a 0..100. A matriz classifica candidatos como:

- INELIGIBLE
- INCOMPLETE
- COMPATIBLE_FOR_DOCUMENT_REVIEW
- RECOMMENDED_FOR_CONTRACT_REVIEW
- FALLBACK_CANDIDATE
- REJECTED

Nunca há `READY_FOR_EXECUTION`, `READY_FOR_PROVIDER_CALL`, `READY_FOR_PRODUCTION`, `ENABLED` ou `ACTIVE`.

## Riscos

O risk register cobre privacidade, LGPD, retenção, vendor lock-in, volatilidade de custo, disponibilidade, qualidade de idioma, mudança de modelo, residência de dados, subprocessadores, deleção, rate limits, suporte, contrato e migração. Risco crítico sempre bloqueia recomendação; risco alto sem mitigação também bloqueia.

## Seleção Documental

A selection policy só produz recomendação para revisão contratual humana. A decisão pode indicar um primário e um fallback documentais, mas nunca seleciona provider para execução.

## Limitações

O dataset não é preço atual, auditoria jurídica, auditoria de segurança, SLA validado nem configuração operacional. Antes da PR #70, as evidências devem ser confirmadas por revisão humana.

## Segurança

Todos os resultados preservam:

- `simulated: true`
- `executed: false`
- `real_provider_called: false`
- `external_network_called: false`
- `can_trigger_real_execution: false`
- `rollout_percentage: 0`
- `production_blocked: true`
- `provider_runtime_enabled: false`
- `provider_selected_for_execution: false`

## Critérios para PR #70

A próxima PR só pode criar um contrato de provider escolhido após revisão legal, segurança, custo e evidência documental atualizada. Ainda assim, qualquer integração real exigirá nova aprovação explícita e não é autorizada por esta matriz.

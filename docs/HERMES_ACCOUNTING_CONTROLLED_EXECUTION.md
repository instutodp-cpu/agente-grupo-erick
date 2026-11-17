# C22 — Controlled Execution Gateway (reconstruído sobre o main atual)

C22 modela a fronteira de autorização para futuras ações financeiras, mas não ativa
pagamentos de produção.

## Estado padrão

`featureEnabled = false` e `realProviderEnabled = false`.
Qualquer condição ausente mantém a decisão em `DISABLED`.

Mesmo uma decisão sinteticamente `AUTHORIZED` mantém
`simulationOnly = true` e `externalEffectAllowed = false`.

## Gates

A autorização exige:

- aprovação com segregação entre preparador e aprovador;
- envelope não expirado;
- destino na allowlist;
- valor dentro do limite;
- chave de idempotência;
- flags sintéticas habilitadas.

A reserva de idempotência deste contrato é apenas um modelo; persistência
transacional real fica para um gate posterior.

## Estados

`AUTHORIZED != SUBMITTED != CONFIRMED != RECONCILED`.

A submissão aceita por um adaptador sintético não é confirmação. A confirmação e a
reconciliação de referência, valor e destino permanecem gates separados.

## Limites

Somente o provedor `synthetic` é aceito. Não há banco/Pix real, credenciais,
rede, persistência de idempotência, estorno ou execução de dinheiro.

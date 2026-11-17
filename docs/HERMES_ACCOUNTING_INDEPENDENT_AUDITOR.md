# C17 — Auditoria contábil independente

C17 adiciona verificação independente dentro da arquitetura Hermes/Maestro. Não é outro superagente autônomo.

## Independência

O contrato separa produtor, auditor e aprovador do engagement. O produtor não pode auditar nem aprovar o próprio trabalho. O auditor consome fatos canônicos, evidências imutáveis, reconciliações, rascunhos de diário, pacotes de fechamento, registros fiscais/trabalhistas/tributários, versões de regras e aprovações.

Narrativa de Hermes não é evidência primária.

## Afirmações

O auditor pode testar existência/ocorrência, completude, exatidão, cutoff/competência, classificação, autorização, avaliação, reconciliação e apresentação.

## Completude bidirecional

source → ledger detecta omissões.
ledger → source detecta registros sem suporte.

IDs duplicados são rejeitados e as duas direções precisam passar.

## Cutoff e integridade

Datas inválidas bloqueiam o teste. Evidência cujo hash diverge fica tampered; em período fechado a attestation é inválida e exige revisão/reabertura controlada.

## Autoridade

O auditor pode ler, testar, atestar ou bloquear. Não pode corrigir diário, pagar, transmitir obrigação fiscal ou mutar a fonte. Ação desconhecida também é negada.

## Pacote

InternalAuditPackage é um pacote de verificação interna. Nunca é opinião estatutária externa. Findings críticos abertos produzem EXCEPTIONS, não PASS.

## Não implementado

- opinião de auditoria externa/estatutária;
- recomputação produtiva de todos os domínios;
- amostragem surpresa;
- persistência, UI ou integração externa do auditor.

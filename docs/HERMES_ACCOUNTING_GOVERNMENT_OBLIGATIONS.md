# C15 — Obrigações governamentais

C15 modela eventos de eSocial, EFD-Reinf, DCTFWeb e FGTS Digital sem conceder autoridade de transmissão autônoma. O escopo é sintético e não usa credenciais, certificados, transportes oficiais ou pagamento.

## Sistemas e versionamento

Cada evento carrega tenant, empresa, competência YYYY-MM, sistema governamental, tipo de evento, versão de esquema, versão de regra, hash do payload e evidências.

Sistemas aceitos:

- eSocial;
- EFD-Reinf;
- DCTFWeb;
- FGTS Digital.

## Ciclo do evento

DRAFT → VALIDATED → READY_FOR_REVIEW → APPROVED → READY_TO_SUBMIT → SUBMITTED → PROCESSING → ACCEPTED ou REJECTED

As transições são explícitas e não permitem saltos. SUBMITTED não significa ACCEPTED. Protocolos e códigos/mensagens de rejeição são preservados no resultado sintético.

## Validação

Antes da revisão, o contrato exige esquema, regras de negócio, dependências, cruzamento de fontes e evidências completos. Qualquer item ausente mantém o evento em DRAFT.

## Retificação

Uma retificação cria uma nova versão vinculada ao evento original. O original nunca é sobrescrito; a retificação fica PENDING_REVIEW até decisão humana.

## Documento de pagamento

O evento/obrigação governamental e o documento de pagamento são registros distintos. Um documento novo começa GUIDE_ISSUED e não pode ser criado diretamente como PAID.

## Reconciliação

Reconciliação verdadeira exige simultaneamente:

- valor esperado;
- evento reportado;
- apuração oficial;
- guia;
- confirmação bancária;
- registro contábil.

Sem a cadeia completa o resultado é NOT_RECONCILED.

## Autoridade e não implementado

O gate de submissão exige estado APPROVED e aprovação humana, mas apenas retorna autorização lógica. Não há:

- transporte de produção eSocial, EFD-Reinf, DCTFWeb ou FGTS Digital;
- credenciais, certificados ou segredo;
- emissão/pagamento real de guia;
- retificação automática;
- persistência externa, deploy ou efeito oficial.

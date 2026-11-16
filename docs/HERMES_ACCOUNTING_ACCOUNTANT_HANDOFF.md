# C18 — Handoff e colaboração com contador

C18 encerra o primeiro ciclo contábil operacional ao empacotar trabalho fechado, reconciliado e auditado para revisão do contador.

## Pacote

O handoff versionado vincula:

- ClosePackage;
- InternalAuditPackage;
- manifest de evidências;
- exceções;
- lançamentos;
- obrigações;
- evidências de suporte.

O pacote nasce DRAFT, é imutável e possui tenant, empresa, competência, hash do manifest e versão. Um handoff posterior supersede o anterior sem reescrever histórico.

## Prontidão

READY_FOR_ACCOUNTANT só é possível quando:

- o fechamento está READY_TO_CLOSE ou CLOSED;
- a auditoria independente está PASS;
- evidências estão completas;
- não há exceção crítica aberta.

## Ciclo

DRAFT → READY_FOR_ACCOUNTANT → DELIVERED → UNDER_REVIEW → ACCEPTED

Durante revisão:

UNDER_REVIEW → CHANGES_REQUESTED → UNDER_REVIEW

As transições não podem ser saltadas.

## Feedback e correções

Comentários e change requests são registros rastreáveis. Correção em material fechado:

- não altera o registro antigo;
- exige evidência;
- exige aprovação humana;
- cria nova versão;
- pode exigir reabertura e nova reconciliação nas camadas anteriores.

## Não implementado

- portal/UI de contador;
- exportação para software contábil externo;
- transporte de notificações;
- assinatura digital;
- persistência produtiva.

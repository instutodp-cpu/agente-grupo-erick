# C10 — Fechamento contínuo

C10 transforma evidências e reconciliações em um processo controlado por empresa, estabelecimento e competência. O contrato é sintético: não persiste, não publica lançamento, não envia obrigação fiscal e não executa pagamento.

## Máquina de estados

    OPEN → INGESTING → RECONCILING → EXCEPTIONS_PENDING
    → READY_FOR_REVIEW → HUMAN_REVIEW → READY_TO_CLOSE → CLOSED → LOCKED

Retornos para RECONCILING são permitidos antes do fechamento quando nova evidência invalida a prontidão. O contrato não permite saltos arbitrários. CLOSED e LOCKED não podem ser reescritos silenciosamente.

## Prontidão

Cobertura de reconciliação e completude de evidência são medidas em basis points, de 0 a 10000. O score é informativo; qualquer bloqueador vence score perfeito:

- exceção material não resolvida;
- variância monetária não explicada;
- bloqueador explícito;
- competência ou métrica inválida.

READY_TO_CLOSE exige revisão humana. CLOSED exige prontidão e aprovação humana explícita.

## Fechamento diário e mensal

O mesmo contrato suporta fechamento por loja ou por empresa/competência usando establishmentId e competence. O pacote é somente uma atestação imutável de referências e hash de evidências; camadas futuras poderão materializá-lo.

## Evidência tardia e reabertura

Evidência recebida após CLOSED ou LOCKED gera CREATE_REOPEN_REQUEST, pendente de aprovação humana. O pacote histórico não é alterado. Períodos ainda abertos podem voltar a RECONCILING.

## Segregação de funções

Quando aplicável:

    PREPARER != REVIEWER != APPROVER

A verificação de segregação falha fechada se qualquer identidade se repetir.

## Fora de escopo

- transação de lock em banco;
- reabertura automática;
- postagem de diário;
- submissão fiscal;
- execução de pagamento;
- scheduler, rede, segredo ou provedor real.

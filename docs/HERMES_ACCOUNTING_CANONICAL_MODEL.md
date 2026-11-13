# C1 — Canonical Accounting Model

C1 define a linguagem comum dos futuros adaptadores e engines de Accounting do Hermes. Não conecta sistemas externos, não altera roteamento e não executa ações.

## Registro canônico

Todo registro preserva:

- `schemaVersion`, `entityType` e `id`;
- `tenantId`, `companyId` e, quando aplicável, `establishmentId`;
- `sourceSystem` e `sourceReference`;
- `occurredAt` e competência opcional;
- autoridade e estado de valor;
- referências de evidência;
- payload específico do domínio.

O catálogo executável está em `src/hermes/accounting/canonical-model.js`.

## Limites

Autoridade: `READ | ANALYZE | PREPARE | WRITE | MONEY | FISCAL_SUBMIT`.

Estado de valor: `FORECAST | EXPECTED | ASSESSED | PAID | RECONCILED`.

Valores autoritativos devem usar unidades monetárias inteiras, como centavos de BRL. Proveniência e dimensão multiempresa/multiloja não podem ser descartadas. Entradas desconhecidas falham fechadas.

C1 é somente vocabulário e validação: sem conector, migração, pagamento, submissão fiscal, integração de rota ou ação autônoma.

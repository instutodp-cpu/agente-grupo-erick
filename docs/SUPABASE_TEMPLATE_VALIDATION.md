# Validação real dos SQL Templates no Supabase/Railway

## Objetivo

Confirmar que cada SQL Template usa **tabelas/views/colunas que existem de fato**
no banco e que as consultas rodam sem erro — pegando divergências de schema
antes que cheguem ao usuário. A validação é **somente leitura** e **não altera
dados**.

## Script

`scripts/validate-templates.js` executa cada template contra o banco real com
parâmetros de teste (as mesmas perguntas da tela).

### Como rodar

```bash
# via npm
DATABASE_URL=postgres://... npm run validate:templates

# ou diretamente
DATABASE_URL=postgres://... node scripts/validate-templates.js
```

Se `DATABASE_URL` estiver no `.env`, basta `npm run validate:templates`.

### Saída

Imprime **apenas** metadados — nunca linhas ou valores do banco:

```
Validação dos SQL Templates (somente leitura)
────────────────────────────────────────────────────────────────────────
Template                           Status    rowCount  tempo(ms)
────────────────────────────────────────────────────────────────────────
monthly_revenue_by_store           OK               5         142
recoverable_delinquency_by_store   OK               4          88
...
────────────────────────────────────────────────────────────────────────
Total: 6 | OK: 6 | ERRO: 0
```

Para cada template mostra: **template**, **status** (OK/ERRO), **rowCount**,
**tempo de execução (ms)** e, quando houver, o **erro** (mensagem redigida).

O processo sai com código `0` se todos passarem e `1` se algum falhar (útil em
CI). Sem `DATABASE_URL`, sai com código `1` e uma mensagem amigável, sem tentar
conectar.

## Garantias de segurança

- **Somente leitura**: cada template roda dentro de uma transação
  `BEGIN; SET TRANSACTION READ ONLY; ...; ROLLBACK`. Qualquer escrita seria
  rejeitada pelo Postgres e o `ROLLBACK` garante que nada é persistido.
- **Nenhuma query de escrita**: os templates são todos `SELECT`; o script não
  emite `INSERT/UPDATE/DELETE/DDL`.
- **Nenhum dado sensível nos logs**: o script lê apenas `rowCount` (nunca
  `rows`). Mensagens de erro passam por redação (e-mail, CPF, CNPJ, telefone,
  chave Anthropic e `DATABASE_URL`).
- **Timeout por consulta**: `SET LOCAL statement_timeout`
  (`SQL_TEMPLATE_VALIDATION_TIMEOUT_MS`, padrão 30000 ms).

## Configuração

| Variável                                | Padrão  | Descrição                               |
| --------------------------------------- | ------- | --------------------------------------- |
| `DATABASE_URL`                          | —       | Connection string do Supabase/Railway.  |
| `SQL_TEMPLATE_VALIDATION_TIMEOUT_MS`    | `30000` | Timeout por consulta na validação (ms). |

## Revisão estática de schema (nesta PR)

Antes de disponibilizar o script, cada template foi conferido contra as views
documentadas no system prompt do agente:

| Template                           | View / colunas usadas                                                                 | Situação |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| `monthly_revenue_by_store`         | `vw_faturamento_mensal` (loja, mes, qtd_vendas, faturamento_bruto, total_desconto, faturamento_liquido) | OK |
| `average_ticket_last_three_months` | `vw_faturamento_mensal` (loja, mes, qtd_vendas, faturamento_liquido)                   | OK |
| `revenue_year_comparison_by_store` | `vw_faturamento_mensal` (loja, mes, faturamento_liquido)                               | OK |
| `recoverable_delinquency_by_store` | `vw_inadimplencia_por_faixa` (loja, classificacao, qtd_parcelas, valor_em_aberto, media_dias_atraso, vencimento_mais_antigo, vencimento_mais_recente) | OK |
| `top_products_last_six_months`     | `vw_itens_vendidos` (codigo_produto, produto, quantidade, valor_total, data_venda, loja, itemdevolvido) | OK |
| `top_salespeople_by_year`          | `vw_itens_vendidos` (loja, vendedor, codigo_da_venda, quantidade, valor_total, data_venda, itemdevolvido) | OK |

A revisão estática **não encontrou divergências** de nome de tabela/view/coluna
— todas as referências existem no schema documentado. A validação contra o banco
real (via este script) é o passo final para confirmar em produção, pois só ela
enxerga o estado atual das views no Supabase/Railway.

## Quando corrigir um template

Se o script apontar `ERRO` do tipo `column "x" does not exist` ou
`relation "y" does not exist`, ajuste o SQL do template correspondente em
`src/hermes/sql-templates/index.js` para o nome real e rode novamente até
`OK`. Não altere regra de negócio nem o comportamento do chat.

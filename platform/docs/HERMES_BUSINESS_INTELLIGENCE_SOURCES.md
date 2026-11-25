# Hermes — fontes da inteligência empresarial (semana 4)

Escopo: o bot privado (Hermes, plano de execução) lendo agregados do banco das
lojas (`hermes_history`, papel `hermes_history_reader`, somente leitura).
Maestro continua sendo o plano de controle. Nada aqui altera banco, cria
tabela ou faz deploy: este documento diz **o que o Hermes já sabe consultar** e
**o que o banco precisa expor**, para a auditoria do Supabase (ChatGPT)
confirmar ou criar.

## 1. Períodos: a cobertura vem da fonte

O Hermes não tem mais calendário fixo (2025/2026). A cobertura é lida da
própria fonte, no loop principal do bot, uma vez por dia (nova tentativa em
6 h se falhar), fora da cota de perguntas:

```sql
SELECT 'commercial' AS scope, MIN(month), MAX(month), MAX(last_day) FROM hermes_history.monthly_commercial_2025_2026_v1
UNION ALL
SELECT 'products', MIN(month), MAX(month), NULL FROM hermes_history.monthly_product_activity_v1
```

- Fica em `history-coverage.json` (validada, com a hora da leitura). Se a
  leitura falhar, vale a guardada por até 7 dias; depois, a cobertura
  **verificada antes da semana 4** (vendas 2025-01 a 2026-06, até 08/06/2026;
  produtos 2026). Período fora dela é recusado, nunca adivinhado.
- Qualquer período dentro da cobertura é aceito (de 2000 em diante). "março"
  sem ano = o março mais recente na fonte.
- Ano contra ano compara só os **meses completos nos dois anos**, passados como
  parâmetros (`$4`, `$5`); a resposta diz quais. Mês parcial nunca é comparado
  como completo; período parcial é avisado a partir do último dia da própria
  fonte.

**Para liberar o histórico desde 2011:** basta a view comercial cobrir esses
anos com as mesmas colunas (`month`, `raw_store`, `registered`, `cancelled`,
`noncancelled`, `valor_pago_noncancelled_sum`, `last_day`). Se for uma view
nova, troca-se uma linha (`SOURCE` em `hermes-analyst-templates.js`) num PR
revisado; nada mais muda.

## 2. Ticket médio (já disponível)

`ticket médio = valor_pago importado ÷ registros não cancelados` nos templates
existentes (período, comparação, ranking de lojas), com as limitações na
resposta (não é faturamento líquido; é por registro de venda, não por cliente
nem item). Sem registro não cancelado: "indefinido".

## 3. Inadimplência e vendedores (prontos, desligados)

Consultas determinísticas, só agregados, **somente para o dono**, respondidas
antes do agente com IA. Ficam desligadas até as views existirem e serem
configuradas; até lá o bot responde que a fonte aguarda a auditoria, sem
consulta e sem número.

| Pergunta | Template | View (contrato) | Variável |
| --- | --- | --- | --- |
| "qual a inadimplência?", "carteira vencida da loja X", "faixas de atraso" | `portfolio` | posição da carteira | `HERMES_HISTORY_RECEIVABLES_POSITION_VIEW` |
| "concentração da inadimplência por loja" | `stores` | posição da carteira | idem |
| "recuperação de crédito em maio de 2026" | `recovery` | recuperação | `HERMES_HISTORY_RECEIVABLES_RECOVERY_VIEW` |
| "melhores vendedores de maio de 2026", "por ticket médio" | `sellers` | vendas por vendedor | `HERMES_HISTORY_SELLER_VIEW` |

O valor da variável precisa ser `hermes_history.<nome>`; outro formato impede
o bot de iniciar. As leituras usam a mesma cota diária de histórico.

### Contrato das views (o que o Hermes lê)

**Posição da carteira** — grão `as_of_day × raw_store × aging_bucket`:

| Coluna | Tipo | Significado |
| --- | --- | --- |
| `as_of_day` | text `AAAA-MM-DD` | dia da posição (o Hermes usa só a mais recente) |
| `raw_store` | text | mesmos códigos de loja da view comercial |
| `aging_bucket` | text | `a_vencer`, `1_30`, `31_60`, `61_90`, `91_180`, `181_360`, `360_mais` |
| `installments` | bigint | parcelas em aberto |
| `open_amount` | numeric(18,2) | saldo em aberto (R$) |

**Recuperação** — grão `month × raw_store`: `month` (text `AAAA-MM`),
`raw_store`, `recovered_installments` (bigint), `recovered_amount`
(numeric(18,2)), `last_day` (text `AAAA-MM-DD`).

**Vendas por vendedor** — grão `month × raw_store × seller_code`: `month`,
`raw_store`, `seller_code` (text), `seller_label` (text, nome de exibição),
`registered`, `cancelled`, `noncancelled` (bigint),
`valor_pago_noncancelled_sum` (numeric(18,2)), `last_day`.

Nenhuma coluna de cliente, documento, contato ou parcela individual. O ranking
de vendedores mostra até 10 nomes, só ao dono; por ticket, só quem tem ao
menos 10 vendas não canceladas.

## 4. O que a auditoria do Supabase precisa confirmar

1. **Histórico desde 2011:** em que tabela estão as vendas de 2011–2024; se
   `monthly_commercial_2025_2026_v1` pode ser estendida ou se haverá view nova
   (nome); se o **primeiro mês** de cada view começa no dia 1 (o Hermes assume
   que sim; se não, informar o primeiro dia).
2. **Inadimplência:** tabela real de parcelas/títulos a receber (crediário),
   colunas de vencimento, pagamento e saldo; **definição de "vencido"** (data
   de vencimento < dia da posição? tolerância?), se saldo inclui juros/multas,
   como tratar renegociação e parcela cancelada; se as faixas acima servem.
   A view antiga `public.vw_inadimplencia_por_faixa` (citada nos templates da
   v1) **nunca foi validada no banco real**: confirmar se existe e o que contém.
3. **Recuperação:** como identificar pagamento de parcela já vencida e em que
   data; se há base da carteira vencida no início de cada mês (permitiria
   taxa de recuperação; hoje não é calculada).
4. **Vendedores:** de onde vem o vendedor da venda (`vw_itens_vendidos.vendedor`
   da v1 também não foi validada), se há código estável, e se o cancelamento é
   por venda.
5. **Permissões:** `GRANT SELECT` das views novas só para
   `hermes_history_reader`; nenhuma tabela de origem exposta.
6. **Evidência:** a definição SQL (`pg_get_viewdef`) de cada view criada,
   versionada em `platform/migrations/` no mesmo PR que liga a variável.

## 5. Linx pelo adaptador Seta

Arquivo e API futura usam o mesmo plano incremental e o mesmo manifesto
(`docs/HERMES_ACCOUNTING_SETA_READ.md`, C3.1 e C3.2). A API está pronta e
desligada até a descoberta oficial (endpoint, autenticação, recibo) e o
mapeamento revisado do layout.

## 6. Implantação (frente de infraestrutura)

1. Imagem do bot a partir do commit mergeado; no gate de importação do deploy,
   incluir `require("/app/src/runtime/hermes-history-coverage")`,
   `require("/app/src/runtime/hermes-receivables-templates")` e
   `require("/app/src/runtime/hermes-seller-templates")`.
2. Nenhuma variável nova é obrigatória: sem elas, a cobertura é lida da view
   atual (igual à verificada) e inadimplência/vendedores ficam desligados.
3. Depois da auditoria e das views criadas e versionadas: acrescentar ao
   `docker run` as variáveis da seção 3 com os nomes confirmados, reiniciar e
   validar com uma pergunta de cada tipo. Rollback: remover a variável.
4. O `audit.jsonl` registra `history_coverage` (meses, nunca valores) uma vez
   por dia.

## 7. Critérios de aceite

- [ ] Com a view cobrindo 2011+, "quanto vendemos em março de 2015?" responde
      com fonte e "Dados até …"; antes disso, é recusado sem consulta.
- [ ] "compare as vendas de 2011 e 2012" diz quais meses foram comparados.
- [ ] "qual o ticket médio em março de 2026?" mostra o ticket e suas limitações.
- [ ] Sem as variáveis, "qual a inadimplência?" responde que a fonte aguarda a
      auditoria; um membro recebe "visíveis somente ao dono".
- [ ] Com as views auditadas e as variáveis, a resposta mostra posição,
      faixas, risco acima de 90 dias e concentração por loja, sem cliente.

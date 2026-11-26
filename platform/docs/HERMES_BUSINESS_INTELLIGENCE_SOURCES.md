# Hermes — fontes da inteligência empresarial (semana 4)

Escopo: o bot privado (Hermes, plano de execução) lendo agregados do banco das
lojas (`hermes_history`, papel `hermes_history_reader`, somente leitura).
Maestro continua sendo o plano de controle. Nada aqui altera banco, cria
tabela ou faz deploy: este documento diz **o que o Hermes já sabe consultar**,
**o que o banco precisa expor** e **o que a auditoria do Supabase já mostrou**.

## 0. Evidências da auditoria do Supabase (25/11, somente leitura)

Auditoria feita pela frente do ChatGPT no Supabase de produção, em modo
leitura. Números reais, usados para corrigir os contratos abaixo.

**Vendas — `softcom_import.cadastro_de_vendas`** (439.724 registros):

| Ano | Registros | Observação |
| --- | --- | --- |
| 2011 | 8 | todos em 12/04 |
| 2012–2018 | 0 | **lacuna**: sem dados (não é venda zero) |
| 2019 | 29.719 | de 08/07 a 31/12 (julho parcial) |
| 2020 | 59.017 | |
| 2021 | 61.964 | |
| 2022 | 64.482 | |
| 2023 | 68.279 | |
| 2024 | 65.615 | |
| 2025 | 65.156 | |
| 2026 | 25.482 | até 08/06 (junho parcial) |
| — | 2 | sem data |

Colunas confirmadas para vendedores: `vendedor`, `codigo_da_venda`,
`lojaorigem`, `data_da_venda`, `valor_pago`, `cancelado`. A estabilidade da
identidade do vendedor entre lojas e períodos **ainda não foi validada**.

**Contas a receber — `softcom_import.contas_a_receber`** (709.290 registros).
Colunas: `registro`, `lojaorigem`, `data_da_venda`, `vencimento`,
`valor_da_parcela`, `datapag`, `valor_pago`, `pago`, `excluido`, `juros`,
`multa`, `desconto`, `valordesconto`, `registropendencia`, `tipobaixa`,
`movimentacaoid`.

- 229.227 candidatos a parcelas abertas;
- 459.695 não excluídos com `pago = False` **e** `datapag` preenchido
  (`pago` sozinho não decide nada);
- 145.046 baixas após o vencimento, não excluídas;
- 17 sem vencimento; 28 com vencimento depois de 2036 (até o ano 5022);
- último pagamento registrado: 08/06/2026.

**Segurança:** `GRANT SELECT` para `anon` e `authenticated` nas views antigas
`public.vw_contas_a_receber`, `public.vw_faturamento_mensal`,
`public.vw_inadimplencia_por_faixa` e `public.vw_itens_vendidos`. A frente do
ChatGPT investiga dependências e exposição pela API antes de qualquer
revogação. **O Hermes não as usa nem aceita como fonte** (teste
automatizado): só `hermes_history.<nome>`, pelo papel restrito.

## 1. Períodos: a cobertura vem da fonte, com lacunas e meses parciais

MIN/MAX não basta (de 2011 a 2019 há uma lacuna de oito anos). O Hermes lê,
no loop principal do bot, uma vez por dia (nova tentativa em 6 h se falhar),
fora da cota de perguntas, **cada loja e mês com dados**:

```sql
SELECT 'commercial' AS scope, raw_store, month, MAX(last_day) AS last_day
FROM hermes_history.monthly_commercial_2025_2026_v1 WHERE month IS NOT NULL GROUP BY raw_store, month
UNION ALL
SELECT 'products', NULL, month, NULL FROM hermes_history.monthly_product_activity_v1 WHERE month IS NOT NULL GROUP BY month
ORDER BY 1, 3, 2 LIMIT 5000
```

Isso vira **trechos contínuos** (ex.: `abril/2011` e `julho/2019 a
junho/2026`), para o grupo e para cada loja, guardados em
`history-coverage.json` com a hora da leitura. Se a leitura falhar, vale a
guardada por até 7 dias; depois, a cobertura **verificada antes da semana 4**
(vendas 2025-01 a 2026-06, até 08/06/2026; produtos 2026). Período fora dela é
recusado sem consulta.

Regras de completude (só com evidência):

| Mês | Completo? |
| --- | --- |
| dentro de um trecho (há dados antes e depois) | sim |
| primeiro mês de um trecho | **não** (ex.: 04/2011, 07/2019, loja que abriu no meio do mês), salvo se a view começa por corte de dados contínuos (`CUT_STARTS`: 2025-01 da view atual, pois 2024 existe na tabela) |
| último mês de um trecho | só se o último dia com venda for o fim do mês (06/2026 até 08/06 não é) |
| mês numa lacuna | sem dados: **recusado, nunca zero** |

- **Loja**: pergunta com loja usa a cobertura da própria loja (uma loja
  aberta em 2021 não responde por 2020, mesmo que o grupo tenha 2020). No
  ranking de lojas, loja com cobertura parcial no período é marcada: total
  menor não significa venda menor.
- **Ano contra ano**: só os meses **completos nos dois anos**, mesmo que pule
  meses (ex.: MAGAZINE 2022 × 2023 = janeiro a fevereiro e maio a dezembro),
  passados como lista (`RIGHT(month,2) = ANY($4::text[])`) e ditos na resposta.
  2019 × 2020 compara agosto a dezembro. Sem mês comum completo: recusado.
- **Mês contra mês**: os dois precisam estar completos.
- **Período parcial ou com lacunas** sempre avisa: "2019: dados só de julho a
  dezembro; meses sem dados não significam venda zero", "julho parcial".

**Para liberar o histórico desde 2011:** a view comercial precisa cobrir
esses anos com as mesmas colunas (`month`, `raw_store`, `registered`,
`cancelled`, `noncancelled`, `valor_pago_noncancelled_sum`, `last_day`) e
**não** inventar linhas para meses sem vendas. Se for uma view nova, troca-se
`SOURCE` (e `CUT_STARTS`, se ela começar por corte) em
`hermes-analyst-templates.js` num PR revisado.

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

O valor da variável precisa ser `hermes_history.<nome>`; outro formato
(inclusive `public.vw_*` e `softcom_import.*`) impede o bot de iniciar. As
leituras usam a mesma cota diária de histórico.

### Contrato das views (o que o Hermes lê)

**Posição da carteira** — grão `as_of_day × raw_store × aging_bucket`:

| Coluna | Tipo | Significado |
| --- | --- | --- |
| `as_of_day` | text `AAAA-MM-DD` | dia da posição, **definido pela view a partir dos dados** (nunca `CURRENT_DATE`: a base é histórica, último pagamento em 08/06/2026); o Hermes usa só a mais recente |
| `raw_store` | text | mesmos códigos de loja da view comercial |
| `aging_bucket` | text | `a_vencer`, `1_30`, `31_60`, `61_90`, `91_180`, `181_360`, `360_mais` |
| `installments` | bigint | parcelas em aberto na data da posição |
| `open_amount` | numeric(18,2) | saldo em aberto na data da posição (R$) |

A resposta diz "saldo na data da posição (histórico da fonte, não saldo
atual)" e "atraso não é perda contábil".

**Recuperação** — grão `month × raw_store`, **uma linha para todo mês e loja
com qualquer recebimento registrado**, mesmo com recuperação 0:

| Coluna | Tipo | Significado |
| --- | --- | --- |
| `month` | text `AAAA-MM` | mês do recebimento |
| `raw_store` | text | loja |
| `recovered_installments` | bigint | parcelas **já vencidas** recebidas no mês (pode ser 0) |
| `recovered_amount` | numeric(18,2) | valor recebido dessas parcelas (pode ser 0) |
| `last_day` | text ou NULL | último dia com recuperação no mês |
| `receipts_last_day` | text `AAAA-MM-DD` | último dia com **qualquer** recebimento no mês: a cobertura de recebimentos |

A cobertura de recebimentos é **independente** da de vendas. Sem linha no
período = "sem cobertura de recebimentos: isso não significa recuperação
zero" (nenhum valor mostrado). Linha com 0 = recuperação zero de verdade. Ano
com recebimentos só em alguns meses: a resposta lista os meses. Mês parcial
só quando os próprios recebimentos terminam no meio dele.

**Vendas por vendedor** — grão `month × raw_store × seller_code`: `month`,
`raw_store`, `seller_code` (identificador estável **dentro da loja**,
derivado de `cadastro_de_vendas.vendedor`), `seller_label` (nome de exibição),
`registered`, `cancelled`, `noncancelled` (bigint),
`valor_pago_noncancelled_sum` (numeric(18,2)), `last_day`. Enquanto a
identidade entre lojas não for validada, o ranking é **por loja**: a mesma
pessoa em duas lojas aparece duas vezes, nunca somada. Até 10 nomes, só ao
dono; por ticket, só quem tem ao menos 10 vendas não canceladas.

Nenhuma coluna de cliente, documento, contato ou parcela individual.

## 4. O que a auditoria ainda precisa entregar

1. **Histórico desde 2011:** view comercial cobrindo 2011-04 e 2019-07 em
   diante, sem linhas para meses vazios; dizer se 2011-04 deve aparecer (8
   registros num dia) e o que fazer com os 2 registros sem data.
2. **Inadimplência:** a regra validada de "parcela aberta" (não usar `pago`
   sozinho: há 459.695 com `pago = False` e `datapag` preenchido),
   `excluido`, renegociação (`registropendencia`, `tipobaixa`), juros, multa e
   desconto no saldo; o tratamento dos 17 sem vencimento e dos 28 com
   vencimento depois de 2036; a regra do dia da posição.
3. **Recuperação:** como reconhecer pagamento de parcela já vencida
   (`datapag` > `vencimento`?), e a cobertura mensal de recebimentos por loja.
4. **Vendedores:** se `vendedor` é código ou nome, e se é estável por loja.
5. **Permissões:** `GRANT SELECT` das views novas só para
   `hermes_history_reader`; decisão sobre as `public.vw_*` expostas.
6. **Evidência:** `pg_get_viewdef` de cada view criada, versionada em
   `platform/migrations/` no mesmo PR que liga a variável.

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
3. Depois das views criadas e versionadas: acrescentar ao `docker run` as
   variáveis da seção 3 com os nomes confirmados, reiniciar e validar com uma
   pergunta de cada tipo. Rollback: remover a variável.
4. O `audit.jsonl` registra `history_coverage` (primeiro e último mês e número
   de trechos, nunca valores) uma vez por dia.

## 7. Critérios de aceite

- [ ] Com a view cobrindo 2011+, "quanto vendemos em março de 2015?" é
      recusado sem consulta (lacuna), e "quanto vendemos em 2019?" responde
      avisando "dados só de julho a dezembro" e "julho parcial".
- [ ] "compare as vendas de 2019 e 2020" compara agosto a dezembro e diz isso.
- [ ] "qual o ticket médio em março de 2026?" mostra o ticket e suas limitações.
- [ ] Sem as variáveis, "qual a inadimplência?" responde que a fonte aguarda a
      auditoria; um membro recebe "visíveis somente ao dono".
- [ ] Com as views, recuperação num mês sem recebimentos diz "sem cobertura",
      nunca R$ 0,00; a carteira mostra a data da posição e "não saldo atual".

# SQL_TEMPLATES.md

Documentação da PR-02: SQL Templates para perguntas frequentes do Hermes.

## Objetivo

Reduzir lentidão, custo e falhas em perguntas recorrentes evitando que o Claude gere SQL livre quando a intenção do usuário é clara e já existe uma consulta segura, parametrizada e testável.

## Escopo desta PR

Foram criados templates para as 6 perguntas frequentes atuais da interface:

1. `monthly_revenue_by_store` — faturamento de cada loja em um mês específico.
2. `recoverable_delinquency_by_store` — inadimplência recuperável por loja.
3. `revenue_year_comparison_by_store` — comparação de faturamento entre dois anos por loja.
4. `top_products_last_six_months` — 10 produtos mais vendidos nos últimos 6 meses.
5. `top_salespeople_by_year` — melhores vendedores em um ano.
6. `average_ticket_last_three_months` — ticket médio por loja nos últimos 3 meses.

## Arquivos

- `src/hermes/sql-templates/index.js` contém:
  - classificador simples por intenção;
  - definição dos templates;
  - SQL parametrizado;
  - formatação markdown das respostas.
- `server.js` integra o classificador ao `/api/chat` antes do fallback Claude.

## Fluxo de execução

1. O `/api/chat` recebe a mensagem do usuário.
2. A última pergunta do usuário é normalizada.
3. O classificador tenta casar a pergunta com uma intenção conhecida.
4. Se houver match claro:
   - o Hermes executa o SQL Template parametrizado;
   - registra logs de intenção, template, latência e `rowCount`;
   - formata a resposta em markdown;
   - envia `text` e `done` via SSE;
   - não chama Claude para gerar SQL livre.
5. Se não houver match:
   - o fluxo antigo com Claude permanece como fallback.

## Views usadas

### `public.vw_faturamento_mensal`

Usada por:

- `monthly_revenue_by_store`
- `revenue_year_comparison_by_store`
- `average_ticket_last_three_months`

Campos esperados:

- `loja`
- `mes`
- `qtd_vendas`
- `faturamento_bruto`
- `total_desconto`
- `faturamento_liquido`
- `ticket_medio`

### `public.vw_inadimplencia_por_faixa`

Usada por:

- `recoverable_delinquency_by_store`

Campos esperados:

- `loja`
- `classificacao`
- `qtd_parcelas`
- `valor_em_aberto`
- `media_dias_atraso`
- `vencimento_mais_antigo`
- `vencimento_mais_recente`

### `public.vw_itens_vendidos`

Usada por:

- `top_products_last_six_months`
- `top_salespeople_by_year`

Campos esperados:

- `loja`
- `data_venda`
- `codigo_da_venda`
- `vendedor`
- `codigo_produto`
- `produto`
- `quantidade`
- `valor_total`
- `itemdevolvido`

## Segurança

- Templates usam parâmetros do `pg`, não concatenação direta de valores do usuário.
- O SQL completo não é logado.
- Resultados completos não são logados.
- Logs registram apenas intenção, nome do template, quantidade de parâmetros, duração e `rowCount`.
- Para as 6 intenções cobertas, o Hermes não permite SQL livre gerado pelo Claude: se houver match claro, usa template.
- Perguntas fora do escopo continuam no fallback atual.

## Logs adicionados

### `intent_detected`

Emitido quando uma pergunta casa com template.

Campos:

- `requestId`
- `intent`
- `templateName`

### `intent_fallback`

Emitido quando nenhuma intenção conhecida é detectada.

Campos:

- `requestId`
- `reason`

### `sql_template_query_start`

Emitido antes da execução do template.

Campos:

- `requestId`
- `intent`
- `templateName`
- `parameterCount`

### `sql_template_query_finish`

Emitido após sucesso da query.

Campos:

- `requestId`
- `intent`
- `templateName`
- `durationMs`
- `rowCount`

### `sql_template_query_error`

Emitido quando a query do template falha.

Campos:

- `requestId`
- `intent`
- `templateName`
- `durationMs`
- `errorType`

## Limitações atuais

- O classificador é propositalmente simples, baseado em regras e palavras-chave. Para evitar resposta errada em perguntas parecidas, o template mensal de faturamento exige mês e ano explícitos.
- Não há cache nesta PR.
- Não há guardrail geral para SQL livre fora dos templates nesta PR.
- Períodos relativos como “últimos 6 meses” e “últimos 3 meses” usam a data atual do servidor.
- A validação contra o Supabase real depende das credenciais do ambiente de produção/staging.

## Próximos passos recomendados

1. Validar os números contra Metabase/Supabase real.
2. Adicionar cache para templates frequentes.
3. Criar testes automatizados para classificador e geração de parâmetros.
4. Adicionar guardrails para SQL livre remanescente.
5. Evoluir o classificador para aceitar variações adicionais de linguagem.

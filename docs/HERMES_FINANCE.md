# Hermes Financeiro

## Objetivo

Transformar o Hermes num **analista financeiro corporativo** do Grupo Erick —
capaz de responder, com dados oficiais, sobre faturamento, recebíveis,
inadimplência, ticket médio, comparação entre lojas e um resumo financeiro
consolidado.

O Hermes continua sendo **um único sistema**: isto não cria um novo agente nem
integra WhatsApp. É a **fundação de negócio** do módulo financeiro, sobre a qual
as próximas PRs vão construir.

## Esta PR é só a fundação

Nada está integrado e o comportamento atual não muda:

- **Não** altera o chat, os SQL Templates, o cache nem o frontend.
- **Não** executa consultas: define catálogo, mapa de intenções e a interface do
  construtor de resposta.
- O construtor de resposta é **interface apenas** (`implemented: false`).

## Componentes (`src/hermes/finance/`)

- `finance-capabilities.js` — catálogo das capacidades financeiras (id, título,
  descrição, fontes de dados e `status`).
- `financial-intent-map.js` — `classifyFinancialIntent(question)` mapeia
  perguntas para uma capacidade, de forma léxica/determinística.
- `financial-response-builder.js` — `buildFinancialResponse(capability, data)`,
  contrato de formatação (ainda não implementado).

## Capacidades

| Capacidade            | O que responde                                         | Status     |
| --------------------- | ------------------------------------------------------ | ---------- |
| `daily_revenue`       | Faturamento de hoje / de um dia.                       | **integrado** |
| `monthly_revenue`     | Faturamento por loja e mês.                            | available  |
| `accounts_receivable` | Contas a receber, vencidas e inadimplência.           | available  |
| `accounts_payable`    | Contas a pagar.                                        | planned    |
| `cash_flow`           | Entradas e saídas (fluxo de caixa).                   | planned    |
| `top_customers`       | Clientes que mais compram.                            | partial    |
| `store_comparison`    | Ranking/comparativo entre lojas.                      | available  |
| `ticket_average`      | Ticket médio por loja e período.                      | available  |
| `payment_methods`     | Distribuição por forma de pagamento.                  | partial    |
| `financial_summary`   | Panorama consolidado.                                 | available  |

`status`: `available` (há fonte documentada), `partial` (dado com limitações),
`planned` (depende de dados/infra ainda não disponíveis).

## Perguntas suportadas (exemplos)

| Pergunta                                   | Capacidade            |
| ------------------------------------------ | --------------------- |
| "quanto vendemos hoje?"                    | `daily_revenue`       |
| "qual o faturamento do mês?"               | `monthly_revenue`     |
| "quanto temos a receber?" / "inadimplência"| `accounts_receivable` |
| "quanto temos a pagar?"                    | `accounts_payable`    |
| "como está o fluxo de caixa?"              | `cash_flow`           |
| "quais os melhores clientes?"              | `top_customers`       |
| "qual loja vendeu mais?"                   | `store_comparison`    |
| "qual o ticket médio?"                     | `ticket_average`      |
| "quais as formas de pagamento?"            | `payment_methods`     |
| "me dê um resumo financeiro"               | `financial_summary`   |

## Limitações

- Capacidades `planned` (contas a pagar, fluxo de caixa) dependem de dados de
  `financeiro_movimentacoes` ainda não validados; `partial` (top clientes,
  formas de pagamento) têm cobertura parcial.
- Sem dados de custo do produto, não há cálculo de margem/CMV completo (compras
  disponíveis até jan/2023).
- Esta fundação não responde perguntas de fato — apenas classifica e define
  contratos.

## Integração segura — `daily_revenue` (V2)

A primeira capacidade real está **integrada ao `/api/chat`**, de forma segura:

- `financial-intent-map.js` detecta perguntas claras de faturamento diário
  ("quanto vendemos hoje?", "quanto faturamos hoje", "faturamento de hoje",
  "vendas de hoje", "resultado de hoje", "movimento de hoje", "como foi o dia").
  Um **guarda de período** garante que perguntas com mês, ano, "semana",
  "ontem", "dia N", "últimos ..." ou "passado" **não** disparem daily_revenue —
  evitando falso-positivo (ex.: "faturamento do mês até hoje" segue para o fluxo
  mensal/fallback, não para o diário).
- `finance-execution.js` (`buildFinanceExecution`) produz uma execução
  **compatível com o motor de SQL Templates**, reaproveitando o **mesmo caminho
  seguro**: SQL parametrizado (`public.vw_itens_vendidos`, somente leitura),
  **cache existente** (perfil `current_day`, TTL 10 min) e os logs já existentes.
- `financial-response-builder.js` formata a resposta (`buildFinancialResponse`).
- Só entra no fluxo quando o match é **claro**. Perguntas ambíguas ou fora do
  escopo continuam no **fallback atual** (SQL Templates → Claude), inalterado.
- Nenhuma nova chamada ao Claude: a resposta vem do banco (ou do cache).

Logs estruturados: `finance_capability_detected` (match claro) e
`finance_response_built` (resposta formatada), correlacionados por `requestId`.

## Roadmap do módulo

1. **Fundação** (esta PR): catálogo, mapa de intenções e interface de resposta.
2. Ligar cada capacidade `available` a um SQL Template determinístico.
3. Implementar `buildFinancialResponse` (formatação em markdown por capacidade).
4. Integrar ao fluxo (via HIL) para responder perguntas financeiras com dados
   oficiais, preservando cache e guardrails.
5. Habilitar capacidades `planned`/`partial` conforme os dados forem validados.

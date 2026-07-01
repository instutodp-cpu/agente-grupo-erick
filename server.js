require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ── Conexão Supabase ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── System prompt do agente ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o Assistente de Gestão do Grupo Erick, um grupo familiar de varejo de calçados e roupas localizado em Barreiros-PE e Sirinhaém-PE. Você tem acesso ao banco de dados histórico completo das lojas (2011 a junho/2026) e responde perguntas de gestão em linguagem clara e direta.

LOJAS DO GRUPO:
- CALCADOS → Erick Calçados Barreiros (loja principal, mais rentável)
- MAGAZINE → Erick Magazine e Kids
- ERICK SPORTS → Erick Sports
- SIRINHAEM → Erick Calçados Sirinhaém
- VARIEDADES → Erick Variedades (loja mais nova)

VIEWS DISPONÍVEIS NO BANCO (schema: public):
1. vw_faturamento_mensal — faturamento por loja e mês
   Colunas: loja, mes, qtd_vendas, faturamento_bruto, total_desconto, faturamento_liquido, ticket_medio

2. vw_itens_vendidos — cada item vendido com produto, tamanho, cor
   Colunas: loja, data_venda, mes, codigo_da_venda, vendedor, codigo_produto, produto, tamanho, cores, quantidade, preco_unitario, desconto, valor_total, itemdevolvido

3. vw_contas_a_receber — parcelas com status de pagamento
   Colunas: registro, loja, data_venda, data_vencimento, valor_parcela, valor_pago, forma_pagamento, parcela, status_parcela (PAGO/VENCIDO/EM ABERTO), data_pagamento, dias_atraso, vendedor, bloquete

4. vw_inadimplencia_por_faixa — inadimplência agrupada por faixa de atraso
   Colunas: loja, faixa, classificacao (RECUPERAVEL/INADIMPLENTE/PERDA PROVAVEL), qtd_parcelas, valor_em_aberto, media_dias_atraso, vencimento_mais_antigo, vencimento_mais_recente

5. vw_produtos_catalogo — catálogo de mercadorias
   Colunas: codigo, produto, codbarras, preco_venda, grupo, subgrupo, fornecedor

TABELAS BRUTAS disponíveis (softcom_import):
- cadastro_de_vendas (439.724 vendas)
- vendas_efetuadas (704.666 itens)
- contas_a_receber (709.290 parcelas)
- compras_efetuadas (223.159 compras)
- cadastro_de_mercadorias (74.502 produtos)
- cadastro_clientes (5.208 clientes, PII mascarada)
- bloquetes (588.303)
- financeiro_movimentacoes (27.846)

CONTEXTO DE NEGÓCIO:
- Ticket médio histórico: R$ 85,91
- Faturamento histórico total: ~R$ 37M (2011-2026)
- Crediário próprio com máximo de 5 parcelas
- Migração do ERP Softcom para Linx prevista para julho/2026
- Inadimplência: R$ 938k recuperável (até 90 dias), R$ 1,2M em perda provável (+180 dias)
- Sirinhaém tem volume anômalo de vendas R$0 (investigação pendente)

COMO RESPONDER:
1. Para perguntas que precisam de dados: use a função query_database com SQL adequado
2. Sempre use cast correto: datas como ::timestamptz ou ::date, valores como ::numeric
3. Filtre lojas desativadas: WHERE loja NOT LIKE '%DESATIVADO%'
4. Para o campo cancelado use: cancelado = 'False' (string, não booleano)
5. Formate valores em R$ com separador de milhar
6. Responda em português, de forma direta e objetiva
7. Quando mostrar dados, inclua sempre o período consultado
8. Se a pergunta for ambígua, responda com os dados mais relevantes e ofereça detalhar

LIMITAÇÕES HONESTAS:
- Dados de compras (CMV) disponíveis até jan/2023
- Dados de custo do produto não estão disponíveis para cálculo de margem
- Pericles e Erick são os proprietários — trate-os com respeito e linguagem acessível`;

// ── Função de query no Supabase ───────────────────────────────────────────────
async function queryDatabase(sql) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql);
    return { rows: result.rows, rowCount: result.rowCount };
  } finally {
    client.release();
  }
}

// ── Ferramentas do agente ────────────────────────────────────────────────────
const tools = [
  {
    name: "query_database",
    description: "Executa uma query SQL no banco de dados do Grupo Erick no Supabase. Use para buscar dados de faturamento, inadimplência, produtos, vendas e demais informações operacionais.",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "Query SQL a ser executada. Sempre use o schema correto: public para views (vw_*), softcom_import para tabelas brutas."
        },
        descricao: {
          type: "string",
          description: "Descrição em português do que esta query busca, para mostrar ao usuário enquanto carrega."
        }
      },
      required: ["sql", "descricao"]
    }
  }
];

// ── Endpoint principal do agente ─────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let currentMessages = [...messages];
    let continueLoop = true;

    while (continueLoop) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: tools,
          messages: currentMessages
        })
      });

      const data = await response.json();

      if (data.stop_reason === 'end_turn') {
        // Resposta final — envia pro cliente
        const text = data.content
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        sendEvent({ type: 'text', content: text });
        continueLoop = false;

      } else if (data.stop_reason === 'tool_use') {
        // Agente quer consultar o banco
        const toolUseBlock = data.content.find(b => b.type === 'tool_use');

        if (toolUseBlock && toolUseBlock.name === 'query_database') {
          const { sql, descricao } = toolUseBlock.input;
          sendEvent({ type: 'querying', content: descricao });

          let toolResult;
          try {
            const result = await queryDatabase(sql);
            toolResult = JSON.stringify({
              success: true,
              rowCount: result.rowCount,
              rows: result.rows
            });
          } catch (err) {
            toolResult = JSON.stringify({
              success: false,
              error: err.message
            });
          }

          // Adiciona o resultado da tool ao histórico e continua
          currentMessages = [
            ...currentMessages,
            { role: 'assistant', content: data.content },
            {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolUseBlock.id,
                content: toolResult
              }]
            }
          ];
        } else {
          continueLoop = false;
        }
      } else {
        continueLoop = false;
      }
    }

    sendEvent({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('Erro no agente:', err);
    sendEvent({ type: 'error', content: 'Erro ao processar sua pergunta. Tente novamente.' });
    res.end();
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Agente Grupo Erick rodando na porta ${PORT}`));

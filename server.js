require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');
const { buildTemplateExecution, templates } = require('./src/hermes/sql-templates');
const { createCacheKey, getCacheEntry, setCacheEntry } = require('./src/hermes/cache');
const { validateSql, QUERY_TIMEOUT_MS } = require('./src/hermes/sql-guardrails');
const { validateAllTemplates } = require('./src/hermes/template-validation');
const { classify } = require('./src/hermes/intelligence/intent-classifier');
const { simulateDecision } = require('./src/hermes/intelligence/shadow');
const { recordDecision: recordHilDecision, snapshot: hilMetricsSnapshot } = require('./src/hermes/intelligence/metrics');
const { buildDecisionReport } = require('./src/hermes/intelligence/report');

const app = express();
app.use(express.json());
app.use(express.static('public'));

function getPositiveIntegerEnv(name, defaultValue) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : defaultValue;
}

const CLAUDE_API_TIMEOUT_MS = getPositiveIntegerEnv('CLAUDE_API_TIMEOUT_MS', 120000);
const CHAT_RESPONSE_TIMEOUT_MS = getPositiveIntegerEnv('CHAT_RESPONSE_TIMEOUT_MS', 180000);
const MAX_TOOL_LOOPS = getPositiveIntegerEnv('MAX_TOOL_LOOPS', 6);

function logStructured(level, event, fields = {}) {
  const payload = {
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields
  };

  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function redactSensitive(value = '') {
  return String(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[cnpj]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}/g, '[telefone]')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '[anthropic_key]')
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[database_url]');
}

function getLastUserQuestion(messages = []) {
  const lastUserMessage = [...messages].reverse().find(message => message && message.role === 'user');
  if (!lastUserMessage) return '';
  if (typeof lastUserMessage.content === 'string') return lastUserMessage.content;
  if (Array.isArray(lastUserMessage.content)) {
    return lastUserMessage.content
      .filter(block => block && block.type === 'text')
      .map(block => block.text || '')
      .join(' ');
  }
  return '';
}

function summarizeQuestionForLog(question) {
  const clean = redactSensitive(question).replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
}

function getErrorType(err) {
  if (err && (err.code === 'CLAUDE_TIMEOUT' || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT')) return 'timeout';
  if (err && err.code === 'CLAUDE_HTTP_ERROR') return 'claude_http_error';
  if (err && err.code === 'CLAUDE_INVALID_JSON') return 'claude_invalid_json';
  if (err && err.code) return err.code;
  return 'unexpected_error';
}

function getFriendlyErrorMessage(err) {
  if (getErrorType(err) === 'timeout') {
    return 'A consulta demorou mais do que o esperado e foi interrompida com segurança. Tente uma pergunta mais específica ou um período menor.';
  }
  return 'Não consegui concluir sua solicitação agora. Tente novamente em instantes ou reformule a pergunta.';
}

async function callClaude(currentMessages, requestId, loopNumber) {
  const startedAt = Date.now();
  logStructured('info', 'claude_call_start', { requestId, loopNumber, timeoutMs: CLAUDE_API_TIMEOUT_MS });

  try {
    const data = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: tools,
        messages: currentMessages
      });

      const apiReq = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        timeout: CLAUDE_API_TIMEOUT_MS,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, (apiRes) => {
        let raw = '';
        apiRes.on('data', chunk => raw += chunk);
        apiRes.on('end', () => {
          if (apiRes.statusCode < 200 || apiRes.statusCode >= 300) {
            const error = new Error(`Claude HTTP ${apiRes.statusCode}`);
            error.code = 'CLAUDE_HTTP_ERROR';
            error.statusCode = apiRes.statusCode;
            reject(error);
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (parseError) {
            const error = new Error('Claude returned invalid JSON');
            error.code = 'CLAUDE_INVALID_JSON';
            reject(error);
          }
        });
      });

      apiReq.on('timeout', () => {
        const error = new Error(`Claude call timed out after ${CLAUDE_API_TIMEOUT_MS}ms`);
        error.code = 'CLAUDE_TIMEOUT';
        apiReq.destroy(error);
      });
      apiReq.on('error', reject);
      apiReq.write(body);
      apiReq.end();
    });

    logStructured('info', 'claude_call_finish', {
      requestId,
      loopNumber,
      durationMs: Date.now() - startedAt,
      stopReason: data.stop_reason || 'unknown',
      contentBlocks: Array.isArray(data.content) ? data.content.length : 0
    });

    return data;
  } catch (err) {
    logStructured('error', 'claude_call_error', {
      requestId,
      loopNumber,
      durationMs: Date.now() - startedAt,
      errorType: getErrorType(err),
      statusCode: err.statusCode
    });
    throw err;
  }
}

// Timeout de 3 minutos para respostas longas
app.use((req, res, next) => {
  res.setTimeout(CHAT_RESPONSE_TIMEOUT_MS);
  next();
});

// ── Conexão Supabase ──────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  statement_timeout: 60000
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
async function queryDatabase(sql, params = [], { statementTimeoutMs } = {}) {
  const client = await pool.connect();
  const useTimeout = Number.isInteger(statementTimeoutMs) && statementTimeoutMs > 0;
  try {
    if (useTimeout) {
      // Timeout específico para esta consulta. O valor é um inteiro validado,
      // então é seguro interpolar (statement_timeout não aceita bind param).
      await client.query(`SET statement_timeout TO ${statementTimeoutMs}`);
    }
    const result = await client.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  } finally {
    if (useTimeout) {
      // Reseta para o padrão da conexão antes de devolver ao pool, evitando
      // que o timeout vaze para a próxima consulta que reutilizar o socket.
      // Sem `return` aqui: um `return` no finally engoliria o resultado/erro
      // da consulta principal.
      try {
        await client.query('RESET statement_timeout');
        client.release();
      } catch (resetError) {
        // Se o reset falhar, descarta a conexão para não reaproveitar estado sujo.
        client.release(resetError);
      }
    } else {
      client.release();
    }
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
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const { messages } = req.body || {};
  const question = getLastUserQuestion(messages);
  let responseStatus = 'started';
  let responseBytes = 0;
  let toolCallCount = 0;
  let clientClosed = false;
  let responseTimedOut = false;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      logStructured('warn', 'chat_client_closed', {
        requestId,
        durationMs: Date.now() - startedAt,
        status: responseStatus
      });
    }
  });

  const sendEvent = (data) => {
    if (res.writableEnded || clientClosed) return;
    const payload = `data: ${JSON.stringify({ requestId, ...data })}\n\n`;
    responseBytes += Buffer.byteLength(payload);
    res.write(payload);
  };

  res.setTimeout(CHAT_RESPONSE_TIMEOUT_MS, () => {
    if (res.writableEnded) return;
    responseTimedOut = true;
    responseStatus = 'timeout';
    logStructured('error', 'chat_response_timeout', {
      requestId,
      status: responseStatus,
      timeoutMs: CHAT_RESPONSE_TIMEOUT_MS,
      durationMs: Date.now() - startedAt
    });
    sendEvent({ type: 'error', content: getFriendlyErrorMessage({ code: 'CLAUDE_TIMEOUT' }) });
    sendEvent({ type: 'done' });
    res.end();
  });

  logStructured('info', 'chat_request_received', {
    requestId,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    questionLength: question.length,
    questionPreview: summarizeQuestionForLog(question)
  });

  // ── HIL em modo OBSERVAÇÃO + SHADOW ─────────────────────────────────────────
  // Classifica a pergunta e SIMULA a decisão de roteamento apenas para
  // observar/logar. NÃO altera o fluxo: nada da decisão é usado para rotear. O
  // usuário recebe exatamente a mesma resposta de hoje. Envolto em try/catch
  // para nunca impactar o /api/chat.
  try {
    const hil = classify(question);
    logStructured('info', 'hil_classification', {
      requestId,
      mode: 'observe',
      intent: hil.intent,
      confidence: hil.confidence,
      complexity: hil.complexity,
      estimatedCost: hil.estimatedCost,
      estimatedLatency: hil.estimatedLatency,
      recommendedPath: hil.recommendedPath
    });

    const decision = simulateDecision(hil, question);
    logStructured('info', 'hil_shadow_decision', {
      requestId,
      intent: hil.intent,
      recommendedPath: decision.recommendedPath,
      confidence: decision.confidence,
      reason: decision.reason,
      wouldCallClaude: decision.wouldCallClaude,
      wouldUseTemplate: decision.wouldUseTemplate,
      wouldUseSemanticCache: decision.wouldUseSemanticCache,
      wouldUseResponseLibrary: decision.wouldUseResponseLibrary,
      wouldUseKnowledge: decision.wouldUseKnowledge
    });

    // Agrega a decisão nos contadores em memória (apenas rótulos, sem a pergunta).
    recordHilDecision(hil, decision);
  } catch (hilError) {
    logStructured('warn', 'hil_classification_error', {
      requestId,
      errorType: getErrorType(hilError)
    });
  }

  if (!Array.isArray(messages)) {
    responseStatus = 'bad_request';
    sendEvent({ type: 'error', content: 'Pedido inválido. Envie uma mensagem para continuar.' });
    sendEvent({ type: 'done' });
    res.end();
    logStructured('warn', 'chat_request_finish', {
      requestId,
      status: responseStatus,
      durationMs: Date.now() - startedAt,
      responseBytes
    });
    return;
  }

  const templateExecution = buildTemplateExecution(question);
  if (templateExecution) {
    logStructured('info', 'intent_detected', {
      requestId,
      intent: templateExecution.intent,
      templateName: templateExecution.templateName
    });

    const cacheKey = createCacheKey({
      templateName: templateExecution.templateName,
      templateVersion: templateExecution.templateVersion,
      params: templateExecution.params
    });
    const cacheLookup = getCacheEntry(cacheKey);

    if (cacheLookup.status === 'hit') {
      responseStatus = 'success';
      logStructured('info', 'cache_hit', {
        requestId,
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        templateVersion: templateExecution.templateVersion,
        cacheProfile: templateExecution.cacheProfile,
        cacheKey,
        ageMs: Date.now() - cacheLookup.entry.createdAt,
        ttlMs: cacheLookup.entry.ttlMs,
        rowCount: cacheLookup.entry.metadata.rowCount
      });
      sendEvent({ type: 'text', content: cacheLookup.entry.value });
      sendEvent({ type: 'done' });
      res.end();
      logStructured('info', 'chat_request_finish', {
        requestId,
        status: responseStatus,
        durationMs: Date.now() - startedAt,
        responseBytes,
        toolCallCount,
        templateName: templateExecution.templateName,
        cacheStatus: 'hit'
      });
      return;
    }

    logStructured('info', cacheLookup.status === 'expired' ? 'cache_expired' : 'cache_miss', {
      requestId,
      intent: templateExecution.intent,
      templateName: templateExecution.templateName,
      templateVersion: templateExecution.templateVersion,
      cacheProfile: templateExecution.cacheProfile,
      cacheKey
    });

    sendEvent({ type: 'querying', content: templateExecution.description });
    const templateStartedAt = Date.now();

    try {
      logStructured('info', 'sql_template_query_start', {
        requestId,
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        templateVersion: templateExecution.templateVersion,
        parameterCount: templateExecution.values.length
      });

      const result = await queryDatabase(templateExecution.sql, templateExecution.values);
      if (responseTimedOut) {
        logStructured('warn', 'chat_request_finish', {
          requestId,
          status: responseStatus,
          durationMs: Date.now() - startedAt,
          responseBytes,
          toolCallCount,
          templateName: templateExecution.templateName
        });
        return;
      }
      const text = templateExecution.format(result.rows);
      responseStatus = 'success';

      logStructured('info', 'sql_template_query_finish', {
        requestId,
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        templateVersion: templateExecution.templateVersion,
        durationMs: Date.now() - templateStartedAt,
        rowCount: result.rowCount
      });

      setCacheEntry(cacheKey, text, templateExecution.cacheTtlMs, {
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        templateVersion: templateExecution.templateVersion,
        cacheProfile: templateExecution.cacheProfile,
        rowCount: result.rowCount
      });
      logStructured('info', 'cache_write', {
        requestId,
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        templateVersion: templateExecution.templateVersion,
        cacheProfile: templateExecution.cacheProfile,
        cacheKey,
        ttlMs: templateExecution.cacheTtlMs,
        rowCount: result.rowCount
      });

      sendEvent({ type: 'text', content: text });
      logStructured('info', 'chat_response_ready', {
        requestId,
        responseTextLength: text.length,
        approximateResponseBytes: Buffer.byteLength(text),
        source: 'sql_template',
        templateName: templateExecution.templateName
      });
      if (!res.writableEnded) {
        sendEvent({ type: 'done' });
        res.end();
      }
      logStructured('info', 'chat_request_finish', {
        requestId,
        status: responseStatus,
        durationMs: Date.now() - startedAt,
        responseBytes,
        toolCallCount,
        templateName: templateExecution.templateName
      });
      return;
    } catch (err) {
      if (responseTimedOut) {
        logStructured('warn', 'chat_late_error_after_timeout', {
          requestId,
          status: responseStatus,
          durationMs: Date.now() - startedAt,
          errorType: getErrorType(err)
        });
        return;
      }
      responseStatus = getErrorType(err);
      logStructured('error', 'sql_template_query_error', {
        requestId,
        intent: templateExecution.intent,
        templateName: templateExecution.templateName,
        durationMs: Date.now() - templateStartedAt,
        errorType: getErrorType(err)
      });
      sendEvent({ type: 'error', content: 'Não consegui consultar esse relatório agora. Tente novamente em instantes.' });
      sendEvent({ type: 'done' });
      if (!res.writableEnded) res.end();
      logStructured('warn', 'chat_request_finish', {
        requestId,
        status: responseStatus,
        durationMs: Date.now() - startedAt,
        responseBytes,
        toolCallCount,
        templateName: templateExecution.templateName
      });
      return;
    }
  }

  logStructured('info', 'intent_fallback', {
    requestId,
    reason: 'no_template_match'
  });

  try {
    let currentMessages = [...messages];
    let continueLoop = true;
    let loopNumber = 0;

    while (continueLoop) {
      if (responseTimedOut) break;
      loopNumber += 1;
      if (loopNumber > MAX_TOOL_LOOPS) {
        const error = new Error('Maximum tool loop count exceeded');
        error.code = 'MAX_TOOL_LOOPS_EXCEEDED';
        throw error;
      }

      const data = await callClaude(currentMessages, requestId, loopNumber);
      if (responseTimedOut) break;

      if (data.stop_reason === 'end_turn') {
        // Resposta final — envia pro cliente
        const text = (data.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('');
        sendEvent({ type: 'text', content: text });
        responseStatus = 'success';
        logStructured('info', 'chat_response_ready', {
          requestId,
          responseTextLength: text.length,
          approximateResponseBytes: Buffer.byteLength(text)
        });
        continueLoop = false;

      } else if (data.stop_reason === 'tool_use') {
        // Agente quer consultar o banco
        const toolUseBlock = (data.content || []).find(b => b.type === 'tool_use');

        if (toolUseBlock && toolUseBlock.name === 'query_database') {
          toolCallCount += 1;
          const { sql, descricao } = toolUseBlock.input;
          sendEvent({ type: 'querying', content: descricao });

          // ── Guardrail: valida o SQL livre gerado pela IA antes de executar ──
          const guardrailStartedAt = Date.now();
          const guardrail = validateSql(sql);
          if (!guardrail.ok) {
            logStructured('warn', 'sql_guardrail_block', {
              requestId,
              toolCallCount,
              reason: guardrail.reason,
              detail: guardrail.detail,
              durationMs: Date.now() - guardrailStartedAt,
              sqlLength: typeof sql === 'string' ? sql.length : 0
            });
            // Devolve mensagem amigável como resultado da tool para o Claude
            // relatar ao usuário; o fluxo de fallback continua com segurança.
            currentMessages = [
              ...currentMessages,
              { role: 'assistant', content: data.content },
              {
                role: 'user',
                content: [{
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: JSON.stringify({
                    success: false,
                    blocked: true,
                    message: guardrail.message
                  })
                }]
              }
            ];
            continue;
          }
          logStructured('info', 'sql_guardrail_pass', {
            requestId,
            toolCallCount,
            appliedLimit: guardrail.appliedLimit,
            durationMs: Date.now() - guardrailStartedAt
          });
          const safeSql = guardrail.sql;

          const sqlStartedAt = Date.now();
          logStructured('info', 'database_query_start', {
            requestId,
            toolCallCount,
            description: redactSensitive(descricao || ''),
            sqlLength: safeSql.length
          });

          let toolResult;
          try {
            const result = await queryDatabase(safeSql, [], { statementTimeoutMs: QUERY_TIMEOUT_MS });
            logStructured('info', 'database_query_finish', {
              requestId,
              toolCallCount,
              durationMs: Date.now() - sqlStartedAt,
              rowCount: result.rowCount
            });
            toolResult = JSON.stringify({
              success: true,
              rowCount: result.rowCount,
              rows: result.rows
            });
          } catch (err) {
            logStructured('error', 'database_query_error', {
              requestId,
              toolCallCount,
              durationMs: Date.now() - sqlStartedAt,
              errorType: getErrorType(err)
            });
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
          responseStatus = 'unsupported_tool';
          continueLoop = false;
        }
      } else {
        responseStatus = `stopped_${data.stop_reason || 'unknown'}`;
        continueLoop = false;
      }
    }

    if (!res.writableEnded) {
      sendEvent({ type: 'done' });
      res.end();
    }

  } catch (err) {
    if (responseTimedOut) {
      logStructured('warn', 'chat_late_error_after_timeout', {
        requestId,
        status: responseStatus,
        durationMs: Date.now() - startedAt,
        errorType: getErrorType(err)
      });
    } else {
      responseStatus = getErrorType(err);
      logStructured('error', 'chat_request_error', {
        requestId,
        status: responseStatus,
        durationMs: Date.now() - startedAt,
        errorType: getErrorType(err)
      });
      sendEvent({ type: 'error', content: getFriendlyErrorMessage(err) });
      sendEvent({ type: 'done' });
      if (!res.writableEnded) res.end();
    }
  } finally {
    logStructured(responseStatus === 'success' ? 'info' : 'warn', 'chat_request_finish', {
      requestId,
      status: responseStatus,
      durationMs: Date.now() - startedAt,
      responseBytes,
      toolCallCount
    });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Endpoints administrativos (protegidos por ADMIN_SECRET) ───────────────────
// Permitem validar saúde, templates e rodar a validação sem depender do Console
// do Railway. Nunca expõem segredos (DATABASE_URL, ANTHROPIC_API_KEY), SQL
// completo ou resultado real das queries.
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Autoriza a requisição admin. Se ADMIN_SECRET não existir, os endpoints ficam
// desabilitados (503). Segredo ausente/errado retorna 401. Envie o segredo no
// header `x-admin-secret`.
function ensureAdmin(req, res) {
  req.adminRequestId = crypto.randomUUID();
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: 'Endpoints administrativos desabilitados. Defina ADMIN_SECRET para habilitar.' });
    return false;
  }
  const provided = req.get('x-admin-secret') || '';
  if (!timingSafeEqualStr(provided, ADMIN_SECRET)) {
    logStructured('warn', 'admin_auth_failed', {
      requestId: req.adminRequestId,
      route: req.path,
      reason: provided ? 'invalid_secret' : 'missing_secret'
    });
    res.status(401).json({ error: 'Não autorizado.' });
    return false;
  }
  return true;
}

app.get('/admin/health', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  logStructured('info', 'admin_health_check', { requestId: req.adminRequestId });
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    templateCount: Object.keys(templates).length,
    // Apenas presença (booleano) — nunca os valores dos segredos.
    config: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      claudeTimeoutMs: CLAUDE_API_TIMEOUT_MS,
      chatResponseTimeoutMs: CHAT_RESPONSE_TIMEOUT_MS,
      maxToolLoops: MAX_TOOL_LOOPS
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/admin/templates', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  // Metadados dos templates — sem o SQL, para não expor consultas completas.
  const list = Object.values(templates).map(template => ({
    name: template.name,
    version: template.version,
    cacheProfile: template.cacheProfile,
    cacheTtlMs: template.cacheTtlMs,
    description: template.description
  }));
  res.json({ count: list.length, templates: list });
});

app.get('/admin/hil/metrics', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  logStructured('info', 'admin_hil_metrics', { requestId: req.adminRequestId });
  // Apenas contadores agregados da HIL em shadow mode — nunca perguntas reais.
  res.json(hilMetricsSnapshot());
});

app.get('/admin/hil/report', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  logStructured('info', 'admin_hil_report', { requestId: req.adminRequestId });
  // Relatório derivado dos contadores agregados — sem perguntas reais.
  res.json(buildDecisionReport(hilMetricsSnapshot()));
});

app.post('/admin/validate/templates', async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const requestId = req.adminRequestId;
  const startedAt = Date.now();
  logStructured('info', 'admin_template_validation_start', { requestId });
  try {
    const results = await validateAllTemplates(pool);
    const okCount = results.filter(result => result.status === 'OK').length;
    logStructured('info', 'admin_template_validation_finish', {
      requestId,
      durationMs: Date.now() - startedAt,
      total: results.length,
      okCount,
      errorCount: results.length - okCount
    });
    // results contém apenas metadados (template, status, rowCount, durationMs,
    // erro redigido) — nunca linhas/valores do banco.
    res.json({ total: results.length, okCount, errorCount: results.length - okCount, results });
  } catch (err) {
    logStructured('error', 'admin_template_validation_error', {
      requestId,
      durationMs: Date.now() - startedAt,
      errorType: getErrorType(err)
    });
    res.status(500).json({ error: 'Falha ao validar templates.' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Agente Grupo Erick rodando na porta ${PORT}`));

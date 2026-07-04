'use strict';

// ── Hermes Core — API (gateway/orquestrador) ─────────────────────────────────
//
// Serviço inicial do Hermes Core. Nesta etapa é propositalmente MÍNIMO: expõe
// health/readiness e um endpoint de identidade, sem acoplar nenhuma ferramenta
// específica (Supabase, Redis, Qdrant, MCP) ao núcleo. As integrações entram
// por adaptadores desacoplados nas próximas etapas.
//
// Sem dependências npm de propósito (usa apenas o `http` nativo): o container
// sobe rápido e sem instalação de rede.

const http = require('http');
const { randomUUID } = require('crypto');
const { classifyIntent } = require('./core/intent-router');

const SERVICE = 'hermes-api';
const VERSION = process.env.HERMES_VERSION || '2.0.0-scaffold';
const PORT = Number(process.env.API_PORT || process.env.PORT || 8080);
const MAX_MESSAGE_BODY_BYTES = 1_000_000;

// Presença de configuração — apenas booleanos, nunca os valores/segredos.
function configPresence() {
  return {
    database: Boolean(process.env.DATABASE_URL),
    redis: Boolean(process.env.REDIS_URL),
    qdrant: Boolean(process.env.QDRANT_URL),
    mcpGateway: Boolean(process.env.MCP_GATEWAY_URL)
  };
}

function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

// Lê e faz parse do corpo JSON, com limite de tamanho para evitar payloads
// não controlados. Corpo vazio resolve como `{}`.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_MESSAGE_BODY_BYTES) {
        req.destroy();
        reject(new Error('payload_too_large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function createServer() {
  return http.createServer((req, res) => {
    const { method } = req;
    const url = (req.url || '/').split('?')[0];

    if (method === 'GET' && url === '/health') {
      return sendJson(res, 200, { status: 'ok', service: SERVICE, version: VERSION });
    }

    // Readiness reporta a presença das dependências configuradas (não conecta).
    if (method === 'GET' && url === '/ready') {
      return sendJson(res, 200, { status: 'ready', service: SERVICE, config: configPresence() });
    }

    // Recebe uma mensagem e classifica a intenção (marketing/desenvolvimento/
    // desconhecido). Sem acoplamento a runtime de agente ainda — apenas o
    // roteador de intenção.
    if (method === 'POST' && url === '/message') {
      return readJsonBody(req)
        .then((body) => {
          const traceId = (typeof body.trace_id === 'string' && body.trace_id.trim()) || randomUUID();
          const message = body.message;

          if (typeof message !== 'string' || message.trim() === '') {
            console.log(JSON.stringify({ level: 'warn', event: 'message_invalid', trace_id: traceId }));
            return sendJson(res, 400, { error: 'invalid_request', message: "'message' é obrigatório" });
          }

          const intent = classifyIntent(message);
          console.log(JSON.stringify({
            level: 'info',
            event: 'message_received',
            trace_id: traceId,
            intent,
            message_length: message.length
          }));

          return sendJson(res, 200, { trace_id: traceId, intent, service: SERVICE, version: VERSION });
        })
        .catch(() => {
          console.log(JSON.stringify({ level: 'warn', event: 'message_invalid', trace_id: randomUUID() }));
          return sendJson(res, 400, { error: 'invalid_request', message: 'corpo JSON inválido' });
        });
    }

    if (method === 'GET' && url === '/') {
      return sendJson(res, 200, {
        service: SERVICE,
        version: VERSION,
        role: 'Hermes Core — orquestrador principal',
        docs: 'platform/docs/HERMES_AI_PLATFORM_V2_BLUEPRINT.md'
      });
    }

    return sendJson(res, 404, { error: 'not_found' });
  });
}

// Só sobe o listener quando executado diretamente (`node src/index.js`), não
// quando `createServer` é importado por testes.
if (require.main === module) {
  const server = createServer();

  server.listen(PORT, () => {
    // Log estruturado simples (JSON) para facilitar observabilidade futura.
    console.log(JSON.stringify({ level: 'info', event: 'api_started', service: SERVICE, version: VERSION, port: PORT }));
  });

  // Encerramento gracioso (Railway/Docker enviam SIGTERM).
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(JSON.stringify({ level: 'info', event: 'api_shutdown', signal }));
      server.close(() => process.exit(0));
    });
  }
}

module.exports = { createServer };

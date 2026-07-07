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
const { getCapability } = require('./capabilities/registry');
const { evaluateConfirmationGate } = require('./core/confirmation-gate');
const { classifyConfirmationResponse } = require('./core/confirmation-response');
const { planAdapterExecution } = require('./core/adapter-execution');
const {
  createPendingConfirmation: storePendingConfirmation,
  getPendingConfirmation,
  resolvePendingConfirmation
} = require('./core/confirmation-store');
const { classifyIntent } = require('./core/intent-router');
const { createPendingConfirmation: createPublicPendingConfirmation } = require('./core/pending-confirmation');

const SERVICE = 'hermes-api';
const VERSION = process.env.HERMES_VERSION || '2.0.0-scaffold';
const PORT = Number(process.env.API_PORT || process.env.PORT || 8080);
const MAX_MESSAGE_BODY_BYTES = 1_000_000;
const FALLBACK_CAPABILITY = {
  status: 'planned',
  publicMessage: 'Nao encontrei uma capacidade especifica para essa mensagem; nenhuma acao foi executada.',
  requiredAdapters: []
};
const CONFIRMATION_RESPONSE_MESSAGES = {
  approved: 'Confirmacao recebida; execucao real ainda nao esta habilitada.',
  rejected: 'Acao cancelada pelo usuario; nenhuma execucao foi realizada.',
  unknown: 'Resposta recebida, mas preciso de uma resposta clara como sim ou nao.'
};
const CONFIRMATION_STATUS_MESSAGES = {
  pending: 'Confirmacao pendente; nenhuma execucao foi realizada.',
  approved: 'Confirmacao aprovada; execucao real ainda nao esta habilitada.',
  rejected: 'Confirmacao rejeitada; nenhuma execucao foi realizada.',
  expired: 'Confirmacao expirada; nenhuma execucao foi realizada.',
  not_found: 'Confirmacao nao encontrada; nenhuma execucao foi realizada.'
};

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

function getConfirmationIdFromUrl(url) {
  const match = url.match(/^\/confirm\/([^/]+)$/);
  return match ? match[1] : null;
}

function buildConfirmationStatusResponse(confirmationId, confirmation) {
  if (!confirmation) {
    return {
      confirmation_id: confirmationId,
      status: 'not_found',
      executed: false,
      message: CONFIRMATION_STATUS_MESSAGES.not_found
    };
  }

  const response = {
    confirmation_id: confirmation.confirmation_id,
    status: confirmation.status,
    executed: false,
    message: CONFIRMATION_STATUS_MESSAGES[confirmation.status] || CONFIRMATION_STATUS_MESSAGES.not_found,
    domain: confirmation.domain,
    intent: confirmation.intent,
    expires_at: confirmation.expires_at
  };

  return response;
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

    // Recebe uma mensagem e classifica domínio + intenção. Sem acoplamento a
    // runtime de agente ainda — apenas o roteador de intenção; por isso o
    // status da resposta é sempre "planned" (execução real entra depois).
    if (method === 'POST' && url === '/message') {
      return readJsonBody(req)
        .then((body) => {
          const traceId = (typeof body.trace_id === 'string' && body.trace_id.trim()) || randomUUID();
          const message = body.message;

          if (typeof message !== 'string' || message.trim() === '') {
            console.log(JSON.stringify({ level: 'warn', event: 'message_invalid', trace_id: traceId }));
            return sendJson(res, 400, { error: 'invalid_request', message: "'message' é obrigatório" });
          }

          const { domain, intent } = classifyIntent(message);
          const capability = getCapability(domain) || FALLBACK_CAPABILITY;
          const confirmationGate = evaluateConfirmationGate({ domain, capability });
          const confirmation = confirmationGate.confirmationRequired
            ? createPublicPendingConfirmation({ traceId, randomId: randomUUID() })
            : null;
          console.log(JSON.stringify({
            level: 'info',
            event: 'message_received',
            trace_id: traceId,
            domain,
            intent,
            message_length: message.length
          }));
          console.log(JSON.stringify({
            level: 'info',
            event: 'capability_planned',
            trace_id: traceId,
            domain,
            intent,
            status: capability.status,
            required_adapters_count: capability.requiredAdapters.length
          }));
          console.log(JSON.stringify({
            level: 'info',
            event: 'confirmation_gate_evaluated',
            trace_id: traceId,
            domain,
            intent,
            confirmation_required: confirmationGate.confirmationRequired
          }));
          if (confirmation) {
            const storedConfirmation = storePendingConfirmation({
              confirmation_id: confirmation.id,
              trace_id: traceId,
              domain,
              intent,
              expires_in_seconds: confirmation.expires_in_seconds
            });
            console.log(JSON.stringify({
              level: 'info',
              event: 'confirmation_created',
              trace_id: traceId,
              domain,
              intent,
              confirmation_id: confirmation.id,
              expires_in_seconds: confirmation.expires_in_seconds
            }));
            console.log(JSON.stringify({
              level: 'info',
              event: 'confirmation_store_created',
              trace_id: traceId,
              domain,
              intent,
              confirmation_id: confirmation.id,
              expires_at: storedConfirmation.expires_at
            }));
          }

          const responseBody = {
            trace_id: traceId,
            domain,
            intent,
            status: capability.status,
            message: capability.publicMessage,
            confirmation_required: confirmationGate.confirmationRequired
          };
          if (confirmation) responseBody.confirmation = confirmation;

          return sendJson(res, 200, responseBody);
        })
        .catch(() => {
          console.log(JSON.stringify({ level: 'warn', event: 'message_invalid', trace_id: randomUUID() }));
          return sendJson(res, 400, { error: 'invalid_request', message: 'corpo JSON inválido' });
        });
    }

    if (method === 'POST' && url === '/confirm') {
      return readJsonBody(req)
        .then((body) => {
          const confirmationId = typeof body.confirmation_id === 'string' ? body.confirmation_id.trim() : body.confirmation_id;
          const message = body.message;

          if (typeof confirmationId !== 'string' || confirmationId.trim() === '') {
            console.log(JSON.stringify({ level: 'warn', event: 'confirmation_response_invalid' }));
            return sendJson(res, 400, { error: 'invalid_request', message: "'confirmation_id' e obrigatorio" });
          }

          const decision = classifyConfirmationResponse(message);
          const messageLength = typeof message === 'string' ? message.length : 0;
          const storedConfirmation = getPendingConfirmation(confirmationId);
          console.log(JSON.stringify({
            level: 'info',
            event: 'confirmation_response_received',
            confirmation_id: confirmationId,
            decision,
            message_length: messageLength
          }));

          if (!storedConfirmation) {
            console.log(JSON.stringify({
              level: 'info',
              event: 'confirmation_store_miss',
              confirmation_id: confirmationId
            }));
            return sendJson(res, 200, {
              confirmation_id: confirmationId,
              decision,
              status: 'not_found',
              confirmation_status: 'not_found',
              execution_status: 'not_requested',
              executed: false,
              message: 'Confirmacao nao encontrada ou expirada; nenhuma execucao foi realizada.'
            });
          }

          if (storedConfirmation.status === 'expired') {
            console.log(JSON.stringify({
              level: 'info',
              event: 'confirmation_store_miss',
              confirmation_id: confirmationId
            }));
            return sendJson(res, 200, {
              confirmation_id: confirmationId,
              decision,
              status: 'expired',
              confirmation_status: 'expired',
              execution_status: 'not_requested',
              executed: false,
              message: 'Confirmacao expirada; nenhuma execucao foi realizada.'
            });
          }

          const resolvedConfirmation = resolvePendingConfirmation(confirmationId, decision);
          const capability = getCapability(resolvedConfirmation.domain) || FALLBACK_CAPABILITY;
          let executionStatus = 'not_requested';
          let executionPolicy = null;
          let simulated = false;
          let adapterId = null;
          let adapterMode = null;

          if (decision === 'approved') {
            const executionPlan = planAdapterExecution({
              confirmation: resolvedConfirmation,
              decision,
              capability
            });

            executionStatus = executionPlan.execution_status;
            executionPolicy = executionPlan.execution_policy;
            simulated = executionPlan.simulated;
            adapterId = executionPlan.adapter_id;
            adapterMode = executionPlan.adapter_mode;
            const policyEvaluation = executionPlan.execution_policy_evaluation;
            console.log(JSON.stringify({
              level: 'info',
              event: 'execution_policy_evaluated',
              execution_enabled: policyEvaluation.execution_enabled,
              kill_switch_active: policyEvaluation.kill_switch_active,
              reason: policyEvaluation.reason
            }));
            if (executionPlan.mock_adapter && executionPlan.mock_adapter.status === 'simulated') {
              console.log(JSON.stringify({
                level: 'info',
                event: 'domain_mock_adapter_selected',
                confirmation_id: confirmationId,
                domain: resolvedConfirmation.domain,
                adapter_id: executionPlan.mock_adapter.adapter_id,
                adapter_mode: executionPlan.mock_adapter.adapter_mode
              }));
              console.log(JSON.stringify({
                level: 'info',
                event: 'mock_adapter_simulated',
                confirmation_id: confirmationId,
                domain: resolvedConfirmation.domain,
                intent: resolvedConfirmation.intent,
                adapter_mode: executionPlan.mock_adapter.adapter_mode,
                simulated: executionPlan.mock_adapter.simulated,
                executed: executionPlan.mock_adapter.executed
              }));
            } else if (executionPlan.mock_adapter && executionPlan.mock_adapter.status === 'not_available') {
              console.log(JSON.stringify({
                level: 'info',
                event: 'domain_mock_adapter_missing',
                confirmation_id: confirmationId,
                domain: resolvedConfirmation.domain
              }));
            }
            console.log(JSON.stringify({
              level: 'info',
              event: 'adapter_execution_planned',
              confirmation_id: confirmationId,
              decision,
              execution_allowed: executionPlan.execution_allowed,
              executed: executionPlan.executed,
              reason: executionPlan.reason,
              required_adapters_count: executionPlan.required_adapters_count,
              execution_status: executionPlan.execution_status,
              simulated: executionPlan.simulated,
              ...(executionPlan.adapter_id ? { adapter_id: executionPlan.adapter_id } : {}),
              ...(executionPlan.adapter_mode ? { adapter_mode: executionPlan.adapter_mode } : {})
            }));
          }

          console.log(JSON.stringify({
            level: 'info',
            event: 'confirmation_store_resolved',
            confirmation_id: confirmationId,
            decision,
            confirmation_status: resolvedConfirmation.status
          }));

          return sendJson(res, 200, {
            confirmation_id: confirmationId,
            decision,
            status: 'received',
            confirmation_status: resolvedConfirmation.status,
            execution_status: executionStatus,
            ...(executionPolicy ? { execution_policy: executionPolicy } : {}),
            ...(simulated ? { simulated: true } : {}),
            ...(adapterId ? { adapter_id: adapterId } : {}),
            ...(adapterMode ? { adapter_mode: adapterMode } : {}),
            executed: false,
            message: CONFIRMATION_RESPONSE_MESSAGES[decision]
          });
        })
        .catch(() => {
          console.log(JSON.stringify({ level: 'warn', event: 'confirmation_response_invalid' }));
          return sendJson(res, 400, { error: 'invalid_request', message: 'corpo JSON invalido' });
        });
    }

    if (method === 'GET') {
      const confirmationId = getConfirmationIdFromUrl(url);
      if (confirmationId) {
        const confirmation = getPendingConfirmation(confirmationId);
        const confirmationStatus = confirmation ? confirmation.status : 'not_found';

        console.log(JSON.stringify({
          level: 'info',
          event: 'confirmation_status_checked',
          confirmation_id: confirmationId,
          confirmation_status: confirmationStatus
        }));

        return sendJson(res, 200, buildConfirmationStatusResponse(confirmationId, confirmation));
      }
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

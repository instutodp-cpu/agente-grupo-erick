'use strict';

// ── Hermes Core — Worker (jobs/filas) ────────────────────────────────────────
//
// Serviço inicial de background do Hermes. Nesta etapa é MÍNIMO: emite um
// heartbeat e faz uma checagem de readiness (TCP) das dependências, sem acoplar
// bibliotecas específicas de fila/DB ao núcleo. O consumo real de filas (Redis)
// entra em etapas seguintes por adaptadores desacoplados.
//
// Sem dependências npm (usa `net`/`url` nativos).

const net = require('net');
const { URL } = require('url');

const SERVICE = 'hermes-worker';
const VERSION = process.env.HERMES_VERSION || '2.0.0-scaffold';
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS || 15000);

function log(event, fields = {}) {
  console.log(JSON.stringify({ level: 'info', event, service: SERVICE, ...fields }));
}

// Checa se um host:porta aceita conexão TCP (readiness leve, sem autenticar).
function checkTcp(name, rawUrl, defaultPort) {
  return new Promise(resolve => {
    if (!rawUrl) return resolve({ name, configured: false, ready: false });
    let host;
    let port;
    try {
      const u = new URL(rawUrl);
      host = u.hostname;
      port = Number(u.port || defaultPort);
    } catch (_) {
      return resolve({ name, configured: true, ready: false, error: 'invalid_url' });
    }
    const socket = net.createConnection({ host, port });
    const done = (ready, error) => {
      socket.destroy();
      resolve({ name, configured: true, ready, ...(error ? { error } : {}) });
    };
    socket.setTimeout(2000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false, 'timeout'));
    socket.once('error', err => done(false, err.code || 'error'));
  });
}

async function readiness() {
  const results = await Promise.all([
    checkTcp('postgres', process.env.DATABASE_URL, 5432),
    checkTcp('redis', process.env.REDIS_URL, 6379),
    checkTcp('qdrant', process.env.QDRANT_URL, 6333)
  ]);
  return results.reduce((acc, r) => ({ ...acc, [r.name]: r }), {});
}

let ticks = 0;

async function heartbeat() {
  ticks += 1;
  const deps = await readiness();
  log('worker_heartbeat', { tick: ticks, deps });
}

log('worker_started', { version: VERSION, heartbeatMs: HEARTBEAT_MS });
heartbeat();
const timer = setInterval(heartbeat, HEARTBEAT_MS);

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log('worker_shutdown', { signal });
    clearInterval(timer);
    process.exit(0);
  });
}

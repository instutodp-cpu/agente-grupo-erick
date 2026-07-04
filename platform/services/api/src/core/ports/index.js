'use strict';

// Contratos (ports) previstos na SPEC §5. Cada port é uma interface mínima —
// os métodos lançam "not_implemented" até que um adapter real seja injetado
// na composition root. Nenhuma conexão externa (Postgres/Supabase, Redis,
// Qdrant, MCP, provedor de modelo) acontece aqui.

class DataStore {
  async query(_sql, _params) { throw new Error('not_implemented'); }
  async transaction(_fn) { throw new Error('not_implemented'); }
}

class Queue {
  async enqueue(_job) { throw new Error('not_implemented'); }
  async consume(_handler) { throw new Error('not_implemented'); }
}

class SessionStore {
  async get(_sessionId) { throw new Error('not_implemented'); }
  async set(_sessionId, _data, _ttlSeconds) { throw new Error('not_implemented'); }
}

class VectorMemory {
  async upsert(_vectors) { throw new Error('not_implemented'); }
  async search(_query, _topK) { throw new Error('not_implemented'); }
}

class McpGateway {
  async listTools() { throw new Error('not_implemented'); }
  async callTool(_name, _args) { throw new Error('not_implemented'); }
}

class AgentRuntime {
  async run(_task, _context) { throw new Error('not_implemented'); }
}

class ModelProvider {
  async generate(_prompt, _options) { throw new Error('not_implemented'); }
  async embed(_text) { throw new Error('not_implemented'); }
}

module.exports = {
  DataStore,
  Queue,
  SessionStore,
  VectorMemory,
  McpGateway,
  AgentRuntime,
  ModelProvider
};

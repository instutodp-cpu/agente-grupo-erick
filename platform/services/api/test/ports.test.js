'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ports = require('../src/core/ports');

const PORT_METHODS = {
  DataStore: ['query', 'transaction'],
  Queue: ['enqueue', 'consume'],
  SessionStore: ['get', 'set'],
  VectorMemory: ['upsert', 'search'],
  McpGateway: ['listTools', 'callTool'],
  AgentRuntime: ['run'],
  ModelProvider: ['generate', 'embed']
};

for (const [portName, methods] of Object.entries(PORT_METHODS)) {
  test(`${portName} lança not_implemented em todos os métodos`, async () => {
    const Port = ports[portName];
    assert.ok(Port, `port "${portName}" não exportado`);
    const instance = new Port();

    for (const method of methods) {
      await assert.rejects(() => instance[method](), /not_implemented/);
    }
  });
}

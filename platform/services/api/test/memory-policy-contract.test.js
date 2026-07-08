const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const docPath = path.resolve(__dirname, "../../../docs/MEMORY_POLICY.md");
const fixturePath = path.resolve(__dirname, "fixtures/hermes-memory-policy.json");

test("memory policy document and fixture exist", () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test("memory policy document describes the required safety contract", () => {
  const doc = fs.readFileSync(docPath, "utf8");

  for (const phrase of [
    "Session Memory",
    "User / Peer Memory",
    "Domain / Company Memory",
    "Audit / Learning Memory",
    "executed:false",
    "mock-first",
    "human review",
    "LGPD",
    "Skill Candidate Registry",
  ]) {
    assert.match(doc, new RegExp(phrase, "i"));
  }
});

test("memory policy fixture is safe and contractually complete", () => {
  const policy = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  assert.deepEqual(
    policy.allowed_scopes,
    ["session", "user_peer", "domain_company", "audit_learning"],
  );

  const layerIds = new Set(policy.memory_layers.map((layer) => layer.id));
  assert.deepEqual(layerIds, new Set(["session", "user_peer", "domain_company", "audit_learning"]));

  for (const layer of policy.memory_layers) {
    assert.equal(layer.can_trigger_real_execution, false);
  }

  for (const [domain, threshold] of Object.entries(policy.domain_thresholds)) {
    assert.ok(threshold >= 0.5 && threshold <= 0.9, `${domain} threshold out of range`);
  }

  assert.ok(policy.domain_thresholds.compras >= 0.8);
  assert.ok(policy.domain_thresholds.financeiro >= 0.9);

  assert.equal(policy.default_rules.executed, false);
  assert.equal(policy.default_rules.real_execution_allowed, false);
  assert.equal(policy.default_rules.human_review_required, true);

  for (const field of [
    "token",
    "secret",
    "env",
    "headers",
    "cookies",
    "credentials",
    "payload",
    "rawMessage",
    "userMessage",
    "requiredAdapters",
  ]) {
    assert.ok(policy.forbidden_fields.includes(field), field);
  }
});

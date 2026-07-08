const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const docPath = path.resolve(__dirname, "../../../docs/USER_PEER_MEMORY_SCOPES.md");
const fixturePath = path.resolve(__dirname, "fixtures/hermes-user-peer-memory-scopes.json");
const allowedDomains = new Set(["compras", "financeiro", "treinamento", "marketing", "desenvolvimento"]);
const requiredScopes = new Set([
  "personal_user",
  "owner_director",
  "finance_user",
  "manager_user",
  "buyer_user",
  "collaborator_user",
  "external_client_user",
]);

test("user peer memory scopes document and fixture exist", () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test("user peer memory scopes document describes the required safety contract", () => {
  const doc = fs.readFileSync(docPath, "utf8");

  for (const phrase of [
    "User / Peer Memory",
    "personal_user",
    "owner_director",
    "finance_user",
    "manager_user",
    "buyer_user",
    "collaborator_user",
    "external_client_user",
    "Permission Matrix",
    "Skill Candidate Registry",
    "executed:false",
    "confirmation humana",
  ]) {
    assert.match(doc, new RegExp(phrase, "i"));
  }
});

test("user peer memory scopes fixture is safe and contractually complete", () => {
  const policy = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const scopeIds = new Set(policy.scopes.map((scope) => scope.id));

  assert.deepEqual(scopeIds, requiredScopes);

  for (const scope of policy.scopes) {
    assert.ok(scope.id, "scope id missing");
    assert.ok(Array.isArray(scope.allowed_domains), `${scope.id} allowed_domains missing`);
    assert.equal(scope.can_trigger_real_execution, false, `${scope.id} real execution enabled`);
    for (const domain of scope.allowed_domains) {
      assert.ok(allowedDomains.has(domain), `${scope.id} domain not allowed: ${domain}`);
    }
  }

  assert.deepEqual(policy.default_rules, {
    executed: false,
    real_execution_allowed: false,
    human_review_required: true,
    mock_first: true,
    cross_user_leakage_allowed: false,
    cross_tenant_leakage_allowed: false,
  });

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
    "authorization",
    "password",
  ]) {
    assert.ok(policy.forbidden_fields.includes(field), field);
  }
});

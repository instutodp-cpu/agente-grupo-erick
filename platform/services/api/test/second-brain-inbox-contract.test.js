const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const docPath = path.resolve(__dirname, "../../../docs/SECOND_BRAIN_INBOX_CONTRACT.md");
const fixturePath = path.resolve(__dirname, "fixtures/hermes-second-brain-inbox-contract.json");
const requiredSourceTypes = new Set([
  "user_note",
  "meeting_transcript",
  "document_summary",
  "support_ticket",
  "operational_report",
  "audit_event",
  "skill_candidate_signal",
  "domain_context_update",
  "external_source_summary",
]);

test("second brain inbox document and fixture exist", () => {
  assert.equal(fs.existsSync(docPath), true);
  assert.equal(fs.existsSync(fixturePath), true);
});

test("second brain inbox document describes the required safety contract", () => {
  const doc = fs.readFileSync(docPath, "utf8");

  for (const phrase of [
    "Second Brain Inbox",
    "user_note",
    "meeting_transcript",
    "document_summary",
    "support_ticket",
    "operational_report",
    "audit_event",
    "skill_candidate_signal",
    "domain_context_update",
    "external_source_summary",
    "Permission Matrix",
    "Skill Candidate Registry",
    "Memory Policy",
    "User / Peer Memory Scopes",
    "executed:true",
  ]) {
    assert.match(doc, new RegExp(phrase, "i"));
  }
});

test("second brain inbox fixture is safe and contractually complete", () => {
  const inbox = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const sourceTypeIds = new Set(inbox.source_types.map((sourceType) => sourceType.id));

  assert.deepEqual(sourceTypeIds, requiredSourceTypes);
  assert.ok(Array.isArray(inbox.allowed_statuses));
  assert.ok(Array.isArray(inbox.forbidden_statuses));
  assert.ok(Array.isArray(inbox.required_fields));
  assert.ok(Array.isArray(inbox.forbidden_fields));

  for (const sourceType of inbox.source_types) {
    assert.equal(sourceType.can_trigger_real_execution, false, `${sourceType.id} can_trigger_real_execution`);
  }

  assert.equal(inbox.default_rules.executed, false);
  assert.equal(inbox.default_rules.real_execution_allowed, false);
  assert.equal(inbox.default_rules.storage_implemented, false);
  assert.equal(inbox.default_rules.rag_implemented, false);
  assert.equal(inbox.default_rules.vector_database_implemented, false);
  assert.equal(inbox.default_rules.cross_user_leakage_allowed, false);
  assert.equal(inbox.default_rules.cross_tenant_leakage_allowed, false);

  assert.ok(!inbox.allowed_statuses.includes("executed"));
  for (const status of ["executed", "active_real", "production_autonomous", "adapter_executed", "memory_written_real"]) {
    assert.ok(inbox.forbidden_statuses.includes(status), status);
  }

  for (const field of [
    "token",
    "secret",
    "env",
    "headers",
    "cookies",
    "credentials",
    "payload",
    "rawPayload",
    "rawMessage",
    "userMessage",
    "requiredAdapters",
    "authorization",
    "password",
  ]) {
    assert.ok(inbox.forbidden_fields.includes(field), field);
  }
});

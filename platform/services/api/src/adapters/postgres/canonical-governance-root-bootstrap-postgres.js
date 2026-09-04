'use strict';

const { stablePayload, cloneFrozen } = require('../../core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../../core/canonical-content-digest');
const {
  CONTRACT_NAME,
  buildBootstrapArtifact,
  buildReceipt,
  computeAttestationDigest,
  canonicalDigest,
  installationIdentityDigest,
  rootSpecDigest,
  validateBootstrapRequest,
  validateRootKey
} = require('../../core/canonical-governance-root-bootstrap-contract');

const DEFAULT_TABLES = Object.freeze({
  guard: 'hermes.installation_bootstrap_guard',
  installations: 'hermes.installations',
  bootstraps: 'hermes.installation_bootstraps',
  roots: 'hermes.governance_root_subjects',
  keys: 'hermes.governance_root_keys',
  audit: 'hermes.governance_audit_events'
});
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const TABLE_KEYS = Object.freeze(Object.keys(DEFAULT_TABLES));

function validTableName(value) {
  const parts = typeof value === 'string' ? value.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function tablesWithOverrides(overrides = {}) {
  const tables = { ...DEFAULT_TABLES, ...overrides };
  if (TABLE_KEYS.some((key) => !validTableName(tables[key]))) throw new TypeError('governance_postgres_table_name_invalid');
  return Object.freeze(tables);
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('governance_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function iso(value) {
  return value instanceof Date ? value.toISOString() : value;
}

function signedAuthorizationPayload(authorization) {
  const copy = { ...authorization };
  delete copy.signature;
  delete copy.attestation_digest;
  return stablePayload(copy);
}

function rootTransitionPayload(input, action) {
  const authorization = input.authorization || {};
  const material = {
    action,
    installation_id: input.installation_id,
    root_subject_id: input.root_subject_id,
    expected_generation: input.expected_generation,
    expected_root_digest: input.expected_root_digest,
    ...(input.new_key ? { new_key: input.new_key } : {}),
    authorization_id: authorization.authorization_id,
    actor_subject: authorization.actor_subject,
    actor_key_id: authorization.actor_key_id
  };
  return stablePayload(material);
}

function validateRootTransition(input, action) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['root_transition_must_be_object'];
  for (const field of ['installation_id', 'root_subject_id', 'expected_root_digest', 'authorization']) {
    if (!input[field]) errors.push(`root_transition_${field}_required`);
  }
  if (!Number.isInteger(input.expected_generation) || input.expected_generation < 0) errors.push('root_transition_generation_invalid');
  if (!/^(sha256:)[0-9a-f]{64}$/.test(input.expected_root_digest || '')) errors.push('root_transition_root_digest_invalid');
  const authorization = input.authorization;
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) errors.push('root_transition_authorization_invalid');
  else {
    for (const field of ['authorization_id', 'actor_subject', 'actor_key_id', 'signature', 'signature_digest']) {
      if (typeof authorization[field] !== 'string' || authorization[field].trim() === '') errors.push(`root_transition_authorization_${field}_invalid`);
    }
    if (authorization.action !== action) errors.push('root_transition_authorization_action_invalid');
    if (!/^[A-Za-z0-9_-]+$/.test(authorization.signature || '')) errors.push('root_transition_signature_invalid');
    if (authorization.signature_digest !== canonicalDigest(JSON.parse(rootTransitionPayload(input, action)))) errors.push('root_transition_signature_digest_invalid');
  }
  if (action === 'GOVERNANCE_ROOT_ROTATION') {
    if (!input.new_key) errors.push('root_transition_new_key_required');
    else validateRootKey(input.new_key, errors);
  }
  return errors;
}

async function verifyRootTransition(verifier, input, action) {
  if (!verifier || typeof verifier.verify !== 'function') return false;
  const authorization = input.authorization;
  const result = await verifier.verify({
    action,
    installation_id: input.installation_id,
    root_subject_id: input.root_subject_id,
    expected_generation: input.expected_generation,
    expected_root_digest: input.expected_root_digest,
    ...(input.new_key ? { new_key: input.new_key } : {}),
    authorization_id: authorization.authorization_id,
    actor_subject: authorization.actor_subject,
    actor_key_id: authorization.actor_key_id,
    signed_payload: rootTransitionPayload(input, action),
    signature: authorization.signature,
    signature_digest: authorization.signature_digest
  });
  return result === true || result?.valid === true;
}

async function verifyExternalAuthorization(verifier, authorization) {
  if (!verifier || typeof verifier.verify !== 'function') return false;
  const result = await verifier.verify({
    boundary_type: authorization.boundary_type,
    authorization_id: authorization.authorization_id,
    operator_subject: authorization.operator_subject,
    operator_key_id: authorization.operator_key_id,
    boundary_key_id: authorization.boundary_key_id,
    signed_payload: signedAuthorizationPayload(authorization),
    signature: authorization.signature,
    attestation_digest: authorization.attestation_digest
  });
  return result === true || result?.valid === true;
}

function auditEvent({ eventId, installationId, bootstrapId, rootSubjectId, eventType, actorSubject, actorKeyId, beforeDigest = null, afterDigest }) {
  const material = { eventId, installationId, bootstrapId, rootSubjectId, eventType, actorSubject, actorKeyId, beforeDigest, afterDigest };
  return {
    event_id: eventId,
    installation_id: installationId,
    bootstrap_id: bootstrapId,
    root_subject_id: rootSubjectId,
    event_type: eventType,
    actor_subject: actorSubject,
    actor_key_id: actorKeyId,
    before_digest: beforeDigest,
    after_digest: afterDigest,
    event_digest: computeCanonicalContentDigest(material)
  };
}

function rowReceipt(row) {
  return parseJson(row.receipt);
}

function replayResult(row) {
  return cloneFrozen({
    ok: true,
    status: 'REPLAY_ACCEPTED',
    contract_name: CONTRACT_NAME,
    bootstrap_id: row.bootstrap_id,
    installation_id: row.installation_id,
    artifact_digest: row.artifact_digest,
    receipt: { ...rowReceipt(row), replay: true }
  });
}

function conflictResult(request, reason = 'bootstrap_conflict') {
  return cloneFrozen({
    ok: false,
    status: 'CONFLICT',
    contract_name: CONTRACT_NAME,
    bootstrap_id: request.bootstrap_id,
    installation_id: request.installation_identity?.installation_id || null,
    artifact_digest: request.artifact_digest,
    reason
  });
}

function invalidResult(request, errors) {
  return cloneFrozen({
    ok: false,
    status: 'INVALID',
    contract_name: CONTRACT_NAME,
    bootstrap_id: request?.bootstrap_id || null,
    installation_id: request?.installation_identity?.installation_id || null,
    errors
  });
}

function createResult(request, receipt) {
  return cloneFrozen({
    ok: true,
    status: 'BOOTSTRAPPED',
    contract_name: CONTRACT_NAME,
    bootstrap_id: request.bootstrap_id,
    installation_id: request.installation_identity.installation_id,
    artifact_digest: request.artifact_digest,
    receipt
  });
}

async function rollback(client, began) {
  if (!began) return;
  try { await client.query('ROLLBACK'); } catch { /* preserve fail-closed result */ }
}

function createCanonicalGovernanceRootBootstrapPostgres({ pool, externalTrustVerifier, rootTransitionVerifier, tables } = {}) {
  requirePool(pool);
  const qualified = tablesWithOverrides(tables);

  async function bootstrap(input = {}) {
    let request;
    try {
      request = buildBootstrapArtifact(input);
    } catch (error) {
      return invalidResult(input, [error.message]);
    }

    if (request.external_authorization.attestation_digest !== computeAttestationDigest(request.external_authorization)) {
      return invalidResult(request, ['external_attestation_digest_mismatch']);
    }
    try {
      if (!await verifyExternalAuthorization(externalTrustVerifier, request.external_authorization)) {
        return cloneFrozen({ ...invalidResult(request, ['external_operator_unauthorized']), status: 'UNAUTHORIZED_OPERATOR' });
      }
    } catch {
      return cloneFrozen({ ...invalidResult(request, ['external_operator_verification_failed']), status: 'UNAUTHORIZED_OPERATOR' });
    }

    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      const guard = await client.query(`SELECT guard_key FROM ${qualified.guard} WHERE guard_key = $1 FOR UPDATE`, ['canonical_governance_root']);
      if (guard.rowCount !== 1) throw new Error('governance_bootstrap_guard_missing');
      const existing = await client.query(`
        SELECT installation_id, lifecycle_state FROM ${qualified.installations}
        WHERE installation_slot = $1 FOR UPDATE
      `, ['canonical']);

      if (existing.rowCount === 1) {
        const installation = existing.rows[0];
        const stored = await client.query(`
          SELECT bootstrap_id, installation_id, artifact_digest, receipt
          FROM ${qualified.bootstraps} WHERE installation_id = $1 FOR SHARE
        `, [installation.installation_id]);
        if (stored.rowCount === 1 && stored.rows[0].artifact_digest === request.artifact_digest) {
          await client.query('COMMIT');
          began = false;
          return replayResult(stored.rows[0]);
        }
        await rollback(client, began);
        began = false;
        return conflictResult(request, installation.lifecycle_state === 'REVOKED' || installation.lifecycle_state === 'RECOVERY_REQUIRED'
          ? 'installation_not_bootstrap_revivable' : 'installation_slot_already_bootstrapped');
      }

      const nowResult = await client.query('SELECT CURRENT_TIMESTAMP AS now');
      const createdAt = iso(nowResult.rows[0].now);
      const identityDigest = installationIdentityDigest(request.installation_identity);
      const rootDigest = rootSpecDigest(request.root_spec);
      const rootFingerprint = stablePayload(request.root_spec);
      const key = request.root_spec.initial_key;
      const receipt = buildReceipt(request, { created_at: createdAt });
      const installationFields = ['installation_id', 'installation_slot', 'installation_identity', 'installation_identity_digest', 'lifecycle_state', 'created_at', 'bootstrapped_at', 'updated_at'];
      await client.query(`
        INSERT INTO ${qualified.installations} (${installationFields.join(', ')})
        VALUES ($1, 'canonical', $2::jsonb, $3, 'UNINITIALIZED', $4, $4, $4)
      `, [request.installation_identity.installation_id, JSON.stringify(request.installation_identity), identityDigest, createdAt]);

      const bootstrapFields = ['bootstrap_id', 'installation_id', 'artifact_digest', 'provenance_digest', 'external_authorization_id', 'external_attestation_digest', 'bootstrap_artifact', 'external_authorization', 'receipt', 'created_at', 'applied_at'];
      await client.query(`
        INSERT INTO ${qualified.bootstraps} (${bootstrapFields.join(', ')})
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $10)
      `, [
        request.bootstrap_id,
        request.installation_identity.installation_id,
        request.artifact_digest,
        request.provenance_digest,
        request.external_authorization.authorization_id,
        request.external_authorization.attestation_digest,
        JSON.stringify(request),
        JSON.stringify(request.external_authorization),
        JSON.stringify(receipt),
        createdAt
      ]);

      await client.query(`
        INSERT INTO ${qualified.roots} (
          root_subject_id, installation_id, root_subject_slot, root_scope,
          root_capabilities, delegation_policy, root_fingerprint, root_digest,
          active_generation, lifecycle_state, created_at, updated_at
        ) VALUES ($1, $2, 'canonical', $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, 0, 'ACTIVE', $8, $8)
      `, [
        request.root_spec.root_subject_id,
        request.installation_identity.installation_id,
        JSON.stringify(request.root_spec.root_scope),
        JSON.stringify(request.root_spec.root_capabilities),
        JSON.stringify(request.root_spec.delegation_policy),
        rootFingerprint,
        rootDigest,
        createdAt
      ]);

      await client.query(`
        INSERT INTO ${qualified.keys} (
          root_key_id, root_subject_id, generation, algorithm, public_key,
          key_fingerprint, key_digest, lifecycle_state, valid_from, created_at
        ) VALUES ($1, $2, 0, $3, $4, $5, $6, 'ACTIVE', $7, $7)
      `, [key.root_key_id, request.root_spec.root_subject_id, key.algorithm, key.public_key, key.key_fingerprint, key.key_digest, createdAt]);

      const events = [
        auditEvent({
          eventId: `governance-audit::bootstrap::${request.bootstrap_id}`,
          installationId: request.installation_identity.installation_id,
          bootstrapId: request.bootstrap_id,
          rootSubjectId: request.root_spec.root_subject_id,
          eventType: 'BOOTSTRAP_APPLIED',
          actorSubject: request.external_authorization.operator_subject,
          actorKeyId: request.external_authorization.operator_key_id,
          afterDigest: request.artifact_digest
        }),
        auditEvent({
          eventId: `governance-audit::root::${request.root_spec.root_subject_id}`,
          installationId: request.installation_identity.installation_id,
          bootstrapId: request.bootstrap_id,
          rootSubjectId: request.root_spec.root_subject_id,
          eventType: 'ROOT_ESTABLISHED',
          actorSubject: request.external_authorization.operator_subject,
          actorKeyId: request.external_authorization.operator_key_id,
          afterDigest: rootDigest
        }),
        auditEvent({
          eventId: `governance-audit::key::${key.root_key_id}`,
          installationId: request.installation_identity.installation_id,
          bootstrapId: request.bootstrap_id,
          rootSubjectId: request.root_spec.root_subject_id,
          eventType: 'ROOT_KEY_ESTABLISHED',
          actorSubject: request.external_authorization.operator_subject,
          actorKeyId: request.external_authorization.operator_key_id,
          afterDigest: key.key_digest
        })
      ];
      for (const event of events) {
        await client.query(`
          INSERT INTO ${qualified.audit} (
            event_id, installation_id, bootstrap_id, root_subject_id, event_type,
            actor_subject, actor_key_id, before_digest, after_digest, event_digest, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [event.event_id, event.installation_id, event.bootstrap_id, event.root_subject_id, event.event_type, event.actor_subject, event.actor_key_id, event.before_digest, event.after_digest, event.event_digest, createdAt]);
      }

      await client.query(`
        UPDATE ${qualified.installations}
        SET lifecycle_state = 'BOOTSTRAPPED', bootstrapped_at = $1, updated_at = $1
        WHERE installation_id = $2 AND lifecycle_state = 'UNINITIALIZED'
      `, [createdAt, request.installation_identity.installation_id]);
      await client.query('COMMIT');
      began = false;
      return createResult(request, receipt);
    } catch (error) {
      await rollback(client, began);
      return cloneFrozen({
        ok: false,
        status: 'PERSISTENCE_FAILURE',
        contract_name: CONTRACT_NAME,
        bootstrap_id: request.bootstrap_id,
        installation_id: request.installation_identity.installation_id,
        reason: error.code === '23505' ? 'bootstrap_conflict' : 'transaction_failed'
      });
    } finally {
      if (client) client.release();
    }
  }

  async function rotateRootKey(input = {}) {
    const errors = validateRootTransition(input, 'GOVERNANCE_ROOT_ROTATION');
    if (errors.length > 0) return invalidResult(input, errors);
    try {
      if (!await verifyRootTransition(rootTransitionVerifier, input, 'GOVERNANCE_ROOT_ROTATION')) {
        return cloneFrozen({ ...invalidResult(input, ['root_transition_unauthorized']), status: 'UNAUTHORIZED_ROOT_TRANSITION' });
      }
    } catch {
      return cloneFrozen({ ...invalidResult(input, ['root_transition_verification_failed']), status: 'UNAUTHORIZED_ROOT_TRANSITION' });
    }
    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      began = true;
      const rootResult = await client.query(`SELECT * FROM ${qualified.roots} WHERE root_subject_id = $1 FOR UPDATE`, [input.root_subject_id]);
      if (rootResult.rowCount !== 1) throw new Error('root_not_found');
      const root = rootResult.rows[0];
      if (root.installation_id !== input.installation_id || root.root_digest !== input.expected_root_digest || root.active_generation !== input.expected_generation) {
        await rollback(client, began); began = false;
        return conflictResult({ bootstrap_id: null, installation_identity: { installation_id: input.installation_id }, artifact_digest: input.expected_root_digest }, 'root_generation_or_digest_conflict');
      }
      if (root.lifecycle_state !== 'ACTIVE') {
        await rollback(client, began); began = false;
        return cloneFrozen({ ...invalidResult(input, ['root_not_active']), status: 'INVALID_LIFECYCLE' });
      }
      const activeKey = await client.query(`SELECT * FROM ${qualified.keys} WHERE root_subject_id = $1 AND lifecycle_state = 'ACTIVE' FOR UPDATE`, [input.root_subject_id]);
      if (activeKey.rowCount !== 1) throw new Error('active_root_key_missing');
      const previous = activeKey.rows[0];
      const nowResult = await client.query('SELECT CURRENT_TIMESTAMP AS now');
      const now = iso(nowResult.rows[0].now);
      await client.query(`UPDATE ${qualified.keys} SET lifecycle_state = 'SUPERSEDED' WHERE root_key_id = $1`, [previous.root_key_id]);
      await client.query(`INSERT INTO ${qualified.keys} (root_key_id, root_subject_id, generation, algorithm, public_key, key_fingerprint, key_digest, lifecycle_state, valid_from, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $8)`, [
        input.new_key.root_key_id, input.root_subject_id, root.active_generation + 1, input.new_key.algorithm,
        input.new_key.public_key, input.new_key.key_fingerprint, input.new_key.key_digest, now
      ]);
      const event = auditEvent({
        eventId: `governance-audit::rotation::${input.new_key.root_key_id}`,
        installationId: input.installation_id,
        bootstrapId: null,
        rootSubjectId: input.root_subject_id,
        eventType: 'ROOT_ROTATED',
        actorSubject: input.authorization.actor_subject,
        actorKeyId: input.authorization.actor_key_id,
        beforeDigest: previous.key_digest,
        afterDigest: input.new_key.key_digest
      });
      await client.query(`INSERT INTO ${qualified.audit} (event_id, installation_id, bootstrap_id, root_subject_id, event_type, actor_subject, actor_key_id, before_digest, after_digest, event_digest, created_at) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)`, [event.event_id, event.installation_id, event.root_subject_id, event.event_type, event.actor_subject, event.actor_key_id, event.before_digest, event.after_digest, event.event_digest, now]);
      await client.query(`UPDATE ${qualified.roots} SET active_generation = $1, updated_at = $2 WHERE root_subject_id = $3 AND active_generation = $4`, [root.active_generation + 1, now, input.root_subject_id, input.expected_generation]);
      await client.query('COMMIT');
      began = false;
      return cloneFrozen({ ok: true, status: 'ROTATED', contract_name: CONTRACT_NAME, installation_id: input.installation_id, root_subject_id: input.root_subject_id, previous_key_id: previous.root_key_id, root_key_id: input.new_key.root_key_id, generation: root.active_generation + 1, root_digest: root.root_digest });
    } catch (error) {
      await rollback(client, began);
      return cloneFrozen({ ok: false, status: 'PERSISTENCE_FAILURE', contract_name: CONTRACT_NAME, installation_id: input.installation_id, root_subject_id: input.root_subject_id, reason: 'root_rotation_transaction_failed', detail: error.code === '23505' ? 'root_key_conflict' : undefined });
    } finally {
      if (client) client.release();
    }
  }

  async function revokeRoot(input = {}) {
    const errors = validateRootTransition(input, 'GOVERNANCE_ROOT_REVOCATION');
    if (errors.length > 0) return invalidResult(input, errors);
    try {
      if (!await verifyRootTransition(rootTransitionVerifier, input, 'GOVERNANCE_ROOT_REVOCATION')) {
        return cloneFrozen({ ...invalidResult(input, ['root_transition_unauthorized']), status: 'UNAUTHORIZED_ROOT_TRANSITION' });
      }
    } catch {
      return cloneFrozen({ ...invalidResult(input, ['root_transition_verification_failed']), status: 'UNAUTHORIZED_ROOT_TRANSITION' });
    }
    let client = null;
    let began = false;
    try {
      client = await pool.connect();
      await client.query('BEGIN'); began = true;
      const rootResult = await client.query(`SELECT * FROM ${qualified.roots} WHERE root_subject_id = $1 FOR UPDATE`, [input.root_subject_id]);
      if (rootResult.rowCount !== 1) throw new Error('root_not_found');
      const root = rootResult.rows[0];
      if (root.installation_id !== input.installation_id || root.root_digest !== input.expected_root_digest || root.active_generation !== input.expected_generation) {
        await rollback(client, began); began = false;
        return conflictResult({ bootstrap_id: null, installation_identity: { installation_id: input.installation_id }, artifact_digest: input.expected_root_digest }, 'root_generation_or_digest_conflict');
      }
      if (root.lifecycle_state === 'REVOKED') {
        await client.query('COMMIT'); began = false;
        return cloneFrozen({ ok: true, status: 'REPLAY_ACCEPTED', contract_name: CONTRACT_NAME, installation_id: input.installation_id, root_subject_id: input.root_subject_id });
      }
      const nowResult = await client.query('SELECT CURRENT_TIMESTAMP AS now');
      const now = iso(nowResult.rows[0].now);
      await client.query(`UPDATE ${qualified.keys} SET lifecycle_state = 'REVOKED', revoked_at = $1 WHERE root_subject_id = $2 AND lifecycle_state = 'ACTIVE'`, [now, input.root_subject_id]);
      await client.query(`UPDATE ${qualified.roots} SET lifecycle_state = 'REVOKED', revoked_at = $1, updated_at = $1 WHERE root_subject_id = $2`, [now, input.root_subject_id]);
      await client.query(`UPDATE ${qualified.installations} SET lifecycle_state = 'REVOKED', revoked_at = $1, updated_at = $1 WHERE installation_id = $2`, [now, input.installation_id]);
      const event = auditEvent({ eventId: `governance-audit::revocation::${input.root_subject_id}::${input.expected_generation}`, installationId: input.installation_id, bootstrapId: null, rootSubjectId: input.root_subject_id, eventType: 'ROOT_REVOKED', actorSubject: input.authorization.actor_subject, actorKeyId: input.authorization.actor_key_id, beforeDigest: root.root_digest, afterDigest: root.root_digest });
      await client.query(`INSERT INTO ${qualified.audit} (event_id, installation_id, bootstrap_id, root_subject_id, event_type, actor_subject, actor_key_id, before_digest, after_digest, event_digest, created_at) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)`, [event.event_id, event.installation_id, event.root_subject_id, event.event_type, event.actor_subject, event.actor_key_id, event.before_digest, event.after_digest, event.event_digest, now]);
      await client.query('COMMIT'); began = false;
      return cloneFrozen({ ok: true, status: 'REVOKED', contract_name: CONTRACT_NAME, installation_id: input.installation_id, root_subject_id: input.root_subject_id, generation: input.expected_generation });
    } catch {
      await rollback(client, began);
      return cloneFrozen({ ok: false, status: 'PERSISTENCE_FAILURE', contract_name: CONTRACT_NAME, installation_id: input.installation_id, root_subject_id: input.root_subject_id, reason: 'root_revocation_transaction_failed' });
    } finally {
      if (client) client.release();
    }
  }

  return Object.freeze({ bootstrap, revokeRoot, rotateRootKey, tables: qualified });
}

module.exports = {
  DEFAULT_TABLES,
  createCanonicalGovernanceRootBootstrapPostgres,
  signedAuthorizationPayload,
  validTableName,
  validateRootKey
};

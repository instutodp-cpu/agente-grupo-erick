'use strict';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function canonicalIso(value) {
  if (!isNonEmptyString(value)) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const canonical = new Date(milliseconds).toISOString();
  return canonical === value ? canonical : null;
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    consumed: false,
    reason
  });
}

function createPublicWebCanaryExecutionReservationLedger(options = {}) {
  const reservations = new Map();
  const replayKeys = new Map();
  const executionIds = new Set();
  const clock =
    typeof options.clock === 'function'
      ? options.clock
      : () => new Date(0).toISOString();

  function nowIso() {
    const value = clock();
    const iso = value instanceof Date ? value.toISOString() : String(value);
    return canonicalIso(iso);
  }

  function registerReservation(input = {}) {
    if (!isNonEmptyString(input.execution_reservation_id)) {
      return fail('execution_reservation_id_required');
    }
    if (!isNonEmptyString(input.authorization_grant_id)) {
      return fail('authorization_grant_id_required');
    }
    if (!isNonEmptyString(input.grant_reservation_fingerprint)) {
      return fail('grant_reservation_fingerprint_required');
    }
    if (!isNonEmptyString(input.replay_key)) {
      return fail('replay_key_required');
    }
    if (!isNonEmptyString(input.reservation_nonce)) {
      return fail('reservation_nonce_required');
    }
    const issuedAt = canonicalIso(input.issued_at);
    const expiresAt = canonicalIso(input.expires_at);
    if (!issuedAt) return fail('issued_at_invalid');
    if (!expiresAt) return fail('expires_at_invalid');
    if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
      return fail('reservation_expiry_invalid');
    }

    const immutable = {
      execution_reservation_id: input.execution_reservation_id,
      authorization_grant_id: input.authorization_grant_id,
      grant_reservation_fingerprint: input.grant_reservation_fingerprint,
      replay_key: input.replay_key,
      reservation_nonce: input.reservation_nonce,
      issued_at: issuedAt,
      expires_at: expiresAt,
      environment: input.environment,
      tenant_id: input.tenant_id,
      trial_id: input.trial_id,
      plan_hash: input.plan_hash
    };

    const existing = reservations.get(input.execution_reservation_id);
    if (existing) {
      const same =
        JSON.stringify(existing.immutable) === JSON.stringify(immutable);
      if (!same) return fail('reservation_identity_conflict');
      return Object.freeze({
        ok: true,
        registered: false,
        idempotent: true,
        reservation: clone(existing)
      });
    }

    const replayOwner = replayKeys.get(input.replay_key);
    if (replayOwner && replayOwner !== input.execution_reservation_id) {
      return fail('replay_key_already_reserved');
    }

    const record = Object.freeze({
      immutable: Object.freeze(clone(immutable)),
      state: 'RESERVED_UNCONSUMED',
      consumed: false,
      consumed_at: null,
      execution_id: null,
      runtime_binding_fingerprint: null,
      version: 1
    });
    reservations.set(input.execution_reservation_id, record);
    replayKeys.set(input.replay_key, input.execution_reservation_id);

    return Object.freeze({
      ok: true,
      registered: true,
      idempotent: false,
      reservation: clone(record)
    });
  }

  function consumeAtomically(input = {}) {
    const id = input.execution_reservation_id;
    if (!isNonEmptyString(id)) return fail('execution_reservation_id_required');
    if (!isNonEmptyString(input.authorization_grant_id)) {
      return fail('authorization_grant_id_required');
    }
    if (!isNonEmptyString(input.grant_reservation_fingerprint)) {
      return fail('grant_reservation_fingerprint_required');
    }
    if (!isNonEmptyString(input.replay_key)) return fail('replay_key_required');
    if (!isNonEmptyString(input.reservation_nonce)) {
      return fail('reservation_nonce_required');
    }
    if (!isNonEmptyString(input.execution_id)) {
      return fail('execution_id_required');
    }
    if (!isNonEmptyString(input.runtime_binding_fingerprint)) {
      return fail('runtime_binding_fingerprint_required');
    }

    const record = reservations.get(id);
    if (!record) return fail('reservation_not_registered');

    const immutable = record.immutable;
    if (immutable.authorization_grant_id !== input.authorization_grant_id) {
      return fail('authorization_grant_id_mismatch');
    }
    if (
      immutable.grant_reservation_fingerprint !==
      input.grant_reservation_fingerprint
    ) {
      return fail('grant_reservation_fingerprint_mismatch');
    }
    if (immutable.replay_key !== input.replay_key) {
      return fail('replay_key_mismatch');
    }
    if (immutable.reservation_nonce !== input.reservation_nonce) {
      return fail('reservation_nonce_mismatch');
    }

    if (record.consumed === true || record.state !== 'RESERVED_UNCONSUMED') {
      return fail('reservation_already_consumed');
    }
    if (executionIds.has(input.execution_id)) {
      return fail('execution_id_replayed');
    }

    const replayOwner = replayKeys.get(input.replay_key);
    if (replayOwner !== id) {
      return fail('replay_key_owner_mismatch');
    }

    const now = canonicalIso(input.consumed_at) || nowIso();
    if (!now) return fail('consumed_at_invalid');
    if (Date.parse(now) < Date.parse(immutable.issued_at)) {
      return fail('reservation_not_yet_valid');
    }
    if (Date.parse(now) >= Date.parse(immutable.expires_at)) {
      return fail('reservation_expired');
    }

    // This check-and-set section contains no await/yield. In a single Node
    // process it is the atomic boundary: exactly one caller can transition
    // RESERVED_UNCONSUMED -> CONSUMED before any runner/network await occurs.
    const next = Object.freeze({
      immutable: record.immutable,
      state: 'CONSUMED',
      consumed: true,
      consumed_at: now,
      execution_id: input.execution_id,
      runtime_binding_fingerprint: input.runtime_binding_fingerprint,
      version: record.version + 1
    });

    reservations.set(id, next);
    executionIds.add(input.execution_id);

    return Object.freeze({
      ok: true,
      consumed: true,
      replay_key_consumed: true,
      reservation: clone(next)
    });
  }

  function getReservation(id) {
    return clone(reservations.get(id)) || null;
  }

  function isReplayKeyReserved(replayKey) {
    return replayKeys.has(replayKey);
  }

  return Object.freeze({
    atomic_scope: 'SINGLE_NODE_PROCESS',
    durable: false,
    registerReservation,
    consumeAtomically,
    getReservation,
    isReplayKeyReserved
  });
}

module.exports = {
  createPublicWebCanaryExecutionReservationLedger
};

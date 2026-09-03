'use strict';

const { cloneFrozen } = require('../../core/agent-identity-contract');
const {
  CONTRACT_NAME,
  CONTRACT_VERSION,
  FIELDS,
  SAFE_FLAGS,
  buildCapacityReservationPlan,
  buildCapacityResource,
  classifyPersistedCapacityReservation,
  planToInsertRow,
  validatePersistedCapacityReservation,
  validatePersistedCapacityResource
} = require('../../core/runtime-execution-attempt-worker-capacity-reservation');
const { normalizeLeaseRow } = require('./runtime-execution-attempt-worker-lease-postgres');
const { validatePersistedLease } = require('../../core/runtime-execution-attempt-worker-lease');

const DEFAULT_LEASE_TABLE_NAME = 'hermes.runtime_execution_attempt_worker_leases';
const DEFAULT_RESOURCE_TABLE_NAME = 'hermes.runtime_worker_capacity_resources';
const DEFAULT_RESERVATION_TABLE_NAME = 'hermes.runtime_execution_attempt_worker_capacity_reservations';
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const RESOURCE_COLUMNS = Object.freeze([
  'capacity_resource_id', 'capacity_dimension', 'worker_id', 'tenant_id', 'organization_id',
  'project_id', 'session_reference_id', 'agent_id', 'actor_id', 'capacity_limit',
  'reserved_amount', 'capacity_fingerprint', 'capacity_digest', 'capacity_artifact', 'created_at', 'updated_at'
]);
const RESERVATION_COLUMNS = FIELDS.join(', ');
const INSERT_FIELDS = FIELDS.filter((field) => !['created_at', 'updated_at', 'released_at'].includes(field));

function validateTableName(tableName) {
  const parts = typeof tableName === 'string' ? tableName.split('.') : [];
  return parts.length === 2 && parts.every((part) => SIMPLE_IDENTIFIER.test(part));
}

function requireTableName(tableName) {
  if (!validateTableName(tableName)) throw new TypeError('runtime_capacity_reservation_postgres_table_name_invalid');
  return tableName;
}

function requirePool(pool) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('runtime_capacity_reservation_postgres_pool_invalid');
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function normalizeResourceRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    capacity_limit: Number(row.capacity_limit),
    reserved_amount: Number(row.reserved_amount),
    capacity_artifact: parseJson(row.capacity_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function normalizeReservationRow(row) {
  if (!row || typeof row !== 'object') return row;
  return {
    ...row,
    fencing_token: Number(row.fencing_token),
    requested_amount: Number(row.requested_amount),
    reservation_ordinal: Number(row.reservation_ordinal),
    reservation_artifact: parseJson(row.reservation_artifact),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    released_at: row.released_at instanceof Date ? row.released_at.toISOString() : row.released_at
  };
}

function resultFor(operation, outcome, plan, row, reasonCode, validationErrors = [], overrides = {}) {
  const successful = ['CREATED', 'EXISTING_IDENTICAL', 'RELEASED'].includes(outcome);
  const flags = Object.fromEntries(Object.entries(SAFE_FLAGS).map(([key, value]) => [key, successful ? value : false]));
  if (operation === 'RELEASE' && successful) {
    flags.capacity_reserved = false;
    flags.capacity_released = true;
  }
  return cloneFrozen({
    capacity_reservation_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      operation,
      outcome,
      reservation_id: row?.reservation_id ?? plan?.reservation_id ?? null,
      lease_id: row?.lease_id ?? plan?.identity?.lease_id ?? null,
      ownership_id: row?.ownership_id ?? plan?.identity?.ownership_id ?? null,
      operational_owner_id: row?.operational_owner_id ?? plan?.identity?.operational_owner_id ?? null,
      worker_id: row?.worker_id ?? plan?.identity?.worker_id ?? null,
      capacity_resource_id: row?.capacity_resource_id ?? plan?.identity?.capacity_resource_id ?? null,
      fencing_token: row?.fencing_token ?? plan?.identity?.fencing_token ?? null,
      requested_amount: row?.requested_amount ?? plan?.identity?.requested_amount ?? null,
      reservation_ordinal: row?.reservation_ordinal ?? plan?.reservation_ordinal ?? null,
      reservation_state: row?.reservation_state ?? null,
      ...flags,
      ...overrides,
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  });
}

function invalidResult(operation, reasonCode, validationErrors = []) {
  return resultFor(operation, 'INVALID', null, null, reasonCode, validationErrors);
}

function resourceResult(outcome, resourceId, reasonCode, validationErrors = []) {
  return {
    capacity_resource_result: {
      contract_name: CONTRACT_NAME,
      contract_version: CONTRACT_VERSION,
      outcome,
      capacity_resource_id: resourceId ?? null,
      reason_code: reasonCode,
      validation_errors: validationErrors
    }
  };
}

function leaseIsExpired(lease) {
  return lease?.lease_state === 'ACTIVE'
    && typeof lease.lease_expires_at === 'string'
    && new Date(lease.lease_expires_at).getTime() <= Date.now();
}

function createRuntimeExecutionAttemptWorkerCapacityReservationPostgres({
  pool,
  leaseTableName = DEFAULT_LEASE_TABLE_NAME,
  resourceTableName = DEFAULT_RESOURCE_TABLE_NAME,
  reservationTableName = DEFAULT_RESERVATION_TABLE_NAME
} = {}) {
  requirePool(pool);
  const leases = requireTableName(leaseTableName);
  const resources = requireTableName(resourceTableName);
  const reservations = requireTableName(reservationTableName);

  async function registerCapacityResource(resourceInput) {
    const plan = resourceInput?.outcome === 'READY' ? resourceInput : buildCapacityResource(resourceInput);
    if (plan.outcome !== 'READY') return resourceResult('INVALID', null, plan.reason_code || 'capacity_resource_invalid', plan.errors || []);
    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const inserted = await client.query(`
        INSERT INTO ${resources} (${RESOURCE_COLUMNS.filter((field) => !['reserved_amount', 'created_at', 'updated_at'].includes(field)).join(', ')})
        VALUES (${RESOURCE_COLUMNS.filter((field) => !['reserved_amount', 'created_at', 'updated_at'].includes(field)).map((field, index) => `$${index + 1}${field === 'capacity_artifact' ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${RESOURCE_COLUMNS.join(', ')}
      `, [
        plan.capacity_resource_id, plan.capacity_dimension, plan.worker_id, plan.tenant_id,
        plan.organization_id, plan.project_id, plan.session_reference_id, plan.agent_id, plan.actor_id,
        plan.capacity_limit, plan.capacity_fingerprint, plan.capacity_digest, JSON.stringify(plan.capacity_artifact)
      ]);
      if (inserted.rowCount === 1) {
        await client.query('COMMIT');
        began = false;
        return resourceResult('CREATED', plan.capacity_resource_id, 'capacity_resource_created');
      }
      const existing = await client.query(`SELECT ${RESOURCE_COLUMNS.join(', ')} FROM ${resources} WHERE capacity_resource_id = $1 FOR SHARE`, [plan.capacity_resource_id]);
      if (existing.rowCount !== 1) throw new Error('capacity_resource_conflict_row_missing');
      const stored = normalizeResourceRow(existing.rows[0]);
      const validation = validatePersistedCapacityResource(stored);
      if (!validation.valid) throw new Error(`persisted_capacity_resource_invalid::${validation.errors.join(',')}`);
      const outcome = stored.capacity_digest === plan.capacity_digest ? 'EXISTING_IDENTICAL' : 'CONFLICT';
      await client.query('COMMIT');
      began = false;
      return resourceResult(outcome, stored.capacity_resource_id, outcome === 'EXISTING_IDENTICAL' ? 'capacity_resource_replay' : 'capacity_resource_conflict');
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resourceResult('TECHNICAL_FAILURE', null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  async function loadLease(client, leaseId) {
    const response = await client.query(`SELECT * FROM ${leases} WHERE lease_id = $1 FOR UPDATE`, [leaseId]);
    if (response.rowCount !== 1) return null;
    return normalizeLeaseRow(response.rows[0]);
  }

  async function reserveCapacity({
    lease_id: leaseId,
    operational_owner_id: ownerId,
    fencing_token: fencingToken,
    capacity_resource_id: resourceId,
    capacity_dimension: capacityDimension,
    requested_amount: requestedAmount,
    reservation_ordinal: reservationOrdinal = 1
  } = {}) {
    if (typeof leaseId !== 'string' || leaseId.length === 0) return invalidResult('ACQUIRE', 'lease_id_invalid');
    if (typeof ownerId !== 'string' || ownerId.length === 0) return invalidResult('ACQUIRE', 'operational_owner_id_invalid');
    if (!Number.isInteger(fencingToken) || fencingToken < 1) return invalidResult('ACQUIRE', 'fencing_token_invalid');
    if (typeof resourceId !== 'string' || resourceId.length === 0) return invalidResult('ACQUIRE', 'capacity_resource_id_invalid');
    if (typeof capacityDimension !== 'string' || capacityDimension.length === 0) return invalidResult('ACQUIRE', 'capacity_dimension_invalid');
    if (!Number.isInteger(requestedAmount) || requestedAmount < 1) return invalidResult('ACQUIRE', 'requested_amount_invalid');
    if (!Number.isInteger(reservationOrdinal) || reservationOrdinal < 1) return invalidResult('ACQUIRE', 'reservation_ordinal_invalid');

    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const lease = await loadLease(client, leaseId);
      if (!lease) {
        await client.query('COMMIT');
        began = false;
        return invalidResult('ACQUIRE', 'lease_not_found');
      }
      const leaseValidation = validatePersistedLease(lease);
      if (!leaseValidation.valid) throw new Error(`persisted_lease_invalid::${leaseValidation.errors.join(',')}`);
      if (lease.lease_state !== 'ACTIVE' || leaseIsExpired(lease)) {
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', 'STALE', null, lease, leaseIsExpired(lease) ? 'lease_expired' : 'lease_not_active');
      }
      if (lease.operational_owner_id !== ownerId || Number(lease.fencing_token) !== fencingToken) {
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', 'STALE', null, lease, 'stale_owner_or_fencing_token');
      }

      const resourceResponse = await client.query(`SELECT ${RESOURCE_COLUMNS.join(', ')} FROM ${resources} WHERE capacity_resource_id = $1 FOR UPDATE`, [resourceId]);
      if (resourceResponse.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return invalidResult('ACQUIRE', 'capacity_resource_not_found');
      }
      const resource = normalizeResourceRow(resourceResponse.rows[0]);
      const plan = buildCapacityReservationPlan({
        lease,
        resource,
        operational_owner_id: ownerId,
        fencing_token: fencingToken,
        requested_amount: requestedAmount,
        reservation_ordinal: reservationOrdinal
      });
      if (plan.outcome !== 'READY' || resource.capacity_dimension !== capacityDimension) {
        if (resource.capacity_dimension !== capacityDimension) plan.errors = [...(plan.errors || []), 'capacity_dimension_mismatch'];
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', 'INVALID', plan, null, 'invalid_capacity_reservation_predecessor', plan.errors || []);
      }

      const consumed = await client.query(`
        UPDATE ${resources}
        SET reserved_amount = reserved_amount + $2, updated_at = CURRENT_TIMESTAMP
        WHERE capacity_resource_id = $1 AND reserved_amount + $2 <= capacity_limit
        RETURNING ${RESOURCE_COLUMNS.join(', ')}
      `, [resourceId, requestedAmount]);
      if (consumed.rowCount !== 1) {
        const existingResponse = await client.query(`
          SELECT ${RESERVATION_COLUMNS} FROM ${reservations}
          WHERE lease_id = $1 AND capacity_resource_id = $2 AND reservation_ordinal = $3
          FOR SHARE
        `, [plan.identity.lease_id, plan.identity.capacity_resource_id, plan.reservation_ordinal]);
        if (existingResponse.rowCount === 1) {
          const stored = normalizeReservationRow(existingResponse.rows[0]);
          const classification = classifyPersistedCapacityReservation(stored, plan);
          await client.query('COMMIT');
          began = false;
          return resultFor('ACQUIRE', classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
        }
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', 'CONFLICT', plan, null, 'capacity_insufficient');
      }

      const insertRow = planToInsertRow(plan);
      const inserted = await client.query(`
        INSERT INTO ${reservations} (${INSERT_FIELDS.join(', ')})
        VALUES (${INSERT_FIELDS.map((field, index) => `$${index + 1}${field === 'reservation_artifact' ? '::jsonb' : ''}`).join(', ')})
        ON CONFLICT DO NOTHING
        RETURNING ${RESERVATION_COLUMNS}
      `, INSERT_FIELDS.map((field) => field === 'reservation_artifact' ? JSON.stringify(insertRow[field]) : insertRow[field]));
      if (inserted.rowCount !== 1) {
        const restored = await client.query(`
          UPDATE ${resources}
          SET reserved_amount = reserved_amount - $2, updated_at = CURRENT_TIMESTAMP
          WHERE capacity_resource_id = $1 AND reserved_amount >= $2
        `, [resourceId, requestedAmount]);
        if (restored.rowCount !== 1) throw new Error('capacity_reservation_conflict_restore_failed');
        const existingResponse = await client.query(`
          SELECT ${RESERVATION_COLUMNS} FROM ${reservations}
          WHERE lease_id = $1 AND capacity_resource_id = $2 AND reservation_ordinal = $3
          FOR SHARE
        `, [plan.identity.lease_id, plan.identity.capacity_resource_id, plan.reservation_ordinal]);
        if (existingResponse.rowCount !== 1) throw new Error('capacity_reservation_conflict_row_missing');
        const stored = normalizeReservationRow(existingResponse.rows[0]);
        const classification = classifyPersistedCapacityReservation(stored, plan);
        await client.query('COMMIT');
        began = false;
        return resultFor('ACQUIRE', classification.outcome, plan, stored, classification.reason_code, classification.validation_errors || []);
      }
      const stored = normalizeReservationRow(inserted.rows[0]);
      await client.query('COMMIT');
      began = false;
      return resultFor('ACQUIRE', 'CREATED', plan, stored, 'capacity_reserved');
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resultFor('ACQUIRE', 'TECHNICAL_FAILURE', null, null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  async function inspectReservation({ reservation_id: reservationId } = {}) {
    if (typeof reservationId !== 'string' || reservationId.length === 0) return invalidResult('INSPECT', 'reservation_id_invalid');
    const response = await pool.query(`SELECT ${RESERVATION_COLUMNS} FROM ${reservations} WHERE reservation_id = $1`, [reservationId]);
    if (response.rowCount !== 1) return invalidResult('INSPECT', 'reservation_not_found');
    const row = normalizeReservationRow(response.rows[0]);
    const validation = validatePersistedCapacityReservation(row);
    if (!validation.valid) return resultFor('INSPECT', 'TECHNICAL_FAILURE', null, row, 'persisted_reservation_invalid', validation.errors);
    const leaseResponse = await pool.query(`SELECT * FROM ${leases} WHERE lease_id = $1`, [row.lease_id]);
    if (leaseResponse.rowCount !== 1) return resultFor('INSPECT', 'STALE', null, row, 'lease_not_found');
    const lease = normalizeLeaseRow(leaseResponse.rows[0]);
    const leaseValidation = validatePersistedLease(lease);
    if (!leaseValidation.valid) return resultFor('INSPECT', 'TECHNICAL_FAILURE', null, row, 'persisted_lease_invalid', leaseValidation.errors);
    if (lease.lease_state !== 'ACTIVE' || leaseIsExpired(lease)) return resultFor('INSPECT', 'STALE', null, row, leaseIsExpired(lease) ? 'lease_expired' : 'lease_not_active');
    return resultFor('INSPECT', 'EXISTING_IDENTICAL', null, row, 'reservation_inspected');
  }

  async function releaseCapacity({ reservation_id: reservationId, operational_owner_id: ownerId, fencing_token: fencingToken } = {}) {
    if (typeof reservationId !== 'string' || reservationId.length === 0) return invalidResult('RELEASE', 'reservation_id_invalid');
    if (typeof ownerId !== 'string' || ownerId.length === 0) return invalidResult('RELEASE', 'operational_owner_id_invalid');
    if (!Number.isInteger(fencingToken) || fencingToken < 1) return invalidResult('RELEASE', 'fencing_token_invalid');
    const client = await pool.connect();
    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      const found = await client.query(`SELECT ${RESERVATION_COLUMNS} FROM ${reservations} WHERE reservation_id = $1 FOR UPDATE`, [reservationId]);
      if (found.rowCount !== 1) {
        await client.query('COMMIT');
        began = false;
        return invalidResult('RELEASE', 'reservation_not_found');
      }
      const reservation = normalizeReservationRow(found.rows[0]);
      const validation = validatePersistedCapacityReservation(reservation);
      if (!validation.valid) throw new Error(`persisted_reservation_invalid::${validation.errors.join(',')}`);
      const lease = await loadLease(client, reservation.lease_id);
      if (!lease || !validatePersistedLease(lease).valid) throw new Error('persisted_lease_invalid');
      if (lease.operational_owner_id !== ownerId || Number(lease.fencing_token) !== fencingToken || lease.lease_state !== 'ACTIVE' || leaseIsExpired(lease)) {
        await client.query('COMMIT');
        began = false;
        return resultFor('RELEASE', 'STALE', null, reservation, 'stale_owner_or_fencing_token');
      }
      if (reservation.reservation_state !== 'ACTIVE') {
        await client.query('COMMIT');
        began = false;
        return resultFor('RELEASE', reservation.reservation_state === 'RELEASED' ? 'RELEASED' : 'STALE', null, reservation, 'reservation_already_terminal');
      }
      const resource = await client.query(`
        UPDATE ${resources}
        SET reserved_amount = reserved_amount - $2, updated_at = CURRENT_TIMESTAMP
        WHERE capacity_resource_id = $1 AND reserved_amount >= $2
        RETURNING ${RESOURCE_COLUMNS.join(', ')}
      `, [reservation.capacity_resource_id, reservation.requested_amount]);
      if (resource.rowCount !== 1) throw new Error('capacity_release_invariant_failed');
      const released = await client.query(`
        UPDATE ${reservations}
        SET reservation_state = 'RELEASED', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE reservation_id = $1 AND reservation_state = 'ACTIVE'
        RETURNING ${RESERVATION_COLUMNS}
      `, [reservationId]);
      if (released.rowCount !== 1) throw new Error('capacity_release_row_missing');
      const stored = normalizeReservationRow(released.rows[0]);
      await client.query('COMMIT');
      began = false;
      return resultFor('RELEASE', 'RELEASED', null, stored, 'capacity_released');
    } catch (error) {
      if (began) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
      }
      return resultFor('RELEASE', 'TECHNICAL_FAILURE', null, null, 'persistence_failure', [error.message]);
    } finally {
      client.release();
    }
  }

  return Object.freeze({
    registerCapacityResource,
    reserveCapacity,
    inspectReservation,
    releaseCapacity,
    leaseTableName: leases,
    resourceTableName: resources,
    reservationTableName: reservations
  });
}

module.exports = {
  DEFAULT_LEASE_TABLE_NAME,
  DEFAULT_RESOURCE_TABLE_NAME,
  DEFAULT_RESERVATION_TABLE_NAME,
  createRuntimeExecutionAttemptWorkerCapacityReservationPostgres,
  normalizeReservationRow,
  normalizeResourceRow,
  validateTableName
};

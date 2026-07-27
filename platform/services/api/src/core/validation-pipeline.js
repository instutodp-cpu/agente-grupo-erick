'use strict';

const { isNonEmptyString, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { VALIDATION_STAGES, buildValidationOutcome } = require('./validation-outcome');
const { buildValidationLedger } = require('./validation-ledger');
const { getTaxonomyMetadata } = require('./validation-taxonomy');

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined || value === null ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// --- Legacy validator adapters ------------------------------------------------------------------
//
// This codebase's own pre-existing validators (PR #94-#100) return one of three shapes:
//   { valid: boolean, errors: string[] }   -- the exact-fields contract validators
//   null | { status, reason }              -- the engine's own checkBinding()-style cross-checks
//   a thrown exception                     -- anything unexpected
// adaptLegacyValidatorOutput() normalizes any of these (plus a fourth, unrecognized shape) into
// { valid, reasonCodes, status } without rewriting a single one of those existing validators.
function adaptLegacyValidatorOutput(rawOutput, { wasCalled = true } = {}) {
  // null only means VALID if the validator was actually invoked -- a validator that legitimately
  // was never called (not applicable, or the pipeline stopped before reaching it) is represented
  // by ValidationState.NOT_EVALUATED elsewhere, never by feeding a synthetic null through here.
  if (rawOutput === null || rawOutput === undefined) {
    return wasCalled
      ? { valid: true, reasonCodes: [], status: null }
      : { valid: false, reasonCodes: ['legacy_adapter_validator_not_called'], status: 'VALIDATION_FAILED' };
  }
  if (typeof rawOutput === 'object' && typeof rawOutput.valid === 'boolean') {
    const errors = Array.isArray(rawOutput.errors) ? rawOutput.errors.filter(isNonEmptyString) : [];
    return { valid: rawOutput.valid, reasonCodes: uniqueSorted(errors), status: rawOutput.valid ? null : 'VALIDATION_FAILED' };
  }
  if (typeof rawOutput === 'object' && isNonEmptyString(rawOutput.status)) {
    const reason = isNonEmptyString(rawOutput.reason) ? [rawOutput.reason] : [];
    return { valid: false, reasonCodes: uniqueSorted(reason), status: rawOutput.status };
  }
  // Unknown output shape -- fail closed, never silently treated as valid.
  return { valid: false, reasonCodes: ['legacy_adapter_unknown_validator_output'], status: 'VALIDATION_FAILED' };
}

// Invokes a validator handler and guarantees a normalized adapter result is always produced --
// "nenhuma exceção escapa." A thrown exception (including one whose message might otherwise leak
// operational detail) is converted into the same sanitized VALIDATION_FAILED shape every other
// failure path already produces.
function invokeValidatorHandler(handler, context) {
  try {
    const rawOutput = handler(context);
    return adaptLegacyValidatorOutput(rawOutput, { wasCalled: true });
  } catch (error) {
    return { valid: false, reasonCodes: ['legacy_adapter_validator_exception'], status: 'VALIDATION_FAILED' };
  }
}

// --- Pipeline ------------------------------------------------------------------------------------
//
// Walks VALIDATION_STAGES in canonical order, and within each stage every validator the registry
// returns for it (already in deterministic priority/id order). The first validator whose adapted
// output is invalid produces a blocking, terminal ValidationOutcome and stops the pipeline; every
// stage/validator after that point receives a NOT_EVALUATED outcome, never VALID.
//
// `context` here is this pipeline's own evaluation input bag (request data, canonical identity,
// materialized intermediate values, ...) -- entirely distinct from, and never influenced by, the
// legacy `context` parameter execution-plan-engine.js/execution-authorization-boundary.js accept
// for backward compatibility. No decisional condition is ever read from that legacy side-channel
// here; "context deve permanecer inerte" continues to hold.
function runValidationPipeline(registry, context, { ledgerIdentity = {}, logicalSequenceStart = 0 } = {}) {
  const outcomes = [];
  let sequence = logicalSequenceStart;
  let blocked = false;

  for (const stage of VALIDATION_STAGES) {
    const validators = registry.getValidatorsForStage(stage);
    for (const definition of validators) {
      if (blocked) {
        outcomes.push(buildValidationOutcome({
          validator_id: definition.validator_id, validator_version: definition.version, validation_stage: stage,
          state: 'NOT_EVALUATED', logical_sequence: sequence
        }));
        sequence += 1;
        continue;
      }

      let applicable = true;
      try {
        applicable = definition.applicable(context) === true;
      } catch (error) {
        applicable = true;
      }

      if (!applicable) {
        outcomes.push(buildValidationOutcome({
          validator_id: definition.validator_id, validator_version: definition.version, validation_stage: stage,
          state: 'NOT_APPLICABLE', logical_sequence: sequence, input_fingerprint: safeFingerprint(context)
        }));
        sequence += 1;
        continue;
      }

      const adapted = invokeValidatorHandler(definition.handler, context);
      if (adapted.valid) {
        outcomes.push(buildValidationOutcome({
          validator_id: definition.validator_id, validator_version: definition.version, validation_stage: stage,
          state: 'VALID', logical_sequence: sequence, input_fingerprint: safeFingerprint(context)
        }));
      } else {
        const taxonomyMeta = getTaxonomyMetadata(adapted.status);
        outcomes.push(buildValidationOutcome({
          validator_id: definition.validator_id, validator_version: definition.version, validation_stage: stage,
          state: 'INVALID', status: adapted.status || 'VALIDATION_FAILED', severity: taxonomyMeta ? taxonomyMeta.severity : 'ERROR',
          reason_codes: adapted.reasonCodes, blocking: definition.required !== false, terminal: definition.required !== false,
          logical_sequence: sequence, input_fingerprint: safeFingerprint(context)
        }));
        if (definition.required !== false) blocked = true;
      }
      sequence += 1;
    }
  }

  return buildValidationLedger({
    validation_ledger_id: ledgerIdentity.validation_ledger_id,
    execution_plan_request_id: ledgerIdentity.execution_plan_request_id === undefined ? null : ledgerIdentity.execution_plan_request_id,
    execution_plan_id: ledgerIdentity.execution_plan_id === undefined ? null : ledgerIdentity.execution_plan_id,
    tenant_id: ledgerIdentity.tenant_id,
    organization_id: ledgerIdentity.organization_id,
    project_id: ledgerIdentity.project_id,
    session_reference_id: ledgerIdentity.session_reference_id,
    agent_id: ledgerIdentity.agent_id,
    actor_id: ledgerIdentity.actor_id,
    validation_outcomes: outcomes,
    logical_sequence: ledgerIdentity.logical_sequence
  });
}

// --- Post-hoc ledger derivation (compatibility mapping / diagnostics / legacy fixtures ONLY) -----
//
// pr101fix: this function infers every stage strictly before the blocking status's own taxonomy
// position as VALID, purely from where that status sits in the taxonomy -- it never proves any of
// those stages' corresponding validators actually ran. That is precisely the defect a GitHub MCP
// architecture audit flagged in PR #101: "uma validação só pode ser marcada como VALID depois que
// o validator correspondente tiver sido efetivamente executado." execution-plan-engine.js no
// longer calls this function to build its own canonical ValidationLedger -- see validation-trace.js
// and buildOutcome()'s own real, progressive trace instead, which marks each stage only once its
// real corresponding gate has actually run.
//
// This function is kept only for: isolated tests of the taxonomy/precedence compatibility mapping
// itself; diagnostics that are explicitly labeled as inferred, never presented as the canonical
// record of what actually ran; and legacy fixtures that predate the real trace. It must never again
// become the source of the canonical ValidationLedger the Execution Plan Result exposes.
function deriveValidationLedgerFromStatus({ status, reasonCodes = [], ledgerIdentity = {} }) {
  const meta = getTaxonomyMetadata(status);
  const outcomes = [];
  let sequence = 0;

  if (!meta) {
    // An unrecognized status is fail-closed: every stage is treated as NOT_EVALUATED, and
    // SCHEMA itself is marked INVALID/VALIDATION_FAILED so the ledger still correctly reports a
    // blocker rather than silently claiming a clean pipeline.
    for (const stage of VALIDATION_STAGES) {
      const isFirst = stage === VALIDATION_STAGES[0];
      outcomes.push(buildValidationOutcome({
        validator_id: `${stage.toLowerCase()}_post_hoc_check`, validator_version: 'post_hoc_v1', validation_stage: stage,
        state: isFirst ? 'INVALID' : 'NOT_EVALUATED', status: isFirst ? 'VALIDATION_FAILED' : undefined,
        reason_codes: isFirst ? uniqueSorted(reasonCodes) : [], blocking: isFirst, terminal: isFirst, logical_sequence: sequence
      }));
      sequence += 1;
    }
  } else if (meta.blocking === false) {
    // WAITING_APPROVAL_REFERENCE / EXECUTION_PLAN_PREPARED_SIMULATION: every stage up to and
    // including meta.stage is VALID. For WAITING_APPROVAL_REFERENCE specifically, FINALIZATION
    // itself (the one stage genuinely not yet reached while waiting on a human) remains
    // NOT_EVALUATED -- a documented judgment call, not an error: approval has not yet confirmed
    // the plan may proceed even in simulation, so "the pipeline completed" is not yet true either.
    for (const stage of VALIDATION_STAGES) {
      const isWaitingFinalization = status === 'WAITING_APPROVAL_REFERENCE' && stage === 'FINALIZATION';
      outcomes.push(buildValidationOutcome({
        validator_id: `${stage.toLowerCase()}_post_hoc_check`, validator_version: 'post_hoc_v1', validation_stage: stage,
        state: isWaitingFinalization ? 'NOT_EVALUATED' : 'VALID', logical_sequence: sequence
      }));
      sequence += 1;
    }
  } else {
    const blockedIndex = VALIDATION_STAGES.indexOf(meta.stage);
    VALIDATION_STAGES.forEach((stage, index) => {
      let state;
      if (index < blockedIndex) state = 'VALID';
      else if (index === blockedIndex) state = 'INVALID';
      else state = 'NOT_EVALUATED';
      outcomes.push(buildValidationOutcome({
        validator_id: `${stage.toLowerCase()}_post_hoc_check`, validator_version: 'post_hoc_v1', validation_stage: stage,
        state, status: state === 'INVALID' ? status : undefined, severity: state === 'INVALID' ? meta.severity : undefined,
        reason_codes: state === 'INVALID' ? uniqueSorted(reasonCodes) : [], blocking: state === 'INVALID', terminal: state === 'INVALID',
        logical_sequence: index
      }));
    });
  }

  return buildValidationLedger({
    validation_ledger_id: ledgerIdentity.validation_ledger_id,
    execution_plan_request_id: ledgerIdentity.execution_plan_request_id === undefined ? null : ledgerIdentity.execution_plan_request_id,
    execution_plan_id: ledgerIdentity.execution_plan_id === undefined ? null : ledgerIdentity.execution_plan_id,
    tenant_id: ledgerIdentity.tenant_id,
    organization_id: ledgerIdentity.organization_id,
    project_id: ledgerIdentity.project_id,
    session_reference_id: ledgerIdentity.session_reference_id,
    agent_id: ledgerIdentity.agent_id,
    actor_id: ledgerIdentity.actor_id,
    validation_outcomes: outcomes,
    logical_sequence: ledgerIdentity.logical_sequence
  });
}

function outcomeStateForStage(ledger, stage) {
  const outcome = ledger.validation_outcomes.find((o) => o.validation_stage === stage);
  return outcome ? outcome.state : 'NOT_EVALUATED';
}

function isStageValid(ledger, stage) {
  return outcomeStateForStage(ledger, stage) === 'VALID';
}

module.exports = {
  adaptLegacyValidatorOutput,
  deriveValidationLedgerFromStatus,
  invokeValidatorHandler,
  isStageValid,
  outcomeStateForStage,
  runValidationPipeline
};

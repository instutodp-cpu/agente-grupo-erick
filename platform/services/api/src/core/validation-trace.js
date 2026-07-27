'use strict';

const { VALIDATION_STAGES, buildValidationOutcome } = require('./validation-outcome');
const { buildValidationLedger } = require('./validation-ledger');
const { getTaxonomyMetadata } = require('./validation-taxonomy');

// pr101fix: the honest, progressive alternative to validation-pipeline.js's
// deriveValidationLedgerFromStatus(), which infers every stage before the blocker as VALID purely
// from the final status's position in the taxonomy -- that proves nothing about whether the
// corresponding validator was actually executed. "Uma validação só pode ser marcada como VALID
// depois que o validator correspondente tiver sido efetivamente executado." A ValidationTrace is
// built by execution-plan-engine.js itself, calling markValidationValid/Invalid/NotApplicable
// immediately at (or right after) each of its own real gates, in the exact order they really run.
//
// Ordering: outcomes are recorded in the REAL chronological order the engine marks them, never
// canonical VALIDATION_STAGES order -- execution-plan-engine.js's own real gate order does not
// match the canonical stage order (AUTHORIZATION and EVIDENCE, for instance, are checked before
// TENANT/ORGANIZATION/PROJECT/SESSION in real code, but come after them in VALIDATION_STAGES).
// Because this engine is a synchronous, single-pass, early-return pipeline, nothing can ever be
// marked after a blocking mark (the function returns immediately once one fires) -- so
// chronological logical_sequence trivially satisfies ValidationLedger's own "nothing after the
// blocker" invariant, with no risk of a canonically-earlier-but-chronologically-later stage ending
// up marked VALID "after" a canonically-later-but-chronologically-earlier blocker.

function createValidationTrace() {
  return { marks: [], markedStages: new Set(), finalized: false };
}

function assertOpen(trace) {
  if (trace.finalized) throw new Error('validation_trace_already_finalized');
}

function assertKnownStage(stage) {
  if (!VALIDATION_STAGES.includes(stage)) throw new Error(`validation_trace_unknown_stage::${stage}`);
}

// ValidationState has no distinct "started" state (only NOT_EVALUATED/VALID/INVALID/
// NOT_APPLICABLE) -- this call transitions nothing. It exists for API symmetry with the suggested
// surface and as a documentation marker at the top of a gate a caller wants to make explicit;
// every real state transition happens atomically via one of the three mark* calls below.
function markValidationStarted(trace, stage) {
  assertOpen(trace);
  assertKnownStage(stage);
  return trace;
}

function markOnce(trace, stage, mark) {
  assertOpen(trace);
  assertKnownStage(stage);
  if (trace.markedStages.has(stage)) throw new Error(`validation_trace_stage_already_marked::${stage}`);
  trace.marks.push(mark);
  trace.markedStages.add(stage);
  return trace;
}

function markValidationValid(trace, stage, metadata) {
  return markOnce(trace, stage, { stage, state: 'VALID', metadata: metadata || null });
}

function markValidationNotApplicable(trace, stage, metadata) {
  return markOnce(trace, stage, { stage, state: 'NOT_APPLICABLE', metadata: metadata || null });
}

function markValidationInvalid(trace, stage, status, reasonCodes, metadata) {
  assertOpen(trace);
  assertKnownStage(stage);
  // Unlike markValidationValid/NotApplicable, a second markValidationInvalid for an
  // already-marked stage is a silent no-op rather than a throw -- attributeBlockingStatus() below
  // may call this defensively after the engine's own explicit mark already fired for the same
  // real gate, and that must never crash a blocked evaluation.
  if (trace.markedStages.has(stage)) return trace;
  trace.marks.push({
    stage, state: 'INVALID', status, reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [], metadata: metadata || null
  });
  trace.markedStages.add(stage);
  return trace;
}

// Several of execution-plan-engine.js's own gates return a status determined entirely by runtime
// data (checkBinding's per-reference tenant/organization/agent/project/session dispatch, the
// provenance/scope/snapshot cross-check helpers) -- the call site cannot know in advance which of
// several possible stages will be implicated. Given the final `status` a blocked evaluation
// produced, this attributes it to the one taxonomy stage it genuinely belongs to (via
// validation-taxonomy.js's own already-tested TAXONOMY_METADATA), but only when the engine has not
// already explicitly marked some stage as the blocker itself -- an explicit engine-side
// markValidationInvalid always wins over this fallback attribution, never the reverse.
function attributeBlockingStatus(trace, status, reasonCodes) {
  if (trace.marks.some((mark) => mark.state === 'INVALID')) return trace;
  const meta = getTaxonomyMetadata(status);
  if (!meta || meta.blocking !== true) return trace;
  if (trace.markedStages.has(meta.stage)) return trace;
  return markValidationInvalid(trace, meta.stage, status, reasonCodes, { attributed: true });
}

// Finalizes the trace into a real ValidationLedger: every stage the engine explicitly marked
// becomes its own ValidationOutcome, in the real chronological order it was marked; every one of
// the 22 canonical stages the engine never reached at all is appended, in canonical order, as an
// explicit NOT_EVALUATED outcome -- never silently omitted, and never inferred as anything else.
function finalizeValidationTrace(trace, identity) {
  assertOpen(trace);
  const outcomes = trace.marks.map((mark, index) => buildValidationOutcome({
    validator_id: `${mark.stage.toLowerCase()}_engine_trace`,
    validator_version: 'validation_trace_v1',
    validation_stage: mark.stage,
    state: mark.state,
    status: mark.state === 'INVALID' ? mark.status : undefined,
    severity: mark.state === 'INVALID' ? (getTaxonomyMetadata(mark.status) || {}).severity : undefined,
    reason_codes: mark.state === 'INVALID' ? mark.reasonCodes : [],
    blocking: mark.state === 'INVALID',
    terminal: mark.state === 'INVALID',
    logical_sequence: index
  }));
  let sequence = outcomes.length;
  for (const stage of VALIDATION_STAGES) {
    if (trace.markedStages.has(stage)) continue;
    outcomes.push(buildValidationOutcome({
      validator_id: `${stage.toLowerCase()}_engine_trace`, validator_version: 'validation_trace_v1',
      validation_stage: stage, state: 'NOT_EVALUATED', logical_sequence: sequence
    }));
    sequence += 1;
  }
  trace.finalized = true;
  return buildValidationLedger({ ...identity, validation_outcomes: outcomes });
}

module.exports = {
  attributeBlockingStatus,
  createValidationTrace,
  finalizeValidationTrace,
  markValidationInvalid,
  markValidationNotApplicable,
  markValidationStarted,
  markValidationValid
};

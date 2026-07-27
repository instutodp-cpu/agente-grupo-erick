'use strict';

// A validation state answers exactly one question for exactly one validator/stage pair: did the
// corresponding validator actually run, and if so, what did it find? Four values, never a plain
// boolean -- a boolean cannot distinguish "not evaluated" from "evaluated and valid" from
// "evaluated and invalid" from "evaluated but does not apply here", and PR #98-#100 all shipped
// validation flags that collapsed those four distinct conditions into a single `true`/`false`
// that was frequently wrong (see HERMES_VALIDATION_SEMANTICS_ARCHITECTURE_GATES.md "Problema 1").
const VALIDATION_STATES = Object.freeze(['NOT_EVALUATED', 'VALID', 'INVALID', 'NOT_APPLICABLE']);

const DEFAULT_VALIDATION_STATE = 'NOT_EVALUATED';

function isValidationState(value) {
  return typeof value === 'string' && VALIDATION_STATES.includes(value);
}

// A validation state is immutable once produced -- there is no "transition" API that mutates a
// state value in place; a new value is always used instead. This function exists only to make
// that rule explicit and testable: certain transitions are semantically permitted (a state may
// always be reset to NOT_EVALUATED conceptually when re-deriving a ledger from scratch), but a
// terminal-blocked pipeline must never "upgrade" an already-produced state from INVALID/
// NOT_EVALUATED to VALID for the same validator/stage without a genuinely new evaluation -- there
// is no such mutation path anywhere in this module by construction, since every value here is a
// frozen primitive string, not an object with internal state.
const ALLOWED_TRANSITIONS = Object.freeze({
  NOT_EVALUATED: Object.freeze(['VALID', 'INVALID', 'NOT_APPLICABLE']),
  VALID: Object.freeze([]),
  INVALID: Object.freeze([]),
  NOT_APPLICABLE: Object.freeze([])
});

// A transition is "permitted" only from NOT_EVALUATED to one of the three terminal states -- once
// a validator has actually run and produced VALID/INVALID/NOT_APPLICABLE, that outcome is final
// for that validator/stage/evaluation; a fresh evaluation produces a fresh ValidationOutcome
// rather than mutating an old one.
function isAllowedTransition(fromState, toState) {
  if (!isValidationState(fromState) || !isValidationState(toState)) return false;
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

module.exports = {
  ALLOWED_TRANSITIONS,
  DEFAULT_VALIDATION_STATE,
  VALIDATION_STATES,
  isAllowedTransition,
  isValidationState
};

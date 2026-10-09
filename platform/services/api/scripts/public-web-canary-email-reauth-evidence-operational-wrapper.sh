#!/bin/sh
set -eu
ENV_FILE="${HERMES_REAUTH_POSTGRES_ENV_FILE:-/home/hermesadmin/.hermes-write-postgres.env}"
INPUT_FILE="${HERMES_REAUTH_EVIDENCE_INPUT_FILE:-}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
fail(){ printf '%s\n' "{\"ok\":false,\"status\":\"EMAIL_REAUTH_EVIDENCE_OPERATIONAL_WRAPPER_BLOCKED\",\"reason\":\"$1\",\"execution_authorized\":false,\"external_network_called\":false,\"production_allowed\":false}" >&2; exit 2; }
[ "$#" -eq 0 ] || fail arguments_not_allowed
[ -f "$ENV_FILE" ] || fail environment_file_missing
[ "$(stat -c '%a' "$ENV_FILE" 2>/dev/null || printf unknown)" = 600 ] || fail environment_file_permissions_invalid
[ -n "$INPUT_FILE" ] || fail evidence_input_file_required
[ -f "$INPUT_FILE" ] || fail evidence_input_file_missing
[ "$(stat -c '%a' "$INPUT_FILE" 2>/dev/null || printf unknown)" = 600 ] || fail evidence_input_permissions_invalid
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
exec node "$SCRIPT_DIR/public-web-canary-email-reauth-evidence.js"

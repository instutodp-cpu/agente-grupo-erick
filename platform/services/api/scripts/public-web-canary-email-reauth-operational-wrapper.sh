#!/bin/sh
set -eu
ENV_FILE="${HERMES_REAUTH_POSTGRES_ENV_FILE:-/home/hermesadmin/.hermes-public-web-canary-staging-postgres.env}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -ne 0 ]; then
  printf '%s\n' '{"ok":false,"status":"EMAIL_REAUTH_OPERATIONAL_WRAPPER_BLOCKED","reason":"arguments_not_allowed","execution_authorized":false,"external_network_called":false,"production_allowed":false}' >&2
  exit 2
fi
if [ ! -f "$ENV_FILE" ]; then
  printf '%s\n' '{"ok":false,"status":"EMAIL_REAUTH_OPERATIONAL_WRAPPER_BLOCKED","reason":"environment_file_missing","execution_authorized":false,"external_network_called":false,"production_allowed":false}' >&2
  exit 2
fi
mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || printf 'unknown')
if [ "$mode" != "600" ]; then
  printf '%s\n' '{"ok":false,"status":"EMAIL_REAUTH_OPERATIONAL_WRAPPER_BLOCKED","reason":"environment_file_permissions_invalid","execution_authorized":false,"external_network_called":false,"production_allowed":false}' >&2
  exit 2
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
exec node "$SCRIPT_DIR/public-web-canary-email-reauth-prepare.js"

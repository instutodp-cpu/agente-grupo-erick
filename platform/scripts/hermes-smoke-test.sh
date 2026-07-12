#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
FORBIDDEN_FIELDS='requiredAdapters,payload,rawMessage,userMessage,secret,token,env,internal,credentials'

resolve_binary() {
  local candidate
  for candidate in "$@"; do
    if [[ "$candidate" == /* || "$candidate" == [A-Za-z]:* ]]; then
      if [[ -x "$candidate" ]]; then
        printf '%s' "$candidate"
        return 0
      fi
    elif command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done

  return 1
}

PYTHON_BIN="$(resolve_binary \
  python3 \
  python)"

CURL_BIN="$(resolve_binary \
  curl \
  curl.exe \
  "/mnt/c/Windows/System32/curl.exe" \
  "/c/Windows/System32/curl.exe")"

if [[ -z "$PYTHON_BIN" ]]; then
  printf 'smoke test failed: python runtime not found\n' >&2
  exit 1
fi

if [[ -z "$CURL_BIN" ]]; then
  printf 'smoke test failed: curl binary not found\n' >&2
  exit 1
fi

log() {
  printf '%s\n' "$*"
}

request_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local step="${4:-$method $path}"
  local response_file
  local http_status
  local curl_exit
  local body_bytes

  response_file="$(mktemp)"

  if [[ -n "$body" ]]; then
    set +e
    http_status="$("$CURL_BIN" --silent --show-error --output "$response_file" --write-out "%{http_code}" -X "$method" \
      -H 'Content-Type: application/json' \
      -d "$body" \
      "$API_BASE_URL$path")"
    curl_exit=$?
    set -e
  else
    set +e
    http_status="$("$CURL_BIN" --silent --show-error --output "$response_file" --write-out "%{http_code}" "$API_BASE_URL$path")"
    curl_exit=$?
    set -e
  fi

  body_bytes="$(wc -c < "$response_file" | tr -d '[:space:]')"
  printf 'smoke request: step=%s method=%s path=%s http_status=%s body_bytes=%s\n' \
    "$step" "$method" "$path" "$http_status" "$body_bytes" >&2

  if [[ "$curl_exit" -ne 0 ]]; then
    rm -f "$response_file"
    printf 'smoke test failed: request failed (step=%s curl_exit=%s http_status=%s body_bytes=%s)\n' \
      "$step" "$curl_exit" "$http_status" "$body_bytes" >&2
    exit 1
  fi

  if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    rm -f "$response_file"
    printf 'smoke test failed: unexpected HTTP status (step=%s http_status=%s body_bytes=%s)\n' \
      "$step" "$http_status" "$body_bytes" >&2
    exit 1
  fi

  cat "$response_file"
  rm -f "$response_file"
}

json_get() {
  local json="$1"
  local path="$2"

  JSON_INPUT="$json" "$PYTHON_BIN" - "$path" <<'PY'
import json
import os
import sys

path = sys.argv[1].split(".")
value = json.loads(os.environ["JSON_INPUT"])
for key in path:
    if not isinstance(value, dict) or key not in value:
        sys.exit(2)
    value = value[key]

if value is None:
    sys.stdout.write("null")
elif isinstance(value, bool):
    sys.stdout.write("true" if value else "false")
elif isinstance(value, (dict, list)):
    sys.stdout.write(json.dumps(value, separators=(",", ":")))
else:
    sys.stdout.write(str(value))
PY
}

assert_has_field() {
  local json="$1"
  local field="$2"
  JSON_INPUT="$json" "$PYTHON_BIN" - "$field" <<'PY'
import json
import os
import sys

field = sys.argv[1]
data = json.loads(os.environ["JSON_INPUT"])
if field not in data:
    sys.exit(3)
PY
}

assert_missing_fields() {
  local json="$1"
  local fields="$2"

  JSON_INPUT="$json" "$PYTHON_BIN" - "$fields" <<'PY'
import json
import os
import sys

forbidden = [field for field in sys.argv[1].split(",") if field]
data = json.loads(os.environ["JSON_INPUT"])
for field in forbidden:
    if field in data:
        print(f"Forbidden field present: {field}", file=sys.stderr)
        sys.exit(4)
PY
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local message="$3"

  if [[ "$actual" != "$expected" ]]; then
    printf 'smoke test failed: %s (expected=%s actual=%s)\n' "$message" "$expected" "$actual" >&2
    exit 1
  fi
}

assert_health() {
  local health
  health="$(request_json GET /health "" "health")"
  assert_equal "$(json_get "$health" status)" "ok" "health status"
  log "health: ok"
}

check_public_message_response() {
  local response="$1"
  assert_equal "$(json_get "$response" confirmation_required)" "true" "message confirmation_required"
  assert_has_field "$response" confirmation
  assert_missing_fields "$response" "$FORBIDDEN_FIELDS"
}

check_public_confirm_response() {
  local response="$1"
  assert_equal "$(json_get "$response" executed)" "false" "confirm executed"
  assert_missing_fields "$response" "$FORBIDDEN_FIELDS"
}

run_message_confirm_cycle() {
  local domain_name="$1"
  local message_text="$2"
  local expected_domain="$3"
  local expected_intent="$4"

  local message_response
  message_response="$(request_json POST /message "$(printf '{"message":"%s"}' "$message_text")" "$domain_name message")"
  assert_equal "$(json_get "$message_response" domain)" "$expected_domain" "$domain_name domain"
  assert_equal "$(json_get "$message_response" intent)" "$expected_intent" "$domain_name intent"
  assert_equal "$(json_get "$message_response" status)" "planned" "$domain_name status"
  check_public_message_response "$message_response"

  local confirmation_id
  confirmation_id="$(json_get "$message_response" confirmation.id)"
  assert_equal "$(printf '%s' "$confirmation_id" | sed -n 's/^confirm_[a-f0-9]\{32\}$/ok/p')" "ok" "$domain_name confirmation_id"
  log "$domain_name: message confirmed"

  local pending_response
  pending_response="$(request_json GET "/confirm/$confirmation_id" "" "$domain_name pending")"
  assert_equal "$(json_get "$pending_response" status)" "pending" "$domain_name pending status"
  assert_equal "$(json_get "$pending_response" executed)" "false" "$domain_name pending executed"
  check_public_confirm_response "$pending_response"

  local approved_response
  approved_response="$(request_json POST /confirm "$(printf '{"confirmation_id":"%s","message":"sim"}' "$confirmation_id")" "$domain_name approve")"
  assert_equal "$(json_get "$approved_response" confirmation_status)" "approved" "$domain_name approved status"
  assert_equal "$(json_get "$approved_response" executed)" "false" "$domain_name approved executed"
  check_public_confirm_response "$approved_response"

  local execution_status
  execution_status="$(json_get "$approved_response" execution_status)"
  assert_equal "$execution_status" "simulated" "$domain_name execution_status"
  assert_equal "$(json_get "$approved_response" simulated)" "true" "$domain_name simulated"
  assert_equal "$(json_get "$approved_response" execution_policy)" "not_implemented" "$domain_name execution_policy"
  assert_equal "$(json_get "$approved_response" adapter_mode)" "mock" "$domain_name adapter_mode"
  assert_equal "$(json_get "$approved_response" adapter_id)" "mock-compras" "$domain_name adapter_id"
  assert_missing_fields "$approved_response" "requiredAdapters,payload,rawMessage,userMessage"
  log "$domain_name: simulated ok"

  local approved_again
  approved_again="$(request_json GET "/confirm/$confirmation_id" "" "$domain_name approved recheck")"
  assert_equal "$(json_get "$approved_again" status)" "approved" "$domain_name approved status recheck"
  assert_equal "$(json_get "$approved_again" executed)" "false" "$domain_name approved executed recheck"
  check_public_confirm_response "$approved_again"
  log "$domain_name: confirm cycle ok"
}

run_message_only() {
  local domain_name="$1"
  local message_text="$2"
  local expected_domain="$3"
  local expected_intent="$4"

  local response
  response="$(request_json POST /message "$(printf '{"message":"%s"}' "$message_text")" "$domain_name message")"
  assert_equal "$(json_get "$response" domain)" "$expected_domain" "$domain_name domain"
  assert_equal "$(json_get "$response" intent)" "$expected_intent" "$domain_name intent"
  assert_equal "$(json_get "$response" status)" "planned" "$domain_name status"
  check_public_message_response "$response"
  log "$domain_name: message ok"
}

assert_missing_confirmation() {
  local response
  response="$(request_json POST /confirm '{"confirmation_id":"confirm_missing_smoke","message":"sim"}' "missing confirmation")"
  assert_equal "$(json_get "$response" status)" "not_found" "missing confirmation status"
  assert_equal "$(json_get "$response" executed)" "false" "missing confirmation executed"
  assert_missing_fields "$response" "$FORBIDDEN_FIELDS"
  log "missing confirmation: not_found ok"
}

main() {
  assert_health
  run_message_confirm_cycle "compras" "consultar compras" "compras" "consultar_compras"
  run_message_only "financeiro" "consultar financeiro e saldo" "financeiro" "consultar_financeiro"
  run_message_only "treinamento" "consultar treinamento" "treinamento" "consultar_treinamento"
  run_message_only "marketing" "planejar marketing" "marketing" "planejar_marketing"
  run_message_only "desenvolvimento" "bug no deploy" "desenvolvimento" "desenvolvimento"
  assert_missing_confirmation
  log "smoke test: ok"
}

main "$@"

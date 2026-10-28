#!/usr/bin/env bash
# Hermes personal staging: explicit root-only, 2 static files, narrow
# Caddy route expansion. No DB/API changes, no ZIP uploads, no PR merge.
set -Eeuo pipefail
mode="--check"
if [[ "$#" -gt 0 ]]; then mode="$1"; fi
[[ "$mode" == "--check" || "$mode" == "--apply" ]] || { echo 'usage: script --check|--apply'; exit 2; }
source_dir="/home/hermesadmin/hermes-personal-preview-pr564"
target_dir="/var/www/hermes-brain-staging/brain"
caddy_file="/etc/caddy/Caddyfile"
expected_html="35ed774a99972d182ed5bb3b4f21012973fe15fa"
expected_js="de0b0b8d043d3bac8b620ccb09c77310bc1344eb"
for binary in git python3 caddy mktemp cp install; do command -v "$binary" >/dev/null || exit 3; done
[[ -f "$source_dir/personal.html" && -f "$source_dir/personal-app.js" ]] || { echo 'preview_source_missing'; exit 4; }
[[ ! -L "$source_dir/personal.html" && ! -L "$source_dir/personal-app.js" ]] || { echo 'symlink_denied'; exit 4; }
[[ "$(git hash-object "$source_dir/personal.html")" == "$expected_html" ]] || { echo 'preview_html_digest_mismatch'; exit 4; }
[[ "$(git hash-object "$source_dir/personal-app.js")" == "$expected_js" ]] || { echo 'preview_js_digest_mismatch'; exit 4; }
[[ -f "$target_dir/index.html" && -f "$target_dir/app.js" && -f "$caddy_file" ]] || { echo 'existing_staging_contract_missing'; exit 4; }
[[ ! -e "$target_dir/personal.html" && ! -e "$target_dir/personal-app.js" ]] || { echo 'preview_exists_refuse_overwrite'; exit 4; }
if [[ "$mode" == "--apply" && "$EUID" -ne 0 ]]; then echo 'requires_root_operator'; exit 5; fi
scratch="$(mktemp -d)"
committed=0
backup=''
cleanup() {
  code="$?"
  if [[ "$code" -ne 0 && "$committed" -eq 1 ]]; then
    cp -p "$backup/Caddyfile" "$caddy_file" || true
    rm -f "$target_dir/personal.html" "$target_dir/personal-app.js"
    caddy reload --config "$caddy_file" --adapter caddyfile >/dev/null 2>&1 || true
    echo 'preview_rolled_back_due_to_failure'
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
python3 - "$caddy_file" "$scratch/Caddyfile" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
needle='path /brain/ /brain/app.js'
root='root * /var/www/hermes-brain-staging'
if text.count(needle)!=1 or text.count(root)!=1:
    raise SystemExit('caddy_route_precondition_failed')
text=text.replace(needle,'path /brain/ /brain/app.js /brain/personal.html /brain/personal-app.js')
Path(sys.argv[2]).write_text(text)
PY
caddy validate --config "$scratch/Caddyfile" --adapter caddyfile >/dev/null
if [[ "$mode" == "--check" ]]; then
  echo 'PREVIEW_DRY_RUN_OK: source hashes match, Caddy route validates, production untouched'
  exit 0
fi
mkdir -p /var/backups
backup="$(mktemp -d /var/backups/hermes-personal-preview.XXXXXXXX)"
cp -p "$caddy_file" "$backup/Caddyfile"
committed=1
install -m 0644 "$source_dir/personal.html" "$target_dir/personal.html"
install -m 0644 "$source_dir/personal-app.js" "$target_dir/personal-app.js"
install -m 0644 "$scratch/Caddyfile" "$caddy_file"
caddy reload --config "$caddy_file" --adapter caddyfile >/dev/null
for uri in /brain/personal.html /brain/personal-app.js; do
  code="$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://hermes-staging.grupoerick.tech$uri")"
  [[ "$code" == "200" ]] || { echo 'staging_http_validation_failed'; exit 6; }
done
committed=0
echo "PERSONAL_LOGIN_STAGING_PREVIEW_DEPLOYED; config_backup=$backup"
echo 'NO_PRIVATE_RPCS_OR_IMPORTS_ACTIVATED'

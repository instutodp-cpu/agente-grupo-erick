#!/usr/bin/env bash
# Hermes Brain: strictly scoped STAGING static page deployment.
# Run manually via an authorized privileged console, after reviewing PR #564.
# No deployment to production; no Supabase grants or membership changes.
set -Eeuo pipefail

SITE='hermes-staging.grupoerick.tech'
CADDYFILE='/etc/caddy/Caddyfile'
DOCROOT='/var/www/hermes-brain-staging'
SOURCE_DIR="${1:-}"
EXPECTED_COMMIT='f629b79540f9ab252e177bff614f4b4157e9988d'
CURRENT_SHA="${2:-}"
BACKUP=''
CHANGED=0
ROLLED_BACK=0
function die(){ printf 'DENIED: %s\n' "$*" >&2; exit 1; }
function rollback() {
  local status=$?
  if (( status != 0 && CHANGED == 1 && ROLLED_BACK == 0 )) && [[ -f "$BACKUP" ]]; then
    ROLLED_BACK=1
    cp -p "$BACKUP" "$CADDYFILE" || :
    caddy validate --adapter caddyfile --config "$CADDYFILE" >/dev/null 2>&1 || :
    systemctl reload caddy || :
    printf 'ROLLBACK: restored original Caddyfile. Verify existing routes.\n' >&2
  fi
}
trap rollback EXIT
[[ "$(id -u)" == 0 ]] || die 'This operation requires the authorized root console. Never use indirect privilege escalation.'
[[ -n "$SOURCE_DIR" && -d "$SOURCE_DIR" ]] || die 'Pass a staging asset directory containing index.html and app.js'
[[ "$CURRENT_SHA" == "$EXPECTED_COMMIT" ]] || die 'Expected reviewed commit f629b795; inspect and update this gate for later HEAD only after re-review.'
[[ "$(hostname)" == 'srv1908789' ]] || die 'Unexpected host'
[[ -f "$CADDYFILE" ]] || die 'Existing Caddyfile missing'
[[ -f "$SOURCE_DIR/index.html" && -f "$SOURCE_DIR/app.js" ]] || die 'Staging assets missing'
[[ ! -L "$SOURCE_DIR/index.html" && ! -L "$SOURCE_DIR/app.js" ]] || die 'Symlink asset refused'
grep -Fq 'https://asceucchdnuoaqgdjbtg.supabase.co' "$SOURCE_DIR/index.html" || die 'Wrong Supabase project'
grep -Fq 'hermes_brain_submit_note' "$SOURCE_DIR/app.js" || die 'Expected API missing'
grep -Fq 'hermes_brain_search' "$SOURCE_DIR/app.js" || die 'Expected API missing'
test "$(curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' "https://$SITE/health")" == '200' || die 'Existing health check failed'
python3 - "$CADDYFILE" <<'PY'
from pathlib import Path
import sys
s = Path(sys.argv[1]).read_text()
needle = '\t\thandle {\n\t\t\trespond "not found" 404'
assert s.count('hermes-staging.grupoerick.tech {') == 1, 'Unexpected staging host'
assert s.count(needle) == 1, 'Unexpected final deny handler'
assert 'handle @hermes_brain_static {' not in s, 'Already installed; inspect manually before replay'
PY
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="${CADDYFILE}.brain-staging-pre-${backup_timestamp}"
[[ ! -e "$BACKUP" ]] || die 'Backup collision'
cp -p "$CADDYFILE" "$BACKUP"
# Copy static assets before exposing the route; no admin key, secrets or mutable CDN URLs.
install -d -m 0755 "$DOCROOT" "$DOCROOT/brain"
install -m 0644 "$SOURCE_DIR/index.html" "$DOCROOT/brain/index.html"
install -m 0644 "$SOURCE_DIR/app.js" "$DOCROOT/brain/app.js"
# Arm rollback before changing the privileged configuration file.
CHANGED=1
python3 - "$CADDYFILE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
s = path.read_text()
needle = '\t\thandle {\n\t\t\trespond "not found" 404'
new = '''\t\t@hermes_brain_static {
            method GET
            path /brain/ /brain/app.js
        }
        handle @hermes_brain_static {
            root * /var/www/hermes-brain-staging
            header Cache-Control "private, no-store"
            header Referrer-Policy "no-referrer"
            header X-Content-Type-Options "nosniff"
            header X-Frame-Options "DENY"
            header Content-Security-Policy "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; connect-src https://asceucchdnuoaqgdjbtg.supabase.co; img-src 'self' data:; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"
            file_server
        }
'''
assert s.count(needle) == 1
path.write_text(s.replace(needle, new + needle))
PY
caddy validate --adapter caddyfile --config "$CADDYFILE"
systemctl reload caddy
test "$(curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' "https://$SITE/health")" == '200' || die 'Health route regression'
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$SITE/brain/")" == '200' || die 'Portal route failure'
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$SITE/brain/app.js")" == '200' || die 'Client script route failure'
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "https://$SITE/unregistered-brain-path")" == '404' || die 'Default deny regression'
CHANGED=0
trap - EXIT
printf 'STAGING ONLY: static brain login deployed. Backup retained at %s\n' "$BACKUP"
printf 'Auth URL Configuration and verified tenant onboarding are still separate administrative gates.\n'

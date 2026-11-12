#!/usr/bin/env bash
# Staging-only update of the already-present /brain/ files; never touch Caddy.
set -Eeuo pipefail
[[ "$(id -u)" == 0 ]] || { echo 'DENIED: authorized root console required' >&2; exit 1; }
[[ "$(hostname)" == 'srv1908789' ]] || { echo 'DENIED: unexpected VPS host' >&2; exit 1; }
SOURCE="${1:-}"
ROOT='/var/www/hermes-brain-staging/brain'
[[ -d "$SOURCE" && -d "$ROOT" && ! -L "$SOURCE/index.html" &&
   ! -L "$SOURCE/app.js" && -f "$SOURCE/index.html" && -f "$SOURCE/app.js" ]] ||
 { echo 'DENIED: staging source/target absent' >&2; exit 1; }
[[ "$(sha256sum "$SOURCE/index.html" | cut -d' ' -f1)" == '62bc626fec449226da7162e1a531d20d2e892abe6eaece4749f1b67d907f1858' ]] ||
 { echo 'DENIED: unreviewed HTML bytes' >&2; exit 1; }
[[ "$(sha256sum "$SOURCE/app.js" | cut -d' ' -f1)" == '4a7056816d2c2e7ca7777e65cb955b51fdc026371a706e05dedc4d3ca476c6e8' ]] ||
 { echo 'DENIED: unreviewed JS bytes' >&2; exit 1; }
grep -Fq 'hermes_brain_get_attested_automemory' "$SOURCE/app.js" ||
 { echo 'DENIED: missing owner-only RPC' >&2; exit 1; }
grep -Fq 'publishAttested' "$SOURCE/index.html" ||
 { echo 'DENIED: missing explicit owner action' >&2; exit 1; }
[[ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/health)" == '200' ]] ||
 { echo 'DENIED: staging health route unhealthy' >&2; exit 1; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/var/www/hermes-brain-staging/backup-brain-${STAMP}"
[[ ! -e "$BACKUP" ]] || exit 1
mkdir -m 0700 "$BACKUP"
cp -p "$ROOT/index.html" "$BACKUP/index.html"
cp -p "$ROOT/app.js" "$BACKUP/app.js"
ROLLBACK=1
rollback(){
 if [[ "${ROLLBACK}" == '1' ]]; then
  cp -p "$BACKUP/index.html" "$ROOT/index.html"
  cp -p "$BACKUP/app.js" "$ROOT/app.js"
  echo 'ROLLBACK: original staging assets restored' >&2
 fi
}
trap rollback EXIT
install -m 0644 "$SOURCE/index.html" "$ROOT/index.html"
install -m 0644 "$SOURCE/app.js" "$ROOT/app.js"
[[ "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/brain/)" == '200' &&
   "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/brain/app.js)" == '200' &&
   "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/health)" == '200' ]] ||
 { echo 'DENIED: staging route regression' >&2; exit 1; }
[[ "$(sha256sum "$ROOT/app.js" | cut -d' ' -f1)" == '4a7056816d2c2e7ca7777e65cb955b51fdc026371a706e05dedc4d3ca476c6e8' ]] || exit 1
ROLLBACK=0
trap - EXIT
echo 'STAGING_ONLY_BRAIN_OWNER_PUBLICATION_UI_READY'
echo "Backup retained privately: $BACKUP"

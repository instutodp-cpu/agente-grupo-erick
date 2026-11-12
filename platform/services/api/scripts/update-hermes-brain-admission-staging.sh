#!/usr/bin/env bash
# Staging-only atomicity-aware static update: portal admission gate 041.
# Run exclusively from an explicitly authorized administrative root console.
# This does not grant tenant access, change Auth, change the Caddyfile, or deploy production.
set -Eeuo pipefail
DOCROOT=/var/www/hermes-brain-staging/brain
SOURCE="${1:-/home/hermesadmin/hermes-brain-staging/admission-041}"
OLD_INDEX_SHA=51bb4690007e5cffac5130f4fa937532880fab885f1002eec495bc283a46369a
OLD_APP_SHA=075f28a491296408343baa852131707d8c6fa07eaee616eedb9facba44718111
NEW_INDEX_SHA=f5eec8f5020bb7f0e2fcddd603140bf6a9fc924d05f8bae8172b12caa185a103
NEW_APP_SHA=7a21fe8e6d834153d9a24be12f9f7579b68ee99b23cedfd3efe67119e4015710
BACKUP=''
CHANGED=0
die(){ printf 'DENIED: %s\n' "$*" >&2; exit 1; }
hash(){ sha256sum "$1" | cut -d' ' -f1; }
rollback(){
  code=$?
  if (( code != 0 && CHANGED == 1 )) && [[ -n "$BACKUP" && -d "$BACKUP" ]]; then
    install -m 0644 "$BACKUP/index.html" "$DOCROOT/index.html" || :
    install -m 0644 "$BACKUP/app.js" "$DOCROOT/app.js" || :
    printf 'ROLLBACK: previous staging static files restored.\n' >&2
  fi
}
trap rollback EXIT
[[ "$(id -u)" == 0 ]] || die 'Authorized root console required'
[[ "$(hostname)" == 'srv1908789' ]] || die 'Unexpected host'
[[ "$SOURCE" == '/home/hermesadmin/hermes-brain-staging/admission-041' ]] || die 'Unexpected source directory'
[[ -f "$DOCROOT/index.html" && -f "$DOCROOT/app.js" ]] || die 'Published staging assets not found'
[[ -f "$SOURCE/index.html" && -f "$SOURCE/app.js" ]] || die 'Expected candidate assets missing'
[[ ! -L "$SOURCE/index.html" && ! -L "$SOURCE/app.js" ]] || die 'Symlink denied'
[[ "$(hash "$SOURCE/index.html")" == "$NEW_INDEX_SHA" ]] || die 'Index candidate hash mismatch'
[[ "$(hash "$SOURCE/app.js")" == "$NEW_APP_SHA" ]] || die 'Script candidate hash mismatch'
old_index="$(hash "$DOCROOT/index.html")"
old_app="$(hash "$DOCROOT/app.js")"
if [[ "$old_index" == "$NEW_INDEX_SHA" && "$old_app" == "$NEW_APP_SHA" ]]; then
  printf 'ALREADY INSTALLED: reviewed admission 041 staging assets.\n'
  exit 0
fi
[[ "$old_index" == "$OLD_INDEX_SHA" && "$old_app" == "$OLD_APP_SHA" ]] || die 'Unexpected current publication; manual review required'
test "$(curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/health)" == 200 || die 'Staging baseline unhealthy'
BACKUP="$(mktemp -d /var/www/hermes-brain-staging/.pre-admission-041.XXXXXXXX)"
chmod 0700 "$BACKUP"
cp -p "$DOCROOT/index.html" "$DOCROOT/app.js" "$BACKUP/"
CHANGED=1
# Update HTML first: earlier JS is still compatible until the new script is installed.
install -m 0644 "$SOURCE/index.html" "$DOCROOT/index.html"
install -m 0644 "$SOURCE/app.js" "$DOCROOT/app.js"
[[ "$(hash "$DOCROOT/index.html")" == "$NEW_INDEX_SHA" ]] || die 'Installed HTML integrity failed'
[[ "$(hash "$DOCROOT/app.js")" == "$NEW_APP_SHA" ]] || die 'Installed script integrity failed'
[[ "$(curl -fsS --max-time 10 https://hermes-staging.grupoerick.tech/brain/ | sha256sum | cut -d' ' -f1)" == "$NEW_INDEX_SHA" ]] || die 'Remote index mismatch'
[[ "$(curl -fsS --max-time 10 https://hermes-staging.grupoerick.tech/brain/app.js | sha256sum | cut -d' ' -f1)" == "$NEW_APP_SHA" ]] || die 'Remote app mismatch'
test "$(curl -fsS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/health)" == 200 || die 'Hermes health regression'
test "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://hermes-staging.grupoerick.tech/unregistered-brain-path)" == 404 || die 'Default-deny route regression'
CHANGED=0
trap - EXIT
printf 'SUCCESS: admission 041 portal published in staging only; root backup: %s\n' "$BACKUP"
printf 'USER MEMBERSHIPS AND TENANT STATE UNCHANGED.\n'

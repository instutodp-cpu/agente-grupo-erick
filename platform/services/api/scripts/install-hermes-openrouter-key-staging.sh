#!/usr/bin/env bash
# Hermes OpenRouter staging: hidden one-time key input on the VPS.
# Run interactively as hermesadmin; the secret never crosses GitHub/chat/logs.
set -euo pipefail
set +x
umask 077
[[ "$(id -un)" == hermesadmin ]] || { echo 'DENIED: execute as hermesadmin';exit 2; }
[[ -t 0 ]] || { echo 'DENIED: interactive terminal required';exit 2; }
DIR=/home/hermesadmin/.hermes-telegram/secret
FILE="$DIR/openrouter-api-key"
[[ -d "$DIR" && "$(stat -c %a "$DIR")" == 700 ]] ||
 { echo 'DENIED: protected directory';exit 2; }
[[ ! -e "$FILE" && ! -L "$FILE" ]] ||
 { echo 'DENIED: key file already exists; use a controlled rotation';exit 2; }
KEY=''
read -r -s -p 'Cole a API key do OpenRouter (entrada oculta): ' KEY
printf '\n'
if [[ ! "$KEY" =~ ^sk-or-[a-zA-Z0-9_-]{20,220}$ ]];then
 unset KEY
 echo 'DENIED: invalid key format (nothing stored)'
 exit 2
fi
TEMP="$(mktemp "$DIR/.openrouter-key.XXXXXXXX")"
trap 'unset KEY; rm -f "$TEMP"' EXIT
printf '%s' "$KEY" > "$TEMP"
unset KEY
chmod 600 "$TEMP"
ln "$TEMP" "$FILE"
rm -f "$TEMP"
[[ "$(stat -c %a "$FILE")" == 600 && "$(stat -c %U "$FILE")" == hermesadmin ]] ||
 { echo 'DENIED: key permissions';exit 2; }
echo 'HERMES_OPENROUTER_KEY_READY: 0600; no key displayed; deployment still gated'

#!/usr/bin/env bash
# Secure BotFather token + owner-pairing provisioning, on the authorized VPS only.
set -euo pipefail
umask 077
[[ "$(id -un)" == "hermesadmin" ]] || { echo 'Execute como hermesadmin na VPS.' >&2; exit 1; }
BASE="$HOME/.hermes-telegram"
SCRIPTS="$(cd "$(dirname "$0")" && pwd -P)"
mkdir -p -- "$BASE/secret" "$BASE/state"
chmod 700 -- "$BASE" "$BASE/secret" "$BASE/state"
TOKEN_FILE="$BASE/secret/token"
if [[ -e "$TOKEN_FILE" ]]; then
  [[ ! -L "$TOKEN_FILE" && -f "$TOKEN_FILE" && "$(stat -c %a "$TOKEN_FILE")" == 600 ]] || { echo 'Arquivo de token inseguro.' >&2; exit 1; }
  echo 'Token protegido já existe; não será exibido nem substituído.'
else
  echo 'Cole o token recebido do @BotFather no terminal da VPS (não no ChatGPT).'
  IFS= read -r -s -p 'Token do @Grupoerick_bot: ' TG_TOKEN </dev/tty
  echo
  if [[ ! "$TG_TOKEN" =~ ^[0-9]{5,16}:[A-Za-z0-9_-]{30,120}$ ]]; then
    echo 'Token inválido; interrompido.' >&2
    unset TG_TOKEN
    exit 1
  fi
  printf '%s' "$TG_TOKEN" > "$TOKEN_FILE"
  chmod 600 -- "$TOKEN_FILE"
  unset TG_TOKEN
  echo 'Token armazenado com permissão 0600.'
fi
if [[ -e "$BASE/state/owner.json" ]]; then
  echo 'Já existe proprietário vinculado; não gerarei outro código.'
else
  node "$SCRIPTS/hermes-telegram-pair.js"
fi
echo 'Apenas preparação: a resposta real exige iniciar o polling validado.'

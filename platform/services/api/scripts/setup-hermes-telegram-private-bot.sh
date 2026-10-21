#!/usr/bin/env bash
# Private provisioning on authorized Hostinger VPS. Do not send BotFather tokens in chats.
set -euo pipefail
umask 077
DIR="/home/hermesadmin/.hermes-telegram-private"
SOURCE="/home/hermesadmin/.hermes-github-live-read-pilot/bearer.token"
mkdir -p -- "$DIR"
chmod 700 -- "$DIR"
[[ "$(stat -c %a "$DIR")" == 700 ]] || exit 1
[[ -f "$SOURCE" && "$(stat -c %a "$SOURCE")" == 600 ]] || {
 echo "Existing Hermes machine identity unavailable or unsafe." >&2;exit 1;
}
if [[ ! -f "$DIR/bot.token" ]];then
 echo "Cole o token do BotFather neste terminal; a digitação ficará oculta."
 IFS= read -r -s -p "Token do @Grupoerick_bot: " BOT_TOKEN </dev/tty
 echo
 if [[ ! "$BOT_TOKEN" =~ ^[0-9]{5,16}:[A-Za-z0-9_-]{30,}$ ]];then
  echo "Formato do token inválido." >&2;unset BOT_TOKEN;exit 1
 fi
 printf '%s' "$BOT_TOKEN" > "$DIR/bot.token"
 chmod 600 "$DIR/bot.token"
 unset BOT_TOKEN
fi
if [[ ! -f "$DIR/machine.bearer" ]];then
 cp "$SOURCE" "$DIR/machine.bearer"
 chmod 600 "$DIR/machine.bearer"
fi
if [[ ! -f "$DIR/state.json" ]];then
 HERMES_TELEGRAM_PRIVATE_DIR="$DIR" node <<'NODE'
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const dir=process.env.HERMES_TELEGRAM_PRIVATE_DIR;
 const code=crypto.randomBytes(16).toString('base64url');
 fs.writeFileSync(path.join(dir,'pairing.json'),
  JSON.stringify({code,expires_at_ms:Date.now()+30*60*1000})+'\n',
  {mode:0o600});
 console.log('Abra @Grupoerick_bot no Telegram e envie /start '+code);
 console.log('Pareamento válido por 30 minutos. Não envie o código ao ChatGPT.');
NODE
else
 echo "Usuário Telegram já vinculado; não alterei a identidade aprovada."
fi
echo "Credenciais protegidas em disco. Inicie o processo de polling separadamente."
#!/usr/bin/env bash
# Non-mutating staging-only live preflight: exercises the SAME reader as Telegram.
# Requires a separately confirmed Supabase session-pooler host and private login.
set -Eeuo pipefail
umask 077
SHA="${1:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo BRAIN_INVALID_HEAD; exit 2; }
[[ "$(id -un)" == hermesadmin ]] || { echo BRAIN_OPERATOR_DENIED; exit 2; }
BASE=/home/hermesadmin/.hermes-telegram
PASS="$BASE/secret/brain-telegram-password"
POOL="$BASE/secret/brain-pooler-host"
CA=/home/hermesadmin/supabase-staging-root-ca.pem
REPO=/home/hermesadmin/hermes-telegram-pr563
fail(){ echo "BRAIN_LIVE_PREFLIGHT_DENIED:$1" >&2;exit 1; }
for f in "$PASS" "$POOL" "$CA"; do
 [[ -f "$f" && ! -L "$f" && "$(stat -c %a "$f")" == 600 ]] ||
   fail private_file_missing_or_unsafe
done
HOST="$(tr -d '\r\n' <"$POOL")"
[[ "$HOST" =~ ^aws-[0-9]+-sa-east-1\.pooler\.supabase\.com$ ]] ||
 fail project_session_pooler_host_invalid
[[ "$(docker inspect hermes-telegram-private-v1 --format '{{.State.Health.Status}}')" == healthy ]] ||
 fail existing_bot_unhealthy
[[ "$(docker ps --format '{{.Names}}' | grep -c '^hermes-telegram-private-' || :)" == 1 ]] ||
 fail multiple_pollers
git -C "$REPO" fetch --depth 1 -q origin "$SHA" || fail git_fetch
[[ "$(git -C "$REPO" rev-parse FETCH_HEAD)" == "$SHA" ]] || fail git_expected_head
WORK="$(mktemp -d "$BASE/.brain-check.XXXXXXXX")"
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO" archive "$SHA" platform/services/api | tar -x -C "$WORK"
node --check "$WORK/platform/services/api/src/runtime/hermes-brain-telegram-reader.js"
node --check "$WORK/platform/services/api/scripts/run-hermes-telegram-private.js"
IMAGE="hermes-telegram-brain:staging-${SHA:0:12}"
docker build --pull=false -q -t "$IMAGE" -f "$WORK/platform/services/api/Dockerfile" "$WORK/platform/services/api" >/dev/null
docker run --rm --network bridge --read-only --user 1000:1000 \
 --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 128m \
 -v "$PASS:/run/brain-password:ro" -v "$CA:/run/brain-ca:ro" \
 -e HERMES_BRAIN_POOLER_HOST="$HOST" \
 --entrypoint node "$IMAGE" -e '
const fs=require("node:fs");
const brain=require("/app/src/runtime/hermes-brain-telegram-reader");
const env={
 HERMES_BRAIN_LIVE_ENABLED:"true",HERMES_DEPLOYMENT_STAGE:"staging",
 HERMES_EXECUTION_ENABLED:"false",HERMES_EXECUTION_KILL_SWITCH:"true",
 HERMES_MISSION_INGRESS_ENABLED:"false",
 HERMES_BRAIN_POOLER_HOST:process.env.HERMES_BRAIN_POOLER_HOST,
 HERMES_BRAIN_PASSWORD_FILE:"/run/brain-password",HERMES_BRAIN_CA_FILE:"/run/brain-ca"
};
const readSecret=p=>fs.readFileSync(p,"utf8").trim();
(async()=>{
const reader=brain.createReader(env,{readSecret});
const results=await reader.query("conciliação");
if(results.length!==1||results[0].domain!=="financeiro")
 throw Error("BRAIN_LIVE_SOURCE_SCOPE_MISMATCH");
console.log("BRAIN_LIVE_RLS_VERIFIED matches=1");
})().catch(e=>{console.error("BRAIN_READ_DENIED_CODE="+String(e.code||e.message||"unknown").replace(/[^a-zA-Z_]/g,"").slice(0,72));process.exitCode=1});
'
echo "BRAIN_TELEGRAM_PREDEPLOY_VERIFIED $SHA"

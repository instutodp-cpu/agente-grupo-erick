#!/usr/bin/env bash
# Controlled existing-poller update: staging only; immutable release and rollback.
set -Eeuo pipefail
umask 077
ACTION="$1"; SHA="$2"
[[ "$ACTION" == --check || "$ACTION" == --deploy ]] || exit 2
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ "$(id -un)" == hermesadmin ]] || { echo DENIED_OPERATOR; exit 2; }
REPO=/home/hermesadmin/hermes-telegram-pr563
BASE=/home/hermesadmin/.hermes-telegram
STATE="$BASE/state"
OLD=hermes-telegram-private-v1
BACKUP=hermes-telegram-private-pre-automemory-v2
IMAGE=hermes-telegram-automemory:staging-v2
RELEASE="$BASE/releases/auto-memory-$SHA.js"
denied(){ echo "AUTOMEMORY_DENIED: $1" >&2; exit 1; }
[[ "$(git -C "$REPO" status --porcelain)" == '' ]] || denied dirty_tree
git -C "$REPO" fetch --depth 1 origin "$SHA" >/dev/null 2>&1 || denied fetch_failed
[[ "$(git -C "$REPO" rev-parse FETCH_HEAD)" == "$SHA" ]] || denied wrong_sha
[[ "$(stat -c %a "$STATE")" == 700 ]] || denied state_permissions
[[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" == healthy ]] || denied old_unhealthy
[[ "$(docker ps --format '{{.Names}}' | grep -c '^hermes-telegram-private-' || :)" == 1 ]] || denied duplicate_pollers
! docker inspect "$BACKUP" >/dev/null 2>&1 || denied backup_collision
mount_source(){
 docker inspect "$OLD" --format '{{range .Mounts}}{{if eq .Destination "'"$1"'"}}{{.Source}}{{end}}{{end}}'
}
BOT="$(mount_source /run/hermes-telegram-token)"
MACHINE="$(mount_source /run/hermes-machine-token)"
CODEX="$(mount_source /run/hermes-codex)"
PASS="$(mount_source /run/hermes-history-password)"
CA="$(mount_source /run/hermes-history-ca)"
[[ "$(mount_source /var/lib/hermes-telegram)" == "$STATE" ]] || denied state_mount_changed
for P in "$BOT" "$MACHINE" "$CODEX" "$PASS" "$CA"; do
 [[ "$P" == /home/hermesadmin/* && -e "$P" ]] || denied unsafe_mount
done
WORK="$(mktemp -d "$BASE/.automemory-build.XXXXXXXX")"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT
git -C "$REPO" archive "$SHA" platform/services/api | tar -x -C "$WORK"
node --check "$WORK/platform/services/api/scripts/run-hermes-telegram-private.js"
node --check "$WORK/platform/services/api/src/runtime/hermes-automemory-curator.js"
node --check "$WORK/platform/services/api/src/runtime/hermes-telegram-private-channel.js"
mkdir -p "$BASE/releases"
chmod 700 "$BASE/releases"
if [[ ! -e "$RELEASE" ]];then
 install -m 600 "$WORK/platform/services/api/scripts/run-hermes-telegram-private.js" "$RELEASE"
fi
cmp -s "$WORK/platform/services/api/scripts/run-hermes-telegram-private.js" "$RELEASE" || denied immutable_script_mismatch
docker build --pull=false -q -t "$IMAGE" -f "$WORK/platform/services/api/Dockerfile" "$WORK/platform/services/api" >/dev/null
docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL \
 --security-opt no-new-privileges --entrypoint node "$IMAGE" -e '
const a=require("/app/src/runtime/hermes-automemory-curator");
if(typeof a.curate!=="function"||typeof a.render!=="function")process.exit(2);
console.log("AUTOMEMORY_IMAGE_OK")'
exec 9>"$BASE/.automemory-deploy.lock"
flock -n 9 || denied overlapping_release
if [[ "$ACTION" == --check ]];then echo AUTOMEMORY_PRECHECK_OK;exit 0;fi
RESTORE=1
rollback(){
 if [[ "$RESTORE" == 0 ]];then return;fi
 echo AUTOMEMORY_ROLLBACK >&2
 if docker container inspect "$OLD" >/dev/null 2>&1;then
  docker stop -t 10 "$OLD" >/dev/null 2>&1 || :
  docker rm "$OLD" >/dev/null 2>&1 || :
 fi
 if docker container inspect "$BACKUP" >/dev/null 2>&1;then
  docker rename "$BACKUP" "$OLD" >/dev/null 2>&1 || :
  docker update --restart unless-stopped "$OLD" >/dev/null 2>&1 || :
  docker start "$OLD" >/dev/null 2>&1 || :
 fi
}
trap 'rollback;rm -rf "$WORK"' EXIT
docker update --restart=no "$OLD" >/dev/null
docker stop -t 20 "$OLD" >/dev/null
docker rename "$OLD" "$BACKUP"
HEALTH="node -e 'try{let a=Date.now()-JSON.parse(require(\"fs\").readFileSync(\"/var/lib/hermes-telegram/heartbeat.json\")).at;process.exit(a>=0&&a<75000?0:1)}catch{process.exit(1)}'"
docker run -d --name "$OLD" --restart unless-stopped \
 --network bridge --init --read-only --cap-drop ALL --security-opt no-new-privileges \
 --user 1000:1000 --pids-limit 48 --memory 160m --cpus 0.5 \
 --tmpfs /tmp:rw,nosuid,nodev,size=8m \
 --log-driver local --log-opt max-size=2m --log-opt max-file=2 \
 --health-cmd "$HEALTH" --health-interval 10s --health-timeout 4s \
 --health-start-period 20s --health-retries 4 \
 -v "$RELEASE:/app/scripts/run-hermes-telegram-private.js:ro" \
 -v "$BOT:/run/hermes-telegram-token:ro" \
 -v "$MACHINE:/run/hermes-machine-token:ro" \
 -v "$CODEX:/run/hermes-codex:ro" \
 -v "$PASS:/run/hermes-history-password:ro" \
 -v "$CA:/run/hermes-history-ca:ro" \
 -v "$STATE:/var/lib/hermes-telegram:rw" \
 -e HERMES_TELEGRAM_ENABLED=true -e HERMES_DEPLOYMENT_STAGE=staging \
 -e HERMES_EXECUTION_ENABLED=false -e HERMES_EXECUTION_KILL_SWITCH=true \
 -e HERMES_MISSION_INGRESS_ENABLED=false \
 -e HERMES_TELEGRAM_STATE_DIR=/var/lib/hermes-telegram \
 -e HERMES_TELEGRAM_TOKEN_FILE=/run/hermes-telegram-token \
 -e HERMES_TELEGRAM_MACHINE_IDENTITY_FILE=/run/hermes-machine-token \
 -e HERMES_AGENT_LLM_ENABLED=true -e HERMES_AGENT_PROVIDER=codex-login \
 -e HERMES_CODEX_SOCKET=/run/hermes-codex/bridge.sock \
 -e HERMES_HISTORY_LIVE_ENABLED=true \
 -e HERMES_HISTORY_PASSWORD_FILE=/run/hermes-history-password \
 -e HERMES_HISTORY_CA_FILE=/run/hermes-history-ca \
 -e HERMES_HISTORY_POOLER_HOST=aws-1-sa-east-1.pooler.supabase.com \
 -e HERMES_AUTOMEMORY_ENABLED=true \
 --entrypoint node "$IMAGE" scripts/run-hermes-telegram-private.js >/dev/null
for I in $(seq 1 25);do
 [[ "$(docker inspect "$OLD" --format '{{.State.Running}}')" == true ]] || denied stopped
 STATUS="$(docker inspect "$OLD" --format '{{.State.Health.Status}}')"
 [[ "$STATUS" != unhealthy ]] || denied unhealthy
 [[ "$STATUS" != healthy ]] || break
 sleep 3
done
[[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" == healthy ]] || denied health_timeout
[[ "$(docker ps --format '{{.Names}}' | grep -c '^hermes-telegram-private-' || :)" == 1 ]] || denied duplicate_poller
# A healthy heartbeat may be left over from the old process. The new poller
# completes getUpdates (up to 12s) BEFORE its first daily curation.
# Require actual persisted state rather than a stale inherited heartbeat.
READY=0
for I in $(seq 1 16);do
 if docker exec "$OLD" node -e '
const f=require("fs"),a=require("/app/src/runtime/hermes-automemory-curator");
const state=a.check(JSON.parse(f.readFileSync("/var/lib/hermes-telegram/auto-memory.json","utf8")));
const stamp=JSON.parse(f.readFileSync("/var/lib/hermes-telegram/auto-memory-day.json","utf8"));
if(state.items.length>40||!state.date||state.date!==new Date().toISOString().slice(0,10)||stamp.day!==state.date||stamp.policy_version!==2)process.exit(2);
' >/dev/null 2>&1;then READY=1;break;fi
 sleep 3
done
[[ "$READY" == 1 ]] || denied first_curation_timeout
docker exec "$OLD" node -e '
const f=require("fs"),a=require("/app/src/runtime/hermes-automemory-curator");
const state=a.check(JSON.parse(f.readFileSync("/var/lib/hermes-telegram/auto-memory.json","utf8")));
if(state.items.length>40||!state.date)process.exit(2);
console.log("AUTO_MEMORY_STAGING_READY count="+state.items.length);
'
RESTORE=0
trap 'rm -rf "$WORK"' EXIT
echo "AUTOMEMORY_STAGING_PUBLISHED $SHA"
echo "Rollback container retained: $BACKUP"

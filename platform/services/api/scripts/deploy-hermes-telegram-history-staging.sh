#!/usr/bin/env bash
# Hermes: human-triggered, fail-closed staging rollout. No passwords on CLI.
set -Eeuo pipefail
umask 077
ACTION="$1"; EXPECTED_SHA="$2"
[[ "$ACTION" =~ ^--(check|deploy|rollback)$ ]] || { echo INVALID_ACTION;exit 2; }
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo INVALID_SHA;exit 2; }
ROOT=/home/hermesadmin/hermes-softcom-history-v1
BASE=/home/hermesadmin/.hermes-telegram
STATE="$BASE/state"
OLD=hermes-telegram-private-v1
BACKUP=hermes-telegram-private-prelive-22f56b6
IMAGE=hermes-softcom-live-ready:22f56b6
PASS="$BASE/secret/softcom-history-db-password"
CA=/home/hermesadmin/supabase-staging-root-ca.pem
BOT="$BASE/secret/token"
MACHINE=/home/hermesadmin/.hermes-github-live-read-pilot/bearer.token
deny(){ echo "DEPLOY_BLOCKED: $*" >&2;exit 1; }
[[ "$(id -un)" == hermesadmin ]] || deny operator
[[ "$(git -C "$ROOT" rev-parse HEAD)" == "$EXPECTED_SHA" ]] || deny expected_head_sha
git -C "$ROOT" merge-base --is-ancestor 22f56b6bfe0357e7664a9716889ccbb1ad620dec "$EXPECTED_SHA" || deny feature_commit
[[ -z "$(git -C "$ROOT" status --porcelain)" ]] || deny dirty_tree
[[ "$(stat -c '%a' "$STATE")" == 700 ]] || deny state_permissions
for FILE in "$PASS" "$CA" "$BOT" "$MACHINE"; do
 [[ -f "$FILE" && "$(stat -c '%a' "$FILE")" == 600 ]] || deny protected_file_permissions
done
docker image inspect "$IMAGE" >/dev/null || deny missing_image
exec 9>"$BASE/.deploy-lock"
flock -n 9 || deny overlapping_deployment
count_pollers(){ docker ps --format '{{.Names}}' | grep -c '^hermes-telegram-private-' || :; }
if [[ "$ACTION" == --rollback ]]; then
 [[ "$(docker inspect "$BACKUP" --format '{{.State.Running}}')" == false ]] || deny missing_stopped_backup
 if docker container inspect "$OLD" >/dev/null 2>&1;then
   docker stop -t 20 "$OLD" >/dev/null || :
   docker rm "$OLD" >/dev/null
 fi
 docker rename "$BACKUP" "$OLD"
 docker update --restart=unless-stopped "$OLD" >/dev/null
 docker start "$OLD" >/dev/null
 [[ "$(count_pollers)" == 1 ]] || deny duplicate_pollers
 echo ROLLBACK_RESTORED
 exit 0
fi
[[ "$(docker inspect "$OLD" --format '{{.State.Running}}')" == true ]] || deny bot_stopped
[[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" == healthy ]] || deny bot_unhealthy
[[ "$(count_pollers)" == 1 ]] || deny duplicate_pollers
[[ "$(docker inspect hermes-read-pilot-v7 --format '{{.State.Health.Status}}')" == healthy ]] || deny read_pilot
[[ "$(docker inspect "$OLD" --format '{{range .Mounts}}{{if eq .Destination "/app"}}{{.Source}}{{end}}{{end}}')" == "$ROOT/platform/services/api" ]] || deny unexpected_bot_mounts
! docker container inspect "$BACKUP" >/dev/null 2>&1 || deny existing_backup
echo PRECHECK_DATABASE_ONLY
docker run --rm --network bridge --read-only --user 1000:1000 \
 --cap-drop ALL --security-opt no-new-privileges --pids-limit 32 --memory 128m \
 -v "$PASS:/run/pw:ro" -v "$CA:/run/ca:ro" \
 --entrypoint node "$IMAGE" -e '
const fs=require("fs"),{Client}=require("pg");
const c=new Client({host:"aws-1-sa-east-1.pooler.supabase.com",port:5432,
 database:"postgres",user:"hermes_history_login.yxmdrrwqxwzsdgcgskrm",
 password:fs.readFileSync("/run/pw","utf8").trim(),
 ssl:{ca:fs.readFileSync("/run/ca","utf8"),rejectUnauthorized:true},
 connectionTimeoutMillis:6000,statement_timeout:5000,query_timeout:7000,
 options:"-c default_transaction_read_only=on"});
(async()=>{
 await c.connect();
 const x=(await c.query("SELECT current_user AS role, COALESCE(SUM(registered),0)::bigint AS n FROM hermes_history.daily_sales_v1")).rows[0];
 if(x.role!=="hermes_history_login"||Number(x.n)!==25482)throw Error("history_integrity");
 console.log("DATABASE_CHECK_OK");
})().catch(()=>{console.error("DATABASE_CHECK_FAILED");process.exitCode=1})
 .finally(()=>c.end().catch(()=>{}));'
if [[ "$ACTION" == --check ]]; then echo PRECHECK_OK_NO_CHANGES;exit 0;fi
RESTORE=1
restore(){
 if [[ "$RESTORE" == 0 ]]; then return;fi
 echo ROLLBACK_IN_PROGRESS
 if docker container inspect "$BACKUP" >/dev/null 2>&1; then
  docker stop -t 10 "$OLD" >/dev/null 2>&1 || :
  docker rm "$OLD" >/dev/null 2>&1 || :
  docker rename "$BACKUP" "$OLD" >/dev/null 2>&1 || :
 fi
 docker update --restart=unless-stopped "$OLD" >/dev/null 2>&1 || :
 docker start "$OLD" >/dev/null 2>&1 || :
}
trap restore EXIT
docker update --restart=no "$OLD" >/dev/null
docker stop -t 20 "$OLD" >/dev/null
docker rename "$OLD" "$BACKUP"
HEALTH="node -e 'try{const v=JSON.parse(require(\"fs\").readFileSync(\"/var/lib/hermes-telegram/heartbeat.json\"));const a=Date.now()-v.at;process.exit(Number.isSafeInteger(v.at)&&a>=0&&a<75000?0:1)}catch{process.exit(1)}'"
docker run -d --name "$OLD" --restart unless-stopped \
 --network bridge --init --read-only --cap-drop ALL --security-opt no-new-privileges \
 --user 1000:1000 --pids-limit 48 --memory 160m --cpus 0.5 \
 --tmpfs /tmp:rw,nosuid,nodev,size=8m \
 --log-driver local --log-opt max-size=2m --log-opt max-file=2 \
 --health-cmd "$HEALTH" --health-interval 10s \
 --health-timeout 4s --health-start-period 20s --health-retries 4 \
 -v "$ROOT/platform/services/api/scripts/run-hermes-telegram-private.js:/app/scripts/run-hermes-telegram-private.js:ro" \
 -v "$BOT:/run/hermes-telegram-token:ro" \
 -v "$MACHINE:/run/hermes-machine-token:ro" \
 -v "$PASS:/run/hermes-history-password:ro" \
 -v "$CA:/run/hermes-history-ca:ro" \
 -v "$STATE:/var/lib/hermes-telegram:rw" \
 -e HERMES_TELEGRAM_ENABLED=true -e HERMES_DEPLOYMENT_STAGE=staging \
 -e HERMES_EXECUTION_ENABLED=false -e HERMES_EXECUTION_KILL_SWITCH=true \
 -e HERMES_MISSION_INGRESS_ENABLED=false \
 -e HERMES_TELEGRAM_STATE_DIR=/var/lib/hermes-telegram \
 -e HERMES_TELEGRAM_TOKEN_FILE=/run/hermes-telegram-token \
 -e HERMES_TELEGRAM_MACHINE_IDENTITY_FILE=/run/hermes-machine-token \
 -e HERMES_HISTORY_LIVE_ENABLED=true \
 -e HERMES_HISTORY_PASSWORD_FILE=/run/hermes-history-password \
 -e HERMES_HISTORY_CA_FILE=/run/hermes-history-ca \
 -e HERMES_HISTORY_POOLER_HOST=aws-1-sa-east-1.pooler.supabase.com \
 --entrypoint node "$IMAGE" scripts/run-hermes-telegram-private.js >/dev/null
for i in $(seq 1 30); do
 [[ "$(docker inspect "$OLD" --format '{{.State.Running}}')" == true ]] || deny replacement_stopped
 [[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" != unhealthy ]] || deny replacement_unhealthy
 [[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" != healthy ]] || break
 sleep 3
done
[[ "$(docker inspect "$OLD" --format '{{.State.Health.Status}}')" == healthy ]] || deny health_timeout
[[ "$(count_pollers)" == 1 ]] || deny duplicate_pollers
docker exec "$OLD" node -e '
const fs=require("fs");
const core=require("/app/src/runtime/hermes-telegram-private-channel");
const s=JSON.parse(fs.readFileSync("/var/lib/hermes-telegram/history-softcom.json"));
if(!core.safeHistorySnapshot(s)||core.intentFor("/vendas 2026-05")!=="historico_live"||
 process.env.HERMES_HISTORY_LIVE_ENABLED!=="true"||
 typeof require("pg").Client!=="function")process.exit(1);
console.log("LIVE_GATE_OK");'
docker exec "$OLD" node -e '
const r=require("/app/scripts/run-hermes-telegram-private");
r.createLiveQuery(process.env)({tenant_id:"grupo_erick",month:"2026-05",shape:"total"})
 .then(v=>{if(v.rows[0].registered!==5933)throw Error("bad_count");console.log("LIVE_QUERY_OK")})
 .catch(()=>{console.error("LIVE_QUERY_FAILED");process.exitCode=1});'
RESTORE=0
trap - EXIT
echo TELEGRAM_LIVE_STAGING_PROMOTED
echo "Rollback: bash platform/services/api/scripts/deploy-hermes-telegram-history-staging.sh --rollback $EXPECTED_SHA"

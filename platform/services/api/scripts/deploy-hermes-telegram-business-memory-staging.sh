#!/usr/bin/env bash
# Hermes: human-triggered, fail-closed staging rollout. No passwords on CLI.
set -Eeuo pipefail
umask 077
ACTION="$1"; EXPECTED_SHA="$2"
[[ "$ACTION" =~ ^--(check|deploy|rollback)$ ]] || { echo INVALID_ACTION;exit 2; }
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo INVALID_SHA;exit 2; }
ROOT=/home/hermesadmin/hermes-analyst-release-fix-v1
LEGACY_WORKTREE=/home/hermesadmin/hermes-softcom-history-v1
BASE=/home/hermesadmin/.hermes-telegram
STATE="$BASE/state"
OLD=hermes-telegram-private-v1
BACKUP=hermes-telegram-private-pre-memory-v6
IMAGE=hermes-telegram-business-memory:v6
PASS="$BASE/secret/softcom-history-db-password"
CODEX_SOCKET_DIR=/home/hermesadmin/.hermes-codex/bridge
CODEX_SOCKET_PATH="$CODEX_SOCKET_DIR/bridge.sock"
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
# Rebuild from exact PR HEAD to avoid running a stale local candidate image.
docker build --pull=false -q -t "$IMAGE" -f "$ROOT/platform/services/api/Dockerfile" "$ROOT/platform/services/api" >/dev/null
docker image inspect "$IMAGE" >/dev/null || deny missing_image
# Freeze the new runtime entrypoint independently of the worktree.
# The stopped previous poller remains mounted to the untouched, compatible old script.
RELEASE_DIR="$BASE/releases"
mkdir -p "$RELEASE_DIR"
chmod 700 "$RELEASE_DIR"
RELEASE_SCRIPT="$RELEASE_DIR/analyst-$EXPECTED_SHA.js"
if [[ ! -f "$RELEASE_SCRIPT" ]];then
 install -m 600 "$ROOT/platform/services/api/scripts/run-hermes-telegram-private.js" "$RELEASE_SCRIPT"
fi
[[ "$(stat -c '%a' "$RELEASE_SCRIPT")" == 600 ]] || deny release_script_permissions
[[ -d "$CODEX_SOCKET_DIR" && "$(stat -c '%a' "$CODEX_SOCKET_DIR")" == 700 ]] || deny codex_socket_directory_unsafe
[[ -S "$CODEX_SOCKET_PATH" && "$(stat -c '%a' "$CODEX_SOCKET_PATH")" == 600 ]] || deny codex_socket_missing
[[ "$(stat -c '%u' "$CODEX_SOCKET_PATH")" == "$(id -u)" ]] || deny codex_socket_owner
[[ "$(docker inspect hermes-codex-bridge-staging-v1 --format '{{.State.Health.Status}}')" == healthy ]] || deny codex_bridge_unhealthy
[[ "$(docker inspect hermes-codex-bridge-staging-v1 --format '{{json .HostConfig.PortBindings}}')" == '{}' ]] || deny codex_bridge_external_port

cmp -s "$ROOT/platform/services/api/scripts/run-hermes-telegram-private.js" "$RELEASE_SCRIPT" || deny immutable_script_mismatch
docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL  -v "$RELEASE_SCRIPT:/app/scripts/run-hermes-telegram-private.js:ro"  --entrypoint node "$IMAGE" -e '
const a=require("/app/src/runtime/hermes-analyst-templates");
const r=require("/app/scripts/run-hermes-telegram-private");
if(typeof a.planQuestion!=="function"||typeof r.createLiveQuery!=="function"||
 typeof require("/app/src/runtime/hermes-governed-agent").runTurn!=="function"||
 typeof require("/app/src/runtime/hermes-codex-login-bridge").createCodexModel!=="function"||
 typeof require("/app/src/runtime/hermes-business-evidence-memory").observe!=="function")
 process.exit(2);
console.log("NONROOT_IMAGE_IMPORT_GATE_OK");'

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
ACTIVE_SCRIPT="$(docker inspect "$OLD" --format '{{range .Mounts}}{{if eq .Destination "/app/scripts/run-hermes-telegram-private.js"}}{{.Source}}{{end}}{{end}}')"
[[ "$ACTIVE_SCRIPT" =~ ^/home/hermesadmin/\.hermes-telegram/releases/analyst-[0-9a-f]{40}\.js$ ]] || deny unexpected_bot_mounts
[[ -f "$ACTIVE_SCRIPT" && "$(stat -c '%a' "$ACTIVE_SCRIPT")" == 600 ]] || deny unsafe_active_runner
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
echo PRECHECK_CODEX_SOCKET
docker run --rm --network none --read-only --user 1000:1000 --cap-drop ALL  --security-opt no-new-privileges --pids-limit 25 --memory 100m  -v "$CODEX_SOCKET_DIR:/run/hermes-codex:ro" --entrypoint node "$IMAGE" -e '
require("http").get({socketPath:"/run/hermes-codex/bridge.sock",path:"/health"},r=>{
 if(r.statusCode!==200)process.exitCode=1;
 else console.log("CODEX_LOCAL_SOCKET_GATE_OK");
}).on("error",()=>{console.error("CODEX_SOCKET_DENIED");process.exitCode=1});'
if [[ "$ACTION" == --check ]]; then echo PRECHECK_OK_NO_CHANGES;exit 0;fi
RESTORE=1
restore(){
 if [[ "$RESTORE" == 0 ]]; then return;fi
 echo ROLLBACK_IN_PROGRESS
 if docker container inspect "$OLD" >/dev/null 2>&1;then
  docker logs --tail 80 "$OLD" > "$BASE/state/.analyst-rollback-diagnostic.log" 2>&1 || :
  chmod 600 "$BASE/state/.analyst-rollback-diagnostic.log" 2>/dev/null || :
 fi
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
 -v "$RELEASE_SCRIPT:/app/scripts/run-hermes-telegram-private.js:ro" \
 -v "$BOT:/run/hermes-telegram-token:ro" \
 -v "$MACHINE:/run/hermes-machine-token:ro" \
 -v "$CODEX_SOCKET_DIR:/run/hermes-codex:ro" \
 -v "$PASS:/run/hermes-history-password:ro" \
 -v "$CA:/run/hermes-history-ca:ro" \
 -v "$STATE:/var/lib/hermes-telegram:rw" \
 -e HERMES_TELEGRAM_ENABLED=true -e HERMES_DEPLOYMENT_STAGE=staging \
 -e HERMES_EXECUTION_ENABLED=false -e HERMES_EXECUTION_KILL_SWITCH=true \
 -e HERMES_MISSION_INGRESS_ENABLED=false \
 -e HERMES_TELEGRAM_STATE_DIR=/var/lib/hermes-telegram \
 -e HERMES_TELEGRAM_TOKEN_FILE=/run/hermes-telegram-token \
 -e HERMES_TELEGRAM_MACHINE_IDENTITY_FILE=/run/hermes-machine-token \
 -e HERMES_AGENT_LLM_ENABLED=true \
 -e HERMES_AGENT_PROVIDER=codex-login \
 -e HERMES_CODEX_SOCKET=/run/hermes-codex/bridge.sock \
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
if(!core.safeHistorySnapshot(s)||core.intentFor("/vendas 2026-05")!=="historico_live"||core.intentFor("/produtos 2026-05")!=="historico_live"||
 core.intentFor("Vendeu quanto em janeiro 2026?")!=="business_analyst" ||
 process.env.HERMES_HISTORY_LIVE_ENABLED!=="true"||
 typeof require("pg").Client!=="function")process.exit(1);
console.log("LIVE_GATE_OK");'
docker exec "$OLD" node -e '
const r=require("/app/scripts/run-hermes-telegram-private");
r.createLiveQuery(process.env)({tenant_id:"grupo_erick",month:"2026-05",shape:"products"})
 .then(v=>{if(v.rows.length!==5||v.rows[0].product_code!=="32452"||
   v.rows[0].not_marked_cancelled!==163)throw Error("bad_product_count");
   console.log("LIVE_PRODUCT_QUERY_OK")})
 .catch(()=>{console.error("LIVE_QUERY_FAILED");process.exitCode=1});'
docker exec "$OLD" node -e '
const a=require("/app/src/runtime/hermes-analyst-templates");
const r=require("/app/scripts/run-hermes-telegram-private");
const plan=a.planQuestion("Compare a venda de janeiro 2025 e 2026");
r.createLiveQuery(process.env)({shape:"analyst",tenant_id:"grupo_erick",plan})
.then(v=>{
 const x=new Map(v.rows.map(i=>[i.label,i]));
 if(x.get("2025-01")?.records!==4226||x.get("2026-01")?.records!==4902)
  throw Error("historical_comparison_mismatch");
 console.log("ANALYST_2025_2026_LIVE_GATE_OK");
}).catch(()=>{console.error("ANALYST_GATE_DENIED");process.exitCode=1});'
docker exec "$OLD" node -e '
const a=require("/app/src/runtime/hermes-governed-agent");
const r=require("/app/scripts/run-hermes-telegram-private");
const fs=require("fs");
if(typeof a.runTurn!=="function"||typeof r.pollOnce!=="function"||
 process.env.HERMES_AGENT_LLM_ENABLED!=="true"||
 process.env.HERMES_AGENT_PROVIDER!=="codex-login"||
 process.env.HERMES_CODEX_SOCKET!=="/run/hermes-codex/bridge.sock"||
 !fs.statSync("/run/hermes-codex/bridge.sock").isSocket())process.exit(1);
console.log("AGENT_FEATURE_GATE_OK");'
# Critical business-reliability gate: no full-year vs partial-year comparison.
docker exec "$OLD" node -e '
const a=require("/app/src/runtime/hermes-analyst-templates");
const mem=require("/app/src/runtime/hermes-business-evidence-memory");
const r=require("/app/scripts/run-hermes-telegram-private");
const p={tenant_id:"grupo_erick",template:"compare",period:"2025",
 other_period:"2026",metric:"money",store:null};
(async()=>{
 const data=await r.createLiveQuery(process.env)({shape:"analyst",tenant_id:"grupo_erick",plan:p});
 const by=new Map(data.rows.map(x=>[x.label,x]));
 if(by.get("2025")?.records!==21940||by.get("2026")?.records!==24148||
  Math.abs(by.get("2025")?.amount-2730133.04)>0.01||
  Math.abs(by.get("2026")?.amount-2956645.04)>0.01)
  throw Error("UNEQUAL_COVERAGE_DENIED");
 const reply=a.reply(data,p);
 if(!reply.includes("Cobertura equivalente: janeiro a maio"))throw Error("COVERAGE_MESSAGE_MISSING");
 const moment=Date.parse(data.at);
 const saved=mem.observe(null,data,p,moment);
 if(saved.entries.length!==1||!mem.context(saved,"Analise 2025 e 2026",moment).includes("2.730.133,04"))
  throw Error("MEMORY_GATE_DENIED");
 console.log("MATCHED_PERIOD_AND_BUSINESS_MEMORY_GATE_OK");
})().catch(()=>{console.error("MEMORY_GATE_FAILED");process.exitCode=1});'
RESTORE=0
trap - EXIT
echo TELEGRAM_LIVE_STAGING_PROMOTED
echo "Rollback: bash platform/services/api/scripts/deploy-hermes-telegram-business-memory-staging.sh --rollback $EXPECTED_SHA"

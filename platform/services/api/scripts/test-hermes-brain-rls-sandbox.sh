#!/usr/bin/env bash
# Offline isolated RLS test: no user data, no published ports, no live DB.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CONTAINER="hermes-brain-rls-sandbox-$$"
cleanup(){ docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run --rm -d --name "$CONTAINER" --network none --memory 192m \
 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
ready=false
for _ in {1..20};do
 if docker exec "$CONTAINER" pg_isready -U postgres -q;then ready=true;break;fi
 sleep 1
done
test "$ready" = true
docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
SQL
docker cp "$ROOT/platform/migrations/hermes/038_create_second_brain_multi_tenant_read_model.sql" \
 "$CONTAINER":/tmp/migration.sql
docker cp "$ROOT/platform/services/api/scripts/hermes-brain-rls-sandbox-fixture.sql" \
 "$CONTAINER":/tmp/fixture.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/migration.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/fixture.sql | grep 'RLS_CROSS_TENANT_APPROVAL_SOURCE_TTL_SCOPE_AND_WRITE_GATE_OK'
docker cp "$ROOT/platform/migrations/hermes/039_create_second_brain_inbox_candidates.sql" \
 "$CONTAINER":/tmp/inbox-migration.sql
docker cp "$ROOT/platform/services/api/scripts/hermes-brain-inbox-rls-sandbox-fixture.sql" \
 "$CONTAINER":/tmp/inbox-fixture.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/inbox-migration.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/inbox-fixture.sql | grep 'BRAIN_INBOX_MEMBER_WRITE_PENDING_CROSS_TENANT_REJECTION_OK'
docker cp "$ROOT/platform/migrations/hermes/043_create_second_brain_verified_automemory_insert.sql" \
 "$CONTAINER":/tmp/automemory-insert-migration.sql
docker cp "$ROOT/platform/services/api/scripts/hermes-brain-automemory-insert-rls-sandbox-fixture.sql" \
 "$CONTAINER":/tmp/automemory-insert-fixture.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/automemory-insert-migration.sql
docker cp "$ROOT/platform/migrations/hermes/044_create_second_brain_authenticated_automemory_publish_rpc.sql" \
 "$CONTAINER":/tmp/automemory-publish-rpc.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/automemory-publish-rpc.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q \
 -f /tmp/automemory-insert-fixture.sql | grep 'BRAIN_VERIFIED_OWNER_RLS_INSERT_AND_REJECTION_OK'
docker cp "$ROOT/platform/services/api/scripts/hermes-brain-automemory-rpc-rls-sandbox-fixture.sql" "$CONTAINER":/tmp/automemory-rpc-fixture.sql
docker exec "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/automemory-rpc-fixture.sql | grep 'BRAIN_AUTHENTICATED_INVOCATION_REPLAY_AND_TENANT_DENIAL_OK'
echo BRAIN_EPHEMERAL_POSTGRES_RLS_TEST_OK

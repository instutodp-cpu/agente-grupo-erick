-- Durable result cost required to reconstruct Hermes -> Maestro callbacks without replaying public-web execution.
BEGIN;

ALTER TABLE hermes.public_web_operational_mission_inbox
  ADD COLUMN IF NOT EXISTS cost_units NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE hermes.public_web_operational_mission_inbox
  DROP CONSTRAINT IF EXISTS public_web_operational_mission_inbox_cost_check;

ALTER TABLE hermes.public_web_operational_mission_inbox
  ADD CONSTRAINT public_web_operational_mission_inbox_cost_check
  CHECK (cost_units >= 0 AND cost_units <= 1);

COMMIT;

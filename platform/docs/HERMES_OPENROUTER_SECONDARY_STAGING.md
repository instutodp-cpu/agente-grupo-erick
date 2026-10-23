# Hermes Codex-first, OpenRouter second — staging contract

- **Codex Login is primary** whenever its local pilot budget allows (4 turns/day).
- OpenRouter is only enabled when a protected local key is mounted by
  `HERMES_OPENROUTER_KEY_FILE` and `HERMES_OPENROUTER_ENABLED=true`.
- Selected for **quota/rate/provider unavailability/timeout**; security,
  validation, wrong tenant, and revocation errors still fail closed.
- Once selected during one user question, secondary stays selected for
  planning + synthesis, and the actual OpenRouter model slug is pinned when
  returned. Zero extra model calls to select the model.
- Deterministic JEV-inspired task gate: low cost for ordinary work, medium
  only for financial/legal/strategic reasoning. Never automatic high/max.
- OpenRouter Auto Router `openrouter/auto` with `cost_tier`, ceilings:
  low <= $0.40/$1.50 per million input/output tokens, medium <=
  $1/$4 per million; max 1000 output tokens each model request.
- Secondary budget **8 requests/day UTC** in protected
  `agent-openrouter-budget.json`; two model calls max per user analysis.
  Counts reserve before the request, including failures. No retries.
- OpenRouter `provider.zdr=true`, `data_collection=deny`.
  Requests fail closed when no compliant provider fits.
- The OpenRouter key MUST have an independently enforced monthly spend cap
  in its account dashboard and API key restrictions. This local count is NOT a
  monetary guardrail and does not prove zero overage.
- No key, prompt, completion or full provider error ever enters state,
  code, GitHub, Docker build, shell history or audit logs.
- NO ingestion of WhatsApp/personal/private sources. Only the
  existing owner-only, authorized enterprise context is eligible.
- Production disabled. No automatic merge, payment or external actions.
- If OpenRouter fails too, the existing verified owner-only memory fallback
  continues, or fails closed when no verified memory is relevant.

## Install the KEY without sharing it in chat
A dedicated file at
`/home/hermesadmin/.hermes-telegram/secret/openrouter-api-key`,
mode 0600 owned by `hermesadmin`, will be mounted read-only as
`/run/hermes-openrouter-key` in the Telegram staging poller.
Use a hidden terminal prompt, never `echo KEY` or command arguments.
Never put API key into repo, GitHub issue, chat, Telegram or log.

## Operations
Deploy script must preserve exact expected Git SHA, CI green, previous
poller backup, single poller, no new privileged mounts, staging flags
and rollback; enabled only when key exists and permission verified.

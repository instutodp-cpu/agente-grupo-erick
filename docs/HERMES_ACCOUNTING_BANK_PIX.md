# C5 — Bank & Pix Intake

C5 creates a read-only banking boundary for reconciliation and evidence collection.

## Separation of capabilities

`BankReadGateway` is conceptually independent from any future `BankPaymentGateway`.

Allowed now:
- balance read;
- transaction read;
- Pix read.

Denied:
- payment execution;
- Pix send;
- refund;
- credentials exposed to the LLM.

A future payment layer must request a separate `MONEY` capability and human approval; C5 cannot be upgraded implicitly.

## Canonical banking facts

Bank transactions preserve company/account, posting date, direction, integer-cent amount, optional balance, transaction type, counterparty, bank reference, Pix identifiers, raw description, source reference and evidence.

Pix requires at least `endToEndId` or `txid`. Strong identifiers are used before heuristic matching.

## Transport preference

1. official bank API;
2. authorized Open Finance/API;
3. OFX;
4. CNAB or other structured file;
5. controlled manual ingestion.

Browser scraping is not a preferred transport.

OAuth/mTLS secrets belong in a credential broker, never in prompts or model context.

## Reliability

Verified webhook ingestion can provide low-latency events, but periodic polling/file reconciliation remains the recovery path. Unverified webhook events fail closed.

## Not implemented in C5

- real bank credentials;
- production bank endpoints;
- payment initiation;
- Pix send/refund;
- reconciliation heuristics (C6);
- persistence or scheduler.

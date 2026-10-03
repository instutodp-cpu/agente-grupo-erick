# C07 — Measurement, Attribution & Commercial Feedback Loop

## Purpose
Connect marketing activity to commercial outcomes without converting correlation into causation.

## Flow
touchpoints -> identity/linkage -> sale -> attribution classification -> commercial metrics -> evidence -> learning candidate

## Invariants
1. Raw touchpoints and sale evidence are preserved.
2. Direct attribution requires verifiable linkage.
3. Temporal proximity alone is never direct attribution.
4. A lead is not a customer until a sale/customer record supports it.
5. Revenue, discount, COGS and gross margin are never invented.
6. Missing cost or margin data remains unknown.
7. Content/campaign/influencer performance is evaluated against commercial objective, not views alone.
8. Foundation performs deterministic simulation only.

## Direct linkage examples
- unique influencer/campaign coupon tied to sale;
- identified WhatsApp journey tied to sale/customer;
- explicit source identifier carried into checkout/ERP evidence.

## Non-direct signals
- viewed content then purchased with no identity link;
- store sales increased after campaign with no customer linkage;
- engagement/profile visits without sale linkage.

## Output
Classification is one of direct_attributed, assisted, correlated, unattributed with evidence references and limitations.

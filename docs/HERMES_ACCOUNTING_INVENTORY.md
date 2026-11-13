# C9 — Inventory × Purchasing × Fiscal

C9 connects inventory facts to purchasing, fiscal evidence and AP without allowing source-system stock to silently become accounting truth.

## Roll-forward

```text
opening
+ purchases
+ transfer in
+ customer returns
+ positive adjustments
- sales
- transfer out
- supplier returns
- loss/damage
- negative adjustments
= theoretical closing
```

Quantities use integer milli-units so fractional units can be represented without floating-point arithmetic.

## Five-way purchase reconciliation

The purchase chain checks:
1. purchase order;
2. fiscal document;
3. goods receipt;
4. payable;
5. inventory movement.

Any missing leg produces review, not an inferred match.

## Goods receipt

Receipt state is `COMPLETE | PARTIAL | OVER_RECEIVED | REJECTED`.

## Transfers

Transfers preserve source store, destination store, dispatched quantity and received quantity. Partial receipt and over-receipt remain explicit. A transfer cannot use the same establishment as both endpoints.

## Inventory truth

Three views remain separate:
- theoretical inventory derived from movements;
- physical count;
- ERP-reported inventory.

Differences become reviewable exceptions.

## Cost and management outputs

C9 provides the facts required for later CMV, margin, stock velocity, dead-stock, days-inventory and stockout analysis. Accounting cost policy must be explicit/versioned before authoritative CMV is produced.

## Loss prevention

Inventory variance can generate an integrity/loss signal. The signal is not a fraud finding and always requires human review.

## Not implemented

- automatic stock adjustment;
- Seta write-back;
- autonomous supplier claim;
- authoritative cost-policy engine;
- persistence/scheduler.

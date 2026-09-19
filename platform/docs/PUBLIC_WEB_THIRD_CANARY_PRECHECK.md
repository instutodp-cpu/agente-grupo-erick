# Public Web Third Canary Offline Precheck

This precheck prepares a future single-use staging canary without creating or
consuming an authorization, Grant, Reservation, replay key or secret.

`src/pilots/public-web-canary-third-precheck.js` is a pure validation boundary.
It requires a new staging identity, the official real transport declaration,
an explicitly approved external staging target, feature-flag and kill-switch
state, one request, rollout `1`, fresh single-use resource references, a valid
secret reference, durable audit, and mandatory cleanup/revocation metadata.

The precheck never imports or invokes the HTTPS client or DNS resolver. The
local synthetic bootstrap is not accepted as the third-canary transport. The
existing real non-production execution bridge is an older execution path and
is not reused by this precheck.

The target must be supplied and approved separately by a human. The repository
does not select or hardcode an external staging target. The next phases are:

1. offline precheck;
2. new explicit human authorization;
3. exactly one execution, outside this precheck and requiring fresh resources.

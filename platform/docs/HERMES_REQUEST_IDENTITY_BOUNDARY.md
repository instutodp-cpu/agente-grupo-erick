# Hermes Request Identity Boundary

This boundary attaches the result of the trusted machine identity resolver to
the request-local context as `req.context.identity`.

## Contract

The context identity contains only:

- a machine principal type and ID;
- the server-side `tenant_id`;
- the authentication source;
- a non-secret key ID.

It contains no bearer value, digest, authorization header or raw payload.
The context and identity are frozen after resolution. A request is resolved at
most once, and separate requests do not share identity state.

## Modes

- `public`: no identity resolution;
- `optional_identity`: absent credentials produce `identity: null`, while a
  presented invalid credential fails closed;
- `required_identity`: a valid trusted machine credential is mandatory.

The API server keeps `public` as its default in this checkpoint. Existing
Hermes routes therefore keep their current behavior and no global enforcement
rollout occurs. A future composition root may inject the H01 registry and
select a mode explicitly.

Body, query, path and arbitrary tenant/principal headers are never authority.
The only authority is the H01 machine credential registry mapping.

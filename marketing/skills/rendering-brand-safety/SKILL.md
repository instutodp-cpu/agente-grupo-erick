# C05 — Rendering & Brand Safety

## Purpose
Transform production-ready content into deterministic render specifications without allowing visual clipping, unsupported brand improvisation, or external publication.

## Flow
production package -> canvas profile -> safe-zone layout -> brand constraints -> render specification -> deterministic QA -> render adapter

## Invariants
1. Text, captions, logos and CTAs must fit inside the declared safe zone.
2. Safe-zone compliance is calculated from geometry, never inferred from a prompt.
3. Unknown brand assets remain missing requirements; never fabricate a logo, font, color, offer or product claim.
4. Render adapters consume the same normalized specification.
5. Foundation mode may prepare Canva/Remotion jobs but does not call external renderers.
6. Rendering never implies publishing.
7. A blocked layout cannot be promoted to render-ready.
8. Platform overlays are treated as reserved areas when the canvas profile declares them.

## Outputs
- canvas profile
- normalized render specification
- brand profile reference
- deterministic layout QA
- adapter handoff

## Execution
Simulation First. No provider credentials. No publishing, messaging, ad mutation or external rendering is enabled here.

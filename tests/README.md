# Verification suites

Machine checks used to verify each phase (see `IMPLEMENTATION_PLAN.md`). Not wired to a
test runner — run them directly.

## WebSocket smoke tests (`smoke-*.mjs`)

End-to-end checks against a real PartyKit dev server with synthetic DM/player clients.
They verify behavior **at the WebSocket-frame level** (redaction, secret stripping,
authorization, caps), never trusting the UI.

```sh
npm run partykit:dev          # terminal 1 (port 1999)
node tests/smoke-phase0.mjs   # terminal 2 — repeat for phase1..5 + ux2
```

Each script prints PASS/FAIL per check and exits non-zero on failure. Requires Node ≥ 22
(native WebSocket). A libuv assertion after "ALL CHECKS PASSED" on Windows is a harmless
teardown artifact.

- `smoke-phase0.mjs` — lobby redaction, VIEWPORT delta hot path, masked secret roll values
- `smoke-phase1.mjs` — NPC sheet section reveal/redaction, sheet authz, DM notes privacy
- `smoke-phase2.mjs` — sheet-attributed rolls, adv/dis, whisper privacy, log cap, secret-roll persistence
- `smoke-phase3.mjs` — initiative (NPC auto-roll, CTA, DEX tiebreak, turn wrap), HP-display redaction exception
- `smoke-ux2.mjs` — masked secret rolls, folders/items CRUD + DM-only redaction, inventory reveal gating
- `smoke-phase4.mjs` — 3D dice protocol: authoritative faceValues, secret stripping, deferred masked log, track validation
- `smoke-phase5.mjs` — map tools: hidden-token redaction, MEASURE relay, annotations (forced-ephemeral + TTL, authz, 200 cap), fog authz/reset, grid fields, hidden combatants (takes ~15s — waits out the ephemeral TTL)
- `smoke-phase6.mjs` — dynamic vision: walls/doors + lights are DM-only, reach players (client-side LOS), enforce caps (600 walls / 50 lights), drop degenerate segments; door toggle; global-illumination + token-vision propagation
- `smoke-scenes.mjs` — Phase 6.5 prep secrecy + fog brush: players receive ONLY the active scene + its tokens, Set Live swaps atomically; brush/cover/inverted fog round-trips (points trimmed at 120) and stays DM-only; full-scene UPDATE_SCENE (the editor's Apply path) carries walls+lights+fog at once

## Unit tests (`unit-*.test.ts`)

Pure-logic tests (normalization/migration/redaction) run against the real `src/lib` code,
bundled with esbuild:

```sh
npx esbuild tests/unit-sheets.test.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/t.mjs --alias:@lib=./src/lib && node /tmp/t.mjs
```

(Same for `unit-redaction.test.ts`, `unit-visibility.test.ts` — the Phase 6 line-of-sight
polygon: walls block, corner-peek, gaps/corridors, closed vs open doors —
`unit-scene-editor.test.ts` — Phase 6.5 fog-brush sanitization, `fog.inverted`, the
`applySceneMessage` staging reducer incl. caps, and active-scene-only player redaction —
and `unit-history.test.ts` — the DM undo/redo command/inverse builder for scene edits +
token ops.)

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

## Unit tests (`unit-*.test.ts`)

Pure-logic tests (normalization/migration/redaction) run against the real `src/lib` code,
bundled with esbuild:

```sh
npx esbuild tests/unit-sheets.test.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/t.mjs --alias:@lib=./src/lib && node /tmp/t.mjs
```

(Same for `unit-redaction.test.ts`.)

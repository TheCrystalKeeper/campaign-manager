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
- `smoke-phase6.mjs` — dynamic vision: walls/doors + lights are DM-only, reach players (client-side LOS), enforce caps (600 walls / 50 lights), drop degenerate segments; door toggle (players open unlocked doors, locked refused); global-illumination + token-vision propagation
- `smoke-walls-move.mjs` — Phase 6.9 wall movement collision: a player can't drag a token through a movement wall (server rejects, token stays), a clear path is allowed, `wallsBlockMovement` off lets it pass, and the DM bypasses collision
- `smoke-scenes.mjs` — Phase 6.5 prep secrecy + fog brush: players receive ONLY the active scene + its tokens, Set Live swaps atomically; brush/cover/inverted fog round-trips (points trimmed at 120) and stays DM-only; full-scene UPDATE_SCENE (the editor's Apply path) carries walls+lights+fog at once
- `smoke-phase7.mjs` — Phase 7 game-content depth: UPDATE_SHEET 20KB cap, SET_TOKEN_CONDITIONS + REST authz, ROLL_CHECK color-part breakdown (+ secret no-leak), ADJUST_HP clamp/temp-first/authz, MOVE_TOKEN facing (both paths), TEMPLATE transient relay (coalesce/clear/oversize-drop), coin flip (values ∈{1,2}, secret strip, Heads/Tails log), DM-only map pins stripped from players, pre-staged tokens hidden until Set Live, and the EXPORT→mutate→IMPORT v2 round-trip (+ player-export deny)
- `smoke-automation.mjs` — AUTOMATION_PLAN Tiers 1–3 end-to-end: ROLL_CHECK derives dot×prof + overrides server-side, poisoned-token disadvantage, CAST_SPELL slot spend (absent-entry=full, 0-slot reject, authz), USE_FEATURE/USE_ITEM_CHARGE decrements, short rest (hit-dice spend + sr recharge) and long rest (full HP/half dice/all slots/saves reset), DEATH_SAVE server roll, APPLY_DAMAGE resistance/immunity math + DM-only

## Unit tests (`unit-*.test.ts`)

Pure-logic tests (normalization/migration/redaction) run against the real `src/lib` code,
bundled with esbuild:

```sh
npx esbuild tests/unit-sheets.test.ts --bundle --format=esm --platform=node \
  --outfile=/tmp/t.mjs --alias:@lib=./src/lib && node /tmp/t.mjs
```

(Same for `unit-redaction.test.ts`, `unit-visibility.test.ts` — the Phase 6/6.9 line-of-sight
polygon and movement collision: walls block, corner-peek, gaps/corridors, closed vs open
doors, Phase 6.9 limited/"terrain" walls (see past one, blocked by two), one-way walls,
per-channel sight/light segment sets, `clampMove`/`movementSegments`, and legacy→channel
migration parity —
`unit-sheets-phase7.test.ts` — the Phase 7 sheet model: the every-field-in-exactly-one-
section guard, new-field normalization + caps, deterministic row-id backfill,
`inventoryRowFromItem`, per-page NPC redaction, `Token.facing` wrapping, dmOnly-pin
redaction, and the assets in-use scanner — `unit-rollcheck.test.ts` — the ROLL_CHECK
resolver (parts sum to total for skill/attack/damage/adv; engine dot×prof/expertise/
override/NPC-passthrough paths) — `unit-rules5e.test.ts` — the rules engine
(prof-by-level, skill/save/passive/init/capacity/DC formulas, override precedence +
base values, caster-type slot tables, NPC manual passthrough) — `unit-traits.test.ts` —
Tier 2: every Special-Traits switch, condition disadvantage, 5e adv/dis cancellation,
crit thresholds + crit damage dice, engine↔resolver consistency —
`unit-scene-editor.test.ts` — Phase 6.5 fog-brush sanitization, `fog.inverted`, the
`applySceneMessage` staging reducer incl. caps, and active-scene-only player redaction —
and `unit-history.test.ts` — the DM undo/redo command/inverse builder for scene edits +
token ops.)

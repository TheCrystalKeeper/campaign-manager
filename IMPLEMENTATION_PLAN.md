# Campaign Manager — Feature Implementation Plan

Roadmap for building out the VTT from the `bare-bones` foundation. Covers everything in
`revamp_todo.md` plus recommended additions. Companion docs: `CODEBASE.md` (pre-revamp
architecture reference — **historical**, describes the codebase before Phases 0–4 shipped),
`DICE_PLAN.md` (v1 3D dice concepts — the shipped Phase 4 recovered its core).

## STATUS (2026-07-02) — read this first in a fresh session

**Phases 0–6.5 are SHIPPED and machine-verified** (plus two UX-feedback rounds and a
3D-dice feedback round). **Phase 7 (game-content depth: the tabbed character-sheet
redesign, items, rolls, token facing, DM tools) is next.** The roadmap was restructured
2026-07-02 (user): 5.5 = shell/layout fixes ✅, 6 = vision ✅ (v1), 6.5 = scene-editor
round ✅ (pulled the fog brush + scenes-editor depth forward from 7; also Players tab bar
+ active-scene-only player redaction), 7 = game-content depth, 8 = full aesthetic revamp
(+ sound design), 9 = optional extras (soundboard/themes/asset library — the old
Phase 7). Each shipped phase below carries an "as built" note where reality diverged from
the original spec — trust those notes over the older prose. Phase 6 shipped a focused v1;
its "as built" note lists the deferred stretches (server-side LOS redaction, dim/bright
shading, light shadows, directional cones, low-spec mode).

- **Verification:** `tests/` holds the WS smoke suites + unit tests with a README on how
  to run them (partykit dev server + `node tests/smoke-*.mjs`). All pass as of this date
  (phase0–6 + scenes + ux2 + all five unit suites, all green as of 2026-07-03).
  Re-run the full set after any server/redaction/protocol change.
- **Shipped file map (orientation):** shared logic `src/lib/{types,redact,dice,dice3d,
  pointerDrag,sceneUtils,clampToViewport,visibility,sceneMessages,localFlags,history}.ts`;
  server `partykit/server.ts`; shell `src/App.tsx` + `src/panels/registry.tsx` (dock tabs +
  pop-out windows) + `src/components/{Dock,FloatingWindow,FloatingCluster,Directory,
  ActorsPanel,ItemsPanel,PartyPanel,ScenePanel,SceneSettings,CharacterSheet,TokenEditor,
  InitiativeTracker,LogPanel,LogToasts,NotesPanel,DiceTray,SettingsPanel,MapCanvas,
  MapToolbar,MapFog,MapVision,JoinScreen}.tsx`; DM prep pages
  `src/pages/{PageShell,PlayersPage,NpcsPage,ScenesPage,SheetCards}.tsx`; 3D dice
  `src/dice/{engine,geometry,audio,trayScene,useDiceOverlay}.ts`; map tools
  `src/map/tools/{types,registry,select,measure,draw,calibrate,fog,walls,lights}`.
- **Working state is uncommitted on the revamp branch** (the whole revamp, Phases 0–5.5).
- **Manual checks still owed by the user:** (a) 3D dice feel in two browser windows —
  tray ready/gather/throw, constant size across zoom, window-aware walls; (b) Phase 5
  visuals — grid calibration gesture on a real map image, fog render (black for players /
  50% for DM), ruler + drawing feel, snap-to-grid; (c) Phase 5.5 shell feel — window
  resize/maximize from every edge, drag-to-every-edge recoverability, toast lift over the
  tray, page switcher flow, wide-sheet two-column layout; (d) Phase 6 vision *feel* in two
  windows — draw walls/doors, place lights, turn global illumination off, give a player
  token vision, and confirm the player sees only their LOS (walls occlude, doors open/close,
  lights reveal, tokens in the dark are hidden) while the DM's 👁 Preview matches;
  (e) Phase 6.5 — fog brush feel (reveal/cover/sizes/invert/reset; player opaque, DM 50%),
  Scenes editor (pan/zoom independence from the board, Live-ON instant vs Live-OFF staged
  edits + Apply/Discard/Set-Live, hotkeys on the Scenes page don't switch the board tool),
  Players tab bar (toggle/multi-open/rename/remove/add).
  Everything protocol-level + the LOS geometry is already machine-verified.

**Locked decisions**
- **Layout:** one full-bleed board; FoundryVTT-style **docked right sidebar** of panel tabs,
  each pop-out-able into a draggable window; sheets are floating windows.
  *(Revised 2026-07-02, user: "no separate pages" is superseded — a lightweight top-left
  **page switcher** adds DM-only prep pages (Players, NPCs, Scenes, later Tokens/Assets);
  players stay on the Board — sheets open as (resizable, maximizable) windows. The Board
  remains the play surface: nothing needed mid-encounter may require leaving it. See
  Phase 5.5.)*
- **Visual style:** CSS design-token layer (`src/styles/tokens.css`); current look is a
  placeholder skin somewhere between the `design_example/` MythicScribe system and
  FoundryVTT's minimal UI. Invest in the token architecture, not final polish.
- **3D dice (superseded "rebuild fresh"):** **hybrid, shipped** — debugged v1 core recovered
  from git `e23a632` (geometry/pre-sim/track/face-labeling), integration rebuilt fresh;
  grab-shake-throw from a tray UI onto the board; recorded-track sync.

**Constraints (apply to every phase)**
- Cloudflare R2 free tier (10GB) — images/audio compressed, URLs only in GameState, never blobs.
- PartyKit full-state broadcast — every new state field needs a size cap; big/hot data gets its
  own transient message instead of riding GameState.
- Every new `GameState` field MUST be added to `normalizeGameState()`/`normalize*` in
  `src/lib/types.ts` (it rebuilds state explicitly — unknown fields are silently dropped).
- Players must never *receive* data they shouldn't see. UI hiding is not enough — secrets are
  stripped server-side in `redactStateFor` (Phase 0) and verified at the WebSocket-frame level.
- Low-end friendliness: 3D/vision work lazy-loads, renders on demand, and has fallbacks.

## Traceability — `revamp_todo.md` → phases

| Todo item | Phase |
|---|---|
| Layout for menus (FoundryVTT inspiration) | 0 ✅ — docked sidebar + pop-out windows |
| Tactile UI/UX theme | 0 ✅ (design tokens), evolving skin thereafter |
| 3D dice + dice tray, textures/perf question | 4 ✅ |
| Improve character sheet | 1 ✅ |
| Dice rolls use sheet stats/modifiers (DM: many NPCs) | 2 ✅ |
| Roll and action log | 2 ✅ |
| Roll-for-initiative button | 3 ✅ (full initiative tracker) |
| Token add/remove improvements; click token → sheet; per-section DM reveal | 1 ✅ |
| DM grid size change | 5 ✅ — calibration gesture + numeric inputs |
| Measure distance | 5 ✅ — synced ruler, Chebyshev feet |
| Annotations | 5 ✅ — freehand draw; DM persists, players fade |
| Walls, lights, vision (+directional) | 6 ✅ (v1: walls/doors/lights + LOS mask; directional cones deferred to 7 with token facing) |
| Soundboard (idea) | 9 |
| Custom CSS themes (idea) | 9 (enabled by 0; themed after 8) |
| Actors/Items directories, folders, inventory *(added via UX feedback)* | 1–2 (shipped: `Directory`, folders, `sortOrder`, sheet inventory) |
| Docked sidebar + pop-out, masked secrets, transient toasts *(UX feedback)* | shipped (post-3) |
| Shell/layout fixes: toasts vs tray, settings panel, rail reorg, page switcher *(user 2026-07-02)* | 5.5 ✅ |
| Sheets/items depth, roll breakdown colors, fog brush, HP quick-adjust, templates, coin flip *(user 2026-07-02)* | 7 |
| Tabbed character-sheet redesign (reference layout) + token facing/rotation *(user 2026-07-02)* | 7 (structure; final skin in 8) |
| Fog brush + invert, Scenes page = full editor (live toggle + Set Live), Players tab bar, prep secrecy *(user 2026-07-03)* | 6.5 ✅ |
| Full aesthetic revamp — tactile/paper/wood + sound design *(user 2026-07-02)* | 8 |

---

## Phase 0 — Foundation: design tokens, redaction, hot-path split, floating windows — ✅ SHIPPED

Small, low-risk, and everything later depends on it.

> **As built:** all landed as specced, plus (from UX feedback) the floating-window model
> evolved into the **docked sidebar**: `Dock.tsx` renders a vertical icon rail hugging the
> right edge (rail always visible; panel column collapses with a chevron, ~180ms animation);
> any tab pops out into a `FloatingWindow` (⇱) and docks back (⇥). Windows clamp back
> on-screen on browser resize. Shared dock geometry lives in CSS vars `--dock-rail-w`/
> `--dock-panel-w`. Registry entries have `icon` + `dockable`; `sheet` is floating-only.
> Also shipped: in-game server ERRORs never eject a client (transient auto-dismissing
> banner instead), and bottom-right **LogToasts** (fade-in/out notifications for new log
> entries, suppressed while the Log panel is visible, sliding with the dock).

**Design tokens.** New `src/styles/tokens.css`: palette/type/spacing/radius/elevation as CSS
variables (model the variable *set* on `design_example/arcane_archive/DESIGN.md` — surface scales,
primary/accent, display/body/mono type roles, 4px spacing unit, elevation levels 0–3). Refactor
`src/index.css` to consume only tokens; keep the current dark palette as the default skin. Re-theming
later = editing one file (and directly enables Phase 9 custom themes).

**Per-role state redaction (cross-cutting).** New `src/lib/redact.ts`, pure function shared by
server and tests:
```ts
type StateView = { role: "dm" } | { role: "player"; playerId: string } | null; // null = lobby/unjoined
export function redactStateFor(state: GameState, view: StateView): GameState;
```
- DM → passthrough. Player/lobby → rules grow per phase: NPC sheet sections (P1), dmNotes (P1),
  dmOnly log entries + others' whispers (P2), hidden-token names in combat (P3), hidden tokens (P5),
  LOS-invisible tokens (P6 stretch).
- Call sites: `broadcastState()` (per connection — it already loops connections) and
  `sendLobbyState()` (currently leaks full state to unjoined sockets — `server.ts:156`). NOT
  `persistState()` — storage keeps full truth.
- Client: `normalizeGameState()` must tolerate redacted records (render "???", not zero-filled
  defaults).
- Every secret feature adds a redact rule + a WS-frame-level verification step.

**Viewport hot-path split.** `flushViewport()` (`server.ts:207`) currently calls
`broadcastState()` — full state at ~15Hz while the DM pans. Replace with a lightweight S→C
`{type:"VIEWPORT", viewport}` message; client patches `state.viewport` only. This is the one real
scaling breaker; the same transient-message pattern is reused later (MEASURE, DICE_THROW,
SOUND_ONESHOT).

**Floating windows + panel registry.** New `src/components/FloatingWindow.tsx`: draggable,
z-ordered panel (title bar, close, position remembered in localStorage, Esc closes focused).
`FloatingCluster` stays for anchored button clusters; content panels (sheet, log, initiative,
NPC roster) become windows so several can be open at once. `App.tsx`'s single `rightPanel` enum →
`Set<PanelId>`, driven by a **panel registry** (`src/panels/registry.ts`): each module declares
`{ id, title, icon, roles: ("dm"|"player")[], component }` and the shell renders toolbar toggles +
open windows generically. Adding any future panel = one registry entry + one component — no
`App.tsx` surgery. (Sheet windows are parameterized instances: `sheet:{sheetId}`.)

**Hygiene.**
- Delete dead compression path in `sceneUtils.ts` (`prepareImageFromFile`,
  `compressImageToDataUrl`, `MAX_WS_IMAGE_BYTES` — no callers; maps already go to R2). Keep the
  900KB `UPDATE_SCENE` payload guard in the server as a generic cap.
- Namespace new R2 upload keys by room (`functions/api/upload-*` currently use bare
  `tokenId`/`slotId` keys) — enables the Phase 9 asset library and future GC.
- Reconnect UX: PartySocket already auto-reconnects and `useGameRoom` re-sends the pending join;
  add a "Reconnecting…" toast instead of the terminal error state.

**Verify:** `npm run build`; two windows — DM pan produces small `VIEWPORT` frames (network tab),
no full-STATE spam; lobby socket receives redacted state; windows drag/stack/persist positions;
visual regression pass after CSS tokenization.

---

## Phase 1 — Sheets as first-class entities, token↔sheet links, hidden sections, sheet UX — ✅ SHIPPED

Highest-leverage data-model change; unblocks rolls-from-sheets (P2) and initiative (P3).

> **As built:** as specced, with later growth: `SheetSectionId` also has `"inventory"`
> (items round); `SheetRecord` gained `folderId` + `sortOrder` (Actors directory);
> `NpcPanel.tsx` was superseded by **`ActorsPanel.tsx`** (PCs + NPCs, folders, search,
> drag-to-board via `pointerDrag` + `dropActorAt`, drag-reorder). `CREATE_SHEET` takes a
> client-generated `sheetId`. Sheets open as floating windows from token clicks, avatar
> double-clicks, and directory rows.

**Data model** (`src/lib/types.ts` + migration in `normalizeGameState()`):
```ts
type SheetSectionId = "identity" | "combat" | "abilities" | "saves" | "skills" | "notes";
type SheetRecord = {
  id: string;                    // PC sheets keep id === slotId (near-zero migration)
  kind: "pc" | "npc";
  ownerSlotId: string | null;
  data: CharacterSheet;          // inner shape unchanged
  revealed: Record<SheetSectionId, boolean>;  // NPC default all-false; PC all-true
};
GameState.sheets: Record<string, SheetRecord>;  // replaces characterSheets
Token.sheetId: string | null;                   // player tokens auto-link via ownerPlayerId
GameState.dmNotes: string;                      // redacted to "" for players
```
Migration folds legacy `characterSheets[slotId]` → `sheets[slotId]` so old Durable Object states
load untouched. Many tokens may share one sheet (six goblins, one stat block); `DUPLICATE_SHEET`
for individuated HP. `syncPlayerTokenFromState()` reads `sheets[ownerPlayerId].data`.

**Messages:** `CREATE_SHEET {kind:"npc", name}`, `UPDATE_SHEET {sheetId, sheet}` (authz: DM any,
player only own), `DELETE_SHEET` (unlinks tokens), `SET_SHEET_REVEAL {sheetId, section, revealed}`,
`DUPLICATE_SHEET`, `UPDATE_DM_NOTES`. `usePlayerSheet` becomes a thin wrapper over `UPDATE_SHEET`.

**Redaction rule (first real consumer):** players get NPC sheets stripped to revealed sections +
a `redacted` marker so the UI renders "???" instead of zeros. Other players' PC sheets stay
visible (party transparency).

**UI:**
- Click token → its sheet opens in a `FloatingWindow` (players see the redacted view — the
  "unknown monster = blank sheet" behavior from the todo). DM `TokenEditor` gains
  "Link sheet ▾ / New NPC sheet / Open sheet".
- `CharacterSheet.tsx` usability rewrite: collapsible section cards matching `SheetSectionId`
  (cards are also the reveal-checkbox granularity — eye icon per card header for DM), larger hit
  targets, ability stat chips, DM can edit any sheet in place.
- New `src/components/NpcPanel.tsx`: DM roster of NPC sheets (search, open, duplicate, delete).
- DM notes: simple textarea window, debounced.

**Verify:** player clicks unmet enemy → all sections hidden; DM reveals "abilities" → player sees
it live; DM edits NPC HP → survives server restart; legacy rooms migrate; player `UPDATE_SHEET`
on another sheet → server error; NPC data absent from player/lobby WS frames.

---

## Phase 2 — Unified roll & action log, sheet-integrated rolls, chat/whispers — ✅ SHIPPED

> **As built:** as specced, with two later changes: (1) secret rolls are **masked**, not
> dropped — players receive a `masked: true` roll entry ("🔒 DM rolled in secret", no
> label/expression/values) via `redactStateFor`; chat entries also carry `fromId` for
> whisper visibility. (2) `DicePanel.tsx` no longer exists — the roller UI is the Phase 4
> **DiceTray** (a slim draggable bar, not a dock tab); the log lives in the Log dock tab.
> Adv/dis on sheet rolls = Shift-click / Alt-click.

**Data model:**
```ts
type LogEntry =
  | { id; t; kind: "roll"; roll: DiceRoll; actor: { name; sheetId? }; label?: string; dmOnly?: boolean }
  | { id; t; kind: "event"; text: string; dmOnly?: boolean }
  | { id; t; kind: "chat"; from: string; text: string; whisperTo?: string /* slotId | "dm" */ };
GameState.log: LogEntry[];   // replaces publicDiceLog; persistState caps at 100 (~30KB)
```
- `ROLL_DICE` extended: `{expression, private?, context?: {sheetId?, label?}, adv?: "adv"|"dis"}`.
  Server attributes the roll to `sheets[sheetId].data.characterName` (authz: player own sheet only;
  DM any sheet — this is how the DM rolls across many NPCs). `adv` = roll d20 twice keep high/low.
- `SEND_CHAT {text, whisperTo?}`. Redaction: `dmOnly` entries and whispers filtered per viewer
  (visible to sender, target, DM). DM secret rolls become `dmOnly` log entries — replaces the
  ephemeral `DM_DICE_ROLL` side channel, so the DM's secret log survives refresh.
- Server `logEvent(text, dmOnly?)` helper called from scene/token/reveal/join/leave handlers.
  Curated: no per-move spam (token moves log only during combat, Phase 3).

**UI:** new `src/components/LogPanel.tsx` (window): merged feed (rolls via `formatDiceRoll`,
events muted, chat bubbles), input row with `/w name` whisper syntax, filter chips
(All/Rolls/Chat). `DicePanel.tsx` slims to roller controls; its log moves here.

**Sheet integration:** every ability/save/skill row + initiative on `CharacterSheet.tsx` becomes
click-to-roll (`1d20+mod`, context `{sheetId, label:"Stealth check"}`); modifier menu for adv/dis;
the DM's persistent Secret toggle applies to sheet-clicks too.

**Verify:** player clicks Stealth +7 → "Vex — Stealth check: 1d20+7 → [16]+7 = 23" for everyone;
DM secret-rolls off a goblin sheet → entry only in DM log, survives refresh; whispers invisible to
third parties at the WS-frame level; log capped at 100.

---

## Phase 3 — Initiative system + combat token state — ✅ SHIPPED

> **As built:** as specced (tracker is the "Combat" dock tab, auto-focused on combat
> start). One deliberate redaction nuance: an unrevealed NPC sheet normally strips HP, but
> tokens with `showHp !== "none"` pass **just the hp numbers** through redaction so players
> can draw the bar — DM opt-in, documented in `redact.ts`. `entry.hidden` masking exists
> but nothing sets `hidden` until Phase 5's `Token.hidden`.

**Data model:**
```ts
GameState.combat: null | {
  round: number;
  turnIndex: number;
  entries: Array<{ id; tokenId: string|null; sheetId: string|null; name: string;
                   initiative: number|null; dexScore: number; hasRolled: boolean; hidden?: boolean }>;
};
Token.conditions: string[];             // from a CONDITIONS const (poisoned, prone, …)
Token.showHp: "none"|"bar"|"values";    // player-visible HP display; HP lives on the linked sheet
```
**Messages:** `COMBAT_START {tokenIds}` (server builds entries from the active scene — PCs pending,
NPCs auto-rolled `1d20 + dexMod + initMod` via `secureRandInt`), `COMBAT_ROLL_INITIATIVE` (player,
one click, uses own sheet, logs the roll), `COMBAT_SET_INITIATIVE` (DM override/manual entry),
`COMBAT_NEXT`/`COMBAT_PREV` (wrap → `round++`), `COMBAT_END`.
**Sort:** initiative desc, then dexScore desc, then stable server tiebreak. Unrolled entries sort
last with a "waiting…" badge; server re-sorts as rolls arrive. Redaction masks hidden-token names.

**UI:** `src/components/InitiativeTracker.tsx` (window, auto-opens on combat start): portraits,
gold current-turn highlight, round counter, Next/Prev/End (DM), "Roll initiative!" CTA for players.
`MapCanvas.tsx`: pulsing ring on current-turn token, condition badges arced around tokens, HP bar
under token per `showHp` (DM always sees bars), HP ≤ 0 → desaturated + skull.

**Verify:** ⚔ button → players get CTA, NPCs pre-filled; ties sort by DEX; mid-combat joiner sees
correct tracker; hidden NPC shows "???" to players; HP bar tracks sheet edits live.

---

## Phase 4 — 3D dice: grab, shake, throw onto the board (+ dice tray) — ✅ SHIPPED

> **As built (2026-07-02):** shipped per the locked design below; protocol verified by
> `tests/smoke-phase4.mjs` (10/10). Actual layout:
> - **Files:** pure protocol lib `src/lib/dice3d.ts` (specs/track types, d100 decompose +
>   interpret, `sanitizeThrow` validation — server-safe; the *message* variants live in
>   `types.ts`), recovered `src/dice/geometry.ts` + `src/dice/audio.ts` (near-wholesale from
>   `e23a632`), adapted `src/dice/engine.ts` (camera from the local viewport, DPR cap 1.5,
>   no pane clipping), tray scene `src/dice/trayScene.ts`, controller
>   `src/dice/useDiceOverlay.ts` (lazy engine boot, preloads when 3D enabled), tray UI
>   `src/components/DiceTray.tsx`.
> - **Sizing (revised twice same day, user feedback):** dice are **map-glued and
>   screen-sized** — a roll's world footprint is FROZEN at throw time (`k0` = world units
>   per physics unit at the roller's zoom, sent as `worldScale` on
>   `DICE_THROW_REQUEST`/`DICE_THROW` so every client places dice at the same world
>   spots). Pan/zoom moves dice 1:1 with the board like tokens; each die's *mesh* rescales
>   live around its own landing spot so it always renders `DIE_SCREEN_PX` (77px) wide.
>   (The first revision rescaled the whole group per zoom — that made dice slide across
>   the map when zooming; superseded.) Zoomed far out, constant-size dice may overlap —
>   accepted.
> - **Physical tray (revised same day, user feedback):** the tray is a real dice tray — a
>   felt well (own small Three scene in `trayScene.ts`, shared geometry cache) holding one
>   resting die per size (the d100 slot holds its real percentile pair — blue tens d10 +
>   red unit d10 — which highlights/lifts/throws as one unit). Clicking a d# button
>   **readies** dice: matching tray dice glow with a pulsing gold outline; repeat clicks
>   add duplicates (right-click removes one; an always-visible "↩" button at the far left
>   of the controls clears all — greyed out when nothing is readied — as does Esc; cap 12
>   physical dice). Dragging any glowing die picks
>   up the whole readied set — dice within reach keep their offsets, far ones **gather onto
>   a ring next to the cursor** — then shake and release to throw. Dragging an unlit die
>   throws just that one; a plain click lobs gently up-screen. Throws **re-anchor at the
>   release point** (not view center), so dice land where you threw them; the expression
>   input still auto-throws from view center. Grabs hand off tray→arena at the exact tray
>   pose (seamless lift; dice grow 62→77px in hand).
> - **Throw physics tuning (same day, user feedback):** killed the "lands then bounces
>   straight back" artifact — (1) release spin is **forward tumble** (topspin about
>   up×v̂ + jitter); fully random spin gave half of throws backspin, which friction turns
>   into a backward kick on landing; (2) wall restitution 0.4→0.18 (dead walls). Verified
>   with a rapier probe: visible rebounds 12/60→2/60, avg give-back 1.3u→0.4u.
> - **Window-aware walls (same day, user feedback):** the physics box is now **derived
>   per throw from the roller's own screen** — window edges minus a 24px margin, minus the
>   dock column and the open tray drawer (App registers a `setSafeAreaProvider` that
>   measures `.dock`/`.dice-tray--open` rects fresh at each throw). Dice can no longer
>   roll off-screen or settle hidden behind UI. Key property: walls exist only in the
>   roller's pre-sim, so the box is baked into the recorded track — **zero protocol/server
>   changes**, remote replay untouched. Constant screen-size dice make px→physics a fixed
>   ratio (`DIE_SCREEN_PX / DIE_WIDTH_UNITS` ≈ 40.5px/u). A per-wall minimum distance from
>   the anchor (`MIN_WALL_DIST`) floors degenerate boxes on tiny windows/edge releases.
>   This obsoleted the earlier forward-bias hack (runway is now the real screen space in
>   the throw direction), which was removed.
>   `dragEnd` — previously the dice camera froze during a pan and the dice "teleported
>   back" on release. Server already coalesces `UPDATE_VIEWPORT` (~15Hz), so per-move
>   emission is safe.
> - **Shell:** tray toggled by a "🎲 Dice" button in the top-left cluster (not a dock tab —
>   the old dice tab/`DicePanel` were removed); the 3D canvas is `.dice-arena` (fixed,
>   z-index 5, pointer-events none — grabs start from the tray well and ride window
>   listeners). The tray is **draggable from anywhere on its body** (except the felt well,
>   which grabs dice) via a 5px move-threshold so button clicks still register; the trailing
>   click is swallowed after a drag. Position persists to `cm-dice-tray-pos`; `clampPos`
>   keeps the **whole** tray on-screen (measured size + margin) on load/resize/drag so it
>   can't be stranded; **double-click a blank part of the tray resets** it to bottom-center.
>   Toggling slides + fades it in/out at its current spot (`transform: translateY` +
>   `opacity`, component stays mounted so the tray scene persists).
> - **Text-roll SFX (user feedback):** non-3D rolls (Roll button / d# buttons when 3D is
>   off) play a dice sound via `src/lib/rollSound.ts` — an optional `public/sounds/
>   dice-roll.mp3` if present, else a synthesized rattle placeholder; respects the shared
>   `dice-muted` key. 3D throws still sound through the engine.
>   The tray scene's canvas is absolutely positioned inside the well — a shrink-to-fit
>   container sized by its own DPR-scaled canvas is a runaway-width feedback loop. "3D"
>   on/off toggle (localStorage + `prefers-reduced-motion` default) falls back to text
>   `ROLL_DICE` (felt well hidden, d# buttons roll as text); 🔒 secret toggle (DM) and 🔊
>   mute live here.
> - **Server:** `DICE_THROW_REQUEST` handler validates via `sanitizeThrow`, rolls per-spec
>   with `secureRandInt`, broadcasts `DICE_THROW` per-connection (faceValues stripped +
>   `actorName:"DM"` for non-DM on secret), and **defers the log append** by track duration
>   (+400ms, ≤8s cap) so the log never spoils the tumble.
> - **Not yet built (follow-ups):** live shake relay (`DICE_MOTION` stretch), the
>   "animate sheet rolls in 3D" preference (sheet clicks are still text rolls), and the
>   quick "instant" resolve option. Physics *feel* still owes a manual two-window check
>   (plus the new tray: ready/gather/throw and constant-size-across-zoom).

> **Locked decisions (2026-07-02, user):** tactile dice — the player picks a die up from a
> **tray (a normal UI element, not on the board)**, shakes, and **throws it onto the board**,
> where it physically tumbles. Multiplayer motion sync = **recorded track** (v1 concept).
> Approach = **hybrid**: recover the debugged v1 core from git as a quarry, rebuild the
> integration fresh. Also reconciled with shipped Phases 1–3 + UX rounds: secret rolls **mask**
> (players see `🔒 DM rolled in secret`, never nothing), the Secret toggle is persistent
> (`App.secretRolls`), and the shell is dock + pop-out windows.

**The experience:**
- **Dice tray = UI module**: a slim rack holding d4/d6/d8/d10/d12/d20/d100 + the text expression
  input + (DM) the persistent Secret toggle. Defaults to bottom-center; **draggable and
  hideable** like other modules — reuse `FloatingWindow`'s positioning/persistence/resize-clamping
  with slimmer "hotbar" chrome; a small 🎲 toggle (FAB or dock tab) shows/hides it.
- **Grab → shake → throw**: pointer-drag a die out of the tray, shake it, release to throw. A
  "Roll" button remains for click-only users; an "instant" option resolves text-only.
- **Dice land on the board**: the 3D canvas is a full-window overlay under the dock; dice are
  **world-anchored** at the roller's view center (`trayCenter` in map coords) and **world-sized**
  (~0.5–0.7 grid cells, like tokens). Each client renders them through its *own* viewport (clients
  have independent pan/zoom now) — anyone looking at that map region sees the dice land there;
  anyone panned away still gets the log entry/toast. Physics runs in a fixed box centered on
  `trayCenter` in world units, so the recorded track replays identically everywhere.

**Fairness + secrecy (unchanged principles):** results are server-authoritative
(`secureRandInt`) — physics never decides values. The roller's client runs the v1 hidden
pre-simulation to record the track and identify the landing face; the server picks the values;
every client labels the landing face **before** replay, so the die comes to rest already showing
the correct number (no visible snap). Secret DM throws: log entry is `dmOnly` (players get the
**masked** entry via the existing redaction) and the `DICE_THROW` broadcast omits
`faceValues` for non-DM → players watch **blank dice** tumble. Read `App.secretRolls` at throw
time; no per-roll secret control.

**Protocol (transient — nothing rides GameState; zero R2):**
- C→S `DICE_THROW_REQUEST {rollId, specs, track, modifier, context?, trayCenter}` — the recorded
  track is a few KB of positions/rotations per frame; server caps payload (~100KB) and frame count.
- S→C `DICE_THROW {rollId, actorName, specs, track, trayCenter, faceValues?, secret?}` —
  `faceValues` stripped for non-DM on secret rolls. Server also appends the `LogEntry` (reusing
  the Phase 2 attribution + masking path; `context {sheetId, label}` works as everywhere else).
- **Stretch:** v1's live shake relay (`DICE_MOTION` ~30Hz + roller cursor) so others watch the
  shake itself — additive, ship the throw first.
- Text `ROLL_DICE` stays for typed/odd expressions (`1d77` → text-only or blank-crystal stretch).

**Textures / storage / memory (answers the todo question):** everything is procedural — runtime
polyhedra + canvas-drawn number decals (a few ~256px textures reused across dice). **0 bytes of
R2**; nothing to download. Fancier skins (marble/metal/gem) plug in at the single
`createDiceMaterial()` swap point; even image-based skins would ship in the app bundle (KBs on
Pages), still not R2. Memory footprint is trivial (low-poly meshes, tiny shared textures); the
costs are the lazy-loaded three+rapier chunks and ~2s of physics per throw.

**Hybrid build plan:** recover from git HEAD `e23a632` as a **quarry, not a foundation** —
`src/dice3d/diceGeometry.ts` (procedural shapes + number orientation, the most debugged code)
mostly wholesale; the engine's pre-sim/track-record/replay/face-labeling/settle internals
selectively. Rebuild fresh: protocol types (in `types.ts`, not a separate diceProtocol),
`useGameRoom` subscribe hook (replaces the removed `DM_DICE_ROLL` channel), tray UI, and all
dock/masking/log integration. **Delete v1 complexity the new shell obsoletes:** map-pane
`clip-path` (canvas is full-window, dock sits above it), `REGION_PANE_FRACTION` zoom-cancel scale
math (dice are world-sized now), the separate secret log channel. Rationale: runtime perf is
library-bound and identical fresh-vs-recovered; recovery wins the fiddly debugged bits (face
detection, d4/d10 number orientation, settle detection), fresh wins integration fit.

**Sheet click-rolls (recommend):** per-client "animate sheet rolls in 3D" preference (**off by
default**); when on, ability/skill/save clicks throw a d20 from the view center instead of
resolving as text.

**Perf:** three/rapier load on first tray-open or throw; render-on-demand loop (sleeps at rest);
DPR cap 1.5; ≤12 physical dice (bigger pools resolve text-only); "skip 3D animation" preference +
`prefers-reduced-motion` → text fallback with identical results and totals.

**Verify:** two windows — a thrown die tumbles at the same world spot in both, identical motion
(track replay) and identical values; the die rests already showing the server value (no visible
rotation-to-value); secret DM throw → players see blank dice **and** the masked "🔒 DM rolled in
secret" entry, never values (check the WS frame); track payload ≤ a few KB typical, server rejects
oversized tracks; tray slides in/out at bottom-center (as built — no drag/persisted position);
initial page load ships no three/rapier chunks; text fallback and 3D clients agree on totals.

---

## Phase 5 — Map tools I: grid calibration, ruler, annotations, manual fog, hidden tokens — ✅ SHIPPED

Builds the map-tool architecture Phase 6 reuses; manual fog is the cheap fog-of-war win before
dynamic vision.

> **As built (2026-07-02):** shipped per spec; protocol verified by `tests/smoke-phase5.mjs`
> (17/17, including WS-frame-level hidden-token redaction). Deltas from the prose below:
> - **Tool framework:** `src/map/tools/{types,registry,select,measure,draw,calibrate,fog}` —
>   tools implement `{ id, label, icon, hotkey, dmOnly?, cursor, onDown/Move/Up,
>   renderDraft }`; `MapCanvas` routes stage pointer events to the active tool in world
>   coords and holds the tool's transient `draft`; committed work = ordinary room
>   messages. `MapToolbar.tsx` renders from the registry (left edge) + contextual
>   options (draw colors/widths/clear, fog on/reset, calibrate hint) + the per-client
>   🧲 snap toggle. Hotkeys V/M/D/G/F + Esc live in MapCanvas (no separate
>   `shortcuts.ts` yet — add one when Phase 6 needs Space/`?`).
> - **Calibration** is its own DM tool (🎯 G): drag a box over one square → gridSize +
>   offsets; the drag is **square-constrained** (follows the dominant axis — a cell is a
>   square). ScenePanel has numeric inputs (size, offsets, feet/square, grid
>   color/opacity) as fine-tuning.
> - **Middle-mouse pan** (user feedback): a manual pan handler on the stage (window
>   listeners, not Konva draggable) — works for DM and players and **while any tool is
>   active**; tokens can't be middle-dragged (Konva drags stay left-button). Tools only
>   receive left-button pointerdowns. The toolbar's contextual options panel is
>   absolutely positioned beside the rail so opening it never shifts the rail.
> - **Ruler:** press-drag single segment (no waypoints yet — deferred); relayed as
>   transient `MEASURE` C→S/S→C, 40ms per-sender server coalescing, no self-echo, 2s
>   linger + client-side stale pruning; name + slot color tag; Chebyshev
>   squares × `feetPerSquare`.
> - **Annotations:** freehand strokes (rect/circle/text render but no tools yet);
>   `ADD/REMOVE/CLEAR_ANNOTATIONS` (no UPDATE — nothing edits yet). Server forces
>   `ephemeral: true` for players (~10s TTL timer), re-stamps `authorId`, caps 120
>   points/stroke and 200 persistent/scene by **dropping the oldest** (not rejecting).
>   Erase = right-click a drawing while Draw is active (author-or-DM, enforced
>   server-side); DM 🗑 clears the scene.
> - **Pointer arrow (recovered from v1 e23a632, user feedback):** hold **Shift + left-drag**
>   in select mode to fling a dotted cream-on-dark **arrow** (`kind:"arrow"`) that fades out
>   over ~10s — the old "look here" ping, restored exactly (two dashed Konva `Arrow`s,
>   `tension 0.5`, arrowhead; sparse 48px network sampling + dense local preview; min
>   length 24; `annotationOpacity` fade ramp driven by a 50ms `fadeClock`; helpers live in
>   the recreated `src/lib/mapAnnotation.ts`). Always allowed for everyone and always
>   ephemeral (server forces it), independent of the Draw permission below. Shift disables
>   the stage pan-drag and tokens `stopDrag` on shift so the arrow draws cleanly over them.
>   Preview→committed handoff: commit includes the exact release point (equal length) and
>   the local preview stays up while its own server echo is hidden (`pendingArrowId`) until
>   they swap in one paint — so a shorter duplicate never overlaps the original. Per-author
>   live-arrow cap `MAX_POINTER_ARROWS_PER_AUTHOR = 5` (server-enforced): drawing past 5
>   **removes** that author's oldest arrow. Fade-out is **client-local** (a "ghost"):
>   MapCanvas snapshots any arrow that leaves `scene.annotations` and fades that copy over
>   `ANNOTATION_FADE_MS` (0.6s) using local time — smooth and immediate for both the cap
>   drop and end-of-life removal, with no server-timestamp fragility (an earlier attempt
>   that aged `createdAt` into a shared ramp caused a jump-then-pause and was replaced).
>   Committed arrows render at opacity 1 while present; ephemeral strokes still use the
>   `annotationOpacity` tail.
> - **Draw permission (user feedback):** `GameState.playersCanDraw` (**default false**).
>   The Draw *tool* is hidden from players and their strokes are server-rejected until the
>   DM flips it on via the toolbar's draw-options "Players: on/off" button
>   (`SET_PLAYERS_CAN_DRAW`, DM-only). The pointer arrow is exempt (on by default). If the
>   DM revokes while a player is in Draw mode, the client falls back to select.
> - **Fog-lite:** `Scene.fog {enabled, reveals}` rect+circle reveals (poly deferred),
>   DM-only `FOG_SET/FOG_REVEAL/FOG_RESET`, cap 300 (oldest dropped); rendered as a
>   dedicated Konva layer (black + `destination-out` reveals) **above tokens** — players
>   opaque, DM 50%; Shift-drag = circle reveal.
> - **Hidden tokens:** `Token.hidden` toggle in TokenEditor; `redactStateFor` strips them
>   from player frames (and their showHp exception); DM sees 40% ghosts; `COMBAT_START`
>   stamps `entry.hidden` → players see "???" in the tracker.
> - **Snap-to-grid:** per-client toggle (localStorage), snaps token drag-end + placement
>   clicks to cell centers honoring grid offsets.
> - Grid fields ride the existing `UPDATE_SCENE` (no new message); all new Scene fields
>   flow through `normalizeScene` with sanitizers shared by the server handlers
>   (`sanitizeAnnotation`/`sanitizeFogReveal` in `types.ts`).

> **Already shipped (pre-phase):** drag-an-actor-onto-the-board token placement
> (pointer-drag → `dropActorAt`). `src/lib/pointerDrag.ts` (threshold, ghost, hit-test)
> remains available for drag-style tools. Left window edge was free (dock is on the right).

**Tool architecture:** `src/components/MapToolbar.tsx` — left-edge cluster with modal tools:
Select (V), Measure (M), Draw (D), Fog (F, DM), later Walls (W). Tools are plug-in modules in
`src/map/tools/` implementing one shared interface —
`{ id, label, hotkey, roles, cursor, onPointerDown/Move/Up, renderOverlay(konvaLayer) }` — and a
tool registry feeds the toolbar, exactly like the Phase 0 panel registry. `MapCanvas.tsx` just
delegates pointer events to the active tool; adding a future tool (walls in Phase 6, or anything
later) = one module + one registry entry. Keyboard registry `src/lib/shortcuts.ts` (tools,
Space = next turn for DM in combat, `?` overlay) — note Esc-closes-window is already handled inside
`FloatingWindow.tsx`, so coordinate rather than duplicate.

**Grid calibration (todo: DM grid size).** `Scene.gridOffsetX/Y`, `Scene.feetPerSquare`
(default 5), optional `gridColor`/`gridOpacity` — via `normalizeScene()` defaults. Calibration
mode in `ScenePanel.tsx`: numeric inputs plus the gesture — DM drags a box over exactly one map
square → `gridSize = dragW`, offset = drag origin mod size. Per-client snap-to-grid toggle snaps
token drag-end to cell centers.

**Ruler (todo: measure distance).** Ephemeral + synced via transient relay (no GameState):
C→S `MEASURE {points, sceneId} | null` throttled ~30Hz, S→C rebroadcast with `{name, color}`,
66ms server coalescing (same pattern as viewport). Click-drag measures, click adds waypoints;
label shows squares + feet; 5e Chebyshev distance (diagonal = 1 square) with a 5-10-5 room option;
2s linger.

**Annotations.** Synced; DM strokes persist until erased, player strokes auto-fade (~10s server
timer) to keep state bounded:
```ts
Scene.annotations: Array<{ id; authorId; kind:"stroke"|"rect"|"circle"|"text";
                           points?; x?;y?;w?;h?; text?; color; width; createdAt; ephemeral: boolean }>;
```
Point decimation + caps from old `mapAnnotation.ts` (git reference): sample distance ~48px, max
120 points/stroke, 200 persistent objects/scene (server-enforced). Messages: `ADD_ANNOTATION`,
`UPDATE_ANNOTATION`, `REMOVE_ANNOTATION`, `CLEAR_ANNOTATIONS` (DM).

**Fog-lite (manual reveal).** Vector reveals — NOT the old `fogDataUrl` canvas mask (a data-URL
mask in state would recreate the broadcast-bloat problem):
```ts
Scene.fog: { enabled: boolean; reveals: Array<{ kind:"rect"|"poly"|"circle"; … }> };
```
DM paints reveal shapes; render = full-black Konva layer with `destination-out` reveal shapes;
players opaque, DM 50%. Cap ~300 shapes; `FOG_RESET`. Honest note: the map image URL itself is
fetchable by a determined player (FoundryVTT shares this property) — fog is a visual gate.
**Token secrecy is the real gate:** `Token.hidden: boolean` (DM toggle in `TokenEditor`);
`redactStateFor` strips hidden tokens from player frames entirely; DM sees them ghosted at 50%.

**Verify:** drag-calibration aligns an off-center commercial map; ruler visible to all with name
tag + correct feet; player scribble fades ~10s, DM arrow persists across restart; fog hides
regions for players; hidden token absent from player WS frames; state with 200 annotations + 300
reveals < ~150KB; snapped drops land on cell centers with offset.

---

## Phase 5.5 — Shell & layout round — ✅ SHIPPED

Core UI/layout fixes the user flagged before Phase 6: the shell has outgrown the
placeholder top-left cluster, floating UI needs a universal can't-lose-it guarantee, and
the top-left corner becomes a page switcher.

> **As built (2026-07-02):** shipped per spec (`npm run build` + all smoke/unit suites
> pass; shell-only — zero server/protocol changes). Deltas & notes:
> - `src/lib/clampToViewport.ts` exports `clampToViewport` + `clampSizeToViewport`
>   (+`CLAMP_MARGIN`); DiceTray's local clamp delegates to it; `FloatingWindow` clamps
>   the WHOLE window on mount/drag/resize-drag/window-resize (previously title-bar-only).
> - `FloatingWindow` geometry is `{x, y, w, h|null}` (`h: null` = auto height, CSS-capped)
>   persisted under the existing `cm-window-pos:{id}` key — the old `{x,y}` shape still
>   loads. Resize = 8 invisible grab zones (`.win-rs--*`, inside the border since the
>   window clips overflow); maximize (⛶/❐) is transient (not persisted); double-click
>   title bar = default pos+size. `PanelDef` gained optional `minWidth/minHeight`.
> - **Settings** is a floating-only registry panel (`SettingsPanel.tsx`): 3D dice, dice
>   sound, snap-to-grid, roll/chat toasts, reset UI layout, Leave; DM extra = players-can-
>   draw mirror. Snap state was LIFTED from MapCanvas to App (same `cm-map-snap` key) so
>   settings + the toolbar 🧲 share it; toasts pref = `cm-log-toasts`; dice mute now
>   persists/initializes from `dice-muted` even before the 3D audio engine loads.
> - **Reset UI layout** clears `cm-window-pos:*` + `cm-dice-tray-pos`, then bumps a
>   `layoutEpoch` — open windows remount to defaults (their keys include the epoch); the
>   tray watches a `resetSignal` prop and re-centers without remounting (tray scene lives).
> - **Rail order:** 🪪 sheet, separator, tabs, 🎲 dice, spacer, ⚙ settings, chevron —
>   via a generic `DockAction { slot: "top" | "after-tabs" | "bottom" }` prop on `Dock`.
>   The old top-left cluster is gone.
> - **Toasts** lift above the open tray by measuring both rects (300ms recheck while
>   visible — the tray is draggable); the stack's *natural* (unlifted) rect decides, so no
>   oscillation. z-index 15→35 (above pages, below windows).
> - **Pages** are opaque overlays INSIDE `.overlay` (z: dock 20 < tray 25 < page 30 <
>   switcher 32 < toasts 35 < windows 40+). MapCanvas + dock + tray stay MOUNTED under
>   pages (board keeps viewport/selection; tray scene persists); floating windows/token
>   editor render only on the Board. All three pages stay mounted (hidden via
>   `.page--active`) so each keeps its selection/drafts across switches. Combat start
>   setPage("board") for the DM. Players: no switcher, `activePage` forced to "board".
> - **Pages content:** shared `PageShell` (roster column + `container-type` main).
>   Players = slot admin roster (reuses `.party-slot` styling + selection) beside a
>   full-size editable PC sheet; NPCs = the real `ActorsPanel` as roster (its `openSheet`
>   prop selects into the page instead of opening a window) beside a full-size sheet with
>   reveal eyes; Scenes = `ScenePanel` beside a large active-map preview (Phase 7 grows
>   this into the selected-scene prep editor).
> - **Sheet multi-column** is a container query: `.window-body` and `.sheet-col` are
>   `container-type: inline-size`; `.sheet-body` ≥620px → 2 CSS columns
>   (`break-inside: avoid` cards). No JS.
>
> **QoL round (2026-07-02, user feedback — same-day follow-up):**
> - **Drag a die back into the tray to cancel the throw.** `DiceEngine.cancelActiveDrag()`
>   removes the armed dice without releasing; `useDiceOverlay.rideDrag` tracks whether the
>   pointer ever *left* the tray well and, on release back over it, cancels + restores the
>   readied selection (so a plain click-in-place still lobs). Tray-well hit-test reads a
>   plain ref mirror of the well element; `grabbedSelectionRef` snapshots the pre-grab
>   selection to restore.
> - **Resizable page roster.** `PageShell` owns the left column width (drag divider
>   `.page-resize`, persisted `cm-page-roster-w`, 220–640px, clamps on window shrink).
> - **Multiple sheets side-by-side.** Players/NPCs pages hold an `openIds` list rendered
>   by the shared `pages/SheetCards.tsx` as fixed-width (400px) columns in a horizontal
>   scroller; each column is its own size container so sheets stay single-column/compact
>   (this also fixes "skills column too wide"). `.stat-row` switched from flex
>   space-between to a fixed 3-column grid so save/skill inputs align across rows.
> - **Players roster rows** are now click-anywhere-to-open (not just the name box);
>   double-click the name to rename (readOnly input until then, `key={slot.name}` remounts
>   on external rename). Open rows highlight; card ✕ closes.
> - **Portrait upload** is the thumbnail itself — a `<label>`-wrapped file input
>   (`.sheet-portrait-btn`); empty state shows a dashed "＋ / Add photo" affordance, filled
>   shows "Change" on hover. The separate "Upload portrait" text link was removed.
>
> **QoL round 2 (2026-07-02, user feedback — same-day):**
> - **NPCs page shows NPCs only.** `ActorsPanel` gained `filterKind?: "pc" | "npc"`; the
>   page passes `"npc"` (and hides the blank-token drag chip, which can't reach the
>   board-covered page anyway). The dock Actors tab still lists PCs + NPCs.
> - **Directory redesign** (`Directory.tsx`, shared by Actors/Items/NPCs page):
>   FoundryVTT-style — labeled `Create {NPC/Item}` + `Create Folder` buttons up top; a
>   search row with an inline 🔍, an A–Z sort toggle (view-only, doesn't touch manual
>   order), and a collapse/expand-all-folders button; folder headers with a folder glyph,
>   bold name, member count, a per-folder ＋ create and delete; rows now show a 2rem
>   rounded-square portrait, bold name, and an **inset** bottom separator (margin, not
>   edge-to-edge). Portrait-less rows show a kind glyph (👤/🎒) on the color chip. The old
>   top "new name" text input is gone (create auto-numbers, then opens the sheet/editor to
>   rename). `onCreate` gained an optional `folderId` — actors move in via createSheet +
>   setSheetFolder, items via createItem + updateItem (both rely on ordered messages;
>   no server change).
> - **Tokens use the linked sheet's portrait live.** `MapCanvas` resolves a token's image
>   from `sheets[token.sheetId ?? token.ownerPlayerId].data.iconUrl` first, falling back to
>   the drop-time `token.imageUrl`, then the color — so uploading/changing a portrait
>   updates placed tokens immediately (previously only the drop-time snapshot).
> - **Visible resize grip.** `FloatingWindow`'s SE corner handle (`.win-rs--se`) now sits
>   fully inside the window and draws a diagonal-line grip (`::after`), so windows visibly
>   advertise resize; all other invisible edge/corner handles are unchanged.

**Universal on-screen clamping (new engineering rule #7).** Extract the dice tray's
clamp into a shared helper — `src/lib/clampToViewport.ts`:
`clampToViewport(pos, size, margin=8)` keeps the WHOLE element inside the window.
Refactor `DiceTray` onto it and apply it to `FloatingWindow` (currently only partially
clamps on resize) on load, drag-end, and resize. Every draggable floating element also
gets a **reset affordance** (tray: double-click blank area, shipped; windows: double-click
title bar → default position + size). All future floating UI uses the helper.

**Resizable floating windows (user).** `FloatingWindow` gains resize handles on all four
edges + corners (invisible ~6px grab zones, corner cursors) plus a **maximize/restore
button** in the title bar. Per-window min size (content-driven) and max = viewport; size
persists to localStorage beside the position; panel bodies already scroll so content
reflows; the sheet renders multi-column when its window is wide. Resizing respects the
whole-window on-screen clamp (and window sizes clamp down on small screens). The sheet
window benefits most — for players a maximized sheet window IS the "character page"
(which is why players need no page switcher).

**LogToasts vs the draggable tray (occlusion-aware stack).** Toasts stay bottom-right
(they mirror the Log tab living in the right dock). Fix: measure the open tray's rect
(same pattern as the dice safe-area provider measuring `.dice-tray--open`) and lift the
toast stack above it when they'd overlap. Bottom-left was considered and rejected — the
DM's TokenEditor cluster and the map toolbar already own the left side, and a draggable
tray can collide with any fixed corner anyway.

**Right rail reorg + settings panel (top-left cluster removed).**
- **Sheet** becomes a square icon at the very TOP of the dock rail (above the panel tabs).
  It toggles the floating sheet window as today — `sheet` stays floating-only.
- **Dice tray** toggle moves to the rail, placed after the panel tabs (per user: not in
  the top two slots).
- **Settings** (⚙) sits at the bottom of the rail, just above the collapse chevron. Opens
  a settings panel (floating-only registry entry, like `sheet`): 3D dice on/off, dice/UI
  sound mute, snap-to-grid, log-toast notifications on/off, **reset UI layout** (clears
  saved tray/window positions), and the **Leave** button (moved from the old cluster).
  DM extra: mirror the players-can-draw toggle here (it also stays in draw options).
- The dock rail needs "action button" entries (non-tab icons: sheet, dice, settings) —
  a small `Dock.tsx` extension alongside the tab list.

**Page switcher (top-left, DM only).** Lightweight state-routing in `App.tsx` (`page:
"board" | "players" | "npcs" | "scenes"` — no router lib; the Extensibility section
reserved exactly this). A compact top-left switcher replaces the old cluster — **rendered
only for the DM**; players have no pages (user decision: with resizable/maximizable sheet
windows and token-click/avatar-double-click access, a player Characters page is redundant
chrome — trivially addable later via the shared shell if Phase 7's richer sheets warrant
it). DM sees **Board · Players · NPCs · Scenes** (+ Tokens in Phase 7). **Board stays the
play surface** — dock, tray, toolbar, and windows live there; pages are prep/large-surface
views and hide the board chrome (toasts stay global). Sheet pages share one layout shell
(roster column + full-size, multi-column `CharacterSheet`, click-to-roll intact — rolls
hit the shared log).
- **Players page** (DM only): party administration + PC sheets — per-PC cards with
  connection pill + slot admin (rename/remove/add slot) beside each full-size sheet.
  This revives the pre-revamp "Players" tab from `e23a632`, whose full-size embedded
  sheets were lost in the bare-bones strip-down. The compact Party dock tab stays for
  quick in-play glances.
- **NPCs page** (DM only): the stat-block authoring workspace — full NPC directory
  (folders/search/create/duplicate/delete, reuse `ActorsPanel`) beside a full-size,
  in-place-editable sheet with section-reveal eyes (Phase 7's richer sheets land here
  with room to be usable). Kept separate from Players per user: administration and
  authoring are different workloads.
  *(History note: the page switcher restores the pre-revamp
  `DmView = main|players|scenes|tokens` structure; the old
  `TokenLibraryPanel`/`SceneSettingsModal` at `e23a632` are quarry for the Scenes and
  Phase 7 Tokens pages, like the dice engine recovery.)*
- **Scenes page** (DM only): roomier scene manager — scene list, settings, large map
  preview (reuse `ScenePanel` pieces). Phase 7 grows this into the detailed prep editor
  (edits the *selected*, not active, scene — invisible to players until "Set active").
- **Tokens/Assets page: deferred to Phase 7** — without asset management it would be an
  empty room; nav entry appears when it lands (DM-only, like Scenes).
- **Connective rules:** toasts are global (chat/rolls/events reach every page); combat
  start pulls the DM back to Board with an unmissable prompt (players are always on
  Board); each page preserves its own state across switches (board keeps viewport/
  selection/windows).

**Verify:** drag every window + the tray to all four edges → always fully recoverable,
double-click resets work; toast stack visibly lifts above a bottom-right tray; settings
round-trip (toggle → reload → persisted) and Leave works from the panel; rail order =
sheet / tabs / dice / … / settings / chevron; page switch preserves board state (viewport,
selection); players see NO page switcher and cannot reach any page; windows resize from
every edge/corner, maximize/restore, and a wide sheet window goes multi-column;
`npm run build` + full smoke suites (shell only — no protocol change expected).

---

## Phase 6 — Walls, lights, dynamic vision (the big one) — ✅ SHIPPED (v1)

> **As built (2026-07-03):** a coherent v1 shipped and machine-verified
> (`smoke-phase6.mjs` + `unit-visibility.test.ts`, all green; full suite re-run clean;
> `npm run build` passes). Deltas from the spec below, and what was deferred:
> - **Data model:** `Scene.walls: Wall[]`, `Scene.lights: Light[]`,
>   `Scene.globalIllumination` (**default true** — existing scenes stay fully lit until the
>   DM opts in), `Token.vision {enabled, rangeFt}`. Light radii are in **feet** (converted
>   to world px via `gridSize / feetPerSquare`) to match darkvision units. All go through
>   `normalizeScene`/`normalizeToken` with `sanitizeWall`/`sanitizeLight`/
>   `sanitizeTokenVision`; degenerate (zero-length) walls dropped; caps **600 walls / 50
>   lights** enforced server-side.
> - **Messages:** `SET_WALLS` (replace-set, batched per edit), `TOGGLE_DOOR`,
>   `ADD/UPDATE/REMOVE_LIGHT` — all DM-only (behind the existing "only the DM can control
>   the map" gate). `globalIllumination` + token `vision` ride the existing
>   `UPDATE_SCENE`/`UPDATE_TOKEN`. No new hot-path message.
> - **`src/lib/visibility.ts`** (pure, unit-tested): classic angular sweep — rays at every
>   endpoint ±ε, bounded by a box; `wallsToSegments` drops open doors; `pointInPolygon` for
>   the LOS test. Key fix: the segment-parameter tolerance must be ≪ the angular-ε
>   displacement or the "past the corner" rays graze the endpoint (that was the one subtle
>   bug; covered by the corner-peek + gap unit checks).
> - **Rendering (`src/components/MapVision.tsx`):** `VisionMaskLayer` — a darkness sheet
>   **above the tokens** (so it also hides tokens standing in the dark), erased
>   (`destination-out`) inside each viewer token's LOS polygon (a Konva `clipFunc`) where
>   its darkvision circle or any enabled light's reach lands. **Simplification:** lights
>   are radius circles gated by the *viewer's* LOS — walls block the viewer's sight, but
>   lights don't yet cast their own shadows (a lamp around a corner from the viewer is
>   correctly hidden by viewer-LOS; a wall between lamp and lit area is not). Dim-vs-bright
>   gradation is not split yet (single darkness level; `dimR` is the outer reach). Vision
>   recomputes on state change (token drag-**end**), memoized on a token-position/walls
>   signature so the arrow/ruler fade-clock re-renders don't re-sweep.
> - **DM UX:** walls render as lines / doors as (green when open) dashed lines, lights as
>   gold markers with faint reach rings (`WallsLightsEditor` layer), interactive only with
>   the matching tool. **Walls tool (🧱 W):** drag = wall, **Shift-drag = door**, endpoints
>   snap to grid **intersections** when snap is on; click a door to open/close, right-click
>   a segment to delete. **Lights tool (💡 L):** click to place (default 20/40 ft), drag to
>   move, right-click to delete. Toolbar options for both expose **Lighting on/off**
>   (toggles `globalIllumination`) and **👁 Preview** (DM sees the mask as a player would).
>   `TokenEditor` gained a vision on/off + darkvision-range field; `ScenePanel` has the
>   global-illumination toggle + wall/light counts. `ToolRuntime` gained `snap`.
> - **Deferred (documented leaks / stretches, per the spec):** walls/lights are broadcast
>   to players (the client computes vision), so wall geometry is a **documented devtools
>   leak** — server-side LOS redaction (dropping unseen tokens/walls in `redactStateFor`)
>   is NOT done; token hiding in darkness is visual (the mask covers them). Also deferred:
>   dim/bright two-level shading, lights casting their own shadows, live vision during a
>   drag (updates on drag-end), "View as [specific player]", low-spec 0.25× canvas,
>   explored-area memory, and directional cones (`Token.facing` lands with the Phase 7
>   token-rotation work and will clip the LOS to a wedge then). Door toggle is DM-only for
>   now (players opening doors is a later nicety).

**Data model:**
```ts
Scene.walls:  Array<{ id; x1;y1;x2;y2; kind:"wall"|"door"; open?: boolean }>;
Scene.lights: Array<{ id; x;y; brightR; dimR; color?; enabled: boolean }>;
Token.vision: { enabled: boolean; rangeFt: number /* darkvision; 0 = none */; angle?: number };
Token.facing?: number;                 // degrees — stretch
Scene.globalIllumination: boolean;     // lit-everywhere scenes skip the light pass
```
Messages: `SET_WALLS {sceneId, walls}` (batched on edit-commit — no per-segment broadcasts),
`TOGGLE_DOOR {wallId}`, `ADD/UPDATE/REMOVE_LIGHT`. Caps: 600 wall segments, 50 lights per scene
(~30KB worst case).

**Visibility polygon** — new `src/lib/visibility.ts`, pure TS, unit-testable: classic angular
sweep. Collect wall endpoints (closed doors count as walls), cast 3 rays per endpoint (θ−ε, θ,
θ+ε) + scene corners, keep nearest hit per ray, sort by angle → polygon. O(E²) naive is fine at
≤600 segments; optimize only if profiling demands. Clip to vision-range circle (cone for stretch).

**Rendering (Konva compositing):**
- **Player:** one offscreen canvas at 0.5× screen resolution composited over the map: fill black →
  for each owned token with vision, `destination-out` its LOS polygon ∩ (bright-light union ∪
  darkvision range); second pass at 50% alpha for dim light. Light emission areas are themselves
  LOS polygons cast from the light (lamps don't shine through walls).
- **DM:** unmasked by default; "View as [player]" toggle for spot-checks.
- **Recompute policy:** only on input change — owned-token drag (~10Hz throttle, exact on
  drag-end), wall/door/light mutation, scene switch. Memoized per `(tokenX, tokenY, wallsVersion)`.
  No per-frame raycasting.
- **Token visibility:** v1 hides unseen tokens client-side (documented devtools leak). **Stretch
  (recommended):** `visibility.ts` is pure TS, so the server can run the same LOS check inside
  `redactStateFor` and drop enemy tokens no owned token can see — closes the leak properly.
  (Server-CPU note: memoize per `(tokenPos, wallsVersion)` and reuse across the broadcast
  loop — never recompute per connection.)
- **Low-spec mode (per-client, visual-only):** vision canvas drops to 0.25× resolution
  (blurrier fog edges, same information — quality settings can never reveal MORE, only
  render coarser). Lives in the 5.5 settings panel.
- **Explored-area memory (stretch):** append simplified seen-polygons into Phase 5's
  `Scene.fog.reveals` (throttled) — players keep a dimmed explored map; reuses fog rendering
  wholesale (why fog-lite ships first).
- **Directional cones (stretch, todo's "vision based on where they are looking"):** `facing` via
  rotate handle / Alt+scroll; clip LOS to cone; facing wedge drawn on token.

**Editors:** Walls tool — click-chain segments, snap to grid intersections + 45°, drag endpoints,
right-click delete, door toggle. Lights tool — click-place, drag radius rings. Both reuse the
Phase 5 tool plumbing.

**Verify:** unit tests for `visibility.ts` (corridor, corner-peek, closed vs open door, collinear
endpoints); player sees only lit LOS area and others' tokens vanish behind walls; door toggle
propagates <100ms; 600-wall scene >30fps on integrated graphics; darkvision sees unlit rooms
within range only; (if built) LOS redaction verified at WS-frame level.

---

## Phase 6.5 — Scene editor, fog brush + invert, Players tab bar, prep secrecy — ✅ SHIPPED

> **As built (2026-07-03):** shipped per the spec below and machine-verified —
> `smoke-scenes.mjs` (9/9) + `unit-scene-editor.test.ts` (32/32), full suite re-run green
> (9 smoke + 4 unit; mandatory since redaction changed), `npm run build` passes.
> Implementation notes beyond the spec:
> - New files: `src/lib/{sceneMessages,localFlags}.ts`, `src/components/SceneSettings.tsx`
>   (extracted from ScenePanel — the dock tab keeps the scene list + live active-scene
>   settings); ScenesPage/PlayersPage rewritten; `PageShell` now serves the NPCs page only.
> - `MapCanvas` sizing moved from `useWindowSize` to a ResizeObserver on `.map-root`
>   (single code path; identical on the board where the root is fixed/inset-0), plus the
>   `hotkeysEnabled` / `embedded` props. Fog compositing is painter's-order in ONE Konva
>   layer (`FOG_COLOR` shared by base + cover shapes; DM 50% opacity applies at layer
>   compositing, after the ops — never split the fog across layers).
> - The editor's staging (`editorSend`) folds scene-shape messages into a per-scene draft
>   via `applySceneMessage`; ephemeral/arrow annotations and MEASURE always pass through
>   live; drafts strip ephemeral annotations at baseline AND apply. Toggling Live back ON
>   auto-applies every dirty draft (nothing silently lost).
> - Gotcha found by the smoke test: fresh rooms start with TWO default scenes
>   (`createDefaultScenes`) — tests must count, not assume one.
> - The fog tool no longer has rect/circle gestures (brush + click-dab only); previously
>   stored rect/circle shapes still render, now with optional cover mode.
>
> **Fog/tools polish round (2026-07-03, user feedback):**
> - **Fog opacity is now uniform for the DM regardless of overlap.** The bug: Konva applies
>   a Layer's `opacity` per child (`getAbsoluteOpacity`), so the old `opacity={0.5}` fog
>   layer dimmed each shape independently and overlaps compounded (0.5-over-0.5 = 0.75).
>   Fix: fog renders at full layer opacity (overlaps flatten to a single opaque mask), then
>   a **single trailing full-scene `destination-out` rect at opacity 0.5** (DM only) halves
>   the whole flattened alpha in one pass — uniform everywhere. Lives in the new memoized
>   `src/components/MapFog.tsx` (`FogLayer`). Never split fog across layers or wrap it in a
>   cached group.
> - **Brush lag fixed by memoization.** A brush stroke only mutates the tool's `draft`
>   (rendered in the topmost overlay layer), never `scene.fog`. `FogLayer` is `React.memo`,
>   and `VisionMaskLayer`/`WallsLightsEditor` are now memoized with `useCallback`-stabilized
>   wall/light handlers, so a stroke no longer re-diffs the committed fog/wall/light nodes
>   (previously every pointer-move re-created and re-diffed up to 300 fog shapes).
> - **Tool option popups redesigned** (`MapToolbar`): uniform equal-width/height buttons in
>   labeled rows (`.map-opt-label`/`.map-opt-row`/`.map-opt-btn`, 12rem panel). New
>   functionality, still zero new message types: **walls** get a Wall/Door mode toggle
>   (Shift still flips) + Clear-walls (`SET_WALLS []`); **lights** get Candle/Torch/Lantern
>   size presets (`ToolRuntime.lightRadii`, `LIGHT_PRESETS`) + Clear-lights
>   (`UPDATE_SCENE {lights:[]}`); both keep the Lighting on/off + 👁 Preview row. Fog
>   options regrouped (Fog/Invert, Reveal/Cover, size, Reset). `ToolRuntime` gained
>   `wallKind` + `lightRadii`.
>
> **Lights/fog/undo round (2026-07-03, user feedback):**
> - **Lights stay LOS-gated for players** (user's explicit choice): a light only reveals
>   area inside a vision token's line of sight — a player with no vision token sees darkness
>   (`VisionMaskLayer`, LOS-gated). What was "broken" was the DM's ability to *see* lights
>   working. Fix: a **DM lighting overview** — when a scene has dynamic lighting on and the
>   DM is NOT previewing, `DmLightingOverlay` dims the map (~62%) and cuts every light's
>   **wall-clipped pool** (LOS ∩ dim radius, `useLightCoverage`) + any vision token's
>   darkvision **fully bright**: the omniscient "here's my lighting" view, no token needed.
>   The 👁 preview stays the honest LOS-gated player view (hint when no token has vision).
>   The earlier faint always-on coverage glow was removed (too subtle; superseded). The
>   lighting toggle now reads its state — **☀ Fully lit** ↔ **🌙 Dynamic**.
>   **Key setup gotcha:** lights do nothing until global illumination is off (🌙 Dynamic) —
>   with it on (default), the whole scene is already lit. Order: Lights tool → 🌙 Dynamic →
>   place lights (dimmed pools appear immediately for the DM); add a player token with
>   vision + 👁 Preview to check the LOS-gated player view.
> - **Player tokens default to vision** (`normalizeToken`: `ownerPlayerId` set + no explicit
>   vision → `{enabled:true, rangeFt:0}`) so a player isn't stranded in black the instant the
>   DM turns on dynamic lighting — they see lit areas within their token's line of sight
>   automatically; the DM still overrides (off / add darkvision) per token. Enemies default
>   to no vision. Applied client-side on every STATE receive, so existing player tokens gain
>   it too. (Was the root cause of "player view is completely black" — the player's token had
>   no vision.)
> - **Clicking an existing light/wall no longer places a new one** — markers are tagged
>   `name="map-handle"` and the stage `onPointerDown` skips the active tool when the target
>   is a handle, so a click drags the light / toggles the door instead.
> - **Fog brush is smooth** — the tool keeps a **live endpoint** that tracks the cursor
>   every move (the preview no longer jumps in decimation-sized chunks) and samples denser
>   (`max(fogBrushR/3, gridSize/6)`). Fog **brush size is a slider** (`fogBrushScale`,
>   0.15–3 grid cells) replacing S/M/L.
> - **Undo/redo (DM, client-side)** for scene edits (annotations/fog/walls/lights) **and**
>   tokens (add/move/update/delete). New `src/lib/history.ts` (`useHistory` +
>   `buildInverse`): each mutation records a command/inverse pair built from existing
>   messages (scene edits → `UPDATE_SCENE(preScene)`; token ops → per-kind inverse), so
>   **zero new message types**. `App` wraps `room.send` as `historySend` (used by
>   `useDmActions`, the board `MapCanvas` send, `onMoveToken`, and drop-actor) and resets
>   the stack on scene switch/leave; ↶/↷ rail buttons (`MapToolbar`) + `Ctrl/⌘+Z` /
>   `Ctrl+Shift+Z` (or `Ctrl+Y`). **Scope: board (live) edits.** The scene editor's staged
>   changes aren't in this history — its **Discard** reverts the whole draft; fine-grained
>   staged undo is a follow-up. Covered by `tests/unit-history.test.ts`.

User feedback round (2026-07-03) that pulled **Fog brush** and **Scenes-page map editor
depth** forward from Phase 7 and reworked two pages. Decisions locked with the user:
Players tabs are **toggle chips** (side-by-side multi-sheet stays); map tools live on
**both** the board toolbar and the Scenes editor; players **stop receiving** non-active
scenes. **Zero new message types** — only `FOG_SET` gains `inverted?` and the `FogReveal`
union gains a `brush` variant.

**Fog brush + invert.**
- `FogReveal` union: rect/circle gain `mode?: "reveal" | "cover"`; new
  `{ kind:"brush"; points:number[]; r:number; mode? }` (flat world coords, stroke width
  2r). Absent mode = "reveal" (back-compat — sanitizers only ever *emit* `mode:"cover"`).
  `SceneFog.inverted: boolean` (false = starts covered, reveals cut; true = starts clear,
  cover paints fog in). `MAX_FOG_BRUSH_POINTS = 120` flat numbers; `sanitizeFogReveal`
  brush branch (≥4, even, finite, sliced; r clamped [4, 2000]); worst case ~290KB state
  accepted (decimation keeps real strokes ~10–30 points).
- Fog tool (F) becomes a **brush**: paint to reveal/cover, decimated `max(r/2, gridSize/4)`
  (draw-tool idiom), click-dab → circle shape, commit via existing `FOG_REVEAL` (300-shape
  oldest-dropped cap unchanged). Toolbar fog options: Reveal/Cover mode, 3 brush sizes
  (gridSize × 0.35/0.75/1.5), **Invert** (FOG_SET with flipped `inverted`), on/off, Reset.
- Rendering: painter's-order compositing in ONE Konva layer — base black rect only when
  not inverted, then shapes in array order (cover = source-over dark, reveal =
  destination-out; brush = round-cap Line at 2r). DM 50% opacity unchanged (applies after
  layer compositing — never split the fog across layers).

**Scenes page → full scene editor.**
- **`src/lib/sceneMessages.ts`** (pure): `sceneMessageSceneId(msg)` +
  `applySceneMessage(scene, msg)` — client-side mirror of the server's scene handlers
  (UPDATE_SCENE, SET_WALLS, TOGGLE_DOOR, ADD/UPDATE/REMOVE_LIGHT, FOG_SET/REVEAL/RESET,
  ADD/REMOVE/CLEAR_ANNOTATIONS) reusing normalize/sanitize + caps; same reference returned
  for anything else. Server stays authoritative (no server refactor).
- **`SceneSettings.tsx`** extracted from ScenePanel (name/map/grid/fog incl. Inverted/
  illumination/background) parameterized `{scene, roomId, onPatch, onSetFog, onResetFog}`;
  dock ScenePanel = scene list + SceneSettings wired live to the ACTIVE scene; the editor
  inspector wires it to the SELECTED scene through the staging path.
- **MapCanvas** gains `hotkeysEnabled?` (board passes `activePage==="board"`; the editor
  canvas only renders while the Scenes page is active — exactly one hotkey listener lives
  at a time) and `embedded?` (`.map-root--embedded`; stage sizes from a ResizeObserver on
  the root element instead of the window — identical values on the board).
- **ScenesPage**: top scene **tabs** (chip per scene, gold "● Live" badge on the active
  one, dirty dot on staged ones, ＋ Add) + actions (Live-updates toggle persisted
  `cm-scene-editor-live`, Apply/Discard when staging, **Set Live on Board** = SET_SCENE);
  main = embedded MapCanvas with LOCAL viewport (fit on switch; never `dm.updateViewport`);
  right inspector ≈300px = SceneSettings + Delete scene. **Staging** (Live updates OFF):
  per-scene drafts `{scene, baselineJson}`; `editorSend` routes scene-shape messages
  through `applySceneMessage` into the draft (MEASURE + ephemeral arrows still forward
  live; token moves always live via `onMoveToken`); Apply = ONE `UPDATE_SCENE` with the
  draft (ephemeral annotations stripped); Set Live auto-applies dirty drafts; baseline
  mismatch renders a "⚠ changed on the board" hint. Token pre-staging (drag actors into
  the editor) stays in Phase 7.
- Accepted edges: Apply clobbers concurrent live edits to the same scene (single DM);
  one-round-trip flash on Apply; measure tool's module-level linger shared between the two
  canvas instances (cosmetic only).

**Players page top tab bar.** The left roster column (wasteful at 4–5 players) is
replaced by a browser-tab-style `.chip-tabs` row: chip per slot (status dot + name),
**click toggles** that sheet open/closed in the side-by-side SheetCards scroller,
double-click renames inline, hover ✕ removes the slot, trailing ＋ Add creates "Player N".
PageShell (roster + divider) remains for the NPCs page only.

**Prep secrecy (redaction).** `redactStateFor` player branch: `scenes` filtered to the
active scene only; `tokens` filtered to that scene (on top of the hidden-token strip);
`hpVisibleSheetIds` computed after filtering. Players can no longer inspect prepped
scenes/walls/fog via devtools — prep is invisible until **Set Live**. Verified safe:
players only ever render the active scene; server-side MEASURE validates against full
server state; SET_SCENE swaps list + id atomically in one STATE frame.

**Verify:** `npm run build`; new `tests/unit-scene-editor.test.ts` (fog sanitizer,
inverted round-trip, `applySceneMessage` coverage + caps, active-scene-only redaction);
new `tests/smoke-scenes.mjs` (player frames contain exactly the active scene, brush/invert
round-trip + DM-only, Apply-path full-scene UPDATE_SCENE); re-run ALL suites (redaction
changed); two-window manual — brush feel, editor pan/zoom independence, Live-ON instant /
Live-OFF staged edits, Set Live flow, hotkey isolation, Players tabs.

---

## Phase 7 — Game-content depth: sheets, items, rolls, DM tools — planned

The "make it playable for a real campaign" phase (user, 2026-07-02). Each item follows
the fixed recipe (GameState field → normalize → message → redaction → cap).

### Tabbed character-sheet redesign (reference layout — user 2026-07-02)

The user supplied screenshots of a target character-sheet UI the **popup sheets should
follow** (a rich, digital-VTT 5e sheet with a persistent left "vitals" sidebar and a
right-side vertical **page rail** that swaps the main area between pages) — six of a **PC**
(Perrin, Halfling Monk) and one of an **NPC** (Animated Armor). This is the
**layout/structure** spec; the ornate parchment/red-banner **skin** is a Phase 8 aesthetic
concern — build the structure + behavior here (consuming the "Sheets fleshed out" data
model below), apply the final look in Phase 8. The sheet stays a resizable
`FloatingWindow` (Phase 5.5) and, wide, the main area already goes multi-column.

**Scope (user 2026-07-02): layout + manual fields FIRST, automation LATER.** Build the
structure and hand-editable fields; do **not** auto-compute encumbrance, attunement limits,
rest recovery, or trait-driven crit math yet. Automation is a **separate future plan** the
user wants to design once we understand the rules-engine work — leave clean hooks
(derived-stat builder, `traits` map) but keep everything manually settable for now.

**Shell (persistent on every page).**
- **Left "vitals" sidebar** (collapsible via a `‹` tab on its right edge):
  - Large framed **portrait** (click-to-upload, Phase 5.5 affordance).
  - **AC shield** badge showing AC (the octagon reading `15`).
  - Three badges: **Initiative** (+3), **Walk/Speed** (25), **Proficiency** (+2).
  - **Hit Points** bar (`9 / 9`) with a **TMP** (temp HP) control; **Hit Dice** bar
    (`1 / 1`).
  - **Death saves (PC only):** a small **skull** button that **toggles a slide-down
    tracker** — the skull centered, **3 success slots on the left, 3 failure slots on the
    right** (click to fill). Collapsed by default; slides down over the Favorites area when
    opened.
  - **Favorites** section with a "Drop favorite" drop zone (drag actions/items here for a
    quick-access row).
- **Top header:** character **name** + subtitle (`class level`, e.g. "Monk 1"); two header
  buttons = **Short Rest** (🍴) and **Long Rest** (⛰) *(confirmed)*; an ornate
  **level ring** badge (right). Window chrome keeps the existing ⋮ / dock / ✕ controls.
- **Right vertical page rail** (the sub-page switcher; icon → page):
  1. ⚙ **Main** — ability scores + skills/saves/proficiencies (default page). **PC only —
     NPCs omit this tab** (see NPC variant below).
  2. 🎒 **Inventory**.
  3. ☰ **Features**.
  4. 📖 **Spells** — spell slots + prepared/known list; **always present, just empty** for
     non-casters (not hidden) *(confirmed)*.
  5. ⚡ **Effects**.
  6. 🖋 **Biography**.
  7. ★ **Special Traits**.

**Pages (right rail).**
1. **Main:** top row of six **ability blocks** (abbr, modifier, score: STR −1/8, DEX +3/16,
   …). Left **Skills** list — each row: governing-ability abbr, proficiency dot
   (empty/half/expertise), skill name, total mod, and **passive** score. **Tools** list
   below (same row shape). Middle **Saving Throws** (2-col grid, proficiency dots).
   **Immunities** / resistances as pills (e.g. "Advantage against being frightened").
   **Weapon/armor proficiencies** as pills ("Simple", "Shortsword"). **Languages** as
   pills. Right column: **type/species/background** chips ("Humanoid · halfling",
   "Lightfoot Halfling", "Priest") each with an icon → opens that detail.
2. **Inventory:** **encumbrance** header (`weight / capacity` bar — red when over,
   STRENGTH, SIZE, MULTIPLIER), **attunement** thumbnails + counter (`0 / 3`), **currency**
   row (CP/SP/EP/GP/PP). Search + filter/sort. Item **tables grouped by category**
   (Weapons, Equipment, Consumables, Loot) with columns per group: icon, name/subtitle
   (type · action), WEIGHT, QUANTITY (± steppers), PRICE, **ROLL** (to-hit, e.g. +5),
   **FORMULA** (damage, e.g. 1d6+3), CHARGES (n/max), and row actions (attune/equip,
   expand, ⋮). Per-category **+ add**. Rows link to the Items catalog (`itemId`); attacks
   surface on the Main/attacks area when equipped.
3. **Features:** class chip header (Monk 1). Search + filter/sort. Grouped **Class
   Features** / **Species Features** (and feats), columns USES / RECOVERY, row expand + ⋮,
   **+ add**. (Unarmored Defense, Martial Arts, Lucky, Brave, Halfling Nimbleness, …)
4. **Spells:** spellcasting page — spell slots per level (current/max), prepared/known list
   grouped by level, cast/prepare toggles. **Always present; simply empty** for non-casters
   (no hide) *(confirmed)*.
5. **Effects:** **Passive Effects** list (name, SOURCE, on/off toggle, ⋮) + a **Conditions**
   grid of the 15 5e conditions (Blinded … Unconscious) as toggles. Ties into
   `Token.conditions` (Phase 3) — toggling here should reflect on the token and vice-versa.
   **+ add** custom effect.
6. **Biography:** top **details grid** (Alignment, Faith, Gender, Eyes, Hair, Skin, Height,
   Weight, Age). Collapsible **Ideals / Bonds / Flaws** (left) and **Personality Traits /
   Appearance** (right). Full-width rich-text **Biography** (the current `notes`/bio field),
   with an edit affordance + artwork credit line.
7. **Special Traits:** **Original Class** dropdown (multiclass base). **Feats** list —
   each a name + description with a **lock/enable** toggle (manual overrides that grant a
   rules effect, e.g. Diamond Soul, Alert, Jack of All Trades, Observant, Reliable Talent,
   Remarkable Athlete) plus numeric override inputs (Weapon/Spell Crit Threshold, Melee
   Crit Damage Dice). **Species Traits** list (Elven Accuracy, Halfling Lucky, Powerful
   Build …) as the same enable-toggle rows. These are **DM/player switches that adjust
   derived math** (crit range, extra dice, half-proficiency) — model as a
   `sheet.data.traits: Record<string, boolean | number>` consumed by the roll/derived-stat
   builder.

**Data-model additions this layout implies** (fold into "Sheets fleshed out" below; all
under `SheetRecord.data`, section-reveal aware, capped): temp HP + death saves + hit dice;
currency + carried weight/capacity + attunement slots; tool proficiencies; languages;
damage/condition immunities & resistances; weapon/armor proficiencies; feats/traits toggle
map; per-page item/feature/effect rows (row-count caps). New `SheetSectionId`s per page so
NPC redaction stays automatic. Reuse: the tab rail is the same "action-button rail" idiom
as the dock (Phase 5.5); pages reuse the Directory/table + search/sort atoms; conditions
reuse the Phase 3 `CONDITIONS` set + `Token.conditions`.

**NPC variant (user 2026-07-02 — from the Animated Armor screenshot).** NPCs get the **same
sheet minus the ⚙ Main tab**; their rail starts on **☰ Features**, which becomes the NPC's
home page. Differences:
- **No Main tab** → the ability scores + saves live on the **Features page header** instead:
  a top row of six **ability blocks** (STR +2/14, DEX +0/11, …) with an inline
  **saving-throw** row directly beneath (proficiency dot + mod + shield per ability).
- **Richer left sidebar** (it absorbs what the missing Main tab held): AC shield + HP
  (`33 / 33`, **TMP** and **+MAX** controls, no death saves), **Speed** (`Walk 25`),
  **Skills**, **Senses** (Blindsight 60 / "Blind beyond this radius" / Passive Perception 6),
  and **Immunities** (condition-immunity pills: Poison, Psychic, Blinded, Charmed, Deafened,
  Frightened, Paralyzed, Petrified, Poisoned, Exhaustion). No Favorites/death saves.
- **Header** shows the **type line** ("Medium · Construct · Unaligned"), a **source + XP**
  ref ("MM pg. 19 · 200 XP"), **Proficiency +2**, the rest buttons, and a **CR badge** (the
  ring, showing CR where the PC shows level).
- **Features page body** = **Features** table (Antimagic Susceptibility, False Appearance)
  **+ an Actions** table (Multiattack; Slam — Natural · Action, ROLL +4, FORMULA 1d6+2),
  columns USES / ROLL / FORMULA, expand + ⋮, **+ add**. (Attacks/actions are the same rows
  the PC's Inventory/attacks produce — shared model.)
- All other tabs (Inventory, Spells, Effects, Biography, Special Traits) match the PC.

**Resolved (user 2026-07-02):** 🍴/⛰ = Short/Long Rest ✓; 📖 = Spells, kept visible-but-empty
for non-casters ✓; **manual fields first, automation is a later dedicated plan** ✓; NPCs =
same sheet without the Main tab (Features is their first tab) ✓; **death saves = a
skull-toggled slide-down tracker (3 successes / 3 failures), PC-only** ✓. No open questions
remain — this spec is ready to build in Phase 7.

**Sheets fleshed out (PC + NPC).** Grow `CharacterSheet`: attacks/actions (name, to-hit
part, damage expression, linked item), class resources (name/current/max chips), death
saves, spell slots (level→current/max grid), speed/senses/proficiency. NPC sheets get a
stat-block-style compact layout. All new fields ride the existing `SheetRecord.data` +
section reveal machinery (new sections join `SHEET_SECTIONS`/`SHEET_SECTION_FIELDS` so
redaction is automatic). **Budget:** per-sheet server-side size cap (~20KB serialized;
row-count caps on attacks/resources/spells like the inventory's 200) so 100+ NPC sheets
can't bloat the full-state broadcast — all JSON, zero R2.

**Item sheets.** `ItemRecord` grows `type ("weapon"|"armor"|"gear"|"consumable")`,
`damage?` (expression + type), `properties`, `weight?`, `equippable`. Item click → item
sheet window; inventory rows link back to the catalog (`itemId` already exists); drag
item → sheet stays. Equipping a weapon surfaces it in the sheet's attacks.

**Roll breakdown color-coding (user).** Rolls already use sheet stats (Phase 2 — sheet
clicks roll `1d20+mod` attributed to the character). What's missing is structure +
presentation: `DiceRoll` gains `parts?: Array<{ kind: "die"|"ability"|"prof"|"item"|
"flat"; value: number; label?: string }>` built server-side at roll time; `LogPanel`
renders each part as a color-coded chip (die color, stat color, item color…) summing to
the total. Attack/damage rolls from the new sheet actions produce fully-labeled parts.

**Quick HP workflow.** Damage/heal without opening a sheet: ±HP stepper on the token
editor + initiative-tracker rows (and a right-click token shortcut). Message reuses
`UPDATE_SHEET` or a slim `ADJUST_HP {sheetId, delta}` (server clamps 0..max, logs during
combat).

**Token facing / direction (user 2026-07-02).** Tokens gain a **rotatable direction**
shown as a **wide arrow/wedge attached to the edge of the token circle**, pointing the way
the token faces. `Token.facing?: number` (degrees, 0 = up/north; absent = no arrow). Both
**player (own token) and DM** can rotate: a rotate handle when the token is selected
(drag around the token), plus a keyboard/scroll nudge (e.g. Alt+scroll or `[` / `]`), and a
numeric field in `TokenEditor`. Rendered in `MapCanvas` as a Konva wedge/arrow on the
circle rim (rotates with `facing`); snap to 45° with a modifier. Sync = the existing
`MOVE_TOKEN`/`UPDATE_TOKEN` path (add `facing`; throttle rotate-drag like token drag; no new
hot-path message). Normalize + a redaction check (hidden tokens already stripped).
**Shares the `facing` field with Phase 6's directional-vision cone** (the vision wedge and
the visible arrow are the same heading) — build the field + rotate UI here even though
directional LOS is a Phase 6 stretch, so they stay consistent.

**Fog brush (user).** → **Pulled forward into Phase 6.5** (see that section): brush
shapes with `mode: "reveal" | "cover"`, painter's-order rendering, plus the added
`fog.inverted` base toggle. Nothing left here.

**Measurement templates.** Cone/sphere/line spell templates as a map tool (the Phase 5
tool framework): drag to size, snapped origin, transient relay like MEASURE, optional
"pin until cleared".

**Coin flip (user).** A 2-sided "die" riding the whole dice pipeline: `DieKind` gains
`"coin"` (squat cylinder geometry — thick enough that rim landings are negligible; two
face decals, heads/tails motifs canvas-drawn like the number decals). Tray slot at the
**far left** (before d4), readies/glows/multi-grabs like dice. Interaction reuses the
existing gestures: **click the tray coin = flip in place** (tuned launch: high pop,
strong end-over-end tumble, little travel), **drag + release = throw onto the board**.
Server flips via `secureRandInt(2)` (1=Heads, 2=Tails) — fairness, recorded-track sync,
and **secret DM flips** (players see a blank coin tumble + masked log entry) all inherit
from Phase 4 for free. Log renders "🪙 Coin flip — Heads" (text fallback identical, with
the non-3D coin sound); sounds = flick "ping" on launch + metallic clink impacts (a
material variant on the engine's impact callback). Self-contained — can be pulled
forward of the rest of Phase 7 anytime.

**Scenes-page map editor depth.** → **Core pulled forward into Phase 6.5** (selected-scene
editor canvas, inspector column, Live-updates staging, Set Live). **Still Phase 7:**
**pre-staging tokens** (drag actors from a directory into the editor), map notes/pins.
Not in scope ever: tile/brush map *creation* (Dungeondraft-scale product) — maps stay
imported images.

**Tokens/Assets page.** The deferred 5.5 page (DM-only): thumbnail grid of the room's
uploaded images grouped by kind (tokens/portraits/maps via R2 prefix list), upload,
delete with "in use by …" warnings (scan tokens/sheets/scenes for the URL), assign
(actor portrait, token image), drag-to-board. Stretch: **token presets** (saved
image+name+size combos to drop on the board). (Full asset *library* picker polish stays
in Phase 9.)

**Campaign export/backup (added — data-safety).** All campaign state lives in one
PartyKit Durable Object; one bad migration or deletion loses the campaign. DM button:
download full room JSON (`EXPORT_CAMPAIGN` → state dump) + restore/import path (extends
`IMPORT_CAMPAIGN`). Belongs before real sessions. **Budget:** one-shot DM-only transfer
of persisted state (~200–400KB, under the WS frame limit); exports reference R2 image
URLs, never embed the images.

**Verify:** attack click → color-coded parts sum correctly for every viewer; item equip →
attack appears; HP stepper clamps + logs in combat; fog brush paints/erases and survives
restart under the cap; templates relay + expire; export→wipe→import round-trips a
campaign byte-identically (minus connection fields).

---

## Phase 8 — Aesthetic revamp: the ENTIRE UI, tactile + real — planned

Full visual + audio identity pass over **everything** (user, 2026-07-02 — detailed ideas
to be fleshed out with the user before this phase starts; this section is deliberately a
scoped placeholder).

- **Direction:** tactile, real, paper-like. Textures for natural materials — paper,
  parchment, polished wood — as panel/chrome surfaces; the current dark placeholder skin
  is fully replaced. Typography, component chrome, elevation/shadow language, and the
  board furniture (grid, ruler, selection, toolbar) all restyle together.
- **Motion language:** consistent micro-animations (window open/dock, toast entry, page
  switch, reveal transitions) — subtle, physical, `prefers-reduced-motion` respected.
- **Sound design:** a cohesive UI SFX set (clicks, page turns, window open/close, toast
  chime, turn-change cue) building on `rollSound.ts`/`diceAudio.ts`; small bundled files;
  one master volume/mute (the settings panel from 5.5).
- **Asset strategy:** textures/SFX ship compressed in the app bundle (KBs–low-MBs on
  Pages), NOT R2; tileable textures kept small.
- **Dice + coin textures (user):** image skins plug in at the `createDiceMaterial()` swap
  point (designed for this in Phase 4). Prerequisite work item: the hull geometries ship
  **without UVs** — generate per-face planar UVs at build time in `geometry.ts` (face
  normals/centroids/corners are already computed for number placement); build the coin's
  cylinder with UVs from day one. Numbers/heads-tails are separate decals, so they stay
  legible over any body skin and secret blank dice keep working; materials are per-die,
  so per-type or user-selectable skin sets are structurally trivial. One small tileable
  texture can serve all dice — bundle-shipped, zero R2.
- **Sequencing:** runs AFTER Phase 7 stabilizes feature UI (restyling components that are
  about to change is wasted work). Phase 0's token layer (`tokens.css`) is the substrate —
  the revamp is largely a new token sheet + component-chrome pass, which is why it was
  built first.
- **Perf guardrail (low-end machines):** the reskin must not regress rendering cost —
  textures small + tileable (CSS `background-image`, cheap), **no proliferation of
  `backdrop-filter`/large `filter`/heavy shadows** (the classic weak-GPU killers; we
  already use blur sparingly), animations compositor-friendly (`transform`/`opacity`
  only), and an integrated-GPU test pass is part of this phase's verify.

**Verify:** visual pass over every panel/page/window in both roles; reduced-motion and
mute honored; bundle-size delta reviewed; no contrast regressions (keyboard/screen-reader
spot check).

---

## Phase 9 — Soundboard, custom themes, asset library — planned (was Phase 7)

Optional extras, deliberately last (user, 2026-07-02). Custom themes correctly come
AFTER Phase 8 finalizes the design-token vocabulary.

**Soundboard (R2-conscious, answers the todo's storage/network question):**
- Upload: `functions/api/upload-audio.ts` cloned from the `imageUpload.ts` pattern; keys
  `audio/{roomId}/{clipId}.{ext}`; served like maps (R2 + immutable cache). OGG/Opus encouraged,
  hard cap 1.5MB/clip (~60s). Budget: 100 clips ≈ 0.1GB of the 10GB; egress free; ops negligible.
- **Sync = events, not streaming:** `GameState.sound.ambient {clipId, volume, loop,
  startedAtServerMs} | null` (late joiners resync by offset) + transient S→C `SOUND_ONESHOT` for
  SFX. `GameState.soundClips` registry holds URLs only. Client `src/lib/soundPlayer.ts`
  (HTMLAudio; per-client master volume/mute in localStorage). `SoundboardPanel.tsx` is a **dock
  registry tab** (one entry, per the shipped dock): DM clip grid + upload; players get volume/mute.

**Custom CSS themes (nearly free after Phase 0):** `ThemePanel.tsx` — textarea/upload accepting
only `--token: value;` declarations (cheap sanitize), injected as a `:root` style; per-client in
localStorage + optional DM-set room theme (`GameState.theme`, 10KB cap). Ship 2–3 presets
(current dark; a gold/parchment skin from `design_example/arcane_archive/DESIGN.md`). Note the
shipped `--dock-rail-w`/`--dock-panel-w` are **layout** vars, not theme — the sanitizer should
allow re-theming color/type/spacing tokens without letting a theme break the dock geometry.

**Asset library:** "previously uploaded" picker backed by `functions/api/list-assets.ts`
(`env.UPLOADS.list({prefix})`, Phase 0 room-namespaced keys) — surfaced everywhere an image is
chosen: `ScenePanel` (maps), `TokenEditor`/sheet portraits, and now **item icons**
(`ItemRecord.iconUrl`) and **actor portraits** in the Actors/Items directories.

**Verify:** ambient reaches all clients ~1s, late joiner at correct offset; one-shots don't
persist; mute is local; theme input can't inject non-variable CSS; oversized clip rejected clearly.

---

## Backlog (explicitly deferred)

- Per-player scene access (lost pre-revamp feature, `e23a632`: `SceneAccessPanel` +
  `PlayerSceneToolbar`) — DM grants players access to specific scenes; players switch
  among granted scenes instead of being locked to the active one. Useful for split
  parties. **Note (Phase 6.5): players now receive ONLY the active scene at the
  redaction level — this feature must widen that filter to "active + granted scenes".**
- Screen-layer dice option (user, 2026-07-02): a per-client mode where thrown dice ignore
  the world anchor and tumble on their own fixed overlay above the board (v1-style) —
  always in view regardless of pan/zoom. World-anchored stays the default.
- DM undo — **shipped (2026-07-03, client-side)** for board scene edits + tokens via
  `src/lib/history.ts` command/inverse. Remaining: fine-grained undo inside the scene
  editor's *staged* drafts (today only its whole-draft Discard), and any server-authoritative
  multi-client undo (out of scope — single DM).
- Multi-select / group token move
- Live token-drag ghosts (transient relay pattern exists when wanted)
- Mobile/tablet layout (FloatingWindow makes it feasible later)
- R2 orphan GC endpoint (delete assets unreferenced by any scene/token/sheet)
- Scene-scoped state broadcast (escape hatch if state size ever hurts; per-scene data layout makes
  it mechanical)

## R2 / network budget summary

- **R2:** heavy campaign ≈ 50 maps (1–2MB each, full quality — they're URLs now) + 200
  token/portrait images + 100 audio clips ≈ **0.3GB of 10GB**. Stable keys mean replacements
  overwrite (self-cleaning).
- **WebSocket:** full-state broadcast survives the whole roadmap **iff** Phase 0 ships the
  `VIEWPORT` delta and every phase enforces its caps (log 100, annotations 200/scene, fog reveals
  300/scene, walls 600/scene, lights 50/scene, sheets ~20KB each with row caps (P7), sound
  registry URLs-only). Worst-case state ≈ 200–400KB, under the ~1MB frame limit with headroom.
- **Phase 8 assets (textures/UI SFX) and the coin/dice skins are app-bundle static files on
  Pages — zero R2, zero GameState.** Low-end machines are protected by cross-phase rule 5
  (lazy-load + fallbacks: shipped for 3D dice; specced for vision incl. a 0.25× low-spec
  mode) and the Phase 8 perf guardrail (no backdrop-filter/heavy-shadow proliferation,
  compositor-only animations, integrated-GPU verify).

## Extensibility — how the plan absorbs future features and changes

The phases are features, but the architecture underneath is deliberately open-ended:

- **New panel/module** → one entry in the panel registry + one component (Phase 0). The shell
  never changes: dockable panels become **sidebar tabs** and any tab **pops out** into a floating
  window (dock + `FloatingWindow`, shipped); `sheet` is floating-only. Log, dice, initiative,
  actors, items, party, notes all arrive this way — as will soundboard/themes and anything not yet
  imagined.
- **Pointer drag-and-drop** → `src/lib/pointerDrag.ts` (ghost + threshold + `elementFromPoint`
  hit-test + click suppression) is the reusable primitive after native HTML5 DnD proved unreliable
  here. Already powers directory reorder, folder assignment, and drag-to-board; reuse it for
  multi-select, token drag-ghosts, and dice grab-to-throw.
- **Masked secrets** → a redaction pattern distinct from full hiding: show *that* something
  happened without the payload (shipped for secret rolls — `🔒 DM rolled in secret`). Reuse when a
  future secret should be visible-but-opaque rather than absent.
- **Directories (folders + ordering)** → `GameState.folders` + `sortOrder` + the shared
  `Directory` component give any keyed entity (sheets, items, and later scenes/audio) folders,
  search, quick-create, and drag reordering for free.
- **New map tool** → one module implementing the shared tool interface + one registry entry
  (Phase 5). Walls (Phase 6) is itself proof the interface works.
- **New synced data** → the recipe is fixed: add field to `GameState`, extend `normalize*`
  (old saves keep loading — the migration pattern already exists and is battle-tested), add a
  message type + server handler, add a redaction rule if secret, add a size cap. Every phase
  follows this same recipe, so a future feature is "phase N+1", not a rework.
- **High-frequency/transient data** → the dedicated-message pattern (VIEWPORT, MEASURE,
  DICE_THROW/DICE_MOTION, SOUND_ONESHOT) is reusable for anything realtime later (e.g. live
  drag ghosts).
- **Restyling / re-theming** → components consume tokens only; a new look = a new token sheet
  (the Phase 8 revamp and Phase 9 theme feature both ride this). The placeholder skin can
  be replaced at any time without touching components.
- **Separate pages** → this reserve was cashed in: Phase 5.5 adds the top-left page
  switcher (DM-only: Board/Players/NPCs/Scenes, Tokens/Assets in 7; players are
  board-only — maximizable windows cover their needs) as a lightweight `App.tsx` state
  route — views were componentized all along, so pages are additive composition, not
  rework. Future full-page views (compendium, world map) join the same switch.
- **State growth** → per-feature caps keep full-state broadcast viable through Phase 9; if a
  future feature blows past that, the escape hatches are already designed (scene-scoped broadcast,
  delta sync) and the per-scene data layout makes them mechanical.
- **Sheets beyond 5e** → `SheetRecord.data` isolates the 5e shape; a future template/system change
  swaps the inner `CharacterSheet` + section ids without touching tokens, combat, or redaction.

## Cross-phase engineering rules

1. New GameState fields → `normalize*` migration + server-side size cap + redaction review.
2. Secrets are stripped server-side (`redactStateFor`), never merely hidden in the UI; verify at
   the WS-frame level.
3. High-frequency or transient data (viewport, measurements, dice motion, one-shot sounds) rides
   dedicated messages, never GameState.
4. Images/audio → R2 via `uploadAsset.ts` patterns; only URLs in state.
5. Heavy subsystems (3D dice, vision) lazy-load and render on demand; text/no-effect fallbacks
   keep low-end machines playable.
6. Per phase: `npm run build`, re-run the `tests/` smoke suites (see `tests/README.md`),
   and a two-window (DM + player) manual sync test before moving on.
7. Every draggable floating UI element (windows, tray, future) clamps **fully** on-screen
   — measured size + margin, on load/drag/resize — via the shared `clampToViewport`
   helper (Phase 5.5), and provides a reset affordance. A movable element the user can
   strand off-screen is a bug.

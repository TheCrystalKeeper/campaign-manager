# Campaign Manager — Feature Implementation Plan

Roadmap for building out the VTT from the `bare-bones` foundation. Covers everything in
`revamp_todo.md` plus recommended additions. Companion docs: `CODEBASE.md` (pre-revamp
architecture reference — **historical**, describes the codebase before Phases 0–4 shipped),
`DICE_PLAN.md` (v1 3D dice concepts — the shipped Phase 4 recovered its core),
`AUTOMATION_PLAN.md` (sheet automation — the "automation LATER" plan Phase 7 deferred;
**Tiers 1–3 designed AND SHIPPED 2026-07-07**: rules engine `src/lib/rules5e.ts`,
overrides, trait/condition-aware rolls, real rests/casting/death saves — see its
"as built" note).

## STATUS (2026-07-07) — read this first in a fresh session

**Latest (2026-07-07): map-interaction QoL round** — hover/drag affordances plus a
direct-manipulation grid calibrator: pins are grabbable/editable in **select** mode (not just the
pin tool); hovering a wall in the **walls** tool shows a move/grab cursor (not the crosshair); doors
**highlight + show a pointer** cursor on hover in select mode; and the 🎯 grid-calibrate tool's
default **"Adjust" mode** makes **every grid intersection a resize handle** — hover a grid point and
a circle pops up; drag it to resize (the diagonally opposite corner pins), or drag anywhere else to
move the grid (move + resize with no button switching). **Box a cell** is kept for from-scratch
calibration. Live full-grid preview throughout. Details in the **Map-interaction QoL round** note at
the end of Phase 7 (after the Map-pin revamp note). The prior **board render-quality round** is
documented under Phase 7's as-built section (zoom-bucketed image caches, device-pixel-snapped text,
a per-client "Hi-res board rendering" setting).

**Phases 0–7 are SHIPPED and machine-verified** (plus several UX-feedback rounds and a
3D-dice feedback round). **Phase 7 (game-content depth) just shipped** as sub-rounds
7a–7k: the tabbed character-sheet redesign (+ a FoundryVTT-style floating page rail),
the fleshed-out sheet data model, item weapon fields, structured `ROLL_CHECK` with
color-coded log chips, quick-HP steppers, token facing, measurement templates, coin flip,
map pins + scene pre-staging, a DM Assets page, and full campaign export/import — see its
"as built" note. **Phase 6.9 (walls revamp — types+channels, movement blocking, full editing) shipped
and machine-verified (manual two-window UX pass still owed); Phase 8 (full aesthetic
revamp + sound design) follows.** Phases 6.6–6.8
had already pulled a lot forward (lighting revamp; token shapes/sizing/image tokens; item
tokens + Item Sheet + Items page; independent NPC folder trees; directory multi-select +
folder reorder). The roadmap was restructured
2026-07-02 (user): 5.5 = shell/layout fixes ✅, 6 = vision ✅ (v1), 6.5 = scene-editor
round ✅ (pulled the fog brush + scenes-editor depth forward from 7; also Players tab bar

- active-scene-only player redaction), 7 = game-content depth, 8 = full aesthetic revamp
(+ sound design), 9 = optional extras (soundboard/themes/asset library — the old
Phase 7). Each shipped phase below carries an "as built" note where reality diverged from
the original spec — trust those notes over the older prose. Phase 6 shipped a focused v1;
its "as built" note lists the deferred stretches (server-side LOS redaction, dim/bright
shading, light shadows, directional cones, low-spec mode). **Phase 6.6 (SHIPPED)** then took
the lighting revamp: gradual falloff, colored/animated/directional lights, a per-light config
panel, and a continuous 0–1 darkness level with day↔night transitions.

- **Verification:** `tests/` holds the WS smoke suites + unit tests with a README on how
to run them (partykit dev server + `node tests/smoke-*.mjs`). All pass (phase0–6 + scenes +
ux2 + the unit suites; `unit-scene-editor.test.ts` grew through 6.6–6.8 to cover lighting,
token/item fields, token sizing, npc-folder trees, and folder sortOrder; `unit-render-crisp.test.ts`
added 2026-07-07 for the zoom-bucket/font-snap math — all green as of 2026-07-07). Re-run the
full set after any server/redaction/protocol change. `.claude/skills/verify/SKILL.md` (added
2026-07-07) has the recipe for driving the app end-to-end in headless Chrome when a change
needs runtime (not just tsc/build) confirmation.
- **Shipped file map (orientation):** shared logic `src/lib/{types,redact,dice,dice3d, pointerDrag,sceneUtils,clampToViewport,visibility,sceneMessages,localFlags,history,renderQuality}.ts`;
server `partykit/server.ts`; shell `src/App.tsx` + `src/panels/registry.tsx` (dock tabs +
pop-out windows) + `src/components/{Dock,FloatingWindow,FloatingCluster,Directory, ActorsPanel,ItemsPanel,PartyPanel,ScenePanel,SceneSettings,CharacterSheet,TokenEditor, InitiativeTracker,LogPanel,LogToasts,NotesPanel,DiceTray,SettingsPanel,MapCanvas, MapToolbar,MapFog,MapVision,JoinScreen}.tsx`; DM prep pages
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


| Todo item                                                                                                                 | Phase                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Layout for menus (FoundryVTT inspiration)                                                                                 | 0 ✅ — docked sidebar + pop-out windows                                                                                            |
| Tactile UI/UX theme                                                                                                       | 0 ✅ (design tokens), evolving skin thereafter                                                                                     |
| 3D dice + dice tray, textures/perf question                                                                               | 4 ✅                                                                                                                               |
| Improve character sheet                                                                                                   | 1 ✅                                                                                                                               |
| Dice rolls use sheet stats/modifiers (DM: many NPCs)                                                                      | 2 ✅                                                                                                                               |
| Roll and action log                                                                                                       | 2 ✅                                                                                                                               |
| Roll-for-initiative button                                                                                                | 3 ✅ (full initiative tracker)                                                                                                     |
| Token add/remove improvements; click token → sheet; per-section DM reveal                                                 | 1 ✅                                                                                                                               |
| DM grid size change                                                                                                       | 5 ✅ — calibration gesture + numeric inputs                                                                                        |
| Measure distance                                                                                                          | 5 ✅ — synced ruler, Chebyshev feet                                                                                                |
| Annotations                                                                                                               | 5 ✅ — freehand draw; DM persists, players fade                                                                                    |
| Walls, lights, vision (+directional)                                                                                      | 6 ✅ (v1: walls/doors/lights + LOS mask) · 6.6 ✅ (gradual falloff, color, animation, directional wedges, darkness 0–1 + day/night) · 6.9 ✅ (walls revamp: types+channels, movement blocking, full editing) |
| Soundboard (idea)                                                                                                         | 9                                                                                                                                 |
| Custom CSS themes (idea)                                                                                                  | 9 (enabled by 0; themed after 8)                                                                                                  |
| Actors/Items directories, folders, inventory *(added via UX feedback)*                                                    | 1–2 (shipped: `Directory`, folders, `sortOrder`, sheet inventory)                                                                 |
| Docked sidebar + pop-out, masked secrets, transient toasts *(UX feedback)*                                                | shipped (post-3)                                                                                                                  |
| Shell/layout fixes: toasts vs tray, settings panel, rail reorg, page switcher *(user 2026-07-02)*                         | 5.5 ✅                                                                                                                             |
| Sheets/items depth, roll breakdown colors, fog brush, HP quick-adjust, templates, coin flip *(user 2026-07-02)*           | 7                                                                                                                                 |
| Tabbed character-sheet redesign (reference layout) + token facing/rotation *(user 2026-07-02)*                            | 7 (structure; final skin in 8)                                                                                                    |
| Fog brush + invert, Scenes page = full editor (live toggle + Set Live), Players tab bar, prep secrecy *(user 2026-07-03)* | 6.5 ✅                                                                                                                             |
| Full aesthetic revamp — tactile/paper/wood + sound design *(user 2026-07-02)*                                             | 8                                                                                                                                 |


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
> `NpcPanel.tsx` was superseded by `ActorsPanel.tsx` (PCs + NPCs, folders, search,
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
>
> - **Files:** pure protocol lib `src/lib/dice3d.ts` (specs/track types, d100 decompose +
> interpret, `sanitizeThrow` validation — server-safe; the *message* variants live in
> `types.ts`), recovered `src/dice/geometry.ts` + `src/dice/audio.ts` (near-wholesale from
> `e23a632`), adapted `src/dice/engine.ts` (camera from the local viewport, DPR cap 1.5,
> no pane clipping), tray scene `src/dice/trayScene.ts`, controller
> `src/dice/useDiceOverlay.ts` (lazy engine boot, preloads when 3D enabled), tray UI
> `src/components/DiceTray.tsx`.
> - **Sizing (revised twice same day, user feedback):** dice are **map-glued and
> screen-sized** — a roll's world footprint is FROZEN at throw time (`k0` = world units
> per physics unit at the roller's zoom, sent as `worldScale` on
> `DICE_THROW_REQUEST`/`DICE_THROW` so every client places dice at the same world
> spots). Pan/zoom moves dice 1:1 with the board like tokens; each die's *mesh* rescales
> live around its own landing spot so it always renders `DIE_SCREEN_PX` (77px) wide.
> (The first revision rescaled the whole group per zoom — that made dice slide across
> the map when zooming; superseded.) Zoomed far out, constant-size dice may overlap —
> accepted.
> - **Physical tray (revised same day, user feedback):** the tray is a real dice tray — a
> felt well (own small Three scene in `trayScene.ts`, shared geometry cache) holding one
> resting die per size (the d100 slot holds its real percentile pair — blue tens d10 +
> red unit d10 — which highlights/lifts/throws as one unit). Clicking a d# button
> **readies** dice: matching tray dice glow with a pulsing gold outline; repeat clicks
> add duplicates (right-click removes one; an always-visible "↩" button at the far left
> of the controls clears all — greyed out when nothing is readied — as does Esc; cap 12
> physical dice). Dragging any glowing die picks
> up the whole readied set — dice within reach keep their offsets, far ones **gather onto
> a ring next to the cursor** — then shake and release to throw. Dragging an unlit die
> throws just that one; a plain click lobs gently up-screen. Throws **re-anchor at the
> release point** (not view center), so dice land where you threw them; the expression
> input still auto-throws from view center. Grabs hand off tray→arena at the exact tray
> pose (seamless lift; dice grow 62→77px in hand).
> - **Throw physics tuning (same day, user feedback):** killed the "lands then bounces
> straight back" artifact — (1) release spin is **forward tumble** (topspin about
> up×v̂ + jitter); fully random spin gave half of throws backspin, which friction turns
> into a backward kick on landing; (2) wall restitution 0.4→0.18 (dead walls). Verified
> with a rapier probe: visible rebounds 12/60→2/60, avg give-back 1.3u→0.4u.
> - **Window-aware walls (same day, user feedback):** the physics box is now **derived
> per throw from the roller's own screen** — window edges minus a 24px margin, minus the
> dock column and the open tray drawer (App registers a `setSafeAreaProvider` that
> measures `.dock`/`.dice-tray--open` rects fresh at each throw). Dice can no longer
> roll off-screen or settle hidden behind UI. Key property: walls exist only in the
> roller's pre-sim, so the box is baked into the recorded track — **zero protocol/server
> changes**, remote replay untouched. Constant screen-size dice make px→physics a fixed
> ratio (`DIE_SCREEN_PX / DIE_WIDTH_UNITS` ≈ 40.5px/u). A per-wall minimum distance from
> the anchor (`MIN_WALL_DIST`) floors degenerate boxes on tiny windows/edge releases.
> This obsoleted the earlier forward-bias hack (runway is now the real screen space in
> the throw direction), which was removed.
> `dragEnd` — previously the dice camera froze during a pan and the dice "teleported
> back" on release. Server already coalesces `UPDATE_VIEWPORT` (~15Hz), so per-move
> emission is safe.
> - **Shell:** tray toggled by a "🎲 Dice" button in the top-left cluster (not a dock tab —
> the old dice tab/`DicePanel` were removed); the 3D canvas is `.dice-arena` (fixed,
> z-index 5, pointer-events none — grabs start from the tray well and ride window
> listeners). The tray is **draggable from anywhere on its body** (except the felt well,
> which grabs dice) via a 5px move-threshold so button clicks still register; the trailing
> click is swallowed after a drag. Position persists to `cm-dice-tray-pos`; `clampPos`
> keeps the **whole** tray on-screen (measured size + margin) on load/resize/drag so it
> can't be stranded; **double-click a blank part of the tray resets** it to bottom-center.
> Toggling slides + fades it in/out at its current spot (`transform: translateY` +
> `opacity`, component stays mounted so the tray scene persists).
> - **Text-roll SFX (user feedback):** non-3D rolls (Roll button / d# buttons when 3D is
> off) play a dice sound via `src/lib/rollSound.ts` — an optional `public/sounds/ dice-roll.mp3` if present, else a synthesized rattle placeholder; respects the shared
> `dice-muted` key. 3D throws still sound through the engine.
> The tray scene's canvas is absolutely positioned inside the well — a shrink-to-fit
> container sized by its own DPR-scaled canvas is a runaway-width feedback loop. "3D"
> on/off toggle (localStorage + `prefers-reduced-motion` default) falls back to text
> `ROLL_DICE` (felt well hidden, d# buttons roll as text); 🔒 secret toggle (DM) and 🔊
> mute live here.
> - **Server:** `DICE_THROW_REQUEST` handler validates via `sanitizeThrow`, rolls per-spec
> with `secureRandInt`, broadcasts `DICE_THROW` per-connection (faceValues stripped +
> `actorName:"DM"` for non-DM on secret), and **defers the log append** by track duration
> (+400ms, ≤8s cap) so the log never spoils the tumble.
> - **Not yet built (follow-ups):** live shake relay (`DICE_MOTION` stretch), the
> "animate sheet rolls in 3D" preference (sheet clicks are still text rolls), and the
> quick "instant" resolve option. Physics *feel* still owes a manual two-window check
> (plus the new tray: ready/gather/throw and constant-size-across-zoom).

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
>
> - **Tool framework:** `src/map/tools/{types,registry,select,measure,draw,calibrate,fog}` —
> tools implement `{ id, label, icon, hotkey, dmOnly?, cursor, onDown/Move/Up, renderDraft }`; `MapCanvas` routes stage pointer events to the active tool in world
> coords and holds the tool's transient `draft`; committed work = ordinary room
> messages. `MapToolbar.tsx` renders from the registry (left edge) + contextual
> options (draw colors/widths/clear, fog on/reset, calibrate hint) + the per-client
> 🧲 snap toggle. Hotkeys V/M/D/G/F + Esc live in MapCanvas (no separate
> `shortcuts.ts` yet — add one when Phase 6 needs Space/`?`).
> - **Calibration** is its own DM tool (🎯 G): drag a box over one square → gridSize +
> offsets; the drag is **square-constrained** (follows the dominant axis — a cell is a
> square). ScenePanel has numeric inputs (size, offsets, feet/square, grid
> color/opacity) as fine-tuning.
> - **Middle-mouse pan** (user feedback): a manual pan handler on the stage (window
> listeners, not Konva draggable) — works for DM and players and **while any tool is
> active**; tokens can't be middle-dragged (Konva drags stay left-button). Tools only
> receive left-button pointerdowns. The toolbar's contextual options panel is
> absolutely positioned beside the rail so opening it never shifts the rail.
> - **Ruler:** press-drag single segment (no waypoints yet — deferred); relayed as
> transient `MEASURE` C→S/S→C, 40ms per-sender server coalescing, no self-echo, 2s
> linger + client-side stale pruning; name + slot color tag; Chebyshev
> squares × `feetPerSquare`.
> - **Annotations:** freehand strokes (rect/circle/text render but no tools yet);
> `ADD/REMOVE/CLEAR_ANNOTATIONS` (no UPDATE — nothing edits yet). Server forces
> `ephemeral: true` for players (~10s TTL timer), re-stamps `authorId`, caps 120
> points/stroke and 200 persistent/scene by **dropping the oldest** (not rejecting).
> Erase = right-click a drawing while Draw is active (author-or-DM, enforced
> server-side); DM 🗑 clears the scene.
> - **Pointer arrow (recovered from v1 e23a632, user feedback):** hold **Shift + left-drag**
> in select mode to fling a dotted cream-on-dark **arrow** (`kind:"arrow"`) that fades out
> over ~10s — the old "look here" ping, restored exactly (two dashed Konva `Arrow`s,
> `tension 0.5`, arrowhead; sparse 48px network sampling + dense local preview; min
> length 24; `annotationOpacity` fade ramp driven by a 50ms `fadeClock`; helpers live in
> the recreated `src/lib/mapAnnotation.ts`). Always allowed for everyone and always
> ephemeral (server forces it), independent of the Draw permission below. Shift disables
> the stage pan-drag and tokens `stopDrag` on shift so the arrow draws cleanly over them.
> Preview→committed handoff: commit includes the exact release point (equal length) and
> the local preview stays up while its own server echo is hidden (`pendingArrowId`) until
> they swap in one paint — so a shorter duplicate never overlaps the original. Per-author
> live-arrow cap `MAX_POINTER_ARROWS_PER_AUTHOR = 5` (server-enforced): drawing past 5
> **removes** that author's oldest arrow. Fade-out is **client-local** (a "ghost"):
> MapCanvas snapshots any arrow that leaves `scene.annotations` and fades that copy over
> `ANNOTATION_FADE_MS` (0.6s) using local time — smooth and immediate for both the cap
> drop and end-of-life removal, with no server-timestamp fragility (an earlier attempt
> that aged `createdAt` into a shared ramp caused a jump-then-pause and was replaced).
> Committed arrows render at opacity 1 while present; ephemeral strokes still use the
> `annotationOpacity` tail.
> - **Draw permission (user feedback):** `GameState.playersCanDraw` (**default false**).
> The Draw *tool* is hidden from players and their strokes are server-rejected until the
> DM flips it on via the toolbar's draw-options "Players: on/off" button
> (`SET_PLAYERS_CAN_DRAW`, DM-only). The pointer arrow is exempt (on by default). If the
> DM revokes while a player is in Draw mode, the client falls back to select.
> - **Fog-lite:** `Scene.fog {enabled, reveals}` rect+circle reveals (poly deferred),
> DM-only `FOG_SET/FOG_REVEAL/FOG_RESET`, cap 300 (oldest dropped); rendered as a
> dedicated Konva layer (black + `destination-out` reveals) **above tokens** — players
> opaque, DM 50%; Shift-drag = circle reveal.
> - **Hidden tokens:** `Token.hidden` toggle in TokenEditor; `redactStateFor` strips them
> from player frames (and their showHp exception); DM sees 40% ghosts; `COMBAT_START`
> stamps `entry.hidden` → players see "???" in the tracker.
> - **Snap-to-grid:** per-client toggle (localStorage), snaps token drag-end + placement
> clicks to cell centers honoring grid offsets.
> - Grid fields ride the existing `UPDATE_SCENE` (no new message); all new Scene fields
> flow through `normalizeScene` with sanitizers shared by the server handlers
> (`sanitizeAnnotation`/`sanitizeFogReveal` in `types.ts`).

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
>
> - `src/lib/clampToViewport.ts` exports `clampToViewport` + `clampSizeToViewport`
> (+`CLAMP_MARGIN`); DiceTray's local clamp delegates to it; `FloatingWindow` clamps
> the WHOLE window on mount/drag/resize-drag/window-resize (previously title-bar-only).
> - `FloatingWindow` geometry is `{x, y, w, h|null}` (`h: null` = auto height, CSS-capped)
> persisted under the existing `cm-window-pos:{id}` key — the old `{x,y}` shape still
> loads. Resize = 8 invisible grab zones (`.win-rs--*`, inside the border since the
> window clips overflow); maximize (⛶/❐) is transient (not persisted); double-click
> title bar = default pos+size. `PanelDef` gained optional `minWidth/minHeight`.
> - **Settings** is a floating-only registry panel (`SettingsPanel.tsx`): 3D dice, dice
> sound, snap-to-grid, roll/chat toasts, reset UI layout, Leave; DM extra = players-can-
> draw mirror. Snap state was LIFTED from MapCanvas to App (same `cm-map-snap` key) so
> settings + the toolbar 🧲 share it; toasts pref = `cm-log-toasts`; dice mute now
> persists/initializes from `dice-muted` even before the 3D audio engine loads.
> - **Reset UI layout** clears `cm-window-pos:`* + `cm-dice-tray-pos`, then bumps a
> `layoutEpoch` — open windows remount to defaults (their keys include the epoch); the
> tray watches a `resetSignal` prop and re-centers without remounting (tray scene lives).
> - **Rail order:** 🪪 sheet, separator, tabs, 🎲 dice, spacer, ⚙ settings, chevron —
> via a generic `DockAction { slot: "top" | "after-tabs" | "bottom" }` prop on `Dock`.
> The old top-left cluster is gone.
> - **Toasts** lift above the open tray by measuring both rects (300ms recheck while
> visible — the tray is draggable); the stack's *natural* (unlifted) rect decides, so no
> oscillation. z-index 15→35 (above pages, below windows).
> - **Pages** are opaque overlays INSIDE `.overlay` (z: dock 20 < tray 25 < page 30 <
> switcher 32 < toasts 35 < windows 40+). MapCanvas + dock + tray stay MOUNTED under
> pages (board keeps viewport/selection; tray scene persists); floating windows/token
> editor render only on the Board. All three pages stay mounted (hidden via
> `.page--active`) so each keeps its selection/drafts across switches. Combat start
> setPage("board") for the DM. Players: no switcher, `activePage` forced to "board".
> - **Pages content:** shared `PageShell` (roster column + `container-type` main).
> Players = slot admin roster (reuses `.party-slot` styling + selection) beside a
> full-size editable PC sheet; NPCs = the real `ActorsPanel` as roster (its `openSheet`
> prop selects into the page instead of opening a window) beside a full-size sheet with
> reveal eyes; Scenes = `ScenePanel` beside a large active-map preview (Phase 7 grows
> this into the selected-scene prep editor).
> - **Sheet multi-column** is a container query: `.window-body` and `.sheet-col` are
> `container-type: inline-size`; `.sheet-body` ≥620px → 2 CSS columns
> (`break-inside: avoid` cards). No JS.
>
> **QoL round (2026-07-02, user feedback — same-day follow-up):**
>
> - **Drag a die back into the tray to cancel the throw.** `DiceEngine.cancelActiveDrag()`
> removes the armed dice without releasing; `useDiceOverlay.rideDrag` tracks whether the
> pointer ever *left* the tray well and, on release back over it, cancels + restores the
> readied selection (so a plain click-in-place still lobs). Tray-well hit-test reads a
> plain ref mirror of the well element; `grabbedSelectionRef` snapshots the pre-grab
> selection to restore.
> - **Resizable page roster.** `PageShell` owns the left column width (drag divider
> `.page-resize`, persisted `cm-page-roster-w`, 220–640px, clamps on window shrink).
> - **Multiple sheets side-by-side.** Players/NPCs pages hold an `openIds` list rendered
> by the shared `pages/SheetCards.tsx` as fixed-width (400px) columns in a horizontal
> scroller; each column is its own size container so sheets stay single-column/compact
> (this also fixes "skills column too wide"). `.stat-row` switched from flex
> space-between to a fixed 3-column grid so save/skill inputs align across rows.
> - **Players roster rows** are now click-anywhere-to-open (not just the name box);
> double-click the name to rename (readOnly input until then, `key={slot.name}` remounts
> on external rename). Open rows highlight; card ✕ closes.
> - **Portrait upload** is the thumbnail itself — a `<label>`-wrapped file input
> (`.sheet-portrait-btn`); empty state shows a dashed "＋ / Add photo" affordance, filled
> shows "Change" on hover. The separate "Upload portrait" text link was removed.
>
> **QoL round 2 (2026-07-02, user feedback — same-day):**
>
> - **NPCs page shows NPCs only.** `ActorsPanel` gained `filterKind?: "pc" | "npc"`; the
> page passes `"npc"` (and hides the blank-token drag chip, which can't reach the
> board-covered page anyway). The dock Actors tab still lists PCs + NPCs.
> - **Directory redesign** (`Directory.tsx`, shared by Actors/Items/NPCs page):
> FoundryVTT-style — labeled `Create {NPC/Item}` + `Create Folder` buttons up top; a
> search row with an inline 🔍, an A–Z sort toggle (view-only, doesn't touch manual
> order), and a collapse/expand-all-folders button; folder headers with a folder glyph,
> bold name, member count, a per-folder ＋ create and delete; rows now show a 2rem
> rounded-square portrait, bold name, and an **inset** bottom separator (margin, not
> edge-to-edge). Portrait-less rows show a kind glyph (👤/🎒) on the color chip. The old
> top "new name" text input is gone (create auto-numbers, then opens the sheet/editor to
> rename). `onCreate` gained an optional `folderId` — actors move in via createSheet +
> setSheetFolder, items via createItem + updateItem (both rely on ordered messages;
> no server change).
> - **Tokens use the linked sheet's portrait live.** `MapCanvas` resolves a token's image
> from `sheets[token.sheetId ?? token.ownerPlayerId].data.iconUrl` first, falling back to
> the drop-time `token.imageUrl`, then the color — so uploading/changing a portrait
> updates placed tokens immediately (previously only the drop-time snapshot).
> - **Bugfix: players couldn't see NPC/item token art (2026-07-06).** The live-resolution
> above never survived `redactStateFor` — an NPC sheet with any section unrevealed was
> blanked to defaults (including `iconUrl`/`iconCrop`), and players got an empty item
> catalog entirely, so NPC and item tokens rendered as plain colored circles for players
> even though the DM saw full art. Fix: `redact.ts` now keeps a redacted NPC sheet's
> `iconUrl`/`iconCrop` (identity/stats stay hidden), and ships icon-only item stubs
> (`iconUrl`/`iconCrop` only — name/description stripped) for items referenced by tokens
> on the player's active scene, never the DM's full catalog. `MapCanvas` also resolves
> item-token art the same live way sheet-linked tokens already did. The server now
> re-syncs a token's `imageUrl` snapshot on `UPDATE_SHEET`/`UPDATE_ITEM` for NPC- and
> item-linked tokens too (previously only player-owned tokens re-synced), so the
> fallback snapshot can't go stale. Covered by new checks in `tests/unit-redaction.test.ts`.
> - **Visible resize grip.** `FloatingWindow`'s SE corner handle (`.win-rs--se`) now sits
> fully inside the window and draws a diagonal-line grip (`::after`), so windows visibly
> advertise resize; all other invisible edge/corner handles are unchanged.

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

**Page switcher (top-left, DM only).** Lightweight state-routing in `App.tsx` (`page: "board" | "players" | "npcs" | "scenes"` — no router lib; the Extensibility section
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
*(History note: the page switcher restores the pre-revamp*
`DmView = main|players|scenes|tokens` *structure; the old*
`TokenLibraryPanel`*/*`SceneSettingsModal` *at* `e23a632` *are quarry for the Scenes and
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
>
> - **Data model:** `Scene.walls: Wall[]`, `Scene.lights: Light[]`,
> `Scene.globalIllumination` (**default true** — existing scenes stay fully lit until the
> DM opts in), `Token.vision {enabled, rangeFt}`. Light radii are in **feet** (converted
> to world px via `gridSize / feetPerSquare`) to match darkvision units. All go through
> `normalizeScene`/`normalizeToken` with `sanitizeWall`/`sanitizeLight`/
> `sanitizeTokenVision`; degenerate (zero-length) walls dropped; caps **600 walls / 50
> lights** enforced server-side.
> - **Messages:** `SET_WALLS` (replace-set, batched per edit), `TOGGLE_DOOR`,
> `ADD/UPDATE/REMOVE_LIGHT` — all DM-only (behind the existing "only the DM can control
> the map" gate). `globalIllumination` + token `vision` ride the existing
> `UPDATE_SCENE`/`UPDATE_TOKEN`. No new hot-path message.
> - `src/lib/visibility.ts` (pure, unit-tested): classic angular sweep — rays at every
> endpoint ±ε, bounded by a box; `wallsToSegments` drops open doors; `pointInPolygon` for
> the LOS test. Key fix: the segment-parameter tolerance must be ≪ the angular-ε
> displacement or the "past the corner" rays graze the endpoint (that was the one subtle
> bug; covered by the corner-peek + gap unit checks).
> - **Rendering (**`src/components/MapVision.tsx`**):** `VisionMaskLayer` — a darkness sheet
> **above the tokens** (so it also hides tokens standing in the dark), erased
> (`destination-out`) inside each viewer token's LOS polygon (a Konva `clipFunc`) where
> its darkvision circle or any enabled light's reach lands. **Simplification:** lights
> are radius circles gated by the *viewer's* LOS — walls block the viewer's sight, but
> lights don't yet cast their own shadows (a lamp around a corner from the viewer is
> correctly hidden by viewer-LOS; a wall between lamp and lit area is not). Dim-vs-bright
> gradation is not split yet (single darkness level; `dimR` is the outer reach). Vision
> recomputes on state change (token drag-**end**), memoized on a token-position/walls
> signature so the arrow/ruler fade-clock re-renders don't re-sweep.
> - **DM UX:** walls render as lines / doors as (green when open) dashed lines, lights as
> gold markers with faint reach rings (`WallsLightsEditor` layer), interactive only with
> the matching tool. **Walls tool (🧱 W):** drag = wall, **Shift-drag = door**, endpoints
> snap to grid **intersections** when snap is on; click a door to open/close, right-click
> a segment to delete. **Lights tool (💡 L):** click to place (default 20/40 ft), drag to
> move, right-click to delete. Toolbar options for both expose **Lighting on/off**
> (toggles `globalIllumination`) and **👁 Preview** (DM sees the mask as a player would).
> `TokenEditor` gained a vision on/off + darkvision-range field; `ScenePanel` has the
> global-illumination toggle + wall/light counts. `ToolRuntime` gained `snap`.
> - **Deferred (documented leaks / stretches, per the spec):** walls/lights are broadcast
> to players (the client computes vision), so wall geometry is a **documented devtools
> leak** — server-side LOS redaction (dropping unseen tokens/walls in `redactStateFor`)
> is NOT done; token hiding in darkness is visual (the mask covers them). Also deferred:
> dim/bright two-level shading, lights casting their own shadows, live vision during a
> drag (updates on drag-end), "View as [specific player]", low-spec 0.25× canvas,
> explored-area memory, and directional cones (`Token.facing` lands with the Phase 7
> token-rotation work and will clip the LOS to a wedge then). Door toggle is DM-only for
> now (players opening doors is a later nicety).
>
> **Phase 6.6 update:** dim/bright two-level shading, directional cones (as per-light emission
> wedges, independent of token facing), and a low-spec animation toggle are now DONE — see the
> Phase 6.6 section below. Still deferred: server-side LOS redaction and lights casting their
> own shadows (a light's reach is still gated by the *viewer's* LOS, not the light's own walls).

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
>
> - New files: `src/lib/{sceneMessages,localFlags}.ts`, `src/components/SceneSettings.tsx`
> (extracted from ScenePanel — the dock tab keeps the scene list + live active-scene
> settings); ScenesPage/PlayersPage rewritten; `PageShell` now serves the NPCs page only.
> - `MapCanvas` sizing moved from `useWindowSize` to a ResizeObserver on `.map-root`
> (single code path; identical on the board where the root is fixed/inset-0), plus the
> `hotkeysEnabled` / `embedded` props. Fog compositing is painter's-order in ONE Konva
> layer (`FOG_COLOR` shared by base + cover shapes; DM 50% opacity applies at layer
> compositing, after the ops — never split the fog across layers).
> - The editor's staging (`editorSend`) folds scene-shape messages into a per-scene draft
> via `applySceneMessage`; ephemeral/arrow annotations and MEASURE always pass through
> live; drafts strip ephemeral annotations at baseline AND apply. Toggling Live back ON
> auto-applies every dirty draft (nothing silently lost).
> - Gotcha found by the smoke test: fresh rooms start with TWO default scenes
> (`createDefaultScenes`) — tests must count, not assume one.
> - The fog tool no longer has rect/circle gestures (brush + click-dab only); previously
> stored rect/circle shapes still render, now with optional cover mode.
>
> **Fog/tools polish round (2026-07-03, user feedback):**
>
> - **Fog opacity is now uniform for the DM regardless of overlap.** The bug: Konva applies
> a Layer's `opacity` per child (`getAbsoluteOpacity`), so the old `opacity={0.5}` fog
> layer dimmed each shape independently and overlaps compounded (0.5-over-0.5 = 0.75).
> Fix: fog renders at full layer opacity (overlaps flatten to a single opaque mask), then
> a **single trailing full-scene** `destination-out` **rect at opacity 0.5** (DM only) halves
> the whole flattened alpha in one pass — uniform everywhere. Lives in the new memoized
> `src/components/MapFog.tsx` (`FogLayer`). Never split fog across layers or wrap it in a
> cached group.
> - **Brush lag fixed by memoization.** A brush stroke only mutates the tool's `draft`
> (rendered in the topmost overlay layer), never `scene.fog`. `FogLayer` is `React.memo`,
> and `VisionMaskLayer`/`WallsLightsEditor` are now memoized with `useCallback`-stabilized
> wall/light handlers, so a stroke no longer re-diffs the committed fog/wall/light nodes
> (previously every pointer-move re-created and re-diffed up to 300 fog shapes).
> - **Tool option popups redesigned** (`MapToolbar`): uniform equal-width/height buttons in
> labeled rows (`.map-opt-label`/`.map-opt-row`/`.map-opt-btn`, 12rem panel). New
> functionality, still zero new message types: **walls** get a Wall/Door mode toggle
> (Shift still flips) + Clear-walls (`SET_WALLS []`); **lights** get Candle/Torch/Lantern
> size presets (`ToolRuntime.lightRadii`, `LIGHT_PRESETS`) + Clear-lights
> (`UPDATE_SCENE {lights:[]}`); both keep the Lighting on/off + 👁 Preview row. Fog
> options regrouped (Fog/Invert, Reveal/Cover, size, Reset). `ToolRuntime` gained
> `wallKind` + `lightRadii`.
>
> **Lights/fog/undo round (2026-07-03, user feedback):**
>
> - **Lights stay LOS-gated for players** (user's explicit choice): a light only reveals
> area inside a vision token's line of sight — a player with no vision token sees darkness
> (`VisionMaskLayer`, LOS-gated). What was "broken" was the DM's ability to *see* lights
> working. Fix: a **DM lighting overview** — when a scene has dynamic lighting on and the
> DM is NOT previewing, `DmLightingOverlay` dims the map (~62%) and cuts every light's
> **wall-clipped pool** (LOS ∩ dim radius, `useLightCoverage`) + any vision token's
> darkvision **fully bright**: the omniscient "here's my lighting" view, no token needed.
> The 👁 preview stays the honest LOS-gated player view (hint when no token has vision).
> The earlier faint always-on coverage glow was removed (too subtle; superseded). The
> lighting toggle now reads its state — **☀ Fully lit** ↔ **🌙 Dynamic**.
> **Key setup gotcha:** lights do nothing until global illumination is off (🌙 Dynamic) —
> with it on (default), the whole scene is already lit. Order: Lights tool → 🌙 Dynamic →
> place lights (dimmed pools appear immediately for the DM); add a player token with
> vision + 👁 Preview to check the LOS-gated player view.
> - **"Player view is completely black" bug — issue & fix.**
> *Issue:* the DM sets up lights + dynamic lighting, the DM's own lighting overview looks
> right, but a real player in another tab sees an all-black map.
> *Cause:* the vision mask is LOS-gated — it only reveals inside the viewer's *own*
> vision-enabled tokens. New player tokens were created with **no** vision, so a player's
> token contributed no reveals → the whole scene stayed black for them. (Nothing was
> actually broken in the renderer; the token simply had no eyes.)
> *Fix:* `normalizeToken` now **defaults player-owned tokens** (`ownerPlayerId` set + no
> explicit vision) to `{enabled:true, rangeFt:0}` — they see lit areas within their line of
> sight automatically the moment dynamic lighting turns on. Enemies still default to no
> vision; the DM can still override per token (turn off, or add darkvision range). It's
> applied client-side on every STATE receive, so **existing** player tokens gain it too
> (just reload the player tab). Verified by `smoke-phase6` (player token defaults to
> vision-enabled, then an explicit range overrides it).
> - **Clicking an existing light/wall no longer places a new one** — markers are tagged
> `name="map-handle"` and the stage `onPointerDown` skips the active tool when the target
> is a handle, so a click drags the light / toggles the door instead.
> - **Fog brush is smooth** — the tool keeps a **live endpoint** that tracks the cursor
> every move (the preview no longer jumps in decimation-sized chunks) and samples denser
> (`max(fogBrushR/3, gridSize/6)`). Fog **brush size is a slider** (`fogBrushScale`,
> 0.15–3 grid cells) replacing S/M/L.
> - **Undo/redo (DM, client-side)** for scene edits (annotations/fog/walls/lights) **and**
> tokens (add/move/update/delete). New `src/lib/history.ts` (`useHistory` +
> `buildInverse`): each mutation records a command/inverse pair built from existing
> messages (scene edits → `UPDATE_SCENE(preScene)`; token ops → per-kind inverse), so
> **zero new message types**. `App` wraps `room.send` as `historySend` (used by
> `useDmActions`, the board `MapCanvas` send, `onMoveToken`, and drop-actor) and resets
> the stack on scene switch/leave; ↶/↷ rail buttons (`MapToolbar`) + `Ctrl/⌘+Z` /
> `Ctrl+Shift+Z` (or `Ctrl+Y`). **Scope: board (live) edits.** The scene editor's staged
> changes aren't in this history — its **Discard** reverts the whole draft; fine-grained
> staged undo is a follow-up. Covered by `tests/unit-history.test.ts`.
>
> **Fog selection tools + brush hotkey round (2026-07-06, user feedback):** two asks —
> resize the fog brush without opening the toolbar, and Photoshop-style area selection
> instead of only freehand painting.
> - **Alt+scroll brush resize.** `MapCanvas`'s `handleWheel` now special-cases: fog tool
> active, shape = brush, Alt held → adjusts `fogBrushScale` (±0.1 cell/notch, clamped to
> the slider's [0.15, 3] range) instead of zooming the viewport; the brush-ring preview
> resizes live since `renderDraft` is in the normal render path.
> - **Three new fog shapes** alongside the brush, picked via a new toolbar **Shape** row
> (`FogShape = "brush"|"rect"|"lasso"|"polygon"`, new `ToolRuntime.fogShape`): **Rect**
> (drag a marquee, release fogs the box — reuses the existing `rect` `FogReveal` kind);
> **Lasso** (drag a freehand outline, release closes+fills it); **Polygon** (click to drop
> vertices with a rubber-band preview + vertex dots; finish via double-click — new
> `MapTool.onDblClick` hook, wired on the Konva `Stage` — or by clicking back near the
> first vertex, which grows/highlights within a `closeRadius`; right-click or Esc cancels
> the in-progress draft). All three honor the existing Reveal/Cover mode.
> - **New `poly` `FogReveal` kind** (`{kind:"poly", points, mode?}`, a filled auto-closed
> polygon; `MAX_FOG_POLY_POINTS = 512`) covers rect-drag/lasso/polygon-lasso uniformly;
> sanitizer requires ≥3 vertices (6 numbers), even length, finite. Rendered in `MapFog.tsx`
> as a `closed`+`fill` Konva `Line` alongside the existing rect/circle/brush branches — no
> new message type (rides the existing `FOG_REVEAL`).
> - Switching fog shape (or right-clicking mid-polygon) clears the in-progress draft; the
> toolbar's brush-size slider only shows in Brush mode, and the hint text is per-shape.
> **Files:** `src/lib/types.ts` (poly kind + sanitizer + cap), `src/components/MapFog.tsx`,
> `src/map/tools/{fog.tsx,types.ts}`, `src/components/{MapCanvas,MapToolbar}.tsx`,
> `src/index.css` (shape-row wrap). Verified: `tsc --noEmit` + `npm run build` clean; no
> new message types, no protocol change.

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

- `src/lib/sceneMessages.ts` (pure): `sceneMessageSceneId(msg)` +
`applySceneMessage(scene, msg)` — client-side mirror of the server's scene handlers
(UPDATE_SCENE, SET_WALLS, TOGGLE_DOOR, ADD/UPDATE/REMOVE_LIGHT, FOG_SET/REVEAL/RESET,
ADD/REMOVE/CLEAR_ANNOTATIONS) reusing normalize/sanitize + caps; same reference returned
for anything else. Server stays authoritative (no server refactor).
- `SceneSettings.tsx` extracted from ScenePanel (name/map/grid/fog incl. Inverted/
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



## Phase 6.6 — Lighting revamp: gradual falloff, color, animation, directional, darkness level — ✅ SHIPPED

> **As built (2026-07-03):** Foundry-inspired lighting upgrade, machine-verified
> (`unit-scene-editor.test.ts` 38/38 incl. 13 new lighting checks; `smoke-phase6.mjs` +
> `smoke-scenes.mjs` green; `npm run build` passes). Motivation: Phase 6 lights were hard-edged
> black circles (only `dimR` used, `color`/`brightR` ignored, scene darkness a binary toggle).
> The user asked for a smooth light→dark transition plus the surrounding feature set, with two
> constraints: cheap on low-end machines, and no hit to the Cloudflare R2 10 GB image budget.
>
> - **Data model (**`src/lib/types.ts`**):** `Light` gained optional `colorIntensity`, `angle`
> (emission°, default 360), `rotation`, `gradual` (falloff on/off), and `animation`
> (`{ type: "none"|"flicker"|"pulse"; speed; intensity }`) — all optional, so existing lights &
> saved state stay valid. `Scene` gained `darkness` (0 day … 1 dark), migrated from the legacy
> `globalIllumination` boolean (`true→0`, `false→1`) in `normalizeScene`. `sanitizeLight`
> clamps/whitelists the new fields; a new `sanitizeLightAnimation` helper validates the block.
> **No new server messages** — `UPDATE_LIGHT`/`UPDATE_SCENE` already re-sanitize + broadcast, and
> the client mirror (`sceneMessages.ts`) reuses the same sanitizers, so fields flow through
> untouched.
> - **Rendering (**`src/components/MapVision.tsx`**):** the `destination-out` reveals are now **radial
> gradients** (`radialFill` + `eraseStops`) — fully lit through `brightR`, smooth ramp to dark at
> `dimR` (Foundry "Gradual Illumination"); `gradual:false` restores a hard edge. Colored lights
> add a second `"lighter"` tint pass (`tintStops`) — only colored lights pay. Directed lights
> (`angle < 360`) render a `Konva.Wedge` instead of a `Circle`, same gradient. Scene darkness
> drives an ambient reveal *inside each viewer's LOS clip* (so token-hiding outside LOS is
> preserved at any darkness) and the DM overlay's dim opacity.
> - **Animation:** an internal `useAnimationClock` ticks ~30 fps **only** while an enabled animated
> light exists AND `prefers-reduced-motion` is off AND the client toggle is on. Per frame only the
> gradient radius/alpha vary (`animModulation`) — the expensive `computeVisibility` sweep stays
> memoized on `(pos, walls)` and never re-runs, so animation is cheap. The day↔night transition is
> a client-side `useEased` tween in `MapCanvas` toward the committed `scene.darkness` (one
> `UPDATE_SCENE`, everyone eases — no server spam).
> - **UX:** double-click a light marker → `LightConfigPanel` (radii, color+intensity, angle+rotation,
> gradual, animation, delete). Hovering a marker shows a Konva tooltip
> ("Dbl-click: edit · R-click: delete · drag: move") — right-click stays delete, now discoverable.
> Editor rings become wedges for directed lights and tint to the light's color. The lights toolbar
> gained a **darkness slider + ☀/🌙 day/night buttons** and an **✨ Animations on/off** toggle
> (persisted via `localFlags`, the low-end escape hatch). Presets seed atmosphere (torch/candle =
> warm + flicker, lantern = steady neutral).
> - **Cost:** lights are procedural — state grew a few floats/strings per light (≤50/scene), a few KB
> worst case, in Durable Object storage. **Zero R2 impact** (R2 holds only uploaded images; no baked
> lightmaps). Low-end: reduced-motion honoured, animations toggleable, no extra LOS sweeps.
>
> **Files:** `src/lib/types.ts`, `src/components/MapVision.tsx`, `src/components/MapCanvas.tsx`,
> `src/components/MapToolbar.tsx`, **new** `src/components/LightConfigPanel.tsx`,
> `src/map/tools/{lights.tsx,types.ts}`, `src/index.css`, `tests/unit-scene-editor.test.ts`.

> **Phase 6.6b addendum (2026-07-03, user feedback round):** the color tint originally drew
> *inside* the vision-mask layer's canvas — Konva layers are separate `<canvas>` elements, so
> the additive gCO only blended against the (mostly erased) black mask and stacked over the
> scene as a Normal-mode film painted over token art/labels ("muddy"). Rebuilt on Foundry's
> illumination/coloration buffer split (per the user's attached Illumination Buffer doc):
> tint now lives in a dedicated `LightTintLayer` whose canvas element gets **CSS**
> `mix-blend-mode` — real cross-layer blending against map+tokens. Mounted tokens → tint →
> fog → mask, so hidden/unexplored areas still cover it. New `Scene.lightBlendMode`
> (`screen` default ≈ Foundry's Adaptive Luminance · `overlay` · `soft-light` · `multiply` ·
> `plus-lighter` = Add/Glow), whitelist-sanitized in `normalizeScene`, exposed as a CSP-style
> "Blend" dropdown in the lighting toolbar (per-scene, rides `UPDATE_SCENE`). Foundry's
> per-light background saturation/contrast/shadows need per-region pixel filters — out of
> scope for 2D canvas. Same round: **fog brush hover preview** — the brush-size ring now shows
> on hover, not just mid-drag (hover-only draft in `fog.tsx` + a generic `MapTool.onLeave`
> hook cleared on pointer-leave). Verified: `unit-scene-editor.test.ts` 41/41 (3 new
> lightBlendMode checks), tsc + build clean.
>
> Visual polish round (same day): editor reach rings now render ONLY while the lights tool is
> active (they read as a mystery outline otherwise) and are neutral gold, not light-colored;
> tint falloff is a continuous hot-center curve (the old constant-alpha plateau = muddy disc)
> and the erase fade is smoothstep-eased (the plateau→linear kink drew a mach-band ring at the
> bright radius); the tint layer moved BELOW grid/annotations/tokens (directly over the map
> image, grid split out of the base layer) so grid lines, token art, and name labels stay
> crisp and untinted.
>
> Interaction round (same day): **Blend "None (fog only)"** — a sixth `lightBlendMode` value
> that skips the tint layer entirely, so lights purely carve visibility out of the darkness;
> and **drag-to-resize on the reach rings** — with the lights tool active, dragging the solid
> ring sets the bright radius and the dashed ring the dim radius (pinned via `dragBoundFunc`,
> pointer distance → feet snapped to 5 ft, live "bright / dim ft" label, committed as one
> `UPDATE_LIGHT` on release; ring drags are `map-handle`-named so the tool doesn't place a
> new light, and the group move handler ignores bubbled ring drags). Tests 42/42.
>
> **Two-client browser verification (2026-07-03):** after a "players don't see blend modes"
> report, a WS check confirmed `lightBlendMode`/`darkness` reach player frames, and a headless
> two-client Playwright run (DM bot + real player join) screenshot-diffed the player view per
> mode: all five modes + "none" render distinctly for players; "None (fog only)" is confirmed
> zero-color. Also relevant: on a scene with NO map art (black background),
> multiply/overlay/soft-light of black are mathematically black and screen ≈ add — most modes
> are invisible by nature there; with real map art they differ clearly.
>
> **DM/player parity bug — found & fixed (same day, second report with side-by-side
> screenshot):** the player mask replayed EVERY light's erase once per vision-enabled viewer
> token (each token's LOS group contained all `LightReveal`s), and `destination-out`
> compounds — with N vision tokens the falloff fringe kept (1−a)^N darkness instead of
> (1−a), so player pools rendered fatter/brighter/flatter than the DM's (washed-out "cream
> blobs" that made blend modes look wrong/different). Fix in `VisionMaskLayer`: ambient +
> per-light erases now run ONCE inside a clip of the UNION of all viewer LOS polygons
> (`polygonsClip`, multi-subpath nonzero winding); darkvision stays per-token in its own LOS
> clip. Each light is also clipped to its own wall-coverage polygon now, closing the
> documented "lamp shines through a wall between it and the lit area" gap — player pool
> geometry now matches the DM overlay exactly (verified: two-window Playwright run, DM view
> vs player view screenshots of the same walls/lights/two-vision-token scene are visually
> identical inside pools, incl. wall shadows). Perf side-benefit: lights erase once, not
> N× per viewer token.
>
> **Join flash fix (2026-07-03):** players briefly saw the whole lit map before the darkness
> overlay "faded in" on join. Reproduced with a pixel-timeline probe (composited map-center
> pixel decayed on the `useEased` exponential curve from lit→dark over ~300ms after join).
> Cause: `displayDarkness` initialized from a lit first frame, then eased up to the real dark
> value. Fix: `useEased` now takes a `snapKey` (the active scene id) and jumps instantly to
> target when it changes — join and scene-switch load darkness in place; same-scene day/night
> changes still ease. Verified: same probe now reads steady dark from frame 1, zero bright
> frames.
>
> **Light-editor UX round (2026-07-06, user feedback):** five DM-workflow complaints while
> placing/editing lights, all fixed together in `MapVision.tsx`/`LightConfigPanel.tsx`/
> `MapToolbar.tsx`/`MapCanvas.tsx`/`index.css`.
> - **Reach-ring hover feedback.** The faint dashed dim ring gave no sign it was the resize
> handle. New `hoveredRing` state (`{id, kind:"bright"|"dim"}`) set from `ringResizeProps`'
> `onMouseEnter`/`onMouseLeave`; the hovered ring thickens (1→2px) and brightens (dim
> 0.18→0.5, bright 0.35→0.6). Same handlers flip the Konva stage container's CSS cursor
> (`grab` over a ring, `move` over the light body, reverting to the tool's inherited
> crosshair off both) — fixing "cursor never changes in lighting mode" for free.
> - **Config panel vs. the right dock.** `.map-light-config` floated at `right:12px,
> z-index:5`; the dock is `z-index:20`, so an open dock hid it and a closed dock's rail
> still clipped its edge. Fixed by offsetting `right: dock-rail-w + 12px` (an added
> `--dock-open` modifier pushes it further left by `--dock-panel-w` while the dock is
> open, mirroring the existing `.log-toasts--dock-open` pattern) — `dockOpen` threads
> App→MapCanvas→the panel wrapper. Same round: a `.panel` glass background
> (`rgba(20,19,16,.55)` + `backdrop-filter: blur`) — the previously fully-transparent
> panel was unreadable over busy map art.
> - **Dim-radius input couldn't be raised.** The old `onChange` clamped
> `Math.max(brightR, value)` on every keystroke, so typing "25" over a Bright of 20
> collapsed to "20" after the first digit. Both inputs now hold free local draft text and
> only commit (parse + validate) on blur/Enter; committing a Dim below Bright is
> REJECTED (reverts + an inline "Dim must be ≥ Bright (N ft)" message in a fixed-height
> `.light-field-note` slot so the panel never reflows).
> - **Shrinking a light via the rings stalled.** The dim-ring drag clamped
> `Math.max(5, brightR, ft)` — a floor at the CURRENT bright radius that refused to shrink
> further once dim reached it. Fixed so Bright ≤ Dim holds symmetrically in both
> directions: growing Bright past Dim already pulled Dim out; now shrinking Dim below
> Bright pulls Bright in too (they clamp equal at the boundary and keep shrinking together,
> down to a 5 ft floor) — matches growing-bright's existing behavior.
> - **Shift-drag = unsnapped ring resize.** Holding Shift while dragging a ring uses the raw
> pointer distance (rounded to 0.1 ft) instead of the 5 ft snap, for fine-tuning — same
> `evt.shiftKey` idiom as free wall-point dragging.
> - **Animation reliability + tuning.** `useAnimationClock` unconditionally honoured OS
> `prefers-reduced-motion`, silently freezing flicker/pulse even with the ✨ toggle on and
> giving no indication why. The ✨ toggle is now the sole authority (the reduce-motion
> check was removed); a new `usePrefersReducedMotion` hook + toolbar hint ("⚠ overriding
> system reduce-motion") surfaces when the override is active. Flicker amplitude was
> tuned twice on user feedback — first punched up (0.1→0.14 radius, 0.3→0.45 brightness)
> for visibility, then dialed back well below the ORIGINAL defaults (→0.06 / →0.2) once
> live testing showed the punchier version was too strong.
> - **Stale UI on tool-switch.** Two related bugs, both because Konva only fires
> `onMouseLeave` on actual pointer movement, not on a hotkey switching tools: (a) the
> light config panel stayed open after leaving lighting mode — fixed with a `useEffect`
> in `MapCanvas` clearing `editingLightId` whenever `activeToolId !== "lights"`; (b) the
> "Dbl-click: edit…" hover tooltip (and any ring highlight) stuck on screen after
> pressing e.g. `V` while hovering a light — fixed with a `useEffect` in
> `WallsLightsEditor` clearing `hoveredLightId`/`hoveredRing` whenever `lightsActive`
> goes false.
> - **Blend-mode dropdown reorder** (three small user requests, latest 2026-07-07): "None
> (fog only)" moved to first, then "Overlay" moved to second, then **"Screen" moved to
> second** (bumping Overlay down) — final order None → Screen → Overlay → Soft Light →
> Multiply → Add (Glow) (`LIGHT_BLEND_OPTIONS` in `MapToolbar.tsx`).
> All verified via `tsc --noEmit` after each change; no protocol/message changes
> (client-only UX + one CSS/state fix each).



**Still deferred (into Phase 7+):** lights casting their *own* wall shadows (reach is gated by the
viewer's LOS, not the light's), server-side LOS redaction, "is darkness source" negative lights, and
per-light background saturation/contrast/shadow adjustments (needs per-region pixel filters).

---



## Phase 6.7 — Token & item UX: shapes, image tokens, item duplicate/drag, Item Sheet — ✅ SHIPPED

> **As built (2026-07-03):** five tabletop-UX asks, machine-verified (`unit-scene-editor.test.ts`
> 58/58 incl. 16 new token/item checks; new `check-items` WS smoke green for DUPLICATE_ITEM /
> SET_TOKEN_DEFAULTS / item-token round-trip; `npm run build` + full `tsc` pass). Mostly mirrors
> existing patterns. Partially delivers Phase 7's items/tokens scope.
>
> - **Click split:** single-click a token = select (DM Token panel); **double-click = open sheet**
> (`onDblClick`/`onDblTap` on `TokenNode` → `onOpenTokenSheet` → `openTokenSheet`, which routes
> item tokens to the Item Sheet, else the character sheet). `selectToken` no longer auto-opens.
> - **Token shapes/image (**`src/lib/types.ts`**,** `MapCanvas.tsx`**):** `Token.shape`
> (circle/square/diamond/triangle/hexagon/octagon), `imageFit` ("framed" clips the image in the
> shape, "raw" shows the bare picture), and `kind:"item"`. `TokenShapeNode` renders via
> `Circle`/`Rect`/`RegularPolygon`; effective shape = `token.shape ?? tokenShapeDefaults[kind]`.
> Per-group defaults (`GameState.tokenShapeDefaults`, `SET_TOKEN_DEFAULTS`) edited in Settings.
> `TokenEditor` gained shape picker + image upload/clear (`uploadTokenImage`) + framed/raw toggle.
> - **Items:** `ItemRecord` gained Item-Sheet fields (type/rarity/quantity/weight/value/attunement);
> new `ItemSheetPanel` (DM-only registry panel `itemSheet`, opened via `viewItemId`/`openItemSheet`
>   - a FloatingWindow). `ItemsPanel` gained a **duplicate** button (`DUPLICATE_ITEM`, mirrors
>   `DUPLICATE_SHEET`), an open-sheet button, and **drag-onto-board** (reuses the Directory external-drop
>   → `dropItemAt` → an "item" token, mirroring `dropActorAt`). Item tokens are excluded from combat
>   auto-add and the NPC avatar strip; the Item Sheet is DM-only so secret text doesn't leak.
>
> **Files:** `src/lib/types.ts`, `partykit/server.ts`, `src/hooks/useGameRoom.ts`,
> `src/components/{MapCanvas,TokenEditor,ItemsPanel,SettingsPanel,InitiativeTracker}.tsx`,
> **new** `src/components/ItemSheetPanel.tsx`, `src/panels/registry.tsx`, `src/App.tsx`, `src/index.css`.

---



## Phase 6.8 — Directory pages, independent folder trees, multi-select, token sizing, folder reorder — ✅ SHIPPED

> **As built (2026-07-03/04):** a run of directory/token QoL rounds on top of Phase 6.7,
> machine-verified (`unit-scene-editor.test.ts` green incl. new npc-folder / token-size /
> folder-sortOrder checks; `check-folders` WS smoke green for independent trees; `tsc` + `npm run build` pass). Grouped by feature; all mirror existing patterns (Directory, messages,
> normalizers).
>
> - **Independent folder trees (user: NPCs page ≠ Actors sidebar).** `Folder.kind` gained
> `"npc"`; `SheetRecord` gained `npcFolderId`/`npcSortOrder` so an NPC files independently in
> the Actors sidebar (`folderId`, "actor" tree) and the NPCs page ("npc" tree). `ActorsPanel`
> took a `folderKind` prop; `SET_SHEET_FOLDER` gained a `tree` param; `CREATE_FOLDER` accepts
> `"npc"`; `DELETE_FOLDER` orphans both trees. **Gotcha fixed:** `normalizeGameState` was
> filtering folders to `actor|item` only — silently dropping every `"npc"` folder on the next
> normalize (items worked, NPC folders vanished). Now allows `npc`, and reconciles `npcFolderId`.
> - **Items page.** New `ItemsPage` mirrors `NpcsPage` (directory roster + side-by-side
> `ItemSheetPanel` cards), added to the page switcher; it **shares** the Items sidebar's `"item"`
> folders/items. `ItemsPanel` row-click now opens the Item Sheet (inline editor dropped).
> - **Token sizing.** Tokens were `gridSize/4` (half a cell — too small); now `tokenRadius(gridSize, sizeCells)` with a size-1 (Medium) ≈ 0.9 cell. `Token.size` (per-token) + `GameState.defaultTokenSize`
> (campaign default, `SET_DEFAULT_TOKEN_SIZE`), both edited via **sliders** (0.5×–4×) in TokenEditor
> (with a Default/Custom toggle) and Settings. `TOKEN_SIZES`/`tokenSizeLabel` name the D&D sizes.
> - **Directory multi-select.** Marquee rubber-band on empty list space + Ctrl/Shift-click; selected
> rows highlight; the search row **swaps in place** to a "N selected · Delete · Clear" bar (fixed
> `min-height` so nothing shifts); dragging a selected row drags the whole selection (folder move
> or fanned board drop). `.dir-list` fills its container so there's empty space to start a drag;
> marquee is scroll-corrected. Works in all directories (docks + pages).
> - **Folder drag-to-reorder.** `Folder.sortOrder` + `MOVE_FOLDER`; the whole folder header drags
> (name field included — a click still focuses to rename since the drag needs a 4px move; an
> already-focused field keeps its caret). Directory sorts folders by `sortOrder`.
> - **Small QoL:** board right-click no longer shows the browser save/copy/inspect menu
> (`map-root` `onContextMenu` preventDefault); folder-rename **Enter** blurs/commits (and only the
> focused name shows the input box); **"Create Player"** button in the Actors sidebar; the Scenes
> **map upload** is now a real dropzone button (icon + thumbnail) instead of bare text; item
> **duplicate** button.
>
> **Files:** `src/lib/types.ts`, `partykit/server.ts`, `src/hooks/useGameRoom.ts`, `src/lib/sceneUtils.ts`,
> `src/components/{Directory,ActorsPanel,ItemsPanel,TokenEditor,SettingsPanel,SceneSettings,MapCanvas}.tsx`,
> `src/pages/{ItemsPage,NpcsPage,PageSwitcher}.tsx`, **new** `src/pages/ItemsPage.tsx`, `src/App.tsx`,
> `src/index.css`.
>
> **Still to do (noticed in testing):** the local dev loop leaves orphaned `workerd` processes that
> squat on port 1999 and serve stale code — kill `workerd` between server restarts. Server-message
> changes here (npc folders, `SET_DEFAULT_TOKEN_SIZE`, `MOVE_FOLDER`) need a PartyKit restart to take
> effect, not just a browser refresh.

---



## Phase 6.9 — Walls revamp: types + channels, movement blocking, full editing — ✅ SHIPPED (manual UX check owed)

> **As built:** shipped per the spec below; machine-verified (`tsc` + `npm run build` pass;
> `unit-visibility` 40 checks incl. marching/limited, one-way, `clampMove`, and legacy→channel
> migration parity; `unit-scene-editor` covers the granular ADD/UPDATE/REMOVE_WALL + SET_DOOR_STATE
> reducers; smoke `phase6` (DM-only editing, player door toggle, locked-door refusal, caps),
> `scenes`, `phase7`, and a new `smoke-walls-move` (server movement-collision guard: player blocked,
> clear path allowed, toggle-off passes, DM bypass) all green). Deltas & notes:
>
> - **Door interaction opened to players.** v1 doors were DM-only; now `TOGGLE_DOOR` is handled
>   *before* the DM-only map gate so players open unlocked, non-secret doors (locked → error; secret →
>   ignored). A new `DoorLayer` (MapVision) renders clickable door glyphs at door midpoints for ALL
>   clients (secret doors DM-only); wall EDITING stays DM-only in `WallsLightsEditor`.
> - **`wallsBlockMovement` defaults ON** (normalizeScene) — existing scenes begin enforcing wall
>   collision; the DM disables it per scene from the walls toolbar. DM token drags always bypass.
> - **Chained drawing commits per segment** (ADD_WALL on each completed segment) rather than one
>   UPDATE_WALLS for the whole chain — simpler and gives per-segment undo. Esc / tool-switch ends the
>   chain; a press-drag-release still makes a single segment. Endpoints snap to nearby wall endpoints
>   then the grid (`snapWallPoint`, shared by the tool + the editor's endpoint handles).
> - **Editing** (select mode): box-select + Shift multi-select, drag endpoints or the whole
>   segment/selection, `WallConfigPanel` (double-click) with preset + per-channel + direction + door
>   controls (field-patch edits apply to the whole selection), clone (button + Ctrl/Cmd+D), one-way
>   arrows. One commit per gesture.
> - **Movement collision is center-path only** (`clampMove` rejects a move whose center path crosses a
>   movement wall; never traps a token). Radius-aware capsule collision + clamp-to-just-before-the-wall
>   are noted future refinements. Directional walls are two-way for movement in v1.
> - **Files:** `src/lib/{types,visibility,sceneMessages}.ts`, `partykit/server.ts`,
>   `src/components/{MapVision,MapCanvas,MapToolbar}.tsx`, `src/map/tools/{types,walls}.tsx`, **new**
>   `src/components/WallConfigPanel.tsx`, tests `unit-visibility` + `smoke-walls-move` (+ updated
>   `unit-scene-editor`, `smoke-phase6`, `smoke-scenes`).
> - **Still owed:** the two-window manual UX pass (draw/chain feel, endpoint/body drag, box-select +
>   clone, per-type vision behavior, locked/secret doors, movement toggle with DM bypass, undo/redo,
>   live player sync). Follow-ups: per-door player-visibility gating of glyphs (currently always shown
>   to players), proximity/attenuation walls, and the sound channel.
>
> **Phase 6.9b — modeless editing UX + door lock + hover + proximity windows (user round):** the
> mode-based editor (a Draw/Select toggle; endpoint dots only on a selected wall in Select mode) didn't
> read like FoundryVTT — it looked as if walls couldn't be moved. Reworked to a **single modeless wall
> tool** matching `foundry_wall_basics_transcript.txt`:
>
> - **Always-visible endpoint dots** on every wall while the tool is active; drag a dot → move that
>   endpoint; **drag the wall's line → move the whole wall** (auto-selects it). Endpoints/bodies go
>   inert only while a chain draw is in progress (so clicks land as vertices).
> - **Selection:** click → select (highlight); **Shift-click** → add/remove; **Alt-click** → select the
>   whole **contiguous run** (walls joined at shared endpoints via `contiguousWallIds` BFS) and move
>   them all at once (live multi-move via a shared `bodyDrag` offset in `WallsLightsEditor`).
>   **`X` / Delete** removes the selection. Rectangle box-select was **removed** (superseded by
>   Alt-run + Shift-click).
> - **Micro-snap:** new endpoints snap to a sub-grid (`gridSize / WALL_SNAP_SUBDIVISIONS`, ≈1/8 cell) by
>   default; **Shift** ignores it (precise); the 🧲 toggle still force-snaps to grid corners. Endpoint
>   snapping (gap-free joins) always applies. `snapWallPoint(x, y, { excludeId?, free? })`.
> - **Chaining:** **right-click *or* Esc ends** the chain (right-click on a wall still deletes when not
>   drawing). The Draw/Select toggle + marquee draft were deleted from the tool, `ToolRuntime`,
>   `MapCanvas`, and `MapToolbar`.
> - **Hover-highlight:** the wall under the cursor brightens (+ enlarged dots) so you can tell which
>   you'll grab, esp. at joints.
> - **Doors:** DM **right-clicks** a door glyph to lock/unlock (`SET_DOOR_STATE`); left-click still
>   opens/closes.
> - **Visual polish (user round):** Foundry-matched palette in `wallVisual`/`DoorLayer` — normal =
>   light-yellow `#f2e9a0`, terrain `#81b90c`, invisible cyan, ethereal purple `#b98cf0`, window pale
>   blue `#c7d8ff`; doors closed=blue / open=green / locked=red / secret=magenta; uniform **gold**
>   endpoint dots, **orange `#ff922b`** selection with a `shadowBlur` glow. Endpoint dots are bigger
>   (r 6, hover 8, selected 9) and **always shown while the walls tool is active** (even mid-chain,
>   where they're non-interactive); lines are thicker (4 / doors 5 / selected 6). New per-client DM
>   toggle **"show walls off-tool"** (`showWalls`, persisted via `campaignStore`) gates wall-line
>   rendering when the walls tool is inactive — walls always render while editing.
> - **Proximity "window" walls:** new `"proximity"` value on the sight/light channels + a per-wall
>   `threshold` (ft, default 10); the `window` preset uses it. A proximity wall blocks a channel only
>   when the source is **beyond** the threshold (binary — reverse-proximity + attenuation deferred);
>   movement is unaffected. Sweep: `wallsToSegments(walls, channel, ftToPx)` tags proximity segments
>   with `proximityPx`, and `computeVisibility`'s per-origin prefilter drops them when the origin is
>   within range (uses a new `pointSegmentDistance`). Config panel gains a "Proximity" option + a range
>   input. **Files:** `src/lib/{types,visibility}.ts`, `src/components/{MapVision,MapCanvas,MapToolbar,WallConfigPanel}.tsx`,
>   `src/map/tools/{types,walls}.tsx`, test `unit-visibility`.
>
> **Phase 6.9c — wall-tool bugfixes + door fog-of-war gating (user round):**
>
> - **Right-click while chaining no longer deletes the just-placed wall.** Root cause: ending the
>   chain on `pointerdown` made the wall interactive again before the following `contextmenu` fired,
>   so the right-click landed on the (now-live) wall and deleted it instead of just exiting the chain.
>   Fixed by ending the chain in the Stage's `onContextMenu` handler instead, while the wall is still
>   inert at that point.
> - **Right-click during the between-clicks dotted preview no longer completes that segment.** A
>   right-click still sends a `pointerup`; the Stage's `onPointerUp` was calling the tool's `onUp`
>   regardless of button, so it committed the previewed segment a beat before `contextmenu` could end
>   the chain. `onPointerUp` is now gated to the left button only, matching `onDown`.
> - **Drag-to-draw shows the wall live instead of only appearing on release.** `walls.tsx`'s
>   `renderDraft` now draws a SOLID line in the brush's actual color (new `WALL_BRUSH_COLORS` map in
>   `types.ts`) while actively pressing/dragging, falling back to the dashed "next segment" preview
>   only between chain clicks.
> - **Hover + `X` deletes a wall without selecting it first.** Hover state is lifted out of `WallNode`
>   through `WallsLightsEditor` (`onHoverWall`) into a `hoveredWallId` in `MapCanvas`; `X` / Delete now
>   removes the hovered wall directly unless it's already part of a multi-selection (then the whole
>   selection goes, as before). A safety effect clears a stale hover id if that wall was removed some
>   other way (e.g. right-click delete).
> - **Door icons now respect fog of war.** `DoorLayer` previously showed every door glyph to every
>   client regardless of visibility. It now hides a door from players/DM-preview wherever it sits in
>   unseen darkness — the same "in LOS AND lit (ambient / darkvision / a wall-clipped light)" rule
>   already used for token name-label visibility. Extracted the generic `computeVisiblePointIds`
>   helper (works on any `{id,x,y}`, not just tokens) out of `computeVisibleTokenIds` in
>   `MapVision.tsx`; `MapCanvas` computes `visibleDoorIds` the same way it already computes
>   `tokenLabelIds`. The DM's own (non-preview) overview still sees every door, including secret ones.
> - **Scenes page gets undo/redo parity with the board.** `ScenesPage` owns its own `useHistory()`
>   instance, wraps `editorSend` to record inverses via `buildInverse` (mirroring `App.tsx`'s board
>   `historySend`), and passes `history` into its embedded `MapCanvas` so the same ↶/↷ rail buttons
>   appear. Works in both Live and staged-draft mode (undo replays through `editorSend`, folding back
>   into the draft or the room as appropriate); Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y while the page is
>   visible; the stack resets on scene switch or the Live-updates toggle so undo stays scoped to the
>   current editing context and can't replay into the wrong scene/mode.
> - **Files:** `src/lib/types.ts` (`WALL_BRUSH_COLORS`), `src/map/tools/walls.tsx`,
>   `src/components/{MapCanvas,MapVision}.tsx`, `src/pages/ScenesPage.tsx`.

Phase 6's walls shipped a focused v1: a wall is `{ x1,y1,x2,y2, kind:"wall"|"door", open? }` that
blocks **sight and light only**, with binary doors, an all-or-nothing vision sweep, and **no
post-creation editing** (draw one segment per drag; delete or clear-all — that's it). This phase brings
walls up to a FoundryVTT-like standard. Decided with the user: **types+channels model**, **movement
blocking with a per-scene DM toggle**, and a **full editing overhaul**.

Foundry's key idea we adopt: named "types" are just **presets over orthogonal restriction channels**,
and doors are **walls with state**, not a separate object.

- **Data model** (`types.ts`): `Wall` gains independent `sight`/`light`/`move` channels
  (`none|normal|limited` — "limited" = see past one, not two), one-way `dir` (`both|left|right`), door
  `door` (`none|door|secret`) + `state` (`closed|open|locked`), and a non-authoritative `preset` tag.
  `WALL_PRESETS` maps Normal/Terrain/Invisible/Ethereal/Window → channel bundles (single source of truth
  for the config panel + toolbar). `sanitizeWall` migrates legacy `{kind,open}` walls losslessly
  (`wall`→all-normal, `door`→`door:"door"` + `state`). New `Scene.wallsBlockMovement?` (default on).
- **Vision sweep** (`visibility.ts`): `wallsToSegments(walls, channel)` builds per-channel segment sets
  (`"sight"` vs `"light"`); `computeVisibility` marches all hits per ray (terminate on a `normal` hit or
  the **2nd** `limited` hit) so terrain/window walls "see past one"; a per-origin `cross`-sign prefilter
  implements one-way walls. Output stays a single angular polygon the existing clip code consumes.
- **Movement collision** (`visibility.ts` helpers + `MapCanvas` + `server.ts`): `segmentsIntersect` /
  `movementSegments` / `clampMove` (DOM-free, shared client+server). Client clamps the token drag
  (`MapCanvas` token `onMove`); the player `MOVE_TOKEN` handler guards authoritatively. Gated on
  `scene.wallsBlockMovement`; the DM always bypasses.
- **Editing overhaul** (`walls.tsx` + `WallsLightsEditor` + `MapCanvas` + `tools/types.ts`): chained
  multi-segment drawing (snap to existing endpoints → grid), drag endpoints/whole segments, box-select +
  Shift multi-select, clone (Ctrl+D), and a per-wall config panel (`WallConfigPanel.tsx`, modeled on
  `LightConfigPanel`). One commit per gesture (never per `onDragMove`).
- **Sync** (`types.ts` protocol, `server.ts`, `sceneMessages.ts`): granular `ADD_WALL` / `UPDATE_WALL` /
  `UPDATE_WALLS` / `REMOVE_WALL` / `SET_DOOR_STATE` mirroring the light messages (keep `SET_WALLS` for
  bulk clear/paste and `TOGGLE_DOOR` for player door clicks, refused when `locked`). Undo/redo comes free
  via `sceneMessages` → `history` inversion. Secret doors are **client-side appearance gating only**
  (walls are broadcast for client-side vision, so they can't be redacted without breaking LOS).
- **Toolbar** (`MapToolbar.tsx`): `Draw | Select` mode, preset picker, Clone, a "Walls block movement"
  scene toggle, Clear-walls, updated hints.

Out of scope (future): sound channel, proximity/attenuation walls, persistent fog-of-war memory.

**Phasing:** A (model + migration + sweep + collision helpers, behavior-preserving) → B (sync + editing
overhaul) → C (movement collision integration) → D (config panel + door/secret polish).

**Verify:** unit-test the marching sweep (1 limited passes, 2 stack to block, limited-then-normal
blocks), directional occlusion, and `clampMove`; confirm all-`normal` walls render identically
(migration parity); `tsc` + `npm run build`; two-window E2E (chained draw, endpoint/segment drag,
box-select + clone, per-type behavior, locked/secret doors, movement toggle on/off with DM bypass,
undo/redo, live player sync).

---



## Phase 7 — Game-content depth: sheets, items, rolls, DM tools — ✅ SHIPPED

The "make it playable for a real campaign" phase (user, 2026-07-02). Each item follows
the fixed recipe (GameState field → normalize → message → redaction → cap).

> **As built (2026-07-04):** shipped in one run as sub-rounds 7a–7k; machine-verified
> (`npx tsc` + `npm run build` clean; unit suites `unit-sheets`, **new**
> `unit-sheets-phase7` + `unit-rollcheck`, `unit-redaction` all green; **new**
> `tests/smoke-phase7.mjs` = 33 checks green; phase0–6 + scenes + ux2 smoke all still
> green). Deltas & notes:
>
> - **7a data model (**`src/lib/types.ts`**).** `CharacterSheet` grew ~40 fields (temp HP,
> death saves, hit dice, speed/prof/senses, currency/carry/attunement, prof-dots,
> pills, attacks/features/spells/spellSlots/spellcasting/effects, biography,
> `traits`, `favorites`). New row types (`InventoryEntry` v2 + Attack/Feature/Spell/
> Effect/Tool/Resource) each carry a stable `id` (legacy rows backfilled
> **deterministically** `inv-${index}`). All fields required + defaulted so the
> redaction copy-loop stays total. `SheetSectionId` +5 (features/spells/effects/
> traits/biography; bio moved off `identity`); a unit test asserts **every
> CharacterSheet key is in exactly one section**. `MAX_SHEET_BYTES = 20_000` enforced
> in `UPDATE_SHEET`; row/string caps in `normalizeCharacterSheet`. `ItemRecord` +=
> damage/damageType/properties/equippable/toHit. `Token.facing?`. `CONDITIONS` +4
> (deafened/exhaustion/incapacitated/petrified). `characterSheetsEqual` deleted (0
> callers). Inventory sanitizer is now more lenient (keeps a nameless row with a
> default name instead of dropping it — friendlier mid-edit; the redaction unit test
> was updated to match).
> - **7b/7c tabbed sheet (**`src/components/sheet/`**).** Built as one effort: `SheetView`
> (shell) + `useSheetDraft` + `SheetSidebar`/`SheetHeader`/`SheetRail`/
> `DeathSaveTracker` + `pages/{Main,Inventory,Features,Spells,Effects,Biography, Traits}Page` + `RowTable` (the grouped-table workhorse) + `atoms.tsx` + `traitDefs.ts`.
> PC vs NPC is data-driven (NPC omits Main, leads Features with an ability-blocks +
> saves header). `CharacterSheet.tsx` is now a thin wrapper over `SheetView`; the old
> card body is gone. Responsive via container queries on `.sheet7` (sidebar collapses
> narrow; Main goes 3-region ≥680px). Registry sheet width 360→560 (min 420×480);
> page `.sheet-col` 400→520. Rest buttons send `REST` (log-only). Effects Conditions
> grid is a **view over linked tokens** → new `SET_TOKEN_CONDITIONS` (no sheet-side
> copy). ItemSheetPanel gained the weapon fields; drop-onto-sheet copies them.
> **Sheet page rail restyle (user, same day):** the rail is no longer a solid column —
> it's floating square buttons that protrude along the right edge, and the active one
> flattens + matches the panel bg so it reads as docked into the sheet.
> - **7d rolls.** New `ROLL_CHECK {sheetId, check, adv?, private?}` — the server resolves
> modifiers **from the sheet it owns** (pure `src/lib/rollCheck.ts`, unit-tested) and
> builds `DiceRoll.parts` (die/ability/prof/item/flat). `ROLL_DICE` + `DICE_THROW`
> synthesize parts too. `LogPanel` renders color chips summing to the total; the
> masked-secret branch rebuilds the roll so parts can't leak. Sheet click-rolls swapped
> `onRoll(label, mod)` → `onRollCheck(check, adv)`; App/registry gained `rollCheck`
> (secret toggle applied).
> - **7e quick HP.** `ADJUST_HP {sheetId, delta}` (temp eaten first, clamp 0..max,
> combat-logs; dmOnly when an NPC's HP is secret). Shared `HpStepper` on the
> TokenEditor + initiative rows. (Right-click token popover deferred — a Konva HTML
> overlay; the two steppers cover the workflow.)
> - **7f token facing.** `Token.facing` on both `MOVE_TOKEN` server paths (undefined =
> keep); Konva wedge on the token rim; drag rotate-handle (commits on pointer-up only),
> `[`/`]` (15°) + `{`/`}` (45°) nudge, TokenEditor slider. (Alt+scroll deferred.) *(The
> wedge + blue selection styling were later reworked into the single-shape arrow +
> white-glow handle — see the "QoL round" note below.)*
> - **7g templates.** `src/map/tools/template.tsx` (circle/cone/line/rect), transient
> `TEMPLATE` relay via a **generalized** `relayTransient` (renamed from `relayMeasure`,
> keyed `${sender}:${channel}`; MEASURE rides it too, still green), toolbar shape + pin
> options; "pin" commits a stroke annotation.
> - **7h coin flip.** `"coin"` DieKind (sides 2) through DIE_SIDES/DIE_KINDS/decomposeDie/
> buildExpressionLabel; `buildCoin()` squat cylinder + H/T decals; far-left tray slot +
> 🪙 button; server values ∈{1,2}, log "🪙 Coin flip — Heads/Tails" via a Heads/Tails
> part; secret + text fallback inherit from Phase 4. (Bespoke flip-in-place launch +
> metallic-clink audio variant deferred — drag-throw works; the default impact sound
> plays.)
> - **7i scenes depth.** Map pins = annotation kind `"pin"` (📍 + text) + `dmOnly` field;
> **new redaction rule** strips `dmOnly` annotations from player scenes; DM-only `pinTool`.
> Pre-staging = a "Stage actors" list in the Scenes editor that drops real tokens on the
> **selected** (possibly non-active) scene — already player-invisible via the
> active-scene-only redaction (verified: hidden until Set Live).
> - **7j assets page.** DM-only `AssetsPage` (page switcher) + `functions/api/{list, delete}-asset.ts` (R2 `.list`/`.delete`, delete guarded by the `{kind}/{roomId}--`
> key prefix) + `findAssetUsage` in-use scanner (pure, unit-tested) with a
> delete-with-warning confirm + Copy-URL. R2 lives in the deployed env; dev shows an
> empty list + a note. (Assign-to-portrait / drag-to-board / token presets deferred.)
> - **7k export/import.** `EXPORT_CAMPAIGN`→`CAMPAIGN_EXPORT` (full persisted state,
> downloaded as JSON by the requesting DM); `IMPORT_CAMPAIGN` grew a **v2** full-state
> path (≤900KB, normalized, roomId pinned, vanished-slot players kicked, connected list
> rebuilt, persisted) alongside the kept v1 scenes-only path. Buttons in SettingsPanel.
> - **Deferred polish (noted, not blocking):** right-click HP popover; token facing
> Alt+scroll; coin flip-in-place launch + metallic clink; assets assign/drag/presets;
> hover tooltip cards on sheet rows (rows expand instead). The ornate parchment/red
> skin is **Phase 8** — this shipped the structure + behavior on the existing tokens.
> - **Files:** new `src/components/sheet/`**, `src/lib/{rollCheck,assetUsage}.ts`,
> `src/map/tools/{template,pin}.tsx`, `src/components/HpStepper.tsx`,
> `src/pages/AssetsPage.tsx`, `src/styles/sheet7.css`, `functions/api/{list,delete}-asset.ts`,
> `tests/{unit-sheets-phase7,unit-rollcheck}.test.ts`, `tests/smoke-phase7.mjs`; edits
> across `src/lib/{types,redact,dice3d}.ts`, `src/dice/{geometry,trayScene}.ts`,
> `partykit/server.ts`, `src/components/{CharacterSheet,LogPanel,TokenEditor, InitiativeTracker,ItemSheetPanel,MapCanvas,MapToolbar,SettingsPanel,DiceTray}.tsx`,
> `src/pages/{SheetCards,PlayersPage,NpcsPage,ScenesPage,PageSwitcher}.tsx`,
> `src/hooks/useGameRoom.ts`, `src/App.tsx`, `src/panels/registry.tsx`,
> `src/map/tools/{types,registry}.ts`.
> - **Manual checks still owed by the user (two browsers):** tabbed sheet feel (PC + NPC,
> reveal eyes per page, death saves, rest log, the new floating rail); ROLL_CHECK color
> chips in the log; quick-HP steppers; token facing rotate-drag + `[`/`]`; template
> relay across windows; coin flip 3D + secret + text; staged tokens invisible until Set
> Live; assets list/delete against real R2; export→import round-trip in the UI.
>
> **QoL round (2026-07-04, user feedback — same-day follow-up; after the 7a–7k run,**
> `npx tsc` **+** `npm run build` **clean throughout):**
>
> - **Token facing arrow redesigned (**`MapCanvas.tsx`**).** The filled wedge became a
> FoundryVTT-style indicator: a single continuous closed outline (`arrowPoints`
> useMemo) — an arrowhead flanked by two rim-hugging "fins", set off the token by a
> small gap — traced as ONE path so it fills + strokes with no internal seams (was 3
> separate shapes with visible joins). Geometry knobs: `gap`, `finW`/`finTipW` (blunt,
> non-tapered fin tips), `arrowH`/`arrowAng` (arrowhead size), `spread` (fin arc
> length). The arrow **is** the rotate handle now — hover highlights it (cursor `grab`)
> and you drag to rotate; no selection or double-click needed (`canRotate = Boolean(onRotate)`).
> - **Selection/hover feedback → soft white glow (**`MapCanvas.tsx`**).** Dropped the blue
> selection dot + outline for a subtle white glow halo (Konva shadow, opacity ≈0.5·g /
> blur ≈9·g) that **fades in/out** via a new `useGlowFade` rAF-lerp hook. It lights the
> **whole token** on hover or select — circle, framed-image, and raw-image — and covers
> **item tokens** too (they glow with no arrow).
> - **Square token inscribed (**`TokenShapeNode`**).** The square was circumscribing the token
> circle (side = radius·2, corners outside it); now inscribed (side = radius·√2, corners
> on the rim) so it matches the footprint of the other shapes.
> - **Rotate-commit flash fixed (**`MapCanvas.tsx`**).** On pointer-up the local preview
> (`dragFacing`) is now held at the committed angle until the server echoes it back (a
> reconcile `useEffect`, 0.5° threshold + race guard) instead of clearing to `null`
> immediately — which had flashed the pre-rotation facing for one frame during the
> round-trip, then snapped forward.
> - **Sheet page rail now truly external (**`FloatingWindow.tsx` **+** `SheetView.tsx` **+**
> `index.css`**/**`sheet7.css`**).** Superseding the initial in-window attempt: window chrome
>   - clipping moved to an inner `.window-inner` wrapper, `.window:has(> .window-siderail)`
>   keeps the outer box `overflow: visible`, and the rail is React-`createPortal`'d into a
>   `.window-siderail` sibling — so the square buttons protrude over the tabletop *outside*
>   the panel, with the active button's tab tucking behind the panel via z-index.
> - **Players page top-row height (**`index.css`**).** Matched to NPCs/Items/Scenes by making
> the chip-tab name input borderless with zero vertical padding.
> - **Dice drag-back-to-tray (**`useDiceOverlay.ts`**).** Dragging a die/coin back over the
> tray while still holding now pops it back onto the tray (preview cancel + re-grab if
> dragged out again) instead of leaving it stuck under the tray — a `rideDrag` rewrite.
> - **Coin redesign (**`src/dice/{geometry,engine,trayScene}.ts`**).** The coin flip stopped
> being a re-skinned die throw. **Look:** it's now metallic **gold** (`#d4af37`, metalness
> 0.85 / roughness 0.3, dark engraved H/T label instead of the cream numerals) and **thinner**
> (`buildCoin` `halfH 0.3 → 0.13`; diameter held constant by `normalizeScale`). Styling moved
> to a shared `dieMaterialOptions(kind, percentile)` helper so the thrown die (`engine.ts`) and
> the idle tray die (`trayScene.ts`) render identically. **Feel:** you don't throw a coin, so
> it's now a **flick-to-flip** — grab it out of the tray and release while flicking the mouse
> up. The *same* release-velocity sampling used for a die throw is **reinterpreted** for coins
> in `buildReleaseStates` (new all-coins branch → `buildCoinFlipStates`): flick magnitude drives
> the vertical pop **and** the end-over-end spin (harder flick → higher + spinnier), horizontal
> travel is clamped near-zero with a hair of forward bias (lands flat just ahead, not across the
> board), and the spin is about the world-X axis so the H/T caps flash. A reduced per-body
> `gravityScale` (0.55) in `presimulate` gives the floaty hang time for a few visible rotations
> and a gentle landing — no mouse-acceleration tracking or flick-start detection needed. The
> **server / track / Heads–Tails value flow is unchanged** (the client authors the animation;
> the server still rolls the value and relabels the resting face), so no message/`types.ts`
> edits and `smoke-phase7.mjs` coin checks stay green.
> - **SpaceBar = left click (**`src/lib/useSpaceClick.ts`**, new; wired in `App.tsx` +
> `SettingsPanel`).** Opt-in per-device setting (localStorage `cm-space-click`, default off)
> for touchpad users: holding SpaceBar acts as the physical left mouse button at the cursor —
> press synthesizes pointerdown/mousedown, release synthesizes pointerup/mouseup (+ a `click`
> when the cursor barely moved), and real cursor moves in between drive a click-drag. It fires
> both PointerEvents and MouseEvents so it drives everything (Konva board/token drags, React
> onClick, window-level drag listeners); Space still types in text fields and Ctrl/Alt/Meta+Space
> pass through. Follows the existing local-flag idiom (`readLocalFlag`/`writeLocalFlag`, `ctx`
> setting like snap/toasts).
> - **DM player-permission toggles (**`types.ts` + `partykit/server.ts` + `MapCanvas.tsx` +
> `SettingsPanel`**).** Two new room switches in the Settings "Room (DM)" section, mirroring
> `playersCanDraw`: `playersCanMove` (players move/rotate their own characters) and
> `playersCanPoint` (players Shift-drag the dotted pointer arrow). **Both default ON** (normalize
> with `!== false`; `createInitialState` true). New DM-only messages `SET_PLAYERS_CAN_MOVE` /
> `SET_PLAYERS_CAN_POINT` (inherit the "Only the DM can control the map" switch guard).
> Server-authoritative gates: the player `MOVE_TOKEN` path rejects when movement is off (covers
> rotate too — same path), and `ADD_ANNOTATION` gates arrows behind `playersCanPoint` (the arrow
> was previously always-allowed and exempt from the draw gate). Client mirrors for UX: token
> `draggable`/`onRotate` require the flag, and `arrowGestureArmed` checks `canPoint`. Flags reach
> players free via `redactStateFor`'s `...state` spread. Covered by `smoke-phase7.mjs` (+3 checks:
> player can't toggle, move rejected when off, arrow rejected when off).
> - **Crisp token images (**`sceneUtils.ts` + `MapCanvas.tsx`**).** Uploaded token portraits
> looked soft/low-res on the board. Root causes, fixed in layers:
>   1. **Framed tokens rendered via a Konva fill pattern** (`fillPatternImage`) — which both
>      *stretched* non-square images (non-uniform `fillPatternScale`) and *ignored*
>      `imageSmoothingQuality`, so no quality setting could reach them. Rewrote them as a
>      **clipped `KonvaImage` with cover-fit** (`clipTokenShape` + `TokenShapePrimitive` in
>      `TokenShapeNode`): `drawImage` (honors smoothing, preserves aspect, crops overflow) with
>      the outline + glow drawn on top. Raw tokens already used `KonvaImage`.
>   2. **Chrome defaults `imageSmoothingQuality` to `"low"`.** A `useEffect` sets it to `"high"`
>      on every layer's scene canvas **and the stage's shared `bufferCanvas`** (a token has
>      fill+stroke, so Konva downsamples it through that buffer, not the scene canvas) — re-applied
>      on stage resize, which resets context state.
>   3. **Sub-pixel ~1:1 draws smoothed soft.** `useCrispImage(img, radius)` makes a
>      high-quality **stepped-halving** copy (`downscaleImage`) sized to the token's max on-screen
>      footprint (`radius·2 × MAX_VIEWPORT_SCALE × devicePixelRatio × aspect`) times a
>      **`SUPERSAMPLE`** factor (2×), rounded **up** to a 64px step (`ceil`, floor 128, ≤2048) so
>      it never undershoots (→ upscale blur) and downsamples cleanly. Source art (upload/R2) is
>      untouched — uploads are stored **uncompressed** (dev writes raw bytes to disk; prod
>      `UPLOADS.put(bytes)` to R2; client sends the original via `readAsDataURL`).
>      **(2026-07-07: sizing superseded** — max-zoom sizing left a zoom-independent ~(4/zoom):1
>      single-pass minification at draw time, which is why tokens still looked soft at normal
>      zoom. The copy now tracks the CURRENT zoom, quantized to √2 buckets — see the
>      render-quality round below.)
>
>   **Tuning knobs (all client-render only; dev hot-reloads on save — no re-upload needed):**
>   - **Sharpness / supersampling** — `useCrispImage` in `MapCanvas.tsx`, `const SUPERSAMPLE = 2`.
>     Renders the portrait at N× its on-screen size then downsamples. **Sharper →** raise to `3`/`4`
>     (crisper edges, ~N² more memory/GPU per token; diminishing returns past ~3–4).
>   - **Large/zoomed-token resolution cap** — the `Math.min(2048, Math.max(128, …))` on the line
>     below SUPERSAMPLE. `2048` = max longest side of the copy (raise to `3072`/`4096` if big
>     tokens look capped, more memory); `128` = floor.
>   - **How far you can zoom in** — `MAX_VIEWPORT_SCALE` in `src/lib/sceneUtils.ts` (`= 2`). Caps
>     board zoom; a token is small on screen, so this bounds how much 4K detail you can ever see.
>     **See more detail →** raise to `3`/`4` (**trade-off:** map images may soften if zoomed past
>     their own resolution; tokens stay sharp because `useCrispImage` reads this same constant, so
>     the copy's resolution scales up with it). `MIN_VIEWPORT_SCALE` above it caps zoom-out.
>
>   **Quick guidance:**
>   - "Soft — make it crisp at normal zoom" → bump **SUPERSAMPLE** to `3`. *(2026-07-07: the
>     zoom-bucketed cache made this largely moot at ≤1× zoom; the knob still works.)*
>   - "I want to zoom in and inspect the 4K detail" → raise **MAX_VIEWPORT_SCALE** to `3`–`4`.
>   - "Big tokens still look capped" → raise the **2048** cap.
> - **Coin flip arc (**`src/dice/engine.ts`**).** The dice scene's camera is orthographic
> top-down, so a coin rising in world-Y was invisible ("stays the same size/z"). A coin-only
> cue in `applyTrackFrame` fakes the depth: it **grows** toward the camera and **lifts
> up-screen** (camera up is world −Z), peaking mid-flight and returning to normal exactly as it
> lands. **Keyed to playback TIME, not center height** — that was the crux of two failed
> attempts: a spinning coin makes first contact *edge-on* (center still high) then flops flat,
> so any height-based cue kept shrinking after it visibly hit the board. `playTrack` caches two
> frames from the track: the **apex** (max sample-Y) for the peak and the **first floor impact**
> (`track.impacts[0].frame`, its real touchdown) for the end; the arc is 0 past the land frame,
> so bounces/flop can't resize it. Easing exaggerates a real coin's parabola: rise eases **out**
> (fast→slow, hang at the top), fall eases **in** (slow→fast) — `arc = 1 − (1−u)^E` up /
> `1 − w^E` down, `COIN_ARC_EASE = 3` (2 = the physical parabola). Coin `restitution` dropped to
> 0.02 (dead thud, no bounce); `pop` raised to ~[6,9] and `gravityScale` 0.5 for hang. Constants
> `COIN_ARC_MAX_BOOST` (peak ≈1.8×) / `COIN_ARC_LIFT` / `COIN_ARC_EASE`. Regular dice untouched.
> - **Square token size + arrow offset (**`MapCanvas.tsx`**).** Reverted the square to span the
> full diameter (`side = radius*2`, was inscribed `radius·√2`); and the facing arrow now offsets
> by the token's **reach** (`radius·√2` for the square's corners, `radius` otherwise) so it
> clears the square at every facing with the same gap it has on circles (`arrowPoints` gained a
> `reach` input; `shape` hoisted in `TokenNode`).
> - **Sheet window fixed height (**`FloatingWindow.tsx` + `registry.tsx` + `App.tsx`**).** The
> sheet window had no height, so `geom.h === null` auto-fit each tab's content (resizing on tab
> switch). Added an optional `height` prop (initial `geom.h`), set the sheet's to 620; the
> existing `.sheet7-page-scroll` now scrolls internally so the window stays a constant size
> (user resizes still win).
> - **Death saves always visible (**`sheet/DeathSaveTracker.tsx`**).** Dropped the click-the-skull
> reveal; the 3 success + 3 failure pips render unconditionally.
> - **Image crop: no-stretch + drag + zoom (**new `CroppableImage.tsx` + `types.ts` +
> `sheet/SheetSidebar.tsx` + `ItemSheetPanel.tsx`**).** Uploaded portraits stretched. New
> `CroppableImage` covers the frame without distortion and (when editable) lets you drag to
> reposition + a zoom slider. Backed by a new `iconCrop {x,y,zoom}` field on `CharacterSheet`
> **and** `ItemRecord` (default centred 1×, normalized x,y∈[0,1] / zoom∈[1,MAX_ICON_ZOOM], added
> to the identity section so the "every key in exactly one section" guard stays total; item
> creators in `server.ts`/`ItemsPanel` seed the default). The on-board map token keeps its own
> centred fit (not wired to `iconCrop`) — possible follow-up.
> - **Per-campaign UI settings persistence (**new `src/lib/campaignStore.ts` + `App.tsx` +
> `FloatingWindow.tsx` + `DiceTray.tsx` + `useDiceOverlay.ts` + `MapCanvas.tsx` + `ScenesPage.tsx`
> + `PageShell.tsx` + `savedCampaigns.ts`**).** UI settings reset on reload, and what little
> persisted was shared across all campaigns. Now everything is remembered **per campaign**,
> keyed by `roomId`, in `localStorage` (never the server/R2 — a few KB read synchronously; not
> cookies). Decisions (user 2026-07-05): scope **everything** per-campaign (layout *and* device
> toggles); **don't** persist map pan/zoom (kept as fit-to-scene). `campaignStore` wraps
> localStorage under `cm:{roomId}:{name}`, with a one-time fallback to the pre-namespacing global
> key so existing prefs migrate in. **Layout** (`dockOpen, dockTab, popped, trayOpen, page,
> settingsOpen`) persists as a `…:layout` blob: a **restore-on-join** effect (once per `roomId`,
> re-armed on `leave()`) applies it *before* the combat auto-switch (so an active encounter still
> wins), and a persist effect saves changes; entity-bound windows (open sheet/item, selection,
> `secretRolls`, viewport) are excluded. **Device toggles** (snap/toasts/spacebar-click/token-
> panel, 3D-dice + mute, light-animations, scene-editor-live, roster width) route through the
> store by `roomId` (threaded via `state.roomId`/props; the audio singletons still read a global
> mute as a harmless default that the per-campaign restore overrides). **Window + tray geometry**
> are namespaced by `roomId`; "Reset UI layout" clears the current campaign's geometry and
> returns popped panels to the dock; deleting a campaign clears its keys. Key by `roomId` only
> (synchronous at render; a browser is one role per campaign). Purely client-side — `npx tsc` +
> `npm run build` clean; manual multi-campaign reload check owed by the user.
> **Note:** Phases 6.7–6.8 already shipped much of the items/tokens/directory scope (Item Sheet,
> item tokens, token shapes + sizing, item duplicate/drag, an Items page, independent NPC folder
> trees, directory multi-select, and folder drag-reorder).

> **Render-quality round (2026-07-07, user feedback — "text goes blurry at some zoom levels;
> token images never look crisp").** Three independent blur sources on the board, fixed
> separately (`npx tsc` + `npm run build` + new unit test + a headless-Chrome runtime pass all
> green):
>
> 1. **Images were minified ~(4/zoom):1 in ONE pass at draw time.** `useCrispImage` sized its
>    pre-shrunk copy for MAX zoom, so at zoom z the final `drawImage` downscaled by 4/z no
>    matter the token size (cache and on-screen size both scale with radius — why bigger tokens
>    didn't help). Chrome's "high" smoothing is a cubic filter without mipmaps — clean only to
>    ~2–3:1. **Fix:** cache sizing now tracks the LIVE zoom quantized to **√2 buckets**
>    (`imageScaleBucket` in `sceneUtils.ts`), keeping the draw-time ratio inside [2, 2·√2) at
>    every zoom; copies re-shrink only when the zoom crosses a bucket, and `downscaleImageCached`
>    (WeakMap keyed source-image × quantized size) makes revisited buckets free. The **map
>    background** gets the same treatment (`crispMapImg` in `MapCanvas`) — it was previously
>    drawn raw from the full-resolution upload.
> 2. **Canvas text has no hinting or pixel-grid snapping.** At fractional effective font sizes
>    (fontSize × zoom × dpr — fractional at nearly every zoom step, since wheel zoom is ×1.1ⁿ
>    off a fractional fit-to-scene scale) the grayscale anti-aliasing smears glyph stems across
>    pixel rows — the "blurry at some zoom levels, fine at others" symptom. **Fix:**
>    `snapFontSize` (`sceneUtils.ts`) rounds the effective size to whole device pixels (≤±3%
>    size drift); a `CrispText` wrapper applies it to token name labels (in-token AND the
>    above-darkness copies), HP values, condition badges, the death skull, pin labels, and text
>    annotations. It reads `MapRenderCtx` — `{scale, pixelRatio}` provided INSIDE the Stage
>    (react-konva does not bridge outer React context across the Stage boundary); the memoized
>    vision/wall layers deliberately don't consume it, so they stay off the zoom re-render path.
>    The Stage translation is also snapped to the device-pixel grid (sub-half-pixel correction).
> 3. **Late-mounted layers kept Chrome's default "low" `imageSmoothingQuality`.** The old bump
>    effect re-applied only on stage RESIZE; conditionally-mounted layers (vision mask, light
>    tint, DM lighting overlay, lit-labels) arrived after it with fresh low-quality canvases.
>    `bumpStageSmoothing` (new `src/lib/renderQuality.ts`) now runs after every render, reads
>    the live context state (a no-op pass costs a few property reads), and redraws only when it
>    actually changed something.
>
> - **New setting: "Hi-res board rendering"** (Settings → This device, default OFF). Floors the
>   Konva canvas pixel ratio at **2** via `applyRenderPixelRatio` — on standard-DPI displays
>   (dpr 1, where canvas text is softest) the whole board supersamples 2× for visibly crisper
>   glyphs and art at ~4× fill cost (no-op on retina/dpr≥2 screens; the escape hatch if a big
>   map + vision feels sluggish is simply leaving it off). `renderQuality.ts` is a tiny external
>   store: it sets `Konva.pixelRatio` (future canvases), live-`setPixelRatio`s every canvas of
>   every mounted stage via `Konva.stages` (board AND the embedded scene editor), re-bumps
>   smoothing, and notifies subscribers — `MapCanvas` reads it with `useSyncExternalStore`, so
>   image caches and text snapping re-derive without a remount. Persisted per campaign
>   (`cm:{roomId}:hi-res`, legacy global `cm-hi-res`), restored on join like the other device
>   toggles; threaded as `PanelContext.hiResRender/setHiResRender`.
> - **Coverage notes:** transient tool overlays (measure/ruler labels, wall/light editor text)
>   keep plain `Text` — memoized or short-lived by design. New `tests/unit-render-crisp.test.ts`
>   pins the bucket invariants (bucket ∈ [scale, scale·√2), clamping, degenerate inputs) and the
>   font snap (integer device px, bounded drift, 1px floor).
> - **Verification method (headless-Chrome runtime pass, not just tsc/build):** launched both
>   dev servers (`partykit:dev` on :1999, `vite` — port varies, read its log), then drove the
>   app in real Chrome via the repo's existing `playwright-core` dep (`deviceScaleFactor: 1`,
>   the worst case for canvas text/image blur — most dev displays are hi-DPI and would have
>   masked the bug). Flow: **+ New** campaign → **Enter campaign** as DM → open the **Actors**
>   dock tab → pointer-drag the "Blank token" chip onto the map twice (stepped `mouse.move`,
>   real drag threshold) → screenshot a labeled-token crop at default zoom, after 4 wheel-zoom-
>   outs, after 6 wheel-zoom-ins (all fractional scales — the exact case that used to blur) →
>   toggle **Hi-res board rendering** in Settings and re-screenshot the same crop → re-zoom with
>   hi-res on → toggle off → reload the page and confirm the flag re-applies. Read back
>   `document.querySelector(".map-root canvas")`'s backing-store size vs its CSS size at each
>   step as the objective signal (flips 1600×1000 ↔ 3200×2000 on the hi-res toggle, matching the
>   setting); collected `page.on("pageerror"/"console")` throughout (zero errors — the riskiest
>   part was the new in-Stage `MapRenderCtx` provider). Screenshots eyeballed for legible,
>   non-smeared label glyphs at every step. Cleaned up afterward: killed the dev-server process
>   trees, restored `public/campaign/rooms.json` (test campaigns are gone from the registry).
>   **This recipe is now a project skill** — `.claude/skills/verify/SKILL.md` — covering server
>   launch gotchas (port collisions, stale `workerd` orphans holding :1999) and the exact
>   selectors (`.dir-blank-chip`, `button[title="Actors"/"Settings"]`, the `ToggleRow` button
>   pattern) so a future session doesn't re-derive them from scratch.
>
> **Duplicate token-name label on fast drag (2026-07-07, user feedback — same round).** On a
> **dynamic-lighting ("Dark") scene** the token name is drawn twice: once inside the token's
> Konva Group and once in the separate **above-darkness label layer** (`tokenLabelIds`) so a lit
> token's name stays legible over the darkness sheet. Konva moves the in-token copy live during
> a drag, but the top copy's Group is positioned from **React state** (`token.x/token.y`), which
> doesn't update mid-drag — moves are server-authoritative (`send()` on `dragEnd`, applied on
> echo; no optimistic local apply). So while dragging, the bright copy stays pinned at the
> pre-drag spot and trails the live one as a **duplicate** (worst when whipping the token back
> and forth; it "remains" until the round-trip lands). Not a canvas-clear bug (no layer sets
> `clearBeforeDraw(false)` — a single layer always fully clears; the duplicate is inherent to
> the two-copy design) and predates the render-quality work above. **Fix (`MapCanvas.tsx`):**
> `TokenNode` fires a new `onDragActive(active)` on real move-drags (not the shift-arrow /
> facing-rotate gestures, which already `stopDrag`); `MapCanvas` tracks the dragged token in
> `draggingLabelId` and the above-darkness layer **skips the bright copy for that token** — the
> in-token copy carries the name live meanwhile (on the DM overview it's dimmed ≤62%, still
> readable; a player's own dragged token is inside their LOS, so bright anyway). Suppression is
> **held past `dragEnd`** until the committed position lands in state (an effect watching
> `state.tokens` for that token's x/y to change) or a 600ms fallback fires — so the bright copy
> never flashes back at the stale spot during the echo window, and a rejected/clamped move
> settles cleanly too. No per-frame re-renders (`draggingLabelId` changes only at drag
> start/settle). **Runtime-verified headless** (Dark scene via the lights-tool 🌙 toggle, then a
> mid-drag capture): with the suppression disabled the frame shows two "Token" labels (stale
> origin copy + live one — the reported bug reproduced), with it enabled exactly one follows the
> token and the post-release frame is clean. `npx tsc` + `npm run build` green.

> **RESOLVED DESIGN (2026-07-04, user + exploration) — this block is the canonical build
> spec; the prose below it is the layout/UX reference it was distilled from.** Two new
> user decisions: (1) implement **all of Phase 7 in one run**, as sequenced
> independently-verifiable sub-rounds 7a–7k; (2) **one sheet UI everywhere** — the tabbed
> sheet fully **replaces** the card-style `CharacterSheet.tsx`; the Players/NPCs pages
> widen their columns (400→520px) and the vitals sidebar auto-collapses in narrow
> containers (no compact second implementation). Full design lives in the plan file
> `implement-phase-7-*.md`; the load-bearing decisions:
>
> **Data model (**`src/lib/types.ts`**).** New row types (each with a stable `id`, legacy rows
> backfilled deterministically `inv-${index}` — never randomUUID): `InventoryEntry` v2
> (adds category/weight/price/charges/equipped/attuned/toHit/damage/damageType/description
> — **self-contained display copies** since the item catalog is DM-only redacted),
> `AttackEntry`, `FeatureEntry`, `SpellEntry`, `EffectEntry`, `ToolEntry`, `ResourceEntry`.
> `CharacterSheet` grows: `hp.temp`; background/creatureType/cr/source/originalClass;
> speed/proficiencyBonus/deathSaves/hitDice/senses/resources; skillProfs/saveProfs
> (0/1/2 dots, display-only — mods stay manual); languages/weaponProfs/armorProfs/
> resistances/immunities/conditionImmunities/vulnerabilities pills; currency/carryCapacity/
> carryMultiplier/attunementMax; attacks/features/spells/spellSlots/spellcasting/effects;
> biography fields (faith/gender/ideals/bonds/flaws/personality/appearance);
> `traits: Record<string, boolean|number>` (trait *defs* live client-side in
> `sheet/traitDefs.ts` — only values persist) + `favorites: string[]`. Every field is
> **required in the type** and defaulted by `normalizeCharacterSheet` + `createDefaultSheet`
> so the redaction copy-loop stays total. `ItemRecord` += damage/damageType/properties/
> equippable/toHit. `Token` += `facing?: number` (deg, 0=up; normalize wraps 0..360,
> drops NaN). `CONDITIONS` += deafened/exhaustion/incapacitated/petrified (additive, ids
> stable). `DiceRoll` += `parts?: RollPart[]`. Conditions are **never** stored on the sheet
> — `Token.conditions` stays the single source of truth (kills the 2-way sync loop).
>
> **Sections & redaction.** `SheetSectionId` gains features/spells/effects/traits/biography
> (biography-ish fields **move out of** `identity`); `SHEET_SECTION_FIELDS` maps every new
> field into exactly one section so `redactSheetRecord` needs **no code change**. A unit
> test asserting *every* `CharacterSheet` *key appears in exactly one section* is the phase's
> most important guard. New sections start unrevealed on existing NPCs (leak-free
> direction). Reveal-eyes map onto sheet pages (Main eye toggles abilities+saves+skills via
> 3 `SET_SHEET_REVEAL` sends).
>
> **Caps.** Row caps (attacks 50, features 100, spells 200, effects 50, resources/tools 20,
> favorites 30, pills 40×60); string caps (names 120, descriptions 1000, damage/price 40,
> bio texts 5000). `MAX_SHEET_BYTES = 20_000` **enforced server-side** in UPDATE_SHEET
> (reject post-normalize if `JSON.stringify` exceeds it); client soft-warns at 18KB.
> `characterSheetsEqual` (0 call sites) deleted.
>
> **Tabbed sheet components** — new `src/components/sheet/`: `SheetView` (page + collapse
> state, PC/NPC page lists), `useSheetDraft` (extracted 400ms-debounce draft + size warn),
> `SheetSidebar`/`SheetHeader`/`SheetRail`/`DeathSaveTracker`, `pages/{Main,Inventory, Features,Spells,Effects,Biography,Traits}Page`, `traitDefs.ts`, and atoms
> (`RowTable` — the grouped-table workhorse — `PillList`, `AbilityBlock`, `StatBadge`,
> `ProfDot`, `UsesCell`, `BarMeter`, `SlotPips`). PC vs NPC is data-driven (NPC omits Main,
> starts on Features with an ability-blocks + saves header). `CharacterSheetPanel` stays a
> thin wrapper (same props + `onRollCheck`) so `panels/registry.tsx` + `pages/SheetCards.tsx`
> barely change. Responsive via container queries on the sheet root (rewrite the 620px
> 2-col rule): <500px sidebar-collapsed + 44px rail; 500–679 sidebar+content+rail;
> ≥680 full screenshot layout. Attacks list = `sheet.attacks` ∪ equipped-inventory rows
> with `damage` (computed, never stored). Effects Conditions grid is a **view over linked
> tokens** → `SET_TOKEN_CONDITIONS` per token.
>
> **New/changed messages:** `UPDATE_SHEET` (+size cap), `ROLL_CHECK {sheetId, check, adv?, private?}` (server resolves the roll breakdown from the sheet it owns — chosen over
> parts-in-request; `ROLL_DICE` stays for freeform), `ADJUST_HP {sheetId, delta}` (temp
> eaten first, clamp 0..max, combat-logs, dmOnly when NPC combat unrevealed),
> `SET_TOKEN_CONDITIONS {tokenId, conditions}`, `MOVE_TOKEN` (+`facing?` on **both** server
> paths; undefined = keep), `REST {sheetId, kind}` (log-only hook), `TEMPLATE` (transient
> relay via generalized `relayTransient`), `EXPORT_CAMPAIGN`→`CAMPAIGN_EXPORT`,
> `IMPORT_CAMPAIGN` v2 (full state, keeps v1). New HTTP `functions/api/{list,delete}-asset.ts`
> (R2 prefix `{kind}/{roomId}--`; delete guarded by roomId key-prefix match).
>
> `DiceRoll.parts` built server-side in ROLL_CHECK + synthesized in ROLL_DICE/
> DICE_THROW_REQUEST; `LogPanel` renders color chips (`.roll-chip--die/ability/prof/item/ flat`) summing to total. Masked-roll branch already rebuilds the roll explicitly → parts
> can't leak (pinned by a test).
>
> **Board/dice:** facing wedge on the TokenNode rim (rotate-drag commits on pointer-up
> only — never per-frame; Alt+scroll/`[`/`]` nudge; Shift = 45° snap). Templates =
> `src/map/tools/template.tsx` mirroring `measure.tsx`; pin = commit as annotation. Coin =
> `"coin"` DieKind (sides 2) + `buildCoin()` squat cylinder + heads/tails decals + far-left
> tray slot + `flipInPlace()` launch; inherits secret/text-fallback from Phase 4. Scene
> pre-staging = **real tokens on the non-active scene** (redaction already hides them from
> players — nearly free); map pins = annotation kind `"pin"` with a new `dmOnly`-annotation
> redaction rule. Assets page = DM-only page over the R2 list endpoint with a client-side
> "in use by…" scan.
>
> **Build order (each round green on** `npm test` **+** `npx tsc` **+** `npm run build`**):**
> 7a data model + migration + caps → 7b sheet shell + Main/Biography/Traits →
> 7c Inventory/Features/Spells/Effects + item sheets + conditions (delete old card body) →
> 7d roll depth → 7e quick HP → 7f token facing → 7g templates → 7h coin flip →
> 7i scenes depth + pins → 7j assets page → 7k export/import v2. Then full unit+smoke
> suite and an "as built" note here.



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
presentation: `DiceRoll` gains `parts?: Array<{ kind: "die"|"ability"|"prof"|"item"| "flat"; value: number; label?: string }>` built server-side at roll time; `LogPanel`
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
**Shares the** `facing` **field with Phase 6's directional-vision cone** (the vision wedge and
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

> **Map-pin revamp (2026-07-06, `revamp` branch — user feedback follow-up on the 7i pins;**
> `tsc` **+** `npm run build` **clean;** `unit-scene-editor` **+** `smoke-phase5/7` **green):**
> The Phase-7i pin (drop a `📍` via `window.prompt`, no editing/moving) grew into a proper
> placeable annotation. All DM-only + player-stripped as before.
> - **Inline note editor replaces `window.prompt` (**`PinNoteEditor` in `src/map/tools/pin.tsx`**).**
> A DOM popover (a real `<input>` can't live in a Konva layer) anchored at the pin's screen
> position (`.map-pin-editor` in `index.css`), autofocused, Enter/Save commits, Esc/Cancel
> discards. Robustness: placing a pin fires a burst of canvas focus churn, so the editor
> ignores blur until it has "settled" (250ms after mount) — a stray early blur just re-focuses
> rather than closing/committing an empty pin out from under the user.
> - **Edit + move placed pins.** With the pin tool active: **click the note label** (I-beam
> cursor) or **double-click the marker** opens the editor seeded with the current text; **drag
> the marker** moves the pin; **right-click** erases. Marker/label carry the `map-handle` name
> so the stage's tool handler skips placing a fresh pin when one is grabbed (same pattern as
> wall/light handles); `pin-marker`/`pin-label` names let `PinNode` tell a marker-grab (start a
> move, vetoed by `onDragStart.stopDrag` if it began on the label) from a label-click (edit).
> - **`UPDATE_ANNOTATION` now carries `text?` and/or `x?/y?`** (was text-only in the 7i plan) —
> server handler in `partykit/server.ts` (DM/author-gated, 200-char cap, finite-number guards)
> + the `applySceneMessage` mirror in `src/lib/sceneMessages.ts`, so pin edits/moves are
> **undoable for free** (the DM history builder inverts any scene-shape message to an
> `UPDATE_SCENE` restore) and staged-editor safe. Covered by new `unit-scene-editor` checks
> (edit-in-place, move-leaves-text, 200 cap, missing-id no-op).
> - **Vector glyph replaces the emoji (**`PinMarker`**).** A drawn teardrop (`PIN_PATH`) whose
> **tip is at local (0,0)** so it points exactly at the drop point (the emoji couldn't be
> pixel-anchored); shared by the placement preview and the committed pin. Sized `PIN_SCALE`
> (1.4×) by scaling its Group from the origin (tip stays put). Hover **brightens + glows** the
> marker and highlights the label border; cursor is a text I-beam over the note, a move cursor
> over the draggable marker.
> - **Pins render in their own top layer (**`MapCanvas.tsx`**).** Split out of the
> grid+annotations layer (below tokens) into a dedicated Konva `Layer` **after**
> `WallsLightsEditor`/`DoorLayer`, so pins sit **above tokens, walls, lights, fog, and doors**
> and the DM's markers are never hidden.
> - **Files:** `src/map/tools/pin.tsx`, `src/components/MapCanvas.tsx`, `src/index.css`,
> `src/lib/{types,sceneMessages}.ts`, `partykit/server.ts`, `tests/unit-scene-editor.test.ts`.

> **Map-interaction QoL round (2026-07-07, `revamp` branch — user feedback; `tsc -p` clean,
> no server/protocol changes):** hover/drag affordances across the board plus a big upgrade to
> grid calibration. All client-side; grid edits still ride the existing `UPDATE_SCENE`.
> - **Pins are grabbable/editable in select (V) mode, not just the pin tool.** A
> `pinsInteractive = activeTool.id === "pin" || (isDm && activeTool.id === "select")` flag
> (`MapCanvas.tsx`) now gates the pin `Layer`'s `listening`, the `onEdit`/`onMove` handlers on each
> `PinNode`, and the `PinNoteEditor` popover — so the DM can drag/edit/right-click-erase existing
> pins during play without switching tools. Select mode still can't *drop* a fresh pin (that stays
> the pin tool's job). Pins are DM-only, so it's gated on `isDm`.
> - **Wall hover cursor (walls tool).** `WallNode` (`MapVision.tsx`) now swaps the stage cursor on
> hover instead of leaving the tool crosshair over a grabbable wall — `move` over the draggable
> body, `grab` over an endpoint handle, cleared back to the crosshair on leave (mirrors the existing
> light-marker/ring cursor pattern).
> - **Door hover highlight + cursor (select mode).** `DoorLayer` was split into a per-door
> `DoorGlyph` with its own hover state and a new `interactive` prop (passed as
> `activeTool.id === "select"`). Hovering a door in select mode brightens the glyph (bigger ring,
> brighter stroke, colored glow) and shows a `pointer` cursor, signaling it's clickable to toggle
> state. Click/right-click behavior is unchanged; feedback is off during wall/lights editing.
> - **Grid calibration is now direct-manipulation on the grid POINTS** (answers "let the DM
> move/resize the grid to match the map by dragging", then "make move+resize seamless — no switching
> buttons", then "let me hover a grid point and drag that to resize"). `CalibrateMode = "adjust" |
> "box"` on `ToolRuntime` (+ `runtime.viewportScale` for screen-consistent handles/thresholds); state
> + preview + hover-aware cursor in `MapCanvas`, two buttons in `MapToolbar`. Used mainly on the
> Scenes page but available wherever the DM has the 🎯 tool; each gesture commits one `UPDATE_SCENE`
> on release (undoable + staged-editor safe via the Scenes-page history/draft path).
>   - **Adjust** (default, `calibrate.tsx`) — **every grid intersection is a resize handle.** The
>     tool's `onMove` runs even without a button, so hovering near a grid point (`nearestGridPoint`,
>     within ~16 screen px) pops up a circle handle there (a transient `{mode:"hover"}` draft; updated
>     only on change to avoid re-render churn). `onDown`: **near a point → resize; anywhere else →
>     move** (manual hit-test since `renderDraft` sits in a `listening=false` layer).
>     - *Resize* (`resizeGeom`): the pinned corner is the grid point one **original** cell (`g0`) away
>       diagonally, on the side OPPOSITE the drag (`sx,sy` from the drag sign) — so pulling the point
>       out grows the cell with **no collapse** (the point starts a full cell from its pivot). Size =
>       dominant-axis distance from the pivot to the cursor; on commit `gridSize = size`,
>       `offset = mod(pivot, size)` so that pivot stays a grid corner (grid resizes in place).
>     - *Move* slides `gridOffsetX/Y` by the drag delta (a <1px drag is treated as a click, no-op).
>     - Overlays are **screen-constant** (÷ `scale`): a pop-up handle on hover; on resize, the pinned
>       corner dot + the dragged handle + the sized cell + a px readout. `onLeave` clears only a
>       resting hover handle (a mid-drag gesture survives a brief exit).
>   - **Box a cell** — drag a fresh square over one map cell → `gridSize` + offset from scratch
>     (kept for initial calibration; it's a different intent you don't rapidly switch to).
>   - **Live full-grid preview:** `MapCanvas.gridLines` reduces the active move/resize draft to effective
>     `previewGridSize`/`previewOffsetX/Y` scalars (memo recomputes only when the grid actually changes,
>     not on every unrelated tool draft or hover tick) and renders the *whole* grid at the pending
>     values — forced visible even if Show grid is off, so there's something to align to.
> - **Files:** `src/map/tools/{types,calibrate}.tsx`,
> `src/components/{MapCanvas,MapVision,MapToolbar,SceneSettings}.tsx`.

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
textures small + tileable (CSS `background-image`, cheap), **no proliferation of**
`backdrop-filter`**/large** `filter`**/heavy shadows** (the classic weak-GPU killers; we
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
- **Sync = events, not streaming:** `GameState.sound.ambient {clipId, volume, loop, startedAtServerMs} | null` (late joiners resync by offset) + transient S→C `SOUND_ONESHOT` for
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
- **New synced data** → the recipe is fixed: add field to `GameState`, extend `normalize`*
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


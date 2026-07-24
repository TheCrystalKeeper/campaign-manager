# Hover Tooltips

Styled, instant hover tooltips for every button and control in the app, replacing the browser's
slow, unstyled native `title` bubbles with parchment-themed ones that match the "Quill & Ember"
skin. Controlled by the **Settings → This device → "Hover tooltips"** toggle (default **on**).

## Why

The app has ~330 `title=` hover hints across ~58 files — every icon-only button on the left
map-toolbar rail and right dock rail, the dice tray, window chrome, editors, and the character
sheet. Native tooltips take ~1s to appear, can't be styled, and clash with the theme. Rather than
wrapping hundreds of buttons in a `<Tooltip>` component (huge diff, drift risk, misses future
buttons), one global layer upgrades them all at once.

## Architecture

**`src/components/TooltipLayer.tsx`** — a single component mounted once in `src/main.tsx`
(beside `<App />`, so the lobby/join screen is covered too). It listens for `pointerover` on
`document`, resolves `event.target.closest("[title], [data-cm-title]")`, and renders one themed
bubble via `createPortal(..., document.body)`.

### The stash/restore contract (`data-cm-title`)

On hover of a titled element, the layer **stashes** the element's `title` into `data-cm-title`
and removes `title` — so the native browser bubble can never appear on top of ours. On pointer
leave, the stash is restored to `title`. The `data-cm-title` attribute is owned exclusively by
TooltipLayer; nothing else may read or write it.

- React never re-adds a removed `title` on unrelated re-renders (it diffs against its own vdom,
  not the DOM). When the title *value* genuinely changes mid-hover (e.g. "Snap to grid: on" →
  "off" after a click), a per-anchor `MutationObserver` re-stashes and live-updates the bubble.
- If the hovered node is unmounted mid-hover (`isConnected` false), the restore is skipped — the
  replacement node carries its own fresh `title`.
- On unmount and whenever the setting is turned off, a sweep restores every `[data-cm-title]`
  in the document, so no stash can leak.

### Behavior

- **300ms show delay**, with a **500ms grace window** after hiding: sliding along a rail re-shows
  instantly, like native OS toolbars.
- Hides on click (`pointerdown`), Esc, scroll, resize, window blur, and drag start. After a
  click, releasing the pointer over the same control re-arms the delay and re-reads the title —
  so toggles show their *new* text.
- Touch pointers are ignored (`pointerType === "touch"`); mid-drag hovers are ignored
  (`event.buttons !== 0`).
- Pointer events (not mouse events) are used deliberately: browsers fire them on `disabled`
  form controls, so disabled buttons still explain themselves.
- The bubble is `pointer-events: none` at `z-index: 10000` — above floating windows (whose
  z-indexes climb dynamically from 40) and the drag ghost (1000).

### Content

Each bubble shows, top to bottom:

1. **Label** — the element's `title` text, read at hover time (so dynamic titles stay live).
2. **Keybind chip** — if the title ends in a parenthesized chord like `"Measure (M)"` or
   `"Undo (Ctrl+Z)"`, it is split out and rendered as a small mono key chip. The capture is
   validated against `formatBinding` output shapes (`src/lib/keybinds.ts`): optional
   `Ctrl/Alt/Shift/⌘/⌥/⇧` modifiers joined by `+`, ending in a single character, arrow glyph,
   F-key, or named key (Space, Enter, …). Anything else — `"Log (popped out)"`,
   `"(This device only.)"` — renders verbatim with no chip. Because titles are read live and the
   toolbar builds them from the user's keybind settings, **rebinding a key updates the chip
   automatically**.
3. **Description** — an optional second, muted line from the `data-tip-desc` attribute.

### Attribute contract for future components

| Attribute | Where | Effect |
|---|---|---|
| `title="…"` | any element | Gets a styled tooltip automatically. Nothing else to do. |
| `data-tip-desc="…"` | the titled element | Adds a muted description line under the label. |
| `data-tip-side="top\|bottom\|left\|right"` | the element **or any ancestor** (e.g. a rail container) | Preferred bubble side; flips automatically at viewport edges. The dock rail sets `left`, the map-toolbar rail sets `right`. |
| `data-no-tip` | any ancestor | Opts a subtree out of styled tooltips entirely (native titles untouched). |

## Setting

**`src/lib/hoverTooltips.ts`** — mirrors `src/lib/visualEffects.ts`: a per-device flag in
`localStorage` under `cm-hover-tooltips` (`"1"`/`"0"`, absent = on), with a `useHoverTooltips()`
hook backing the Settings toggle and a subscribe channel the layer uses to tear down instantly
when toggled off. Deliberately **not** campaign-scoped and **not** on `PanelContext`: it's a
device-level input affordance (and the lobby, which has tooltips too, has no room to scope by).

**Toggle off = native tooltips.** The layer goes inert and every `title` attribute is left (or
restored) untouched, so the browser's plain tooltip takes over — no information is lost.

## Theming

The bubble (`.cm-tip`, end of `src/index.css`) is built entirely from theme tokens — parchment
surface + paper grain, 1.5px ink border, hand-cut wobble radius, `--elev-2` shadow, body font at
0.78rem — so night mode, accent skins, `data-fx="lite"` (drops the paper texture), and
`prefers-reduced-motion` (drops the 120ms fade) all work with no extra code. No caret arrow: a
CSS triangle can't cleanly cross the wobble-radius ink border, and the in-app precedent
(`.chart-tooltip`) has none.

## Deferred (phase 2 ideas)

- **Keyboard-focus tooltips** (`focusin`/`focusout`): native `title` never showed on focus
  either, so there's no regression today.
- **`aria-label` mirroring**: when stashing the title of an element with no accessible name,
  mirror it into `aria-label`. (Stashing is mouse-hover-scoped and transient, so screen-reader
  traversal already sees intact titles.)
- **SVG caret arrow** drawn in the `--notch-*` hand-inked style, if a pointer ever feels needed.
- **Rich examples** in `data-tip-desc` for complex tools (fog shapes, wall types).

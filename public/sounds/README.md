# Sound effects

Drop .mp3 files here and the app uses them automatically — every sound is optional.
Anything missing falls back to the synthesized placeholder (dice/coin) or stays silent
(tokens, throw whoosh). No code changes needed; the paths below are wired up already.

| File | Plays when |
|---|---|
| `dice/impact-1.mp3`, `dice/impact-2.mp3` | a die hits the table — **soft** landing (variants) |
| `dice/impact-3.mp3`, `dice/impact-4.mp3` | a die hits the table — **hard** landing (variants) |
| `dice/shake-1.mp3` … `dice/shake-3.mp3` | held dice shaken in the hand — one click per direction flip (variants) |
| `dice/throw.mp3` | a 3D throw is released (whoosh) |
| `coin/flip.mp3` | a coin leaves the hand (airborne flip + shimmer) |
| `coin/drop-1.mp3` … `coin/drop-3.mp3` | a coin lands (variants) |
| `tokens/pickup-1.mp3`, `tokens/pickup-2.mp3` | picking up a map token (variants) |
| `tokens/place-1.mp3`, `tokens/place-2.mp3` | placing a map token down (variants) |
| `dice-roll.mp3` | a text (non-3D) roll |

Variants are picked at random with pitch jitter, never the same one twice in a row —
with only `-1` present, that file simply covers every play. The full sound plan (UI
clicks, initiative fanfare, die-on-die clacks) lives in `SOUND_DESIGN.md`; candidate
downloads are tracked in `SOUND_EFFECTS.md`.

Format: MP3, mono, 96–128 kbps, tightly trimmed (leading silence reads as lag). Keep the
whole folder to ~1–2 MB — these ship in the app bundle, not R2. Normalize levels on
import (e.g. Audacity); relative loudness between categories is applied in code.

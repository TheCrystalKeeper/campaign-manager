import type { DiceTrack } from "./diceProtocol";

/** How long settled dice linger on screen before fading out. */
export const DICE_ROLL_LINGER_MS = 5000;

/** Duration of the dice fade-out animation. */
export const DICE_FADE_MS = 720;

/** Custom crystal die number reveal after landing. */
export const DICE_REVEAL_FADE_MS = 420;

/** Buffer after track ends before the roll log entry appears. */
export const DICE_LOG_SETTLE_BUFFER_MS = 300;

export function trackDurationMs(track: DiceTrack | null | undefined): number {
  if (!track || track.fps <= 0) {
    return 0;
  }
  return Math.min((track.frames / track.fps) * 1000, 12000);
}

/** Delay from DICE_THROW until the roll log entry is published. */
export function diceLogDelayMs(trackDurationMs: number): number {
  return trackDurationMs + DICE_LOG_SETTLE_BUFFER_MS;
}

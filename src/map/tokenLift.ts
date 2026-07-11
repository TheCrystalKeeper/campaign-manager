import type Konva from "konva";

/// <summary>
/// The "pick a miniature up off the table" animation, as plain state + pure functions so it can
/// be driven by an imperative requestAnimationFrame loop with zero React re-renders (see the perf
/// notes in PERFORMANCE_PLAN.md — drag frames must never touch React state). Two critically-damped
/// springs run per token: a LIFT spring (0 = on the table, 1 = raised) that scales the token up and
/// separates a ground shadow beneath it, and a TILT spring that leans the token like a pendulum in
/// response to how fast it's being dragged. Both under-damp slightly so a pick-up "pops" and a drop
/// "settles" with a small bounce rather than snapping. The same driver powers remotely-streamed
/// drags (Feature B), fed by the interpolated position instead of a local pointer.
/// </summary>

export const LIFT = {
  /** Token grows this fraction at full lift (+7%). */
  SCALE: 0.07,
  /** Token drifts up-left by radius*RISE at full lift, faking height off the table. */
  RISE: 0.08,
  /** Ground shadow drifts down-right by radius*SHADOW_SHIFT at full lift (separates from the token). */
  SHADOW_SHIFT: 0.14,
  /** Ground shadow grows this fraction at full lift. */
  SHADOW_GROW: 0.1,
  /** Ground shadow opacity at full lift. */
  SHADOW_ALPHA: 0.35,
  /** Lift spring: stiffness (s^-2) and damping (s^-1). Ratio ~0.65 → gentle pop / settle bounce. */
  LIFT_STIFFNESS: 260,
  LIFT_DAMPING: 21,
  /** Tilt magnitude per unit of horizontal drag speed (degrees per world-px/s). */
  TILT_PER_VX: 0.012,
  /** Hard clamp on tilt so a fast fling can't spin the token (degrees). */
  MAX_TILT: 9,
  /** Tilt spring: stiffness (s^-2) and damping (s^-1). Ratio ~0.50 → a visible pendulum wobble. */
  TILT_STIFFNESS: 170,
  TILT_DAMPING: 13,
  /** Exponential-moving-average rate (s^-1) that smooths raw pointer velocity before it drives tilt. */
  VEL_SMOOTH: 12,
  /** Clamp dt so a stall / CPU-throttled frame can't blow the springs up. */
  DT_MAX: 1 / 30,
  /** Static values used when prefers-reduced-motion is set (a still affordance, no animation). */
  REDUCED_SCALE: 0.04,
  REDUCED_SHADOW_ALPHA: 0.25,
} as const;

export type TokenLiftState = {
  /** Lift amount, 0 = grounded, 1 = fully raised. Allowed slightly negative for a landing squash. */
  L: number;
  Ldot: number;
  /** Tilt in degrees (Konva rotation, +clockwise). */
  theta: number;
  thetaDot: number;
  /** Smoothed drag velocity in world px/s. */
  vx: number;
  vy: number;
  prevX: number;
  prevY: number;
  /** Target: true while held/dragging, false once dropped. */
  lifted: boolean;
};

export function createLiftState(): TokenLiftState {
  return { L: 0, Ldot: 0, theta: 0, thetaDot: 0, vx: 0, vy: 0, prevX: 0, prevY: 0, lifted: false };
}

/** One-shot read of the OS prefers-reduced-motion setting — checked at drag-start to decide whether
 *  the springs run, without adding a media-query listener per token. */
export function reducedMotionNow(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Begin a lift from the token's current world position (seeds velocity tracking so the first
 *  frame doesn't register a huge jump). */
export function beginLift(s: TokenLiftState, x: number, y: number): void {
  s.lifted = true;
  s.prevX = x;
  s.prevY = y;
  s.vx = 0;
  s.vy = 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Advance both springs by dt seconds given the token's current world position. */
export function stepLift(s: TokenLiftState, dt: number, x: number, y: number): void {
  const h = clamp(dt, 0, LIFT.DT_MAX);
  if (h <= 0) return;

  // Smooth the raw per-frame velocity so a single jittery sample doesn't jerk the tilt.
  const vxInst = (x - s.prevX) / h;
  const vyInst = (y - s.prevY) / h;
  const k = 1 - Math.exp(-LIFT.VEL_SMOOTH * h);
  s.vx += (vxInst - s.vx) * k;
  s.vy += (vyInst - s.vy) * k;
  s.prevX = x;
  s.prevY = y;

  // Lift spring toward 1 (held) or 0 (dropped) — semi-implicit Euler.
  const liftTarget = s.lifted ? 1 : 0;
  const aL = LIFT.LIFT_STIFFNESS * (liftTarget - s.L) - LIFT.LIFT_DAMPING * s.Ldot;
  s.Ldot += aL * h;
  s.L += s.Ldot * h;

  // Tilt spring: while held, lean opposite the horizontal drag (the body trails the pivot like a
  // pendulum); while dropped, return upright.
  const tiltTarget = s.lifted ? clamp(-s.vx * LIFT.TILT_PER_VX, -LIFT.MAX_TILT, LIFT.MAX_TILT) : 0;
  const aT = LIFT.TILT_STIFFNESS * (tiltTarget - s.theta) - LIFT.TILT_DAMPING * s.thetaDot;
  s.thetaDot += aT * h;
  s.theta += s.thetaDot * h;
}

/** Write the current spring state onto the token's inner (lift) group and its ground-shadow node. */
export function applyLift(
  s: TokenLiftState,
  liftGroup: Konva.Group,
  shadow: Konva.Node | null,
  radius: number,
): void {
  const Lc = clamp(s.L, -0.15, 1);
  const scale = 1 + LIFT.SCALE * Lc;
  liftGroup.scaleX(scale);
  liftGroup.scaleY(scale);
  liftGroup.rotation(s.theta);
  liftGroup.x(-radius * LIFT.RISE * Lc);
  liftGroup.y(-radius * LIFT.RISE * Lc);
  if (shadow) {
    const vis = Lc > 0.01;
    shadow.visible(vis);
    if (vis) {
      shadow.opacity(LIFT.SHADOW_ALPHA * Math.max(0, Lc));
      shadow.x(radius * LIFT.SHADOW_SHIFT * Lc);
      shadow.y(radius * LIFT.SHADOW_SHIFT * Lc);
      const sh = 1 + LIFT.SHADOW_GROW * Lc;
      shadow.scaleX(sh);
      shadow.scaleY(sh);
    }
  }
}

/** True once a dropped token has fully returned to rest, so the caller can stop its rAF loop. */
export function liftSettled(s: TokenLiftState): boolean {
  return (
    !s.lifted &&
    Math.abs(s.L) < 0.001 &&
    Math.abs(s.Ldot) < 0.01 &&
    Math.abs(s.theta) < 0.05 &&
    Math.abs(s.thetaDot) < 0.5
  );
}

/** Snap everything back to the grounded, upright, unscaled resting state. */
export function resetLift(s: TokenLiftState, liftGroup: Konva.Group | null, shadow: Konva.Node | null): void {
  s.L = 0;
  s.Ldot = 0;
  s.theta = 0;
  s.thetaDot = 0;
  s.vx = 0;
  s.vy = 0;
  if (liftGroup) {
    liftGroup.scaleX(1);
    liftGroup.scaleY(1);
    liftGroup.rotation(0);
    liftGroup.x(0);
    liftGroup.y(0);
  }
  if (shadow) shadow.visible(false);
}

/** Prefers-reduced-motion path: a still lifted pose (small scale + faint shadow), no springs. */
export function applyStaticLift(
  liftGroup: Konva.Group,
  shadow: Konva.Node | null,
  radius: number,
  lifted: boolean,
): void {
  if (lifted) {
    const scale = 1 + LIFT.REDUCED_SCALE;
    liftGroup.scaleX(scale);
    liftGroup.scaleY(scale);
    if (shadow) {
      shadow.visible(true);
      shadow.opacity(LIFT.REDUCED_SHADOW_ALPHA);
      shadow.x(radius * LIFT.SHADOW_SHIFT);
      shadow.y(radius * LIFT.SHADOW_SHIFT);
      shadow.scaleX(1 + LIFT.SHADOW_GROW);
      shadow.scaleY(1 + LIFT.SHADOW_GROW);
    }
  } else {
    liftGroup.scaleX(1);
    liftGroup.scaleY(1);
    if (shadow) shadow.visible(false);
  }
}

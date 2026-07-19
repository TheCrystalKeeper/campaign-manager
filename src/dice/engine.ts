import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  addRevealDecal,
  buildDieGeometry,
  buildDieMesh,
  dieMaterialOptions,
  hideDieNumbers,
  relabelD4Vertex,
  relabelDieFace,
  type DieGeometry,
} from "./geometry";
import { onSkinTextureLoaded } from "./skins";
import {
  quantize,
  type DiceImpact,
  type DiceTrack,
  type DieSpec,
  type DieThrowState,
  type Quat,
  type Vec3,
  type WorldPoint,
} from "../lib/dice3d";

/// <summary>
/// Three.js + Rapier dice engine, adapted from the debugged v1 core (git e23a632).
/// Display dice are plain meshes; the only physics runs in a hidden pre-simulation that
/// records the exact motion (a DiceTrack). Every client replays that track, so the
/// tumble/landing is identical everywhere, and the die's landing face is relabeled to
/// the server's value so it lands on its number with no post-settle rotation.
///
/// v2 changes: dice are **world-anchored but screen-sized** — each roll's THREE.Group
/// sits at the throw's map/world trayCenter (so every client sees the tumble at the same
/// board spot and dice stay put while panning), while the group's scale is re-derived
/// from this client's live zoom so a die always renders at a constant pixel size. The
/// camera is driven purely by this client's live viewport. The v1 pane clipping and
/// per-client zoom-cancel scale are gone (full-window canvas under the dock).
/// </summary>

const DIE_SCALE = 0.95; // physics radius of a die (physics units)
/** On-screen die diameter in CSS px — constant regardless of map zoom. */
export const DIE_SCREEN_PX = 77;
// Fallback window margin when no safe-area provider is wired.
const EDGE_MARGIN_PX = 24;
/** Every wall keeps at least this distance from the anchor (degenerate-box floor). */
const MIN_WALL_DIST = DIE_SCALE + 1;
/** A die's diameter in physics units (radius 1 geometry × DIE_SCALE mesh scale). */
const DIE_WIDTH_UNITS = 2 * DIE_SCALE;
// Multi-die grabs: dice within KEEP keep their relative offset from the cursor; dice
// farther away glide to a compact ring right next to the grabbed die.
const GATHER_KEEP_DIST = 3.2;
const GATHER_RING_R = 2.4;
const CAMERA_HEIGHT = 2000;
const CAMERA_FAR = 4000;
// The dice camera is orthographic top-down, so a coin rising in world-Y is invisible. To
// sell the flip we fake depth during playback with a smooth 0→1→0 arc over the airborne
// time: grow the coin toward the camera and lift it up-screen, both peaking at the apex.
const COIN_ARC_MAX_BOOST = 0.8; // peak growth (apex ≈ 1.8×)
const COIN_ARC_LIFT = 1.5; // peak up-screen shift at the apex (physics units)
// Easing exponent for the grow/shrink arc. 2 = the physical parabola; higher exaggerates
// it (rise faster→slower, fall slower→faster) for a more dramatic, satisfying flip.
const COIN_ARC_EASE = 3;
const WALL_HEIGHT = 8;
const GRAVITY = -34;
const FIXED_DT = 1 / 60;
const SETTLE_LINVEL = 0.16;
const SETTLE_ANGVEL = 0.2;
const FADE_MS = 720;
const ROLL_LINGER_MS = 1800;
const REVEAL_FADE_MS = 420; // custom-die number fade-in once it lands

// Pre-simulation recording.
const TRACK_FPS = 30;
const PRESIM_MAX_STEPS = 600; // 10s at 60Hz
const PRESIM_SETTLE_STEPS = 18; // ~0.3s of rest before we stop recording

let rapierReady: Promise<void> | null = null;
function ensureRapier(): Promise<void> {
  if (!rapierReady) {
    rapierReady = RAPIER.init();
  }
  return rapierReady;
}

interface DieInstance {
  spec: DieSpec;
  geom: DieGeometry;
  mesh: THREE.Group;
  /** Flat [px,py,pz,qx,qy,qz,qw] per frame, set for track-playback dice. */
  samples?: number[];
  /** Number a blank custom die reveals once it lands (faded onto the up face). */
  revealLabel?: string;
  /** Coin only: peak-height frame (arc apex) and first floor-contact frame (arc end). */
  coinApexFrame?: number;
  coinLandFrame?: number;
}

type RollMode = "armed" | "thrown" | "track";

/**
 * The invisible walls containing one roll, in physics units relative to its anchor.
 * Derived from the roller's own window/safe area at throw time; the walls only exist in
 * the roller's pre-simulation, so the box is baked into the recorded track and never
 * needs to be shared.
 */
interface PhysBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface RollInstance {
  rollId: string;
  dice: DieInstance[];
  /** Wrapper at the roll's map/world trayCenter, scaled by the FROZEN k0. */
  group: THREE.Group;
  trayCenter: WorldPoint;
  box: PhysBox;
  /**
   * World units per physics unit, frozen when the roll was created (the roller's zoom
   * at throw time — shared via `worldScale` so every client places dice at the same
   * world footprint). Dice positions are map-glued through this; only each die's mesh
   * scale is compensated live for constant on-screen size.
   */
  k0: number;
  mode: RollMode;
  local: boolean;
  /** Whole roll is coins — the metallic-ring fallback for legacy tracks whose impacts carry
   * no die id, so a per-impact coin test isn't possible. Modern tracks use `coinIds`. */
  coin: boolean;
  /** Ids of the coins in this roll: an impact whose die is in here rings instead of clacks,
   * so a coin sounds like a coin even when thrown alongside dice. */
  coinIds: Set<string>;
  track: DiceTrack | null;
  trackStart: number | null;
  nextImpact: number;
  settled: boolean;
  revealStart: number | null;
  revealDecals: THREE.Mesh[];
  fadeStart: number | null;
  removeAt: number | null;
}

/** Screen-edge distances (CSS px) dice should stay clear of, e.g. dock/tray overlays. */
export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DiceEngineCallbacks {
  /**
   * Local throw released; send this recorded track to the server. `trayCenter` is the
   * final world anchor (the release point for drags), which every client centers on;
   * `worldScale` is the roll's frozen k0 so every client uses the same world footprint.
   */
  onRelease?: (
    rollId: string,
    track: DiceTrack,
    trayCenter: WorldPoint,
    worldScale: number,
  ) => void;
  /** The screen area dice must stay inside, sampled fresh at each throw. */
  getSafeInsets?: () => SafeInsets;
  /** A die-on-surface impact, strength ~ relative speed, for sound effects. `coin` is set
   * when the whole roll is coins, so audio can swap the clack for a metallic ring. */
  onImpact?: (strength: number, coin: boolean) => void;
  /** Held dice were shaken (the drag direction snapped roughly opposite) — one click of
   * dice knocking together in the hand. Local-only; intensity ~ speed, 0..1. */
  onShake?: (intensity: number) => void;
  /** A roll finished playing back its track. */
  onSettled?: (rollId: string) => void;
}

const SPIN_AXIS = new THREE.Vector3(1, 0.4, 0.2).normalize();

export class DiceEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  // Live map viewport (Konva): screen px = viewport.{x,y} + world * scale.
  private mapViewport = { x: 0, y: 0, scale: 1 };

  private rolls = new Map<string, RollInstance>();

  private envMap: THREE.Texture | null = null;
  private unsubscribeSkinTextures: (() => void) | null = null;

  private rafId: number | null = null;
  private disposed = false;

  private drag: {
    rollId: string;
    /** Per die: where it is relative to the cursor now, and where it is easing to. */
    offsets: Map<string, { cur: THREE.Vector3; target: THREE.Vector3 }>;
    samples: { t: number; x: number; z: number }[];
    lastClient: { x: number; y: number };
    /** Last established motion direction (unit), the reference a shake reverses against. */
    shakeDir: { x: number; z: number } | null;
  } | null = null;

  private callbacks: DiceEngineCallbacks;

  private constructor(container: HTMLElement, callbacks: DiceEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_FAR);
    this.camera.up.set(0, 0, -1);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 18, 4);
    this.scene.add(key);

    // Neutral studio environment so metal/glass skins pick up reflections. PMREM targets
    // are per-GL-context, so this engine and the tray scene each generate their own.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
    this.unsubscribeSkinTextures = onSkinTextureLoaded(() => this.requestRender());

    this.layout();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  /// <summary>Creates an engine once Rapier's WASM is ready.</summary>
  static async create(container: HTMLElement, callbacks: DiceEngineCallbacks = {}): Promise<DiceEngine> {
    await ensureRapier();
    return new DiceEngine(container, callbacks);
  }

  /// <summary>
  /// Updates this client's live map viewport. Dice are map-glued (their world positions
  /// never change after the throw — pan/zoom moves them 1:1 with the board); each die's
  /// mesh rescales around its own spot so it keeps a constant on-screen size at any zoom.
  /// </summary>
  setMapProjection(viewport: { x: number; y: number; scale: number }) {
    const scale = viewport.scale > 0 ? viewport.scale : 1;
    this.mapViewport = { x: viewport.x, y: viewport.y, scale };
    this.updateCamera();
    for (const roll of this.rolls.values()) {
      this.applyDieScales(roll);
    }
    this.requestRender();
  }

  /** World units per physics unit so a die renders DIE_SCREEN_PX wide at current zoom. */
  private worldK(): number {
    return DIE_SCREEN_PX / (DIE_WIDTH_UNITS * this.mapViewport.scale);
  }

  /** Compensates each die's mesh scale for the current zoom (constant screen size). */
  private applyDieScales(roll: RollInstance) {
    const s = DIE_SCALE * (this.worldK() / roll.k0);
    roll.dice.forEach((die) => {
      die.mesh.scale.setScalar(s);
    });
  }

  /** Window pixel → map/world coordinates through this client's viewport. */
  private screenToWorld(clientX: number, clientY: number): WorldPoint {
    const scale = this.mapViewport.scale > 0 ? this.mapViewport.scale : 1;
    return [(clientX - this.mapViewport.x) / scale, (clientY - this.mapViewport.y) / scale];
  }

  private layout() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(cw, ch, false);
    this.updateCamera();
    this.requestRender();
  }

  /// <summary>
  /// Aims the top-down orthographic camera so a map/world point (x,y) renders at the
  /// same window pixel Konva uses: screen = viewport.{x,y} + world * scale. The Three
  /// scene is in map/world units (X = world x, Z = world y).
  /// </summary>
  private updateCamera() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    const scale = this.mapViewport.scale;
    const halfW = cw / (2 * scale);
    const halfH = ch / (2 * scale);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    const camX = (cw / 2 - this.mapViewport.x) / scale;
    const camZ = (ch / 2 - this.mapViewport.y) / scale;
    this.camera.position.set(camX, CAMERA_HEIGHT, camZ);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(camX, 0, camZ);
    this.camera.near = 1;
    this.camera.far = CAMERA_FAR;
    this.camera.updateProjectionMatrix();
  }

  private handleVisibility = () => {
    if (document.hidden && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else if (!document.hidden) {
      this.requestRender();
    }
  };

  /// <summary>Maps a window pointer to a roll's physics-floor coords via its anchor + k0.</summary>
  private pointerToPhysics(
    clientX: number,
    clientY: number,
    trayCenter: WorldPoint,
    k0: number,
  ): { x: number; z: number } {
    const [worldX, worldY] = this.screenToWorld(clientX, clientY);
    return { x: (worldX - trayCenter[0]) / k0, z: (worldY - trayCenter[1]) / k0 };
  }

  /// <summary>
  /// The physics box for a roll anchored at `anchor`: this client's window minus the
  /// safe-area insets (dock/tray overlays plus an edge margin), converted to physics
  /// units. Dice are screen-size-constant, so px→physics is a fixed ratio regardless of
  /// zoom. Each wall keeps a minimum distance from the anchor so an edge release or a
  /// tiny window never produces a degenerate box.
  /// </summary>
  private computeBox(anchor: WorldPoint, k0: number): PhysBox {
    const insets = this.callbacks.getSafeInsets?.() ?? {
      top: EDGE_MARGIN_PX,
      right: EDGE_MARGIN_PX,
      bottom: EDGE_MARGIN_PX,
      left: EDGE_MARGIN_PX,
    };
    const scale = this.mapViewport.scale > 0 ? this.mapViewport.scale : 1;
    const pxPerUnit = k0 * scale;
    const ax = anchor[0] * scale + this.mapViewport.x; // anchor in window px
    const az = anchor[1] * scale + this.mapViewport.y;
    return {
      minX: Math.min((insets.left - ax) / pxPerUnit, -MIN_WALL_DIST),
      maxX: Math.max((window.innerWidth - insets.right - ax) / pxPerUnit, MIN_WALL_DIST),
      minZ: Math.min((insets.top - az) / pxPerUnit, -MIN_WALL_DIST),
      maxZ: Math.max((window.innerHeight - insets.bottom - az) / pxPerUnit, MIN_WALL_DIST),
    };
  }

  private areaClamp(box: PhysBox, x: number, z: number): { x: number; z: number } {
    const m = DIE_SCALE + 0.2;
    return {
      x: clamp(x, box.minX + m, box.maxX - m),
      z: clamp(z, box.minZ + m, box.maxZ - m),
    };
  }

  private createDie(spec: DieSpec): DieInstance {
    const geom = buildDieGeometry(spec.kind, spec.percentile);
    const mesh = buildDieMesh(geom, dieMaterialOptions(spec.kind, spec.percentile, spec.skin));
    mesh.scale.setScalar(DIE_SCALE);
    return { spec, geom, mesh };
  }

  /// <summary>Wraps a roll's dice in a group anchored at its world trayCenter, frozen at k0.</summary>
  private makeGroup(dice: DieInstance[], trayCenter: WorldPoint, k0: number): THREE.Group {
    const group = new THREE.Group();
    group.position.set(trayCenter[0], 0, trayCenter[1]);
    group.scale.setScalar(k0);
    dice.forEach((die) => group.add(die.mesh));
    this.scene.add(group);
    return group;
  }

  // ---- Arming + local pointer interaction ----

  /// <summary>Places a roll's dice at the throw anchor, ready to be grabbed or thrown.</summary>
  arm(rollId: string, specs: DieSpec[], trayCenter: WorldPoint) {
    this.clearRoll(rollId);
    const k0 = this.worldK();
    const box = this.computeBox(trayCenter, k0);
    const dice = specs.map((spec) => this.createDie(spec));
    const spread = DIE_SCALE * 2.4;
    const startX = -((dice.length - 1) * spread) / 2;
    dice.forEach((die, i) => {
      const pos = this.areaClamp(box, startX + i * spread, 0);
      die.mesh.position.set(pos.x, DIE_SCALE * 1.6, pos.z);
      die.mesh.quaternion.copy(randomQuat());
    });
    const group = this.makeGroup(dice, trayCenter, k0);
    this.rolls.set(rollId, this.newRoll(rollId, dice, "armed", true, group, trayCenter, box, k0));
    this.requestRender();
  }

  /// <summary>
  /// Starts a grab straight out of the dice tray: dice spawn at their tray screen
  /// positions/orientations (seamless lift) and immediately follow the cursor. The roll
  /// is anchored under the cursor and re-anchored to wherever the throw is released.
  /// </summary>
  beginTrayGrab(
    rollId: string,
    specs: DieSpec[],
    poses: { screen: [number, number]; quat: Quat }[],
    clientX: number,
    clientY: number,
  ) {
    this.clearRoll(rollId);
    const k0 = this.worldK();
    const trayCenter = this.screenToWorld(clientX, clientY);
    const dice = specs.map((spec) => this.createDie(spec));
    dice.forEach((die, i) => {
      const pose = poses[i];
      const p = pose
        ? this.pointerToPhysics(pose.screen[0], pose.screen[1], trayCenter, k0)
        : { x: 0, z: 0 };
      die.mesh.position.set(p.x, DIE_SCALE * 2.2, p.z);
      if (pose) {
        die.mesh.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
      } else {
        die.mesh.quaternion.copy(randomQuat());
      }
    });
    const group = this.makeGroup(dice, trayCenter, k0);
    this.rolls.set(
      rollId,
      this.newRoll(
        rollId,
        dice,
        "armed",
        true,
        group,
        trayCenter,
        this.computeBox(trayCenter, k0),
        k0,
      ),
    );
    this.beginDrag(rollId, clientX, clientY);
  }

  isArmed(rollId: string): boolean {
    return this.rolls.get(rollId)?.mode === "armed";
  }

  beginDrag(rollId: string, clientX: number, clientY: number) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.mode !== "armed") {
      return;
    }
    const world = this.pointerToPhysics(clientX, clientY, roll.trayCenter, roll.k0);
    // Dice near the cursor ride along at their current offset; dice farther than
    // GATHER_KEEP_DIST glide onto a compact ring around the grabbed one, so a scattered
    // multi-die pickup collects itself in your hand.
    const byDistance = roll.dice
      .map((d) => ({
        die: d,
        off: new THREE.Vector3(d.mesh.position.x - world.x, 0, d.mesh.position.z - world.z),
      }))
      .sort((a, b) => a.off.length() - b.off.length());
    const offsets = new Map<string, { cur: THREE.Vector3; target: THREE.Vector3 }>();
    let ringIndex = 0;
    byDistance.forEach((entry, i) => {
      let target: THREE.Vector3;
      if (i === 0 || entry.off.length() <= GATHER_KEEP_DIST) {
        target = entry.off.clone();
      } else {
        const ring = Math.floor(ringIndex / 6);
        const angle = ((ringIndex % 6) / 6) * Math.PI * 2 + 0.6;
        const r = GATHER_RING_R + ring * DIE_WIDTH_UNITS;
        target = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        ringIndex += 1;
      }
      offsets.set(entry.die.spec.id, { cur: entry.off.clone(), target });
    });
    this.drag = {
      rollId,
      offsets,
      samples: [{ t: performance.now(), x: world.x, z: world.z }],
      lastClient: { x: clientX, y: clientY },
      shakeDir: null,
    };
    this.requestRender();
  }

  moveDrag(clientX: number, clientY: number) {
    if (!this.drag) {
      return;
    }
    const roll = this.rolls.get(this.drag.rollId);
    if (!roll) {
      return;
    }
    const world = this.pointerToPhysics(clientX, clientY, roll.trayCenter, roll.k0);
    const now = performance.now();
    this.drag.samples.push({ t: now, x: world.x, z: world.z });
    if (this.drag.samples.length > 6) {
      this.drag.samples.shift();
    }
    this.drag.lastClient = { x: clientX, y: clientY };
    this.requestRender();
  }

  /// <summary>Animates held dice each frame: follow the cursor, ease gathered offsets in.</summary>
  private animateDrag(now: number) {
    if (!this.drag) {
      return;
    }
    const roll = this.rolls.get(this.drag.rollId);
    if (!roll) {
      return;
    }
    const world = this.pointerToPhysics(
      this.drag.lastClient.x,
      this.drag.lastClient.y,
      roll.trayCenter,
      roll.k0,
    );
    const wobble = Math.sin(now / 40) * 0.15;

    // Recent horizontal drag velocity (world units/s) — drives the coin's wobble tilt.
    // Only "fresh" (still moving) samples count; a paused cursor reads as zero so the coin
    // relaxes back to flat instead of holding a stale tilt.
    let dragVX = 0;
    let dragVZ = 0;
    const samples = this.drag.samples;
    if (samples.length >= 2) {
      const a = samples[samples.length - 2];
      const b = samples[samples.length - 1];
      if (now - b.t < 120) {
        const dt = Math.max((b.t - a.t) / 1000, 0.001);
        dragVX = (b.x - a.x) / dt;
        dragVZ = (b.z - a.z) / dt;
      }
    }
    const dragSpeed = Math.hypot(dragVX, dragVZ);

    // Shake detection: dice knock together in the hand when the motion *reverses*, so fire
    // one click per direction flip (dot < -0.2 vs the last established direction) — a fast
    // back-and-forth becomes a patter that paces itself off the gesture. Sustained same-ish
    // motion (dot > 0.4) refreshes the reference, so smooth drags and circular swirls stay
    // quiet. The speed gate keeps slow repositioning from ever triggering it.
    if (dragSpeed > 3) {
      const dirX = dragVX / dragSpeed;
      const dirZ = dragVZ / dragSpeed;
      const ref = this.drag.shakeDir;
      const dot = ref ? dirX * ref.x + dirZ * ref.z : 1;
      if (ref && dot < -0.2) {
        this.callbacks.onShake?.(Math.min(1, dragSpeed / 14));
        this.drag.shakeDir = { x: dirX, z: dirZ };
      } else if (!ref || dot > 0.4) {
        this.drag.shakeDir = { x: dirX, z: dirZ };
      }
    }

    roll.dice.forEach((d) => {
      const off = this.drag!.offsets.get(d.spec.id);
      if (!off) {
        return;
      }
      off.cur.lerp(off.target, 0.18);
      d.mesh.position.set(world.x + off.cur.x, DIE_SCALE * 2.2 + wobble, world.z + off.cur.z);
      if (d.spec.kind === "coin") {
        // A held coin stays FACE-FLAT (caps up/down) and wobbles — it never spins toward
        // upright, so it can't be released near-vertical and flip onto its edge. Target =
        // flat (current yaw preserved) + a small idle micro-wobble + a drag-driven tilt
        // whose axis is perpendicular to the motion (leading edge dips), clamped small so
        // it can never approach vertical. Slerp toward it for a smooth, lively feel.
        const yaw = new THREE.Euler().setFromQuaternion(d.mesh.quaternion, "YXZ").y;
        const target = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
        const idle = new THREE.Quaternion().setFromEuler(
          new THREE.Euler(Math.sin(now / 300) * 0.045, 0, Math.cos(now / 240) * 0.045, "XYZ"),
        );
        target.multiply(idle);
        if (dragSpeed > 1e-3) {
          const axis = new THREE.Vector3(dragVZ, 0, -dragVX).normalize();
          const tilt = new THREE.Quaternion().setFromAxisAngle(axis, Math.min(dragSpeed * 0.03, 0.28));
          target.premultiply(tilt); // tilt about a world-horizontal axis
        }
        d.mesh.quaternion.slerp(target, 0.25);
      } else {
        d.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(SPIN_AXIS, 0.06));
      }
    });
  }

  endDrag(clientX: number, clientY: number) {
    if (!this.drag) {
      return;
    }
    const roll = this.rolls.get(this.drag.rollId);
    const world = roll
      ? this.pointerToPhysics(clientX, clientY, roll.trayCenter, roll.k0)
      : { x: 0, z: 0 };
    this.drag.samples.push({ t: performance.now(), x: world.x, z: world.z });
    const vel = this.releaseVelocity(this.drag.samples);
    this.drag = null;
    if (!roll || roll.mode !== "armed") {
      return;
    }
    // Re-anchor the roll to the release point so the dice tumble and land where the
    // throw actually happened (the physics box is centered on the anchor).
    this.reanchor(roll, this.screenToWorld(clientX, clientY));
    this.release(roll, vel.vx, vel.vz);
  }

  /// <summary>
  /// Moves a roll's world anchor, keeping every die at the same world position (clamped
  /// into the box). The box is recomputed for the new anchor so it reflects the screen
  /// at the moment of the throw.
  /// </summary>
  private reanchor(roll: RollInstance, next: WorldPoint) {
    const dx = (roll.trayCenter[0] - next[0]) / roll.k0;
    const dz = (roll.trayCenter[1] - next[1]) / roll.k0;
    roll.box = this.computeBox(next, roll.k0);
    roll.dice.forEach((d) => {
      const p = this.areaClamp(roll.box, d.mesh.position.x + dx, d.mesh.position.z + dz);
      d.mesh.position.set(p.x, d.mesh.position.y, p.z);
    });
    roll.trayCenter = next;
    roll.group.position.set(next[0], 0, next[1]);
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  /// <summary>
  /// Aborts the active grab and removes its armed dice without throwing — the
  /// "drag it back into the tray to cancel" gesture. The dice simply vanish from
  /// the hand; the tray-selection restore is the caller's job.
  /// </summary>
  cancelActiveDrag() {
    if (!this.drag) {
      return;
    }
    const rollId = this.drag.rollId;
    this.drag = null;
    this.clearRoll(rollId);
    this.requestRender();
  }

  /// <summary>Throws the armed dice for the user without a drag gesture.</summary>
  autoThrow(rollId: string) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.mode !== "armed") {
      return;
    }
    const spread = DIE_SCALE * 2.4;
    const startX = -((roll.dice.length - 1) * spread) / 2;
    roll.dice.forEach((die, i) => {
      const pos = this.areaClamp(roll.box, startX + i * spread, 0);
      die.mesh.position.set(pos.x, DIE_SCALE * 2.6, pos.z);
    });
    const angle = Math.random() * Math.PI * 2;
    const speed = 6 + Math.random() * 2.5;
    this.release(roll, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  /// <summary>
  /// Pre-simulates the throw, records the exact track, and emits it. The walls are this
  /// roll's window-derived box, so the runway in the throw direction is the real screen
  /// space ahead of the release point.
  /// </summary>
  private release(roll: RollInstance, vx: number, vz: number) {
    const states = this.buildReleaseStates(roll, vx, vz);
    roll.mode = "thrown"; // freeze armed dice until the authoritative DICE_THROW arrives
    const track = this.presimulate(roll.dice.map((d) => d.spec), states, roll.box);
    this.callbacks.onRelease?.(roll.rollId, track, roll.trayCenter, roll.k0);
  }

  private buildReleaseStates(roll: RollInstance, vx: number, vz: number): DieThrowState[] {
    // Per-die launch: a coin is never thrown across the table — it's flicked straight up in
    // place (see coinFlipState) so its fake-depth arc reads as a real flip. A die is thrown
    // forward to tumble. Deciding per die (not once for the whole roll) means a coin thrown
    // alongside dice still flips properly instead of inheriting the die's flat forward toss,
    // whose near-instant, low apex is what made the coin's arc balloon and snap.
    const cap = 16;
    const cvx = clamp(vx, -cap, cap);
    const cvz = clamp(vz, -cap, cap);
    const speed = Math.hypot(cvx, cvz);
    // Natural forward tumble: spin about the horizontal axis perpendicular to travel
    // (topspin, ω = up × v̂), so friction rolls the die onward on touchdown. Fully
    // random spin gave half of all throws backspin, which brakes hard and kicks the
    // die *backwards* the moment it lands.
    const tumble = Math.min(5 + speed * 0.85, 24);
    const axisX = speed > 0.01 ? cvz / speed : 0;
    const axisZ = speed > 0.01 ? -cvx / speed : 0;
    return roll.dice.map((d) => {
      if (d.spec.kind === "coin") {
        return this.coinFlipState(d, vx, vz);
      }
      const p = d.mesh.position;
      const q = d.mesh.quaternion;
      const lin: Vec3 = [cvx + (Math.random() - 0.5) * 2, 1.5, cvz + (Math.random() - 0.5) * 2];
      const jitter = () => (Math.random() - 0.5) * 7;
      return {
        id: d.spec.id,
        p: [p.x, p.y, p.z] as Vec3,
        q: [q.x, q.y, q.z, q.w] as Quat,
        lin,
        ang: [axisX * tumble + jitter(), jitter(), axisZ * tumble + jitter()] as Vec3,
      };
    });
  }

  /// <summary>
  /// Coin flip launch for one coin. The flick's speed — measured by the same release-velocity
  /// sampling as a die throw — is reinterpreted: its MAGNITUDE drives the vertical pop and the
  /// end-over-end spin (harder flick → higher, spinnier), while horizontal travel is clamped
  /// near zero with a hair of forward bias, so the coin lands flat just ahead of the flick
  /// instead of sailing across the board. Spin is about the world X axis (toward/away from the
  /// viewer) so the H/T caps alternate up and the flip reads clearly. The coin's floaty hang
  /// time comes from a reduced gravity scale in presimulate().
  /// </summary>
  private coinFlipState(d: DieInstance, vx: number, vz: number): DieThrowState {
    const flick = Math.hypot(clamp(vx, -16, 16), clamp(vz, -16, 16));
    const pop = clamp(5 + flick * 0.45, 6, 9); // vertical launch — drives the grow/lift arc
    const spin = clamp(16 + flick * 1.4, 18, 40); // end-over-end rate scales with the flick
    const driftX = clamp(vx * 0.08, -0.8, 0.8); // barely any sideways travel
    const driftZ = clamp(vz * 0.1, -1.2, 0); // small forward-only nudge (up-screen is −z)
    const jitter = () => (Math.random() - 0.5) * 1.4; // a flip is clean — far less chaos than a die
    // A hair of always-on lateral drift + a touch of off-axis (yaw) spin so the coin is
    // essentially never launched to land perfectly balanced: a rim touchdown carries
    // sideways momentum and topples to a face. Kept small so it still reads as a clean
    // vertical flip, not a chaotic tumble.
    const nudge = () => (Math.random() - 0.5) * 1.1;
    const p = d.mesh.position;
    // Start the flip DEAD-FLAT (caps up/down), preserving only the held yaw. The held
    // coin merely wobbles near-flat (see animateDrag), but we still zero the tilt at
    // release so every end-over-end flip begins on a face and lands on a face — the
    // surest cure for edge landings. This is orientation only; the value is server-picked.
    const yaw = new THREE.Euler().setFromQuaternion(d.mesh.quaternion, "YXZ").y;
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
    return {
      id: d.spec.id,
      p: [p.x, p.y, p.z] as Vec3,
      q: [flat.x, flat.y, flat.z, flat.w] as Quat,
      lin: [driftX + nudge(), pop, driftZ + nudge()] as Vec3,
      ang: [spin + jitter(), jitter() * 1.6, jitter()] as Vec3,
    };
  }

  private releaseVelocity(samples: { t: number; x: number; z: number }[]): { vx: number; vz: number } {
    if (samples.length < 2) {
      return { vx: 0, vz: -5.5 };
    }
    const last = samples[samples.length - 1];
    const first = samples[0];
    const dt = Math.max((last.t - first.t) / 1000, 0.001);
    // 0.75 (was 0.9): damp the flick speed so hard drags don't rocket across the table.
    const vx = ((last.x - first.x) / dt) * 0.75;
    const vz = ((last.z - first.z) / dt) * 0.75;
    const speed = Math.hypot(vx, vz);
    if (speed < 0.8) {
      // A plain click (no fling): lob the dice "up" the screen, onto the board.
      return { vx: 0, vz: -5.5 };
    }
    if (speed < 4.5) {
      // Keep the gesture's direction but give it enough energy to tumble.
      const boost = 4.5 / speed;
      return { vx: vx * boost, vz: vz * boost };
    }
    return { vx, vz };
  }

  // ---- Hidden pre-simulation (records the exact motion track) ----

  private presimulate(specs: DieSpec[], states: DieThrowState[], box: PhysBox): DiceTrack {
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    const eventQueue = new RAPIER.EventQueue(true);

    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.5, 500)
        .setTranslation(0, -0.5, 0)
        .setRestitution(0.2)
        .setFriction(0.9),
      floorBody,
    );

    // Walls at the roll's window-derived box (asymmetric around the anchor). Dead
    // restitution: a wall contact should absorb the die, not ping-pong it back across
    // the table.
    const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const t = 0.5;
    const cx = (box.minX + box.maxX) / 2;
    const cz = (box.minZ + box.maxZ) / 2;
    const hw = (box.maxX - box.minX) / 2;
    const hh = (box.maxZ - box.minZ) / 2;
    const wall = (hx: number, hy: number, hz: number, x: number, z: number) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, WALL_HEIGHT, z).setRestitution(0.18),
        wallBody,
      );
    wall(t, WALL_HEIGHT, hh + 2 * t, cx - hw - t, cz);
    wall(t, WALL_HEIGHT, hh + 2 * t, cx + hw + t, cz);
    wall(hw + 2 * t, WALL_HEIGHT, t, cx, cz - hh - t);
    wall(hw + 2 * t, WALL_HEIGHT, t, cx, cz + hh + t);

    const bodies: RAPIER.RigidBody[] = [];
    const colliderToIndex = new Map<number, number>();
    states.forEach((s, idx) => {
      const spec = specs[idx];
      const geom = buildDieGeometry(spec.kind, spec.percentile);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          // Higher linear damping bleeds off the glide so dice don't skate across the
          // table like they're on ice; angular barely rises so they still tumble.
          .setLinearDamping(0.45)
          .setAngularDamping(0.28)
          // A coin floats (weaker gravity) so a modest pop buys enough hang time for a
          // few visible end-over-end rotations and a gentle, flat landing.
          .setGravityScale(spec.kind === "coin" ? 0.5 : 1)
          .setTranslation(s.p[0], s.p[1], s.p[2])
          .setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }),
      );
      body.setLinvel({ x: s.lin[0], y: s.lin[1], z: s.lin[2] }, true);
      body.setAngvel({ x: s.ang[0], y: s.ang[1], z: s.ang[2] }, true);

      const scaled = new Float32Array(geom.points.length * 3);
      geom.points.forEach((p, i) => {
        scaled[i * 3] = p.x * DIE_SCALE;
        scaled[i * 3 + 1] = p.y * DIE_SCALE;
        scaled[i * 3 + 2] = p.z * DIE_SCALE;
      });
      const colliderDesc = (RAPIER.ColliderDesc.convexHull(scaled) ?? RAPIER.ColliderDesc.ball(DIE_SCALE))
        // A coin should land with a dead thud (no bounce) so the flip is one clean arc.
        .setRestitution(spec.kind === "coin" ? 0.02 : 0.3)
        // Lower friction on the coin (0.65 vs 0.9): a coin that touches down balanced on
        // its narrow rim slips off to a flat face instead of gripping and standing on edge.
        // Still high enough that a flat coin doesn't skate across the felt.
        .setFriction(spec.kind === "coin" ? 0.65 : 0.9)
        .setDensity(1.2)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const collider = world.createCollider(colliderDesc, body);
      colliderToIndex.set(collider.handle, idx);
      bodies.push(body);
    });

    const recordEvery = Math.max(1, Math.round(1 / FIXED_DT / TRACK_FPS));
    const frames = states.map((s) => ({ id: s.id, samples: [] as number[] }));
    const impacts: DiceImpact[] = [];
    let recorded = 0;
    let restCount = 0;

    for (let step = 0; step < PRESIM_MAX_STEPS; step += 1) {
      world.step(eventQueue);
      eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const idx = colliderToIndex.get(h1) ?? colliderToIndex.get(h2);
        if (idx === undefined) return;
        const v = bodies[idx].linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > 0.8) {
          impacts.push({
            frame: Math.floor(step / recordEvery),
            strength: Math.min(speed / 18, 1),
            die: specs[idx].id,
          });
        }
      });

      if (step % recordEvery === 0) {
        bodies.forEach((b, idx) => recordSample(frames[idx].samples, b));
        recorded += 1;
      }

      const allRest = bodies.every((b) => {
        const lv = b.linvel();
        const av = b.angvel();
        return Math.hypot(lv.x, lv.y, lv.z) < SETTLE_LINVEL && Math.hypot(av.x, av.y, av.z) < SETTLE_ANGVEL;
      });
      if (allRest) {
        restCount += 1;
        if (restCount > PRESIM_SETTLE_STEPS) break;
      } else {
        restCount = 0;
      }
    }

    // Append a final exact resting frame.
    bodies.forEach((b, idx) => recordSample(frames[idx].samples, b));
    recorded += 1;

    world.free();
    eventQueue.free();
    return { fps: TRACK_FPS, frames: recorded, dice: frames, impacts };
  }

  // ---- Authoritative playback (every client) ----

  /// <summary>
  /// Plays the recorded track for a throw and relabels each die's landing face to the
  /// server's value, so the die comes to rest already showing its number.
  /// </summary>
  playTrack(
    rollId: string,
    specs: DieSpec[],
    track: DiceTrack,
    faceValues: number[],
    local: boolean,
    blank: boolean,
    trayCenter: WorldPoint,
    worldScale?: number,
  ) {
    this.clearRoll(rollId);
    const k0 = worldScale && Number.isFinite(worldScale) && worldScale > 0
      ? worldScale
      : this.worldK();
    const byId = new Map(track.dice.map((d) => [d.id, d.samples]));
    const dice = specs.map((spec, i) => {
      const die = this.createDie(spec);
      die.samples = byId.get(spec.id) ?? [];
      if (spec.kind === "coin") {
        // Fake-depth arc timing. It peaks at the coin's real peak-height frame; the apex loop
        // also yields the coin's resting height (its final sample) for the landing test below.
        const samples = die.samples ?? [];
        const coinY = (fr: number) => samples[fr * 7 + 1];
        let apex = 0;
        let maxY = -Infinity;
        let lastFrame = 0;
        for (let fr = 0; fr * 7 + 1 < samples.length; fr += 1) {
          lastFrame = fr;
          const y = coinY(fr);
          if (y > maxY) {
            maxY = y;
            apex = fr;
          }
        }
        const restY = samples.length >= 7 ? coinY(lastFrame) : 0;
        // Landing = this coin's first floor contact after the apex: its first recorded impact
        // that (a) belongs to THIS coin — the roll's first impact, or a neighbour's, would be
        // some die landing while the floaty coin is still airborne, which collapses the fall
        // to one frame and snaps the coin back to size — and (b) catches the coin already near
        // the felt (bottom 30% of the flight), so a mid-descent clip against another falling
        // die, coin still high, isn't mistaken for touchdown (that would end the shrink early,
        // mid-air). Center-Y alone can't time first contact (a coin lands edge-on, center
        // still high, then flops flat), hence the impact. Fallbacks cover legacy tracks with
        // no die id (a lone coin — impacts[0] is its landing).
        const nearFloorY = restY + (maxY - restY) * 0.3;
        const landImpact =
          track.impacts.find(
            (im) => im.die === spec.id && im.frame > apex && coinY(im.frame) <= nearFloorY,
          ) ??
          track.impacts.find((im) => im.die === spec.id && im.frame > apex) ??
          track.impacts.find((im) => im.die === spec.id) ??
          track.impacts[0];
        const landFrame = landImpact ? landImpact.frame : track.frames - 1;
        die.coinApexFrame = Math.max(1, apex);
        die.coinLandFrame = Math.max(die.coinApexFrame + 1, landFrame);
      }
      if (blank) {
        // Secret roll on a non-DM client: render the die blank, no relabel/reveal ever.
        hideDieNumbers(die.mesh);
      } else if (spec.kind === "custom") {
        // Blank during the tumble; the value is revealed (faded in) once it lands.
        die.revealLabel = String(faceValues[i]);
      } else if (spec.kind === "d4") {
        // A d4 reads off its topmost *vertex*, not a face — find that vertex and relabel it.
        const upVertex = finalUpVertexIndex(die.geom, die.samples);
        this.relabelD4Landing(die, upVertex, faceValues[i]);
      } else {
        const upIndex = finalUpFaceIndex(die.geom, die.samples);
        this.relabelLanding(die, upIndex, faceValues[i]);
      }
      return die;
    });
    const group = this.makeGroup(dice, trayCenter, k0);
    const roll = this.newRoll(
      rollId,
      dice,
      "track",
      local,
      group,
      trayCenter,
      this.computeBox(trayCenter, k0),
      k0,
    );
    roll.track = track;
    roll.trackStart = performance.now();
    this.rolls.set(rollId, roll);
    this.applyDieScales(roll);
    this.applyTrackFrame(roll, 0);
    this.requestRender();
  }

  private relabelLanding(die: DieInstance, upIndex: number, value: number) {
    const faces = die.geom.faces;
    const vIndex = value - 1;
    if (vIndex < 0 || vIndex >= faces.length || upIndex === vIndex) {
      return; // physics already landed on the right face
    }
    // Swap labels so the landing face shows the server value and numbers stay unique.
    relabelDieFace(die.mesh, upIndex, faces[vIndex].label);
    relabelDieFace(die.mesh, vIndex, faces[upIndex].label);
  }

  /// <summary>
  /// Same idea as relabelLanding, but for a d4: the result is read off the topmost *vertex*
  /// (its value is printed on the 3 faces meeting there), so we swap the two vertices'
  /// values rather than two faces' labels.
  /// </summary>
  private relabelD4Landing(die: DieInstance, upVertexIndex: number, value: number) {
    const vertices = die.geom.d4?.vertices;
    if (!vertices) {
      return;
    }
    const targetIndex = value - 1;
    if (targetIndex < 0 || targetIndex >= vertices.length || upVertexIndex === targetIndex) {
      return; // physics already landed on the right vertex
    }
    const upLabel = vertices[upVertexIndex].label;
    const targetLabel = vertices[targetIndex].label;
    relabelD4Vertex(die.mesh, upVertexIndex, targetLabel);
    relabelD4Vertex(die.mesh, targetIndex, upLabel);
  }

  private applyTrackFrame(roll: RollInstance, f: number) {
    const last = (roll.track?.frames ?? 1) - 1;
    const i0 = Math.min(Math.max(Math.floor(f), 0), last);
    const i1 = Math.min(i0 + 1, last);
    const a = f - i0;
    roll.dice.forEach((die) => {
      const s = die.samples;
      if (!s || s.length < 7) return;
      const o0 = i0 * 7;
      const o1 = i1 * 7;
      die.mesh.position.set(
        s[o0] * (1 - a) + s[o1] * a,
        s[o0 + 1] * (1 - a) + s[o1 + 1] * a,
        s[o0 + 2] * (1 - a) + s[o1 + 2] * a,
      );
      qa.set(s[o0 + 3], s[o0 + 4], s[o0 + 5], s[o0 + 6]);
      qb.set(s[o1 + 3], s[o1 + 4], s[o1 + 5], s[o1 + 6]);
      die.mesh.quaternion.slerpQuaternions(qa, qb, a);
      if (die.coinApexFrame !== undefined && die.coinLandFrame !== undefined) {
        // Fake the flip's depth (0→1→0 over the airborne time), keyed to playback TIME not
        // center height, so the coin is back to normal the instant it hits the board. The
        // rise eases OUT (fast then slow — shooting up, then hanging at the apex) and the
        // fall eases IN (slow then fast — accelerating down), exaggerating a real coin's
        // parabola. Grow toward the camera + lift up-screen (camera up is world −Z).
        let arc: number;
        if (f <= 0) {
          arc = 0;
        } else if (f < die.coinApexFrame) {
          const u = f / die.coinApexFrame; // rising 0→1
          arc = 1 - Math.pow(1 - u, COIN_ARC_EASE);
        } else if (f < die.coinLandFrame) {
          const w = (f - die.coinApexFrame) / (die.coinLandFrame - die.coinApexFrame); // falling 0→1
          arc = 1 - Math.pow(w, COIN_ARC_EASE);
        } else {
          arc = 0;
        }
        die.mesh.scale.setScalar(DIE_SCALE * (this.worldK() / roll.k0) * (1 + arc * COIN_ARC_MAX_BOOST));
        die.mesh.position.z -= arc * COIN_ARC_LIFT;
      }
    });
  }

  private newRoll(
    rollId: string,
    dice: DieInstance[],
    mode: RollMode,
    local: boolean,
    group: THREE.Group,
    trayCenter: WorldPoint,
    box: PhysBox,
    k0: number,
  ): RollInstance {
    return {
      rollId,
      dice,
      group,
      trayCenter,
      box,
      k0,
      mode,
      local,
      coin: dice.length > 0 && dice.every((d) => d.spec.kind === "coin"),
      coinIds: new Set(dice.filter((d) => d.spec.kind === "coin").map((d) => d.spec.id)),
      track: null,
      trackStart: null,
      nextImpact: 0,
      settled: false,
      revealStart: null,
      revealDecals: [],
      fadeStart: null,
      removeAt: null,
    };
  }

  // ---- Render-on-demand loop ----

  private requestRender() {
    if (this.disposed) {
      return;
    }
    if (document.hidden) {
      this.renderOnce();
      return;
    }
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.frame);
    }
  }

  private renderOnce() {
    this.renderer.render(this.scene, this.camera);
  }

  private frame = (now: number) => {
    this.rafId = null;
    this.animateDrag(now);
    for (const roll of this.rolls.values()) {
      if (roll.mode === "track" && !roll.settled) {
        this.advanceTrack(roll, now);
      }
      if (roll.settled) {
        if (roll.fadeStart === null && roll.removeAt !== null && now >= roll.removeAt) {
          roll.fadeStart = now;
        }
        if (roll.fadeStart !== null) {
          this.advanceFade(roll, now);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (this.needsLoop(now)) {
      this.rafId = requestAnimationFrame(this.frame);
    }
  };

  /// <summary>Keeps the RAF alive while tracks or fade animations are active.</summary>
  private needsLoop(now: number): boolean {
    if (this.drag) {
      return true;
    }
    for (const roll of this.rolls.values()) {
      if (roll.mode === "track" && !roll.settled) return true;
      // Keep ticking through the post-roll linger and fade-out (removeAt can be in the future).
      if (roll.settled && roll.removeAt !== null) {
        if (roll.fadeStart === null || now - roll.fadeStart < FADE_MS) return true;
      }
    }
    return false;
  }

  private advanceTrack(roll: RollInstance, now: number) {
    const track = roll.track!;
    const last = track.frames - 1;
    const elapsed = (now - (roll.trackStart ?? now)) / 1000;
    let f = elapsed * track.fps;
    if (f > last) f = last;
    this.applyTrackFrame(roll, f);
    while (roll.nextImpact < track.impacts.length && track.impacts[roll.nextImpact].frame <= f) {
      const impact = track.impacts[roll.nextImpact];
      // Ring for a coin's own impact, clack for a die — decided per impact so a coin thrown
      // alongside dice still sounds like a coin. Legacy tracks (no die id) fall back to the
      // whole-roll flag.
      const isCoin = impact.die !== undefined ? roll.coinIds.has(impact.die) : roll.coin;
      this.callbacks.onImpact?.(impact.strength, isCoin);
      roll.nextImpact += 1;
    }
    if (f >= last) {
      this.finishTrack(roll, now);
    }
  }

  /// <summary>
  /// Handles the end of a track: custom dice fade their number onto the up face first,
  /// then the roll settles and starts its linger/fade-out.
  /// </summary>
  private finishTrack(roll: RollInstance, now: number) {
    const needsReveal = roll.dice.some((d) => d.revealLabel !== undefined);
    if (needsReveal && roll.revealStart === null) {
      roll.revealStart = now;
      roll.dice.forEach((die) => {
        if (die.revealLabel === undefined) return;
        const upIndex = finalUpFaceIndex(die.geom, die.samples ?? []);
        const decal = addRevealDecal(die.mesh, die.geom, upIndex, die.revealLabel);
        if (decal) {
          roll.revealDecals.push(decal);
        }
      });
    }
    if (roll.revealStart !== null) {
      const p = Math.min((now - roll.revealStart) / REVEAL_FADE_MS, 1);
      roll.revealDecals.forEach((d) => {
        (d.material as THREE.MeshBasicMaterial).opacity = p;
      });
      if (p < 1) {
        return; // keep fading the number in before settling
      }
    }
    roll.settled = true;
    roll.removeAt = now + ROLL_LINGER_MS;
    this.callbacks.onSettled?.(roll.rollId);
  }

  /// <summary>Fades a settled roll out smoothly (opacity 1 → 0) before removing it.</summary>
  private advanceFade(roll: RollInstance, now: number) {
    const t = Math.min((now - roll.fadeStart!) / FADE_MS, 1);
    const opacity = 1 - smoothstep(t);
    this.setRollOpacity(roll, opacity);
    if (t >= 1) {
      this.clearRoll(roll.rollId);
    }
  }

  /// <summary>Applies a uniform opacity to every mesh material in a roll (body + numbers).</summary>
  private setRollOpacity(roll: RollInstance, opacity: number) {
    roll.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.material) {
        return;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = true;
        // Skins that are translucent at rest (frosted glass) carry a baseOpacity;
        // multiplying keeps them from popping fully opaque when the fade starts.
        material.opacity = opacity * ((material.userData.baseOpacity as number | undefined) ?? 1);
        material.depthWrite = false;
        material.needsUpdate = true;
      }
    });
  }

  clearRoll(rollId: string) {
    const roll = this.rolls.get(rollId);
    if (!roll) return;
    roll.dice.forEach((die) => {
      disposeGroup(die.mesh);
    });
    this.scene.remove(roll.group);
    this.rolls.delete(rollId);
  }

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.handleVisibility);
    for (const rollId of [...this.rolls.keys()]) {
      this.clearRoll(rollId);
    }
    this.unsubscribeSkinTextures?.();
    this.envMap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const upVec = new THREE.Vector3(0, 1, 0);
const tmpNormal = new THREE.Vector3();

function recordSample(out: number[], body: RAPIER.RigidBody) {
  const t = body.translation();
  const r = body.rotation();
  out.push(
    quantize(t.x),
    quantize(t.y),
    quantize(t.z),
    quantize(r.x),
    quantize(r.y),
    quantize(r.z),
    quantize(r.w),
  );
}

/// <summary>Which face index points up at the track's final recorded frame.</summary>
function finalUpFaceIndex(geom: DieGeometry, samples: number[]): number {
  if (samples.length < 7) {
    return 0;
  }
  const o = samples.length - 7;
  qa.set(samples[o + 3], samples[o + 4], samples[o + 5], samples[o + 6]);
  let best = -Infinity;
  let index = 0;
  for (let i = 0; i < geom.faces.length; i += 1) {
    tmpNormal.copy(geom.faces[i].normal).applyQuaternion(qa);
    if (tmpNormal.dot(upVec) > best) {
      best = tmpNormal.dot(upVec);
      index = i;
    }
  }
  return index;
}

/// <summary>
/// Which vertex index points highest at the track's final recorded frame — a d4 rests on a
/// face (its normal pointing down) with the opposite corner pointing up, so the result is
/// read off the topmost vertex rather than a face normal.
/// </summary>
function finalUpVertexIndex(geom: DieGeometry, samples: number[]): number {
  const vertices = geom.d4?.vertices;
  if (!vertices || samples.length < 7) {
    return 0;
  }
  const o = samples.length - 7;
  qa.set(samples[o + 3], samples[o + 4], samples[o + 5], samples[o + 6]);
  let best = -Infinity;
  let index = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    tmpNormal.copy(vertices[i].position).normalize().applyQuaternion(qa);
    if (tmpNormal.dot(upVec) > best) {
      best = tmpNormal.dot(upVec);
      index = i;
    }
  }
  return index;
}

function randomQuat(): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(
    new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/// <summary>Smooth 0..1 easing used for graceful dice fade-outs.</summary>
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !mesh.userData?.sharedGeometry) {
      mesh.geometry.dispose();
    }
    if (mesh.material) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => m.dispose());
    }
  });
}

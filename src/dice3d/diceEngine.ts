import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  addRevealDecal,
  buildDieGeometry,
  buildDieMesh,
  relabelDieFace,
  type DieGeometry,
} from "./diceGeometry";
import {
  quantize,
  type DiceImpact,
  type DiceTrack,
  type DieSpec,
  type DieThrowState,
  type DieTransform,
  type Quat,
  type Vec3,
  type WorldPoint,
} from "./diceProtocol";
import { DICE_FADE_MS, DICE_REVEAL_FADE_MS, DICE_ROLL_LINGER_MS } from "./diceTiming";

/// Three.js + Rapier dice engine.
/// in a hidden pre-simulation that records the exact motion (a DiceTrack). Every client
/// replays that track, so the tumble/landing is identical everywhere, and the die's
/// landing face is relabeled to the server's value so it lands on its number with no
/// post-settle rotation.
///
/// Dice render in fixed screen space: a full-window orthographic camera centered on the
/// viewport, independent of map pan/zoom. The physics box is window-independent so the
/// recorded track stays deterministic. All compute is client-side.

/// Dice render in fixed screen space (viewport center), not map world coordinates.
/// Physics uses a fixed box so recorded tracks replay identically on every client.
const DIE_SCALE = 0.95; // physics radius of a die (physics units)
const SCREEN_SCALE = 64; // pixels per physics unit (die diameter ≈ 2 * DIE_SCALE * SCREEN_SCALE ≈ 122px)
/** Smallest viewport the shared play box is sized for (small laptop). */
const PLAY_AREA_MIN_WIDTH = 1280;
const PLAY_AREA_MIN_HEIGHT = 720;
const CAMERA_HEIGHT_UNITS = 30;
const CAMERA_FAR_UNITS = 60;
const TRAY_CENTER: WorldPoint = [0, 0];
const WALL_HEIGHT = 8;
const GRAVITY = -34;
const FIXED_DT = 1 / 60;
const SETTLE_LINVEL = 0.16;
const SETTLE_ANGVEL = 0.2;
const FADE_MS = DICE_FADE_MS;
const ROLL_LINGER_MS = DICE_ROLL_LINGER_MS;
const REVEAL_FADE_MS = DICE_REVEAL_FADE_MS;

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
  /** Target transform a remote-motion die eases toward (for smooth live shake). */
  targetPos?: THREE.Vector3;
  targetQuat?: THREE.Quaternion;
  /** Number a blank custom die reveals once it lands (faded onto the up face). */
  revealLabel?: string;
}

type RollMode = "armed" | "thrown" | "remote-motion" | "track";

interface RollInstance {
  rollId: string;
  dice: DieInstance[];
  /** Wrapper at viewport center, scaled by `k`; dice are children. */
  group: THREE.Group;
  /** Legacy tray anchor (always screen center; kept for roll state shape). */
  trayCenter: WorldPoint;
  mode: RollMode;
  local: boolean;
  track: DiceTrack | null;
  trackStart: number | null;
  nextImpact: number;
  settled: boolean;
  /** When the custom-die number reveal/fade-in started, or null. */
  revealStart: number | null;
  revealDecals: THREE.Mesh[];
  fadeStart: number | null;
  removeAt: number | null;
}

export interface DiceEngineCallbacks {
  /** Local drag/shake samples + roller cursor (normalized 0–1 screen coords in the arena). */
  onMotion?: (rollId: string, transforms: DieTransform[], cursor: WorldPoint) => void;
  /** Local throw released; send this recorded track to the server. */
  onRelease?: (rollId: string, track: DiceTrack) => void;
  /** A die-on-surface impact, strength ~ relative speed, for sound effects. */
  onImpact?: (strength: number) => void;
  /** A roll finished playing back its track. */
  onSettled?: (rollId: string) => void;
}

const MOTION_THROTTLE_MS = 33; // ~30 live drag/shake updates per second
const MOTION_SMOOTH_TAU = 0.05; // remote-motion easing time constant (seconds)
const MOTION_SNAP_EPS = 0.0004; // squared distance below which a die is "caught up"
const SPIN_AXIS = new THREE.Vector3(1, 0.4, 0.2).normalize();

export class DiceEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;

  // Full-window arena bounds in client px (for pointer + cursor sync).
  private area = { left: 0, top: 0, width: 1, height: 1 };
  // Pixels per physics unit; fixed so tracks look the same on every client.
  private k = SCREEN_SCALE;
  // Physics play-box half-extents; fit viewport and cap for small-screen sync.
  private areaHalfW = playHalfFromViewport(PLAY_AREA_MIN_WIDTH, SCREEN_SCALE);
  private areaHalfH = playHalfFromViewport(PLAY_AREA_MIN_HEIGHT, SCREEN_SCALE);

  private rolls = new Map<string, RollInstance>();
  private fadeWaiters = new Map<string, Array<() => void>>();

  private rafId: number | null = null;
  private lastFrameTime = 0;
  private disposed = false;

  private drag: {
    rollId: string;
    offsets: Map<string, THREE.Vector3>;
    samples: { t: number; x: number; z: number }[];
    lastMotionSent: number;
  } | null = null;

  private callbacks: DiceEngineCallbacks;

  private constructor(container: HTMLElement, callbacks: DiceEngineCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
    this.camera.up.set(0, 0, -1);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 18, 4);
    this.scene.add(key);

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

  refreshLayout() {
    this.layout();
  }

  private layout() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(cw, ch, false);

    const crect = this.container.getBoundingClientRect();
    this.area = { left: crect.left, top: crect.top, width: crect.width, height: crect.height };
    this.container.style.clipPath = "none";
    this.syncPlayAreaExtents();
    this.updateCamera();
    this.requestRender();
  }

  /// <summary>
  /// Sizes the physics walls/clamps so dice stay on screen. Capped to a laptop-sized box
  /// so recorded tracks fit every client; shrinks further on viewports smaller than that.
  /// </summary>
  private syncPlayAreaExtents() {
    const syncW = playHalfFromViewport(PLAY_AREA_MIN_WIDTH, this.k);
    const syncH = playHalfFromViewport(PLAY_AREA_MIN_HEIGHT, this.k);
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    const viewW = playHalfFromViewport(cw, this.k);
    const viewH = playHalfFromViewport(ch, this.k);
    this.areaHalfW = Math.min(syncW, viewW);
    this.areaHalfH = Math.min(syncH, viewH);
  }

  /// <summary>Top-down ortho camera in viewport pixel space, centered on the window.</summary>
  private updateCamera() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    const halfW = cw / 2;
    const halfH = ch / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    const camY = CAMERA_HEIGHT_UNITS * this.k;
    this.camera.position.set(0, camY, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = 1;
    this.camera.far = CAMERA_FAR_UNITS * this.k;
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

  /// <summary>Maps a window pointer to physics-floor coords relative to viewport center.</summary>
  private pointerToPhysics(clientX: number, clientY: number): { x: number; z: number } {
    const crect = this.container.getBoundingClientRect();
    const px = clientX - crect.left - crect.width / 2;
    const py = clientY - crect.top - crect.height / 2;
    return { x: px / this.k, z: py / this.k };
  }

  /// <summary>Roller cursor as normalized 0–1 coords within the full-window arena.</summary>
  private cursorScreenNorm(clientX: number, clientY: number): WorldPoint {
    const crect = this.container.getBoundingClientRect();
    return [
      clamp((clientX - crect.left) / crect.width, 0, 1),
      clamp((clientY - crect.top) / crect.height, 0, 1),
    ];
  }

  private areaClamp(x: number, z: number): { x: number; z: number } {
    const m = DIE_SCALE + 0.2;
    return {
      x: clamp(x, -this.areaHalfW + m, this.areaHalfW - m),
      z: clamp(z, -this.areaHalfH + m, this.areaHalfH - m),
    };
  }

  private createDie(spec: DieSpec): DieInstance {
    const geom = buildDieGeometry(spec.kind, spec.percentile);
    const mesh = buildDieMesh(geom, { color: spec.percentile ? "#2d4a7b" : "#7b2d3a" });
    mesh.scale.setScalar(DIE_SCALE);
    return { spec, geom, mesh };
  }

  /// <summary>Wraps a roll's dice in a tray group at viewport center.</summary>
  private makeGroup(dice: DieInstance[]): THREE.Group {
    const group = new THREE.Group();
    group.scale.setScalar(this.k);
    dice.forEach((die) => group.add(die.mesh));
    this.scene.add(group);
    return group;
  }

  // ---- Arming + local pointer interaction ----

  /// <summary>Places a roll's dice on the centered tray ready to be grabbed or thrown.</summary>
  arm(rollId: string, specs: DieSpec[], _trayCenter?: WorldPoint) {
    const trayCenter = TRAY_CENTER;
    this.clearRoll(rollId);
    const dice = specs.map((spec) => this.createDie(spec));
    const spread = DIE_SCALE * 2.4;
    const startX = -((dice.length - 1) * spread) / 2;
    dice.forEach((die, i) => {
      const pos = this.areaClamp(startX + i * spread, 0);
      die.mesh.position.set(pos.x, DIE_SCALE * 1.6, pos.z);
      die.mesh.quaternion.copy(randomQuat());
    });
    const group = this.makeGroup(dice);
    this.rolls.set(rollId, this.newRoll(rollId, dice, "armed", true, group, trayCenter));
    this.requestRender();
  }

  isArmed(rollId: string): boolean {
    return this.rolls.get(rollId)?.mode === "armed";
  }

  /// <summary>Whether a screen point lies over one of a roll's armed dice.</summary>
  hitTestArmed(rollId: string, clientX: number, clientY: number): boolean {
    const roll = this.rolls.get(rollId);
    if (!roll) {
      return false;
    }
    const crect = this.container.getBoundingClientRect();
    const cx = crect.left + crect.width / 2;
    const cy = crect.top + crect.height / 2;
    const grabRadius = DIE_SCALE * this.k * 1.7;
    return roll.dice.some((die) => {
      const screenX = cx + die.mesh.position.x * this.k;
      const screenY = cy + die.mesh.position.z * this.k;
      return Math.hypot(clientX - screenX, clientY - screenY) < grabRadius;
    });
  }

  beginDrag(rollId: string, clientX: number, clientY: number) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.mode !== "armed") {
      return;
    }
    const world = this.pointerToPhysics(clientX, clientY);
    const offsets = new Map<string, THREE.Vector3>();
    roll.dice.forEach((d) => {
      offsets.set(d.spec.id, new THREE.Vector3(d.mesh.position.x - world.x, 0, d.mesh.position.z - world.z));
    });
    this.drag = { rollId, offsets, samples: [{ t: performance.now(), x: world.x, z: world.z }], lastMotionSent: 0 };
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
    const world = this.pointerToPhysics(clientX, clientY);
    const now = performance.now();
    this.drag.samples.push({ t: now, x: world.x, z: world.z });
    if (this.drag.samples.length > 6) {
      this.drag.samples.shift();
    }
    const wobble = Math.sin(now / 40) * 0.15;
    roll.dice.forEach((d) => {
      const off = this.drag!.offsets.get(d.spec.id)!;
      const target = this.areaClamp(world.x + off.x, world.z + off.z);
      d.mesh.position.set(target.x, DIE_SCALE * 2.2 + wobble, target.z);
      d.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(SPIN_AXIS, 0.08));
    });

    if (now - this.drag.lastMotionSent > MOTION_THROTTLE_MS) {
      this.drag.lastMotionSent = now;
      this.callbacks.onMotion?.(this.drag.rollId, this.snapshotTransforms(roll), this.cursorScreenNorm(clientX, clientY));
    }
    this.requestRender();
  }

  endDrag(clientX: number, clientY: number) {
    if (!this.drag) {
      return;
    }
    const roll = this.rolls.get(this.drag.rollId);
    const world = this.pointerToPhysics(clientX, clientY);
    this.drag.samples.push({ t: performance.now(), x: world.x, z: world.z });
    const vel = this.releaseVelocity(this.drag.samples);
    this.drag = null;
    if (!roll || roll.mode !== "armed") {
      return;
    }
    this.release(roll, vel.vx, vel.vz);
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
      const pos = this.areaClamp(startX + i * spread, 0);
      die.mesh.position.set(pos.x, DIE_SCALE * 2.6, pos.z);
    });
    const angle = Math.random() * Math.PI * 2;
    const speed = 8 + Math.random() * 3.5;
    this.release(roll, Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  /// <summary>
  /// Resolves the armed dice with a quick, low-energy "spin to value": dice rest at the tray
  /// and give a short gentle tumble, so the pre-sim settles in a few frames and the landing
  /// face is relabeled to the server's value almost immediately (used for Instant rolls).
  /// </summary>
  quickThrow(rollId: string) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.mode !== "armed") {
      return;
    }
    const spread = DIE_SCALE * 2.4;
    const startX = -((roll.dice.length - 1) * spread) / 2;
    roll.dice.forEach((die, i) => {
      const pos = this.areaClamp(startX + i * spread, 0);
      die.mesh.position.set(pos.x, DIE_SCALE * 1.2, pos.z);
    });
    this.release(roll, 0, 0, true);
  }

  /// <summary>Pre-simulates the throw, records the exact track, and emits it.</summary>
  private release(roll: RollInstance, vx: number, vz: number, gentle = false) {
    const states = this.buildReleaseStates(roll, vx, vz, gentle);
    roll.mode = "thrown"; // freeze armed dice until the authoritative DICE_THROW arrives
    const track = this.presimulate(roll.dice.map((d) => d.spec), states);
    this.callbacks.onRelease?.(roll.rollId, track);
  }

  private buildReleaseStates(roll: RollInstance, vx: number, vz: number, gentle: boolean): DieThrowState[] {
    const cap = 26;
    const cvx = clamp(vx, -cap, cap);
    const cvz = clamp(vz, -cap, cap);
    return roll.dice.map((d) => {
      const p = d.mesh.position;
      const q = d.mesh.quaternion;
      // Gentle (Instant): barely any travel, a small spin so it visibly rotates to its value.
      const lin: Vec3 = gentle
        ? [(Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2]
        : [cvx + (Math.random() - 0.5) * 2, 1.5, cvz + (Math.random() - 0.5) * 2];
      const spin = gentle ? 16 : 22;
      return {
        id: d.spec.id,
        p: [p.x, p.y, p.z] as Vec3,
        q: [q.x, q.y, q.z, q.w] as Quat,
        lin,
        ang: [(Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin] as Vec3,
      };
    });
  }

  private releaseVelocity(samples: { t: number; x: number; z: number }[]): { vx: number; vz: number } {
    if (samples.length < 2) {
      return { vx: 0, vz: 8 };
    }
    const last = samples[samples.length - 1];
    const first = samples[0];
    const dt = Math.max((last.t - first.t) / 1000, 0.001);
    const vx = ((last.x - first.x) / dt) * 0.9;
    const vz = ((last.z - first.z) / dt) * 0.9;
    const speed = Math.hypot(vx, vz);
    if (speed < 6) {
      return { vx, vz: vz + 6 };
    }
    return { vx, vz };
  }

  // ---- Hidden pre-simulation (records the exact motion track) ----

  private presimulate(specs: DieSpec[], states: DieThrowState[]): DiceTrack {
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    const eventQueue = new RAPIER.EventQueue(true);

    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(500, 0.5, 500)
        .setTranslation(0, -0.5, 0)
        .setRestitution(0.25)
        .setFriction(0.8),
      floorBody,
    );

    const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    const t = 0.5;
    const hw = this.areaHalfW;
    const hh = this.areaHalfH;
    const wall = (hx: number, hy: number, hz: number, x: number, z: number) =>
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, WALL_HEIGHT, z).setRestitution(0.4),
        wallBody,
      );
    wall(t, WALL_HEIGHT, hh + 2 * t, -hw - t, 0);
    wall(t, WALL_HEIGHT, hh + 2 * t, hw + t, 0);
    wall(hw + 2 * t, WALL_HEIGHT, t, 0, -hh - t);
    wall(hw + 2 * t, WALL_HEIGHT, t, 0, hh + t);

    const bodies: RAPIER.RigidBody[] = [];
    const colliderToIndex = new Map<number, number>();
    states.forEach((s, idx) => {
      const spec = specs[idx];
      const geom = buildDieGeometry(spec.kind, spec.percentile);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setCcdEnabled(true)
          .setLinearDamping(0.2)
          .setAngularDamping(0.25)
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
        .setRestitution(0.35)
        .setFriction(0.85)
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
          impacts.push({ frame: Math.floor(step / recordEvery), strength: Math.min(speed / 18, 1) });
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
    trayCenter: WorldPoint,
  ) {
    this.clearRoll(rollId);
    const byId = new Map(track.dice.map((d) => [d.id, d.samples]));
    const dice = specs.map((spec, i) => {
      const die = this.createDie(spec);
      die.samples = byId.get(spec.id) ?? [];
      if (spec.kind === "custom") {
        // Blank during the tumble; the value is revealed (faded in) once it lands.
        die.revealLabel = String(faceValues[i]);
      } else {
        const upIndex = finalUpFaceIndex(die.geom, die.samples);
        this.relabelLanding(die, upIndex, faceValues[i]);
      }
      return die;
    });
    const group = this.makeGroup(dice);
    const roll = this.newRoll(rollId, dice, "track", local, group, trayCenter);
    roll.track = track;
    roll.trackStart = performance.now();
    this.rolls.set(rollId, roll);
    this.applyTrackFrame(roll, 0);
    this.requestRender();
  }

  /// <summary>Shows another player's live drag/shake before they release.</summary>
  applyRemoteMotion(rollId: string, specs: DieSpec[], transforms: DieTransform[], trayCenter: WorldPoint) {
    let roll = this.rolls.get(rollId);
    if (!roll) {
      const dice = specs.map((spec) => this.createDie(spec));
      const group = this.makeGroup(dice);
      roll = this.newRoll(rollId, dice, "remote-motion", false, group, trayCenter);
      this.rolls.set(rollId, roll);
    }
    if (roll.mode === "track") {
      return; // already thrown
    }
    const byId = new Map(transforms.map((t) => [t.id, t]));
    roll.dice.forEach((die) => {
      const t = byId.get(die.spec.id);
      if (!t) return;
      // Record the target; the frame loop eases the mesh toward it for a smooth shake.
      // The very first sample snaps so a die doesn't glide in from the origin.
      const first = !die.targetPos;
      die.targetPos = (die.targetPos ?? new THREE.Vector3()).set(t.p[0], t.p[1], t.p[2]);
      die.targetQuat = (die.targetQuat ?? new THREE.Quaternion()).set(t.q[0], t.q[1], t.q[2], t.q[3]);
      if (first) {
        die.mesh.position.copy(die.targetPos);
        die.mesh.quaternion.copy(die.targetQuat);
      }
    });
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
    });
  }

  private snapshotTransforms(roll: RollInstance): DieTransform[] {
    return roll.dice.map((die) => {
      const p = die.mesh.position;
      const q = die.mesh.quaternion;
      return { id: die.spec.id, p: [p.x, p.y, p.z] as Vec3, q: [q.x, q.y, q.z, q.w] as Quat };
    });
  }

  private newRoll(
    rollId: string,
    dice: DieInstance[],
    mode: RollMode,
    local: boolean,
    group: THREE.Group,
    trayCenter: WorldPoint,
  ): RollInstance {
    return {
      rollId,
      dice,
      group,
      trayCenter,
      mode,
      local,
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
    const dt = this.lastFrameTime ? Math.min((now - this.lastFrameTime) / 1000, 0.05) : FIXED_DT;
    this.lastFrameTime = now;
    for (const roll of this.rolls.values()) {
      if (roll.mode === "track" && !roll.settled) {
        this.advanceTrack(roll, now);
      } else if (roll.mode === "remote-motion") {
        this.advanceRemoteMotion(roll, dt);
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
    } else {
      this.lastFrameTime = 0;
    }
  };

  /// <summary>Eases remote-motion dice toward their latest target for a smooth shake.</summary>
  private advanceRemoteMotion(roll: RollInstance, dt: number) {
    const alpha = 1 - Math.exp(-dt / MOTION_SMOOTH_TAU);
    roll.dice.forEach((die) => {
      if (!die.targetPos || !die.targetQuat) return;
      die.mesh.position.lerp(die.targetPos, alpha);
      die.mesh.quaternion.slerp(die.targetQuat, alpha);
    });
  }

  /// <summary>
  /// Keeps the RAF alive while tracks, remote smoothing, or fade animations are active.
  /// </summary>
  private needsLoop(now: number): boolean {
    for (const roll of this.rolls.values()) {
      if (roll.mode === "track" && !roll.settled) return true;
      if (roll.fadeStart !== null && now - roll.fadeStart < FADE_MS) return true;
      if (roll.mode === "remote-motion") {
        for (const die of roll.dice) {
          if (!die.targetPos || !die.targetQuat) continue;
          if (
            die.mesh.position.distanceToSquared(die.targetPos) > MOTION_SNAP_EPS ||
            die.mesh.quaternion.angleTo(die.targetQuat) > 0.01
          ) {
            return true;
          }
        }
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
      this.callbacks.onImpact?.(track.impacts[roll.nextImpact].strength);
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
    this.callbacks.onSettled?.(roll.rollId);
  }

  /// <summary>
  /// Fades a settled roll out smoothly (body + number decals) before removing it.
  /// </summary>
  private advanceFade(roll: RollInstance, now: number) {
    const t = Math.min((now - roll.fadeStart!) / FADE_MS, 1);
    const eased = smoothstep(t);
    const opacity = 1 - eased;
    const numberOpacity = Math.min(1, Math.pow(opacity, 0.75));
    roll.group.scale.setScalar(this.k * (1 - 0.08 * eased));
    roll.group.position.y = -0.28 * this.k * eased;
    roll.dice.forEach((die) => {
      die.mesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) {
          const mat = mesh.material as THREE.Material & {
            opacity: number;
            transparent: boolean;
            map?: unknown;
          };
          mat.transparent = true;
          mat.opacity = mat.map ? numberOpacity : opacity;
        }
      });
    });
    if (t >= 1) {
      this.clearRoll(roll.rollId);
    }
  }

  clearRoll(rollId: string) {
    const roll = this.rolls.get(rollId);
    if (!roll) return;
    roll.dice.forEach((die) => {
      disposeGroup(die.mesh);
    });
    this.scene.remove(roll.group);
    this.rolls.delete(rollId);
    const waiters = this.fadeWaiters.get(rollId);
    if (waiters && waiters.length > 0) {
      waiters.forEach((resolve) => resolve());
      this.fadeWaiters.delete(rollId);
    }
  }

  /// <summary>
  /// Server-scheduled fade so every client removes dice in sync.
  /// </summary>
  triggerFade(rollId: string) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.fadeStart !== null) {
      return;
    }
    if (roll.track && !roll.settled) {
      this.applyTrackFrame(roll, roll.track.frames - 1);
      if (roll.revealStart !== null) {
        roll.revealDecals.forEach((decal) => {
          (decal.material as THREE.MeshBasicMaterial).opacity = 1;
        });
      }
      roll.settled = true;
    }
    const now = performance.now();
    roll.removeAt = now;
    roll.fadeStart = now;
    this.requestRender();
  }

  /// <summary>
  /// Starts a roll's fade-out immediately and resolves once the roll is removed from scene.
  /// </summary>
  fadeOutAndClear(rollId: string): Promise<void> {
    const roll = this.rolls.get(rollId);
    if (!roll) {
      return Promise.resolve();
    }
    const now = performance.now();
    roll.settled = true;
    roll.removeAt = now;
    if (roll.fadeStart === null) {
      roll.fadeStart = now;
    }
    this.requestRender();
    return new Promise<void>((resolve) => {
      const current = this.fadeWaiters.get(rollId) ?? [];
      current.push(resolve);
      this.fadeWaiters.set(rollId, current);
    });
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
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const upVec = new THREE.Vector3(0, 1, 0);
const tmpNormal = new THREE.Vector3();

function screenEdgeMarginPx(k: number): number {
  return DIE_SCALE * k + 16;
}

/// <summary>Physics half-extent that keeps a die fully inside a viewport of the given px width/height.</summary>
function playHalfFromViewport(viewportPx: number, k: number): number {
  return Math.max(DIE_SCALE + 0.3, (viewportPx / 2 - screenEdgeMarginPx(k)) / k);
}

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

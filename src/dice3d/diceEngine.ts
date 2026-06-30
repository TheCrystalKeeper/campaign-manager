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
  ROLL_REGION_MIN_CELLS,
  type DiceImpact,
  type DiceTrack,
  type DieSpec,
  type DieThrowState,
  type DieTransform,
  type Quat,
  type Vec3,
  type WorldPoint,
} from "./diceProtocol";

/// <summary>
/// Three.js + Rapier dice engine. Display dice are plain meshes; the only physics runs
/// in a hidden pre-simulation that records the exact motion (a DiceTrack). Every client
/// replays that track, so the tumble/landing is identical everywhere, and the die's
/// landing face is relabeled to the server's value so it lands on its number with no
/// post-settle rotation.
///
/// Dice are anchored to the shared map: each roll's dice live in a THREE.Group placed at
/// the roll's map/world tray center and scaled by `k` (physics units -> map units), and
/// the orthographic camera is driven purely by the live map viewport. So every client
/// renders the dice at the same map location at any window size/zoom, and the physics box
/// is a fixed window-independent size, keeping the recorded track identical and bounded.
/// All compute is client-side; nothing here touches the network or Cloudflare.
/// </summary>

const DIE_SCALE = 0.95; // physics radius of a die (physics units)
// Physics units -> map/world units: a die spans ~1 grid cell so dice read consistently
// against the grid regardless of zoom (k = DIE_DIAMETER_CELLS*gridSize/(2*DIE_SCALE)).
const DIE_DIAMETER_CELLS = 1.0;
// The physics play box is sized from the shared map (see rollRegionCells): a region of N
// grid cells maps to a physics half-extent of N*DIE_SCALE/DIE_DIAMETER_CELLS (gridSize
// cancels, so the box is window/grid-independent and the recorded track stays deterministic).
// Orthographic camera height + far plane, in die radii (scale with `k` so clipping holds
// for any gridSize). Camera is top-down; height doesn't affect apparent (ortho) size.
const CAMERA_HEIGHT_UNITS = 30;
const CAMERA_FAR_UNITS = 60;
const DEFAULT_GRID_SIZE = 50;
const WALL_HEIGHT = 8;
const GRAVITY = -34;
const FIXED_DT = 1 / 60;
const SETTLE_LINVEL = 0.16;
const SETTLE_ANGVEL = 0.2;
const FADE_MS = 900;
const ROLL_LINGER_MS = 2600;
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
  /** Wrapper placed at the roll's map/world tray center, scaled by `k`; dice are children. */
  group: THREE.Group;
  /** Map/world coordinates this roll's tray is anchored to. */
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
  /** Local drag/shake samples + roller cursor (shared map/world coords). */
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
  private playEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver;

  // Map pane rectangle in window px (the camera + clip are derived from it).
  private area = { left: 0, top: 0, width: 1, height: 1 };
  // Live map viewport (Konva): screen px = viewport.{x,y} + world * scale (pane-relative).
  private mapViewport = { x: 0, y: 0, scale: 1 };
  // Physics units -> map/world units (tracks the scene grid size).
  private k = physicsToWorldScale(DEFAULT_GRID_SIZE);
  // Physics play-box half-extents, sized from the shared map (see setMapProjection).
  private areaHalfW = regionCellsToAreaHalf(ROLL_REGION_MIN_CELLS);
  private areaHalfH = regionCellsToAreaHalf(ROLL_REGION_MIN_CELLS);

  private rolls = new Map<string, RollInstance>();

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

  /// <summary>
  /// Sets the element whose rectangle confines the dice (the map pane). Pass null to use
  /// the whole canvas.
  /// </summary>
  setPlayArea(element: HTMLElement | null) {
    if (this.playEl === element) {
      return;
    }
    if (this.playEl) {
      this.resizeObserver.unobserve(this.playEl);
    }
    this.playEl = element;
    if (element) {
      this.resizeObserver.observe(element);
    }
    this.layout();
  }

  /// <summary>Recomputes camera + play-area bounds for the current sizes.</summary>
  refreshLayout() {
    this.layout();
  }

  /// <summary>
  /// Updates the shared map projection (viewport + grid). The camera follows the live
  /// viewport so dice stay glued to the map through pan/zoom, and `k` keeps dice sized
  /// consistently against the grid. Called whenever the map viewport changes.
  /// </summary>
  setMapProjection(projection: {
    viewport: { x: number; y: number; scale: number };
    gridSize: number;
    regionCellsW: number;
    regionCellsH: number;
  }) {
    const scale = projection.viewport.scale > 0 ? projection.viewport.scale : 1;
    this.mapViewport = { x: projection.viewport.x, y: projection.viewport.y, scale };
    const gridSize = projection.gridSize > 0 ? projection.gridSize : DEFAULT_GRID_SIZE;
    if (projection.regionCellsW > 0) {
      this.areaHalfW = regionCellsToAreaHalf(projection.regionCellsW);
    }
    if (projection.regionCellsH > 0) {
      this.areaHalfH = regionCellsToAreaHalf(projection.regionCellsH);
    }
    const nextK = physicsToWorldScale(gridSize);
    if (nextK !== this.k) {
      this.k = nextK;
      // Grid size changed: resize every active roll's tray to match the new scale.
      for (const roll of this.rolls.values()) {
        roll.group.scale.setScalar(this.k);
      }
    }
    this.updateCamera();
    this.requestRender();
  }

  private layout() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(cw, ch, false);

    const crect = this.container.getBoundingClientRect();
    let arect: { left: number; top: number; width: number; height: number } = crect;
    if (this.playEl) {
      const r = this.playEl.getBoundingClientRect();
      if (r.width > 20 && r.height > 20) {
        arect = r;
      }
    }
    this.area = { left: arect.left, top: arect.top, width: arect.width, height: arect.height };
    this.applyClip(crect);
    this.updateCamera();
    this.requestRender();
  }

  /// <summary>
  /// Aims the top-down orthographic camera so a map/world point (x,y) renders at the same
  /// pane pixel Konva uses: screen = paneOrigin + viewport.{x,y} + world * scale. The Three
  /// scene is in map/world units (X = world x, Z = world y).
  /// </summary>
  private updateCamera() {
    const cw = Math.max(this.container.clientWidth, 1);
    const ch = Math.max(this.container.clientHeight, 1);
    const scale = this.mapViewport.scale;
    const effX = this.area.left + this.mapViewport.x; // px where world x=0 lands
    const effY = this.area.top + this.mapViewport.y;
    const halfW = cw / (2 * scale);
    const halfH = ch / (2 * scale);
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    const camX = (cw / 2 - effX) / scale;
    const camZ = (ch / 2 - effY) / scale;
    const camY = CAMERA_HEIGHT_UNITS * this.k;
    this.camera.position.set(camX, camY, camZ);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(camX, 0, camZ);
    this.camera.near = 1;
    this.camera.far = CAMERA_FAR_UNITS * this.k;
    this.camera.updateProjectionMatrix();
  }

  /// <summary>Clips the full-window canvas to the map pane so dice never cover the panels.</summary>
  private applyClip(crect: { left: number; top: number; right: number; bottom: number }) {
    const top = Math.max(0, this.area.top - crect.top);
    const left = Math.max(0, this.area.left - crect.left);
    const right = Math.max(0, crect.right - (this.area.left + this.area.width));
    const bottom = Math.max(0, crect.bottom - (this.area.top + this.area.height));
    this.container.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  }

  private handleVisibility = () => {
    if (document.hidden && this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    } else if (!document.hidden) {
      this.requestRender();
    }
  };

  /// <summary>Maps a window pointer to a roll's physics-floor coords via its tray center.</summary>
  private pointerToPhysics(clientX: number, clientY: number, trayCenter: WorldPoint): { x: number; z: number } {
    const world = this.cursorWorld(clientX, clientY);
    return { x: (world[0] - trayCenter[0]) / this.k, z: (world[1] - trayCenter[1]) / this.k };
  }

  /// <summary>Roller cursor in shared map/world coords (projected per-viewer on receipt).</summary>
  private cursorWorld(clientX: number, clientY: number): WorldPoint {
    const scale = this.mapViewport.scale;
    return [
      (clientX - this.area.left - this.mapViewport.x) / scale,
      (clientY - this.area.top - this.mapViewport.y) / scale,
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

  /// <summary>Wraps a roll's dice in a tray group anchored to the map at `trayCenter`.</summary>
  private makeGroup(dice: DieInstance[], trayCenter: WorldPoint): THREE.Group {
    const group = new THREE.Group();
    group.position.set(trayCenter[0], 0, trayCenter[1]);
    group.scale.setScalar(this.k);
    dice.forEach((die) => group.add(die.mesh));
    this.scene.add(group);
    return group;
  }

  // ---- Arming + local pointer interaction ----

  /// <summary>Places a roll's dice on the map tray ready to be grabbed or thrown.</summary>
  arm(rollId: string, specs: DieSpec[], trayCenter: WorldPoint) {
    this.clearRoll(rollId);
    const dice = specs.map((spec) => this.createDie(spec));
    const spread = DIE_SCALE * 2.4;
    const startX = -((dice.length - 1) * spread) / 2;
    dice.forEach((die, i) => {
      const pos = this.areaClamp(startX + i * spread, this.areaHalfH * 0.55);
      die.mesh.position.set(pos.x, DIE_SCALE * 1.6, pos.z);
      die.mesh.quaternion.copy(randomQuat());
    });
    const group = this.makeGroup(dice, trayCenter);
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
    const scale = this.mapViewport.scale;
    const grabRadius = DIE_SCALE * this.k * scale * 1.7;
    const tc = roll.trayCenter;
    return roll.dice.some((die) => {
      const worldX = tc[0] + this.k * die.mesh.position.x;
      const worldY = tc[1] + this.k * die.mesh.position.z;
      const screenX = this.area.left + this.mapViewport.x + worldX * scale;
      const screenY = this.area.top + this.mapViewport.y + worldY * scale;
      return Math.hypot(clientX - screenX, clientY - screenY) < grabRadius;
    });
  }

  beginDrag(rollId: string, clientX: number, clientY: number) {
    const roll = this.rolls.get(rollId);
    if (!roll || roll.mode !== "armed") {
      return;
    }
    const world = this.pointerToPhysics(clientX, clientY, roll.trayCenter);
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
    const world = this.pointerToPhysics(clientX, clientY, roll.trayCenter);
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
      this.callbacks.onMotion?.(this.drag.rollId, this.snapshotTransforms(roll), this.cursorWorld(clientX, clientY));
    }
    this.requestRender();
  }

  endDrag(clientX: number, clientY: number) {
    if (!this.drag) {
      return;
    }
    const roll = this.rolls.get(this.drag.rollId);
    const world = this.pointerToPhysics(clientX, clientY, roll?.trayCenter ?? [0, 0]);
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
    const dir = Math.random() < 0.5 ? -1 : 1;
    roll.dice.forEach((die, i) => {
      const pos = this.areaClamp(
        dir * this.areaHalfW * 0.5 + i * DIE_SCALE * 2,
        -this.areaHalfH * 0.55,
      );
      die.mesh.position.set(pos.x, DIE_SCALE * 3, pos.z);
    });
    this.release(roll, (Math.random() - 0.5) * 6, 9 + Math.random() * 4);
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
    const group = this.makeGroup(dice, trayCenter);
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
      const group = this.makeGroup(dice, trayCenter);
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

  private needsLoop(now: number): boolean {
    for (const roll of this.rolls.values()) {
      if (roll.mode === "track" && !roll.settled) return true;
      if (roll.fadeStart !== null && (roll.removeAt === null || now < roll.removeAt)) return true;
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
    roll.removeAt = now + ROLL_LINGER_MS;
    this.callbacks.onSettled?.(roll.rollId);
  }

  private advanceFade(roll: RollInstance, now: number) {
    const t = Math.min((now - roll.fadeStart!) / FADE_MS, 1);
    const opacity = 1 - t;
    roll.dice.forEach((die) => {
      die.mesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.material) {
          const mat = mesh.material as THREE.Material & { opacity: number; transparent: boolean };
          mat.transparent = true;
          mat.opacity = opacity;
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

/// <summary>Physics units -> map/world units, so a die spans ~DIE_DIAMETER_CELLS grid cells.</summary>
function physicsToWorldScale(gridSize: number): number {
  return (DIE_DIAMETER_CELLS * gridSize) / (2 * DIE_SCALE);
}

/// <summary>Physics half-extent for a roll region of the given full width/height in grid cells.</summary>
function regionCellsToAreaHalf(regionCells: number): number {
  return (regionCells * DIE_SCALE) / DIE_DIAMETER_CELLS;
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

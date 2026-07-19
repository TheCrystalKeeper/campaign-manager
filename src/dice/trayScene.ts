import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  buildDieGeometry,
  buildDieMesh,
  dieMaterialOptions,
  type DieGeometry,
  type DieKind,
} from "./geometry";
import {
  DEFAULT_SKIN_PREFS,
  onSkinTextureLoaded,
  resolveSkinForSides,
  type DiceSkinPrefs,
} from "./skins";
import type { Quat } from "../lib/dice3d";

/// <summary>
/// The physical dice tray: a small always-on 3D scene (own renderer, shared geometry
/// cache) showing one die of every type resting in the tray's felt well. The d# buttons
/// highlight dice here (pulsing gold glow, duplicates spawn for multi-die picks) and
/// pointer-down hit-tests resolve which die a grab starts from. Grabbed dice hand off to
/// the main arena engine, which spawns them at the exact poses this scene reports.
/// The d100 slot holds its real percentile pair — the blue tens d10 plus a red unit d10 —
/// which highlights, lifts, and throws as one unit.
/// </summary>

/** Die sizes shown in the tray, one slot each (the coin sits far-left, before d4). */
export const TRAY_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;

/** On-screen die diameter inside the tray (slightly under the arena's 77px, so dice
 * visually "grow" a touch when picked up). */
const TRAY_DIE_PX = 62;
/** The percentile pair renders a bit smaller so both dice fit one slot. */
const PAIR_SCALE = 0.85;
const HIT_RADIUS_PX = TRAY_DIE_PX / 2 + 8;
const GLOW_COLOR = 0xd9a531;

/** One physical die mesh within a tray slot (a d100 slot has two: tens + unit). */
interface TrayDiePart {
  group: THREE.Group;
  outline: THREE.Mesh;
  /** Offset from the slot instance's center, in CSS px. */
  dx: number;
  dy: number;
}

interface TrayDie {
  sides: number;
  /** Physical dice, in spec order (a d100 lists its tens die first, then the unit). */
  parts: TrayDiePart[];
  /** Instance center inside the tray container, in CSS px. */
  x: number;
  y: number;
  lifted: boolean;
}

export interface TrayDiePose {
  /** Window (client) coordinates of the die's center. */
  screen: [number, number];
  quat: Quat;
}

/// <summary>Resting orientation: the die sits flat with its highest face pointing up.</summary>
function restQuaternion(geom: DieGeometry, seed: number): THREE.Quaternion {
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  if (geom.kind === "d4") {
    // A d4 rests on a face (normal down) with a corner up.
    q.setFromUnitVectors(geom.faces[0].normal, up.clone().negate());
  } else {
    q.setFromUnitVectors(geom.faces[geom.faces.length - 1].normal, up);
  }
  // A fixed per-slot yaw so the row looks hand-placed rather than stamped.
  const yaw = new THREE.Quaternion().setFromAxisAngle(up, (seed * 0.9) % (Math.PI * 2));
  return yaw.multiply(q);
}

function disposeDie(group: THREE.Group) {
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

export class DiceTrayScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private container: HTMLElement;
  private resizeObserver: ResizeObserver;
  private dice = new Map<number, TrayDie[]>();
  private counts = new Map<number, number>();
  private rafId: number | null = null;
  private disposed = false;
  private skinPrefs: DiceSkinPrefs;
  private envMap: THREE.Texture | null = null;
  private unsubscribeSkinTextures: (() => void) | null = null;
  /** Combat is waiting on this client's initiative roll → the d20 glows on its own. */
  private initiativeHighlight = false;

  constructor(container: HTMLElement, skinPrefs: DiceSkinPrefs = DEFAULT_SKIN_PREFS) {
    this.container = container;
    this.skinPrefs = skinPrefs;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    // Absolutely positioned so the canvas's own (DPR-scaled) buffer size can never feed
    // back into the tray's shrink-to-fit width — the well div alone decides the size.
    this.renderer.domElement.style.position = "absolute";
    this.renderer.domElement.style.inset = "0";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 500);
    this.camera.up.set(0, 0, -1);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(30, 80, 20);
    this.scene.add(key);

    // Neutral studio environment for metal/glass skins (own GL context, own PMREM).
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envMap;
    pmrem.dispose();
    this.unsubscribeSkinTextures = onSkinTextureLoaded(() => this.requestRender());

    for (const sides of TRAY_SIDES) {
      this.dice.set(sides, [this.buildTrayDie(sides)]);
    }

    this.layout();
    this.resizeObserver = new ResizeObserver(() => this.layout());
    this.resizeObserver.observe(container);
    container.addEventListener("pointermove", this.handleHover);
  }

  private buildPart(
    kind: DieKind,
    percentile: boolean,
    dx: number,
    dy: number,
    scale: number,
    seed: number,
    skin?: string,
  ): TrayDiePart {
    const geom = buildDieGeometry(kind, percentile);
    const group = buildDieMesh(geom, dieMaterialOptions(kind, percentile, skin));
    group.scale.setScalar((TRAY_DIE_PX / 2) * scale);
    group.quaternion.copy(restQuaternion(geom, seed));

    const outline = new THREE.Mesh(
      geom.geometry,
      new THREE.MeshBasicMaterial({
        color: GLOW_COLOR,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    outline.userData.sharedGeometry = true;
    outline.scale.setScalar(1.16);
    outline.visible = false;
    group.add(outline);

    this.scene.add(group);
    return { group, outline, dx, dy };
  }

  private buildTrayDie(sides: number): TrayDie {
    const skin = resolveSkinForSides(this.skinPrefs, sides);
    let parts: TrayDiePart[];
    if (sides === 100) {
      // The real percentile pair, tens first to match decomposeDie(100)'s spec order.
      parts = [
        this.buildPart("d10", true, -15, -9, PAIR_SCALE, sides, skin),
        this.buildPart("d10", false, 15, 10, PAIR_SCALE, sides + 3, skin),
      ];
    } else if (sides === 2) {
      parts = [this.buildPart("coin", false, 0, 0, 1, sides, skin)];
    } else if (sides === 4 || sides === 6 || sides === 8 || sides === 10 || sides === 12 || sides === 20) {
      parts = [this.buildPart(`d${sides}` as DieKind, false, 0, 0, 1, sides, skin)];
    } else {
      parts = [this.buildPart("custom", false, 0, 0, 1, sides)];
    }
    return { sides, parts, x: 0, y: 0, lifted: false };
  }

  /// <summary>
  /// Applies new skin prefs by rebuilding every slot die (materials AND decal number
  /// colors change per skin, so rebuilding beats swapping materials in place). Geometry
  /// is cached per kind, so this is <10 ms — cheap enough that the picker's hover
  /// preview calls it directly. Re-runs the current selection to restore duplicate
  /// counts and glow.
  /// </summary>
  setSkinPrefs(prefs: DiceSkinPrefs) {
    this.skinPrefs = prefs;
    for (const instances of this.dice.values()) {
      for (const die of instances.splice(0)) {
        die.parts.forEach((part) => {
          this.scene.remove(part.group);
          disposeDie(part.group);
        });
      }
    }
    for (const sides of TRAY_SIDES) {
      this.dice.get(sides)!.push(this.buildTrayDie(sides));
    }
    this.setSelection(Object.fromEntries(this.counts));
  }

  /// <summary>Sizes the camera to the container (1 world unit = 1 CSS px) and re-lays out slots.</summary>
  private layout() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.position.set(w / 2, 200, h / 2);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(w / 2, 0, h / 2);
    this.camera.updateProjectionMatrix();

    const slotW = w / TRAY_SIDES.length;
    TRAY_SIDES.forEach((sides, i) => {
      const instances = this.dice.get(sides) ?? [];
      const baseX = slotW * (i + 0.5);
      instances.forEach((die, j) => {
        // Duplicates fan out diagonally from the slot's base die.
        die.x = baseX + (j % 2 === 0 ? 1 : -1) * Math.ceil(j / 2) * 16;
        die.y = h / 2 + (j % 2 === 0 ? -1 : 1) * Math.ceil(j / 2) * 10;
        die.parts.forEach((part) => {
          part.group.position.set(die.x + part.dx, 0, die.y + part.dy);
        });
      });
    });
    this.requestRender();
  }

  /// <summary>
  /// Highlights (and spawns duplicates for) the current d#-button selection:
  /// `counts[sides] = n` shows n glowing dice of that size (0 = one quiet die).
  /// </summary>
  setSelection(counts: Record<number, number>) {
    this.counts = new Map(Object.entries(counts).map(([s, n]) => [Number(s), n]));
    for (const sides of TRAY_SIDES) {
      const want = Math.max(1, this.counts.get(sides) ?? 0);
      const instances = this.dice.get(sides)!;
      while (instances.length < want) {
        instances.push(this.buildTrayDie(sides));
      }
      while (instances.length > want) {
        const die = instances.pop()!;
        die.parts.forEach((part) => {
          this.scene.remove(part.group);
          disposeDie(part.group);
        });
      }
    }
    this.refreshGlow();
    this.layout();
  }

  /// <summary>
  /// Forces the d20 die to glow while combat is waiting on this client's initiative roll
  /// — the very die to throw — independent of the d#-button selection. Persists across
  /// selection and skin changes until turned off.
  /// </summary>
  setInitiativeHighlight(on: boolean) {
    if (this.initiativeHighlight === on) {
      return;
    }
    this.initiativeHighlight = on;
    this.refreshGlow();
    this.requestRender();
  }

  /// <summary>A die glows if it's readied (selected) or — for the d20 — the initiative cue is on.</summary>
  private diceGlow(sides: number): boolean {
    return (this.counts.get(sides) ?? 0) > 0 || (sides === 20 && this.initiativeHighlight);
  }

  private refreshGlow() {
    for (const [sides, instances] of this.dice) {
      const glowing = this.diceGlow(sides);
      instances.forEach((die) => {
        die.parts.forEach((part) => {
          part.outline.visible = glowing && !die.lifted;
        });
      });
    }
  }

  /// <summary>Which die size sits under a window pointer position, if any.</summary>
  hitTest(clientX: number, clientY: number): number | null {
    const rect = this.container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { sides: number; dist: number } | null = null;
    for (const instances of this.dice.values()) {
      for (const die of instances) {
        if (die.lifted) {
          continue;
        }
        for (const part of die.parts) {
          const dist = Math.hypot(die.x + part.dx - x, die.y + part.dy - y);
          if (dist <= HIT_RADIUS_PX && (!best || dist < best.dist)) {
            best = { sides: die.sides, dist };
          }
        }
      }
    }
    return best ? best.sides : null;
  }

  /// <summary>
  /// Marks the dice for a grab as lifted (hidden until `restoreLifted`) and returns one
  /// pose per *physical* die, aligned with the grab's spec expansion (a d100 unit yields
  /// two poses: its tens die then its unit die, matching decomposeDie order).
  /// </summary>
  liftForGrab(picks: Array<[number, number]>): TrayDiePose[] {
    const rect = this.container.getBoundingClientRect();
    const poses: TrayDiePose[] = [];
    for (const [sides, count] of picks) {
      const instances = this.dice.get(sides) ?? [];
      for (let j = 0; j < count; j += 1) {
        const die = instances[Math.min(j, instances.length - 1)];
        for (const part of die.parts) {
          const q = part.group.quaternion;
          poses.push({
            screen: [rect.left + die.x + part.dx, rect.top + die.y + part.dy],
            quat: [q.x, q.y, q.z, q.w],
          });
          part.group.visible = false;
          part.outline.visible = false;
        }
        die.lifted = true;
      }
    }
    this.requestRender();
    return poses;
  }

  /// <summary>Restocks the tray after a throw (or abandoned grab).</summary>
  restoreLifted() {
    for (const instances of this.dice.values()) {
      for (const die of instances) {
        die.lifted = false;
        die.parts.forEach((part) => {
          part.group.visible = true;
        });
      }
    }
    this.requestRender();
  }

  private handleHover = (event: PointerEvent) => {
    this.container.style.cursor = this.hitTest(event.clientX, event.clientY) !== null ? "grab" : "default";
  };

  private anyGlow(): boolean {
    for (const instances of this.dice.values()) {
      for (const die of instances) {
        if (die.parts.some((part) => part.outline.visible)) {
          return true;
        }
      }
    }
    return false;
  }

  private requestRender() {
    if (this.disposed) {
      return;
    }
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number) => {
    this.rafId = null;
    if (this.disposed) {
      return;
    }
    const glowing = this.anyGlow();
    if (glowing) {
      // Pulsing glow: breathe both opacity and shell size.
      const pulse = 0.5 + 0.5 * Math.sin(now / 240);
      for (const instances of this.dice.values()) {
        for (const die of instances) {
          for (const part of die.parts) {
            if (!part.outline.visible) {
              continue;
            }
            (part.outline.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.45 * pulse;
            part.outline.scale.setScalar(1.12 + 0.06 * pulse);
          }
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (glowing && !document.hidden) {
      this.rafId = requestAnimationFrame(this.frame);
    }
  };

  dispose() {
    this.disposed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
    this.resizeObserver.disconnect();
    this.container.removeEventListener("pointermove", this.handleHover);
    for (const instances of this.dice.values()) {
      for (const die of instances) {
        die.parts.forEach((part) => {
          this.scene.remove(part.group);
          disposeDie(part.group);
        });
      }
    }
    this.dice.clear();
    this.unsubscribeSkinTextures?.();
    this.envMap?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

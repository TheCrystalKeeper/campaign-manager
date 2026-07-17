import * as THREE from "three";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import type { DieKind } from "../lib/dice3d";
import { createSkinMaterial, skinDef, type NumberStyle } from "./skins";

/// <summary>
/// Procedural dice geometry: builds the convex body mesh, per-face metadata used to
/// steer a die so a chosen value lands face-up, and the runtime number textures.
/// All geometry is generated in code so the feature ships zero asset files.
/// </summary>

export type { DieKind };

export interface DieFace {
  /** Value 1..N this face represents. */
  value: number;
  /** Text drawn on the face (e.g. "20", or "00" for a percentile d10). */
  label: string;
  /** Outward face normal in the die's local space (unit length). */
  normal: THREE.Vector3;
  /** Face center in local space. */
  centroid: THREE.Vector3;
}

/**
 * A d4 (tetrahedron) doesn't show one number per face — each of its 4 corners gets a value,
 * printed on the 3 faces that meet there. `faceVertices[faceIndex]` lists which vertex
 * indices (into `vertices`) that face touches, so the renderer can paint 3 numbers per face
 * and the engine can relabel by vertex instead of by face.
 */
export interface D4VertexInfo {
  value: number;
  label: string;
  /** Vertex position in local space. */
  position: THREE.Vector3;
}

export interface D4Info {
  /** vertices[i] is the corner carrying value i+1 initially (relabeled per throw). */
  vertices: D4VertexInfo[];
  /** Per face (same order as `faces`), the 3 vertex indices that face touches. */
  faceVertices: number[][];
}

export interface DieGeometry {
  kind: DieKind;
  /** Hull points (local space) handed to the physics engine for a convex collider. */
  points: THREE.Vector3[];
  /** Convex body geometry for rendering. */
  geometry: THREE.BufferGeometry;
  /** Faces indexed so faces[value - 1] is the face for that value. */
  faces: DieFace[];
  /** Number of sides. */
  sides: number;
  /** Approximate circumscribed radius after normalization. */
  radius: number;
  /** Vertex-numbering metadata, present only when kind === "d4". */
  d4?: D4Info;
}

const PHI = (1 + Math.sqrt(5)) / 2;
const TARGET_RADIUS = 1;

/// <summary>
/// Returns the raw (un-normalized) vertex set for a platonic die. d10 is handled
/// separately because it is a pentagonal trapezohedron, not a platonic solid.
/// </summary>
/// <summary>
/// Vertices of an elongated hexagonal bipyramid — the blank "crystal/gem" used for
/// custom-sided dice. Convex hull yields 12 triangular faces with a clear top to reveal on.
/// </summary>
function crystalPoints(): number[][] {
  const n = 6;
  const ringRadius = 1;
  const apex = 1.55;
  const pts: number[][] = [];
  for (let k = 0; k < n; k += 1) {
    const angle = (k * 2 * Math.PI) / n;
    pts.push([Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0]);
  }
  pts.push([0, 0, apex]);
  pts.push([0, 0, -apex]);
  return pts;
}

function platonicPoints(kind: Exclude<DieKind, "d10" | "custom" | "coin">): number[][] {
  switch (kind) {
    case "d4":
      return [
        [1, 1, 1],
        [1, -1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
      ];
    case "d6":
      return [
        [1, 1, 1],
        [1, 1, -1],
        [1, -1, 1],
        [1, -1, -1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, 1],
        [-1, -1, -1],
      ];
    case "d8":
      return [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
    case "d12":
      return [
        [1, 1, 1],
        [1, 1, -1],
        [1, -1, 1],
        [1, -1, -1],
        [-1, 1, 1],
        [-1, 1, -1],
        [-1, -1, 1],
        [-1, -1, -1],
        [0, 1 / PHI, PHI],
        [0, 1 / PHI, -PHI],
        [0, -1 / PHI, PHI],
        [0, -1 / PHI, -PHI],
        [1 / PHI, PHI, 0],
        [1 / PHI, -PHI, 0],
        [-1 / PHI, PHI, 0],
        [-1 / PHI, -PHI, 0],
        [PHI, 0, 1 / PHI],
        [PHI, 0, -1 / PHI],
        [-PHI, 0, 1 / PHI],
        [-PHI, 0, -1 / PHI],
      ];
    case "d20":
      return [
        [0, 1, PHI],
        [0, 1, -PHI],
        [0, -1, PHI],
        [0, -1, -PHI],
        [1, PHI, 0],
        [1, -PHI, 0],
        [-1, PHI, 0],
        [-1, -PHI, 0],
        [PHI, 0, 1],
        [PHI, 0, -1],
        [-PHI, 0, 1],
        [-PHI, 0, -1],
      ];
  }
}

/// <summary>
/// Clusters a convex geometry's triangles into logical (coplanar) faces by grouping
/// triangles that share an outward normal. Returns one entry per real polygon face.
/// </summary>
function clusterFaces(geometry: THREE.BufferGeometry): { normal: THREE.Vector3; centroid: THREE.Vector3 }[] {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const clusters: { normal: THREE.Vector3; verts: THREE.Vector3[] }[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    const normal = new THREE.Vector3().crossVectors(ab, ac).normalize();

    let cluster = clusters.find((entry) => entry.normal.dot(normal) > 0.999);
    if (!cluster) {
      cluster = { normal: normal.clone(), verts: [] };
      clusters.push(cluster);
    }
    cluster.verts.push(a.clone(), b.clone(), c.clone());
  }

  return clusters.map((cluster) => {
    const centroid = new THREE.Vector3();
    // Deduplicate near-identical vertices before averaging so the centroid is the true face center.
    const unique: THREE.Vector3[] = [];
    for (const v of cluster.verts) {
      if (!unique.some((u) => u.distanceToSquared(v) < 1e-6)) {
        unique.push(v);
      }
    }
    for (const v of unique) {
      centroid.add(v);
    }
    centroid.multiplyScalar(1 / unique.length);
    return { normal: cluster.normal, centroid };
  });
}

/// <summary>
/// Builds a regular tetrahedron (d4) with explicit faces, where face k is the triangle of
/// the three vertices *other than* k. A d4 doesn't number its faces — it numbers its
/// vertices, and each face shows the 3 numbers of the corners it touches — so this also
/// returns `faceVertices` (per face, the 3 vertex indices it touches) to drive that.
/// </summary>
function buildD4(): {
  geometry: THREE.BufferGeometry;
  points: THREE.Vector3[];
  faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[];
  faceVertices: number[][];
} {
  const points = platonicPoints("d4").map(([x, y, z]) => new THREE.Vector3(x, y, z));
  // Face k is opposite vertex k (the triangle formed by the other three corners).
  const faceVertices: number[][] = [
    [1, 2, 3],
    [0, 2, 3],
    [0, 1, 3],
    [0, 1, 2],
  ];

  const positions: number[] = [];
  const faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[] = [];

  for (const idxs of faceVertices) {
    const [a, b, c] = idxs.map((i) => points[i]);
    const centroid = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
    let normal = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
      .normalize();
    // Ensure the normal points away from the die center.
    if (normal.dot(centroid) < 0) {
      normal = normal.multiplyScalar(-1);
    }
    faceData.push({ normal, centroid });

    // Triangulate so the geometry's winding matches the outward `normal`.
    const candidate = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
      .normalize();
    const ordered = candidate.dot(normal) >= 0 ? [a, b, c] : [a, c, b];
    for (const p of ordered) {
      positions.push(p.x, p.y, p.z);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return { geometry, points, faceData, faceVertices };
}

/// <summary>
/// Builds a pentagonal trapezohedron (d10) with explicit kite faces so we always get
/// exactly ten faces with stable outward normals.
/// </summary>
function buildD10(): { geometry: THREE.BufferGeometry; points: THREE.Vector3[]; faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[] } {
  const ringR = 1;
  // A pentagonal trapezohedron's kite faces are planar only when the apex height is
  // (5 + 2√5) ≈ 9.47× the ring height (for ring radius 1). Using an arbitrary ratio makes
  // each "kite" a bent, non-planar quad that looks creased and mis-sizes its number decal.
  const ringZ = 0.13; // controls how "fat" the equatorial band is (tunable)
  const apexZ = (5 + 2 * Math.sqrt(5)) * ringZ; // ≈1.23 -> flat kite faces

  const upper: THREE.Vector3[] = [];
  const lower: THREE.Vector3[] = [];
  for (let k = 0; k < 5; k += 1) {
    const aAngle = (k * 2 * Math.PI) / 5;
    const bAngle = aAngle + Math.PI / 5;
    upper.push(new THREE.Vector3(Math.cos(aAngle) * ringR, Math.sin(aAngle) * ringR, ringZ));
    lower.push(new THREE.Vector3(Math.cos(bAngle) * ringR, Math.sin(bAngle) * ringR, -ringZ));
  }
  const apexTop = new THREE.Vector3(0, 0, apexZ);
  const apexBottom = new THREE.Vector3(0, 0, -apexZ);

  const points = [...upper, ...lower, apexTop, apexBottom];

  // Each kite is two triangles. Upper kite k: [apexTop, upper[k], lower[k], upper[k+1]].
  // Lower kite k: [apexBottom, lower[k], upper[k+1], lower[k+1]].
  const kites: THREE.Vector3[][] = [];
  for (let k = 0; k < 5; k += 1) {
    kites.push([apexTop, upper[k], lower[k], upper[(k + 1) % 5]]);
  }
  for (let k = 0; k < 5; k += 1) {
    kites.push([apexBottom, lower[k], upper[(k + 1) % 5], lower[(k + 1) % 5]]);
  }

  const positions: number[] = [];
  const faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[] = [];

  for (const kite of kites) {
    const centroid = new THREE.Vector3();
    for (const v of kite) {
      centroid.add(v);
    }
    centroid.multiplyScalar(1 / kite.length);

    let normal = new THREE.Vector3()
      .crossVectors(new THREE.Vector3().subVectors(kite[1], kite[0]), new THREE.Vector3().subVectors(kite[2], kite[0]))
      .normalize();
    // Ensure the normal points away from the die center.
    if (normal.dot(centroid) < 0) {
      normal = normal.multiplyScalar(-1);
    }
    faceData.push({ normal, centroid });

    // Triangulate the quad as a fan, winding so the geometry normal matches `normal`.
    const tri = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3) => {
      const candidate = new THREE.Vector3()
        .crossVectors(new THREE.Vector3().subVectors(p1, p0), new THREE.Vector3().subVectors(p2, p0))
        .normalize();
      const ordered = candidate.dot(normal) >= 0 ? [p0, p1, p2] : [p0, p2, p1];
      for (const p of ordered) {
        positions.push(p.x, p.y, p.z);
      }
    };
    tri(kite[0], kite[1], kite[2]);
    tri(kite[0], kite[2], kite[3]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return { geometry, points, faceData };
}

/// <summary>
/// Builds a coin: a squat cylinder (axis along Y) thin enough that rim landings are
/// negligible. Exactly two faces — the +Y cap (Heads, value 1) and the −Y cap (Tails,
/// value 2). The hull points feed the physics collider + the visual drum mesh.
/// </summary>
function buildCoin(): { geometry: THREE.BufferGeometry; points: THREE.Vector3[]; faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[] } {
  const R = 1;
  // Thinner disc (was 0.3 → 0.13 → 0.07). thickness:diameter ≈ 0.07 is close to a real
  // coin and, crucially, makes the rim so narrow the coin is unstable on its edge and
  // topples to a face — so it rarely comes to rest balanced on its side. (The Heads/Tails
  // value is server-picked and relabeled; this only shapes the cosmetic tumble/rest.)
  const halfH = 0.07;
  const N = 20;
  const points: THREE.Vector3[] = [];
  for (let k = 0; k < N; k += 1) {
    const a = (k * 2 * Math.PI) / N;
    points.push(new THREE.Vector3(Math.cos(a) * R, halfH, Math.sin(a) * R));
    points.push(new THREE.Vector3(Math.cos(a) * R, -halfH, Math.sin(a) * R));
  }
  const geometry = new ConvexGeometry(points);
  const faceData = [
    { normal: new THREE.Vector3(0, 1, 0), centroid: new THREE.Vector3(0, halfH, 0) },
    { normal: new THREE.Vector3(0, -1, 0), centroid: new THREE.Vector3(0, -halfH, 0) },
  ];
  return { geometry, points, faceData };
}

/// <summary>
/// Scales a geometry, its hull points, and face metadata so the die's circumscribed
/// radius equals TARGET_RADIUS, keeping every die a consistent size.
/// </summary>
function normalizeScale(
  points: THREE.Vector3[],
  faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[],
  geometry: THREE.BufferGeometry,
): number {
  let maxLen = 0;
  for (const p of points) {
    maxLen = Math.max(maxLen, p.length());
  }
  const scale = TARGET_RADIUS / maxLen;
  for (const p of points) {
    p.multiplyScalar(scale);
  }
  for (const f of faceData) {
    f.centroid.multiplyScalar(scale);
  }
  geometry.scale(scale, scale, scale);
  return TARGET_RADIUS;
}

/// <summary>
/// Generates planar per-face UVs for a (non-indexed) die body so image-texture skins can
/// wrap it. The (u,v) basis is derived purely from each triangle's face normal, so every
/// coplanar triangle of a logical face projects into the same continuous patch — critical
/// for the coin caps (triangle fans) and the d10/d12 multi-triangle kites/pentagons.
/// Positions are normalized to radius 1, so uv = (p·u, p·v) * scale + 0.5 stays in [0,1]
/// (textures use RepeatWrapping regardless). Different faces get different bases, which
/// naturally samples different patches of the texture — exactly what organic materials
/// (marble/wood/stone) want.
/// </summary>
export function generateFaceUVs(geometry: THREE.BufferGeometry, scale = 0.5): void {
  const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
  const uvs = new Float32Array(pos.count * 2);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  const helper = new THREE.Vector3();
  const p = new THREE.Vector3();

  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();

    helper.set(0, 1, 0);
    if (Math.abs(n.y) > 0.99) {
      helper.set(1, 0, 0);
    }
    u.crossVectors(helper, n).normalize();
    v.crossVectors(n, u);

    for (let k = 0; k < 3; k += 1) {
      p.fromBufferAttribute(pos, i + k);
      uvs[(i + k) * 2] = p.dot(u) * scale + 0.5;
      uvs[(i + k) * 2 + 1] = p.dot(v) * scale + 0.5;
    }
  }

  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/// <summary>
/// Assigns values 1..N to faces. Platonic dice get the standard "opposite faces sum to
/// N+1" arrangement where possible; otherwise faces are numbered in a stable order.
/// </summary>
function assignFaceValues(
  faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[],
  sides: number,
  percentile: boolean,
): DieFace[] {
  // Stable ordering by normal so value assignment is deterministic across runs.
  const ordered = faceData
    .map((f, index) => ({ f, index }))
    .sort((x, y) => {
      if (Math.abs(x.f.normal.y - y.f.normal.y) > 1e-4) return y.f.normal.y - x.f.normal.y;
      if (Math.abs(x.f.normal.x - y.f.normal.x) > 1e-4) return y.f.normal.x - x.f.normal.x;
      return y.f.normal.z - x.f.normal.z;
    });

  return ordered.map((entry, i) => {
    const value = i + 1;
    let label: string;
    if (percentile) {
      // Percentile d10 shows 00..90 (tens). value 1->"00", 10->"90".
      label = String((value - 1) * 10).padStart(2, "0");
    } else if (sides === 10) {
      // Standard d10 shows 0..9 where face value 10 reads "0".
      label = String(value % 10);
    } else if (sides === 2) {
      // Coin: the +Y cap (value 1) is Heads, the −Y cap (value 2) is Tails.
      label = value === 1 ? "H" : "T";
    } else {
      label = String(value);
    }
    return {
      value,
      label,
      normal: entry.f.normal.clone(),
      centroid: entry.f.centroid.clone(),
    };
  });
}

const geometryCache = new Map<string, DieGeometry>();

/// <summary>
/// Builds (and caches) the geometry, hull points and face metadata for a die kind.
/// Pass percentile=true for the "tens" d10 used to make up a d100.
/// </summary>
export function buildDieGeometry(kind: DieKind, percentile = false): DieGeometry {
  const cacheKey = `${kind}${percentile ? "-pct" : ""}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let geometry: THREE.BufferGeometry;
  let points: THREE.Vector3[];
  let faceData: { normal: THREE.Vector3; centroid: THREE.Vector3 }[];
  let d4FaceVertices: number[][] | null = null;

  if (kind === "d10") {
    const built = buildD10();
    geometry = built.geometry;
    points = built.points;
    faceData = built.faceData;
  } else if (kind === "coin") {
    const built = buildCoin();
    geometry = built.geometry;
    points = built.points;
    faceData = built.faceData;
  } else if (kind === "d4") {
    const built = buildD4();
    geometry = built.geometry;
    points = built.points;
    faceData = built.faceData;
    d4FaceVertices = built.faceVertices;
  } else {
    points = (kind === "custom" ? crystalPoints() : platonicPoints(kind)).map(
      ([x, y, z]) => new THREE.Vector3(x, y, z),
    );
    geometry = new ConvexGeometry(points);
    faceData = clusterFaces(geometry);
  }

  const radius = normalizeScale(points, faceData, geometry);
  geometry.computeVertexNormals();
  generateFaceUVs(geometry);

  const sides = kind === "d10" ? 10 : faceData.length;
  // d4 faces are built directly (not via assignFaceValues) so `faces[i]` stays aligned with
  // `d4FaceVertices[i]` — assignFaceValues's normal-sort would scramble that correspondence.
  const faces = d4FaceVertices
    ? faceData.map((f, i) => ({ value: i + 1, label: String(i + 1), normal: f.normal.clone(), centroid: f.centroid.clone() }))
    : assignFaceValues(faceData, sides, percentile);

  const d4: D4Info | undefined = d4FaceVertices
    ? {
        vertices: points.map((p, i) => ({ value: i + 1, label: String(i + 1), position: p.clone() })),
        faceVertices: d4FaceVertices,
      }
    : undefined;

  const result: DieGeometry = { kind, points, geometry, faces, sides, radius, d4 };
  geometryCache.set(cacheKey, result);
  return result;
}

const textureCache = new Map<string, THREE.CanvasTexture>();

/// <summary>
/// Renders a die-face label to a transparent canvas texture, cached by label + style.
/// The glyph gets an engraved/inset look: a dark recess pass shifted up, a lit lower-lip
/// pass shifted down, then the glyph body on top. 6 and 9 are underlined to
/// disambiguate orientation.
/// </summary>
export function numberTexture(label: string, style?: NumberStyle): THREE.CanvasTexture {
  const s = style ?? skinDef(undefined, false).numbers;
  const key = `${label}|${s.fill}|${s.highlight}|${s.shadow}`;
  const cached = textureCache.get(key);
  if (cached) {
    return cached;
  }

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  ctx.font = `bold ${label.length > 1 ? 58 : 78}px "Trebuchet MS", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const drawGlyph = (color: string, dy: number) => {
    ctx.fillStyle = color;
    ctx.fillText(label, size / 2, size / 2 + 4 + dy);
    if (label === "6" || label === "9") {
      ctx.fillRect(size / 2 - 22, size / 2 + 34 + dy, 44, 6);
    }
  };
  drawGlyph(s.shadow, -2);
  drawGlyph(s.highlight, 2);
  drawGlyph(s.fill, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

export interface DiceMaterialOptions {
  /** Cosmetic skin id — a DiceSkinId for dice, a CoinSkinId for the coin. */
  skin?: string;
  /** True for the "tens" d10 of a d100 pair (tinted so the pair stays readable). */
  percentile?: boolean;
  /** True for the coin (worn minted metal finishes instead of dice skins). */
  coin?: boolean;
  /** Number/pip styling; defaults to the resolved skin's engraved style. */
  numberStyle?: NumberStyle;
}

/// <summary>
/// Creates the body material. This is the single swap point for dice "skins" — the
/// actual registry/material work lives in skins.ts; geometry/physics/networking are
/// unaffected by the look.
/// </summary>
export function createDiceMaterial(options: DiceMaterialOptions = {}): THREE.MeshStandardMaterial {
  return createSkinMaterial(options.skin, {
    percentile: options.percentile,
    coin: options.coin,
  });
}

/// <summary>
/// The per-kind body/label styling passed to buildDieMesh. Single source of truth so the
/// engine (thrown dice) and the tray (idle dice) render identically. `skin` is the
/// roller's cosmetic choice (spec.skin / tray prefs); absent means classic dice or the
/// gold coin.
/// </summary>
export function dieMaterialOptions(kind: DieKind, percentile: boolean, skin?: string): DiceMaterialOptions {
  const coin = kind === "coin";
  return { skin, percentile, coin, numberStyle: skinDef(skin, coin).numbers };
}

/// <summary>
/// Builds the visual Three.js group for a die: the convex body plus a number decal on
/// each face. The returned group is what the engine attaches to a physics body.
/// </summary>
export function buildDieMesh(die: DieGeometry, options: DiceMaterialOptions = {}): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(die.geometry, createDiceMaterial(options));
  body.castShadow = true;
  // The body geometry is cached and shared across dice of this kind; flag it so the
  // engine's cleanup never disposes it (only per-die materials/decals are disposed).
  body.userData.sharedGeometry = true;
  group.add(body);

  const numberStyle = options.numberStyle ?? skinDef(options.skin, options.coin ?? false).numbers;
  const decals: THREE.Mesh[] = [];

  if (die.kind === "d4" && die.d4) {
    // Each face shows 3 numbers (one per adjoining vertex) instead of one centered number.
    const decalsByVertex: THREE.Mesh[][] = die.d4.vertices.map(() => []);
    die.d4.faceVertices.forEach((vertexIdxs, faceIndex) => {
      const face = die.faces[faceIndex];
      for (const vi of vertexIdxs) {
        const decal = makeD4VertexDecal(die, face, die.d4!.vertices[vi], numberStyle);
        group.add(decal);
        decals.push(decal);
        decalsByVertex[vi].push(decal);
      }
    });
    group.userData.d4VertexDecals = decalsByVertex;
  } else if (die.kind !== "custom") {
    // Custom crystal dice render blank — the number is revealed (faded in) after they land.
    for (const face of die.faces) {
      const decal = makeFaceDecal(die, face, face.label, numberStyle);
      group.add(decal);
      decals.push(decal);
    }
  }

  // Expose the number decals so a thrown die's landing face/vertex can be relabeled to the
  // server's value before it is shown (faces via `relabelDieFace`, d4 via `relabelD4Vertex`).
  group.userData.decals = decals;
  group.userData.numberStyle = numberStyle;

  return group;
}

/// <summary>
/// Builds one number decal for a d4 face, near the corner it belongs to and oriented so the
/// glyph's "up" points inward (toward the face centroid / opposite edge) — the standard d4
/// vertex-numbering layout, where the number near the topmost corner reads upright on all 3
/// surrounding faces.
/// </summary>
function makeD4VertexDecal(die: DieGeometry, face: DieFace, vertex: D4VertexInfo, style: NumberStyle): THREE.Mesh {
  // The vertex lies in the face's plane, so centroid->vertex is already an in-plane
  // direction: use it directly as the local "outward" basis vector (u). v completes a
  // right-handed (u, v, normal) frame matching the decal plane's (X, Y, Z) axes.
  const toVertex = new THREE.Vector3().subVectors(vertex.position, face.centroid);
  const dist = toVertex.length();
  const u = toVertex.clone().normalize();
  const v = new THREE.Vector3().crossVectors(face.normal, u).normalize();
  const offset = dist * 0.56;

  const decalSize = die.radius * 0.6;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(decalSize, decalSize),
    new THREE.MeshBasicMaterial({ map: numberTexture(vertex.label, style), transparent: true, depthWrite: false }),
  );
  decal.position
    .copy(face.centroid)
    .addScaledVector(u, offset)
    .addScaledVector(face.normal, die.radius * 0.012);
  decal.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, face.normal));
  // The plane's local +Y (the glyph's "up") starts pointing along `v` (90° from `u`). Add a
  // quarter turn so it instead points along -u — inward, toward the centroid — rather than
  // outward toward the corner.
  decal.rotateZ(Math.PI / 2);
  return decal;
}

/// <summary>Builds a number plane sized and oriented to a die face.</summary>
function makeFaceDecal(die: DieGeometry, face: DieFace, label: string, style: NumberStyle): THREE.Mesh {
  // Scale the decal to the face: use the nearest vertex distance as an in-radius proxy.
  let nearest = Infinity;
  const posAttr = die.geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < posAttr.count; i += 1) {
    const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
    if (Math.abs(v.clone().sub(face.centroid).dot(face.normal)) < 1e-3) {
      nearest = Math.min(nearest, v.distanceTo(face.centroid));
    }
  }
  if (!Number.isFinite(nearest) || nearest === 0) {
    nearest = die.radius * 0.5;
  }
  const decalSize = Math.min(nearest * 1.25, die.radius * 1.1);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(decalSize, decalSize),
    new THREE.MeshBasicMaterial({ map: numberTexture(label, style), transparent: true, depthWrite: false }),
  );
  decal.position.copy(face.centroid).addScaledVector(face.normal, die.radius * 0.012);
  decal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), face.normal);
  return decal;
}

/// <summary>
/// Hides every number on a built die mesh, leaving a blank body — used to render a DM's
/// secret roll for other players (they see the dice tumble but never the values).
/// </summary>
export function hideDieNumbers(group: THREE.Group): void {
  const decals = group.userData.decals as THREE.Mesh[] | undefined;
  decals?.forEach((decal) => {
    decal.visible = false;
  });
}

/// <summary>
/// Changes the number shown on one face of a built die mesh (by face index, matching
/// the geometry's `faces` order). Used to put the server's result on the landing face.
/// </summary>
export function relabelDieFace(group: THREE.Group, faceIndex: number, label: string): void {
  const decals = group.userData.decals as THREE.Mesh[] | undefined;
  const decal = decals?.[faceIndex];
  if (!decal) {
    return;
  }
  const style = group.userData.numberStyle as NumberStyle | undefined;
  const material = decal.material as THREE.MeshBasicMaterial;
  material.map = numberTexture(label, style);
  material.needsUpdate = true;
}

/// <summary>
/// Changes the number shown for one vertex of a built d4 mesh (by vertex index, matching the
/// geometry's `d4.vertices` order) — updates all 3 face decals that vertex appears on. Used
/// to put the server's value on the corner that landed face-up.
/// </summary>
export function relabelD4Vertex(group: THREE.Group, vertexIndex: number, label: string): void {
  const decalsByVertex = group.userData.d4VertexDecals as THREE.Mesh[][] | undefined;
  const decals = decalsByVertex?.[vertexIndex];
  if (!decals) {
    return;
  }
  const style = group.userData.numberStyle as NumberStyle | undefined;
  decals.forEach((decal) => {
    const material = decal.material as THREE.MeshBasicMaterial;
    material.map = numberTexture(label, style);
    material.needsUpdate = true;
  });
}

/// <summary>
/// Adds a single number decal to a (blank) custom die's landing face, starting fully
/// transparent so the engine can fade it in once the die settles. Returns the decal.
/// </summary>
export function addRevealDecal(
  group: THREE.Group,
  die: DieGeometry,
  faceIndex: number,
  label: string,
): THREE.Mesh | null {
  const face = die.faces[faceIndex];
  if (!face) {
    return null;
  }
  const style = (group.userData.numberStyle as NumberStyle | undefined) ?? skinDef(undefined, false).numbers;
  const decal = makeFaceDecal(die, face, label, style);
  (decal.material as THREE.MeshBasicMaterial).opacity = 0;
  group.add(decal);
  return decal;
}

import {
  MAX_FOG_REVEALS,
  MAX_LIGHTS,
  MAX_SCENE_ANNOTATIONS,
  MAX_WALLS,
  normalizeScene,
  sanitizeAnnotation,
  sanitizeFogReveal,
  sanitizeLight,
  sanitizeWall,
  type Annotation,
  type ClientMessage,
  type FogReveal,
  type Scene,
  type Wall,
} from "./types";

/// <summary>
/// Client-side mirror of the server's scene-editing handlers, used by the Scenes-page
/// editor to STAGE changes into a local draft when "Live updates" is off. The server in
/// partykit/server.ts stays authoritative — this module must follow it, never the other
/// way around. Pure and unit-tested; reuses the same sanitizers and caps.
/// </summary>

/** Which scene a message edits, or null when it isn't a stageable scene-shape message. */
export function sceneMessageSceneId(msg: ClientMessage): string | null {
  switch (msg.type) {
    case "UPDATE_SCENE":
      return msg.scene.id;
    case "SET_WALLS":
    case "TOGGLE_DOOR":
    case "ADD_LIGHT":
    case "UPDATE_LIGHT":
    case "REMOVE_LIGHT":
    case "FOG_SET":
    case "FOG_REVEAL":
    case "FOG_RESET":
    case "ADD_ANNOTATION":
    case "REMOVE_ANNOTATION":
    case "CLEAR_ANNOTATIONS":
      return msg.sceneId;
    default:
      return null;
  }
}

/// <summary>
/// Applies a scene-editing message to a scene, returning a NEW scene — or the SAME
/// reference when the message doesn't apply (wrong scene, invalid payload, or not a
/// scene-shape message). Semantics match the server handlers, including the caps.
/// </summary>
export function applySceneMessage(scene: Scene, msg: ClientMessage): Scene {
  if (sceneMessageSceneId(msg) !== scene.id) {
    return scene;
  }
  switch (msg.type) {
    case "UPDATE_SCENE":
      return normalizeScene(msg.scene);
    case "SET_WALLS": {
      if (!Array.isArray(msg.walls)) {
        return scene;
      }
      const walls = msg.walls
        .map((wall) => sanitizeWall(wall))
        .filter((wall): wall is Wall => wall !== null)
        .slice(-MAX_WALLS);
      return { ...scene, walls };
    }
    case "TOGGLE_DOOR": {
      const door = scene.walls.find((wall) => wall.id === msg.wallId);
      if (!door || door.kind !== "door") {
        return scene;
      }
      return {
        ...scene,
        walls: scene.walls.map((wall) =>
          wall.id === msg.wallId ? { ...wall, open: !wall.open } : wall,
        ),
      };
    }
    case "ADD_LIGHT": {
      const light = sanitizeLight(msg.light);
      if (!light || scene.lights.length >= MAX_LIGHTS) {
        return scene;
      }
      return { ...scene, lights: [...scene.lights, light] };
    }
    case "UPDATE_LIGHT": {
      const light = sanitizeLight(msg.light);
      if (!light) {
        return scene;
      }
      return {
        ...scene,
        lights: scene.lights.map((item) => (item.id === light.id ? light : item)),
      };
    }
    case "REMOVE_LIGHT":
      return { ...scene, lights: scene.lights.filter((light) => light.id !== msg.lightId) };
    case "FOG_SET":
      return {
        ...scene,
        fog: {
          ...scene.fog,
          enabled: Boolean(msg.enabled),
          ...(typeof msg.inverted === "boolean" ? { inverted: msg.inverted } : {}),
        },
      };
    case "FOG_REVEAL": {
      const shape = sanitizeFogReveal(msg.shape);
      if (!shape) {
        return scene;
      }
      const reveals: FogReveal[] = [...scene.fog.reveals, shape].slice(-MAX_FOG_REVEALS);
      return { ...scene, fog: { ...scene.fog, reveals } };
    }
    case "FOG_RESET":
      return { ...scene, fog: { ...scene.fog, reveals: [] } };
    case "ADD_ANNOTATION": {
      const sanitized = sanitizeAnnotation(msg.annotation);
      if (!sanitized || scene.annotations.some((item) => item.id === sanitized.id)) {
        return scene;
      }
      let annotations: Annotation[] = [...scene.annotations, sanitized];
      // Cap persistent objects by dropping the oldest (server behavior).
      const persistent = annotations.filter((item) => !item.ephemeral);
      if (persistent.length > MAX_SCENE_ANNOTATIONS) {
        const dropIds = new Set(
          persistent.slice(0, persistent.length - MAX_SCENE_ANNOTATIONS).map((item) => item.id),
        );
        annotations = annotations.filter((item) => !dropIds.has(item.id));
      }
      return { ...scene, annotations };
    }
    case "REMOVE_ANNOTATION": {
      if (!scene.annotations.some((item) => item.id === msg.annotationId)) {
        return scene;
      }
      return {
        ...scene,
        annotations: scene.annotations.filter((item) => item.id !== msg.annotationId),
      };
    }
    case "CLEAR_ANNOTATIONS":
      return scene.annotations.length > 0 ? { ...scene, annotations: [] } : scene;
    default:
      return scene;
  }
}

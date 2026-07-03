// Phase 6.5 WS smoke: prep secrecy + fog brush at the frame level — players receive
// ONLY the active scene and its tokens (prep invisible until Set Live); SET_SCENE swaps
// the player's single scene; brush/cover/inverted fog round-trips and stays DM-only;
// a full-scene UPDATE_SCENE (the editor's Apply path) carries walls+lights+fog at once.
const ROOM = `smoke65-${Date.now().toString(36)}`;
const URL_BASE = `ws://127.0.0.1:1999/parties/main/${ROOM}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function connect(label) {
  const ws = new WebSocket(URL_BASE);
  const frames = [];
  const waiters = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    frames.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error(`${label}: connect failed`)));
  });
  return {
    ws, frames, opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next: (pred, timeoutMs = 6000) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      }),
  };
}

const lastState = (c) => c.frames.filter((m) => m.type === "STATE").at(-1).state;
const sceneOf = (state, id) => state.scenes.find((s) => s.id === id);

try {
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 1);
  const vexId = slotFrame.state.playerSlots[0].id;
  const liveId = slotFrame.state.activeSceneId;

  const vex = connect("vex");
  await vex.opened;
  vex.send({ type: "JOIN", role: "player", slotId: vexId, roomKey: "" });
  await vex.next((m) => m.type === "JOINED");

  // --- prep secrecy: non-active scenes + their tokens never reach players -----------
  // (Fresh rooms start with more than one default scene — count, don't assume.)
  const initialScenes = slotFrame.state.scenes.length;
  dm.send({
    type: "ADD_SCENE",
    scene: { id: "scene-prep", name: "Ambush!", mapUrl: null, width: 800, height: 600 },
  });
  await dm.next(
    (m) => m.type === "STATE" && m.state.scenes.some((s) => s.id === "scene-prep"),
  );
  const baseToken = {
    x: 50, y: 50, color: "#c45c5c", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
  };
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-live", sceneId: liveId, label: "Guard" } });
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-prep", sceneId: "scene-prep", label: "Ambusher" } });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.length === 2);
  await vex.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-live"));
  {
    const pv = lastState(vex);
    check(
      "player receives ONLY the active scene",
      pv.scenes.length === 1 && pv.scenes[0].id === liveId &&
        lastState(dm).scenes.length === initialScenes + 1,
      `player scenes=${pv.scenes.map((s) => s.id).join(",")} dm=${lastState(dm).scenes.length}`,
    );
    check(
      "prepped scene's token absent from player frames",
      pv.tokens.length === 1 && pv.tokens[0].id === "tok-live",
      `player tokens=${pv.tokens.map((t) => t.id).join(",")}`,
    );
  }

  // Editing the prepped scene stays invisible to the player.
  dm.send({
    type: "SET_WALLS", sceneId: "scene-prep",
    walls: [{ id: "pw1", x1: 0, y1: 0, x2: 100, y2: 0, kind: "wall" }],
  });
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, "scene-prep")?.walls.length === 1,
  );
  check(
    "prep edits never reach the player",
    lastState(vex).scenes.every((s) => s.id === liveId),
  );

  // Set Live: the player's single scene swaps and the prep token appears.
  dm.send({ type: "SET_SCENE", sceneId: "scene-prep" });
  await vex.next(
    (m) => m.type === "STATE" && m.state.activeSceneId === "scene-prep" &&
      m.state.scenes.length === 1 && m.state.scenes[0].id === "scene-prep",
  );
  check(
    "Set Live swaps the player's scene atomically (walls included)",
    sceneOf(lastState(vex), "scene-prep").walls.length === 1 &&
      lastState(vex).tokens.some((t) => t.id === "tok-prep") &&
      !lastState(vex).tokens.some((t) => t.id === "tok-live"),
  );
  dm.send({ type: "SET_SCENE", sceneId: liveId });
  await vex.next((m) => m.type === "STATE" && m.state.activeSceneId === liveId);

  // --- fog brush + invert ------------------------------------------------------------
  dm.send({ type: "FOG_SET", sceneId: liveId, enabled: true, inverted: true });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, liveId)?.fog.enabled &&
      sceneOf(m.state, liveId)?.fog.inverted === true,
  );
  check("FOG_SET enabled + inverted propagates", true);

  dm.send({
    type: "FOG_REVEAL", sceneId: liveId,
    shape: { kind: "brush", points: [0, 0, 40, 40, 80, 40], r: 30, mode: "cover" },
  });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, liveId)?.fog.reveals.length === 1,
  );
  {
    const shape = sceneOf(lastState(vex), liveId).fog.reveals[0];
    check(
      "brush shape round-trips (kind/r/points/mode)",
      shape.kind === "brush" && shape.r === 30 && shape.points.length === 6 && shape.mode === "cover",
      JSON.stringify(shape),
    );
  }

  // Oversized brushes are trimmed server-side, not rejected.
  dm.send({
    type: "FOG_REVEAL", sceneId: liveId,
    shape: { kind: "brush", points: Array.from({ length: 400 }, (_, i) => i), r: 9 },
  });
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, liveId)?.fog.reveals.length === 2,
  );
  {
    const trimmed = sceneOf(lastState(dm), liveId).fog.reveals[1];
    check(
      "oversized brush points trimmed to 120",
      trimmed.kind === "brush" && trimmed.points.length === 120,
      `len=${trimmed.points?.length}`,
    );
  }

  vex.send({
    type: "FOG_REVEAL", sceneId: liveId,
    shape: { kind: "brush", points: [0, 0, 5, 5], r: 9 },
  });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("fog brush stays DM-only", true);

  // --- the editor's Apply path: one UPDATE_SCENE carrying everything -----------------
  const dmScene = sceneOf(lastState(dm), liveId);
  dm.send({
    type: "UPDATE_SCENE",
    scene: {
      ...dmScene,
      walls: [
        { id: "aw1", x1: 0, y1: 0, x2: 50, y2: 0, kind: "wall" },
        { id: "ad1", x1: 50, y1: 0, x2: 50, y2: 50, kind: "door", open: true },
      ],
      lights: [{ id: "al1", x: 10, y: 10, brightR: 15, dimR: 30, enabled: true }],
      fog: {
        enabled: true, inverted: false,
        reveals: [{ kind: "circle", x: 5, y: 5, r: 25, mode: "cover" }],
      },
    },
  });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, liveId)?.walls.length === 2 &&
      sceneOf(m.state, liveId)?.lights.length === 1,
  );
  {
    const applied = sceneOf(lastState(vex), liveId);
    check(
      "full-scene UPDATE_SCENE (Apply) carries walls+door-state+lights+fog at once",
      applied.walls.length === 2 &&
        applied.walls.find((w) => w.id === "ad1")?.open === true &&
        applied.lights.length === 1 &&
        applied.fog.inverted === false &&
        applied.fog.reveals.length === 1 &&
        applied.fog.reveals[0].mode === "cover",
      JSON.stringify({ walls: applied.walls.length, fog: applied.fog }),
    );
  }

  dm.ws.close();
  vex.ws.close();
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

// Phase 6 WS smoke: dynamic-vision protocol — walls/doors + lights are DM-only,
// reach players (needed for client-side LOS), enforce their caps, drop degenerate
// segments; door toggle flips open; global illumination + token vision propagate.
const ROOM = `smoke6-${Date.now().toString(36)}`;
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
  const sceneId = slotFrame.state.activeSceneId;

  const vex = connect("vex");
  await vex.opened;
  vex.send({ type: "JOIN", role: "player", slotId: vexId, roomKey: "" });
  await vex.next((m) => m.type === "JOINED");

  // --- walls + doors reach players (client computes its own vision) ----------------
  const w1 = { id: "w1", x1: 0, y1: 0, x2: 100, y2: 0, kind: "wall" };
  const d1 = { id: "d1", x1: 100, y1: 0, x2: 100, y2: 100, kind: "door" };
  dm.send({ type: "SET_WALLS", sceneId, walls: [w1, d1] });
  await vex.next((m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.walls.length === 2);
  check("DM walls/doors reach players", sceneOf(lastState(vex), sceneId).walls.length === 2);

  vex.send({ type: "SET_WALLS", sceneId, walls: [] });
  const wallErr = await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot edit walls", true, wallErr.message);

  // Door toggle flips open (and back), DM-only.
  dm.send({ type: "TOGGLE_DOOR", sceneId, wallId: "d1" });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.walls.find((w) => w.id === "d1")?.open === true,
  );
  check("door toggles open for everyone", true);
  vex.send({ type: "TOGGLE_DOOR", sceneId, wallId: "d1" });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot toggle doors", true);

  // Degenerate (zero-length) walls are dropped server-side.
  dm.send({
    type: "SET_WALLS",
    sceneId,
    walls: [w1, { id: "bad", x1: 50, y1: 50, x2: 50, y2: 50, kind: "wall" }],
  });
  // Prior state has 2 walls (w1, d1); wait for the post-set single-wall frame.
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.walls.length === 1,
  );
  const afterDegenerate = sceneOf(lastState(dm), sceneId).walls;
  check(
    "degenerate wall dropped, valid kept",
    afterDegenerate.length === 1 && afterDegenerate[0].id === "w1" &&
      !afterDegenerate.some((w) => w.id === "bad"),
    `walls=${afterDegenerate.map((w) => w.id).join(",")}`,
  );

  // Wall cap: 600, oldest dropped.
  const many = Array.from({ length: 605 }, (_, i) => ({
    id: `cap-${i}`, x1: i, y1: 0, x2: i, y2: 10, kind: "wall",
  }));
  dm.send({ type: "SET_WALLS", sceneId, walls: many });
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.walls.some((w) => w.id === "cap-604"),
    10_000,
  );
  const cappedWalls = sceneOf(lastState(dm), sceneId).walls;
  check(
    "walls capped at 600 (oldest dropped)",
    cappedWalls.length === 600 && !cappedWalls.some((w) => w.id === "cap-4") &&
      cappedWalls.some((w) => w.id === "cap-604"),
    `count=${cappedWalls.length}`,
  );
  dm.send({ type: "SET_WALLS", sceneId, walls: [] });
  await dm.next((m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.walls.length === 0);

  // --- lights: add / update / remove, DM-only, capped -----------------------------
  const light = { id: "L1", x: 50, y: 50, brightR: 20, dimR: 40, enabled: true };
  dm.send({ type: "ADD_LIGHT", sceneId, light });
  await vex.next((m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.lights.length === 1);
  check("DM light reaches players", sceneOf(lastState(vex), sceneId).lights[0].id === "L1");

  vex.send({ type: "ADD_LIGHT", sceneId, light: { ...light, id: "hacker" } });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot add lights", true);

  dm.send({ type: "UPDATE_LIGHT", sceneId, light: { ...light, brightR: 35 } });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.lights[0]?.brightR === 35,
  );
  check("light update propagates", true);

  dm.send({ type: "REMOVE_LIGHT", sceneId, lightId: "L1" });
  await vex.next((m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.lights.length === 0);
  check("light removal propagates", true);

  // Light cap: 50, then the next is rejected.
  for (let i = 0; i < 50; i += 1) {
    dm.send({ type: "ADD_LIGHT", sceneId, light: { id: `Lc${i}`, x: i, y: 0, brightR: 10, dimR: 20, enabled: true } });
  }
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.lights.length === 50,
    10_000,
  );
  dm.send({ type: "ADD_LIGHT", sceneId, light: { id: "overflow", x: 0, y: 0, brightR: 10, dimR: 20, enabled: true } });
  const capErr = await dm.next((m) => m.type === "ERROR" && /limit/i.test(m.message));
  check("light cap enforced at 50", sceneOf(lastState(dm), sceneId).lights.length === 50, capErr.message);

  // --- global illumination + token vision propagate to players --------------------
  const scene = sceneOf(lastState(dm), sceneId);
  dm.send({ type: "UPDATE_SCENE", scene: { ...scene, globalIllumination: false } });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.globalIllumination === false,
  );
  check("global illumination toggle reaches players", true);

  dm.send({
    type: "ADD_TOKEN",
    token: {
      id: "tok-vis", sceneId, x: 10, y: 10, label: "Vex", color: "#6ab0ff", kind: "player",
      imageUrl: null, ownerPlayerId: vexId, sheetId: null, conditions: [], showHp: "none",
    },
  });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-vis"));
  // Player-owned tokens default to vision {enabled, rangeFt:0}; confirm that reaches the
  // owner, then that an explicit darkvision range overrides it.
  check(
    "player token defaults to vision enabled (0ft)",
    lastState(dm).tokens.find((t) => t.id === "tok-vis")?.vision?.enabled === true,
  );
  dm.send({
    type: "UPDATE_TOKEN",
    token: { ...lastState(dm).tokens.find((t) => t.id === "tok-vis"), vision: { enabled: true, rangeFt: 60 } },
  });
  await vex.next(
    (m) => m.type === "STATE" && m.state.tokens.find((t) => t.id === "tok-vis")?.vision?.rangeFt === 60,
  );
  const vexVisTok = lastState(vex).tokens.find((t) => t.id === "tok-vis");
  check(
    "token vision (enabled + rangeFt) reaches its owner",
    vexVisTok?.vision?.enabled === true && vexVisTok.vision.rangeFt === 60,
    JSON.stringify(vexVisTok?.vision),
  );

  dm.ws.close();
  vex.ws.close();
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

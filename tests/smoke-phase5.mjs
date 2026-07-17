// Phase 5 WS smoke: map tools protocol — hidden-token redaction at the frame level,
// MEASURE relay (name/color, no self-echo, clear), annotations (player-forced ephemeral
// + TTL, author-only erase, persistent cap, DM clear), fog (DM-only reveals/reset),
// grid calibration fields, and hidden combatants masked as "???".
const ROOM = `smoke5-${Date.now().toString(36)}`;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  // --- hidden tokens stripped at the frame level -------------------------------
  const baseToken = {
    sceneId, x: 100, y: 100, color: "#c45c5c", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
  };
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-vis", label: "Guard" } });
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-hid", label: "Assassin", hidden: true } });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.length === 2);
  await vex.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-vis"));
  const vexTokens = lastState(vex).tokens;
  check(
    "hidden token absent from player frames, visible one present",
    vexTokens.length === 1 && vexTokens[0].id === "tok-vis" &&
      lastState(dm).tokens.length === 2,
    `player sees ${vexTokens.map((t) => t.id).join(",")}`,
  );

  dm.send({
    type: "UPDATE_TOKEN",
    token: { ...lastState(dm).tokens.find((t) => t.id === "tok-hid"), hidden: false },
  });
  await vex.next((m) => m.type === "STATE" && m.state.tokens.length === 2);
  check("unhiding reveals the token to players live", true);
  dm.send({
    type: "UPDATE_TOKEN",
    token: { ...lastState(dm).tokens.find((t) => t.id === "tok-hid"), hidden: true },
  });
  await vex.next((m) => m.type === "STATE" && m.state.tokens.length === 1);

  // --- MEASURE relay ------------------------------------------------------------
  vex.send({ type: "MEASURE", sceneId, points: [0, 0, 150, 100] });
  const dmMeasure = await dm.next((m) => m.type === "MEASURE");
  check(
    "player ruler relayed to DM with name + color",
    dmMeasure.name === "Vex" && typeof dmMeasure.color === "string" &&
      dmMeasure.points.length === 4 && dmMeasure.sceneId === sceneId,
    `name=${dmMeasure.name}`,
  );
  vex.send({ type: "MEASURE", sceneId, points: null });
  await dm.next((m) => m.type === "MEASURE" && m.points === null);
  check("ruler clear (null points) relayed", true);
  check(
    "measurer gets no echo of their own ruler",
    !vex.frames.some((m) => m.type === "MEASURE"),
  );

  // --- pointer arrow: always allowed for players, forced ephemeral ------------------
  vex.send({
    type: "ADD_ANNOTATION", sceneId,
    annotation: {
      id: "arw-vex", authorId: "spoofed", kind: "arrow", points: [0, 0, 60, 40, 120, 0],
      color: "#f0e6d2", width: 3, createdAt: 1, ephemeral: false, // both overridden
    },
  });
  const arwFrame = await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.some((a) => a.id === "arw-vex"),
  );
  const arw = sceneOf(arwFrame.state, sceneId).annotations.find((a) => a.id === "arw-vex");
  check(
    "player pointer arrow allowed by default + forced ephemeral + author re-stamped",
    arw.kind === "arrow" && arw.ephemeral === true && arw.authorId === vexId,
    `ephemeral=${arw.ephemeral} author=${arw.authorId}`,
  );

  // --- pointer arrows capped per author (oldest removed; client fades it out) --------
  // arw-vex is #1; add 5 more → the server keeps only the newest 5 per author. The
  // fade-out is client-local (a ghost), so at the WS level the oldest is simply gone.
  for (let i = 0; i < 5; i += 1) {
    vex.send({
      type: "ADD_ANNOTATION", sceneId,
      annotation: {
        id: `arw-cap-${i}`, authorId: "x", kind: "arrow", points: [i, i, i + 40, i + 40],
        color: "#f0e6d2", width: 3, createdAt: Date.now(), ephemeral: true,
      },
    });
  }
  const capFrame = await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.some((a) => a.id === "arw-cap-4"),
  );
  const myArrows = sceneOf(capFrame.state, sceneId).annotations.filter(
    (a) => a.kind === "arrow" && a.authorId === vexId,
  );
  check(
    "pointer arrows capped at 5 per author; the oldest (arw-vex) is dropped",
    myArrows.length === 5 && !myArrows.some((a) => a.id === "arw-vex") &&
      myArrows.some((a) => a.id === "arw-cap-4"),
    `count=${myArrows.length} ids=${myArrows.map((a) => a.id).join(",")}`,
  );

  // --- draw-tool permission: player stroke rejected by default, allowed once enabled --
  vex.send({
    type: "ADD_ANNOTATION", sceneId,
    annotation: {
      id: "ann-blocked", authorId: "spoofed", kind: "stroke", points: [0, 0, 40, 40],
      color: "#7cc4ff", width: 3, createdAt: 1, ephemeral: false,
    },
  });
  const drawErr = await vex.next((m) => m.type === "ERROR" && /enabled drawing/i.test(m.message));
  check("player Draw-tool stroke rejected when playersCanDraw is off", true, drawErr.message);

  vex.send({ type: "SET_PLAYERS_CAN_DRAW", enabled: true });
  const permErr = await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot toggle playersCanDraw", true, permErr.message);

  dm.send({ type: "SET_PLAYERS_CAN_DRAW", enabled: true });
  await vex.next((m) => m.type === "STATE" && m.state.playersCanDraw === true);
  vex.send({
    type: "ADD_ANNOTATION", sceneId,
    annotation: {
      id: "ann-vex", authorId: "spoofed", kind: "stroke", points: [0, 0, 50, 50, 100, 0],
      color: "#7cc4ff", width: 3, createdAt: 1, ephemeral: false, // both overridden
    },
  });
  const vexAnnFrame = await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.some((a) => a.id === "ann-vex"),
  );
  const vexAnn = sceneOf(vexAnnFrame.state, sceneId).annotations.find((a) => a.id === "ann-vex");
  check(
    "player stroke accepted once enabled, forced ephemeral + author re-stamped",
    vexAnn.ephemeral === true && vexAnn.authorId === vexId,
    `ephemeral=${vexAnn.ephemeral} author=${vexAnn.authorId}`,
  );

  dm.send({
    type: "ADD_ANNOTATION", sceneId,
    annotation: {
      id: "ann-dm", authorId: "dm", kind: "stroke", points: [10, 10, 60, 60],
      color: "#ffd166", width: 4, createdAt: Date.now(), ephemeral: false,
    },
  });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.some((a) => a.id === "ann-dm"),
  );
  check("DM persistent annotation reaches players", true);

  vex.send({ type: "REMOVE_ANNOTATION", sceneId, annotationId: "ann-dm" });
  const eraseErr = await vex.next((m) => m.type === "ERROR" && /own drawings/i.test(m.message));
  check("player cannot erase another author's drawing", true, eraseErr.message);

  console.log("  (waiting ~11s for the ephemeral annotation TTL…)");
  await sleep(11_000);
  const dmAnns = sceneOf(lastState(dm), sceneId).annotations;
  check(
    "player annotation auto-fades (~10s TTL); DM's persists",
    !dmAnns.some((a) => a.id === "ann-vex") && dmAnns.some((a) => a.id === "ann-dm"),
    `remaining=${dmAnns.map((a) => a.id).join(",")}`,
  );

  // Persistent cap: 200 per scene, oldest dropped.
  for (let i = 0; i < 205; i += 1) {
    dm.send({
      type: "ADD_ANNOTATION", sceneId,
      annotation: {
        id: `bulk-${i}`, authorId: "dm", kind: "stroke", points: [i, 0, i + 10, 10],
        color: "#fff", width: 2, createdAt: Date.now(), ephemeral: false,
      },
    });
  }
  await dm.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.some((a) => a.id === "bulk-204"),
    15_000,
  );
  const capped = sceneOf(lastState(dm), sceneId).annotations;
  check(
    "persistent annotations capped at 200 (oldest dropped)",
    capped.length === 200 && !capped.some((a) => a.id === "ann-dm") &&
      capped.some((a) => a.id === "bulk-204"),
    `count=${capped.length}`,
  );

  vex.send({ type: "CLEAR_ANNOTATIONS", sceneId });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot clear annotations", true);
  dm.send({ type: "CLEAR_ANNOTATIONS", sceneId });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.annotations.length === 0,
  );
  check("DM clears all annotations", true);

  // --- fog of war -----------------------------------------------------------------
  dm.send({ type: "FOG_SET", sceneId, enabled: true });
  await vex.next((m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.fog.enabled);
  dm.send({ type: "FOG_REVEAL", sceneId, shape: { kind: "rect", x: 0, y: 0, w: 100, h: 80 } });
  dm.send({ type: "FOG_REVEAL", sceneId, shape: { kind: "circle", x: 300, y: 200, r: 60 } });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.fog.reveals.length === 2,
  );
  check("fog enabled + rect/circle reveals reach players", true);

  vex.send({ type: "FOG_REVEAL", sceneId, shape: { kind: "rect", x: 0, y: 0, w: 9, h: 9 } });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot reveal fog", true);

  dm.send({ type: "FOG_RESET", sceneId });
  await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.fog.reveals.length === 0,
  );
  check("FOG_RESET re-covers the map", true);

  // --- grid calibration fields roundtrip -------------------------------------------
  dm.send({
    type: "UPDATE_SCENE",
    scene: { ...sceneOf(lastState(dm), sceneId), gridSize: 64, gridOffsetX: 13, gridOffsetY: 7, feetPerSquare: 10 },
  });
  const gridFrame = await vex.next(
    (m) => m.type === "STATE" && sceneOf(m.state, sceneId)?.gridOffsetX === 13,
  );
  const gridScene = sceneOf(gridFrame.state, sceneId);
  check(
    "grid calibration fields sync (size/offset/feet)",
    gridScene.gridSize === 64 && gridScene.gridOffsetY === 7 && gridScene.feetPerSquare === 10,
  );

  // --- hidden combatant masked -------------------------------------------------------
  dm.send({ type: "COMBAT_START", tokenIds: ["tok-vis", "tok-hid"] });
  await vex.next((m) => m.type === "STATE" && m.state.combat);
  // The DM's own combat frame can still be in flight when vex's resolves (bigger
  // unredacted payload) — await it too instead of reading lastState blind.
  await dm.next((m) => m.type === "STATE" && m.state.combat);
  const vexCombat = lastState(vex).combat;
  const dmCombat = lastState(dm).combat;
  check(
    "hidden combatant shows as ??? for players, real name for DM",
    vexCombat.entries.length === 2 &&
      vexCombat.entries.some((e) => e.name === "???") &&
      dmCombat.entries.some((e) => e.name === "Assassin"),
    `player sees [${vexCombat.entries.map((e) => e.name).join(", ")}]`,
  );

  dm.ws.close();
  vex.ws.close();
} catch (err) {
  check("smoke run completed", false, String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

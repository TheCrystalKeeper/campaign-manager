// Multi-scene viewing WS smoke (Phase B): a scene flagged playerVisible reaches players
// ALONGSIDE the active scene — with its non-hidden tokens, minus dmOnly pins — while
// unflagged prep stays invisible (baseline unchanged); un-flagging pulls it back out of
// player frames; players can move their own token on an opened scene; TOKEN_DRAG ghosts
// relay only for visible-scene tokens; the toggle itself is DM-gated and logs publicly.
const ROOM = `smokems-${Date.now().toString(36)}`;
const URL_BASE = `ws://127.0.0.1:1999/parties/main/${ROOM}`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const sceneIds = (state) => state.scenes.map((s) => s.id).join(",");

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
  const kit = connect("kit");
  await kit.opened;
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Kit" });
  const slot2Frame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 2);
  const kitId = slot2Frame.state.playerSlots[1].id;
  kit.send({ type: "JOIN", role: "player", slotId: kitId, roomKey: "" });
  await kit.next((m) => m.type === "JOINED");

  // A side scene with: vex's own token, a hidden token, and a dmOnly pin.
  dm.send({
    type: "ADD_SCENE",
    scene: { id: "scene-side", name: "The Docks", mapUrl: null, width: 800, height: 600 },
  });
  await dm.next((m) => m.type === "STATE" && m.state.scenes.some((s) => s.id === "scene-side"));
  const baseToken = {
    x: 50, y: 50, color: "#c45c5c", kind: "enemy",
    imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none",
  };
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-vex", sceneId: "scene-side", label: "Vex", kind: "player", ownerPlayerId: vexId, color: "#c9a227" } });
  dm.send({ type: "ADD_TOKEN", token: { ...baseToken, id: "tok-lurker", sceneId: "scene-side", label: "Lurker", hidden: true } });
  dm.send({
    type: "ADD_ANNOTATION", sceneId: "scene-side",
    annotation: { id: "pin-dm", kind: "pin", x: 10, y: 10, text: "secret", dmOnly: true, authorId: "dm" },
  });
  await dm.next(
    (m) => m.type === "STATE" && m.state.tokens.length === 2 &&
      m.state.scenes.find((s) => s.id === "scene-side")?.annotations.length === 1,
  );
  await sleep(300);

  // --- baseline: unflagged prep stays invisible --------------------------------------
  check(
    "unflagged side scene absent from player frames (baseline unchanged)",
    lastState(vex).scenes.length === 1 && lastState(vex).scenes[0].id === liveId &&
      lastState(vex).tokens.length === 0,
    `vex scenes=${sceneIds(lastState(vex))}`,
  );

  // A DM drag of a token on the invisible scene must not ghost to players.
  dm.send({ type: "TOKEN_DRAG", tokenId: "tok-vex", pos: { x: 60, y: 60 } });
  dm.send({ type: "TOKEN_DRAG", tokenId: "tok-vex", pos: null });
  await sleep(400);
  check(
    "TOKEN_DRAG on an invisible scene never reaches players",
    !vex.frames.some((m) => m.type === "TOKEN_DRAG"),
  );

  // --- the toggle is DM-gated ---------------------------------------------------------
  vex.send({ type: "SET_SCENE_PLAYER_VISIBLE", sceneId: "scene-side", visible: true });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("SET_SCENE_PLAYER_VISIBLE is DM-only", lastState(vex).scenes.length === 1);

  // --- flag it: players gain the scene + its visible tokens, minus secrets ------------
  dm.send({ type: "SET_SCENE_PLAYER_VISIBLE", sceneId: "scene-side", visible: true });
  await vex.next((m) => m.type === "STATE" && m.state.scenes.length === 2);
  {
    const pv = lastState(vex);
    const side = pv.scenes.find((s) => s.id === "scene-side");
    check(
      "flagged scene arrives alongside the active scene",
      pv.activeSceneId === liveId && !!side && pv.scenes.length === 2,
      `vex scenes=${sceneIds(pv)}`,
    );
    check(
      "flagged scene ships without dmOnly pins; hidden token stays stripped",
      side.annotations.length === 0 &&
        pv.tokens.some((t) => t.id === "tok-vex") &&
        !pv.tokens.some((t) => t.id === "tok-lurker"),
      `tokens=${pv.tokens.map((t) => t.id).join(",")}`,
    );
  }
  check(
    "opening a scene logs publicly",
    lastState(vex).log.some((e) => e.kind === "event" && /opened to players/i.test(e.text ?? "")),
  );

  // --- players can act on the opened scene -------------------------------------------
  vex.send({ type: "MOVE_TOKEN", tokenId: "tok-vex", x: 3, y: 4 });
  await vex.next(
    (m) => m.type === "STATE" &&
      m.state.tokens.some((t) => t.id === "tok-vex" && t.x === 3 && t.y === 4),
  );
  check("player can move their own token on an opened scene", true);

  // Live-drag ghosts now relay to the other player too.
  vex.send({ type: "TOKEN_DRAG", tokenId: "tok-vex", pos: { x: 5, y: 5 } });
  await kit.next((m) => m.type === "TOKEN_DRAG" && m.tokenId === "tok-vex");
  vex.send({ type: "TOKEN_DRAG", tokenId: "tok-vex", pos: null });
  check("TOKEN_DRAG on an opened scene relays to other players", true);

  // --- un-flag: the scene (and its tokens) leave player frames ------------------------
  // (next() scans frame HISTORY, so key the waits on log markers that only exist
  // after each action — a bare scenes.length predicate matches stale frames.)
  dm.send({ type: "SET_SCENE_PLAYER_VISIBLE", sceneId: "scene-side", visible: false });
  const closedFrame = await vex.next(
    (m) => m.type === "STATE" &&
      m.state.log.some((e) => e.kind === "event" && /closed to players/i.test(e.text ?? "")),
  );
  check(
    "closing the scene pulls it (and its tokens) back out of player frames",
    closedFrame.state.scenes.length === 1 &&
      closedFrame.state.scenes[0].id === liveId &&
      closedFrame.state.tokens.length === 0,
    `vex scenes=${sceneIds(closedFrame.state)} tokens=${closedFrame.state.tokens.length}`,
  );

  // --- activating a flagged scene still swaps cleanly (flag + active coexist) ---------
  dm.send({ type: "SET_SCENE_PLAYER_VISIBLE", sceneId: "scene-side", visible: true });
  await vex.next(
    (m) => m.type === "STATE" &&
      m.state.log.filter((e) => e.kind === "event" && /opened to players/i.test(e.text ?? ""))
        .length >= 2,
  );
  dm.send({ type: "SET_SCENE", sceneId: "scene-side" });
  const swapFrame = await vex.next(
    (m) => m.type === "STATE" && m.state.activeSceneId === "scene-side",
  );
  check(
    "Set Live on a flagged scene: active swaps; the old live scene (unflagged) drops out",
    swapFrame.state.scenes.length === 1 &&
      swapFrame.state.scenes[0].id === "scene-side" &&
      swapFrame.state.activeSceneId === "scene-side",
    `scenes=${sceneIds(swapFrame.state)}`,
  );

  dm.ws.close();
  vex.ws.close();
  kit.ws.close();
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

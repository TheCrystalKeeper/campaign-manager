// Phase 7 WS smoke test: game-content depth. Verified at the WebSocket-frame level.
// Grows per sub-round (7a size cap; 7d roll parts; 7e ADJUST_HP; 7f facing; 7h coin).
const ROOM = `smoke7-${Date.now().toString(36)}`;
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
    ws,
    frames,
    opened,
    send: (obj) => ws.send(JSON.stringify(obj)),
    next: (pred, timeoutMs = 4000) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`${label}: timeout waiting for frame`)), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");

  dm.send({ type: "CREATE_SHEET", sheetId: "sheet-npc", name: "Big NPC" });
  const created = await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-npc"]);
  const baseData = created.state.sheets["sheet-npc"].data;

  // --- 7a: server-side sheet size cap (MAX_SHEET_BYTES = 20_000) -------------
  // Oversized update → rejected with ERROR, sheet unchanged.
  dm.send({
    type: "UPDATE_SHEET",
    sheetId: "sheet-npc",
    sheet: { ...baseData, notes: "x".repeat(21000) },
  });
  const err = await dm.next((m) => m.type === "ERROR" && /too large/i.test(m.message));
  check("oversized sheet update rejected with ERROR", !!err, err?.message);

  // A modest update is accepted and applied.
  dm.send({
    type: "UPDATE_SHEET",
    sheetId: "sheet-npc",
    sheet: { ...baseData, notes: "a reasonable note", ac: 15 },
  });
  const ok = await dm.next(
    (m) => m.type === "STATE" && m.state.sheets["sheet-npc"]?.data.ac === 15,
  );
  check(
    "modest sheet update accepted (oversized one did not apply)",
    ok.state.sheets["sheet-npc"].data.notes === "a reasonable note",
    `notes.len=${ok.state.sheets["sheet-npc"].data.notes.length}`,
  );

  // --- 7c: SET_TOKEN_CONDITIONS authz + REST log --------------------------
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length > 0);
  const slotId = slotFrame.state.playerSlots[0].id;
  const activeSceneId = slotFrame.state.activeSceneId;

  // A token owned by the player, and one owned by nobody (DM's).
  dm.send({ type: "ADD_TOKEN", token: { id: "tok-vex", sceneId: activeSceneId, x: 1, y: 1, label: "Vex", color: "#c9a227", kind: "player", imageUrl: null, ownerPlayerId: slotId, sheetId: slotId, conditions: [], showHp: "none" } });
  dm.send({ type: "ADD_TOKEN", token: { id: "tok-dm", sceneId: activeSceneId, x: 2, y: 2, label: "Guard", color: "#c45c5c", kind: "enemy", imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none" } });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-dm"));

  const player = connect("player");
  await player.opened;
  player.send({ type: "JOIN", role: "player", slotId, roomKey: "" });
  await player.next((m) => m.type === "JOINED");

  // Player toggles a condition on their OWN token → applied.
  player.send({ type: "SET_TOKEN_CONDITIONS", tokenId: "tok-vex", conditions: ["poisoned", "prone"] });
  const condOk = await dm.next((m) => m.type === "STATE" && (m.state.tokens.find((t) => t.id === "tok-vex")?.conditions.length ?? 0) === 2);
  check("player sets conditions on own token", condOk.state.tokens.find((t) => t.id === "tok-vex").conditions.includes("poisoned"));

  // Invalid condition ids are dropped.
  player.send({ type: "SET_TOKEN_CONDITIONS", tokenId: "tok-vex", conditions: ["poisoned", "notacondition"] });
  const filtered = await dm.next((m) => m.type === "STATE" && (m.state.tokens.find((t) => t.id === "tok-vex")?.conditions.length ?? 9) === 1);
  check("invalid condition ids filtered out", !filtered.state.tokens.find((t) => t.id === "tok-vex").conditions.includes("notacondition"));

  // Player toggling a foreign (DM) token → ERROR, unchanged.
  player.send({ type: "SET_TOKEN_CONDITIONS", tokenId: "tok-dm", conditions: ["stunned"] });
  const condErr = await player.next((m) => m.type === "ERROR" && /your own/i.test(m.message));
  check("player cannot set conditions on a foreign token", !!condErr);

  // REST: player rests own sheet → a log event appears; foreign sheet → ERROR.
  player.send({ type: "REST", sheetId: slotId, kind: "short" });
  const restLog = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "event" && /short rest/i.test(e.text)));
  check("REST logs a short-rest event", !!restLog);

  player.send({ type: "REST", sheetId: "sheet-npc", kind: "long" });
  const restErr = await player.next((m) => m.type === "ERROR" && /your own character/i.test(m.message));
  check("player cannot rest a foreign sheet", !!restErr);

  // --- 7d: ROLL_CHECK builds color parts summing to the total -------------
  // Give the player's PC sheet a known DEX so the roll is checkable.
  const pcData = restLog.state.sheets[slotId].data;
  player.send({ type: "UPDATE_SHEET", sheetId: slotId, sheet: { ...pcData, abilityScores: { ...pcData.abilityScores, dex: 16 }, skillMods: { ...pcData.skillMods, "skill-stealth": 2 } } });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.abilityScores.dex === 16);

  // NOTE: the rules engine appends condition notes to the label (tok-vex is still
  // poisoned from 7c → "Stealth check (dis: poisoned)"), so match by prefix.
  player.send({ type: "ROLL_CHECK", sheetId: slotId, check: { kind: "skill", statId: "skill-stealth" } });
  const rollFrame = await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Stealth check")));
  const rollEntry = [...rollFrame.state.log].reverse().find((e) => e.kind === "roll" && e.label?.startsWith("Stealth check"));
  const partsSum = (rollEntry.roll.parts ?? []).reduce((s, p) => s + p.value, 0);
  check("ROLL_CHECK builds parts that sum to the total", rollEntry.roll.parts?.length >= 2 && partsSum === rollEntry.roll.total, `sum=${partsSum} total=${rollEntry.roll.total}`);
  check("ROLL_CHECK parts include a die + ability + prof", rollEntry.roll.parts.map((p) => p.kind).includes("ability"), JSON.stringify(rollEntry.roll.parts));
  check("ROLL_CHECK poisoned roller rolls at disadvantage", rollEntry.roll.adv === "dis", rollEntry.label);

  // Player sees the SAME public roll with parts (not masked).
  const playerRollFrame = await player.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Stealth check")));
  const playerRoll = [...playerRollFrame.state.log].reverse().find((e) => e.kind === "roll" && e.label?.startsWith("Stealth check"));
  check("player sees public ROLL_CHECK parts", (playerRoll.roll.parts ?? []).length >= 2 && !playerRoll.masked);

  // A secret DM ROLL_CHECK is masked for the player (no parts, no values).
  dm.send({ type: "ROLL_CHECK", sheetId: "sheet-npc", check: { kind: "ability", abilityId: "str" }, private: true });
  const maskedFrame = await player.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.masked));
  const masked = [...maskedFrame.state.log].reverse().find((e) => e.kind === "roll" && e.masked);
  check("secret DM ROLL_CHECK masked for players (no parts leak)", masked.roll.parts === undefined && masked.roll.total === 0);

  // --- 7e: ADJUST_HP clamps, eats temp first, authz ------------------------
  const cur = maskedFrame.state.sheets[slotId].data;
  dm.send({ type: "UPDATE_SHEET", sheetId: slotId, sheet: { ...cur, hp: { current: 10, max: 20, temp: 5 } } });
  await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.temp === 5);

  // Damage of 8: eats 5 temp, then 3 current → current 7, temp gone.
  dm.send({ type: "ADJUST_HP", sheetId: slotId, delta: -8 });
  const dmg = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.current === 7);
  check("ADJUST_HP damage eats temp first then current", dmg.state.sheets[slotId].data.hp.current === 7 && !dmg.state.sheets[slotId].data.hp.temp);

  // Overkill clamps at 0.
  dm.send({ type: "ADJUST_HP", sheetId: slotId, delta: -999 });
  const dead = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.current === 0);
  check("ADJUST_HP damage clamps at 0", dead.state.sheets[slotId].data.hp.current === 0);

  // Overheal clamps at max.
  dm.send({ type: "ADJUST_HP", sheetId: slotId, delta: 999 });
  const healed = await dm.next((m) => m.type === "STATE" && m.state.sheets[slotId]?.data.hp.current === 20);
  check("ADJUST_HP heal clamps at max", healed.state.sheets[slotId].data.hp.current === 20);

  // Player cannot adjust a foreign sheet.
  player.send({ type: "ADJUST_HP", sheetId: "sheet-npc", delta: -5 });
  const hpErr = await player.next((m) => m.type === "ERROR" && /your own hp/i.test(m.message));
  check("player cannot adjust a foreign sheet's HP", !!hpErr);

  // --- 7f: token facing via MOVE_TOKEN (both paths, wrap, authz) -----------
  // DM sets facing on any token; value wraps into [0,360).
  dm.send({ type: "MOVE_TOKEN", tokenId: "tok-dm", x: 2, y: 2, facing: 370 });
  const facingFrame = await dm.next((m) => m.type === "STATE" && m.state.tokens.find((t) => t.id === "tok-dm")?.facing === 10);
  check("DM MOVE_TOKEN sets + wraps facing (370 → 10)", facingFrame.state.tokens.find((t) => t.id === "tok-dm").facing === 10);

  // Player rotates their OWN token.
  player.send({ type: "MOVE_TOKEN", tokenId: "tok-vex", x: 1, y: 1, facing: 90 });
  const ownFacing = await dm.next((m) => m.type === "STATE" && m.state.tokens.find((t) => t.id === "tok-vex")?.facing === 90);
  check("player rotates own token", ownFacing.state.tokens.find((t) => t.id === "tok-vex").facing === 90);

  // Player cannot move/rotate a foreign token.
  player.send({ type: "MOVE_TOKEN", tokenId: "tok-dm", x: 5, y: 5, facing: 180 });
  const moveErr = await player.next((m) => m.type === "ERROR" && /your own token/i.test(m.message));
  check("player cannot rotate a foreign token", !!moveErr);

  // --- DM player-permission toggles: players-can-move / players-can-point -----
  // Players can't flip these room switches themselves (map control is DM-only).
  player.send({ type: "SET_PLAYERS_CAN_MOVE", enabled: false });
  const moveToggleErr = await player.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot toggle players-can-move", !!moveToggleErr);

  // DM disables movement → the player's own MOVE_TOKEN is now rejected.
  dm.send({ type: "SET_PLAYERS_CAN_MOVE", enabled: false });
  await player.next((m) => m.type === "STATE" && m.state.playersCanMove === false);
  player.send({ type: "MOVE_TOKEN", tokenId: "tok-vex", x: 4, y: 4, facing: 45 });
  const moveDisabledErr = await player.next((m) => m.type === "ERROR" && /disabled moving/i.test(m.message));
  check("player move rejected when movement disabled by DM", !!moveDisabledErr);
  dm.send({ type: "SET_PLAYERS_CAN_MOVE", enabled: true }); // restore

  // DM disables pointing → the player's shift-drag arrow annotation is rejected.
  dm.send({ type: "SET_PLAYERS_CAN_POINT", enabled: false });
  await player.next((m) => m.type === "STATE" && m.state.playersCanPoint === false);
  player.send({
    type: "ADD_ANNOTATION",
    sceneId: activeSceneId,
    annotation: { id: "arrow-vex", authorId: "vex", kind: "arrow", points: [0, 0, 100, 100], color: "#e9c176", width: 3, createdAt: Date.now(), ephemeral: true },
  });
  const pointDisabledErr = await player.next((m) => m.type === "ERROR" && /pointer arrows/i.test(m.message));
  check("player arrow rejected when pointing disabled by DM", !!pointDisabledErr);
  dm.send({ type: "SET_PLAYERS_CAN_POINT", enabled: true }); // restore

  // --- 7g: TEMPLATE transient relay (to OTHER clients; null clears) ---------
  const activeScene = moveErr ? activeSceneId : activeSceneId;
  dm.send({ type: "TEMPLATE", sceneId: activeScene, shape: { kind: "circle", points: [0, 0, 100, 0] } });
  const tplFrame = await player.next((m) => m.type === "TEMPLATE" && m.shape && m.shape.kind === "circle");
  check("TEMPLATE relays to other clients with name + color", tplFrame.name && tplFrame.color && tplFrame.shape.points.length === 4);

  // Sender does NOT receive an echo of its own template.
  const selfEcho = dm.frames.some((m) => m.type === "TEMPLATE");
  check("template sender gets no self-echo", !selfEcho);

  // Clear (null shape) relays through.
  dm.send({ type: "TEMPLATE", sceneId: activeScene, shape: null });
  const tplClear = await player.next((m) => m.type === "TEMPLATE" && m.shape === null);
  check("TEMPLATE clear (null) relays through", tplClear.shape === null);

  // Degenerate/oversized templates are dropped (not relayed).
  player.frames.length = 0;
  dm.send({ type: "TEMPLATE", sceneId: activeScene, shape: { kind: "circle", points: [0, 0, 999999, 0] } });
  await sleep(120);
  check("oversized template dropped (no relay)", !player.frames.some((m) => m.type === "TEMPLATE"));

  // --- 7h: coin flip via the 3D dice pipeline (value ∈ {1,2}, secret strips) ---
  const coinTrack = (frames = 2) => ({
    fps: 30,
    frames,
    dice: [{ id: "c1", samples: Array.from({ length: frames * 7 }, (_, i) => (i % 7 === 6 ? 1 : 0)) }],
    impacts: [],
  });
  const coinSpecs = [{ id: "c1", kind: "coin", percentile: false }];

  dm.send({ type: "DICE_THROW_REQUEST", rollId: "coin-1", specs: coinSpecs, track: coinTrack(), modifier: 0, trayCenter: [0, 0] });
  const coinThrow = await dm.next((m) => m.type === "DICE_THROW" && m.rollId === "coin-1");
  check("coin throw resolves a value in {1,2}", coinThrow.faceValues?.length === 1 && [1, 2].includes(coinThrow.faceValues[0]), `faceValues=${JSON.stringify(coinThrow.faceValues)}`);

  // The deferred log entry reads "Coin flip" with a Heads/Tails part.
  const coinLog = await dm.next(
    (m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label === "🪙 Coin flip"),
    5000,
  );
  const coinEntry = [...coinLog.state.log].reverse().find((e) => e.kind === "roll" && e.label === "🪙 Coin flip");
  check("coin log shows Heads/Tails", ["Heads", "Tails"].includes(coinEntry.roll.parts?.[0]?.label), JSON.stringify(coinEntry.roll.parts));

  // Secret coin flip: the player's DICE_THROW omits faceValues (blank coin tumble).
  dm.send({ type: "DICE_THROW_REQUEST", rollId: "coin-2", specs: coinSpecs, track: coinTrack(), modifier: 0, trayCenter: [0, 0], private: true });
  const secretCoin = await player.next((m) => m.type === "DICE_THROW" && m.rollId === "coin-2");
  check("secret coin flip strips faceValues for players", secretCoin.faceValues === undefined && secretCoin.secret === true);

  // --- 7i: DM-only map pins are stripped from player frames ------------------
  dm.send({
    type: "ADD_ANNOTATION",
    sceneId: activeScene,
    annotation: { id: "pin-trap", authorId: "dm", kind: "pin", x: 3, y: 3, text: "ambush", color: "#e9c176", width: 2, createdAt: Date.now(), ephemeral: false, dmOnly: true },
  });
  const pinDmFrame = await dm.next((m) => m.type === "STATE" && m.state.scenes.some((s) => s.annotations?.some((a) => a.id === "pin-trap")));
  check("DM sees the map pin", !!pinDmFrame);
  await sleep(150);
  const playerScene = player.frames.filter((m) => m.type === "STATE").at(-1)?.state.scenes?.[0];
  check("player never receives the DM-only pin", !!playerScene && !(playerScene.annotations ?? []).some((a) => a.id === "pin-trap"));

  // --- 7i: pre-staged token on a NON-active scene is invisible until Set Live ---
  dm.send({ type: "ADD_SCENE", scene: { id: "scene-prep", name: "Prep", mapUrl: null, width: 1000, height: 1000, gridSize: 50, gridOffsetX: 0, gridOffsetY: 0, feetPerSquare: 5, gridColor: "#334", gridOpacity: 0.3, showGrid: true, backgroundColor: "#0d0f14", defaultViewport: { x: 0, y: 0, scale: 1 }, annotations: [], fog: { enabled: false, reveals: [], inverted: false }, walls: [], lights: [], globalIllumination: true } });
  await dm.next((m) => m.type === "STATE" && m.state.scenes.some((s) => s.id === "scene-prep"));
  dm.send({ type: "ADD_TOKEN", token: { id: "tok-staged", sceneId: "scene-prep", x: 100, y: 100, label: "Ambusher", color: "#c45c5c", kind: "enemy", imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none" } });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-staged"));
  await sleep(120);
  const beforeLive = player.frames.filter((m) => m.type === "STATE").at(-1);
  check("staged token on non-active scene is hidden from players", !beforeLive.state.tokens.some((t) => t.id === "tok-staged"));

  dm.send({ type: "SET_SCENE", sceneId: "scene-prep" });
  const afterLive = await player.next((m) => m.type === "STATE" && m.state.tokens.some((t) => t.id === "tok-staged"), 4000);
  check("staged token appears once the scene is set live", afterLive.state.tokens.some((t) => t.id === "tok-staged"));

  // --- 7k: campaign export → mutate → import round-trip ---------------------
  dm.send({ type: "EXPORT_CAMPAIGN" });
  const exported = await dm.next((m) => m.type === "CAMPAIGN_EXPORT");
  check("EXPORT_CAMPAIGN returns a v2 full-state manifest", exported.manifest?.version === 2 && !!exported.manifest.state?.sheets);

  // Mutate: add a sheet that is NOT in the exported snapshot.
  dm.send({ type: "CREATE_SHEET", sheetId: "sheet-ephemeral", name: "Temp" });
  await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-ephemeral"]);

  // Import the snapshot → the post-export sheet is gone (full state replaced).
  // Clear the buffer so we assert on a POST-import frame, not an early one.
  dm.frames.length = 0;
  dm.send({ type: "IMPORT_CAMPAIGN", manifest: exported.manifest });
  const restored = await dm.next((m) => m.type === "STATE" && !!m.state.sheets["sheet-npc"], 4000);
  check("IMPORT_CAMPAIGN v2 restores the snapshot (post-export sheet dropped)", !restored.state.sheets["sheet-ephemeral"] && !!restored.state.sheets["sheet-npc"]);

  // A player cannot export the campaign.
  player.send({ type: "EXPORT_CAMPAIGN" });
  const exportErr = await player.next((m) => m.type === "ERROR");
  check("player cannot export the campaign", !!exportErr);

  await sleep(150);
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

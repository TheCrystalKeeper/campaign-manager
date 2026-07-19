// Roll-archive WS smoke test (Stats page): the server keeps a long roll history in
// chunked room storage, serves it via GET_ROLL_ARCHIVE with server-side secrecy
// filtering, and the DM's SET_REVEAL_SECRET_ROLLS switch shares/hides secret rolls
// in BOTH the archive and the live log. Verified at the WebSocket-frame level.
const ROOM = `smokestats-${Date.now().toString(36)}`;
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

  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length > 0);
  const slotId = slotFrame.state.playerSlots[0].id;

  const player = connect("player");
  await player.opened;
  player.send({ type: "JOIN", role: "player", slotId, roomKey: "" });
  await player.next((m) => m.type === "JOINED");

  // --- Produce four rolls: DM public, DM secret, player check, player death save ---
  dm.send({ type: "ROLL_DICE", expression: "1d20+3" });
  await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.roll.expression === "1d20+3"));

  dm.send({ type: "ROLL_DICE", expression: "2d6+1", private: true });
  await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.dmOnly));

  player.send({ type: "ROLL_CHECK", sheetId: slotId, check: { kind: "skill", statId: "skill-stealth" } });
  await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Stealth check")));

  player.send({ type: "DEATH_SAVE", sheetId: slotId });
  await dm.next((m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.label?.startsWith("Death saving throw")));

  // --- Player fetch: secret rolls excluded server-side ------------------------
  player.send({ type: "GET_ROLL_ARCHIVE" });
  const playerArchive = await player.next((m) => m.type === "ROLL_ARCHIVE");
  check("player archive excludes the secret roll", playerArchive.records.length === 3 && playerArchive.records.every((r) => !r.secret), `records=${playerArchive.records.length}`);
  check("archive total counts all rolls (secret included)", playerArchive.total === 4, `total=${playerArchive.total}`);

  const dmPublic = playerArchive.records.find((r) => r.who === "dm");
  check(
    "DM public roll: one kept d20, mod folded, total consistent",
    !!dmPublic &&
      dmPublic.dice.length === 1 &&
      dmPublic.dice[0][0] === 20 &&
      dmPublic.dice[0][1] >= 1 && dmPublic.dice[0][1] <= 20 &&
      dmPublic.mod === 3 &&
      dmPublic.total === dmPublic.dice[0][1] + 3,
    JSON.stringify(dmPublic),
  );
  const checkRec = playerArchive.records.find((r) => r.cat === "check");
  check("ROLL_CHECK archived with category 'check' and actor name", !!checkRec && checkRec.who === slotId && checkRec.name === "Vex", JSON.stringify(checkRec));
  const deathRec = playerArchive.records.find((r) => r.cat === "death");
  check("DEATH_SAVE archived with category 'death' and a d20", !!deathRec && deathRec.dice[0]?.[0] === 20, JSON.stringify(deathRec));

  // --- DM fetch: secret roll included with real values ------------------------
  dm.frames.length = 0;
  dm.send({ type: "GET_ROLL_ARCHIVE" });
  const dmArchive = await dm.next((m) => m.type === "ROLL_ARCHIVE");
  const secretRec = dmArchive.records.find((r) => r.secret);
  check(
    "DM archive includes the secret roll with real dice (2d6+1)",
    dmArchive.records.length === 4 &&
      !!secretRec &&
      secretRec.dice.length === 2 &&
      secretRec.dice.every(([sides, v]) => sides === 6 && v >= 1 && v <= 6) &&
      secretRec.mod === 1,
    JSON.stringify(secretRec),
  );

  // --- Reveal switch: DM-only ---------------------------------------------------
  player.send({ type: "SET_REVEAL_SECRET_ROLLS", enabled: true });
  const toggleErr = await player.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  check("player cannot flip the reveal switch", !!toggleErr);

  // DM enables → player's live log now carries the secret roll unmasked (dmOnly kept).
  player.frames.length = 0;
  dm.send({ type: "SET_REVEAL_SECRET_ROLLS", enabled: true });
  const revealed = await player.next((m) => m.type === "STATE" && m.state.revealSecretRolls === true);
  const unmaskedEntry = revealed.state.log.find((e) => e.kind === "roll" && e.dmOnly && !e.masked);
  check(
    "revealed secret roll reaches players unmasked, still flagged dmOnly",
    !!unmaskedEntry && unmaskedEntry.roll.expression === "2d6+1" && unmaskedEntry.roll.rolls.length === 2,
    JSON.stringify(unmaskedEntry?.roll ?? null),
  );

  player.send({ type: "GET_ROLL_ARCHIVE" });
  const revealedArchive = await player.next((m) => m.type === "ROLL_ARCHIVE");
  check("player archive includes secret rolls while revealed", revealedArchive.records.length === 4 && revealedArchive.records.some((r) => r.secret));

  // DM disables → masked again in live log, excluded from fetches.
  player.frames.length = 0;
  dm.send({ type: "SET_REVEAL_SECRET_ROLLS", enabled: false });
  const hidden = await player.next((m) => m.type === "STATE" && m.state.revealSecretRolls === false);
  const maskedEntry = hidden.state.log.find((e) => e.kind === "roll" && e.masked);
  check("secret roll masked again after the switch turns off", !!maskedEntry && maskedEntry.roll.total === 0 && maskedEntry.roll.rolls.length === 0);

  player.frames.length = 0;
  player.send({ type: "GET_ROLL_ARCHIVE" });
  const hiddenArchive = await player.next((m) => m.type === "ROLL_ARCHIVE");
  check("player archive excludes secret rolls again", hiddenArchive.records.length === 3 && hiddenArchive.records.every((r) => !r.secret));

  // --- Unjoined lobby socket cannot fetch --------------------------------------
  const lobby = connect("lobby");
  await lobby.opened;
  lobby.send({ type: "GET_ROLL_ARCHIVE" });
  const lobbyErr = await lobby.next((m) => m.type === "ERROR" && /join the room/i.test(m.message));
  check("unjoined socket cannot fetch the archive", !!lobbyErr);

  await sleep(150);
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
} finally {
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

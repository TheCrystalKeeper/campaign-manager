// Rename-sync WS smoke test: after a player renames their character via the sheet, every
// NEW server-stamped name follows immediately (no reconnect) — chat `from`, freeform roll
// attribution, the live MEASURE ruler label — and a mid-combat rename heals the initiative
// tracker for both the player token and an NPC sheet, while a concealed combatant still reads
// "???" in the player frame. Covers Fix 1 (displayNameFor) and Fix 2 (syncCombatNames).
const ROOM = `smokeRename-${Date.now().toString(36)}`;
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
    next: (pred, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(pred);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), timeoutMs);
        waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
      }),
  };
}

const lastState = (c) => c.frames.filter((m) => m.type === "STATE").at(-1).state;
const mkToken = (id, sceneId, extra = {}) => ({
  id, sceneId, x: 0, y: 0, label: id, color: "#c45c5c", kind: "enemy",
  imageUrl: null, ownerPlayerId: null, sheetId: null, conditions: [], showHp: "none", ...extra,
});
const rename = (client, sheetId, characterName) =>
  client.send({ type: "UPDATE_SHEET", sheetId, sheet: { characterName } });
const entryFor = (state, tokenId) => state.combat?.entries.find((e) => e.tokenId === tokenId);

try {
  // --- Setup: DM + one player, an NPC sheet, a player token and an NPC token ----------
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Player 1" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 1);
  const pid = slotFrame.state.playerSlots[0].id;
  const sceneId = slotFrame.state.activeSceneId;

  const pc = connect("pc");
  await pc.opened;
  pc.send({ type: "JOIN", role: "player", slotId: pid, roomKey: "" });
  await pc.next((m) => m.type === "JOINED");

  dm.send({ type: "CREATE_SHEET", sheetId: "sheet-gob", name: "Goblin" });
  await dm.next((m) => m.type === "STATE" && m.state.sheets["sheet-gob"]);
  dm.send({ type: "ADD_TOKEN", token: mkToken("tok-pc", sceneId, { kind: "player", ownerPlayerId: pid, label: "Player 1" }) });
  dm.send({ type: "ADD_TOKEN", token: mkToken("tok-gob", sceneId, { sheetId: "sheet-gob", label: "Goblin" }) });
  await dm.next((m) => m.type === "STATE" && m.state.tokens.length === 2);

  // --- 1. Sheet rename folds onto slot name + online roster ---------------------------
  rename(pc, pid, "Aragorn");
  const renamed = await dm.next(
    (m) => m.type === "STATE" && m.state.playerSlots[0]?.name === "Aragorn",
  );
  check(
    "sheet rename folds onto slot.name and connectedPlayers.displayName",
    renamed.state.playerSlots[0].name === "Aragorn" &&
      renamed.state.connectedPlayers.find((p) => p.playerId === pid)?.displayName === "Aragorn",
    JSON.stringify(renamed.state.connectedPlayers.map((p) => p.displayName)),
  );

  // --- 2. Chat `from` uses the current name (was stale before Fix 1) ------------------
  pc.send({ type: "SEND_CHAT", text: "hail and well met" });
  const chatFrame = await dm.next(
    (m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "chat" && e.text === "hail and well met"),
  );
  const chat = chatFrame.state.log.find((e) => e.kind === "chat" && e.text === "hail and well met");
  check("chat from = current character name", chat.from === "Aragorn", chat.from);

  // --- 3. Freeform roll attribution uses the current name -----------------------------
  pc.send({ type: "ROLL_DICE", expression: "1d20" });
  const rollFrame = await dm.next(
    (m) => m.type === "STATE" && m.state.log.some((e) => e.kind === "roll" && e.roll?.expression === "1d20"),
  );
  const roll = rollFrame.state.log.find((e) => e.kind === "roll" && e.roll?.expression === "1d20");
  check(
    "freeform roll actor + rollerName = current name",
    roll.actor.name === "Aragorn" && roll.roll.rollerName === "Aragorn",
    `${roll.actor.name} / ${roll.roll.rollerName}`,
  );

  // --- 4. Live MEASURE ruler label uses the current name (relayed to other clients) ---
  pc.send({ type: "MEASURE", sceneId, points: [0, 0, 100, 100] });
  const measure = await dm.next((m) => m.type === "MEASURE");
  check("MEASURE ruler label = current name", measure.name === "Aragorn", measure.name);

  // --- 5. Mid-combat rename heals the initiative tracker (player token + NPC sheet) ---
  dm.send({ type: "COMBAT_START", tokenIds: ["tok-pc", "tok-gob"] });
  const started = await dm.next(
    (m) => m.type === "STATE" && m.state.combat && m.state.combat.entries.length === 2,
  );
  check("combat entry snapshots the name at start", entryFor(started.state, "tok-pc")?.name === "Aragorn");

  rename(pc, pid, "Strider");
  const pcHealed = await dm.next(
    (m) => m.type === "STATE" && entryFor(m.state, "tok-pc")?.name === "Strider",
  );
  check("mid-combat rename heals the player's initiative entry", !!pcHealed);

  rename(dm, "sheet-gob", "Hobgoblin");
  const gobHealed = await dm.next(
    (m) => m.type === "STATE" && entryFor(m.state, "tok-gob")?.name === "Hobgoblin",
  );
  check("mid-combat NPC rename heals its initiative entry", !!gobHealed);

  // --- 6. A concealed combatant still reads "???" in the player frame -----------------
  const gobToken = lastState(dm).tokens.find((t) => t.id === "tok-gob");
  dm.send({ type: "UPDATE_TOKEN", token: { ...gobToken, nameConcealed: true } });
  const concealed = await pc.next(
    (m) => m.type === "STATE" && entryFor(m.state, "tok-gob")?.name === "???",
  );
  check("player sees the concealed NPC entry as ???", !!concealed);
  check(
    "DM still sees the concealed NPC's healed name",
    entryFor(lastState(dm), "tok-gob")?.name === "Hobgoblin",
    entryFor(lastState(dm), "tok-gob")?.name,
  );

  dm.ws.close();
  pc.ws.close();
} catch (err) {
  check("smoke run completed", false, String(err));
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

// Handouts WS smoke: the library is DM-authored state with per-player redaction —
// players receive ONLY handouts granted to them ("all" or their slot id) and the lobby
// none; SHOW_HANDOUT pops a self-contained HANDOUT_SHOW push at ONLY the targeted,
// joined players and auto-grants lasting visibility; subset shares log DM-only (no
// leak via the shared log); handout messages stay DM-gated; exports carry the library.
const ROOM = `smokehand-${Date.now().toString(36)}`;
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
const handoutIds = (state) => state.handouts.map((h) => h.id).join(",");

try {
  const dm = connect("dm");
  await dm.opened;
  dm.send({ type: "JOIN", role: "dm", displayName: "DM", roomKey: "" });
  await dm.next((m) => m.type === "JOINED");
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Vex" });
  dm.send({ type: "ADD_PLAYER_SLOT", name: "Kit" });
  const slotFrame = await dm.next((m) => m.type === "STATE" && m.state.playerSlots.length === 2);
  const [vexId, kitId] = slotFrame.state.playerSlots.map((s) => s.id);

  const vex = connect("vex");
  await vex.opened;
  vex.send({ type: "JOIN", role: "player", slotId: vexId, roomKey: "" });
  await vex.next((m) => m.type === "JOINED");
  const kit = connect("kit");
  await kit.opened;
  kit.send({ type: "JOIN", role: "player", slotId: kitId, roomKey: "" });
  await kit.next((m) => m.type === "JOINED");

  // --- an ungranted handout is DM-only state --------------------------------------
  dm.send({
    type: "ADD_HANDOUT",
    handout: {
      id: "h-letter", name: "Sealed letter", imageUrl: "/tokens/letter.webp",
      visibleTo: [], createdAt: Date.now(),
    },
  });
  await dm.next((m) => m.type === "STATE" && m.state.handouts.length === 1);
  await sleep(300);
  check(
    "ungranted handout reaches the DM only",
    lastState(dm).handouts.length === 1 &&
      lastState(vex).handouts.length === 0 &&
      lastState(kit).handouts.length === 0,
    `dm=${handoutIds(lastState(dm))} vex=${handoutIds(lastState(vex))}`,
  );
  check(
    "library add logs DM-only (players' logs untouched)",
    lastState(dm).log.some((e) => e.kind === "event" && /handout/i.test(e.text ?? "")) &&
      !lastState(vex).log.some((e) => e.kind === "event" && /handout/i.test(e.text ?? "")),
  );

  // Lobby connections never see handouts.
  const lobby = connect("lobby");
  await lobby.opened;
  await lobby.next((m) => m.type === "STATE");
  check("lobby stub carries no handouts", lastState(lobby).handouts.length === 0);
  lobby.ws.close();

  // --- UPDATE_HANDOUT visibility grant: only the granted player gains it -----------
  dm.send({
    type: "UPDATE_HANDOUT",
    handout: {
      id: "h-letter", name: "Sealed letter", imageUrl: "/tokens/letter.webp",
      visibleTo: [vexId], createdAt: 1,
    },
  });
  await vex.next((m) => m.type === "STATE" && m.state.handouts.length === 1);
  await sleep(300);
  check(
    "visibility grant reaches the granted player, not the other",
    lastState(vex).handouts[0]?.id === "h-letter" && lastState(kit).handouts.length === 0,
    `vex=${handoutIds(lastState(vex))} kit=${handoutIds(lastState(kit))}`,
  );

  // --- SHOW_HANDOUT subset: targeted push + DM-only log ----------------------------
  dm.send({ type: "SHOW_HANDOUT", handoutId: "h-letter", to: [vexId] });
  const push = await vex.next((m) => m.type === "HANDOUT_SHOW");
  check(
    "targeted player receives a self-contained HANDOUT_SHOW push",
    push.handout.id === "h-letter" && push.handout.name === "Sealed letter" &&
      push.handout.imageUrl === "/tokens/letter.webp",
    JSON.stringify(push.handout),
  );
  await sleep(400);
  check(
    "untargeted player and DM get no push",
    !kit.frames.some((m) => m.type === "HANDOUT_SHOW") &&
      !dm.frames.some((m) => m.type === "HANDOUT_SHOW"),
  );
  check(
    "subset share logs DM-only (kit's log has no 'shared' entry)",
    lastState(dm).log.some((e) => e.kind === "event" && /shared/i.test(e.text ?? "")) &&
      !lastState(kit).log.some((e) => e.kind === "event" && /shared/i.test(e.text ?? "")),
  );

  // --- SHOW_HANDOUT to all: auto-grants "all", pushes to everyone joined ------------
  dm.send({ type: "SHOW_HANDOUT", handoutId: "h-letter", to: "all" });
  await kit.next((m) => m.type === "HANDOUT_SHOW");
  await kit.next((m) => m.type === "STATE" && m.state.handouts.length === 1);
  check(
    "show-to-all auto-grants lasting visibility (kit now has it in state)",
    lastState(kit).handouts[0]?.id === "h-letter" &&
      lastState(dm).handouts[0]?.visibleTo === "all",
    `kit=${handoutIds(lastState(kit))} visibleTo=${JSON.stringify(lastState(dm).handouts[0]?.visibleTo)}`,
  );
  check(
    "show-to-all logs publicly",
    lastState(kit).log.some((e) => e.kind === "event" && /shared/i.test(e.text ?? "")),
  );

  // --- revoke: narrowing visibleTo pulls it back out of the de-selected player -------
  // (Client-side, losing the handout from state also closes their open popup.)
  dm.send({
    type: "UPDATE_HANDOUT",
    handout: {
      id: "h-letter", name: "Sealed letter", imageUrl: "/tokens/letter.webp",
      visibleTo: [vexId], createdAt: 1,
    },
  });
  await kit.next(
    (m) => m.type === "STATE" && m.state.handouts.length === 0 &&
      m.state.log.some((e) => /shared/i.test(e.text ?? "")),
  );
  await vex.next(
    (m) => m.type === "STATE" &&
      m.state.handouts.some((h) => h.id === "h-letter" && Array.isArray(h.visibleTo)),
  );
  check(
    "revoking a player removes the handout from their frames only",
    lastState(kit).handouts.length === 0 && lastState(vex).handouts.length === 1,
    `kit=${handoutIds(lastState(kit))} vex=${handoutIds(lastState(vex))}`,
  );

  // --- authz: handout messages stay DM-gated ----------------------------------------
  vex.send({
    type: "ADD_HANDOUT",
    handout: { id: "h-evil", name: "Forged", imageUrl: null, visibleTo: "all", createdAt: 1 },
  });
  await vex.next((m) => m.type === "ERROR" && /only the dm/i.test(m.message));
  vex.send({ type: "SHOW_HANDOUT", handoutId: "h-letter", to: "all" });
  await vex.next(
    (m, i, arr) => m.type === "ERROR" && /only the dm/i.test(m.message) &&
      vex.frames.filter((f) => f.type === "ERROR").length >= 2,
  );
  check("ADD_HANDOUT / SHOW_HANDOUT are DM-only", lastState(dm).handouts.length === 1);

  // --- export carries the library ----------------------------------------------------
  dm.send({ type: "EXPORT_CAMPAIGN" });
  const exported = await dm.next((m) => m.type === "CAMPAIGN_EXPORT");
  check(
    "EXPORT_CAMPAIGN carries handouts",
    exported.manifest.state.handouts?.length === 1 &&
      exported.manifest.state.handouts[0].id === "h-letter",
  );

  // --- REMOVE_HANDOUT disappears everywhere ------------------------------------------
  dm.send({ type: "REMOVE_HANDOUT", handoutId: "h-letter" });
  await vex.next((m) => m.type === "STATE" && m.state.handouts.length === 0);
  await kit.next((m) => m.type === "STATE" && m.state.handouts.length === 0);
  await dm.next((m) => m.type === "STATE" && m.state.handouts.length === 0);
  check("REMOVE_HANDOUT clears it from every client", true);

  dm.ws.close();
  vex.ws.close();
  kit.ws.close();
} catch (err) {
  check(`unexpected error: ${err.message}`, false);
}

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0 ? "\nALL CHECKS PASSED" : `\n${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);

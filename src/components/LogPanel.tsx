import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Swords } from "lucide-react";
import { formatDiceRoll } from "../lib/dice";
import type { LogEntry, PlayerSlot, SheetRecord } from "../lib/types";

type LogPanelProps = {
  log: LogEntry[];
  isDm: boolean;
  yourPlayerId: string | null;
  playerSlots: PlayerSlot[];
  onSendChat: (text: string, whisperTo?: string) => void;
  /** DM-only (Tier 3): targets for the damage-apply action on damage rolls. */
  sheets?: Record<string, SheetRecord>;
  onApplyDamage?: (sheetId: string, amount: number, damageType?: string) => void;
};

/**
 * Mirror of the server's damage adjustment (immune = 0, resist = half, vulnerable =
 * double; fuzzy pill match) so the DM sees the outcome BEFORE applying.
 */
function previewDamage(record: SheetRecord, amount: number, damageType: string): { final: number; note: string } {
  const dt = damageType.trim().toLowerCase();
  const matches = (pills: string[]) =>
    dt !== "" &&
    pills.some((pill) => {
      const p = pill.trim().toLowerCase();
      return p.length > 0 && (p.includes(dt) || dt.includes(p));
    });
  if (matches(record.data.immunities)) return { final: 0, note: "immune" };
  let final = amount;
  const notes: string[] = [];
  if (matches(record.data.resistances)) {
    final = Math.floor(final / 2);
    notes.push("resistant");
  }
  if (matches(record.data.vulnerabilities)) {
    final *= 2;
    notes.push("vulnerable");
  }
  return { final, note: notes.join(", ") };
}

type LogFilter = "all" | "rolls" | "chat";

type WhisperTarget = { id: string; name: string };

/// <summary>
/// Resolves the "<name> <message>" tail of a `/w` command against the viewer's
/// available whisper targets. Prefers the longest full-name match so multi-word
/// character names resolve cleanly (and don't leak into the message); falls back to a
/// single-token name prefix so partially-typed names still work. Returns "incomplete"
/// when a name matched but no message follows, or null when nothing matches.
/// </summary>
function resolveWhisper(
  rest: string,
  targets: WhisperTarget[],
): { targetId: string; message: string } | "incomplete" | null {
  const lower = rest.toLowerCase();
  let best: WhisperTarget | null = null;
  for (const target of targets) {
    const name = target.name.toLowerCase();
    const matches = lower === name || lower.startsWith(`${name} `);
    if (matches && (!best || target.name.length > best.name.length)) {
      best = target;
    }
  }
  if (best) {
    const message = rest.slice(best.name.length).trim();
    return message ? { targetId: best.id, message } : "incomplete";
  }
  const token = rest.match(/^(\S+)\s+([\s\S]+)$/);
  if (token) {
    const prefix = targets.find((target) => target.name.toLowerCase().startsWith(token[1].toLowerCase()));
    if (prefix) return { targetId: prefix.id, message: token[2].trim() };
  }
  return null;
}

/** Regex capturing an in-progress `/w` target (before the message): `/w`, `/w `, `/w al`. */
const WHISPER_COMPOSE_RE = /^\/w(?:hisper)?(?:\s+(\S*))?$/i;

/// <summary>
/// The unified roll/action/chat feed with a chat input. Whispers use
/// `/w name message`; what each viewer sees is already filtered server-side.
/// </summary>
export function LogPanel({ log, isDm, yourPlayerId, playerSlots, onSendChat, sheets, onApplyDamage }: LogPanelProps) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  // Damage-apply flyout state (DM): which roll entry is open, target + typed damage type.
  const [applyFor, setApplyFor] = useState<string | null>(null);
  const [applyTarget, setApplyTarget] = useState("");
  const [applyType, setApplyType] = useState("");
  // Whisper autocomplete: highlighted recipient, and whether the user dismissed the popup (Esc).
  const [whisperHighlight, setWhisperHighlight] = useState(0);
  const [whisperDismissed, setWhisperDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const slotName = (id: string) =>
    id === "dm" ? "DM" : (playerSlots.find((slot) => slot.id === id)?.name ?? "player");

  // Who this viewer can whisper to: players whisper the DM + everyone else; the DM whispers
  // any player. Your own slot is never a target.
  const whisperTargets = useMemo<WhisperTarget[]>(() => {
    const targets: WhisperTarget[] = [];
    if (!isDm) targets.push({ id: "dm", name: "DM" });
    for (const slot of playerSlots) {
      if (slot.id !== yourPlayerId) targets.push({ id: slot.id, name: slot.name });
    }
    return targets;
  }, [isDm, playerSlots, yourPlayerId]);

  // Popup state, derived from the input each render. `compose` is non-null only while the
  // caret is still on the `/w` recipient token (before the message begins).
  const compose = text.match(WHISPER_COMPOSE_RE);
  const whisperQuery = compose?.[1] ?? "";
  const whisperMatches = compose
    ? whisperTargets.filter((target) => target.name.toLowerCase().startsWith(whisperQuery.toLowerCase()))
    : [];
  const showWhisperPopup = compose !== null && whisperMatches.length > 0 && !whisperDismissed;
  const activeWhisper = whisperMatches.length ? Math.min(whisperHighlight, whisperMatches.length - 1) : 0;

  // Reset the highlight to the top whenever the filtered recipient list changes.
  useEffect(() => {
    setWhisperHighlight(0);
  }, [whisperQuery, whisperMatches.length]);

  // Fill the input with `/w <name> ` so the user only has to type the message.
  const applyWhisperTarget = (target: WhisperTarget) => {
    setText(`/w ${target.name} `);
    setInputError(null);
    setWhisperDismissed(false);
    inputRef.current?.focus();
  };

  const visible = log.filter((entry) => {
    if (filter === "rolls") return entry.kind === "roll";
    if (filter === "chat") return entry.kind === "chat";
    return true;
  });

  const submit = () => {
    const raw = text.trim();
    if (!raw) {
      return;
    }
    const whisperMatch = raw.match(/^\/w(?:hisper)?\s+([\s\S]+)$/i);
    if (whisperMatch) {
      const resolved = resolveWhisper(whisperMatch[1], whisperTargets);
      if (resolved === "incomplete") {
        setInputError("Add a message after the name.");
        return;
      }
      if (!resolved) {
        setInputError("No matching recipient. Try /w dm or a character name.");
        return;
      }
      onSendChat(resolved.message, resolved.targetId);
    } else if (raw.startsWith("/")) {
      setInputError("Unknown command. Whisper with: /w name message");
      return;
    } else {
      onSendChat(raw);
    }
    setText("");
    setInputError(null);
  };

  return (
    <div className="panel-body stack log-panel">
      <div className="row">
        {(["all", "rolls", "chat"] as const).map((id) => (
          <button
            key={id}
            className={`chip-btn ${filter === id ? "btn-active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {id === "all" ? "All" : id === "rolls" ? "Rolls" : "Chat"}
          </button>
        ))}
      </div>

      <div className="log-feed">
        {visible.length === 0 ? <span className="muted">Nothing here yet.</span> : null}
        {[...visible].reverse().map((entry) => {
          if (entry.kind === "event") {
            return (
              <div className="log-event" key={entry.id}>
                {entry.dmOnly ? <Lock size={11} strokeWidth={2.2} /> : null}{entry.dmOnly ? " " : ""}
                {entry.text}
              </div>
            );
          }
          if (entry.kind === "chat") {
            // A whisper addressed to the viewer reads "(whisper to You)" and glows gold
            // (--primary-strong) instead of the viewer's accent, so incoming whispers stand out.
            const whisperedToYou = !!entry.whisperTo && entry.whisperTo === yourPlayerId;
            const whisper = entry.whisperTo
              ? ` (whisper to ${whisperedToYou ? "You" : slotName(entry.whisperTo)})`
              : "";
            return (
              <div
                className={`log-chat${entry.whisperTo ? " log-whisper" : ""}${
                  whisperedToYou ? " log-whisper--to-you" : ""
                }`}
                key={entry.id}
              >
                <b>{entry.fromId === yourPlayerId ? "You" : entry.from}</b>
                <span className="muted">{whisper}</span>: {entry.text}
              </div>
            );
          }
          if (entry.masked) {
            return (
              <div className="roll roll--masked" key={entry.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="who"><Lock size={11} strokeWidth={2.2} /> {entry.actor.name}</span>
                  <span className="total">?</span>
                </div>
                <span className="expr">rolled in secret</span>
              </div>
            );
          }
          return (
            <div className="roll" key={entry.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="who">
                  {entry.dmOnly ? <Lock size={11} strokeWidth={2.2} /> : null}{entry.dmOnly ? " " : ""}
                  {entry.actor.name}
                  {entry.label ? <span className="muted"> — {entry.label}</span> : null}
                </span>
                <span className="total">{entry.roll.total}</span>
              </div>
              {entry.roll.parts && entry.roll.parts.length > 0 ? (
                <div className="roll-parts">
                  {entry.roll.parts.map((part, i) => (
                    <span key={i} className={`roll-chip roll-chip--${part.kind}`} title={part.kind}>
                      {part.label ? <span className="roll-chip-label">{part.label}</span> : null}
                      <span className="roll-chip-value">
                        {i > 0 && part.value >= 0 ? "+" : ""}
                        {part.value}
                      </span>
                    </span>
                  ))}
                  {entry.roll.adv ? (
                    <span className="roll-chip roll-chip--adv" title="Advantage/disadvantage">
                      {entry.roll.adv === "adv" ? "adv" : "dis"} · dropped {entry.roll.otherTotal}
                    </span>
                  ) : null}
                  {entry.roll.crit ? (
                    <span className="roll-chip roll-chip--crit" title="Critical hit — Shift-click the damage roll for crit dice">
                      CRIT
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="expr">{formatDiceRoll(entry.roll)}</span>
              )}
              {onApplyDamage && sheets && entry.label?.toLowerCase().includes("damage") ? (
                <div className="dmg-apply">
                  {applyFor === entry.id ? (
                    <>
                      <select value={applyTarget} aria-label="Damage target" onChange={(e) => setApplyTarget(e.target.value)}>
                        <option value="">Target…</option>
                        {Object.values(sheets)
                          .sort((a, b) => (a.data.characterName || "").localeCompare(b.data.characterName || ""))
                          .map((record) => (
                            <option key={record.id} value={record.id}>
                              {record.data.characterName || "Unnamed"}
                            </option>
                          ))}
                      </select>
                      <input
                        className="dmg-type"
                        value={applyType}
                        placeholder="type (fire…)"
                        aria-label="Damage type"
                        onChange={(e) => setApplyType(e.target.value)}
                      />
                      {applyTarget && sheets[applyTarget] ? (
                        (() => {
                          const preview = previewDamage(sheets[applyTarget], entry.roll.total, applyType);
                          return (
                            <button
                              type="button"
                              className="btn-ghost dmg-go"
                              title={preview.note ? `${entry.roll.total} → ${preview.final} (${preview.note})` : `${preview.final} damage`}
                              onClick={() => {
                                onApplyDamage(applyTarget, entry.roll.total, applyType.trim() || undefined);
                                setApplyFor(null);
                              }}
                            >
                              Apply {preview.final}
                              {preview.note ? ` (${preview.note})` : ""}
                            </button>
                          );
                        })()
                      ) : null}
                      <button type="button" className="btn-ghost" onClick={() => setApplyFor(null)}>✕</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost dmg-open"
                      title="Apply this damage to a character (resistances respected)"
                      onClick={() => {
                        setApplyFor(entry.id);
                        setApplyTarget("");
                        setApplyType("");
                      }}
                    >
                      <Swords size={13} strokeWidth={2.2} /> Apply
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="stack" style={{ gap: "0.25rem" }}>
        <div className="whisper-anchor">
          {showWhisperPopup ? (
            <div className="whisper-menu" role="listbox" aria-label="Whisper to">
              {whisperMatches.map((target, i) => (
                <div
                  key={target.id}
                  role="option"
                  aria-selected={i === activeWhisper}
                  className={`whisper-option${i === activeWhisper ? " is-active" : ""}`}
                  onMouseEnter={() => setWhisperHighlight(i)}
                  // onMouseDown (not onClick) so the input keeps focus through the selection.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyWhisperTarget(target);
                  }}
                >
                  <span className="whisper-option__name">{target.name}</span>
                  {target.id === "dm" ? <span className="whisper-option__tag">DM</span> : null}
                </div>
              ))}
              <div className="whisper-menu__hint" aria-hidden="true">
                ↑↓ move · Tab / Enter to select · Esc to dismiss
              </div>
            </div>
          ) : null}
          <div className="row">
            <input
              ref={inputRef}
              value={text}
              placeholder={isDm ? "Message… (/w name to whisper)" : "Message… (/w dm to whisper)"}
              onChange={(e) => {
                setText(e.target.value);
                setInputError(null);
                setWhisperDismissed(false);
              }}
              onKeyDown={(e) => {
                if (showWhisperPopup) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setWhisperHighlight((i) => (i + 1) % whisperMatches.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setWhisperHighlight((i) => (i - 1 + whisperMatches.length) % whisperMatches.length);
                    return;
                  }
                  if (e.key === "Tab" || e.key === "Enter") {
                    // The whisper isn't sendable yet (no message), so both keys select the recipient.
                    e.preventDefault();
                    applyWhisperTarget(whisperMatches[activeWhisper]);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setWhisperDismissed(true);
                    return;
                  }
                }
                if (e.key === "Enter") submit();
              }}
              aria-label="Chat message"
            />
            <button className="btn-primary" onClick={submit}>
              Send
            </button>
          </div>
        </div>
        {inputError ? <span className="input-error">{inputError}</span> : null}
      </div>
    </div>
  );
}

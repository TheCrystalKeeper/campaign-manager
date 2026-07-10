import { useState } from "react";
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

/// <summary>
/// Resolves a whisper target from `/w name message`: "dm" or a slot-name prefix
/// (case-insensitive). Returns null when no target matches.
/// </summary>
function resolveWhisperTarget(name: string, slots: PlayerSlot[]): string | null {
  const query = name.toLowerCase();
  if (query === "dm") {
    return "dm";
  }
  const slot = slots.find((item) => item.name.toLowerCase().startsWith(query));
  return slot ? slot.id : null;
}

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

  const slotName = (id: string) =>
    id === "dm" ? "DM" : (playerSlots.find((slot) => slot.id === id)?.name ?? "player");

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
    const whisperMatch = raw.match(/^\/w(?:hisper)?\s+(\S+)\s+([\s\S]+)$/i);
    if (whisperMatch) {
      const target = resolveWhisperTarget(whisperMatch[1], playerSlots);
      if (!target) {
        setInputError(`No player named “${whisperMatch[1]}”. Try /w dm or a character name.`);
        return;
      }
      onSendChat(whisperMatch[2].trim(), target);
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
            const whisper = entry.whisperTo
              ? ` (whisper to ${slotName(entry.whisperTo)})`
              : "";
            return (
              <div className={`log-chat${entry.whisperTo ? " log-whisper" : ""}`} key={entry.id}>
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
        <div className="row">
          <input
            value={text}
            placeholder={isDm ? "Message… (/w name to whisper)" : "Message… (/w dm to whisper)"}
            onChange={(e) => {
              setText(e.target.value);
              setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            aria-label="Chat message"
          />
          <button className="btn-primary" onClick={submit}>
            Send
          </button>
        </div>
        {inputError ? <span className="input-error">{inputError}</span> : null}
      </div>
    </div>
  );
}

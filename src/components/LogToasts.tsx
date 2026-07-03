import { useEffect, useRef, useState } from "react";
import { formatDiceRoll } from "../lib/dice";
import type { LogEntry, PlayerSlot } from "../lib/types";

const TOAST_LIFETIME_MS = 6000;
const MAX_TOASTS = 5;

type LogToastsProps = {
  log: LogEntry[];
  yourPlayerId: string | null;
  playerSlots: PlayerSlot[];
  /** Hide the toasts while the full log panel is already on screen. */
  suppress: boolean;
  /** Shift left by the panel width when the dock is expanded, so it isn't covered. */
  dockExpanded: boolean;
};

/// <summary>
/// Transient bottom-right notifications for new log entries (rolls, chat,
/// events): each fades in, lingers a few seconds, and fades out. Entries
/// present at join time are never replayed. The stack lifts itself above the
/// (draggable) dice tray whenever the two would overlap.
/// </summary>
export function LogToasts({
  log,
  yourPlayerId,
  playerSlots,
  suppress,
  dockExpanded,
}: LogToastsProps) {
  const seenRef = useRef<Set<string> | null>(null);
  const [toasts, setToasts] = useState<LogEntry[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);
  /** Extra bottom offset (px) applied when the open dice tray occludes the stack. */
  const [lift, setLift] = useState(0);

  useEffect(() => {
    // First state after joining: mark history as seen without replaying it.
    if (seenRef.current === null) {
      seenRef.current = new Set(log.map((entry) => entry.id));
      return;
    }
    const seen = seenRef.current;
    const fresh = log.filter((entry) => !seen.has(entry.id));
    if (fresh.length === 0) {
      return;
    }
    for (const entry of fresh) {
      seen.add(entry.id);
    }
    setToasts((current) => [...current, ...fresh].slice(-MAX_TOASTS));
    // One timer per batch; each removes only its own entries, so a busy chat
    // can't strand older toasts on screen.
    setTimeout(() => {
      setToasts((current) => current.filter((entry) => !fresh.includes(entry)));
    }, TOAST_LIFETIME_MS);
  }, [log]);

  // Occlusion check against the open tray: measured fresh (the tray is draggable),
  // rechecked on a short timer while any toast is visible. The stack's "natural"
  // (unlifted) rect decides, so lifting can't oscillate.
  const visible = !suppress && toasts.length > 0;
  useEffect(() => {
    if (!visible) {
      setLift(0);
      return;
    }
    const check = () => {
      const stack = stackRef.current;
      const tray = document.querySelector(".dice-tray--open");
      if (!stack || !tray) {
        setLift(0);
        return;
      }
      const t = tray.getBoundingClientRect();
      const s = stack.getBoundingClientRect();
      setLift((current) => {
        const naturalTop = s.top + current;
        const naturalBottom = s.bottom + current;
        const overlaps =
          t.left < s.right && t.right > s.left && t.top < naturalBottom && t.bottom > naturalTop;
        return overlaps ? Math.max(0, Math.round(window.innerHeight - t.top + 8 - 16)) : 0;
      });
    };
    check();
    const timer = setInterval(check, 300);
    window.addEventListener("resize", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", check);
    };
  }, [visible, toasts.length]);

  if (!visible) {
    return null;
  }

  const slotName = (id: string) =>
    id === "dm" ? "DM" : (playerSlots.find((slot) => slot.id === id)?.name ?? "player");

  return (
    <div
      ref={stackRef}
      className={`log-toasts${dockExpanded ? " log-toasts--dock-open" : ""}`}
      style={lift > 0 ? { bottom: `calc(1rem + ${lift}px)` } : undefined}
    >
      {toasts.map((entry) => {
        if (entry.kind === "event") {
          return (
            <div className="log-toast log-toast--event" key={entry.id}>
              {entry.text}
            </div>
          );
        }
        if (entry.kind === "chat") {
          return (
            <div
              className={`log-toast${entry.whisperTo ? " log-toast--whisper" : ""}`}
              key={entry.id}
            >
              <b>{entry.fromId === yourPlayerId ? "You" : entry.from}</b>
              {entry.whisperTo ? (
                <span className="muted"> (whisper to {slotName(entry.whisperTo)})</span>
              ) : null}
              : {entry.text}
            </div>
          );
        }
        if (entry.masked) {
          return (
            <div className="log-toast log-toast--event" key={entry.id}>
              🔒 {entry.actor.name} rolled in secret
            </div>
          );
        }
        return (
          <div className="log-toast" key={entry.id}>
            <b>
              {entry.dmOnly ? "🔒 " : ""}
              {entry.actor.name}
            </b>
            {entry.label ? <span className="muted"> — {entry.label}</span> : null}:{" "}
            {formatDiceRoll(entry.roll)}
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { readLocalFlag, writeLocalFlag } from "../lib/localFlags";

/// <summary>
/// "Are you sure you want to delete this ___?" for destructive directory actions
/// (NPCs, items, players). Imperative service + one host component (mounted in
/// App): call `confirmDelete({...})` anywhere and await the answer. When the
/// per-device "Confirm deletions" flag is off, it resolves true immediately; the
/// dialog's "Don't ask again" checkbox flips that same flag (also in Settings).
/// </summary>

export const CONFIRM_DELETES_KEY = "cm-confirm-deletes";

export type ConfirmDeleteRequest = {
  /** What kind of thing dies: "NPC" | "item" | "player" (used in the title). */
  kind: string;
  /** Display name of the doomed record ("Gruk", "3 items"); falls back to "this {kind}". */
  name?: string;
  /** One extra line of consequences ("This also removes their tokens."). */
  detail?: string;
};

type PendingRequest = ConfirmDeleteRequest & { resolve: (ok: boolean) => void };

let hostListener: ((req: PendingRequest) => void) | null = null;

/** Ask before deleting. Resolves immediately when confirmations are turned off. */
export function confirmDelete(request: ConfirmDeleteRequest): Promise<boolean> {
  if (!readLocalFlag(CONFIRM_DELETES_KEY, true)) {
    return Promise.resolve(true);
  }
  if (!hostListener) {
    // Host not mounted (shouldn't happen in-app) — fail safe by asking nothing.
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    hostListener?.({ ...request, resolve });
  });
}

/** Mounted once in App; renders the modal when a confirmDelete() is pending. */
export function ConfirmDeleteHost({
  onDisableConfirms,
}: {
  /** Syncs App/Settings state when "Don't ask again" is checked. */
  onDisableConfirms: (off: boolean) => void;
}) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [dontAsk, setDontAsk] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hostListener = (request) => {
      setDontAsk(false);
      setPending((current) => {
        // A second request while one is open (rapid clicks): auto-cancel the older one.
        current?.resolve(false);
        return request;
      });
    };
    return () => {
      hostListener = null;
    };
  }, []);

  useEffect(() => {
    if (pending) {
      deleteRef.current?.focus();
    }
  }, [pending]);

  if (!pending) {
    return null;
  }

  const finish = (ok: boolean) => {
    if (ok && dontAsk) {
      writeLocalFlag(CONFIRM_DELETES_KEY, false);
      onDisableConfirms(true);
    }
    pending.resolve(ok);
    setPending(null);
  };

  const label = pending.name?.trim() ? `“${pending.name.trim()}”` : `this ${pending.kind}`;

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={() => finish(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          finish(false);
        }
      }}
    >
      <div className="modal stack confirm-delete" onClick={(e) => e.stopPropagation()}>
        <h2>Delete {pending.kind}?</h2>
        <p className="muted" style={{ margin: 0 }}>
          Are you sure you want to delete {label}?
          {pending.detail ? ` ${pending.detail}` : ""}
        </p>
        <label className="confirm-delete-dontask">
          <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
          Don't ask again (change anytime in Settings)
        </label>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => finish(false)}>Cancel</button>
          <button ref={deleteRef} className="btn-danger" onClick={() => finish(true)}>
            <Trash2 size={13} strokeWidth={2.2} /> Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

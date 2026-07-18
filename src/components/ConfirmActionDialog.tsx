import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/// <summary>
/// General-purpose "are you sure?" confirmation — the themed sibling of
/// ConfirmDeleteDialog for non-delete confirmations (e.g. "replace these
/// features?"). Imperative service + one host mounted in App: call
/// `confirmAction({...})` anywhere and await the boolean. Always asks (no
/// "don't ask again" flag), so callers stay in control of when it fires.
/// `isConfirmActionOpen()` lets other modals defer their own Escape handling
/// while this dialog is on top.
/// </summary>

export type ConfirmActionRequest = {
  title: string;
  body: string;
  /** Confirm button label (default "Confirm"). */
  confirmLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
};

type PendingRequest = ConfirmActionRequest & { resolve: (ok: boolean) => void };

let hostListener: ((req: PendingRequest) => void) | null = null;
let openCount = 0;

/** True while a confirmAction dialog is showing — used to gate other modals' Escape handlers. */
export function isConfirmActionOpen(): boolean {
  return openCount > 0;
}

/** Ask the user to confirm. Resolves false if the host isn't mounted (fail safe). */
export function confirmAction(request: ConfirmActionRequest): Promise<boolean> {
  if (!hostListener) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    hostListener?.({ ...request, resolve });
  });
}

/** Mounted once in App; renders the modal when a confirmAction() is pending. */
export function ConfirmActionHost() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    hostListener = (request) => {
      setPending((current) => {
        // A second request while one is open: auto-cancel the older one.
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
      openCount += 1;
      confirmRef.current?.focus();
      return () => {
        openCount -= 1;
      };
    }
  }, [pending]);

  if (!pending) {
    return null;
  }

  const finish = (ok: boolean) => {
    pending.resolve(ok);
    setPending(null);
  };

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
        <h2>{pending.title}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {pending.body}
        </p>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button onClick={() => finish(false)}>Cancel</button>
          <button
            ref={confirmRef}
            className={pending.danger ? "btn-danger" : "btn-primary"}
            onClick={() => finish(true)}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

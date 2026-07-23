import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/// <summary>
/// A generic "how should this apply?" chooser: a title, an explanatory line, and a
/// vertical list of mode buttons. Shared by the stat-block apply flow (applying a
/// monster onto an NPC that already has content) and the compendium-item apply flow
/// (applying an item onto one that already has stats). Esc / backdrop / Cancel = abort.
/// </summary>

export type ApplyChoice<M extends string> = { mode: M; label: string; hint: string };

export function ApplyModeModal<M extends string>({
  title,
  intro,
  choices,
  onChoose,
  onClose,
}: {
  title: string;
  intro: string;
  choices: ApplyChoice<M>[];
  onChoose: (mode: M) => void;
  onClose: () => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="modal stack apply-mode" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {intro}
        </p>
        <div className="stack" style={{ gap: 8 }}>
          {choices.map((choice, i) => (
            <button
              key={choice.mode}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="apply-choice"
              onClick={() => onChoose(choice.mode)}
            >
              <span className="apply-choice-label">{choice.label}</span>
              <span className="muted apply-choice-hint">{choice.hint}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

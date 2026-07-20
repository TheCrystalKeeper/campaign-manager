import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { StatblockApplyMode } from "../../lib/compendiumMap";

/// <summary>
/// Shown after the DM picks a monster to apply onto an NPC that already has
/// content. Singular stats (HP/AC/abilities/...) are always replaced; this asks
/// how to handle the NPC's existing actions, features, and pill lists. The NPC's
/// name and alignment are always kept. Esc / backdrop / Cancel = abort.
/// </summary>

const CHOICES: Array<{ mode: StatblockApplyMode; label: string; hint: (name: string) => string }> = [
  {
    mode: "add",
    label: "Add to existing",
    hint: (name) => `Keep this NPC's actions & features and add ${name}'s on top.`,
  },
  {
    mode: "stats",
    label: "Stats only",
    hint: () => "Only update HP, AC, abilities and other numbers. Leave actions & features as they are.",
  },
  {
    mode: "replace",
    label: "Replace",
    hint: (name) => `Overwrite this NPC's actions & features with ${name}'s.`,
  },
];

export function StatblockApplyModal({
  monsterName,
  onChoose,
  onClose,
}: {
  monsterName: string;
  onChoose: (mode: StatblockApplyMode) => void;
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
      <div className="modal stack statblock-apply" onClick={(e) => e.stopPropagation()}>
        <h2>Apply {monsterName}'s stat block</h2>
        <p className="muted" style={{ margin: 0 }}>
          The numbers (HP, AC, abilities, speed, senses…) will be replaced. This NPC keeps its own name.
          How should its actions &amp; features be handled?
        </p>
        <div className="stack" style={{ gap: 8 }}>
          {CHOICES.map((choice, i) => (
            <button
              key={choice.mode}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              className="statblock-apply-choice"
              onClick={() => onChoose(choice.mode)}
            >
              <span className="statblock-apply-choice-label">{choice.label}</span>
              <span className="muted statblock-apply-choice-hint">{choice.hint(monsterName)}</span>
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

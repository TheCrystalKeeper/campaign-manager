import { useRef, useState } from "react";
import { Download, Eye, EyeOff, Tent, Upload, Utensils } from "lucide-react";
import { NumberInput } from "../NumberInput";
import type { SheetEdit } from "./context";

/** Per-page reveal control (DM viewing an NPC sheet). */
export type RevealControl = { revealed: boolean; onToggle: (revealed: boolean) => void } | null;

/** Export/import controls (viewers who may edit the sheet: the owner or the DM). */
export type SheetTransferControl = { onExport: () => void; onImportFile: (file: File) => void } | null;

/**
 * The persistent sheet header: name + subtitle (PC: "Class Level"; NPC: type line +
 * source · CR), Short/Long Rest buttons (real effects — Tier 3; the short-rest button
 * opens a spend-hit-dice flyout), a level/CR ring, and (DM + NPC) the active page's
 * reveal eye.
 */
export function SheetHeader({
  sheet,
  onRest,
  reveal,
  transfer,
}: {
  sheet: SheetEdit;
  onRest?: (kind: "short" | "long", spendHitDice?: number) => void;
  reveal: RevealControl;
  transfer?: SheetTransferControl;
}) {
  const { value, canEdit, kind, update } = sheet;
  const isNpc = kind === "npc";
  const [shortRestOpen, setShortRestOpen] = useState(false);
  const [spendDice, setSpendDice] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);

  const subtitle = isNpc
    ? [value.size, value.creatureType, value.alignment].filter(Boolean).join(" · ") || "NPC"
    : `${value.race ? `${value.race} ` : ""}${value.characterClass || "Class"} ${value.level}`;

  const meta = isNpc ? [value.source, value.xp ? `${value.xp} XP` : ""].filter(Boolean).join(" · ") : "";

  const startShortRest = () => {
    setSpendDice(0);
    setShortRestOpen((open) => !open);
  };

  return (
    <div className="sheet-header">
      <div className="sheet-header-main">
        {canEdit ? (
          <input
            className="sheet-name-input"
            value={value.characterName}
            placeholder="Name"
            onChange={(e) => update({ characterName: e.target.value })}
          />
        ) : (
          <div className="sheet-name">{value.characterName || (sheet.value ? "" : "???")}</div>
        )}
        <div className="sheet-subtitle">{subtitle}</div>
        {meta ? <div className="sheet-meta">{meta}</div> : null}
      </div>

      <div className="sheet-header-actions">
        {onRest ? (
          <>
            <span className="short-rest-wrap">
              <button
                type="button"
                className="rest-btn"
                title="Short rest — spend hit dice, recharge short-rest abilities"
                onClick={startShortRest}
              >
                <Utensils size={14} strokeWidth={2.2} />
              </button>
              {shortRestOpen ? (
                <div className="short-rest-pop">
                  <label>
                    Spend hit dice ({value.hitDice.current} left)
                    <NumberInput
                      value={spendDice}
                      min={0}
                      max={Math.max(0, value.hitDice.current)}
                      allowNegative={false}
                      onCommit={setSpendDice}
                      aria-label="Hit dice to spend"
                    />
                  </label>
                  <span className="muted">Each heals {value.hitDice.die || "d8"} + CON</span>
                  <div className="short-rest-actions">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        onRest("short", spendDice);
                        setShortRestOpen(false);
                      }}
                    >
                      Rest
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setShortRestOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </span>
            <button
              type="button"
              className="rest-btn"
              title="Long rest — full HP, half hit dice back, all slots and abilities"
              onClick={() => onRest("long")}
            >
              <Tent size={14} strokeWidth={2.2} />
            </button>
          </>
        ) : null}
        {reveal ? (
          <button
            type="button"
            className={`reveal-toggle ${reveal.revealed ? "reveal-toggle--on" : ""}`}
            title={reveal.revealed ? "Page visible to players — click to hide" : "Page hidden from players — click to reveal"}
            onClick={() => reveal.onToggle(!reveal.revealed)}
          >
            {reveal.revealed ? <Eye size={13} strokeWidth={2.2} /> : <EyeOff size={13} strokeWidth={2.2} />}
          </button>
        ) : null}
        {transfer ? (
          <>
            <button
              type="button"
              className="rest-btn"
              title="Export this sheet as a JSON file"
              onClick={transfer.onExport}
            >
              <Download size={14} strokeWidth={2.2} />
            </button>
            <button
              type="button"
              className="rest-btn"
              title="Import a sheet from a JSON file — replaces this sheet"
              onClick={() => importRef.current?.click()}
            >
              <Upload size={14} strokeWidth={2.2} />
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) transfer.onImportFile(file);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      <div className="level-ring" title={isNpc ? "Challenge rating" : "Level"}>
        {canEdit ? (
          isNpc ? (
            <input
              className="level-ring-input"
              value={value.cr}
              placeholder="CR"
              onChange={(e) => update({ cr: e.target.value })}
            />
          ) : (
            <NumberInput className="level-ring-input" value={value.level} min={1} allowNegative={false} onCommit={(level) => update({ level })} aria-label="Level" />
          )
        ) : (
          <span className="level-ring-value">{isNpc ? value.cr || "—" : value.level}</span>
        )}
      </div>
    </div>
  );
}

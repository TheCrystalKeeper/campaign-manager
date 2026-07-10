import type { DeathSaves } from "../../lib/types";
import { Skull } from "lucide-react";

/**
 * Death-save tracker (PC only): 3 success slots on the left, 3 failure slots on the right,
 * always visible (a skull sits between them). Click a slot to fill or unfill it.
 */
export function DeathSaveTracker({
  value,
  canEdit,
  onChange,
  onRoll,
}: {
  value: DeathSaves;
  canEdit: boolean;
  onChange: (next: DeathSaves) => void;
  /** Tier 3: server-rolled death save (10+ success, nat 1 = 2 fails, nat 20 = 1 HP). */
  onRoll?: () => void;
}) {
  const setSuccesses = (n: number) => onChange({ ...value, successes: value.successes === n ? n - 1 : n });
  const setFailures = (n: number) => onChange({ ...value, failures: value.failures === n ? n - 1 : n });

  return (
    <div className="death-saves">
      <div className="death-tracker">
        <div className="death-col" title="Successes">
          {[1, 2, 3].map((n) => (
            <button
              type="button"
              key={n}
              className={`death-pip death-pip--success ${value.successes >= n ? "death-pip--full" : ""}`}
              disabled={!canEdit}
              onClick={() => setSuccesses(n)}
            />
          ))}
        </div>
        {onRoll && canEdit ? (
          <button
            type="button"
            className="death-skull-mid death-roll-btn"
            title="Roll a death saving throw (10+ succeeds; nat 20 = back up with 1 HP)"
            onClick={onRoll}
          >
            <Skull size={14} strokeWidth={2.2} />
          </button>
        ) : (
          <span className="death-skull-mid" title="Death saves"><Skull size={15} strokeWidth={2.2} /></span>
        )}
        <div className="death-col" title="Failures">
          {[1, 2, 3].map((n) => (
            <button
              type="button"
              key={n}
              className={`death-pip death-pip--fail ${value.failures >= n ? "death-pip--full" : ""}`}
              disabled={!canEdit}
              onClick={() => setFailures(n)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

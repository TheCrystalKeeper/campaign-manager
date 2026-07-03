import { useCallback, useEffect, useRef, useState } from "react";
import { DICE_FADE_MS, DICE_ROLL_LINGER_MS } from "../dice3d/diceTiming";
import { formatDiceRoll } from "../lib/dice";
import type { DiceRoll } from "../lib/types";

const MAX_TOASTS = 4;

type ToastItem = {
  key: string;
  roll: DiceRoll;
  secret?: boolean;
  fading?: boolean;
};

type DiceRollToastsProps = {
  publicRolls: DiceRoll[];
  privateRolls: DiceRoll[];
  isDm: boolean;
  /** Called when a physical roll notification appears; dice fade on the same timer. */
  onPhysicalRollNotified?: (physicsRollId: string) => void;
};

/// <summary>
/// Bottom-left popups when a new dice result lands in the shared or secret log.
/// Toasts and 3D dice fade out together, starting 5s after the notification appears.
/// </summary>
export function DiceRollToasts({
  publicRolls,
  privateRolls,
  isDm,
  onPhysicalRollNotified,
}: DiceRollToastsProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seenPublicRef = useRef(new Set<string>());
  const seenPrivateRef = useRef(new Set<string>());
  const hydratedRef = useRef(false);
  const removeTimersRef = useRef(new Map<string, number>());

  const removeToast = useCallback((key: string) => {
    const timer = removeTimersRef.current.get(key);
    if (timer) {
      clearTimeout(timer);
      removeTimersRef.current.delete(key);
    }
    setToasts((current) => current.filter((item) => item.key !== key));
  }, []);

  const beginFade = useCallback(
    (match: (toast: ToastItem) => boolean) => {
      setToasts((current) => {
        let changed = false;
        const next = current.map((toast) => {
          if (!toast.fading && match(toast)) {
            changed = true;
            const timer = window.setTimeout(() => removeToast(toast.key), DICE_FADE_MS);
            removeTimersRef.current.set(toast.key, timer);
            return { ...toast, fading: true };
          }
          return toast;
        });
        return changed ? next : current;
      });
    },
    [removeToast],
  );

  const pushToast = useCallback(
    (roll: DiceRoll, secret = false) => {
      const key = `${roll.id}-${Date.now()}`;
      setToasts((current) => [...current, { key, roll, secret }].slice(-MAX_TOASTS));

      const lingerTimer = window.setTimeout(() => {
        beginFade((toast) => toast.key === key);
      }, DICE_ROLL_LINGER_MS);
      removeTimersRef.current.set(`${key}-linger`, lingerTimer);

      if (roll.physicsRollId) {
        onPhysicalRollNotified?.(roll.physicsRollId);
      }
    },
    [beginFade, onPhysicalRollNotified],
  );

  useEffect(() => {
    return () => {
      for (const timer of removeTimersRef.current.values()) {
        clearTimeout(timer);
      }
      removeTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    for (const roll of publicRolls) {
      if (seenPublicRef.current.has(roll.id)) {
        continue;
      }
      seenPublicRef.current.add(roll.id);
      if (hydratedRef.current) {
        pushToast(roll);
      }
    }
    hydratedRef.current = true;
  }, [publicRolls, pushToast]);

  useEffect(() => {
    if (!isDm) {
      return;
    }
    for (const roll of privateRolls) {
      if (seenPrivateRef.current.has(roll.id)) {
        continue;
      }
      seenPrivateRef.current.add(roll.id);
      if (hydratedRef.current) {
        pushToast(roll, true);
      }
    }
  }, [privateRolls, isDm, pushToast]);

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="dice-roll-toasts" aria-live="polite" aria-label="Recent dice rolls">
      {toasts.map((toast) => (
        <div
          key={toast.key}
          className={`dice-roll-toast${toast.secret ? " dice-roll-toast-secret" : ""}${
            toast.fading ? " dice-roll-toast-fading" : ""
          }`}
          style={toast.fading ? { animationDuration: `${DICE_FADE_MS}ms` } : undefined}
        >
          <span className="dice-roll-toast-name">{toast.roll.rollerName}</span>
          {toast.secret ? <span className="dice-roll-toast-tag">Secret</span> : null}
          <span className="dice-roll-toast-detail">{formatDiceRoll(toast.roll)}</span>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";

type NumberInputProps = {
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  className?: string;
  min?: number;
  max?: number;
  allowNegative?: boolean;
  "aria-label"?: string;
};

/// <summary>
/// Integer input that keeps the in-progress text local (so you can clear it and type a
/// new value), and only commits a parsed, clamped number on blur or Enter. Reverts to
/// the current value if left empty or invalid.
/// </summary>
export function NumberInput({
  value,
  onCommit,
  disabled,
  className,
  min,
  max,
  allowNegative = true,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const focusedRef = useRef(false);

  // Mirror external changes unless the user is actively editing this field.
  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(value));
    }
  }, [value]);

  const pattern = allowNegative ? /^-?\d*$/ : /^\d*$/;

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === "-") {
      setDraft(String(value));
      return;
    }
    let next = Number(trimmed);
    if (!Number.isFinite(next)) {
      setDraft(String(value));
      return;
    }
    if (typeof min === "number") {
      next = Math.max(min, next);
    }
    if (typeof max === "number") {
      next = Math.min(max, next);
    }
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      className={className}
      disabled={disabled}
      value={draft}
      aria-label={ariaLabel}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "" || pattern.test(raw)) {
          setDraft(raw);
        }
      }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

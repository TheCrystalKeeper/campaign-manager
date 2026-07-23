/** Declarative filter controls shared by the compendium picker modals. */

/** A filter `<select>` with an "All …" empty option followed by the given options.
 *  Value "" means "no filter" — wire it straight into the host's `filterFn`. */
export function PickerSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  /** Accessible label, e.g. "Filter by type". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Label of the empty ("no filter") option, e.g. "All types". */
  allLabel: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allLabel}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** "very-rare" -> "Very rare" — option labels from kebab-case ids. */
export const optionLabel = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/-/g, " ");

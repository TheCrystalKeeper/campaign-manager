export type HBarRow = {
  key: string;
  label: string;
  value: number;
  /** Small muted note after the value, e.g. "avg 3.6 (expected 3.5)". */
  detail?: string;
  color?: string;
};

/**
 * Horizontal magnitude bars (die-type and category breakdowns). HTML, not SVG:
 * label · track · value in a grid row, single hue unless a row declares its own.
 * Every value is directly labeled, so the track carries no axis. `wideLabels`
 * fits word labels ("Saving throws") instead of die codes ("d20").
 */
export function HBarList({ rows, wideLabels = false }: { rows: HBarRow[]; wideLabels?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className={`hbar-list${wideLabels ? " hbar-list--wide" : ""}`}>
      {rows.map((row) => (
        <div className="hbar-row" key={row.key}>
          <span className="hbar-label">{row.label}</span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{
                width: `${Math.max(1, (row.value / max) * 100)}%`,
                background: row.color ?? "var(--chart-accent)",
              }}
            />
          </span>
          <span className="hbar-value">{row.value.toLocaleString()}</span>
          {row.detail ? <span className="hbar-detail">{row.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

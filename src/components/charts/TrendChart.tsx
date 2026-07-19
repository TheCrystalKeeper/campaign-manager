import { useState } from "react";
import { niceTicks } from "./axis";
import { useMeasuredWidth } from "./useMeasuredWidth";

const HEIGHT = 200;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const MAX_BAR = 24;
const GAP = 2;

export type TrendDay = {
  /** Sort/tooltip key, e.g. "2026-07-15". */
  day: string;
  /** Short axis label, e.g. "Jul 15". */
  label: string;
  /** Count per series id, in no particular order. */
  counts: Record<string, number>;
  total: number;
};

export type TrendSeries = {
  id: string;
  name: string;
  color: string;
};

function roundedTopBar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join(" ");
}

/**
 * Per-day stacked columns, one segment per roller. Segments are separated by a
 * 2px surface gap (never a stroke); the topmost segment carries the rounded
 * data-end. Counts ride a real y-axis (hairline gridlines + muted integer
 * ticks); a legend always rides below when there are 2+ series.
 */
export function TrendChart({ days, series }: { days: TrendDay[]; series: TrendSeries[] }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = days.length;
  const innerW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const step = n > 0 ? innerW / n : 0;
  const barW = Math.max(3, Math.min(MAX_BAR, step - GAP));
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(1, ...days.map((d) => d.total));
  const yFor = (value: number) => PAD_TOP + plotH - (value / max) * plotH;
  const yTicks = niceTicks(0, max, 4, true).filter((tick) => tick > 0);

  // Sparse x labels: aim for ~6, always including the first and last day.
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  return (
    <div>
      <div className="chart-plot" ref={ref}>
        {width > 0 && n > 0 ? (
          <svg width={width} height={HEIGHT} role="img">
            {yTicks.map((tick) => (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  y1={yFor(tick)}
                  x2={width - PAD_RIGHT}
                  y2={yFor(tick)}
                  className="chart-grid"
                />
                <text x={PAD_LEFT - 6} y={yFor(tick) + 3} textAnchor="end" className="chart-tick">
                  {tick}
                </text>
              </g>
            ))}
            <line
              x1={PAD_LEFT}
              y1={PAD_TOP + plotH}
              x2={width - PAD_RIGHT}
              y2={PAD_TOP + plotH}
              className="chart-axis"
            />
            <text x={PAD_LEFT - 6} y={PAD_TOP + plotH + 3} textAnchor="end" className="chart-tick">
              0
            </text>
            {days.map((day, i) => {
              const x = PAD_LEFT + i * step + (step - barW) / 2;
              let yCursor = PAD_TOP + plotH;
              const dimmed = hover !== null && hover !== i;
              const segments = series
                .map((s) => ({ s, value: day.counts[s.id] ?? 0 }))
                .filter((seg) => seg.value > 0);
              return (
                <g key={day.day} opacity={dimmed ? 0.45 : 1}>
                  {segments.map((seg, segIndex) => {
                    const h = (seg.value / max) * plotH;
                    yCursor -= h;
                    const isTop = segIndex === segments.length - 1;
                    // The 2px surface gap comes out of the segment's own height.
                    const gapped = Math.max(0.75, h - (isTop ? 0 : GAP));
                    return isTop ? (
                      <path
                        key={seg.s.id}
                        d={roundedTopBar(x, yCursor, barW, gapped)}
                        fill={seg.s.color}
                      />
                    ) : (
                      <rect
                        key={seg.s.id}
                        x={x}
                        y={yCursor + (h - gapped)}
                        width={barW}
                        height={gapped}
                        fill={seg.s.color}
                      />
                    );
                  })}
                  {i % labelEvery === 0 || i === n - 1 ? (
                    <text x={x + barW / 2} y={HEIGHT - 6} textAnchor="middle" className="chart-tick">
                      {day.label}
                    </text>
                  ) : null}
                  <rect
                    x={PAD_LEFT + i * step}
                    y={PAD_TOP}
                    width={step}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
        ) : null}
        {hover !== null && days[hover] ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${PAD_LEFT + hover * step + step / 2}px`,
              top: `${Math.max(0, yFor(days[hover].total) - 10)}px`,
            }}
          >
            <strong>{days[hover].label}</strong> — {days[hover].total} roll
            {days[hover].total === 1 ? "" : "s"}
            {series
              .map((s) => ({ s, value: days[hover].counts[s.id] ?? 0 }))
              .filter((seg) => seg.value > 0)
              .map(({ s, value }) => (
                <span className="chart-tooltip-row" key={s.id}>
                  <span className="chart-dot" style={{ background: s.color }} />
                  {s.name}: {value}
                </span>
              ))}
          </div>
        ) : null}
      </div>
      {series.length >= 2 ? (
        <div className="chart-legend">
          {series.map((s) => (
            <span className="chart-legend-item" key={s.id}>
              <span className="chart-dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

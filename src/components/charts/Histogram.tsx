import { useState } from "react";
import { niceTicks } from "./axis";
import { useMeasuredWidth } from "./useMeasuredWidth";

const HEIGHT = 180;
const PAD_TOP = 16;
const PAD_BOTTOM = 22;
const PAD_LEFT = 34;
const PAD_RIGHT = 8;
const MAX_BAR = 24;
const GAP = 2;

/** Rounded data-end (top), square at the baseline. */
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
 * Vertical histogram over numbered bins (the d20 faces 1-20). Single hue —
 * the bins' identity is positional, so color only carries magnitude emphasis.
 * Counts ride a real y-axis (hairline gridlines + muted integer ticks); a
 * per-bin hover tooltip and an optional dashed expected-count line complete it.
 */
export function Histogram({
  bins,
  firstBin = 1,
  color = "var(--chart-accent)",
  expected = null,
  expectedLabel,
  binNoun = "time",
  binPrefix = "Rolled",
}: {
  bins: number[];
  firstBin?: number;
  color?: string;
  /** Expected count per bin for a fair die; drawn as a dashed reference line. */
  expected?: number | null;
  expectedLabel?: string;
  binNoun?: string;
  binPrefix?: string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = bins.length;
  const innerW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const step = n > 0 ? innerW / n : 0;
  const barW = Math.max(2, Math.min(MAX_BAR, step - GAP));
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const max = Math.max(1, ...bins, expected ?? 0);
  const yFor = (value: number) => PAD_TOP + plotH - (value / max) * plotH;
  const yTicks = niceTicks(0, max, 4, true).filter((tick) => tick > 0);

  // Sparse x ticks: the first face, every fifth, and the last.
  const xTicks = new Set<number>([firstBin, n + firstBin - 1]);
  for (let f = 5; f <= n + firstBin - 1; f += 5) {
    xTicks.add(f);
  }

  return (
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
          {/* baseline */}
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
          {bins.map((value, i) => {
            const x = PAD_LEFT + i * step + (step - barW) / 2;
            const h = (value / max) * plotH;
            const face = i + firstBin;
            return (
              <g key={face}>
                {value > 0 ? (
                  <path
                    d={roundedTopBar(x, yFor(value), barW, h)}
                    fill={color}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                ) : null}
                {xTicks.has(face) ? (
                  <text
                    x={x + barW / 2}
                    y={HEIGHT - 6}
                    textAnchor="middle"
                    className="chart-tick"
                  >
                    {face}
                  </text>
                ) : null}
                {/* full-height hit target, wider than the mark */}
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
          {expected !== null && expected > 0 ? (
            <line
              x1={PAD_LEFT}
              y1={yFor(expected)}
              x2={width - PAD_RIGHT}
              y2={yFor(expected)}
              className="chart-refline"
            />
          ) : null}
          {expected !== null && expected > 0 && expectedLabel ? (
            <text x={PAD_LEFT + 2} y={yFor(expected) - 4} className="chart-ref-label">
              {expectedLabel}
            </text>
          ) : null}
        </svg>
      ) : null}
      {hover !== null ? (
        <div
          className="chart-tooltip"
          style={{
            left: `${PAD_LEFT + hover * step + step / 2}px`,
            top: `${Math.max(0, yFor(bins[hover]) - 10)}px`,
          }}
        >
          <strong>
            {binPrefix} {hover + firstBin}
          </strong>{" "}
          — {bins[hover]} {binNoun}
          {bins[hover] === 1 ? "" : "s"}
        </div>
      ) : null}
    </div>
  );
}

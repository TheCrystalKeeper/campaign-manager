import { useMemo, useState } from "react";
import { niceTicks } from "./axis";
import { useMeasuredWidth } from "./useMeasuredWidth";

const HEIGHT = 220;
const PAD_TOP = 14;
const PAD_BOTTOM = 22;
const PAD_LEFT = 34;
const PAD_RIGHT = 14;

export type LinePoint = { x: number; y: number };

export type LineSeries = {
  id: string;
  name: string;
  color: string;
  /** Points in ascending-x order; x values are shared across series (integers). */
  points: LinePoint[];
};

/**
 * Multi-series line chart on a shared integer x-domain (e.g. "each roller's
 * nth d20"). 2px round-joined lines, ≥8px end dots with a 2px surface ring,
 * hairline gridlines with muted ticks on both axes, an optional dashed
 * reference line, and a crosshair + tooltip on hover. A legend always rides
 * below when there are 2+ series.
 */
export function LineChart({
  series,
  refValue = null,
  refLabel,
  yClamp,
  xTickFormat = (x) => String(x),
  tooltipTitle = (x) => String(x),
  valueFormat = (y) => y.toFixed(1),
}: {
  series: LineSeries[];
  refValue?: number | null;
  refLabel?: string;
  /** Hard bounds the y-domain may never exceed (e.g. [1, 20] for d20 averages). */
  yClamp?: [number, number];
  xTickFormat?: (x: number) => string;
  tooltipTitle?: (x: number) => string;
  valueFormat?: (y: number) => string;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const xMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.x)));
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const innerW = Math.max(0, width - PAD_LEFT - PAD_RIGHT);

  const [yMin, yMax] = useMemo(() => {
    const values = series.flatMap((s) => s.points.map((p) => p.y));
    if (refValue !== null) {
      values.push(refValue);
    }
    if (values.length === 0) {
      return [0, 1];
    }
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    const pad = Math.max(0.5, (hi - lo) * 0.1);
    lo -= pad;
    hi += pad;
    if (yClamp) {
      lo = Math.max(yClamp[0], lo);
      hi = Math.min(yClamp[1], hi);
    }
    return hi > lo ? [lo, hi] : [lo, lo + 1];
  }, [series, refValue, yClamp]);

  const xFor = (x: number) =>
    PAD_LEFT + (xMax <= 1 ? 0 : ((x - 1) / (xMax - 1)) * innerW);
  const yFor = (y: number) => PAD_TOP + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  const yTicks = niceTicks(yMin, yMax, 4);
  const xTicks = useMemo(() => {
    const ticks = new Set(niceTicks(1, xMax, 5, true).filter((t) => t >= 1));
    ticks.add(1);
    ticks.add(xMax);
    return [...ticks].sort((a, b) => a - b);
  }, [xMax]);

  // Fast per-series lookup for the hover tooltip.
  const pointMaps = useMemo(
    () => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))),
    [series],
  );

  const hoverRows =
    hover === null
      ? []
      : series
          .map((s, i) => ({ s, y: pointMaps[i].get(hover) }))
          .filter((row): row is { s: LineSeries; y: number } => row.y !== undefined);

  const step = xMax > 1 ? innerW / (xMax - 1) : innerW;

  return (
    <div>
      <div className="chart-plot" ref={ref}>
        {width > 0 && series.length > 0 ? (
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
            {xTicks.map((tick) => (
              <text
                key={tick}
                x={xFor(tick)}
                y={HEIGHT - 6}
                textAnchor="middle"
                className="chart-tick"
              >
                {xTickFormat(tick)}
              </text>
            ))}
            {refValue !== null && refValue >= yMin && refValue <= yMax ? (
              <>
                <line
                  x1={PAD_LEFT}
                  y1={yFor(refValue)}
                  x2={width - PAD_RIGHT}
                  y2={yFor(refValue)}
                  className="chart-refline"
                />
                {refLabel ? (
                  <text x={PAD_LEFT + 2} y={yFor(refValue) - 4} className="chart-ref-label">
                    {refLabel}
                  </text>
                ) : null}
              </>
            ) : null}
            {hover !== null ? (
              <line
                x1={xFor(hover)}
                y1={PAD_TOP}
                x2={xFor(hover)}
                y2={PAD_TOP + plotH}
                className="chart-crosshair"
              />
            ) : null}
            {series.map((s) => {
              const path = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.x)},${yFor(p.y)}`)
                .join(" ");
              const last = s.points[s.points.length - 1];
              return (
                <g key={s.id}>
                  <path
                    d={path}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {last ? (
                    <circle
                      cx={xFor(last.x)}
                      cy={yFor(last.y)}
                      r={4}
                      fill={s.color}
                      className="chart-end-dot"
                    />
                  ) : null}
                </g>
              );
            })}
            {/* hover hit columns, one per integer x */}
            {Array.from({ length: xMax }, (_, i) => i + 1).map((x) => (
              <rect
                key={x}
                x={xFor(x) - step / 2}
                y={PAD_TOP}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(x)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
            {hoverRows.map(({ s, y }) => (
              <circle
                key={s.id}
                cx={xFor(hover as number)}
                cy={yFor(y)}
                r={4}
                fill={s.color}
                className="chart-end-dot"
                pointerEvents="none"
              />
            ))}
          </svg>
        ) : null}
        {hover !== null && hoverRows.length > 0 ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${Math.min(Math.max(xFor(hover), PAD_LEFT + 40), Math.max(width - 60, 0))}px`,
              top: `${Math.max(0, Math.min(...hoverRows.map(({ y }) => yFor(y))) - 10)}px`,
            }}
          >
            <strong>{tooltipTitle(hover)}</strong>
            {hoverRows.map(({ s, y }) => (
              <span className="chart-tooltip-row" key={s.id}>
                <span className="chart-dot" style={{ background: s.color }} />
                {s.name}: {valueFormat(y)}
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

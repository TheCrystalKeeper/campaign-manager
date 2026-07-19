import { useMemo, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { DM_PAGES, PLAYER_PAGES, PageSwitcher, type PageId } from "./PageSwitcher";
import type { GameRoom } from "../hooks/useGameRoom";
import { useRollArchive } from "../hooks/useRollArchive";
import type { RollCategory, RollRecord } from "../lib/types";
import {
  CATEGORY_LABELS,
  D20_MEAN,
  categoryBreakdown,
  d20Histogram,
  dieTypeBreakdown,
  keptD20s,
  rollsByDay,
  summarizeRollers,
  type RollerSummary,
} from "../lib/rollStats";
import { chartColorForRoller } from "../components/charts/chartTheme";
import { Histogram } from "../components/charts/Histogram";
import { TrendChart, type TrendSeries } from "../components/charts/TrendChart";
import { LineChart, type LineSeries } from "../components/charts/LineChart";
import { HBarList } from "../components/charts/HBarList";

/** Averages need this many d20s before they mean anything — below it the table
 *  greys the number out ("small sample"). */
const MIN_D20S_FOR_LUCK = 10;

const STANDARD_DICE = [20, 12, 10, 8, 6, 4, 100] as const;

type WhoFilter = "all" | "secret" | string;
type DieFilter = "all" | "coin" | "other" | (typeof STANDARD_DICE)[number];
type CatFilter = "all" | RollCategory;
type WhenFilter = "all" | "today" | "7d" | "30d";

const WHEN_OPTIONS: Array<{ id: WhenFilter; label: string }> = [
  { id: "all", label: "All time" },
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
];

const CAT_ORDER: RollCategory[] = [
  "check",
  "save",
  "attack",
  "damage",
  "initiative",
  "death",
  "coin",
  "other",
];

function whenCutoff(when: WhenFilter): number {
  const now = new Date();
  if (when === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (when === "7d") {
    return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }
  if (when === "30d") {
    return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }
  return 0;
}

function matchesDie(record: RollRecord, die: DieFilter): boolean {
  if (die === "all") {
    return true;
  }
  if (die === "coin") {
    return record.cat === "coin";
  }
  if (die === "other") {
    return (
      record.cat !== "coin" &&
      record.dice.some(([sides]) => !(STANDARD_DICE as readonly number[]).includes(sides))
    );
  }
  return record.cat !== "coin" && record.dice.some(([sides]) => sides === die);
}

function timeAgo(t: number): string {
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatAvg(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function formatLuck(value: number | null): string {
  if (value === null) {
    return "—";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

type SortKey =
  | "name"
  | "count"
  | "avgD20"
  | "luck"
  | "avgTotal"
  | "nat20"
  | "nat1"
  | "crits"
  | "advDis";

const TABLE_COLUMNS: Array<{ key: SortKey; label: string; title?: string }> = [
  { key: "name", label: "Roller" },
  { key: "count", label: "Rolls" },
  { key: "avgD20", label: "Avg d20", title: "Average bare d20, before any bonuses" },
  { key: "luck", label: "Luck", title: "Avg d20 minus 10.5 — above 0 is lucky" },
  { key: "avgTotal", label: "Avg result", title: "Average final result, bonuses included" },
  { key: "nat20", label: "Nat 20s" },
  { key: "nat1", label: "Nat 1s" },
  { key: "crits", label: "Crits" },
  { key: "advDis", label: "Adv / Dis", title: "Rolls made with advantage / disadvantage" },
];

function sortValue(row: RollerSummary, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "count":
      return row.count;
    case "avgD20":
      return row.avgD20 ?? -Infinity;
    case "luck":
      return row.luck ?? -Infinity;
    case "avgTotal":
      return row.avgTotal ?? -Infinity;
    case "nat20":
      return row.nat20;
    case "nat1":
      return row.nat1;
    case "crits":
      return row.crits;
    case "advDis":
      return row.advCount + row.disCount;
  }
}

/**
 * Roll Statistics — the full page. DM and players both get it; what each can
 * see was already decided server-side (the archive fetch and the live log are
 * role-filtered), so everything here is presentation over visible records.
 */
export function StatsPage({
  room,
  active,
  activePage,
  onNavigate,
}: {
  room: GameRoom;
  active: boolean;
  activePage: PageId;
  onNavigate: (id: PageId) => void;
}) {
  const isDm = room.yourRole === "dm";
  const state = room.state;
  const slots = useMemo(() => state?.playerSlots ?? [], [state?.playerSlots]);
  const revealSecrets = state?.revealSecretRolls === true;
  const { records, loading, total, refresh } = useRollArchive(room, active);

  const [who, setWho] = useState<WhoFilter>("all");
  const [die, setDie] = useState<DieFilter>("all");
  const [cat, setCat] = useState<CatFilter>("all");
  const [when, setWhen] = useState<WhenFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("luck");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const hasFilter = who !== "all" || die !== "all" || cat !== "all" || when !== "all";

  // Every roller present in the data, current slots first (stable colors), then
  // the DM, then departed rollers whose slots are gone.
  const rollers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of records) {
      if (!seen.has(record.who)) {
        seen.set(record.who, record.name);
      }
    }
    const list: Array<{ id: string; name: string; color: string }> = [];
    for (const slot of slots) {
      list.push({ id: slot.id, name: slot.name, color: chartColorForRoller(slot.id, slots) });
      seen.delete(slot.id);
    }
    if (seen.has("dm") || isDm) {
      list.push({ id: "dm", name: "The DM", color: chartColorForRoller("dm", slots) });
      seen.delete("dm");
    }
    for (const [id, name] of seen) {
      list.push({ id, name, color: chartColorForRoller(id, slots) });
    }
    return list;
  }, [records, slots, isDm]);

  const filtered = useMemo(() => {
    const cutoff = whenCutoff(when);
    return records.filter((record) => {
      if (who === "secret") {
        if (!record.secret) {
          return false;
        }
      } else if (who !== "all" && record.who !== who) {
        return false;
      }
      if (!matchesDie(record, die)) {
        return false;
      }
      if (cat !== "all" && record.cat !== cat) {
        return false;
      }
      return record.t >= cutoff;
    });
  }, [records, who, die, cat, when]);

  const summaries = useMemo(() => summarizeRollers(filtered), [filtered]);
  const sortedSummaries = useMemo(() => {
    return [...summaries].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va === vb) {
        return b.count - a.count;
      }
      return (va < vb ? -1 : 1) * sortDir;
    });
  }, [summaries, sortKey, sortDir]);

  const bins = useMemo(() => d20Histogram(filtered), [filtered]);
  const d20Total = useMemo(() => bins.reduce((sum, v) => sum + v, 0), [bins]);
  const keptStats = useMemo(() => {
    let kept = 0;
    let nat20 = 0;
    let nat1 = 0;
    for (const record of filtered) {
      for (const value of keptD20s(record)) {
        kept += 1;
        if (value === 20) {
          nat20 += 1;
        }
        if (value === 1) {
          nat1 += 1;
        }
      }
    }
    return { kept, nat20, nat1 };
  }, [filtered]);

  const days = useMemo(
    () =>
      rollsByDay(filtered).map((bucket) => ({
        day: bucket.day,
        label: new Date(bucket.t).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        counts: bucket.counts,
        total: bucket.total,
      })),
    [filtered],
  );
  const trendSeries: TrendSeries[] = useMemo(() => {
    const present = new Set<string>();
    for (const bucket of days) {
      for (const id of Object.keys(bucket.counts)) {
        present.add(id);
      }
    }
    return rollers
      .filter((roller) => present.has(roller.id))
      .map((roller) => ({ id: roller.id, name: roller.name, color: roller.color }));
  }, [days, rollers]);

  const dieTypes = useMemo(() => dieTypeBreakdown(filtered), [filtered]);
  const cats = useMemo(() => categoryBreakdown(filtered), [filtered]);

  // Luck over time: each roller's running average natural d20 after their nth
  // d20 (kept dice only, same basis as the table's "Avg d20").
  const luckSeries: LineSeries[] = useMemo(() => {
    const byRoller = new Map<string, { sum: number; n: number; points: Array<{ x: number; y: number }> }>();
    const sorted = [...filtered].sort((a, b) => a.t - b.t);
    for (const record of sorted) {
      for (const value of keptD20s(record)) {
        let cell = byRoller.get(record.who);
        if (!cell) {
          cell = { sum: 0, n: 0, points: [] };
          byRoller.set(record.who, cell);
        }
        cell.sum += value;
        cell.n += 1;
        cell.points.push({ x: cell.n, y: cell.sum / cell.n });
      }
    }
    return rollers
      .filter((roller) => (byRoller.get(roller.id)?.points.length ?? 0) >= 2)
      .map((roller) => ({
        id: roller.id,
        name: roller.name,
        color: roller.color,
        points: byRoller.get(roller.id)!.points,
      }));
  }, [filtered, rollers]);

  const coins = useMemo(() => {
    let heads = 0;
    let tails = 0;
    for (const record of filtered) {
      if (record.cat === "coin") {
        for (const [, value] of record.dice) {
          if (value === 1) {
            heads += 1;
          } else {
            tails += 1;
          }
        }
      }
    }
    return { heads, tails };
  }, [filtered]);

  const luckiest = useMemo(() => {
    let best: RollerSummary | null = null;
    for (const row of summaries) {
      if (row.d20Count >= MIN_D20S_FOR_LUCK && row.avgD20 !== null) {
        if (!best || (row.avgD20 ?? 0) > (best.avgD20 ?? 0)) {
          best = row;
        }
      }
    }
    return best;
  }, [summaries]);

  const moments = useMemo(() => {
    const list: Array<{ record: RollRecord; face: 20 | 1 }> = [];
    for (const record of filtered) {
      for (const value of keptD20s(record)) {
        if (value === 20 || value === 1) {
          list.push({ record, face: value as 20 | 1 });
        }
      }
    }
    return list.sort((a, b) => b.record.t - a.record.t).slice(0, 8);
  }, [filtered]);

  const selectedRoller = rollers.find((roller) => roller.id === who);
  const histColor = selectedRoller ? selectedRoller.color : "var(--chart-accent)";

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((dir) => (dir === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  const clearFilters = () => {
    setWho("all");
    setDie("all");
    setCat("all");
    setWhen("all");
  };

  const chip = (on: boolean) => `stats-chip${on ? " stats-chip--on" : ""}`;

  return (
    <div className="npcs-page">
      <div className="chip-tabs npcs-topbar">
        <PageSwitcher
          pages={isDm ? DM_PAGES : PLAYER_PAGES}
          active={activePage}
          onSelect={onNavigate}
          className="page-switcher--inline"
        />
        <span className="page-topbar-sep" />
        <h2 className="stats-title">Roll Statistics</h2>
        <span className="stats-count muted">
          {loading && records.length === 0
            ? "reading the ledger…"
            : `${records.length.toLocaleString()} of ${Math.max(total, records.length).toLocaleString()} rolls`}
        </span>
        <div className="stats-topbar-actions">
          {!isDm && revealSecrets ? (
            <span className="stats-reveal-note">
              <Eye size={13} strokeWidth={2.2} /> The DM is sharing secret rolls
            </span>
          ) : null}
          {isDm ? (
            <button
              className={revealSecrets ? "btn-active" : "btn-ghost"}
              title="When on, players see your secret rolls here and in the log"
              aria-pressed={revealSecrets}
              onClick={() =>
                room.send({ type: "SET_REVEAL_SECRET_ROLLS", enabled: !revealSecrets })
              }
            >
              {revealSecrets ? (
                <>
                  <Eye size={13} strokeWidth={2.2} /> Secret rolls shared
                </>
              ) : (
                <>
                  <EyeOff size={13} strokeWidth={2.2} /> Share secret rolls
                </>
              )}
            </button>
          ) : null}
          <button className="btn-ghost" onClick={refresh} disabled={loading}>
            <RefreshCw size={13} strokeWidth={2.2} /> Refresh
          </button>
        </div>
      </div>

      <div className="stats-body">
        {!loading && records.length === 0 ? (
          <div className="page-empty">
            <div>
              <h3>No rolls recorded yet</h3>
              <p className="muted">
                Grab some dice! Every roll from here on is remembered — averages, lucky
                streaks, and all.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="stats-filters">
              <div className="stats-filter-row" role="group" aria-label="Who rolled">
                <span className="stats-filter-cap">Who</span>
                <button className={chip(who === "all")} onClick={() => setWho("all")}>
                  Everyone
                </button>
                {rollers.map((roller) => (
                  <button
                    key={roller.id}
                    className={chip(who === roller.id)}
                    onClick={() => setWho(who === roller.id ? "all" : roller.id)}
                  >
                    <span className="chart-dot" style={{ background: roller.color }} />
                    {roller.name}
                  </button>
                ))}
                {isDm ? (
                  <button
                    className={chip(who === "secret")}
                    title="Only your secret rolls"
                    onClick={() => setWho(who === "secret" ? "all" : "secret")}
                  >
                    <EyeOff size={12} strokeWidth={2.2} /> Secret only
                  </button>
                ) : null}
              </div>
              <div className="stats-filter-row" role="group" aria-label="Which die">
                <span className="stats-filter-cap">Die</span>
                <button className={chip(die === "all")} onClick={() => setDie("all")}>
                  Any
                </button>
                {STANDARD_DICE.map((sides) => (
                  <button
                    key={sides}
                    className={chip(die === sides)}
                    onClick={() => setDie(die === sides ? "all" : sides)}
                  >
                    d{sides}
                  </button>
                ))}
                <button
                  className={chip(die === "coin")}
                  onClick={() => setDie(die === "coin" ? "all" : "coin")}
                >
                  Coins
                </button>
                <button
                  className={chip(die === "other")}
                  onClick={() => setDie(die === "other" ? "all" : "other")}
                >
                  Other
                </button>
              </div>
              <div className="stats-filter-row" role="group" aria-label="What the roll was for">
                <span className="stats-filter-cap">For</span>
                <button className={chip(cat === "all")} onClick={() => setCat("all")}>
                  Anything
                </button>
                {CAT_ORDER.map((id) => (
                  <button
                    key={id}
                    className={chip(cat === id)}
                    onClick={() => setCat(cat === id ? "all" : id)}
                  >
                    {CATEGORY_LABELS[id]}
                  </button>
                ))}
              </div>
              <div className="stats-filter-row" role="group" aria-label="Time range">
                <span className="stats-filter-cap">When</span>
                {WHEN_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={chip(when === option.id)}
                    onClick={() => setWhen(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
                {hasFilter ? (
                  <button className="btn-ghost stats-clear" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="page-empty">
                <div>
                  <h3>Nothing matches these filters</h3>
                  <p className="muted">Try widening the time range or clearing a filter.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="stats-tiles">
                  <div className="stat-tile">
                    <span className="stat-tile-label">Total rolls</span>
                    <span className="stat-tile-value">{filtered.length.toLocaleString()}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-label">d20s rolled</span>
                    <span className="stat-tile-value">{keptStats.kept.toLocaleString()}</span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-label">Natural 20s</span>
                    <span className="stat-tile-value">{keptStats.nat20.toLocaleString()}</span>
                    <span className="stat-tile-sub">
                      {keptStats.kept > 0
                        ? `${((keptStats.nat20 / keptStats.kept) * 100).toFixed(1)}% (5% is typical)`
                        : "no d20s yet"}
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-label">Natural 1s</span>
                    <span className="stat-tile-value">{keptStats.nat1.toLocaleString()}</span>
                    <span className="stat-tile-sub">
                      {keptStats.kept > 0
                        ? `${((keptStats.nat1 / keptStats.kept) * 100).toFixed(1)}% (5% is typical)`
                        : "no d20s yet"}
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-label">Luckiest roller</span>
                    <span className="stat-tile-value stat-tile-value--name">
                      {luckiest ? luckiest.name : "—"}
                    </span>
                    <span className="stat-tile-sub">
                      {luckiest
                        ? `avg d20 ${formatAvg(luckiest.avgD20)} over ${luckiest.d20Count} rolls`
                        : `needs ${MIN_D20S_FOR_LUCK}+ d20s from someone`}
                    </span>
                  </div>
                  <div className="stat-tile">
                    <span className="stat-tile-label">Most-rolled die</span>
                    <span className="stat-tile-value">
                      {dieTypes.length > 0
                        ? dieTypes[0].sides > 0
                          ? `d${dieTypes[0].sides}`
                          : "other"
                        : "—"}
                    </span>
                    <span className="stat-tile-sub">
                      {dieTypes.length > 0 ? `${dieTypes[0].count.toLocaleString()} dice thrown` : ""}
                    </span>
                  </div>
                  {coins.heads + coins.tails > 0 ? (
                    <div className="stat-tile">
                      <span className="stat-tile-label">Coin flips</span>
                      <span className="stat-tile-value">
                        {(coins.heads + coins.tails).toLocaleString()}
                      </span>
                      <span className="stat-tile-sub">
                        {coins.heads} heads · {coins.tails} tails
                      </span>
                    </div>
                  ) : null}
                </div>

                <section className="stats-card stats-card--wide">
                  <h3>Who's been lucky?</h3>
                  <p className="stats-caption">
                    “Avg d20” is the bare die before any bonuses — {D20_MEAN} is perfectly
                    average luck. Click a column to sort.
                  </p>
                  <div className="stats-table-scroll">
                    <table className="stats-table">
                      <thead>
                        <tr>
                          {TABLE_COLUMNS.map((col) => (
                            <th
                              key={col.key}
                              aria-sort={
                                sortKey === col.key
                                  ? sortDir === 1
                                    ? "ascending"
                                    : "descending"
                                  : undefined
                              }
                            >
                              <button title={col.title} onClick={() => onSort(col.key)}>
                                {col.label}
                                {sortKey === col.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSummaries.map((row) => {
                          const roller = rollers.find((r) => r.id === row.who);
                          const small = row.d20Count < MIN_D20S_FOR_LUCK;
                          return (
                            <tr key={row.who}>
                              <td className="stats-table-name">
                                <span
                                  className="chart-dot"
                                  style={{
                                    background: roller?.color ?? "var(--chart-ghost)",
                                  }}
                                />
                                {roller?.name ?? row.name}
                              </td>
                              <td>{row.count.toLocaleString()}</td>
                              <td
                                className={small ? "stats-small-sample" : undefined}
                                title={small ? `Fewer than ${MIN_D20S_FOR_LUCK} d20s — take with salt` : undefined}
                              >
                                {formatAvg(row.avgD20)}
                              </td>
                              <td
                                className={`${small ? "stats-small-sample " : ""}${
                                  !small && row.luck !== null
                                    ? row.luck >= 0
                                      ? "stats-luck-up"
                                      : "stats-luck-down"
                                    : ""
                                }`}
                                title={small ? `Fewer than ${MIN_D20S_FOR_LUCK} d20s — take with salt` : undefined}
                              >
                                {formatLuck(row.luck)}
                              </td>
                              <td>{formatAvg(row.avgTotal)}</td>
                              <td>{row.nat20.toLocaleString()}</td>
                              <td>{row.nat1.toLocaleString()}</td>
                              <td>{row.crits.toLocaleString()}</td>
                              <td>
                                {row.advCount} / {row.disCount}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {luckSeries.length > 0 ? (
                  <section className="stats-card stats-card--wide">
                    <h3>Luck over time</h3>
                    <p className="stats-caption">
                      Each line follows a roller's average d20 as their rolls pile up — drifting
                      above the dashed {D20_MEAN} line means the dice have been kind. Early
                      wiggles are normal; the longer the line, the more it means.
                    </p>
                    <LineChart
                      series={luckSeries}
                      refValue={D20_MEAN}
                      refLabel="perfectly average"
                      yClamp={[1, 20]}
                      tooltipTitle={(x) => `After ${x} d20${x === 1 ? "" : "s"}`}
                      valueFormat={(y) => `avg ${y.toFixed(1)}`}
                    />
                  </section>
                ) : null}

                <div className="stats-grid">
                  <section className="stats-card">
                    <h3>Are the dice fair?</h3>
                    <p className="stats-caption">
                      How often each d20 face came up{d20Total > 0 ? ` (${d20Total.toLocaleString()} dice)` : ""}. A fair
                      die lands near the dashed line on every face; dice dropped by
                      advantage/disadvantage are counted too, so the picture stays honest.
                    </p>
                    <Histogram
                      bins={bins}
                      color={histColor}
                      expected={d20Total > 0 ? d20Total / 20 : null}
                      expectedLabel="fair die"
                    />
                  </section>

                  <section className="stats-card">
                    <h3>Rolls over time</h3>
                    <p className="stats-caption">
                      Rolls per day{trendSeries.length >= 2 ? ", stacked by roller" : ""}.
                    </p>
                    <TrendChart days={days} series={trendSeries} />
                  </section>

                  <section className="stats-card">
                    <h3>Which dice get thrown</h3>
                    <p className="stats-caption">
                      Individual dice rolled, by size — with each die's average against what a
                      fair one should average.
                    </p>
                    <HBarList
                      rows={dieTypes.map((d) => ({
                        key: `d${d.sides}`,
                        label: d.sides > 0 ? `d${d.sides}` : "other",
                        value: d.count,
                        detail:
                          d.sides > 0
                            ? `avg ${d.avg.toFixed(1)} (expected ${d.expected.toFixed(1)})`
                            : undefined,
                      }))}
                    />
                  </section>

                  <section className="stats-card">
                    <h3>What the rolls were for</h3>
                    <p className="stats-caption">
                      Checks are “can I do it?”, saves are “can I resist it?”, attacks and
                      damage are the fighting, turn order decides who acts first.
                    </p>
                    <HBarList
                      wideLabels
                      rows={cats.map((entry) => ({
                        key: entry.cat,
                        label: CATEGORY_LABELS[entry.cat],
                        value: entry.count,
                      }))}
                    />
                  </section>
                </div>

                {moments.length > 0 ? (
                  <section className="stats-card stats-card--wide">
                    <h3>Memorable moments</h3>
                    <ul className="stats-moments">
                      {moments.map(({ record, face }, index) => (
                        <li key={`${record.id}-${index}`}>
                          <span
                            className={`stats-moment-badge ${
                              face === 20 ? "stats-moment-badge--crit" : "stats-moment-badge--fumble"
                            }`}
                          >
                            {face === 20 ? "NAT 20" : "NAT 1"}
                          </span>
                          <span className="stats-moment-text">
                            <strong>{record.name}</strong>
                            {record.label ? ` — ${record.label}` : ""}
                            {record.secret ? " (secret)" : ""}
                          </span>
                          <span className="stats-moment-when muted">{timeAgo(record.t)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

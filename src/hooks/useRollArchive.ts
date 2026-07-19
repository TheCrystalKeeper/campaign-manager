import { useCallback, useEffect, useRef, useState } from "react";
import type { RollRecord } from "../lib/types";
import { buildRollRecord } from "../lib/rollStats";
import type { GameRoom } from "./useGameRoom";

export type RollArchive = {
  /** All visible archived rolls, oldest first. */
  records: RollRecord[];
  /** True until the first ROLL_ARCHIVE reply lands. */
  loading: boolean;
  /** Total rolls in the archive (secret ones included, even when filtered out). */
  total: number;
  /** Re-fetch from the server (e.g. the Stats page refresh button). */
  refresh: () => void;
};

/**
 * The Stats page's data source: fetches the server's long roll archive when the
 * page first becomes active, then keeps it live by merging new roll entries off
 * the normal STATE frames (which are already role-redacted, so the merge can
 * never see more than the server allows). Any flip of the DM's reveal switch
 * clears and re-fetches — players must both gain and drop secret records.
 *
 * `total` bookkeeping: each reply's `total` is authoritative, and every roll id
 * in the log at reply time is already inside it (the server archives in
 * appendLog, before broadcasting). So on a reply we mark all of those ids as
 * counted, and only genuinely-new log arrivals bump the number — and never
 * while a refetch is in flight, since its reply will count them anyway.
 */
export function useRollArchive(room: GameRoom, active: boolean): RollArchive {
  const [records, setRecords] = useState<RollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const mapRef = useRef<Map<string, RollRecord>>(new Map());
  /** Roll ids already counted toward `total` (masked ones included). */
  const countedRef = useRef<Set<string>>(new Set());
  const fetchedRef = useRef(false);
  const fetchInFlightRef = useRef(false);
  const revealRef = useRef<boolean | null>(null);

  const { send, subscribeRollArchive, state, status } = room;

  const log = state?.log;
  const logRef = useRef(log);
  logRef.current = log;

  const publish = useCallback(() => {
    setRecords([...mapRef.current.values()].sort((a, b) => a.t - b.t));
  }, []);

  useEffect(() => {
    return subscribeRollArchive((event) => {
      // A fetch reply is the authoritative snapshot: rebuild rather than merge so
      // records that became invisible (reveal switch off) drop out.
      mapRef.current = new Map(event.records.map((record) => [record.id, record]));
      const counted = new Set(event.records.map((record) => record.id));
      for (const entry of logRef.current ?? []) {
        if (entry.kind === "roll") {
          counted.add(entry.roll.id);
        }
      }
      countedRef.current = counted;
      fetchInFlightRef.current = false;
      setTotal(event.total);
      setLoading(false);
      publish();
    });
  }, [subscribeRollArchive, publish]);

  // Lazy initial fetch: only when the page is actually opened, once joined.
  useEffect(() => {
    if (active && !fetchedRef.current && status === "joined") {
      fetchedRef.current = true;
      fetchInFlightRef.current = true;
      send({ type: "GET_ROLL_ARCHIVE" });
    }
  }, [active, status, send]);

  const refresh = useCallback(() => {
    if (status === "joined") {
      fetchedRef.current = true;
      fetchInFlightRef.current = true;
      setLoading(true);
      send({ type: "GET_ROLL_ARCHIVE" });
    }
  }, [status, send]);

  // Reveal-switch transitions invalidate the whole snapshot, both directions.
  const reveal = state?.revealSecretRolls ?? null;
  useEffect(() => {
    if (reveal === null) {
      return;
    }
    if (revealRef.current !== null && revealRef.current !== reveal && fetchedRef.current) {
      mapRef.current = new Map();
      publish();
      fetchInFlightRef.current = true;
      setLoading(true);
      send({ type: "GET_ROLL_ARCHIVE" });
    }
    revealRef.current = reveal;
  }, [reveal, send, publish]);

  // Live merge: new rolls arrive on every STATE frame's log; fold in unseen ones.
  // Masked secret entries carry no values and are skipped (buildRollRecord → null),
  // but they still count toward `total`.
  useEffect(() => {
    if (!fetchedRef.current || !log) {
      return;
    }
    let changed = false;
    let totalBump = 0;
    for (const entry of log) {
      if (entry.kind !== "roll") {
        continue;
      }
      const id = entry.roll.id;
      if (!countedRef.current.has(id)) {
        countedRef.current.add(id);
        // A pending refetch's reply will include this roll in its own total.
        if (!fetchInFlightRef.current) {
          totalBump += 1;
        }
      }
      if (!mapRef.current.has(id)) {
        const record = buildRollRecord(entry);
        if (record) {
          mapRef.current.set(id, record);
          changed = true;
        }
      }
    }
    if (totalBump > 0) {
      setTotal((current) => current + totalBump);
    }
    if (changed) {
      publish();
    }
  }, [log, publish]);

  return { records, loading, total, refresh };
}

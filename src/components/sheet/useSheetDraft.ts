import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultSheet, DEFAULT_ICON_CROP, SHEET_SOFT_WARN_BYTES, type CharacterSheet, type SheetRecord } from "../../lib/types";
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback";
import { uploadPortrait } from "../../lib/uploadAsset";

/**
 * Local editable draft of a sheet, debounced to the server (Phase 7 — extracted from
 * the old CharacterSheet.tsx). Saves are field-granular: only the top-level keys touched
 * since the last flush are sent (the server merges the patch over the stored sheet), so
 * two editors of the same sheet — e.g. the floating sheet window and the docked Inventory
 * panel — can't clobber each other's untouched fields with stale copies. Remote echoes
 * merge into every key WITHOUT a pending local edit, so both editors live-mirror while
 * in-progress typing is never clobbered. Exposes a soft size warning below the hard
 * server cap and the portrait-upload flow.
 */
export function useSheetDraft(
  record: SheetRecord | null,
  canEdit: boolean,
  roomId: string,
  onChange: (sheet: Partial<CharacterSheet>) => void,
) {
  const [draft, setDraft] = useState<CharacterSheet>(record?.data ?? createDefaultSheet(""));
  const [uploading, setUploading] = useState(false);
  // Top-level keys edited locally since the last debounce flush. While a key is in
  // here its draft value wins over remote echoes; it leaves the set on flush.
  const touchedRef = useRef<Set<keyof CharacterSheet>>(new Set());
  const { debounced } = useDebouncedCallback((next: CharacterSheet) => {
    const patch: Partial<CharacterSheet> = {};
    for (const key of touchedRef.current) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
    touchedRef.current.clear();
    onChange(patch);
  }, 400);

  useEffect(() => {
    setDraft(record?.data ?? createDefaultSheet(""));
    touchedRef.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  // Adopt remote updates for every clean key (keys still touched keep the local value
  // until they flush). Accepted transient: between a flush and our own echo (~1 RTT),
  // a foreign broadcast can briefly show the pre-edit value — the echo restores it,
  // and the server state is never wrong.
  useEffect(() => {
    if (!record) {
      return;
    }
    setDraft((prev) => {
      if (touchedRef.current.size === 0) {
        return record.data;
      }
      const merged: CharacterSheet = { ...record.data };
      for (const key of touchedRef.current) {
        (merged as Record<string, unknown>)[key] = prev[key];
      }
      return merged;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.data]);

  const value = canEdit ? draft : (record?.data ?? createDefaultSheet(""));

  const update = (patch: Partial<CharacterSheet>) => {
    if (!canEdit) return;
    for (const key of Object.keys(patch)) {
      touchedRef.current.add(key as keyof CharacterSheet);
    }
    const next = { ...draft, ...patch };
    setDraft(next);
    debounced(next);
  };

  const handlePortrait = async (file: File) => {
    if (!canEdit || !record) return;
    setUploading(true);
    try {
      const { url } = await uploadPortrait(roomId, record.id, file);
      // A new picture starts fresh: reset the crop so the previous focal point/zoom doesn't
      // carry onto a differently-shaped image.
      update({ iconUrl: url, iconCrop: { ...DEFAULT_ICON_CROP } });
    } catch {
      // Non-fatal: portrait stays unchanged.
    } finally {
      setUploading(false);
    }
  };

  // Soft warning as the sheet approaches the hard server-side size cap.
  const overSoftCap = useMemo(() => JSON.stringify(value).length > SHEET_SOFT_WARN_BYTES, [value]);

  return { value, update, uploading, handlePortrait, overSoftCap };
}

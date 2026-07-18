import { useEffect, useRef } from "react";
import { campaignKey } from "../../lib/campaignStore";

/**
 * Persists a textarea's user-resized height to localStorage (namespaced per campaign +
 * sheet + field) so it survives closing and reopening the sheet. Sheet textareas only
 * resize vertically (see `textarea { resize: vertical }`), so height is the only
 * dimension tracked. Attach the returned ref to the textarea.
 */
export function useTextareaSize(roomId: string, sheetId: string, field: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const key = campaignKey(roomId, `sheet-ta:${sheetId}:${field}`);
    try {
      const stored = Number(localStorage.getItem(key));
      if (Number.isFinite(stored) && stored > 0) {
        el.style.height = `${stored}px`;
      }
    } catch {
      // storage unavailable — falls back to the CSS default height
    }

    let last = el.offsetHeight;
    let skipFirst = true;
    const observer = new ResizeObserver(() => {
      // The observer's own observe() call fires an initial callback; skip it so mounting
      // (including the height restore above) never counts as a user resize.
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      const height = el.offsetHeight;
      if (height === last) {
        return;
      }
      last = height;
      try {
        localStorage.setItem(key, String(height));
      } catch {
        // storage full/unavailable — the resize simply won't persist
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [roomId, sheetId, field]);

  return ref;
}

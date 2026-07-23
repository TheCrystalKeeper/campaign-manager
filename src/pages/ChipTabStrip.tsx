import { useCallback, useEffect, useRef, type ReactNode } from "react";

export function ChipTabStrip({
  children,
  activeId,
}: {
  children: ReactNode;
  activeId?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const updateFade = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const atLeft = scrollLeft > 1;
    const atRight = scrollLeft + clientWidth < scrollWidth - 1;
    const fade = atLeft && atRight ? "both" : atLeft ? "left" : atRight ? "right" : "none";
    if (el.dataset.fade !== fade) el.dataset.fade = fade;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(updateFade);
    ro.observe(el);
    el.addEventListener("scroll", updateFade, { passive: true });
    updateFade();
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", updateFade);
    };
  }, [updateFade]);

  useEffect(() => {
    if (!activeId) return;
    const chip = ref.current?.querySelector(`[data-chip-id="${CSS.escape(activeId)}"]`);
    if (chip) (chip as HTMLElement).scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeId]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const el = ref.current;
    if (el) el.scrollLeft += e.deltaY + e.deltaX;
  }, []);

  return (
    <div className="chip-tab-strip" ref={ref} onWheel={onWheel}>
      {children}
    </div>
  );
}

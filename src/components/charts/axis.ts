/** Clean axis ticks (1/2/2.5/5 steps). `integer` forces whole-number ticks for
 *  count axes. Returns ascending values inside [min, max]. */
export function niceTicks(min: number, max: number, target = 4, integer = false): number[] {
  if (max <= min) {
    max = min + 1;
  }
  const span = max - min;
  const magnitude = Math.pow(10, Math.floor(Math.log10(span / target)));
  const candidates = [1, 2, 2.5, 5, 10].map((s) => s * magnitude);
  let step = candidates.find((s) => span / s <= target) ?? candidates[candidates.length - 1];
  if (integer) {
    step = Math.max(1, Math.round(step));
  }
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/** Format seconds for clip ranges, e.g. 0.9s → 1.8s */
export function formatSecRange(startSec: number, endSec: number): string {
  const a = Number.isFinite(startSec) ? startSec.toFixed(1) : '?'
  const b = Number.isFinite(endSec) ? endSec.toFixed(1) : '?'
  return `${a}s → ${b}s`
}

import type { IsoDate } from "@/lib/domain/entry";

/** Parsed as UTC on purpose: entries are calendar days, so a local-midnight parse would shift them. */
export function parseIsoDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function formatValue(
  value: number,
  unit: string,
  precision: number,
  locale: string,
): string {
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
  return unit ? `${number} ${unit}` : number;
}

export function formatAxisDate(date: IsoDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDate(date));
}

export function formatFullDate(date: IsoDate, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDate(date));
}

/** The smallest 1/2/5×10ⁿ step that splits `range` into at most `targetTicks` gaps. */
function niceStep(range: number, targetTicks: number): number {
  const raw = range / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  for (const step of [1, 2, 5]) {
    if (raw <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/**
 * Builds a y-axis a human would have drawn: a clean top value and evenly
 * spaced, round tick labels.
 *
 * Left to itself, `max * headroom` yields a ceiling like 19.7, and Recharts
 * then picks its own ticks inside that domain — which is how the all-rest-days
 * case ended up labelled 0, 3, 6, 9, 10. Ticks are the values we chose *not* to
 * label directly, so they have to be legible on their own.
 */
export function niceAxis(
  maxValue: number,
  goal: number | undefined,
  targetTicks = 4,
): { max: number; ticks: number[] } {
  const ceiling = Math.max(maxValue, goal ?? 0) * 1.12;
  if (!Number.isFinite(ceiling) || ceiling <= 0) {
    return { max: 1, ticks: [0, 1] };
  }

  const step = niceStep(ceiling, targetTicks);
  const max = Math.ceil(ceiling / step) * step;

  const ticks: number[] = [];
  for (let tick = 0; tick <= max + step / 2; tick += step) {
    // Guard against binary-float drift accumulating across additions.
    ticks.push(Number(tick.toFixed(6)));
  }
  return { max, ticks };
}

/**
 * Keeps the x-axis from rendering one label per day at 30d/90d. Recharts'
 * `interval` counts skipped ticks, so this returns "show every Nth".
 */
export function tickInterval(pointCount: number, targetTicks = 6): number {
  return Math.max(0, Math.ceil(pointCount / targetTicks) - 1);
}

import { describe, expect, it } from "vitest";
import type { Entry } from "./entry";
import { addDays, buildTrendSeries, rangeBounds } from "./trend";

const TODAY = "2026-07-28";

function entry(date: string, over: Partial<Entry> = {}): Entry {
  return {
    id: `e_${date}_${over.activity ?? "run"}`,
    date,
    activity: "Run",
    durationMin: 30,
    distanceKm: 5,
    source: "manual",
    createdAt: 1,
    ...over,
  };
}

describe("addDays", () => {
  it("crosses a month boundary", () => {
    expect(addDays("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("crosses a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("rangeBounds", () => {
  it("is inclusive on both ends", () => {
    // 7 days ending today means today and the six before it — not eight.
    expect(rangeBounds(TODAY, "7d")).toEqual({ from: "2026-07-22", to: TODAY });
  });
});

describe("buildTrendSeries", () => {
  it("emits one point per day, including days with no entries", () => {
    const series = buildTrendSeries([entry(TODAY)], "distanceKm", "7d", TODAY);
    expect(series).toHaveLength(7);
    expect(series.map((p) => p.date)).toEqual([
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
    ]);
  });

  it("represents a rest day as zero rather than a gap", () => {
    // The distinction matters: a gap would let the line jump from Monday to
    // Wednesday and overstate the trend. A rest day is a measured zero.
    const series = buildTrendSeries([entry(TODAY)], "distanceKm", "7d", TODAY);
    expect(series.slice(0, 6).every((p) => p.value === 0)).toBe(true);
    expect(series.at(-1)?.value).toBe(5);
  });

  it("sums multiple sessions on the same day", () => {
    const series = buildTrendSeries(
      [entry(TODAY), entry(TODAY, { activity: "Evening run", distanceKm: 3.2 })],
      "distanceKm",
      "7d",
      TODAY,
    );
    expect(series.at(-1)?.value).toBeCloseTo(8.2);
  });

  it("treats a missing distance as zero for the distance metric", () => {
    const series = buildTrendSeries(
      [entry(TODAY, { activity: "Yoga", distanceKm: undefined })],
      "distanceKm",
      "7d",
      TODAY,
    );
    expect(series.at(-1)?.value).toBe(0);
  });

  it("counts sessions rather than measuring them for the sessions metric", () => {
    const series = buildTrendSeries(
      [entry(TODAY), entry(TODAY, { activity: "Yoga", distanceKm: undefined })],
      "sessions",
      "7d",
      TODAY,
    );
    expect(series.at(-1)?.value).toBe(2);
  });

  it("excludes entries outside the range", () => {
    const series = buildTrendSeries(
      [entry("2026-01-01"), entry(TODAY)],
      "distanceKm",
      "7d",
      TODAY,
    );
    expect(series.reduce((sum, p) => sum + p.value, 0)).toBe(5);
  });
});

import { describe, expect, it } from "vitest";
import { formatValue, niceAxis, tickInterval } from "./format";

describe("niceAxis", () => {
  it("rounds the ceiling to a value a human would pick", () => {
    // 16.7 * 1.12 = 18.7 — an axis topping out at "18.7" reads as a
    // measurement rather than a scale.
    expect(niceAxis(16.7, 5).max).toBe(20);
  });

  it("produces evenly spaced, round ticks", () => {
    expect(niceAxis(16.7, 5).ticks).toEqual([0, 5, 10, 15, 20]);
  });

  it("keeps the goal inside the axis when it exceeds every value", () => {
    // The all-rest-days case: nothing plotted, but the goal line still has to fit.
    const { max, ticks } = niceAxis(0, 5);
    expect(max).toBeGreaterThanOrEqual(5);
    expect(ticks).toEqual([0, 2, 4, 6]);
  });

  it("never emits an awkward step like 3", () => {
    for (const value of [1, 3, 7, 12, 47, 88, 210, 999]) {
      const { ticks } = niceAxis(value, undefined);
      const step = ticks[1] - ticks[0];
      const normalised = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5, 10]).toContain(Number(normalised.toFixed(6)));
    }
  });

  it("survives an all-zero series without collapsing the domain", () => {
    const { max, ticks } = niceAxis(0, undefined);
    expect(max).toBe(1);
    expect(ticks.length).toBeGreaterThan(1);
  });

  it("starts every axis at zero", () => {
    expect(niceAxis(120, 90).ticks[0]).toBe(0);
  });
});

describe("tickInterval", () => {
  it("keeps the visible label count readable at every range", () => {
    // The absolute interval is uninteresting; what matters is that no range
    // crowds the axis or strips it down to a lone date.
    for (const points of [7, 30, 90]) {
      const visible = Math.ceil(points / (tickInterval(points) + 1));
      expect(visible).toBeGreaterThanOrEqual(3);
      expect(visible).toBeLessThanOrEqual(7);
    }
  });

  it("thins more aggressively as the range grows", () => {
    expect(tickInterval(90)).toBeGreaterThan(tickInterval(30));
    expect(tickInterval(30)).toBeGreaterThan(tickInterval(7));
  });
});

describe("formatValue", () => {
  it("appends the unit", () => {
    expect(formatValue(8.25, "km", 1, "en-US")).toBe("8.3 km");
  });

  it("omits the separator for unitless metrics", () => {
    expect(formatValue(3, "", 0, "en-US")).toBe("3");
  });

  it("respects the locale", () => {
    expect(formatValue(1234.5, "km", 1, "es-ES")).toBe("1234,5 km");
  });
});

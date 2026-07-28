import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

afterEach(cleanup);

/**
 * jsdom has no layout engine, so Recharts' <ResponsiveContainer> measures 0x0 and
 * renders nothing. We give it a deterministic 800x400 box.
 *
 * Note what this does NOT buy us: jsdom still doesn't compute SVG geometry, so
 * asserting on rendered paths would be asserting on a fiction. The chart's tests
 * therefore read the accessible surface — the data table and the radiogroup —
 * which is the content a screen-reader user gets and the thing we actually
 * promise. Visual correctness is Storybook's job, not jsdom's.
 */
beforeAll(() => {
  const BOX = { width: 800, height: 400 };

  class ResizeObserverStub implements ResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: {
              ...BOX,
              top: 0,
              left: 0,
              right: BOX.width,
              bottom: BOX.height,
              x: 0,
              y: 0,
              toJSON: () => ({}),
            },
          } as unknown as ResizeObserverEntry,
        ],
        this,
      );
    }
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverStub;

  for (const [prop, value] of [
    ["offsetWidth", BOX.width],
    ["offsetHeight", BOX.height],
    ["clientWidth", BOX.width],
    ["clientHeight", BOX.height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      value,
    });
  }
});

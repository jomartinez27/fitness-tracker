import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrendChart, type TrendChartProps } from "./trend-chart";
import { defaultTrendCopy } from "./copy";
import { DEMO_GOAL, demoSeries, edgeCases } from "./fixtures";

function renderChart(overrides: Partial<TrendChartProps> = {}) {
  const onRangeChange = vi.fn();
  const onRetry = vi.fn();
  const props: TrendChartProps = {
    title: "Distance",
    description: "Kilometres per day",
    data: demoSeries["7d"],
    unit: "km",
    precision: 1,
    goal: DEMO_GOAL,
    range: "7d",
    onRangeChange,
    status: "ready",
    onRetry,
    copy: defaultTrendCopy,
    ...overrides,
  };
  const result = render(<TrendChart {...props} />);
  return { ...result, onRangeChange, onRetry, props };
}

describe("TrendChart — ready", () => {
  it("names what is plotted without a legend box (single series)", () => {
    renderChart();
    expect(screen.getByRole("heading", { name: "Distance" })).toBeInTheDocument();
  });

  it("exposes every plotted value in a table, not only in the tooltip", () => {
    // The tooltip enhances; it never gates. Everything hover shows must be
    // reachable without hovering — which is also why this is testable in jsdom.
    renderChart();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(demoSeries["7d"].length + 1);
  });

  it("announces a summary including the goal", () => {
    renderChart();
    expect(screen.getByText(/Goal is 5\.0 km per day\./)).toBeInTheDocument();
  });

  it("hides the SVG from assistive tech so the table is the single source", () => {
    const { container } = renderChart();
    const svgHost = container.querySelector('[aria-hidden="true"]');
    expect(svgHost).toBeTruthy();
    expect(container.querySelector("svg")?.closest('[aria-hidden="true"]')).toBeTruthy();
  });

  it("plots a flat zero series rather than treating it as empty", () => {
    // Seven rest days is a real, valid chart. Falling back to an empty state
    // here would tell the user their data is missing when it isn't.
    renderChart({ data: edgeCases.allZero });
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByText(defaultTrendCopy.emptyInRangeTitle)).not.toBeInTheDocument();
  });

  it("renders a single data point without collapsing", () => {
    renderChart({ data: edgeCases.singlePoint });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });
});

describe("TrendChart — empty", () => {
  it("distinguishes 'nothing logged yet' from 'nothing in this range'", () => {
    const { unmount } = renderChart({ data: [], hasAnyData: false });
    expect(screen.getByText(defaultTrendCopy.emptyNoDataTitle)).toBeInTheDocument();
    unmount();

    renderChart({ data: [], hasAnyData: true });
    expect(screen.getByText(defaultTrendCopy.emptyInRangeTitle)).toBeInTheDocument();
    expect(screen.getByText(/Try a longer range/)).toBeInTheDocument();
  });

  it("renders no table when there is nothing to tabulate", () => {
    renderChart({ data: [], hasAnyData: false });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("keeps the range selector usable so the user can widen the window", () => {
    renderChart({ data: [], hasAnyData: true });
    expect(screen.getByRole("radio", { name: "90 days" })).toBeEnabled();
  });
});

describe("TrendChart — loading", () => {
  it("shows a skeleton only on first load", () => {
    const { container } = renderChart({ data: [], status: "loading" });
    expect(container.querySelector('[class*="skeleton"]')).toBeTruthy();
    expect(screen.getByText(defaultTrendCopy.loading)).toBeInTheDocument();
  });

  it("keeps the previous frame on refetch instead of collapsing to a skeleton", () => {
    // Changing range refetches. A skeleton there would throw away a perfectly
    // good render and jump the layout for a sub-second wait.
    const { container } = renderChart({ data: demoSeries["7d"], status: "loading" });
    expect(container.querySelector('[class*="skeleton"]')).toBeNull();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(container.querySelector('[class*="refetching"]')).toBeTruthy();
  });
});

describe("TrendChart — error", () => {
  it("announces the failure and offers a retry", async () => {
    const { onRetry } = renderChart({ status: "error" });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText(defaultTrendCopy.errorTitle)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("reassures that the failure is cosmetic, not data loss", () => {
    renderChart({ status: "error" });
    expect(screen.getByText(/Your data is safe/)).toBeInTheDocument();
  });

  it("suppresses the stale summary while erroring", () => {
    // Leaving the old summary in a live region would have a screen reader
    // confidently read numbers we just admitted we couldn't load.
    renderChart({ status: "error" });
    expect(screen.queryByText(/Total /)).not.toBeInTheDocument();
  });

  it("disables range changes that cannot currently succeed", () => {
    renderChart({ status: "error" });
    expect(screen.getByRole("radio", { name: "90 days" })).toBeDisabled();
  });
});

describe("TrendChart — range selection", () => {
  it("reports the requested range to the parent", async () => {
    const { onRangeChange } = renderChart({ range: "7d" });
    await userEvent.setup().click(screen.getByRole("radio", { name: "30 days" }));
    expect(onRangeChange).toHaveBeenCalledWith("30d");
  });
});

describe("TrendChart — hydration", () => {
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => errorSpy.mockClear());

  it("hydrates server-rendered markup without a mismatch", async () => {
    // Risk R5. Recharts measures the DOM, so a naive server render is a classic
    // source of hydration mismatches — assert it rather than assume the
    // 'use client' boundary handled it.
    const props: TrendChartProps = {
      title: "Distance",
      data: demoSeries["7d"],
      unit: "km",
      goal: DEMO_GOAL,
      range: "7d",
      onRangeChange: () => {},
      status: "ready",
      copy: defaultTrendCopy,
    };

    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <StrictMode>
        <TrendChart {...props} />
      </StrictMode>,
    );
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(
        container,
        <StrictMode>
          <TrendChart {...props} />
        </StrictMode>,
      );
    });

    const mismatches = errorSpy.mock.calls.filter((call) =>
      String(call[0]).match(/hydrat|did not match|Text content/i),
    );
    expect(mismatches).toEqual([]);
    container.remove();
  });
});

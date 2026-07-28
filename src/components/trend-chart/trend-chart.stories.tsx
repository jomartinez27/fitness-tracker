import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useState } from "react";
import type { TrendRange } from "@/lib/domain/entry";
import { TrendChart } from "./trend-chart";
import { defaultTrendCopy } from "./copy";
import { DEMO_GOAL, demoSeries, edgeCases } from "./fixtures";

const meta = {
  title: "Charts/TrendChart",
  component: TrendChart,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Built and tested in isolation before anything consumes it (Phase 1). " +
          "It takes data, a goal, a range, and an explicit `status` — it fetches " +
          "nothing, which is exactly what makes empty/loading/error reachable here.",
      },
    },
  },
  args: {
    title: "Distance",
    description: "Kilometres per day",
    unit: "km",
    precision: 1,
    goal: DEMO_GOAL,
    range: "30d" as TrendRange,
    data: demoSeries["30d"],
    status: "ready",
    copy: defaultTrendCopy,
    onRangeChange: () => {},
    onRetry: () => {},
  },
} satisfies Meta<typeof TrendChart>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ---------- the happy path, at each range ---------- */

export const SevenDays: Story = {
  args: { range: "7d", data: demoSeries["7d"] },
};

export const ThirtyDays: Story = {
  args: { range: "30d", data: demoSeries["30d"] },
};

export const NinetyDays: Story = {
  name: "90 days (axis must thin its ticks)",
  args: { range: "90d", data: demoSeries["90d"] },
};

/* ---------- async states ---------- */

export const LoadingFirstRun: Story = {
  name: "Loading — first run (skeleton)",
  args: { status: "loading", data: [] },
  parameters: {
    docs: {
      description: {
        story: "A skeleton is only correct when there is no previous frame to keep.",
      },
    },
  },
};

export const Refetching: Story = {
  name: "Loading — refetch (keeps the frame)",
  args: { status: "loading", data: demoSeries["30d"] },
  parameters: {
    docs: {
      description: {
        story:
          "Changing range refetches. Swapping a good render for a skeleton would " +
          "jump the layout for a sub-second wait, so the previous frame dims instead.",
      },
    },
  },
};

export const ErrorWithRetry: Story = {
  name: "Error — with retry",
  args: { status: "error" },
};

export const EmptyNothingLogged: Story = {
  name: "Empty — nothing logged yet",
  args: { data: [], hasAnyData: false },
};

export const EmptyNothingInRange: Story = {
  name: "Empty — nothing in this range",
  args: { data: [], hasAnyData: true, range: "7d" },
  parameters: {
    docs: {
      description: {
        story:
          "A different situation from the story above, and it gets different copy: " +
          "the user has data, just not here, so the useful nudge is a longer range.",
      },
    },
  },
};

/* ---------- the awkward cases ---------- */

export const SinglePoint: Story = {
  name: "Edge — a single data point",
  args: { data: edgeCases.singlePoint, range: "7d" },
};

export const AllZero: Story = {
  name: "Edge — a full week of rest days",
  args: { data: edgeCases.allZero, range: "7d" },
  parameters: {
    docs: {
      description: {
        story:
          "A flat line at zero is a real chart, not an empty state. Rendering " +
          "'no data' here would tell the user their sessions are missing when " +
          "the truth is they took the week off.",
      },
    },
  },
};

export const GoalAboveSeries: Story = {
  name: "Edge — goal above every value",
  args: { data: edgeCases.goalAboveSeries, range: "7d", goal: { value: 12 } },
};

export const GoalBelowSeries: Story = {
  name: "Edge — goal below every value",
  args: { data: edgeCases.goalBelowSeries, range: "7d", goal: { value: 4 } },
};

export const NoGoal: Story = {
  name: "Edge — no goal set",
  args: { goal: null, range: "7d", data: demoSeries["7d"] },
};

export const LongTitle: Story = {
  name: "Edge — long title wraps without shoving the selector",
  args: {
    title: "Average running distance per day, excluding cross-training",
    range: "7d",
    data: demoSeries["7d"],
  },
};

/* ---------- responsive ---------- */

export const Mobile: Story = {
  args: { range: "7d", data: demoSeries["7d"] },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
};

/* ---------- interaction, verified in a real browser ---------- */

function InteractiveChart() {
  const [range, setRange] = useState<TrendRange>("30d");
  return (
    <TrendChart
      title="Distance"
      description="Kilometres per day"
      unit="km"
      goal={DEMO_GOAL}
      range={range}
      data={demoSeries[range]}
      status="ready"
      onRangeChange={setRange}
      copy={defaultTrendCopy}
    />
  );
}

export const KeyboardRangeSelection: Story = {
  name: "Interaction — keyboard range selection",
  render: () => <InteractiveChart />,
  play: async ({ canvasElement }) => {
    // Runs in Chromium via the Vitest browser project, so this is real focus
    // management and real SVG layout — not a jsdom approximation.
    const canvas = within(canvasElement);

    await userEvent.tab();
    const thirty = canvas.getByRole("radio", { name: "30 days" });
    await expect(thirty).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("radio", { name: "90 days" })).toBeChecked();
    await expect(canvas.getByRole("radio", { name: "90 days" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    await expect(canvas.getByRole("radio", { name: "7 days" })).toBeChecked();

    // The table is the accessible content, so it must track the range too.
    await expect(canvas.getAllByRole("row")).toHaveLength(8); // 7 days + header
  },
};

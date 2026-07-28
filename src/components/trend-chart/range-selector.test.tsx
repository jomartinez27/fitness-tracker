import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RangeSelector } from "./range-selector";
import { defaultTrendCopy } from "./copy";

function setup(value: "7d" | "30d" | "90d" = "30d") {
  const onChange = vi.fn();
  render(
    <RangeSelector
      value={value}
      onChange={onChange}
      label={defaultTrendCopy.rangeGroupLabel}
      optionLabels={defaultTrendCopy.rangeOptions}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe("RangeSelector", () => {
  it("exposes a labelled radiogroup, not a row of buttons", () => {
    setup();
    const group = screen.getByRole("radiogroup", { name: "Time range" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("marks exactly one option as checked", () => {
    setup("30d");
    expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "7 days" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "90 days" })).not.toBeChecked();
  });

  it("is a single tab stop — only the checked option is tabbable", () => {
    setup("30d");
    expect(screen.getByRole("radio", { name: "30 days" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "7 days" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "90 days" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves selection with arrow keys", async () => {
    const { onChange, user } = setup("30d");
    await user.tab();
    expect(screen.getByRole("radio", { name: "30 days" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("90d");
  });

  it("wraps from the last option to the first", async () => {
    const { onChange, user } = setup("90d");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("7d");
  });

  it("jumps to the ends with Home and End", async () => {
    const { onChange, user } = setup("30d");
    await user.tab();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("7d");
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("90d");
  });

  it("selects on click", async () => {
    const { onChange, user } = setup("30d");
    await user.click(screen.getByRole("radio", { name: "7 days" }));
    expect(onChange).toHaveBeenCalledWith("7d");
  });
});

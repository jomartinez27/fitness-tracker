import { describe, expect, it } from "vitest";
import { EMPTY_DRAFT_VALUES, type DraftValues } from "@/lib/domain/entry";
import { stepOf, toEntry, validateAll, validateStep } from "./schema";

const TODAY = "2026-07-28";

const values = (over: Partial<DraftValues> = {}): DraftValues => ({
  ...EMPTY_DRAFT_VALUES,
  activity: "Run",
  date: TODAY,
  durationMin: "42",
  ...over,
});

describe("validateStep", () => {
  it("only reports fields belonging to the step being left", () => {
    // Step 0 knows nothing about duration; complaining about it here would
    // show an error for a field the user can't see.
    const errors = validateStep(0, values({ durationMin: "" }), TODAY);
    expect(errors).toEqual({});
  });

  it("requires an activity name", () => {
    expect(validateStep(0, values({ activity: "  " }), TODAY)).toEqual({
      activity: "activityRequired",
    });
  });

  it("rejects a date in the future", () => {
    expect(validateStep(0, values({ date: "2027-01-01" }), TODAY)).toEqual({
      date: "dateInFuture",
    });
  });

  it("accepts today itself", () => {
    // An off-by-one here would reject the most common case there is: logging
    // the session you just finished.
    expect(validateStep(0, values({ date: TODAY }), TODAY)).toEqual({});
  });

  it("rejects a non-numeric duration", () => {
    expect(validateStep(1, values({ durationMin: "4o" }), TODAY)).toEqual({
      durationMin: "durationInvalid",
    });
  });

  it("rejects a zero-minute session", () => {
    expect(validateStep(1, values({ durationMin: "0" }), TODAY)).toEqual({
      durationMin: "durationInvalid",
    });
  });

  it("rejects a duration longer than a day", () => {
    expect(validateStep(1, values({ durationMin: "1441" }), TODAY)).toEqual({
      durationMin: "durationTooLong",
    });
  });

  it("treats distance as genuinely optional", () => {
    // Yoga has no distance. Requiring one would make the form lie about itself.
    expect(validateStep(1, values({ distanceKm: "" }), TODAY)).toEqual({});
  });

  it("accepts a comma decimal separator", () => {
    expect(validateStep(1, values({ distanceKm: "5,2" }), TODAY)).toEqual({});
  });

  it("rejects a malformed distance", () => {
    expect(validateStep(1, values({ distanceKm: "5km" }), TODAY)).toEqual({
      distanceKm: "distanceInvalid",
    });
  });
});

describe("validateAll", () => {
  it("collects errors across every step", () => {
    const errors = validateAll(
      values({ activity: "", durationMin: "", date: "" }),
      TODAY,
    );
    expect(Object.keys(errors).sort()).toEqual(["activity", "date", "durationMin"]);
  });
});

describe("stepOf", () => {
  it("maps a field back to the step that owns it", () => {
    expect(stepOf("activity")).toBe(0);
    expect(stepOf("distanceKm")).toBe(1);
    expect(stepOf("notes")).toBe(2);
  });
});

describe("toEntry", () => {
  it("trims and converts validated input", () => {
    expect(toEntry(values({ activity: "  Run  ", durationMin: "42" }))).toEqual({
      activity: "Run",
      date: TODAY,
      durationMin: 42,
      source: "manual",
    });
  });

  it("normalises a comma decimal", () => {
    expect(toEntry(values({ distanceKm: "5,2" })).distanceKm).toBe(5.2);
  });

  it("omits optional fields rather than storing empty strings", () => {
    // `distanceKm: ""` would break the sum in buildTrendSeries; absent is correct.
    const entry = toEntry(values({ distanceKm: "  ", notes: "  " }));
    expect("distanceKm" in entry).toBe(false);
    expect("notes" in entry).toBe(false);
  });
});

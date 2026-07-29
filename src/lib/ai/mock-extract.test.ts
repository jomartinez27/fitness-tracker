import { describe, expect, it } from "vitest";
import { EXTRACTION_FIXTURES, contractViolations } from "./extraction-contract";
import { extractionSchema } from "./extraction";
import { mockExtract } from "./mock-extract";

const TODAY = "2026-07-28"; // a Tuesday

const extract = (text: string, today = TODAY) => mockExtract(text, { today });

describe("mockExtract — the shared extractor contract", () => {
  // The same fixtures the model is held to in #21. If these two ever disagree,
  // the fallback has drifted from the thing it exists to replace.
  it.each(EXTRACTION_FIXTURES)("$name", (fixture) => {
    const violations = contractViolations(fixture, mockExtract(fixture.input, fixture));
    expect(violations).toEqual([]);
  });
});

describe("mockExtract — determinism", () => {
  it("returns identical output for identical input", () => {
    // This is what makes it usable as a Playwright fixture: no retries, no
    // flake, no API spend.
    const a = extract("ran 5k, 30 min yoga");
    const b = extract("ran 5k, 30 min yoga");
    expect(a).toEqual(b);
  });

  it("takes today as an argument rather than reading the clock", () => {
    expect(extract("ran 5k", "2026-01-01").entries[0].date).toBe("2026-01-01");
  });
});

describe("mockExtract — honesty about what it knows", () => {
  it("marks a duration derived from distance as inferred", () => {
    // "ran 5k" states no duration. Something has to fill the field, but it must
    // not look like a number the user reported.
    const [entry] = extract("ran 5k").entries;
    expect(entry.distanceKm).toBe(5);
    expect(entry.inferred).toContain("durationMin");
  });

  it("does not mark a stated duration as inferred", () => {
    const [entry] = extract("30 min yoga").entries;
    expect(entry.durationMin).toBe(30);
    expect(entry.inferred).not.toContain("durationMin");
  });

  it("marks an assumed date as inferred", () => {
    const [entry] = extract("ran 5k").entries;
    expect(entry.inferred).toContain("date");
  });

  it("does not mark a stated date as inferred", () => {
    const [entry] = extract("yesterday I ran 5k").entries;
    expect(entry.date).toBe("2026-07-27");
    expect(entry.inferred).not.toContain("date");
  });

  it("skips text it does not recognise instead of inventing an activity", () => {
    // Guessing "Session" from "felt tired" would put fiction on the chart.
    expect(extract("felt tired, slept badly").entries).toEqual([]);
  });

  it("recognises a race as a run", () => {
    // "half marathon 21.1km in 1h52" extracted nothing until this was added —
    // the fixtures all used the word "ran".
    const [entry] = extract("half marathon 21.1km in 1h52").entries;
    expect(entry.activity).toBe("Run");
    expect(entry.distanceKm).toBe(21.1);
    expect(entry.durationMin).toBe(112);
  });

  it("accepts a vaguely-named session without inventing a discipline", () => {
    // The user said "workout"; recording it as a Run would be a fabrication,
    // and dropping it loses a session they explicitly reported.
    const [entry] = extract("45 min workout").entries;
    expect(entry.activity).toBe("Workout");
    expect(entry.durationMin).toBe(45);
  });

  it("does not let the generic rule shadow a specific one", () => {
    expect(extract("strength training 40 min").entries[0].activity).toBe("Strength");
    expect(extract("interval session 25 min").entries[0].activity).toBe("HIIT");
  });

  it("keeps recognised activities from a partly unrecognised input", () => {
    const { entries } = extract("felt tired but ran 5k anyway");
    expect(entries).toHaveLength(1);
    expect(entries[0].activity).toBe("Run");
  });
});

describe("mockExtract — parsing", () => {
  it("separates activities on a comma without breaking a decimal", () => {
    expect(extract("ran 5,2 km, 30 min yoga").entries).toHaveLength(2);
    expect(extract("ran 5,2 km").entries[0].distanceKm).toBe(5.2);
  });

  it("reads bare 'k' shorthand as kilometres", () => {
    expect(extract("ran 10k").entries[0].distanceKm).toBe(10);
  });

  it("does not read a duration as a distance", () => {
    const [entry] = extract("30 min yoga").entries;
    expect(entry.distanceKm).toBeUndefined();
  });

  it("converts miles", () => {
    expect(extract("ran 3 miles").entries[0].distanceKm).toBeCloseTo(4.83, 1);
  });

  it("reads compound durations", () => {
    expect(extract("cycled 1h30").entries[0].durationMin).toBe(90);
    expect(extract("cycled 2 hours").entries[0].durationMin).toBe(120);
    expect(extract("cycled 1 hr 20 min").entries[0].durationMin).toBe(80);
  });

  it("splits on 'and', 'then' and newlines", () => {
    expect(extract("ran 5k and 30 min yoga").entries).toHaveLength(2);
    expect(extract("ran 5k then swam 1km").entries).toHaveLength(2);
    expect(extract("ran 5k\nswam 1km").entries).toHaveLength(2);
  });

  it("resolves a weekday to the most recent occurrence", () => {
    // Tuesday the 28th → 'monday' is the 27th, not next week's.
    expect(extract("monday: 40 min row").entries[0].date).toBe("2026-07-27");
  });

  it("resolves 'last <weekday>' to the week before", () => {
    expect(extract("last monday: 40 min row").entries[0].date).toBe("2026-07-20");
  });

  it("accepts an explicit ISO date", () => {
    expect(extract("2026-07-04 ran 5k").entries[0].date).toBe("2026-07-04");
  });
});

describe("mockExtract — bounds", () => {
  it("always returns schema-valid output", () => {
    const inputs = [
      "",
      "   ",
      "ran",
      "ran 0k",
      "yoga 0 min",
      "ran 99999 km",
      "cycled 99 hours",
      "🏃‍♂️ 5k",
      "ran ".repeat(400),
    ];
    for (const input of inputs) {
      expect(() => extractionSchema.parse(extract(input))).not.toThrow();
    }
  });

  it("clamps an absurd duration rather than emitting an invalid entry", () => {
    const [entry] = extract("cycled 99 hours").entries;
    expect(entry.durationMin).toBeLessThanOrEqual(24 * 60);
  });

  it("caps the number of entries", () => {
    const { entries } = extract(Array.from({ length: 40 }, () => "ran 5k").join("\n"));
    expect(entries.length).toBeLessThanOrEqual(20);
  });

  it("omits a zero distance rather than storing it", () => {
    // distanceKm is `.positive()`; a literal 0 would fail the schema.
    const [entry] = extract("ran 0k").entries;
    expect(entry.distanceKm).toBeUndefined();
  });

  it("writes no summary, leaving it to the localised UI", () => {
    // A hardcoded English sentence in an EN/ES app would silently switch the
    // user's language on the fallback path.
    expect(extract("ran 5k").summary).toBeUndefined();
  });
});

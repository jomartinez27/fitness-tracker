import { describe, expect, it } from "vitest";
import { createEventParser, encodeEvent, type ExtractEvent } from "./protocol";

const delta = (text: string): ExtractEvent => ({ type: "summary_delta", text });

describe("createEventParser", () => {
  it("reads whole events from a single chunk", () => {
    const parser = createEventParser();
    expect(parser.push(encodeEvent(delta("Logged ")) + encodeEvent(delta("a run.")))).toEqual([
      delta("Logged "),
      delta("a run."),
    ]);
  });

  it("holds a partial line until the rest arrives", () => {
    // The failure this guards: chunk boundaries do not respect line
    // boundaries, so any event long enough to be split would be dropped by a
    // parser that JSON.parses each chunk. It only shows up on a slow link.
    const parser = createEventParser();
    const encoded = encodeEvent(delta("a five kilometre run"));
    const split = Math.floor(encoded.length / 2);

    expect(parser.push(encoded.slice(0, split))).toEqual([]);
    expect(parser.push(encoded.slice(split))).toEqual([delta("a five kilometre run")]);
  });

  it("survives an event split across three chunks", () => {
    const parser = createEventParser();
    const encoded = encodeEvent(delta("chunked"));
    const events = [
      ...parser.push(encoded.slice(0, 5)),
      ...parser.push(encoded.slice(5, 12)),
      ...parser.push(encoded.slice(12)),
    ];
    expect(events).toEqual([delta("chunked")]);
  });

  it("emits a trailing event with no newline on flush", () => {
    const parser = createEventParser();
    expect(parser.push(JSON.stringify(delta("no newline")))).toEqual([]);
    expect(parser.flush()).toEqual([delta("no newline")]);
  });

  it("drops a malformed line instead of throwing", () => {
    // A truncated stream should degrade to "no entries", not take down the page
    // rendering it.
    const parser = createEventParser();
    expect(parser.push(`{"type":"summ\n${encodeEvent(delta("ok"))}`)).toEqual([delta("ok")]);
  });

  it("ignores blank lines", () => {
    const parser = createEventParser();
    expect(parser.push(`\n\n${encodeEvent(delta("ok"))}\n`)).toEqual([delta("ok")]);
  });

  it("round-trips a terminal entries event", () => {
    const event: ExtractEvent = {
      type: "entries",
      source: "ai",
      entries: [
        { activity: "Run", date: "2026-07-28", durationMin: 28, distanceKm: 5, inferred: ["durationMin"] },
      ],
    };
    const parser = createEventParser();
    expect(parser.push(encodeEvent(event))).toEqual([event]);
  });
});

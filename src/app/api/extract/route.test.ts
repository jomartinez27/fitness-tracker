import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEventParser, type ExtractEvent } from "@/lib/ai/protocol";
import type { ExtractedEntry } from "@/lib/ai/extraction";

/**
 * The route's job is the fallback decision, so that is what these test — with
 * the upstream call mocked. Whether the model extracts well is #20's contract;
 * whether a failing model breaks the feature is this file's.
 */

const flags = vi.hoisted(() => ({ aiRoute: true }));
const streamAnthropicExtraction = vi.hoisted(() => vi.fn());

vi.mock("@/lib/flags", () => ({ serverFlags: flags, publicFlags: { ai: true } }));
vi.mock("@/lib/ai/anthropic-extract", () => ({ streamAnthropicExtraction }));

const { POST } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/extract", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

async function readEvents(response: Response): Promise<ExtractEvent[]> {
  const parser = createEventParser();
  const events: ExtractEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  events.push(...parser.flush());
  return events;
}

const entriesEvent = (events: ExtractEvent[]) =>
  events.find((event): event is Extract<ExtractEvent, { type: "entries" }> =>
    event.type === "entries",
  );

async function* yields(...events: ExtractEvent[]) {
  for (const event of events) yield event;
}

const RUN: ExtractedEntry = {
  activity: "Run",
  date: "2026-07-28",
  durationMin: 28,
  distanceKm: 5,
  inferred: [],
};

beforeEach(() => {
  flags.aiRoute = true;
  streamAnthropicExtraction.mockReset();
});

describe("POST /api/extract — request validation", () => {
  it("rejects a non-JSON body", async () => {
    const response = await post("not json at all");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_input" });
  });

  it("rejects empty text", async () => {
    const response = await post({ text: "" });
    expect(response.status).toBe(400);
  });

  it("distinguishes too-long input from malformed input", async () => {
    // A distinct code so the UI can say "that's too long" rather than
    // "something went wrong" (ADR-0003's input cap).
    const response = await post({ text: "x".repeat(5000) });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "input_too_long" });
  });
});

describe("POST /api/extract — the happy path", () => {
  it("streams the summary and then the entries", async () => {
    streamAnthropicExtraction.mockReturnValue(
      yields(
        { type: "summary_delta", text: "Logged a " },
        { type: "summary_delta", text: "5 km run." },
        { type: "entries", entries: [RUN], source: "ai" },
      ),
    );

    const response = await post({ text: "ran 5k" });
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");

    const events = await readEvents(response);
    expect(events.map((event) => event.type)).toEqual([
      "summary_delta",
      "summary_delta",
      "entries",
    ]);
    expect(entriesEvent(events)).toMatchObject({ source: "ai", entries: [RUN] });
  });

  it("passes today to the extractor rather than letting it guess", async () => {
    streamAnthropicExtraction.mockReturnValue(
      yields({ type: "entries", entries: [], source: "ai" }),
    );
    await readEvents(await post({ text: "ran 5k" }));

    expect(streamAnthropicExtraction).toHaveBeenCalledWith(
      "ran 5k",
      expect.objectContaining({ today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
    );
  });
});

describe("POST /api/extract — degrading instead of breaking", () => {
  it("answers from the local extractor when the flag is off", async () => {
    // Hiding the button does not stop anyone POSTing to a public URL, so the
    // route refuses independently — and still answers usefully.
    flags.aiRoute = false;

    const events = await readEvents(await post({ text: "ran 5k, 30 min yoga" }));
    const entries = entriesEvent(events);

    expect(streamAnthropicExtraction).not.toHaveBeenCalled();
    expect(entries?.source).toBe("ai-fallback");
    expect(entries?.entries).toHaveLength(2);
  });

  it("falls back when the upstream call fails", async () => {
    streamAnthropicExtraction.mockImplementation(async function* () {
      throw new Error("upstream exploded");
    });

    const entries = entriesEvent(await readEvents(await post({ text: "ran 5k" })));
    expect(entries?.source).toBe("ai-fallback");
    expect(entries?.entries).toHaveLength(1);
  });

  it("keeps the streamed summary when the upstream fails mid-flight", async () => {
    // The prose already on screen was real. Erasing it to show an error would
    // be a worse experience than completing the job locally.
    streamAnthropicExtraction.mockImplementation(async function* () {
      yield { type: "summary_delta", text: "Logged a 5 km run." } as ExtractEvent;
      throw new Error("connection dropped");
    });

    const events = await readEvents(await post({ text: "ran 5k" }));
    expect(events[0]).toEqual({ type: "summary_delta", text: "Logged a 5 km run." });
    expect(entriesEvent(events)?.source).toBe("ai-fallback");
  });

  it("does not send a second entries event if the stream fails after delivering one", async () => {
    // Two terminal events would have the client render entries, then silently
    // replace them with different ones.
    streamAnthropicExtraction.mockImplementation(async function* () {
      yield { type: "entries", entries: [RUN], source: "ai" } as ExtractEvent;
      throw new Error("failed on close");
    });

    const events = await readEvents(await post({ text: "ran 5k" }));
    expect(events.filter((event) => event.type === "entries")).toHaveLength(1);
    expect(entriesEvent(events)?.source).toBe("ai");
  });

  it("reports an honest empty result rather than falling back", async () => {
    // "No sessions in that text" is a real answer. Retrying it locally would
    // just produce the same nothing, more slowly.
    streamAnthropicExtraction.mockReturnValue(
      yields({ type: "entries", entries: [], source: "ai" }),
    );

    const entries = entriesEvent(await readEvents(await post({ text: "rest day" })));
    expect(entries).toMatchObject({ source: "ai", entries: [] });
  });

  it("always terminates with exactly one entries event", async () => {
    for (const behaviour of [
      () => yields({ type: "entries", entries: [RUN], source: "ai" } as ExtractEvent),
      () =>
        (async function* () {
          throw new Error("nope");
        })(),
      () => yields({ type: "summary_delta", text: "..." } as ExtractEvent),
    ]) {
      streamAnthropicExtraction.mockReset();
      streamAnthropicExtraction.mockImplementation(behaviour);
      const events = await readEvents(await post({ text: "ran 5k" }));
      expect(events.filter((event) => event.type === "entries")).toHaveLength(1);
    }
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractEvent } from "./protocol";

/**
 * Covers the request-shaping logic without spending money. The live contract
 * (`anthropic-extract.live.test.ts`) checks what the model actually returns;
 * this checks what we ask it for.
 */

const streamMock = vi.hoisted(() => vi.fn());

class FakeAPIError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
    static APIError = FakeAPIError;
  },
}));

const { streamAnthropicExtraction } = await import("./anthropic-extract");

/**
 * A stream that fails the way the SDK actually fails.
 *
 * `client.messages.stream()` returns immediately; an API error surfaces when
 * the stream is iterated. A mock that throws synchronously from the call models
 * something that never happens, and it leaves a rejected promise nobody awaits.
 */
function failingStream(error: Error) {
  return Object.assign(
    (async function* () {
      throw error;
    })() as AsyncGenerator<never>,
    { finalMessage: async () => { throw error; } },
  );
}

/** A stream that yields one text delta then a tool_use block. */
function okStream(entries: unknown[] = []) {
  return Object.assign(
    (async function* () {
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } };
    })(),
    {
      finalMessage: async () => ({
        content: [
          { type: "text", text: "ok" },
          { type: "tool_use", name: "record_sessions", input: { entries } },
        ],
      }),
    },
  );
}

async function collect(text: string, model?: string): Promise<ExtractEvent[]> {
  const events: ExtractEvent[] = [];
  for await (const event of streamAnthropicExtraction(text, {
    today: "2026-07-28",
    model,
  })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => streamMock.mockReset());

describe("streamAnthropicExtraction — request shape", () => {
  it("sends effort by default", async () => {
    streamMock.mockImplementation(() => okStream());
    await collect("ran 5k", "claude-opus-5");
    expect(streamMock.mock.calls[0][0]).toMatchObject({
      output_config: { effort: "low" },
    });
  });

  it("never disables thinking", async () => {
    // Disabling it on this tier is the documented cause of tool calls being
    // written as prose, and this route produces nothing without the tool call.
    streamMock.mockImplementation(() => okStream());
    await collect("ran 5k", "claude-opus-5");
    expect(streamMock.mock.calls[0][0]).not.toHaveProperty("thinking");
  });

  it("caps output tokens on every request", async () => {
    // The per-request spend ceiling (ADR-0003). Without it a pathological input
    // could bill for a very long response before anything else notices.
    streamMock.mockImplementation(() => okStream());
    await collect("ran 5k", "claude-opus-5");
    const { max_tokens } = streamMock.mock.calls[0][0];
    expect(max_tokens).toBeGreaterThan(0);
    expect(max_tokens).toBeLessThanOrEqual(2000);
  });

  it("passes the abort signal through so the route's timeout can bite", async () => {
    streamMock.mockImplementation(() => okStream());
    const controller = new AbortController();
    for await (const _ of streamAnthropicExtraction("ran 5k", {
      today: "2026-07-28",
      model: "claude-opus-5",
      signal: controller.signal,
    })) {
      void _;
    }
    expect(streamMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });

  it("does not call the API at all for blank input", async () => {
    const events = await collect("   ");
    expect(streamMock).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "entries", entries: [], source: "ai" }]);
  });
});

describe("streamAnthropicExtraction — models that reject effort", () => {
  it("retries without effort, so ANTHROPIC_MODEL is a real lever", async () => {
    // Without this, pointing the env var at a model that has no effort
    // parameter fails every request — the deployment would silently serve the
    // local fallback while being billed as a live model.
    streamMock
      .mockImplementationOnce(() =>
        failingStream(
          new FakeAPIError(400, "This model does not support the effort parameter."),
        ),
      )
      .mockImplementationOnce(() => okStream());

    const events = await collect("ran 5k", "model-without-effort");

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(streamMock.mock.calls[0][0]).toHaveProperty("output_config");
    expect(streamMock.mock.calls[1][0]).not.toHaveProperty("output_config");
    expect(events.at(-1)).toMatchObject({ type: "entries", source: "ai" });
  });

  it("remembers, so the penalty is paid once per process rather than per request", async () => {
    streamMock
      .mockImplementationOnce(() =>
        failingStream(
          new FakeAPIError(400, "This model does not support the effort parameter."),
        ),
      )
      .mockImplementation(() => okStream());

    await collect("ran 5k", "sticky-model");
    streamMock.mockClear();
    await collect("ran 5k again", "sticky-model");

    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(streamMock.mock.calls[0][0]).not.toHaveProperty("output_config");
  });

  it("does not swallow unrelated failures", async () => {
    // The retry is narrow on purpose: a 500 must reach the route so it can fall
    // back, not be mistaken for a capability mismatch and retried into a second
    // failure.
    streamMock.mockImplementation(() =>
      failingStream(new FakeAPIError(500, "internal error")),
    );

    let caught: unknown;
    try {
      await collect("ran 5k", "claude-opus-5");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(FakeAPIError);
    expect((caught as Error).message).toBe("internal error");
    expect(streamMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamAnthropicExtraction — validating what comes back", () => {
  it("drops one malformed session rather than discarding the extraction", async () => {
    streamMock.mockImplementation(() =>
      okStream([
        { activity: "Run", date: "2026-07-28", durationMin: 30, distanceKm: 5, inferred: [] },
        { activity: "", date: "nonsense", durationMin: -4, distanceKm: null, inferred: [] },
      ]),
    );
    const events = await collect("ran 5k", "claude-opus-5");
    expect(events.at(-1)).toMatchObject({ entries: [{ activity: "Run" }] });
  });

  it("rejects a future date even though the prompt forbids one", async () => {
    streamMock.mockImplementation(() =>
      okStream([
        { activity: "Run", date: "2099-01-01", durationMin: 30, distanceKm: null, inferred: [] },
      ]),
    );
    // Every entry invalid is not the same as an honest empty result, so this
    // throws and the route falls back rather than reporting "you logged nothing".
    await expect(collect("ran 5k", "claude-opus-5")).rejects.toThrow();
  });

  it("throws when the model answers without calling the tool", async () => {
    streamMock.mockImplementation(() =>
      Object.assign(
        (async function* () {})(),
        { finalMessage: async () => ({ content: [{ type: "text", text: "sure" }] }) },
      ),
    );
    await expect(collect("ran 5k", "claude-opus-5")).rejects.toThrow(/did not call the tool/);
  });
});

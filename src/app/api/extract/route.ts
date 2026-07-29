import { z } from "zod";
import { serverFlags } from "@/lib/flags";
import { toIsoDate } from "@/lib/domain/trend";
import { MAX_INPUT_LENGTH } from "@/lib/ai/extraction";
import { mockExtract } from "@/lib/ai/mock-extract";
import { streamAnthropicExtraction } from "@/lib/ai/anthropic-extract";
import {
  EXTRACT_CONTENT_TYPE,
  encodeEvent,
  type ExtractEvent,
} from "@/lib/ai/protocol";

/**
 * Free-text → structured sessions, streamed.
 *
 * Every failure path ends in the deterministic extractor rather than an error,
 * so the worst outcome a user sees is a slightly less clever result that is
 * labelled as such — not a broken feature (ADR-0003).
 */

export const runtime = "nodejs";

/**
 * Our own ceiling, well under the platform's.
 *
 * Vercel's Hobby functions default and cap at 300s, so this is not about
 * fitting inside the platform limit — it is about which timeout fires first.
 * If the platform kills the function, the client gets a severed connection and
 * has to guess what happened. If ours fires, we abort the upstream call and
 * stream a clean, labelled fallback. Owning the failure is the point.
 */
export const maxDuration = 30;
const UPSTREAM_TIMEOUT_MS = 20_000;

const requestSchema = z.object({
  text: z.string().min(1).max(MAX_INPUT_LENGTH),
});

function jsonError(code: string, status: number) {
  return Response.json({ error: code }, { status });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("invalid_input", 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some((issue) => issue.code === "too_big");
    return jsonError(tooLong ? "input_too_long" : "invalid_input", 400);
  }

  const text = parsed.data.text;
  const today = toIsoDate(new Date());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ExtractEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)));

      const fallback = () => {
        // No network, no key, no cost — and a label so the UI can say the
        // entries were parsed locally rather than pass them off as the model's.
        send({ type: "entries", entries: mockExtract(text, { today }).entries, source: "ai-fallback" });
      };

      // The flag is checked here, on the server, and not merely in the UI:
      // hiding a button does not stop anyone POSTing to a public URL. Off means
      // no upstream call and therefore no spend, while the endpoint keeps
      // answering usefully.
      if (!serverFlags.aiRoute) {
        fallback();
        controller.close();
        return;
      }

      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);
      // If the user closes the tab, stop paying for tokens nobody will read.
      request.signal.addEventListener("abort", () => abort.abort());

      let delivered = false;
      try {
        for await (const event of streamAnthropicExtraction(text, {
          today,
          signal: abort.signal,
        })) {
          if (event.type === "entries") delivered = true;
          send(event);
        }
      } catch {
        // Upstream failed, timed out, or returned something unusable. Whatever
        // summary already streamed stays on screen — it was real — and the
        // structured half comes from the local extractor instead.
      } finally {
        // The protocol promises exactly one terminal event, and this is the
        // only place that can guarantee it. A stream that ends after prose
        // without ever calling the tool throws nothing and looks like success,
        // so a catch-only fallback leaves the client waiting forever for data
        // that is never coming.
        if (!delivered) fallback();
        clearTimeout(timeout);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": EXTRACT_CONTENT_TYPE,
      "cache-control": "no-store",
      // Proxies that buffer would defeat streaming entirely.
      "x-accel-buffering": "no",
    },
  });
}

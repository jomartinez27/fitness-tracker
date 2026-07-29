// @vitest-environment node
//
// The suite defaults to jsdom, and the Anthropic SDK refuses to run in a
// browser-like environment — correctly, since that would mean an API key
// reachable from client code. This route is server-only, so it gets node.

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { EXTRACTION_FIXTURES, contractViolations } from "./extraction-contract";
import { streamAnthropicExtraction } from "./anthropic-extract";
import type { Extraction } from "./extraction";

/**
 * The model, held to the same contract as the deterministic extractor.
 *
 * This is the payoff of building #20 first: the fallback and the real thing are
 * checked against one set of fixtures, so "the fallback drifted" is a failing
 * test rather than something discovered in production.
 *
 * Opt-in — it costs real money and needs a key, so it never runs in CI or in a
 * normal `npm test`:
 *
 *   RUN_LIVE_AI_TESTS=1 npx vitest run anthropic-extract.live
 *   RUN_LIVE_AI_TESTS=1 LIVE_AI_MODEL=claude-haiku-4-5 npx vitest run anthropic-extract.live
 */

const enabled = process.env.RUN_LIVE_AI_TESTS === "1";

beforeAll(() => {
  // Vitest does not load .env.local, and the key belongs there rather than in a
  // shell profile.
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!process.env.ANTHROPIC_API_KEY && fs.existsSync(envPath)) {
    const match = fs
      .readFileSync(envPath, "utf8")
      .match(/^ANTHROPIC_API_KEY=(.*)$/m);
    if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
  }
});

async function collect(text: string, today: string): Promise<Extraction> {
  const entries = [];
  for await (const event of streamAnthropicExtraction(text, {
    today,
    model: process.env.LIVE_AI_MODEL,
  })) {
    if (event.type === "entries") entries.push(...event.entries);
  }
  return { entries };
}

describe.skipIf(!enabled)(
  `live extraction contract (${process.env.LIVE_AI_MODEL ?? "default model"})`,
  () => {
    it.each(EXTRACTION_FIXTURES)(
      "$name",
      async (fixture) => {
        const extraction = await collect(fixture.input, fixture.today);
        const violations = contractViolations(fixture, extraction);
        expect(violations, `${fixture.input}\n${JSON.stringify(extraction, null, 1)}`).toEqual([]);
      },
      60_000,
    );
  },
);

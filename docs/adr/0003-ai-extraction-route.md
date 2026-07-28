# ADR-0003: Server-side AI extraction — flagged, rate-limited, with a deterministic fallback

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Jorge Martinez

## Context

Pillar 3 lets a user type their week in plain text — "ran 5k, 30 min yoga" — and get
structured entries back, streamed. That requires a call to the Anthropic Messages API, which
requires an API key, which means deciding where the key lives and who is allowed to spend it.

The deployment is a public URL on a personal Vercel account with no auth. Anyone who finds it
— or crawls it — can invoke whatever endpoint backs this feature. Two things follow: the key
cannot reach the client, and the endpoint needs a spend ceiling that doesn't depend on
visitors behaving well.

There's a second, quieter problem. Streaming and schema-constrained structured output pull in
opposite directions: a JSON response constrained by a schema is not parseable until it's
nearly complete, so "stream the JSON" produces a UI that either shows nothing for the whole
response or renders fragments of syntax. Streaming is a stated requirement, and so is
structured extraction. That tension has to be resolved deliberately rather than discovered
during implementation.

## Decision

**A single Next API route, `POST /api/extract`, behind a feature flag, IP rate-limited,
token-capped, with a deterministic mock extractor as the fallback for every failure mode.**

**Key handling.** `ANTHROPIC_API_KEY` in `.env.local`, gitignored, set as a Vercel
environment variable in production. Server-only — never `NEXT_PUBLIC_`. The route is the only
module that constructs an SDK client. Model is `ANTHROPIC_MODEL`, defaulting to
`claude-opus-5`.

**Abuse controls, in layers:**

| Layer | Control |
|---|---|
| Kill switch | `NEXT_PUBLIC_FEATURE_AI=false` hides the UI; the route independently checks the server-side flag and 404s |
| Rate limit | Per-IP token bucket, small burst, low sustained rate; on trip → mock, not an error |
| Input cap | Request body length capped before the model call |
| Output cap | `max_tokens` bounded per request |
| Timeout | Server aborts the upstream stream past a fixed wall-clock budget |

**Resolving the streaming/structured tension — two channels, one request.** The model streams
a short human-readable acknowledgement of what it understood ("Logged a 5km run and 30
minutes of yoga…"), which is what the user actually watches; structured entries are resolved
from the completed message and emitted as a final event on the same stream. The client
renders streamed prose immediately and commits entries on the terminal event. The user gets
live feedback, and the app never parses half a JSON object. Extraction uses the Messages API
structured-output support rather than prose-parsing, so entries arrive schema-valid or not
at all.

**Fallback.** `mockExtract(text)` — a deterministic regex/keyword extractor with no network
call — answers whenever the flag is off, the rate limit trips, the upstream errors, or the
timeout fires. The response is tagged so the UI can say the entries were parsed locally. This
is also the fixture Playwright runs against, so E2E never spends money and never flakes on
model nondeterminism.

**States.** The extraction surface gets the same four states as everything else: empty (no
text yet), loading (streaming, with the partial prose as the loading affordance), error
(upstream failed *and* the fallback was inapplicable), retry (explicit, idempotent). The
"fell back to local parsing" case is deliberately **not** an error state — it's a success
with a quieter result.

## Consequences

**Positive**

- The feature is live and visible to any visitor, with cost bounded by construction rather
  than by trust.
- No failure mode produces a broken UI. Worst case is degraded extraction with an honest
  label — which is a better demo of judgment than a happy path that 500s under load.
- The mock makes E2E deterministic and free, and makes the whole feature developable with no
  API key set.
- Turning the feature off in production is one environment variable and a redeploy.

**Negative**

- **The mock is a second implementation to keep honest.** Its output must satisfy the same
  schema, or the fallback path fails in a worse way than the thing it's protecting against.
  Mitigated by testing both extractors against one shared schema contract.
- **The final-event design defers structured results to completion**, so a long response
  shows prose before entries appear. Accepted: entries appearing atomically is better than
  entries appearing and then correcting themselves.
- **In-memory rate limiting doesn't hold across serverless instances.** It's a speed bump,
  not a guarantee. Acceptable at this traffic level; the fix (Upstash/Vercel KV) is noted in
  the backlog rather than pretended away.
- **Extra latency vs. calling the API directly from the client** — a hop through our server.
  Irrelevant next to model latency, and non-negotiable given the key.

## Alternatives considered

**Bring-your-own-key — visitor pastes their own Anthropic key.** Zero cost exposure and a
clean security story. Rejected: nearly no visitor has a key, so the pillar becomes invisible
to the people it exists to impress. It also normalizes pasting API keys into strangers' web
forms, which is a bad thing to teach even in a demo.

**AI disabled in production, local-only with a recorded video.** Safest and cheapest.
Rejected: a feature that only runs on the author's machine is a claim, not a demonstration.
The layered controls above make "live" affordable enough that the safety of this option isn't
worth what it costs in evidence.

**Client-side call with a public/proxied key.** Rejected outright. Any key reachable by the
browser is a public key, regardless of proxying, obfuscation, or referrer checks.

**Stream the structured JSON directly and parse incrementally.** Tempting — one channel, and
entries could appear as they're generated. Rejected: partial-JSON parsing is a well-known
source of subtle bugs, and the failure mode (a malformed entry briefly rendered, then
corrected) is exactly the kind of jitter this project is meant to avoid. The two-channel
design costs nothing the user perceives.

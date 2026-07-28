# Design: AI-native training tracker

**Status:** approved for build · **Author:** Jorge Martinez · **Last updated:** 2026-07-28

## Problem

Logging workouts is a chore, and the chore is what kills the habit. Existing trackers ask
for structured input (exercise → sets → reps → weight → duration) at exactly the moment the
user has the least patience for structure: right after training, on a phone, one-handed. The
data that *would* be motivating — "am I actually trending toward my goal?" — is only
available to people who already pushed through the logging friction. The tracker fails the
users who need it most.

Two things follow. First, entry has to survive interruption: a phone call, a locked screen,
an accidental back-navigation must never cost the user their entry. Second, there should be
a path in for people who won't fill out a form at all — let them type "ran 5k, 30 min yoga"
and have the app do the structuring.

## Goals

1. **Entry that never loses data.** Per-step validation, autosave on every change, full
   restore after back-navigation or refresh, optimistic submit with explicit retry.
2. **A trend view that answers one question.** "Am I on track?" — a time series against a
   goal reference line, over 7d / 30d / 90d.
3. **Natural-language entry.** Free text → structured entries, streamed back so the user
   sees progress rather than a spinner.
4. **Every async surface has four states.** Empty, loading, error, retry — no exceptions,
   including the ones nobody looks at.
5. **Keyboard-navigable, screen-reader-usable, mobile-first.**
6. **EN/ES.** Not a stretch goal, not a wrapper added at the end — locale-routed from v0.

## Non-goals

Explicitly out of scope, so scope creep has to be an argued decision rather than a drift:

- **Accounts, auth, multi-device sync.** v0 is single-device, local-first. See ADR-0001.
- **Social features**, sharing, leaderboards, coach/client roles.
- **Wearable or HealthKit integration.** Interesting, but it's an integration exercise, not
  a frontend-craft exercise, and it can't be demoed without a device.
- **A real exercise/nutrition database.** Free-text exercise names with light normalization.
- **Offline-first sync conflict resolution.** Local-first is not the same as offline-sync;
  we're not building CRDTs for a portfolio piece.
- **Native apps.** Responsive web, installable if PWA falls out cheaply.

## Approach

**Shape:** Next.js App Router, TypeScript strict, Tailwind v4, Recharts. One Next API route
(`/api/extract`) is the only server-side code; everything else is client or static.

**Data.** All reads/writes go through a `Repository` interface. The v0 implementation is
IndexedDB, seeded with ~90 days of demo data on first run so the dashboard is populated
immediately for a first-time visitor. Swapping to Postgres later means writing one new
implementation of that interface, not rewriting features. ADR-0001.

**Entry flow.** A multi-step form where the draft — not the final entry — is the persisted
unit. Each keystroke debounces into a draft record keyed by session; the form hydrates from
that draft on mount. Back-navigation is therefore a non-event: the draft was never in React
state alone. Submit is optimistic against the repository with a queued retry on failure.

**Chart.** Built and tested in isolation before the app exists around it (Phase 1). It takes
data, a goal, and a range as props, and owns no fetching. That's what makes its empty /
loading / error states testable in Storybook without a running app.

**AI.** `POST /api/extract` streams from the Anthropic Messages API. The feature sits behind
`NEXT_PUBLIC_FEATURE_AI`; when the flag is off, or the rate limiter trips, or the upstream
call fails, a deterministic mock extractor answers instead — so the UI degrades to "works,
slightly dumber" rather than "broken". The mock doubles as the Playwright fixture, which
means E2E tests never hit a paid API. Model is `ANTHROPIC_MODEL` (default `claude-opus-5`);
the key lives in `.env.local` and is never committed. ADR-0003.

**i18n.** `next-intl` with `/[locale]/` routing. Chosen over hand-rolled context because
message extraction, pluralization, and date/number formatting are exactly the places a
hand-rolled solution accumulates bugs, and because locale-routed URLs are the correct
default for SEO and shareability. Every user-facing string is a message key from the first
commit — retrofitting i18n is the single most tedious way to lose a weekend.

## Alternatives considered

**1. Postgres + Prisma + auth from day one.** Rejected. It's more "real", but it spends the
majority of the build budget on infrastructure a frontend reviewer doesn't grade, and it
puts a signup wall and a cold start between a recruiter and the chart. The senior move here
isn't shipping the heavier stack — it's making the seam explicit so the heavier stack is a
contained change. Revisit if multi-device sync ever becomes a goal.

**2. Chart hand-rolled in SVG / D3 primitives (or visx).** Rejected for v0. Full control and
a smaller bundle, but responsive axes, tooltip hit-testing, and reference-line label
collision are days of work that demonstrate persistence more than judgment. Recharts gets to
the same visual result faster, and the isolation boundary in Phase 1 means swapping the
renderer later touches one component. ADR-0002.

**3. AI extraction client-side with a user-supplied key.** Rejected. Zero cost exposure and a
tidy security story, but ~95% of visitors won't have an Anthropic key, so the feature becomes
invisible to the audience it exists for. The server route with a flag, a rate limit, and a
mock fallback keeps it visible while bounding the cost. ADR-0003.

## Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Public AI route abused; API bill or key exhaustion | Med | High | IP rate limit + per-request token cap + kill switch flag + mock fallback (ADR-0003) |
| R2 | Streaming + schema-constrained output fights itself — partial JSON isn't parseable mid-stream | High | Med | Two-channel response: stream prose summary, resolve structured entries at completion (ADR-0003) |
| R3 | Autosave races submit; user sees a resurrected draft after a successful entry | Med | Med | Draft cleared inside the same transaction that commits the entry; explicit test for the interleaving |
| R4 | IndexedDB unavailable (private mode, older Safari) | Low | High | Feature-detect at boot; fall back to in-memory repo with a persistent "not saved" banner |
| R5 | Recharts SSR/hydration mismatch in App Router | Med | Low | Chart is a client component with a fixed-dimension skeleton; hydration asserted in tests |
| R6 | i18n retrofit cost if EN-only ships first | Med | Med | Message keys from commit one; ES added in v1 but never bolted on |
| R7 | Scope creep — the endless-polish failure mode of portfolio projects | High | Med | Non-goals above are binding; stretch items stay behind flags and out of v0/v1 |

## Phased rollout

**v0 — the spine.** Chart component in isolation (Storybook + Vitest + all four states) →
app shell → entry flow with autosave → dashboard wired to seeded local data. EN only, but
fully keyed. AI flag exists and is **off**. Exit criterion: a stranger can open the deployed
URL and read a populated trend chart within a few seconds, and can log an entry, kill the
tab mid-entry, and come back to their draft intact.

**v1 — the differentiators.** AI extraction behind `NEXT_PUBLIC_FEATURE_AI`, streamed, with
its own empty/loading/error/retry surface and the mock fallback wired. ES locale live.
Playwright covering the two critical paths (entry survives back-nav; AI extraction error →
retry → success). Exit criterion: flag on in production, rate limits verified, mock fallback
verified by forcing the failure.

**Stretch — flagged, optional, honest about being optional.** Weekly AI trend summary;
goal-setting UI (v0 hardcodes goals in seed data); CSV export; PWA install + offline read;
a second chart type. Each behind its own flag. None of these block calling v1 done, and
shipping v1 well beats shipping stretch badly.

**Flag strategy.** Environment-driven booleans read through a single `flags.ts` module — not
scattered `process.env` reads. Cheap, but it means the rollout story is legible from one
file, and turning the AI feature off in production is one env var and a redeploy rather than
a code change.

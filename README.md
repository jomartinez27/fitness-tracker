# Training tracker

**[Live demo →](https://fitness-tracker-jomar2.vercel.app/)**

An AI-native training tracker. Log a workout without fighting a form, see whether you're
actually trending toward your goal, and — if you'd rather not use a form at all — just type
what you did and let the app structure it.

No signup, no empty state: the demo seeds ninety days of training on first visit, so the
chart has something to say immediately. That's the payoff of the local-first decision in
[ADR-0001](docs/adr/0001-local-first-persistence.md).

Built as a portfolio piece for senior/lead frontend work, which means the reasoning is part
of the deliverable: see [`docs/design.md`](docs/design.md) for goals, non-goals, rejected
alternatives, risks, and the phased rollout, and [`docs/adr/`](docs/adr/) for the decisions
that were load-bearing enough to write down.

> **Status:** v0 shipped — chart, app shell, entry flow, deployed with the AI flag off.
> v1 (streamed AI extraction, ES locale) is next.

## The three pillars

| | What it demonstrates |
|---|---|
| **Quick-add entry flow** | Production form UX: per-step validation, autosave, no data loss on back-navigation, optimistic submit with retry, EN/ES |
| **Trend dashboard** | Recharts time series with a goal reference line and 7d/30d/90d range selection — built and tested in isolation before it was wired into anything |
| **AI extraction** | Free text → structured entries via a streamed Next API route to the Anthropic Messages API, behind a feature flag, with a deterministic fallback |

## Craft bar

Non-negotiable, and the actual point of the project:

- Every async surface has real **empty / loading / error / retry** states.
- **Keyboard-navigable and screen-reader-usable** — including the chart, which pairs a visual
  series with an off-screen data table.
- **Responsive to mobile**, designed phone-first.
- The **AI feature is flag-gated** for staged rollout, and degrades to local parsing rather
  than breaking.

## Stack

Next.js (App Router) · TypeScript · Tailwind · Recharts · Vitest · Playwright · Storybook ·
`next-intl` · IndexedDB behind a repository interface · Anthropic Messages API · Vercel

## Getting started

```bash
npm install
npm run dev
```

The app runs fully without an API key — the AI feature is flag-gated, and its fallback path
requires no network.

### Environment

Copy `.env.example` to `.env.local`:

| Variable | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | For live AI only | Server-only. Never commit it; never prefix it `NEXT_PUBLIC_` |
| `ANTHROPIC_MODEL` | No | Defaults to `claude-opus-5` |
| `NEXT_PUBLIC_FEATURE_AI` | No | Defaults off. On → live extraction; off → deterministic local fallback |

## Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run test` | Vitest — unit tests, plus stories run in Chromium with axe |
| `npm run test:e2e` | Playwright — critical paths on desktop and mobile |
| `npm run storybook` | Storybook |

## Project docs

- [`docs/design.md`](docs/design.md) — problem, goals, non-goals, alternatives, risks, rollout
- [`docs/backlog.md`](docs/backlog.md) — the epic, broken into v0/v1/stretch with sequencing rationale
- [`docs/adr/0001-local-first-persistence.md`](docs/adr/0001-local-first-persistence.md)
- [`docs/adr/0002-recharts-for-the-trend-chart.md`](docs/adr/0002-recharts-for-the-trend-chart.md)
- [`docs/adr/0003-ai-extraction-route.md`](docs/adr/0003-ai-extraction-route.md)

## Build phases

- **Phase 0** — design doc, ADRs, backlog. ✅
- **Phase 1** — trend chart in isolation: Storybook stories + Vitest tests + all four states. ✅
- **Phase 2** — app shell: entry flow + dashboard consuming the chart. ✅
- **Phase 3** — the AI route: streaming, structured extraction, full error/retry UX. _(next)_

Progress is tracked as [milestones and issues](https://github.com/jomartinez27/fitness-tracker/issues),
with the reasoning for the sequencing in [`docs/backlog.md`](docs/backlog.md).

## Known limitations

Stated plainly rather than discovered by a user:

- Data lives in one browser profile. No accounts, no sync, no cross-device continuity — see
  ADR-0001 for why, and for the seam that makes changing it a contained job.
- Clearing site data deletes everything. CSV export is stretch scope.
- Rate limiting is in-memory and therefore per-instance — a speed bump, not a guarantee.

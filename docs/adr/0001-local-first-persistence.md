# ADR-0001: Local-first persistence behind a repository interface

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Jorge Martinez
- **Supersedes:** —

## Context

The app needs to persist training entries and in-progress form drafts. The choice of
persistence layer drives more downstream decisions than anything else in the project: it
determines whether there's auth, whether there's a backend to deploy and pay for, whether a
first-time visitor sees data or an empty state, and how much of the build budget goes to
infrastructure rather than to the interface work this project exists to demonstrate.

Two constraints shape the decision:

1. **The primary audience is a reviewer with ~90 seconds.** They open a URL. Whatever stands
   between them and the working product — a signup form, a cold serverless start, an empty
   dashboard — is a cost paid against a very short attention budget.
2. **"No data loss on back-navigation" is a stated goal.** That means drafts are persisted
   state, not React state, which requires a real client-side store regardless of what
   happens server-side.

## Decision

**All persistence goes through a `Repository` interface. The v0 implementation is IndexedDB
(via `idb`), seeded with ~90 days of realistic demo data on first run. There is no server
database and no auth in v0 or v1.**

```ts
export interface Repository {
  listEntries(range: DateRange): Promise<Entry[]>;
  createEntry(draft: EntryDraft): Promise<Entry>;
  getGoal(metric: Metric): Promise<Goal | null>;

  loadDraft(id: DraftId): Promise<EntryDraft | null>;
  saveDraft(id: DraftId, draft: EntryDraft): Promise<void>;
  clearDraft(id: DraftId): Promise<void>;
}
```

Features depend on this interface only. Nothing outside `lib/repository/` imports `idb` or
knows that IndexedDB exists. Three implementations are anticipated: `IndexedDbRepository`
(v0 runtime), `InMemoryRepository` (tests, Storybook, and the R4 fallback path), and
`HttpRepository` (if and when a backend is ever added).

## Consequences

**Positive**

- A first-time visitor sees a populated 90-day chart immediately. That single fact does more
  for the demo than a correctly-normalized schema would.
- Zero infrastructure cost, zero cold starts, no signup wall, nothing to keep alive.
- Drafts and entries share one storage mechanism, so "autosave the draft" and "commit the
  entry" can be one IndexedDB transaction — which is what makes risk R3 (resurrected draft
  after successful submit) fixable rather than inherent.
- `InMemoryRepository` makes every component testable without mocking a storage API, and
  makes Storybook stories deterministic.
- The interface is the migration plan. Moving to Postgres is one new file plus a swap at the
  composition root — not a refactor that touches every feature.

**Negative**

- **No multi-device or cross-browser continuity.** Data lives in one browser profile. This is
  a genuine product limitation, not a technicality, and the UI should say so plainly rather
  than let a user discover it by losing data.
- **Clearing site data destroys everything.** Mitigated in stretch scope by CSV export.
- **IndexedDB is unavailable in some contexts** (private browsing on older Safari, hardened
  privacy settings). Handled by feature-detecting at boot and falling back to
  `InMemoryRepository` behind a persistent, honest "changes won't be saved" banner — a
  degraded mode the user is told about, not a silent failure.
- **The interface is a guess about a future that may not arrive.** Accepted: it costs one
  file's worth of indirection now, and it's the difference between "chose local storage" and
  "designed for a storage swap" when someone reads the repo.

## Alternatives considered

**Postgres + Prisma + auth (e.g. Neon + Auth.js).** The "real" answer, and the wrong one
here. It spends most of the build budget on schema, migrations, session handling, and
deployment config — none of which is the skill this project is meant to evidence — and it
adds a signup wall and a cold start in front of the chart. The design goal it would satisfy
(multi-device sync) is an explicit non-goal. Reconsider the moment that changes.

**`localStorage` only.** Simplest possible option, rejected on three counts: the synchronous
API blocks the main thread on every autosave write, which directly undermines the
keystroke-frequency autosave the entry flow depends on; the ~5MB cap is tight for 90+ days of
seeded data; and there are no transactions, so the draft-clear/entry-commit atomicity that
fixes R3 isn't achievable.

**Server-side with anonymous sessions (cookie ID, no login).** Gets multi-device-per-browser
persistence without a signup wall. Rejected for v0 because it still requires a database, a
deployment, and a cost story, while delivering little the local-first approach doesn't — the
data is still effectively single-browser, just with more moving parts and a bill.

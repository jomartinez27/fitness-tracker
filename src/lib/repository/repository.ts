import type { Entry, EntryDraft, Goal, IsoDate, Metric } from "@/lib/domain/entry";

export interface DateRange {
  /** Inclusive. */
  from: IsoDate;
  /** Inclusive. */
  to: IsoDate;
}

/**
 * The persistence seam (ADR-0001).
 *
 * Nothing outside `src/lib/repository/` may import a storage library or know
 * that IndexedDB exists. Three implementations are anticipated:
 * `InMemoryRepository` (tests, Storybook, and the degraded-mode fallback in
 * #18), `IndexedDbRepository` (#5, the v0 runtime), and one day `HttpRepository`.
 *
 * Swapping storage is a new file plus a change at the composition root — not a
 * refactor that reaches into every feature.
 */
export interface Repository {
  listEntries(range: DateRange): Promise<Entry[]>;
  createEntry(entry: Omit<Entry, "id" | "createdAt">): Promise<Entry>;
  getGoal(metric: Metric): Promise<Goal | null>;
  setGoal(goal: Goal): Promise<void>;

  loadDraft(id: string): Promise<EntryDraft | null>;
  saveDraft(draft: EntryDraft): Promise<void>;
  /**
   * Commits an entry and clears its draft as one unit.
   *
   * This exists as a single method rather than `createEntry` + `clearDraft`
   * precisely so the IndexedDB implementation can put both in one transaction.
   * Risk R3 — a successful submit resurrecting a stale draft — is only fixable
   * if atomicity is expressible at the interface.
   */
  commitDraft(draftId: string, entry: Omit<Entry, "id" | "createdAt">): Promise<Entry>;
  clearDraft(id: string): Promise<void>;
}

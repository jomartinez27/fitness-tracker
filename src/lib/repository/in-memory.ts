import type { Entry, EntryDraft, Goal, Metric } from "@/lib/domain/entry";
import type { DateRange, Repository } from "./repository";

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1)}`;

export interface InMemoryRepositoryOptions {
  entries?: Entry[];
  goals?: Goal[];
  /** Injected for tests that need to control ordering; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * The reference implementation of {@link Repository}. Used by Vitest, by
 * Storybook, and at runtime as the degraded-mode fallback when IndexedDB is
 * unavailable (#18).
 *
 * Because it is a real implementation rather than a mock, tests exercise the
 * same interface production does — there is no storage API to stub.
 */
export class InMemoryRepository implements Repository {
  private entries: Entry[];
  private goals = new Map<Metric, Goal>();
  private drafts = new Map<string, EntryDraft>();
  private readonly now: () => number;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.entries = [...(options.entries ?? [])];
    for (const goal of options.goals ?? []) this.goals.set(goal.metric, goal);
    this.now = options.now ?? Date.now;
  }

  async listEntries(range: DateRange): Promise<Entry[]> {
    return this.entries
      .filter((e) => e.date >= range.from && e.date <= range.to)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  async createEntry(entry: Omit<Entry, "id" | "createdAt">): Promise<Entry> {
    const created: Entry = { ...entry, id: nextId("entry"), createdAt: this.now() };
    this.entries.push(created);
    return created;
  }

  async getGoal(metric: Metric): Promise<Goal | null> {
    return this.goals.get(metric) ?? null;
  }

  async setGoal(goal: Goal): Promise<void> {
    this.goals.set(goal.metric, goal);
  }

  async loadDraft(id: string): Promise<EntryDraft | null> {
    return this.drafts.get(id) ?? null;
  }

  async saveDraft(draft: EntryDraft): Promise<void> {
    this.drafts.set(draft.id, draft);
  }

  /** Atomic by construction here; the IndexedDB implementation must use one transaction. */
  async commitDraft(
    draftId: string,
    entry: Omit<Entry, "id" | "createdAt">,
  ): Promise<Entry> {
    const created = await this.createEntry(entry);
    this.drafts.delete(draftId);
    return created;
  }

  async clearDraft(id: string): Promise<void> {
    this.drafts.delete(id);
  }
}

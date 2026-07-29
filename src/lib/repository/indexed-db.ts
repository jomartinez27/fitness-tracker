import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Entry, EntryDraft, Goal, Metric } from "@/lib/domain/entry";
import { generateSeedEntries } from "@/lib/domain/seed";
import { toIsoDate } from "@/lib/domain/trend";
import type { DateRange, Repository } from "./repository";

const DB_NAME = "training-tracker";
const DB_VERSION = 1;

interface TrackerSchema extends DBSchema {
  entries: { key: string; value: Entry; indexes: { "by-date": string } };
  goals: { key: Metric; value: Goal };
  drafts: { key: string; value: EntryDraft };
  meta: { key: string; value: { key: string; value: string } };
}

type TrackerDb = IDBPDatabase<TrackerSchema>;

let dbPromise: Promise<TrackerDb> | null = null;

function open(): Promise<TrackerDb> {
  dbPromise ??= openDB<TrackerSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const entries = db.createObjectStore("entries", { keyPath: "id" });
      entries.createIndex("by-date", "date");
      db.createObjectStore("goals", { keyPath: "metric" });
      db.createObjectStore("drafts", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
    },
  });
  return dbPromise;
}

/**
 * Seeds ~90 days of demo data on first run only.
 *
 * The point is that a first-time visitor sees a populated chart rather than an
 * empty state — that single fact does more for the product than a correctly
 * normalised schema would. The `seeded` marker lives in the same transaction as
 * the writes, so an interrupted first load can't leave a half-seeded database.
 */
async function seedIfEmpty(db: TrackerDb): Promise<void> {
  const marker = await db.get("meta", "seeded");
  if (marker) return;

  const today = toIsoDate(new Date());
  const tx = db.transaction(["entries", "goals", "meta"], "readwrite");
  const entries = tx.objectStore("entries");

  for (const entry of generateSeedEntries({ today })) {
    await entries.put(entry);
  }
  await tx.objectStore("goals").put({ metric: "distanceKm", target: 5 });
  await tx.objectStore("goals").put({ metric: "durationMin", target: 45 });
  await tx.objectStore("goals").put({ metric: "sessions", target: 1 });
  await tx.objectStore("meta").put({ key: "seeded", value: today });

  await tx.done;
}

/** Cheap, sortable, and collision-free enough for a single-device store. */
function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class IndexedDbRepository implements Repository {
  static async create(): Promise<IndexedDbRepository> {
    const db = await open();
    await seedIfEmpty(db);
    return new IndexedDbRepository(db);
  }

  private constructor(private readonly db: TrackerDb) {}

  async listEntries(range: DateRange): Promise<Entry[]> {
    return this.db.getAllFromIndex(
      "entries",
      "by-date",
      IDBKeyRange.bound(range.from, range.to),
    );
  }

  async createEntry(entry: Omit<Entry, "id" | "createdAt">): Promise<Entry> {
    const created: Entry = { ...entry, id: newId("entry"), createdAt: Date.now() };
    await this.db.put("entries", created);
    return created;
  }

  async getGoal(metric: Metric): Promise<Goal | null> {
    return (await this.db.get("goals", metric)) ?? null;
  }

  async setGoal(goal: Goal): Promise<void> {
    await this.db.put("goals", goal);
  }

  async loadDraft(id: string): Promise<EntryDraft | null> {
    return (await this.db.get("drafts", id)) ?? null;
  }

  async saveDraft(draft: EntryDraft): Promise<void> {
    await this.db.put("drafts", draft);
  }

  /**
   * Commits the entry and clears its draft in ONE transaction.
   *
   * This is the whole reason `commitDraft` exists on the interface rather than
   * being `createEntry()` followed by `clearDraft()`. Done as two operations,
   * a failure between them leaves a saved entry with a live draft behind it —
   * so the next visit to the form helpfully restores a session the user already
   * logged, and they log it twice. That is risk R3, and atomicity is the only
   * honest fix.
   */
  async commitDraft(
    draftId: string,
    entry: Omit<Entry, "id" | "createdAt">,
  ): Promise<Entry> {
    const created: Entry = { ...entry, id: newId("entry"), createdAt: Date.now() };

    const tx = this.db.transaction(["entries", "drafts"], "readwrite");
    await tx.objectStore("entries").put(created);
    await tx.objectStore("drafts").delete(draftId);
    await tx.done;

    return created;
  }

  async clearDraft(id: string): Promise<void> {
    await this.db.delete("drafts", id);
  }
}

/**
 * Feature-detects IndexedDB for real, rather than trusting that the global
 * exists.
 *
 * Some hardened-privacy configurations expose `window.indexedDB` and then throw
 * or hang on open, so the only reliable probe is to actually open it. The hang
 * case is why there's a timeout: a browser that never settles the request would
 * otherwise leave the app waiting forever on boot.
 */
export async function isIndexedDbAvailable(timeoutMs = 3000): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    await Promise.race([
      open(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("indexedDB open timed out")), timeoutMs),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

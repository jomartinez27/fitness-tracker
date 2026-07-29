"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { generateSeedEntries } from "@/lib/domain/seed";
import { toIsoDate } from "@/lib/domain/trend";
import { InMemoryRepository } from "./in-memory";
import { IndexedDbRepository, isIndexedDbAvailable } from "./indexed-db";
import type { Repository } from "./repository";

export type StorageStatus =
  | "opening"
  /** Persistent storage is working. */
  | "persistent"
  /** Running in memory: the session works, but nothing survives a reload. */
  | "ephemeral";

interface RepositoryValue {
  repository: Repository | null;
  status: StorageStatus;
}

/**
 * Exported so tests and stories can supply a repository directly, rather than
 * the provider adding a test-only prop that production never uses.
 */
export const RepositoryContext = createContext<RepositoryValue>({
  repository: null,
  status: "opening",
});

function createEphemeralRepository(): Repository {
  // Seeded too, so the degraded mode is still a usable demo rather than a wall.
  return new InMemoryRepository({
    entries: generateSeedEntries({ today: toIsoDate(new Date()) }),
    goals: [
      { metric: "distanceKm", target: 5 },
      { metric: "durationMin", target: 45 },
      { metric: "sessions", target: 1 },
    ],
  });
}

/**
 * Chooses a storage implementation at boot and hands it to the tree.
 *
 * Composition happens exactly here — this is the "swap at the composition root"
 * that ADR-0001 promised. Features consume the `Repository` interface and never
 * learn which implementation answered.
 *
 * If IndexedDB is unavailable (private browsing, hardened privacy settings) the
 * app keeps working against an in-memory store and says so, plainly, in the UI.
 * Degrading silently would be worse than failing: the user would log sessions
 * for a week and lose all of them without ever being told.
 */
export function RepositoryProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<RepositoryValue>({
    repository: null,
    status: "opening",
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const available = await isIndexedDbAvailable();
      if (cancelled) return;

      if (!available) {
        setValue({ repository: createEphemeralRepository(), status: "ephemeral" });
        return;
      }

      try {
        const repository = await IndexedDbRepository.create();
        if (!cancelled) setValue({ repository, status: "persistent" });
      } catch {
        // Opening succeeded but seeding or upgrading didn't — still degraded,
        // still usable, still honest about it.
        if (!cancelled) {
          setValue({ repository: createEphemeralRepository(), status: "ephemeral" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <RepositoryContext.Provider value={value}>{children}</RepositoryContext.Provider>
  );
}

export function useRepository(): RepositoryValue {
  return useContext(RepositoryContext);
}

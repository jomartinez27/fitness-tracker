"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_DRAFT_VALUES,
  entryDraftSchema,
  type DraftValues,
  type EntryDraft,
} from "@/lib/domain/entry";
import type { Repository } from "@/lib/repository/repository";
import type { FieldName } from "./schema";

/** One active draft per device. Multiple concurrent drafts is not a v0 goal. */
export const ACTIVE_DRAFT_ID = "active";

const AUTOSAVE_DELAY_MS = 400;

export interface EntryDraftState {
  status: "loading" | "ready";
  values: DraftValues;
  step: number;
  /** True when a draft with real content was recovered, so the UI can say so. */
  restored: boolean;
}

export interface EntryDraftApi extends EntryDraftState {
  setField: (field: FieldName, value: string) => void;
  setStep: (step: number) => void;
  /** Writes any pending change immediately. */
  flush: () => Promise<void>;
  /**
   * Drops any pending autosave without writing it.
   *
   * Call this immediately before committing. The debounced write scheduled by
   * the user's last interaction would otherwise land *after* the commit and
   * re-create the draft that the commit just deleted — so returning to the form
   * offers to restore a session they already saved, and they save it twice.
   * Atomicity inside the repository cannot prevent this; the stale write
   * originates here.
   */
  cancelPendingSave: () => void;
  reset: () => Promise<void>;
}

const hasContent = (values: DraftValues) =>
  Object.values(values).some((value) => value.trim() !== "");

/**
 * Persists the form as the user types, and restores it on mount.
 *
 * The promise of the entry flow is that back-navigation, a refresh, or a locked
 * phone never costs anything. That only holds if the draft is *storage*, not
 * React state — so the component reads its initial values from here, and every
 * change is written back on a short debounce.
 *
 * Two things that are easy to miss and where the data actually goes missing:
 *
 *  - The debounce means the last few keystrokes are still in memory when a user
 *    taps Back. So the pending write is flushed on unmount, and again on
 *    `pagehide` for a tab close or a backgrounded phone.
 *  - Restored drafts are parsed, not trusted. Storage outlives deploys, so a
 *    draft written by an older build can have a shape this one doesn't expect;
 *    a bad record is discarded rather than allowed to crash the form.
 */
export function useEntryDraft(repository: Repository | null): EntryDraftApi {
  const [state, setState] = useState<EntryDraftState>({
    status: "loading",
    values: EMPTY_DRAFT_VALUES,
    step: 0,
    restored: false,
  });

  const pendingRef = useRef<EntryDraft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending || !repository) return;
    pendingRef.current = null;
    try {
      await repository.saveDraft(pending);
    } catch {
      // A failed autosave must never interrupt typing. The next keystroke
      // schedules another write, and the submit path re-validates regardless.
    }
  }, [repository]);

  // Hydrate.
  useEffect(() => {
    if (!repository) return;
    let cancelled = false;

    (async () => {
      let draft: EntryDraft | null = null;
      try {
        const stored = await repository.loadDraft(ACTIVE_DRAFT_ID);
        const parsed = stored ? entryDraftSchema.safeParse(stored) : null;
        draft = parsed?.success ? parsed.data : null;
      } catch {
        draft = null;
      }
      if (cancelled) return;

      setState({
        status: "ready",
        values: draft?.values ?? EMPTY_DRAFT_VALUES,
        step: draft?.step ?? 0,
        restored: draft ? hasContent(draft.values) : false,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Flush on unmount (back-navigation) and on pagehide (tab close, app backgrounded).
  useEffect(() => {
    const onPageHide = () => void flush();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      void flush();
    };
  }, [flush]);

  const schedule = useCallback(
    (values: DraftValues, step: number) => {
      pendingRef.current = {
        id: ACTIVE_DRAFT_ID,
        step,
        values,
        updatedAt: Date.now(),
      };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush],
  );

  const setField = useCallback(
    (field: FieldName, value: string) => {
      setState((previous) => {
        const values = { ...previous.values, [field]: value };
        schedule(values, previous.step);
        return { ...previous, values, restored: false };
      });
    },
    [schedule],
  );

  const setStep = useCallback(
    (step: number) => {
      setState((previous) => {
        schedule(previous.values, step);
        return { ...previous, step };
      });
    },
    [schedule],
  );

  const cancelPendingSave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
  }, []);

  const reset = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    setState({
      status: "ready",
      values: EMPTY_DRAFT_VALUES,
      step: 0,
      restored: false,
    });
    await repository?.clearDraft(ACTIVE_DRAFT_ID);
  }, [repository]);

  return { ...state, setField, setStep, flush, cancelPendingSave, reset };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toIsoDate } from "@/lib/domain/trend";
import { useRepository } from "@/lib/repository/provider";
import {
  ACTIVE_DRAFT_ID,
  useEntryDraft,
} from "@/lib/entry-form/use-entry-draft";
import {
  STEP_COUNT,
  stepOf,
  toEntry,
  validateAll,
  validateStep,
  type FieldErrors,
  type FieldName,
} from "@/lib/entry-form/schema";
import { Field } from "./field";

type SubmitStatus = "idle" | "saved" | "failed";

const FIELD_ID: Record<FieldName, string> = {
  activity: "field-activity",
  date: "field-date",
  durationMin: "field-duration",
  distanceKm: "field-distance",
  notes: "field-notes",
};

export function EntryFlow() {
  const { repository } = useRepository();
  const t = useTranslations("entry");
  const draft = useEntryDraft(repository);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const summaryRef = useRef<HTMLDivElement>(null);
  const shouldFocusSummary = useRef(false);

  /**
   * Guards against a double-tap producing two entries.
   *
   * A ref rather than state, because state updates are async — two taps inside
   * one frame would both read the old value and both commit. This is the
   * idempotence the retry path needs.
   */
  const submittingRef = useRef(false);

  const today = toIsoDate(new Date());
  const { values, step } = draft;

  // Move focus to the error summary only after a failed attempt, never on the
  // incidental re-render that follows fixing a field.
  useEffect(() => {
    if (shouldFocusSummary.current && Object.keys(errors).length > 0) {
      shouldFocusSummary.current = false;
      summaryRef.current?.focus();
    }
  }, [errors]);

  const fieldError = (field: FieldName) =>
    errors[field] ? t(`errors.${errors[field]}`) : undefined;

  const goToStep = useCallback(
    (next: number) => {
      setErrors({});
      draft.setStep(Math.max(0, Math.min(STEP_COUNT - 1, next)));
    },
    [draft],
  );

  const handleNext = () => {
    const stepErrors = validateStep(step, values, today);
    if (Object.keys(stepErrors).length > 0) {
      shouldFocusSummary.current = true;
      setErrors(stepErrors);
      return;
    }
    goToStep(step + 1);
  };

  const handleSubmit = async () => {
    const allErrors = validateAll(values, today);
    if (Object.keys(allErrors).length > 0) {
      // Land the user on the step that actually holds the first problem rather
      // than showing an error about a field they can't see.
      const firstField = Object.keys(allErrors)[0] as FieldName;
      shouldFocusSummary.current = true;
      setErrors(allErrors);
      draft.setStep(stepOf(firstField));
      return;
    }

    if (submittingRef.current || !repository) return;
    submittingRef.current = true;

    // Drop the autosave scheduled by the click that got us here. Left running,
    // it fires after the commit and re-creates the draft the commit deleted.
    draft.cancelPendingSave();

    // Optimistic: the write is a local transaction that essentially always
    // succeeds, so show the outcome now and correct it only if it doesn't.
    setSubmitStatus("saved");

    try {
      await repository.commitDraft(ACTIVE_DRAFT_ID, toEntry(values));
    } catch {
      setSubmitStatus("failed");
      // The commit failed, so the draft may or may not still exist. Re-save it
      // so the user's input is durable no matter which side of the transaction
      // gave way — a failed save must never also lose the work.
      try {
        await repository.saveDraft({
          id: ACTIVE_DRAFT_ID,
          step,
          values,
          updatedAt: Date.now(),
        });
      } catch {
        // Storage is fully unavailable; the values are still on screen and the
        // banner already tells the user nothing is being saved.
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const startAnother = async () => {
    setSubmitStatus("idle");
    setErrors({});
    await draft.reset();
  };

  if (draft.status === "loading") {
    return (
      <p role="status" className="text-sm text-ink-2">
        {t("saving")}
      </p>
    );
  }

  if (submitStatus === "saved") {
    return (
      <div role="status" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">{t("success.title")}</h2>
        <p className="text-sm text-ink-2">{t("success.body")}</p>
        <button
          type="button"
          onClick={startAnother}
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-hover-wash"
        >
          {t("success.another")}
        </button>
      </div>
    );
  }

  const errorEntries = Object.entries(errors) as Array<[FieldName, string]>;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      className="flex max-w-lg flex-col gap-5"
    >
      <p className="text-sm text-ink-2" aria-live="polite">
        {t("stepProgress", { current: step + 1, total: STEP_COUNT })}
      </p>

      {draft.restored ? (
        <p role="status" className="rounded-md bg-accent-wash px-3 py-2 text-sm">
          {t("draftRestored")}
        </p>
      ) : null}

      {submitStatus === "failed" ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-line bg-surface p-3">
          <p className="text-sm font-semibold">{t("failure.title")}</p>
          <p className="text-sm text-ink-2">{t("failure.body")}</p>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-hover-wash"
          >
            {t("failure.retry")}
          </button>
        </div>
      ) : null}

      {errorEntries.length > 0 ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-red-600/40 bg-surface p-3"
        >
          <p className="text-sm font-semibold">{t("errors.summaryTitle")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {errorEntries.map(([field, key]) => (
              <li key={field}>
                <a href={`#${FIELD_ID[field]}`} className="underline">
                  {t(`errors.${key}`)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {step === 0 ? (
        <>
          <Field
            fieldId={FIELD_ID.activity}
            label={t("fields.activity")}
            hint={t("fields.activityHint")}
            value={values.activity}
            maxLength={80}
            autoComplete="off"
            onChange={(e) => draft.setField("activity", e.target.value)}
            error={fieldError("activity")}
          />
          <Field
            fieldId={FIELD_ID.date}
            label={t("fields.date")}
            type="date"
            max={today}
            value={values.date}
            onChange={(e) => draft.setField("date", e.target.value)}
            error={fieldError("date")}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Field
            fieldId={FIELD_ID.durationMin}
            label={t("fields.durationMin")}
            suffix={t("fields.durationUnit")}
            type="text"
            inputMode="numeric"
            value={values.durationMin}
            onChange={(e) => draft.setField("durationMin", e.target.value)}
            error={fieldError("durationMin")}
          />
          <Field
            fieldId={FIELD_ID.distanceKm}
            label={t("fields.distanceKm")}
            hint={t("fields.distanceOptional")}
            suffix={t("fields.distanceUnit")}
            type="text"
            inputMode="decimal"
            value={values.distanceKm}
            onChange={(e) => draft.setField("distanceKm", e.target.value)}
            error={fieldError("distanceKm")}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Field
            fieldId={FIELD_ID.notes}
            label={t("fields.notes")}
            hint={t("fields.notesOptional")}
            multiline
            maxLength={500}
            value={values.notes}
            onChange={(e) => draft.setField("notes", e.target.value)}
            error={fieldError("notes")}
          />

          <section aria-labelledby="review-heading" className="rounded-md border border-line bg-surface p-3">
            <h2 id="review-heading" className="text-sm font-semibold">
              {t("review.heading")}
            </h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink-2">{t("fields.activity")}</dt>
              <dd>{values.activity}</dd>
              <dt className="text-ink-2">{t("fields.date")}</dt>
              <dd>{values.date}</dd>
              <dt className="text-ink-2">{t("fields.durationMin")}</dt>
              <dd>{`${values.durationMin} ${t("fields.durationUnit")}`}</dd>
              {values.distanceKm ? (
                <>
                  <dt className="text-ink-2">{t("fields.distanceKm")}</dt>
                  <dd>{`${values.distanceKm} ${t("fields.distanceUnit")}`}</dd>
                </>
              ) : null}
            </dl>
          </section>
        </>
      ) : null}

      <div className="flex items-center gap-2">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => goToStep(step - 1)}
            className="rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-hover-wash"
          >
            {t("back")}
          </button>
        ) : null}

        {/*
          The `key` is load-bearing, not decoration.

          Without distinct keys React reuses one DOM node for both buttons —
          same position, same tag — so advancing from the last input step
          rewrites `type="button"` to `type="submit"` on the very element the
          browser is still processing a click for. It then runs the default
          action against the now-submit button and saves the session a step
          early. Distinct keys unmount one and mount the other, so the click has
          nothing left to submit.

          Worth noting this is invisible in jsdom; only a real browser
          reproduces it.
        */}
        {step < STEP_COUNT - 1 ? (
          <button
            key="next"
            type="button"
            onClick={handleNext}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            {t("next")}
          </button>
        ) : (
          <button
            key="submit"
            type="submit"
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white"
          >
            {t("submit")}
          </button>
        )}
      </div>
    </form>
  );
}

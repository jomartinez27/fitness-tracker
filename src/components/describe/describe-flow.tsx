"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MAX_INPUT_LENGTH, type ExtractedEntry, type ExtractionSource } from "@/lib/ai/extraction";
import { ExtractRequestError, streamExtraction } from "@/lib/ai/client";
import { useRepository } from "@/lib/repository/provider";
import { ProposedSession } from "./proposed-session";

type Phase = "idle" | "streaming" | "results" | "error" | "saved";

interface Results {
  entries: ExtractedEntry[];
  source: ExtractionSource;
}

export function DescribeFlow() {
  const t = useTranslations("describe");
  const { repository } = useRepository();

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [included, setIncluded] = useState<boolean[]>([]);
  const [failure, setFailure] = useState<ExtractRequestError | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const inputId = useId();
  const alertRef = useRef<HTMLDivElement>(null);

  // Abort an in-flight stream if the component goes away — otherwise we keep
  // paying for tokens nobody will read.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (phase === "error") alertRef.current?.focus();
  }, [phase]);

  const run = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("streaming");
    setSummary("");
    setResults(null);
    setFailure(null);
    setSaveFailed(false);

    try {
      for await (const event of streamExtraction(trimmed, controller.signal)) {
        if (event.type === "summary_delta") {
          setSummary((previous) => previous + event.text);
        } else if (event.type === "entries") {
          setResults({ entries: event.entries, source: event.source });
          setIncluded(event.entries.map(() => true));
          setPhase("results");
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setPhase("idle");
        return;
      }
      setFailure(
        error instanceof ExtractRequestError
          ? error
          : new ExtractRequestError("unknown"),
      );
      setPhase("error");
    }
  }, [text]);

  const cancel = () => {
    abortRef.current?.abort();
    setPhase("idle");
  };

  const save = async () => {
    if (!repository || !results || savingRef.current) return;
    const chosen = results.entries.filter((_, index) => included[index]);
    if (chosen.length === 0) return;

    savingRef.current = true;
    setSaveFailed(false);

    try {
      for (const entry of chosen) {
        await repository.createEntry({
          activity: entry.activity,
          date: entry.date,
          durationMin: entry.durationMin,
          ...(entry.distanceKm !== undefined ? { distanceKm: entry.distanceKm } : {}),
          source: results.source,
        });
      }
      setSavedCount(chosen.length);
      setPhase("saved");
    } catch {
      // The proposals stay on screen; a failed save must not also lose them.
      setSaveFailed(true);
    } finally {
      savingRef.current = false;
    }
  };

  const startOver = () => {
    setText("");
    setSummary("");
    setResults(null);
    setIncluded([]);
    setFailure(null);
    setSaveFailed(false);
    setPhase("idle");
  };

  if (phase === "saved") {
    return (
      <div role="status" className="flex flex-col items-start gap-3">
        <h2 className="text-lg font-semibold">{t("saved.title", { count: savedCount })}</h2>
        <p className="text-sm text-ink-2">{t("saved.body")}</p>
        <button type="button" onClick={startOver} className={SECONDARY_BUTTON}>
          {t("saved.again")}
        </button>
      </div>
    );
  }

  const chosenCount = included.filter(Boolean).length;
  const remaining = MAX_INPUT_LENGTH - text.length;

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <p className="text-sm text-ink-2">{t("intro")}</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t("inputLabel")}
        </label>
        <textarea
          id={inputId}
          value={text}
          onChange={(event) => setText(event.target.value.slice(0, MAX_INPUT_LENGTH))}
          placeholder={t("placeholder")}
          rows={4}
          disabled={phase === "streaming"}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-muted disabled:opacity-60"
        />
        <p className="text-xs text-ink-muted">{t("charactersLeft", { count: remaining })}</p>
      </div>

      <div className="flex items-center gap-2">
        {phase === "streaming" ? (
          <button type="button" onClick={cancel} className={SECONDARY_BUTTON}>
            {t("cancel")}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!text.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {t("submit")}
          </button>
        )}
        {phase !== "idle" && phase !== "streaming" ? (
          <button type="button" onClick={startOver} className={SECONDARY_BUTTON}>
            {t("startOver")}
          </button>
        ) : null}
      </div>

      {/*
        The streamed prose is the loading affordance — there is no spinner in
        this feature. It is deliberately NOT in a live region: announcing every
        token would make a screen reader unusable. The status region below
        announces the two moments that actually matter instead.
      */}
      {summary ? (
        <p className="text-sm leading-relaxed text-ink">{summary}</p>
      ) : phase === "streaming" ? (
        // Prose can only be the loading affordance once prose exists. The model
        // thinks for a couple of seconds before the first token, and leaving
        // that gap blank reads as a dead button. This holds the space until the
        // real text replaces it.
        <p className="text-sm text-ink-2 motion-safe:animate-pulse">{t("reading")}</p>
      ) : null}

      <p className="sr-only" role="status">
        {phase === "streaming" ? t("reading") : null}
        {phase === "results" && results
          ? t("results.heading", { count: results.entries.length })
          : null}
      </p>

      {phase === "error" && failure ? (
        <ErrorPanel error={failure} onRetry={() => void run()} ref={alertRef} />
      ) : null}

      {phase === "results" && results ? (
        <section aria-labelledby="results-heading" className="flex flex-col gap-3">
          <h2 id="results-heading" className="text-base font-semibold">
            {t("results.heading", { count: results.entries.length })}
          </h2>

          {results.source === "ai-fallback" ? (
            // A labelled success, not an error: the user still gets sessions,
            // just from the simpler parser. Saying so is the honest part.
            <p className="rounded-md border border-line bg-hover-wash px-3 py-2 text-sm">
              <strong className="font-semibold">{t("source.fallbackLabel")}</strong>{" "}
              <span className="text-ink-2">{t("source.fallbackExplanation")}</span>
            </p>
          ) : null}

          {results.entries.length === 0 ? (
            <p className="text-sm text-ink-2">{t("results.none")}</p>
          ) : (
            <>
              <p className="text-sm text-ink-2">{t("results.reviewNote")}</p>
              <ul className="flex flex-col gap-2">
                {results.entries.map((entry, index) => (
                  <ProposedSession
                    key={`${entry.date}-${entry.activity}-${index}`}
                    entry={entry}
                    included={included[index] ?? true}
                    onToggle={(next) =>
                      setIncluded((previous) =>
                        previous.map((value, i) => (i === index ? next : value)),
                      )
                    }
                  />
                ))}
              </ul>

              {saveFailed ? (
                <div role="alert" className="rounded-md border border-line p-3">
                  <p className="text-sm font-semibold">{t("saved.failedTitle")}</p>
                  <p className="text-sm text-ink-2">{t("saved.failedBody")}</p>
                </div>
              ) : null}

              <div>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={chosenCount === 0}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {t("results.save", { count: chosenCount })}
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

const SECONDARY_BUTTON =
  "rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-hover-wash";

function ErrorPanel({
  error,
  onRetry,
  ref,
}: {
  error: ExtractRequestError;
  onRetry: () => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations("describe.errors");

  const { title, body } = {
    rate_limited: {
      title: t("rateLimitedTitle"),
      body: t("rateLimitedBody", { seconds: error.retryAfterSeconds ?? 30 }),
    },
    input_too_long: { title: t("tooLongTitle"), body: t("tooLongBody") },
    network: { title: t("networkTitle"), body: t("networkBody") },
    invalid_input: { title: t("unknownTitle"), body: t("unknownBody") },
    unknown: { title: t("unknownTitle"), body: t("unknownBody") },
  }[error.code];

  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="flex flex-col items-start gap-2 rounded-md border border-line bg-surface p-3"
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-sm text-ink-2">{body}</p>
      <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
        {t("retry")}
      </button>
    </div>
  );
}

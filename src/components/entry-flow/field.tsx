"use client";

import { useId, type InputHTMLAttributes } from "react";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string;
  error?: string;
  suffix?: string;
  /** Stable id so the error summary can link straight to the input. */
  fieldId: string;
  multiline?: boolean;
}

/**
 * One labelled control with its hint and error wired up.
 *
 * `aria-describedby` points at both the hint and the error, so a screen-reader
 * user hears the requirement and what went wrong without having to hunt for
 * either. `aria-invalid` is what actually announces the failed state — the red
 * text is only its visual equivalent.
 */
export function Field({
  label,
  hint,
  error,
  suffix,
  fieldId,
  multiline = false,
  ...inputProps
}: FieldProps) {
  const generated = useId();
  const hintId = hint ? `${generated}-hint` : undefined;
  const errorId = error ? `${generated}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const shared = {
    id: fieldId,
    "aria-describedby": describedBy,
    "aria-invalid": error ? (true as const) : undefined,
    className: [
      "w-full rounded-md border bg-surface px-3 py-2 text-base text-ink",
      "placeholder:text-ink-muted",
      error ? "border-red-600" : "border-line",
    ].join(" "),
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-ink">
        {label}
      </label>

      {hint ? (
        <p id={hintId} className="text-xs text-ink-2">
          {hint}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        {multiline ? (
          <textarea
            {...shared}
            rows={3}
            value={inputProps.value as string}
            onChange={inputProps.onChange as never}
            maxLength={inputProps.maxLength}
          />
        ) : (
          <input {...inputProps} {...shared} />
        )}
        {suffix ? (
          <span className="shrink-0 text-sm text-ink-2">{suffix}</span>
        ) : null}
      </div>

      {error ? (
        <p id={errorId} className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

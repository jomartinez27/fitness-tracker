"use client";

import { useTranslations } from "next-intl";
import { useRepository } from "@/lib/repository/provider";

/**
 * Tells the user, plainly and permanently, when their data isn't being saved.
 *
 * Risk R4. The tempting alternative is to degrade silently — the app still
 * works, after all — but that trades a visible limitation for an invisible one:
 * someone logs sessions for a week and loses all of them without ever having
 * been told. A banner they can't dismiss is the honest trade.
 */
export function StorageBanner() {
  const { status } = useRepository();
  const t = useTranslations("storage");

  if (status !== "ephemeral") return null;

  return (
    <div
      role="status"
      className="border-b border-line bg-warning/10 px-4 py-2.5 sm:px-6"
    >
      <div className="mx-auto flex w-full max-w-4xl gap-2 text-sm">
        <span aria-hidden="true">⚠</span>
        <p className="text-ink-2">
          <strong className="font-semibold text-ink">
            {t("unavailableTitle")}
          </strong>{" "}
          {t("unavailableBody")}
        </p>
      </div>
    </div>
  );
}

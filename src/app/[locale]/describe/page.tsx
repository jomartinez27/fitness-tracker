import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { publicFlags } from "@/lib/flags";
import { DescribeFlow } from "@/components/describe/describe-flow";

/**
 * Staged rollout (ADR-0003): with the flag off the page does not exist, so the
 * feature can ship dark and be switched on without a code change.
 *
 * The route behind it is guarded separately and on the server — hiding a page
 * is not a control, since `/api/extract` is a public URL either way.
 */
export default async function DescribePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  if (!publicFlags.ai) notFound();

  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("describe");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
      <DescribeFlow />
    </div>
  );
}

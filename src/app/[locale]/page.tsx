import { getTranslations, setRequestLocale } from "next-intl/server";
import { TrendPanel } from "@/components/dashboard/trend-panel";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
      <TrendPanel />
    </div>
  );
}

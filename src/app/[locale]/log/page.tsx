import { getTranslations, setRequestLocale } from "next-intl/server";
import { EntryFlow } from "@/components/entry-flow/entry-flow";

export default async function LogPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("entry");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-semibold tracking-tight">{t("heading")}</h1>
      <EntryFlow />
    </div>
  );
}

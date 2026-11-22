"use client";

import { useLocale, useTranslations } from "next-intl";
import { BackHeader } from "@/components/booking/back-header";
import { DeleteAccount } from "@/components/me/delete-account";
import { DownloadData } from "@/components/me/download-data";
import { LoadError } from "@/components/me/load-error";
import { ProfileForm } from "@/components/me/profile-form";
import { getBrowserApi } from "@/lib/api/browser";
import { useAuthedLoad } from "@/lib/session/use-authed-load";

export default function ProfilePage() {
  const t = useTranslations("profile");
  const locale = useLocale();
  const {
    data: me,
    setData,
    error,
    failed,
    retry,
  } = useAuthedLoad(`/${locale}/me/profile`, () => getBrowserApi().me.get());

  return (
    <main>
      <BackHeader href="/me" backLabel={t("back")} title={t("title")} />
      <div className="mx-auto flex max-w-[480px] flex-col gap-6 px-5 pb-10 pt-2">
        {failed ? (
          <LoadError error={error} onRetry={retry} />
        ) : !me ? (
          <p className="text-muted">{t("loading")}</p>
        ) : (
          <>
            <ProfileForm me={me} onSaved={setData} />
            <hr className="border-line" />
            <DownloadData />
            <DeleteAccount />
          </>
        )}
      </div>
    </main>
  );
}

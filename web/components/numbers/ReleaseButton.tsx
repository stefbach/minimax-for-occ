"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";
import { useT } from "@/lib/i18n";

/**
 * Small client island used from the server-rendered /numbers/health page.
 *
 * POSTs to /api/numbers/:id/release, which releases the underlying Twilio
 * number then deletes the row. On success we surface a toast and refresh the
 * server component so the dormant table updates.
 */
export function ReleaseButton({
  id,
  e164,
}: {
  id: string;
  e164: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (
      !window.confirm(
        t("release_number_confirm").replace("{e164}", e164),
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/numbers/${id}/release`, { method: "POST" });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        warning?: string | null;
      };
      if (!r.ok) {
        toast.error(`${t("release_number_failed")}: ${j.error ?? r.statusText}`);
        return;
      }
      if (j.warning) {
        toast.info(`${t("release_number_success_warning").replace("{e164}", e164)}: ${j.warning}`);
      } else {
        toast.success(t("release_number_success").replace("{e164}", e164));
      }
      router.refresh();
    } catch (e) {
      toast.error(
        `${t("release_number_failed")}: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="ghost"
      onClick={onClick}
      disabled={busy}
      style={{ padding: "4px 9px", fontSize: 12 }}
    >
      {busy ? t("release_number_busy") : t("release_number_button")}
    </button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";

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
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (
      !window.confirm(
        `Libérer ${e164} ? Le numéro sera supprimé de Twilio et de la base.`,
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
        toast.error(`Libération échouée : ${j.error ?? r.statusText}`);
        return;
      }
      if (j.warning) {
        toast.info(`${e164} libéré (avec avertissement) : ${j.warning}`);
      } else {
        toast.success(`${e164} libéré.`);
      }
      router.refresh();
    } catch (e) {
      toast.error(
        `Libération échouée : ${e instanceof Error ? e.message : String(e)}`,
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
      {busy ? "Libération…" : "Libérer le numéro"}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/lib/use-toast";
import { useT } from "@/lib/i18n";

export function NewFlowButton() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    const name = window.prompt("Nom du flow ?", "Nouveau flow");
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error("Erreur : " + (err.error ?? res.statusText));
        return;
      }
      const flow = (await res.json()) as { id: string };
      router.push(`/flows/${flow.id}/edit`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={onClick} disabled={busy}>
      {busy ? t("Création…") : t("+ Nouveau flow")}
    </button>
  );
}

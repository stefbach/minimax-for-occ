"use client";

import { useT } from "@/lib/i18n";

/**
 * Stub — wired up in commit 4 (manual task creation). Renders a
 * placeholder so the supervise page compiles and the "+ Créer une
 * tâche" button has a target.
 */
export function CreateTaskModal({
  onClose,
}: {
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ minWidth: 320, maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{t("Créer une tâche")}</h3>
        <p className="muted">{t("Bientôt disponible.")}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="ghost" onClick={onClose}>{t("Fermer")}</button>
        </div>
      </div>
    </div>
  );
}

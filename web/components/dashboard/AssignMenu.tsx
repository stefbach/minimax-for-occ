"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useAssignments, coordinatorTone } from "./assignments";

// Reusable "assign a team member" control. Drop it next to any patient name —
// it reads the current assignee and the coordinator roster from the shared
// AssignmentsProvider, so it works the same whether the patient is identified
// by lead_id (live dossiers) or only by name (static NHS_REPORT rows).

type Props = {
  leadId?: string | null;
  name?: string | null;
  phone?: string | null;
  /** Compact pill for list rows; default is a fuller button for detail headers. */
  compact?: boolean;
  /** Stop row-level onClick from firing when the menu is used inside a clickable row. */
  stopPropagation?: boolean;
};

export default function AssignMenu({ leadId, name, phone, compact = false, stopPropagation = false }: Props) {
  const t = useT();
  const { coordinators, assigneeOf, setAssignee } = useAssignments();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = assigneeOf({ leadId, name, phone });

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = async (coordinator: string | null) => {
    setBusy(coordinator ?? "__unassign__");
    setErr(false);
    try {
      await setAssignee({ leadId, name, phone }, coordinator);
      setOpen(false);
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  };

  const tone = coordinatorTone(current);
  const guard = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
  };

  // Nothing to assign to yet (roster still loading or empty) — render nothing
  // so list rows don't get a dead control.
  if (coordinators.length === 0 && !current) return null;

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }} onClick={guard}>
      <button
        type="button"
        onClick={(e) => { guard(e); setOpen((v) => !v); }}
        title={current ? `${t("Assigné à")} ${current}` : t("Assigner")}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: compact ? "3px 9px" : "6px 12px",
          fontSize: compact ? 11 : 12, fontWeight: 600,
          borderRadius: 999, cursor: "pointer", whiteSpace: "nowrap",
          border: `1px solid ${current ? tone : "var(--border)"}`,
          color: current ? tone : "var(--muted)",
          background: current ? `color-mix(in srgb, ${tone} 12%, transparent)` : "var(--bg-2)",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
            background: current ? tone : "var(--border)",
          }}
        />
        {current ? current : (compact ? t("Assigner") : `👤 ${t("Assigner")}`)}
        <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50,
            minWidth: 170, padding: 6, borderRadius: 10,
            background: "var(--bg)", border: "1px solid var(--border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            display: "grid", gap: 2,
          }}
        >
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, padding: "4px 8px 2px" }}>
            {t("Assigner à")}
          </div>
          {coordinators.map((c) => {
            const isCurrent = c === current;
            const ctone = coordinatorTone(c);
            return (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={isCurrent}
                disabled={busy !== null}
                onClick={(e) => { guard(e); choose(isCurrent ? null : c); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 8px", borderRadius: 7, fontSize: 13,
                  border: "none", cursor: "pointer", textAlign: "left",
                  background: isCurrent ? `color-mix(in srgb, ${ctone} 14%, transparent)` : "transparent",
                  color: "inherit",
                }}
                onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-2)"; }}
                onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
              >
                <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: ctone, flexShrink: 0 }} />
                <span style={{ flex: 1 }}>{c}</span>
                {busy === c ? <span className="muted" style={{ fontSize: 11 }}>…</span>
                  : isCurrent ? <span style={{ fontSize: 11, color: ctone }}>✓</span> : null}
              </button>
            );
          })}
          {current && (
            <button
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={(e) => { guard(e); choose(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                marginTop: 2, padding: "7px 8px", borderRadius: 7, fontSize: 12,
                border: "none", borderTop: "1px solid var(--border)", cursor: "pointer",
                background: "transparent", color: "var(--bad)", textAlign: "left",
              }}
            >
              ✕ {busy === "__unassign__" ? t("Désassignation…") : t("Désassigner")}
            </button>
          )}
          {err && (
            <div style={{ fontSize: 11, color: "var(--bad)", padding: "2px 8px" }}>{t("Échec — réessayer")}</div>
          )}
        </div>
      )}
    </div>
  );
}

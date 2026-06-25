"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { TeamMember } from "@/app/api/team/members/route";

// Assigne des numéros ENTRANTS à un agent humain (table inbound_number_agents).
// Quand l'appel arrive sur un de ces numéros, le routing "humain d'abord" fait
// sonner cet agent (s'il est en ligne) avant de basculer sur Charlotte.
interface NumRow {
  id: string;
  e164: string;
  label: string | null;
  inbound_enabled: boolean;
  assigned: boolean;
}

export function MemberNumbersModal({
  member,
  onClose,
  onToast,
}: {
  member: TeamMember;
  onClose: () => void;
  onToast: (k: "ok" | "err", m: string) => void;
}) {
  const t = useT();
  const [numbers, setNumbers] = useState<NumRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/team/members/${member.user_id}/numbers`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
        if (!alive) return;
        const nums = ((j as { numbers?: NumRow[] }).numbers ?? []) as NumRow[];
        setNumbers(nums);
        setSel(new Set(nums.filter((n) => n.assigned).map((n) => n.id)));
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [member.user_id]);

  function toggle(id: string, on: boolean) {
    setSel((p) => {
      const s = new Set(p);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/team/members/${member.user_id}/numbers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number_ids: Array.from(sel) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      onToast("ok", t("Numéros entrants enregistrés."));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card modal-card"
        style={{ width: "min(520px, 100%)", display: "grid", gap: 14, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>📞 {t("Numéros entrants")}</h3>
          <button className="ghost" onClick={onClose} style={{ padding: "2px 8px" }} disabled={busy}>×</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {member.display_name || member.email || member.user_id} ·{" "}
          {t("Coche les numéros sur lesquels cet agent reçoit les appels entrants (quand il est en ligne).")}
        </p>
        {loading ? (
          <div className="muted">{t("Chargement…")}</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {numbers.length === 0 && <div className="muted">{t("Aucun numéro dans l'organisation.")}</div>}
            {numbers.map((n) => {
              const checked = sel.has(n.id);
              return (
                <label
                  key={n.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--text)",
                    padding: "9px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: checked ? "var(--bg-2)" : "transparent",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={(e) => toggle(n.id, e.target.checked)} />
                  <span className="kbd" style={{ whiteSpace: "nowrap" }}>{n.e164}</span>
                  <span style={{ color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.label || "—"}
                  </span>
                  {n.inbound_enabled ? (
                    <span className="tag good" style={{ fontSize: 10, whiteSpace: "nowrap" }}>entrant ON</span>
                  ) : (
                    <span className="tag" style={{ fontSize: 10, whiteSpace: "nowrap" }}>entrant OFF</span>
                  )}
                </label>
              );
            })}
          </div>
        )}
        {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            {t("Annuler")}
          </button>
          <button type="button" onClick={save} disabled={busy || loading}>
            {busy ? t("Enregistrement…") : t("Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}

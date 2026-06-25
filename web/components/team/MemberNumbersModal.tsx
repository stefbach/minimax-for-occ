"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { TeamMember } from "@/app/api/team/members/route";

// Numéros d'un agent humain — deux dimensions :
//  • ENTRANT  (inbound_number_agents)  : numéros sur lesquels il REÇOIT les
//    appels (routing "humain d'abord").
//  • SORTANT  (outbound_number_agents) : numéros depuis lesquels il PEUT
//    appeler (caller-ID). Restreint côté serveur — un agent ne peut pas
//    appeler depuis un numéro non assigné. Un numéro est marqué « défaut ».
interface NumRow {
  id: string;
  e164: string;
  label: string | null;
  inbound_enabled: boolean;
  assigned: boolean;          // entrant
  outbound_assigned: boolean; // sortant
  outbound_primary: boolean;  // sortant par défaut
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
  const [selIn, setSelIn] = useState<Set<string>>(new Set());
  const [selOut, setSelOut] = useState<Set<string>>(new Set());
  const [primaryOut, setPrimaryOut] = useState<string | null>(null);
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
        setSelIn(new Set(nums.filter((n) => n.assigned).map((n) => n.id)));
        setSelOut(new Set(nums.filter((n) => n.outbound_assigned).map((n) => n.id)));
        setPrimaryOut(nums.find((n) => n.outbound_primary)?.id ?? null);
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

  function toggleIn(id: string, on: boolean) {
    setSelIn((p) => {
      const s = new Set(p);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  function toggleOut(id: string, on: boolean) {
    setSelOut((p) => {
      const s = new Set(p);
      if (on) {
        s.add(id);
      } else {
        s.delete(id);
      }
      return s;
    });
    // Keep the default valid: if we just unchecked the primary, clear it; if
    // this is the first outbound number, make it the default automatically.
    setPrimaryOut((cur) => {
      if (on) return cur ?? id;
      return cur === id ? null : cur;
    });
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      // Default must be one of the selected outbound numbers.
      const outIds = Array.from(selOut);
      const primary = primaryOut && outIds.includes(primaryOut) ? primaryOut : outIds[0] ?? null;
      const r = await fetch(`/api/team/members/${member.user_id}/numbers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          number_ids: Array.from(selIn),
          outbound_number_ids: outIds,
          outbound_primary_id: primary,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      onToast("ok", t("Numéros enregistrés."));
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rowBase: React.CSSProperties = {
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
  };

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
        style={{ width: "min(560px, 100%)", display: "grid", gap: 14, maxHeight: "calc(100vh - 32px)", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>📞 {t("Numéros de l'agent")}</h3>
          <button className="ghost" onClick={onClose} style={{ padding: "2px 8px" }} disabled={busy}>×</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {member.display_name || member.email || member.user_id}
        </p>

        {loading ? (
          <div className="muted">{t("Chargement…")}</div>
        ) : numbers.length === 0 ? (
          <div className="muted">{t("Aucun numéro dans l'organisation.")}</div>
        ) : (
          <>
            {/* ── ENTRANT ─────────────────────────────────────────────── */}
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>📥 {t("Reçoit les appels entrants sur")}</div>
              <p className="muted" style={{ margin: "0 0 2px", fontSize: 11.5 }}>
                {t("Quand il est en ligne, son softphone sonne pour les appels arrivant sur ces numéros.")}
              </p>
              {numbers.map((n) => {
                const checked = selIn.has(n.id);
                return (
                  <label key={`in-${n.id}`} style={{ ...rowBase, background: checked ? "var(--bg-2)" : "transparent" }}>
                    <input type="checkbox" checked={checked} onChange={(e) => toggleIn(n.id, e.target.checked)} />
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

            {/* ── SORTANT ─────────────────────────────────────────────── */}
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>📤 {t("Peut appeler depuis (caller-ID)")}</div>
              <p className="muted" style={{ margin: "0 0 2px", fontSize: 11.5 }}>
                {t("Numéros que cet agent peut utiliser pour passer des appels. Sans sélection, il utilise le numéro par défaut de l'organisation. ★ = numéro par défaut.")}
              </p>
              {numbers.map((n) => {
                const checked = selOut.has(n.id);
                const isPrimary = primaryOut === n.id;
                return (
                  <div
                    key={`out-${n.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto auto 1fr auto",
                      alignItems: "center",
                      gap: 10,
                      width: "100%",
                      padding: "9px 12px",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: checked ? "var(--bg-2)" : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleOut(n.id, e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <span className="kbd" style={{ whiteSpace: "nowrap" }}>{n.e164}</span>
                    <span style={{ color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.label || "—"}
                    </span>
                    {/* Default (★) — only meaningful when this number is selected. */}
                    <button
                      type="button"
                      disabled={!checked}
                      onClick={() => setPrimaryOut(n.id)}
                      title={isPrimary ? t("Numéro par défaut") : t("Définir par défaut")}
                      style={{
                        padding: "2px 9px", fontSize: 11, borderRadius: 6, whiteSpace: "nowrap",
                        cursor: checked ? "pointer" : "not-allowed",
                        border: `1px solid ${isPrimary ? "var(--accent)" : "var(--border)"}`,
                        background: isPrimary ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "transparent",
                        color: checked ? "var(--text)" : "var(--muted)",
                        opacity: checked ? 1 : 0.5,
                        fontWeight: isPrimary ? 600 : 400,
                      }}
                    >
                      {isPrimary ? "★ défaut" : "☆ défaut"}
                    </button>
                  </div>
                );
              })}
            </div>
          </>
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

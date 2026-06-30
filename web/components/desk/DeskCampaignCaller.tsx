"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

/**
 * Manual desk-campaign caller. Presents ONE lead at a time:
 *  - on present, the server sends the pre-call SMS/WhatsApp (shown as a note);
 *  - the agent clicks « Appeler » → the number is loaded into the persistent
 *    softphone (the agent triggers the call themselves — no auto-dial);
 *  - after hanging up, the agent picks a qualification → the lead is stamped
 *    and the NEXT lead appears.
 */
interface CampaignLead {
  id: string;
  name: string | null;
  phone: string | null;
  qualification: string | null;
  bmi: number | null;
  email: string | null;
  last_note: string | null;
  call_count: number;
}

const QUALIFICATIONS = [
  "RDV CONFIRME",
  "RAPPEL",
  "PAS DE REPONSE",
  "REPONDEUR",
  "PAS INTERESSE",
  "NE PAS RAPPELER",
  "FAUX NUMERO",
  "A PASSER A L'HUMAIN",
];

export function DeskCampaignCaller({
  campaign,
  onClose,
}: {
  campaign: { id: string; name: string };
  onClose: () => void;
}) {
  const t = useT();
  const [lead, setLead] = useState<CampaignLead | null>(null);
  const [messaged, setMessaged] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [paused, setPaused] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [called, setCalled] = useState(false);
  // Lead ids already shown this session, so we don't loop back to the same one.
  const excludeRef = useRef<string[]>([]);

  const fetchNext = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMessaged([]);
    setNote("");
    setCalled(false);
    try {
      const r = await fetch("/api/desk/campaign/next", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id, exclude: excludeRef.current }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      if (j.paused) { setPaused(true); setLead(null); return; }
      if (j.done || !j.lead) { setDone(true); setLead(null); return; }
      setLead(j.lead as CampaignLead);
      setMessaged(Array.isArray(j.messaged) ? j.messaged : []);
      if (Array.isArray(j.message_errors) && j.message_errors.length > 0) {
        setErr(j.message_errors.join(" · "));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [campaign.id]);

  useEffect(() => { void fetchNext(); }, [fetchNext]);

  // Load the lead's number into the persistent softphone (no auto-dial — the
  // agent clicks ☎ in the softphone). Mirrors the queue panes' prefill.
  function call() {
    if (!lead?.phone) return;
    const sp = new URLSearchParams(window.location.search);
    sp.set("prefill", lead.phone);
    if (lead.name) sp.set("name", lead.name); else sp.delete("name");
    sp.delete("call");
    window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    setCalled(true);
    // Bring the softphone into view.
    document.getElementById("desk-softphone-slot")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function qualify(q: string) {
    if (!lead) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/desk/campaign/qualify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaign_id: campaign.id, lead_id: lead.id, qualification: q, note: note || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      excludeRef.current.push(lead.id);
      await fetchNext();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (lead) excludeRef.current.push(lead.id);
    void fetchNext();
  }

  return (
    <div style={{ border: "1px solid var(--accent)", borderRadius: 10, padding: 14, display: "grid", gap: 12, background: "var(--bg-2)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong style={{ fontSize: 14 }}>📞 {t("Appels")} — {campaign.name}</strong>
        <button className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onClose}>
          {t("Fermer")}
        </button>
      </div>

      {err && <div style={{ color: "var(--bad)", fontSize: 12 }}>{err}</div>}

      {loading ? (
        <div className="muted" style={{ fontSize: 13, padding: 8 }}>{t("Chargement du prochain lead…")}</div>
      ) : paused ? (
        <div className="muted" style={{ fontSize: 13, padding: 8 }}>
          {t("Campagne en pause — réactive-la pour continuer à appeler.")}
        </div>
      ) : done || !lead ? (
        <div style={{ padding: 8, fontSize: 14 }}>
          🎉 {t("Plus de leads à appeler pour cette campagne.")}
        </div>
      ) : (
        <>
          {/* Lead card */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{lead.name || t("Patient")}</span>
              <span className="kbd" style={{ fontSize: 13 }}>{lead.phone ?? "—"}</span>
              {lead.qualification && <span className="tag" style={{ fontSize: 11 }}>{lead.qualification}</span>}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {lead.bmi != null ? `BMI ${lead.bmi}` : ""}
              {lead.call_count > 0 ? `${lead.bmi != null ? " · " : ""}${lead.call_count} ${t("appels")}` : ""}
              {lead.email ? ` · ${lead.email}` : ""}
            </div>
            {lead.last_note && (
              <div className="muted" style={{ fontSize: 12, fontStyle: "italic" }}>“{lead.last_note}”</div>
            )}
          </div>

          {/* Pre-call message note */}
          {messaged.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--good, #2f855a)", background: "var(--accent-soft, var(--bg))", borderRadius: 8, padding: "8px 10px" }}>
              ✓ {messaged.includes("sms") && messaged.includes("whatsapp")
                ? t("Un SMS et un WhatsApp viennent d'être envoyés à ce patient.")
                : messaged.includes("whatsapp")
                  ? t("Un WhatsApp vient d'être envoyé à ce patient.")
                  : t("Un SMS vient d'être envoyé à ce patient.")}
              {" "}{t("Laisse-lui un instant avant d'appeler.")}
            </div>
          )}

          {/* Call */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={call} disabled={!lead.phone} style={{ padding: "10px 16px", fontWeight: 600 }}>
              ☎ {called ? t("Numéro chargé — clique Appeler dans le softphone") : t("Appeler")}
            </button>
            <button className="ghost" onClick={skip} disabled={busy} style={{ padding: "8px 12px", fontSize: 13 }}>
              {t("Passer")} ⏭
            </button>
          </div>

          {/* Disposition */}
          <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("Après l'appel — qualification")}</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={t("Note (optionnel)")}
              style={{ width: "100%", fontSize: 13, fontFamily: "inherit", padding: 8, resize: "vertical" }}
            />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {QUALIFICATIONS.map((q) => (
                <button key={q} className="ghost" disabled={busy} onClick={() => qualify(q)}
                  style={{ padding: "6px 10px", fontSize: 12 }}>
                  {q}
                </button>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {t("Choisir une qualification enregistre l'appel et affiche le lead suivant.")}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

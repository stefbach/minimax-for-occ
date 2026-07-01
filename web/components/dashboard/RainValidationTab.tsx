"use client";

import { useEffect, useState, useCallback } from "react";
import { Send, MessageSquare, CheckCircle2, AlertTriangle, Clock, Eye } from "lucide-react";
import type { RainValidationResponse, ValidationCandidate, ValidationNotification } from "@/app/api/dashboard/rain-validation/route";

type Channel = "sms" | "whatsapp";

// Mirrors lib/rain-notifications.ts's RAIN_NOTICE_PREVIEW_TEMPLATE — kept
// local (rather than imported) so this client component doesn't bundle the
// server-only Twilio send logic that module also exports.
function previewMessage(name: string, callbackNumber: string): string {
  return `Dear ${name},\n\nWe confirm receipt of your request to speak with a member of our team.\n\nRain will contact you tomorrow from the following UK number ${callbackNumber} to provide further assistance and next steps.\n\nIf you have a preferred time for this call, please reply to this message.\n\nFor any urgent updates, please do not hesitate to contact us.\n\nWarm regards,\nYour Obesity Care Clinic Team`;
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function NotifBadges({ notifications }: { notifications: ValidationNotification[] }) {
  if (notifications.length === 0) return <span className="muted" style={{ fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {notifications.map((n) => {
        if (n.status === "sent") {
          return (
            <span key={n.channel} className="tag good" style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content" }}>
              <CheckCircle2 size={12} /> {n.channel === "sms" ? "SMS" : "WhatsApp"} envoyé
            </span>
          );
        }
        if (n.status === "failed") {
          return (
            <span key={n.channel} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content", background: "var(--bad-bg,#fef2f2)", color: "var(--bad)" }}>
              <AlertTriangle size={12} /> {n.channel === "sms" ? "SMS" : "WhatsApp"} échec
            </span>
          );
        }
        return (
          <span key={n.channel} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 5, width: "fit-content", background: "var(--panel-2)", color: "var(--muted)" }}>
            <Clock size={12} /> {n.channel === "sms" ? "SMS" : "WhatsApp"} {n.status}
          </span>
        );
      })}
    </div>
  );
}

export function RainValidationTab() {
  const [date, setDate] = useState(tomorrowIso());
  const [data, setData] = useState<RainValidationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, Channel[]>>({});
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number } | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/rain-validation?date=${date}`)
      .then((r) => r.json())
      .then((j: RainValidationResponse & { error?: string }) => {
        if (j.error) setError(j.error);
        else setData(j);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setLoading(false));
  }, [date]);

  useEffect(() => { setSelected({}); setSendResult(null); load(); }, [load]);

  function isSentOn(candidate: ValidationCandidate, channel: Channel): boolean {
    return candidate.notifications.some((n) => n.channel === channel && n.status === "sent");
  }

  function toggle(leadId: string, channel: Channel) {
    setSelected((prev) => {
      const current = prev[leadId] ?? [];
      const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel];
      const copy = { ...prev };
      if (next.length === 0) delete copy[leadId];
      else copy[leadId] = next;
      return copy;
    });
  }

  function sendSelected() {
    const decisions = Object.entries(selected).map(([lead_id, channels]) => ({ lead_id, channels }));
    if (decisions.length === 0) return;
    setSending(true);
    setSendResult(null);
    fetch("/api/dashboard/rain-validation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, decisions }),
    })
      .then((r) => r.json())
      .then((j: { ok?: boolean; sent?: number; failed?: number; error?: string }) => {
        if (j.error) setError(j.error);
        else {
          setSendResult({ sent: j.sent ?? 0, failed: j.failed ?? 0 });
          setSelected({});
          load();
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Erreur réseau"))
      .finally(() => setSending(false));
  }

  const candidates = data?.candidates ?? [];
  const done = candidates.filter((c) => c.notifications.some((n) => n.status === "sent"));
  const pending = candidates.filter((c) => !c.notifications.some((n) => n.status === "sent"));
  const selectedCount = Object.keys(selected).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          Sélectionnez qui reçoit ce soir le message « Rain vous appellera demain » pour le{" "}
          {new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" })}.
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--panel-2)", color: "var(--text)", colorScheme: "dark" }}
        />
      </div>

      {error && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--bad)", padding: 14 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {sendResult && (
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 7, padding: 14, color: sendResult.failed > 0 ? "var(--accent)" : "var(--good)" }}>
          <CheckCircle2 size={15} />
          {sendResult.sent} message(s) envoyé(s){sendResult.failed > 0 ? `, ${sendResult.failed} échec(s)` : ""}.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{candidates.length}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Candidats "À l'humain"</div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--good)" }}>{done.length}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Déjà notifiés</div>
        </div>
        <div className="card" style={{ padding: "12px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{pending.length}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>À traiter</div>
        </div>
      </div>

      {loading ? (
        <div className="card muted" style={{ padding: 24, textAlign: "center" }}>Chargement…</div>
      ) : candidates.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          Aucun patient dans la qualification "À passer à l'humain" pour l'instant.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Téléphone</th>
                <th>Pourquoi Rain doit appeler</th>
                <th>Qualifié le</th>
                <th>SMS</th>
                <th>WhatsApp</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const choices = selected[c.lead_id] ?? [];
                const smsSent = isSentOn(c, "sms");
                const waSent = isSentOn(c, "whatsapp");
                return (
                  <tr key={c.lead_id}>
                    <td style={{ fontWeight: 600 }}>{c.nom ?? "—"}</td>
                    <td>
                      {c.numero_telephone ? (
                        <a href={`tel:${c.numero_telephone}`} style={{ color: "var(--accent-2)" }}>{c.numero_telephone}</a>
                      ) : "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.reason ?? undefined}>
                      {c.reason ?? "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {c.last_qualification_update ? new Date(c.last_qualification_update).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) : "—"}
                    </td>
                    <td>
                      <input type="checkbox" checked={choices.includes("sms")} disabled={smsSent} onChange={() => toggle(c.lead_id, "sms")} />
                    </td>
                    <td>
                      <input type="checkbox" checked={choices.includes("whatsapp")} disabled={waSent} onChange={() => toggle(c.lead_id, "whatsapp")} />
                    </td>
                    <td><NotifBadges notifications={c.notifications} /></td>
                    <td>
                      <button className="ghost" style={{ display: "grid", placeItems: "center", padding: "4px 8px" }} onClick={() => setPreviewName(c.nom ?? "Patient")} title="Prévisualiser le message">
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={sendSelected}
          disabled={selectedCount === 0 || sending}
          style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px" }}
        >
          <Send size={15} />
          {sending ? "Envoi en cours…" : `Valider et envoyer (${selectedCount})`}
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          Chaque patient sélectionné recevra le message ce soir, sur chaque canal coché (SMS et/ou WhatsApp).
        </span>
      </div>

      {previewName && (
        <div
          onClick={() => setPreviewName(null)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(6,8,13,0.6)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ maxWidth: 420, width: "90%", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <MessageSquare size={16} /> Aperçu du message
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, lineHeight: 1.5, background: "var(--panel-2)", padding: 14, borderRadius: 8 }}>
              {previewMessage(previewName, data?.callback_number ?? "+447700162160")}
            </div>
            <button onClick={() => setPreviewName(null)} className="ghost" style={{ alignSelf: "flex-end", padding: "6px 14px" }}>Fermer</button>
          </div>
        </div>
      )}
    </div>
  );
}

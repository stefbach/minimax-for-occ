"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export type ContactCall = {
  id: string;
  direction: "in" | "out";
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  room_id: string | null;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  contact_id: string | null;
  queue_id: string | null;
  contacts?: { id: string; e164: string; display_name: string | null } | null;
};

type Interaction = {
  id: string;
  kind: string;
  summary: string | null;
  details: Record<string, unknown> | null;
  occurred_at: string;
  call_id: string | null;
};

/**
 * Live prospect sheet displayed next to the softphone. Shows the contact
 * basics, current call info, and a polled timeline of interactions
 * (calls, notes, AI summaries, …). The panel gracefully renders even when
 * the call has no associated contact yet.
 */
export function ContactPanel({ call }: { call: ContactCall | null }) {
  const t = useT();
  const contactId = call?.contact_id ?? null;
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!contactId) {
      setInteractions([]);
      return;
    }
    try {
      const r = await fetch(`/api/contacts/${contactId}/interactions`);
      if (!r.ok) return;
      const data = (await r.json()) as Interaction[];
      setInteractions(data);
    } catch {
      /* ignore */
    }
  }, [contactId]);

  useEffect(() => {
    void refresh();
    if (!contactId) return;
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [contactId, refresh]);

  const addNote = useCallback(async () => {
    if (!contactId || !noteDraft.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const r = await fetch(`/api/contacts/${contactId}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          summary: noteDraft.trim(),
          call_id: call?.id ?? null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "post failed");
      setNoteDraft("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }, [contactId, noteDraft, call?.id, refresh]);

  if (!call) return null;
  const phone = call.direction === "in" ? call.from_e164 : call.to_e164;
  return (
    <div className="card softphone-right">
      <h3>{call.contacts?.display_name ?? phone ?? t("Contact inconnu")}</h3>
      <div className="muted" style={{ fontSize: 13 }}>{phone}</div>

      <div style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 13 }}>
        <div>
          <span className="muted">{t("Statut")} : </span>
          <span className="tag">{call.state}</span>
        </div>
        <div>
          <span className="muted">{t("Direction")} : </span>
          {call.direction === "in" ? t("Entrant") : t("Sortant")}
        </div>
        <div>
          <span className="muted">{t("Démarré")} : </span>
          {new Date(call.started_at).toLocaleString()}
        </div>
        {call.answered_at && (
          <div>
            <span className="muted">{t("Décroché")} : </span>
            {new Date(call.answered_at).toLocaleTimeString()}
          </div>
        )}
        {call.ended_at && (
          <div>
            <span className="muted">{t("Terminé")} : </span>
            {new Date(call.ended_at).toLocaleTimeString()}
          </div>
        )}
        {call.room_id && (
          <div>
            <span className="muted">{t("Salle")} : </span>
            <span className="kbd">{call.room_id}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div
          className="muted"
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 6,
          }}
        >
          {t("Historique des interactions")}
        </div>
        {!contactId ? (
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            {t("Aucun contact lié à cet appel.")}
          </div>
        ) : interactions.length === 0 ? (
          <div
            style={{
              background: "var(--bg-2)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            {t("Aucune interaction précédente.")}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 220,
              overflow: "auto",
            }}
          >
            {interactions.map((it) => (
              <div
                key={it.id}
                style={{
                  background: "var(--bg-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 8,
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span className="tag" style={{ fontSize: 10 }}>{it.kind}</span>
                  <span className="muted" style={{ fontSize: 10 }}>
                    {new Date(it.occurred_at).toLocaleString()}
                  </span>
                </div>
                {it.summary && <div style={{ marginTop: 4 }}>{it.summary}</div>}
              </div>
            ))}
          </div>
        )}

        {contactId && (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            <textarea
              rows={2}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t("Ajouter une note…")}
              style={{ fontSize: 12 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={addNote}
                disabled={posting || !noteDraft.trim()}
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                {posting ? "…" : "+ " + t("Note")}
              </button>
            </div>
            {error && (
              <div style={{ color: "var(--bad)", fontSize: 11 }}>{error}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

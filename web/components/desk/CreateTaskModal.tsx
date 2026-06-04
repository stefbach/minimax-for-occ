"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n";

interface Contact {
  id: string;
  display_name: string | null;
  e164: string | null;
}

/**
 * Manual creation modal — supervisor "+ Créer une tâche" on
 * /desk/supervise. Picks a contact (typeahead over /api/contacts),
 * captures a qualification + optional scheduled_for, and POSTs to
 * /api/desk/tasks/manual.
 */
export function CreateTaskModal({
  defaultDate,
  onClose,
  onCreated,
}: {
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [contactId, setContactId] = useState("");
  const [qualification, setQualification] = useState("");
  const [scheduledFor, setScheduledFor] = useState(defaultDate + "T09:00");
  const [useNextBusinessDay, setUseNextBusinessDay] = useState(true);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load the contact list once when the modal opens. The /api/contacts
  // endpoint caps at 500 rows which is plenty for the supervise modal's
  // client-side filter.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/contacts", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: unknown) => {
        if (cancelled) return;
        if (Array.isArray(j)) setContacts(j as Contact[]);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts.slice(0, 30);
    return contacts
      .filter((c) =>
        (c.display_name ?? "").toLowerCase().includes(q) ||
        (c.e164 ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [contacts, search]);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        contact_id: contactId,
        qualification,
        notes: notes || undefined,
      };
      if (!useNextBusinessDay && scheduledFor) {
        body.scheduled_for = new Date(scheduledFor).toISOString();
      }
      const r = await fetch("/api/desk/tasks/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canSave = Boolean(contactId && qualification.trim() && !busy);

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
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ minWidth: 360, maxWidth: 520, width: "100%", display: "grid", gap: 12 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{t("Créer une tâche de rappel")}</h3>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("Contact")}</label>
          <input
            type="search"
            placeholder={t("Rechercher (nom ou téléphone)…")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            size={6}
            style={{ minHeight: 140 }}
          >
            {filtered.length === 0 ? (
              <option value="" disabled>
                {t("Aucun contact")}
              </option>
            ) : (
              filtered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name ?? "—"} ({c.e164 ?? "—"})
                </option>
              ))
            )}
          </select>
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>
            {t("Qualification")}
          </label>
          <input
            type="text"
            value={qualification}
            onChange={(e) => setQualification(e.target.value)}
            placeholder="RDV demandé"
          />
        </div>

        <div style={{ display: "grid", gap: 6 }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("Notes")}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={useNextBusinessDay}
            onChange={(e) => setUseNextBusinessDay(e.target.checked)}
          />
          {t("Programmer pour le prochain jour ouvré (par défaut)")}
        </label>

        {!useNextBusinessDay && (
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>
              {t("Programmer pour")}
            </label>
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          </div>
        )}

        {err && <div style={{ color: "var(--bad)", fontSize: 13 }}>{err}</div>}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="ghost" onClick={onClose} disabled={busy}>
            {t("Annuler")}
          </button>
          <button onClick={save} disabled={!canSave}>
            {busy ? t("Création…") : t("Créer")}
          </button>
        </div>
      </div>
    </div>
  );
}

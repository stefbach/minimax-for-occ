"use client";

import { useState } from "react";

export const dynamic = "force-dynamic";

type ErasePayload = {
  contact_id?: string;
  user_id?: string;
  org_id?: string;
};

export default function GdprPage() {
  const t = useT();
  const [contactId, setContactId] = useState("");
  const [userId, setUserId] = useState("");
  const [orgId, setOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function submit() {
    setError("");
    setResult("");
    const payload: ErasePayload = {};
    if (contactId.trim()) payload.contact_id = contactId.trim();
    if (userId.trim()) payload.user_id = userId.trim();
    if (orgId.trim()) payload.org_id = orgId.trim();
    if (Object.keys(payload).length === 0) {
      setError(t("Renseignez au moins un identifiant"));
      return;
    }
    const confirmMsg =
      payload.org_id
        ? `${t("Supprimer DÉFINITIVEMENT")} l'organisation ${payload.org_id} et tout son contenu ?`
        : payload.user_id
          ? `${t("Anonymiser")} l'utilisateur ${payload.user_id} (email scramble + memberships purgées) ?`
          : `${t("Supprimer")} le contact ${payload.contact_id} ?`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    try {
      const res = await fetch("/api/admin/gdpr/erase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string) ?? `HTTP ${res.status}`);
      } else {
        setResult(JSON.stringify(data, null, 2));
        setContactId("");
        setUserId("");
        setOrgId("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>RGPD — Droit à l&apos;effacement</h1>
          <div className="subtitle">
            Anonymise un utilisateur ou efface un contact. La suppression d&apos;organisation est
            réservée aux super-admins. Chaque action est tracée dans le journal d&apos;audit.
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 640, padding: 20 }}>
        <div className="field">
          <label htmlFor="contact_id">Contact ID</label>
          <input
            id="contact_id"
            type="text"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            placeholder="uuid du contact à supprimer"
          />
          <p className="hint">
            Supprime le contact. Les appels associés gardent l&apos;historique avec
            <code>contact_id = NULL</code>.
          </p>
        </div>

        <div className="field">
          <label htmlFor="user_id">User ID</label>
          <input
            id="user_id"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="uuid de l'utilisateur à anonymiser"
          />
          <p className="hint">
            Anonymise l&apos;email (<code>deleted_&lt;id&gt;@axon.local</code>), efface le nom
            affiché et purge ses memberships.
          </p>
        </div>

        <div className="field">
          <label htmlFor="org_id">Organization ID (super-admin)</label>
          <input
            id="org_id"
            type="text"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="uuid de l'organisation (cascade)"
          />
          <p className="hint">
            Supprime l&apos;organisation et toutes ses tables liées en cascade. Irréversible.
          </p>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
          <button type="button" className="btn btn-danger" onClick={submit} disabled={busy}>
            {busy ? t("Effacement en cours…") : t("Effacer")}
          </button>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}
        {result && (
          <pre
            style={{
              marginTop: 12,
              background: "var(--color-bg-2, #111)",
              color: "var(--color-fg, #ddd)",
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {result}
          </pre>
        )}
      </div>
    </>
  );
}

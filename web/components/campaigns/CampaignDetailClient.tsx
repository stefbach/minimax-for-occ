"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HelpButton } from "@/components/help/HelpButton";

export interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  state: string;
  agent_handle_name: string | null;
  phone_e164: string | null;
  max_concurrency: number;
  max_attempts: number;
  retry_delay_min: number;
  amd_enabled: boolean;
  schedule: Record<string, unknown>;
  created_at: string;
}

export interface TargetRow {
  id: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_call_id: string | null;
  contact_id: string;
  contact_e164: string | null;
  contact_name: string | null;
}

function stateClass(state: string): string {
  if (state === "running") return "tag good";
  if (state === "completed" || state === "scheduled") return "tag accent";
  return "tag";
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

export function CampaignDetailClient({
  campaign,
  targets,
}: {
  campaign: CampaignDetail;
  targets: TargetRow[];
}) {
  const router = useRouter();
  const [state, setState] = useState(campaign.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");

  const counts = targets.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  async function patchState(next: string) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setState(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setState("running");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  async function importTargets() {
    setBusy("import");
    setError(null);
    const contacts = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [e164, ...rest] = l.split(",").map((s) => s.trim());
        return { e164, name: rest.join(",") || null };
      })
      .filter((r) => r.e164);
    if (contacts.length === 0) {
      setBusy(null);
      setError("Aucune cible valide.");
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/targets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setCsvText("");
      setShowImport(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(null);
    }
  }

  const kpis: Array<{ label: string; key: string; tone?: string }> = [
    { label: "Total", key: "_total" },
    { label: "En cours", key: "dialing" },
    { label: "Répondus", key: "answered" },
    { label: "Terminés", key: "done" },
    { label: "Échecs", key: "failed", tone: "bad" },
  ];
  const total = targets.length;

  return (
    <>
      <div className="page-header">
        <div>
          <Link href="/campaigns" style={{ fontSize: 13, color: "var(--muted)" }}>
            ← Toutes les campagnes
          </Link>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {campaign.name}
            <span className={stateClass(state)}>{state}</span>
          </h1>
          {campaign.description && (
            <div className="subtitle">{campaign.description}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {state !== "running" && state !== "completed" && state !== "cancelled" && (
            <button onClick={start} disabled={busy !== null}>
              {busy === "start" ? "…" : "Démarrer"}
            </button>
          )}
          {state === "running" && (
            <button
              className="ghost"
              onClick={() => patchState("paused")}
              disabled={busy !== null}
            >
              Mettre en pause
            </button>
          )}
          {state === "paused" && (
            <button onClick={() => patchState("running")} disabled={busy !== null}>
              Reprendre
            </button>
          )}
          {state !== "completed" && state !== "cancelled" && (
            <button
              className="danger"
              onClick={() => patchState("cancelled")}
              disabled={busy !== null}
            >
              Annuler
            </button>
          )}
          <HelpButton contextKey="campaigns" />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => {
          const value = k.key === "_total" ? total : counts[k.key] ?? 0;
          return (
            <div key={k.key} className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>{k.label}</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: k.tone === "bad" ? "var(--bad)" : "var(--text)",
                }}
              >
                {value}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Agent</div>
            <div>{campaign.agent_handle_name ?? "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Numéro émetteur</div>
            <div>{campaign.phone_e164 ?? "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Concurrence / tentatives</div>
            <div>
              {campaign.max_concurrency} · {campaign.max_attempts} (retry {campaign.retry_delay_min}min)
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>AMD</div>
            <div>{campaign.amd_enabled ? "Activé" : "Désactivé"}</div>
          </div>
        </div>
      </div>

      <div className="page-header" style={{ marginTop: 0 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Cibles</h2>
        <button className="subtle" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Annuler" : "Ajouter des cibles"}
        </button>
      </div>

      {showImport && (
        <div className="card" style={{ marginBottom: 12 }}>
          <label>Coller un CSV (e164,nom)</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"+33612345678,Jean Dupont"}
            style={{ minHeight: 100, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
          />
          <div style={{ marginTop: 8 }}>
            <button onClick={importTargets} disabled={busy !== null}>
              {busy === "import" ? "Import…" : "Importer"}
            </button>
          </div>
        </div>
      )}

      {targets.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Aucune cible pour cette campagne.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Statut</th>
                <th>Tentatives</th>
                <th>Dernier essai</th>
                <th>Prochain essai</th>
                <th>Appel</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div>{t.contact_name ?? t.contact_e164 ?? "—"}</div>
                    {t.contact_name && (
                      <div className="muted" style={{ fontSize: 12 }}>{t.contact_e164}</div>
                    )}
                  </td>
                  <td>
                    <span className="tag">{t.status}</span>
                  </td>
                  <td>{t.attempts}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDate(t.last_attempt_at)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDate(t.next_attempt_at)}
                  </td>
                  <td>
                    {t.last_call_id ? (
                      <Link href={`/calls/${t.last_call_id}`}>Voir</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import type { Agent } from "@/lib/types";

export function AgentsPageClient({
  agents,
  supabaseReady,
}: {
  agents: Agent[];
  supabaseReady: boolean;
}) {
  const t = useT();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t("Agents")}</h1>
          <div className="subtitle">
            {agents.length} {agents.length === 1 ? t("agent") : t("agents")}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/agents/new">
            <button>+ {t("Nouvel agent")}</button>
          </Link>
        </div>
      </div>

      {!supabaseReady ? (
        <div className="card">
          <h3>{t("Supabase non configuré")}</h3>
          <p className="muted">
            {t("Rendez-vous dans")} <Link href="/settings">Settings</Link>{" "}
            {t("ou définissez les variables d'environnement")}{" "}
            <span className="kbd">SUPABASE_URL</span> {t("et")}{" "}
            <span className="kbd">SUPABASE_SERVICE_ROLE_KEY</span> {t("dans Vercel.")}</p>
        </div>
      ) : agents.length === 0 ? (
        <div className="card">
          <h3>{t("Aucun agent pour l'instant")}</h3>
          <p className="muted">{t("Cliquez sur « Nouvel agent » pour commencer.")}</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>{t("Nom")}</th>
                <th>LLM</th>
                <th>{t("Voix")}</th>
                <th>{t("Langue")}</th>
                <th>RAG</th>
                <th>{t("Mis à jour")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/agents/${a.id}`} style={{ color: "var(--accent-2)", fontWeight: 600 }}>
                      {a.name}
                    </Link>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{a.description ?? ""}</div>
                  </td>
                  <td><span className="tag">{a.llm_provider}/{a.llm_model}</span></td>
                  <td>
                    {a.tts_voice_id
                      ? <span className="kbd">{a.tts_voice_id}</span>
                      : <em style={{ color: "var(--muted)" }}>{t("par défaut")}</em>}
                    {a.tts_model && <div style={{ color: "var(--muted)", fontSize: 11 }}>{a.tts_model}</div>}
                  </td>
                  <td>{a.language}</td>
                  <td>
                    {a.rag_enabled
                      ? <span className="tag good">{t("activé")}</span>
                      : <span className="tag">{t("désactivé")}</span>}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{new Date(a.updated_at).toLocaleString()}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Link href={`/agents/${a.id}/edit`}>
                      <button className="ghost" style={{ padding: "6px 10px" }}>{t("Modifier")}</button>
                    </Link>
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

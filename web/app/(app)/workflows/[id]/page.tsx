import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function WorkflowEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const base = (process.env.N8N_BASE_URL ?? "").replace(/\/$/, "");
  const editorUrl = base ? `${base}/workflow/${id}` : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Éditeur n8n</h1>
          <div className="subtitle">
            Workflow <span className="kbd">{id}</span> ·{" "}
            <Link href="/workflows" style={{ color: "var(--muted)" }}>← retour à la liste</Link>
          </div>
        </div>
        {editorUrl && (
          <a href={editorUrl} target="_blank" rel="noopener noreferrer">
            <button className="ghost">Ouvrir dans un nouvel onglet ↗</button>
          </a>
        )}
      </div>

      {!editorUrl ? (
        <div className="card">
          <h3>N8N_BASE_URL manquant</h3>
          <p className="muted">Définissez la variable côté Vercel pour activer l&apos;éditeur intégré.</p>
        </div>
      ) : (
        <div
          className="card"
          style={{ padding: 0, overflow: "hidden", height: "calc(100vh - 200px)", minHeight: 600 }}
        >
          <iframe
            src={editorUrl}
            style={{ border: 0, width: "100%", height: "100%", display: "block" }}
            title={`n8n editor ${id}`}
            allow="clipboard-read; clipboard-write"
          />
        </div>
      )}

      <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
        ⚠️ Si l&apos;éditeur reste blanc : votre n8n bloque l&apos;intégration en iframe par défaut. Sur l&apos;instance n8n, définissez{" "}
        <span className="kbd">N8N_SECURITY_HEADERS_FRAME_ANCESTORS=*</span> (ou plus restrictif) puis redémarrez.
        En attendant, utilisez le bouton « Ouvrir dans un nouvel onglet ↗ ».
      </div>
    </>
  );
}

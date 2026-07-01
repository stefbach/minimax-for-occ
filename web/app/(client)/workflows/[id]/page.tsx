import Link from "next/link";
import { HelpButton } from "@/components/help/HelpButton";

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
          <h1>n8n Editor</h1>
          <div className="subtitle">
            Workflow <span className="kbd">{id}</span> ·{" "}
            <Link href="/workflows" style={{ color: "var(--muted)" }}>← back to list</Link>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {editorUrl && (
            <a href={editorUrl} target="_blank" rel="noopener noreferrer">
              <button className="ghost">Open in new tab ↗</button>
            </a>
          )}
          <HelpButton contextKey="workflows" />
        </div>
      </div>

      {!editorUrl ? (
        <div className="card">
          <h3>N8N_BASE_URL missing</h3>
          <p className="muted">Set this variable on Vercel to enable the embedded editor.</p>
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
        ⚠️ If the editor stays blank: your n8n instance blocks iframe embedding by default. On the n8n instance, set{" "}
        <span className="kbd">N8N_SECURITY_HEADERS_FRAME_ANCESTORS=*</span> (or more restrictive) then restart.
        In the meantime, use the &quot;Open in new tab ↗&quot; button.
      </div>
    </>
  );
}

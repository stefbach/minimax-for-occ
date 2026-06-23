import Link from "next/link";
import { ConnectionsClient } from "@/components/workflows/ConnectionsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Connexions</h1>
          <div className="subtitle">
            Tes accès email (SMTP) et WhatsApp (WATI). Tes agents de gestion s&apos;en servent pour envoyer.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href="/workflows"><button className="ghost">← Workflows</button></Link>
          <HelpButton contextKey="workflows" />
        </div>
      </div>
      <ConnectionsClient />
    </>
  );
}

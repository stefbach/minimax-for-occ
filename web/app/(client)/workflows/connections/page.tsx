import Link from "next/link";
import { ConnectionsClient } from "@/components/workflows/ConnectionsClient";
import { HelpButton } from "@/components/help/HelpButton";

export const dynamic = "force-dynamic";

export default function ConnectionsPage() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Connections</h1>
          <div className="subtitle">
            Your email (SMTP) and WhatsApp (WATI) credentials. Your management agents use these to send messages.
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

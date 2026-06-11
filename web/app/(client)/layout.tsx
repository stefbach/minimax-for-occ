import { ClientSidebar } from "@/components/ClientSidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { PersistentSoftphoneShell } from "@/components/voice/PersistentSoftphoneShell";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="app-shell">
        <ClientSidebar />
        <main className="main">
          {/* The softphone lives at the layout level so it stays mounted
              across all route changes — a live call no longer drops when
              the agent navigates to /mes-patients or anywhere else (Wati
              2026-06-11). Renders as a sticky bar on top of every page;
              clicking "⤢ Étendre" slides the full UI in from the right. */}
          <PersistentSoftphoneShell />
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

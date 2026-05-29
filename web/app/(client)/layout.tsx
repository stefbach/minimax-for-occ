import { ClientSidebar } from "@/components/ClientSidebar";
import { ToastProvider } from "@/components/ui/Toast";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="app-shell">
        <ClientSidebar />
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}

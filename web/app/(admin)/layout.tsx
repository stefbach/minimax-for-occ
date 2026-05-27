import { redirect } from "next/navigation";
import { currentMembership } from "@/lib/supabase-auth";
import { AdminSidebar } from "@/components/AdminSidebar";
import { ToastProvider } from "@/components/ui/Toast";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let role: string | null = null;
  try {
    const m = await currentMembership();
    role = m?.role ?? null;
  } catch {
    role = null;
  }
  // Only super_admin (and later axon_* roles) get in.
  const allowed = role === "super_admin" || role?.startsWith("axon_");
  if (!allowed) redirect("/");

  return (
    <ToastProvider>
      <div className="app-shell">
        <AdminSidebar />
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}

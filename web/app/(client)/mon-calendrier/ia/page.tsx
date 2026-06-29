import { hasSupabase } from "@/lib/supabase";
import { IaCalendarClient } from "@/components/desk/IaCalendarClient";

export const dynamic = "force-dynamic";

export default function IaCalendarPage() {
  if (!hasSupabase()) {
    return (
      <div className="card" style={{ borderColor: "var(--bad)" }}>
        Supabase non configuré.
      </div>
    );
  }
  return <IaCalendarClient />;
}

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
  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Calendrier IA</h1>
          <div className="subtitle">
            Les rappels que Charlotte (IA) passera à l'heure demandée par le patient.
          </div>
        </div>
      </div>
      <IaCalendarClient />
    </div>
  );
}

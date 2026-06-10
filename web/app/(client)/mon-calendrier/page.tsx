import { hasSupabase } from "@/lib/supabase";
import { MyCalendarClient } from "@/components/desk/MyCalendarClient";

export const dynamic = "force-dynamic";

export default function MyCalendarPage() {
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
          <h1>Mon calendrier</h1>
          <div className="subtitle">
            Mes rappels et suivis à venir, groupés par jour.
          </div>
        </div>
      </div>
      <MyCalendarClient />
    </div>
  );
}

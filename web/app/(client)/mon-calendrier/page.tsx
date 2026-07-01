import { hasSupabase } from "@/lib/supabase";
import { MyCalendarClient } from "@/components/desk/MyCalendarClient";
import { MyCalendarPageHeader } from "@/components/desk/MyCalendarPageHeader";

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
      <MyCalendarPageHeader />
      <MyCalendarClient />
    </div>
  );
}

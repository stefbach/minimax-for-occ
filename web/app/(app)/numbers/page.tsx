import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { hasTwilio } from "@/lib/twilio";
import { NumbersClient, type PhoneNumberRow, type FlowOption } from "@/components/numbers/NumbersClient";

export const dynamic = "force-dynamic";

const DEFAULT_ORG = "00000000-0000-0000-0000-000000000001";

export default async function NumbersPage() {
  let initial: PhoneNumberRow[] = [];
  let flows: FlowOption[] = [];

  if (hasSupabase()) {
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from("phone_numbers")
        .select("*")
        .eq("org_id", DEFAULT_ORG)
        .order("created_at", { ascending: false })
        .limit(500);
      initial = (data ?? []) as PhoneNumberRow[];
    } catch {
      /* table might not exist yet — start empty */
    }
    try {
      const sb = supabaseServer();
      const { data } = await sb
        .from("flows")
        .select("id, name")
        .eq("org_id", DEFAULT_ORG)
        .order("name", { ascending: true })
        .limit(200);
      flows = (data ?? []) as FlowOption[];
    } catch {
      /* flows table may be empty — that's fine */
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Numéros de téléphone</h1>
          <div className="subtitle">
            {initial.length} numéro{initial.length === 1 ? "" : "s"} provisionné{initial.length === 1 ? "" : "s"} via Twilio
          </div>
        </div>
      </div>

      {!hasTwilio() && (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <h3 style={{ marginTop: 0, color: "var(--bad)" }}>Twilio non configuré</h3>
          <p className="muted" style={{ margin: 0 }}>
            Définissez <span className="kbd">TWILIO_ACCOUNT_SID</span> et{" "}
            <span className="kbd">TWILIO_AUTH_TOKEN</span> dans les variables d&apos;environnement Vercel
            pour rechercher et acheter des numéros. La recherche et l&apos;achat sont désactivés tant que ces
            variables sont absentes.
          </p>
        </div>
      )}

      <NumbersClient initial={initial} flows={flows} twilioReady={hasTwilio()} />
    </>
  );
}

import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

// Démarrage guidé — a generic onboarding checklist. Each step links to the
// page that completes it; completion is auto-detected from org-scoped counts
// so the user always sees where they are. No client-specific logic.

async function count(table: string, orgId: string, extra?: (q: any) => any): Promise<number> {
  try {
    const sb = supabaseServer();
    let q = sb.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  } catch {
    return 0;
  }
}

export default async function GuidedStartPage() {
  let agents = 0, tables = 0, contacts = 0, campaigns = 0, numbers = 0;
  if (hasSupabase()) {
    const orgId = await currentOrgIdForServer();
    [agents, tables, contacts, campaigns, numbers] = await Promise.all([
      count("agent_handles", orgId, (q) => q.eq("kind", "ai").eq("active", true)),
      count("tenant_data_tables", orgId),
      count("contacts", orgId),
      count("campaigns", orgId),
      count("phone_numbers", orgId),
    ]);
  }

  const steps = [
    {
      n: 1,
      title: "Créer un agent IA",
      desc: "Définissez la voix, la langue et la personnalité de l'agent qui appellera.",
      href: "/agents",
      cta: "Aller aux Agents",
      done: agents > 0,
    },
    {
      n: 2,
      title: "Ajouter vos contacts",
      desc: "Connectez une table de données (ex. vos leads) ou importez une liste de contacts.",
      href: "/contacts",
      cta: "Gérer les contacts",
      done: tables > 0 || contacts > 0,
    },
    {
      n: 3,
      title: "Écrire un script (optionnel)",
      desc: "Donnez à l'agent une trame de conversation. Vous pouvez la tester en simulation directement.",
      href: "/scripts",
      cta: "Ouvrir les Scripts",
      done: false,
      optional: true,
    },
    {
      n: 4,
      title: "Assigner un numéro émetteur",
      desc: "Le numéro qui s'affiche chez la personne appelée.",
      href: "/settings",
      cta: "Paramètres",
      done: numbers > 0,
    },
    {
      n: 5,
      title: "Créer une campagne",
      desc: "Choisissez l'agent, la table, les créneaux et les règles de relance — puis lancez.",
      href: "/campaigns/new",
      cta: "Nouvelle campagne",
      done: campaigns > 0,
    },
    {
      n: 6,
      title: "Suivre en direct",
      desc: "Une fois lancé, suivez les appels en temps réel dans le Live Monitor.",
      href: "/live",
      cta: "Ouvrir le Live Monitor",
      done: false,
    },
  ];

  const requiredDone = steps.filter((s) => !s.optional && s.done).length;
  const requiredTotal = steps.filter((s) => !s.optional).length;
  const pct = Math.round((requiredDone / requiredTotal) * 100);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Démarrage guidé</h1>
          <div className="subtitle">
            Les étapes pour lancer votre première campagne. {requiredDone}/{requiredTotal} terminées.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, height: 10, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .3s" }} />
          </div>
          <strong>{pct}%</strong>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {steps.map((s) => (
          <div key={s.n} className="card" style={{ display: "flex", alignItems: "center", gap: 16, opacity: s.done ? 0.7 : 1 }}>
            <div
              style={{
                width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700,
                background: s.done ? "var(--good,#16a34a)" : "var(--bg-2)",
                color: s.done ? "#fff" : "var(--text)",
                border: s.done ? "none" : "1px solid var(--border)",
              }}
            >
              {s.done ? "✓" : s.n}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{s.title}</strong>
                {s.optional && <span className="tag" style={{ fontSize: 10 }}>optionnel</span>}
                {s.done && <span className="tag good" style={{ fontSize: 10 }}>fait</span>}
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{s.desc}</div>
            </div>
            <Link href={s.href}>
              <button className={s.done ? "ghost" : ""}>{s.cta}</button>
            </Link>
          </div>
        ))}
      </div>
    </>
  );
}

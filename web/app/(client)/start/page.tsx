import Link from "next/link";
import { hasSupabase, supabaseServer } from "@/lib/supabase";
import { currentOrgIdForServer } from "@/lib/supabase-auth";

export const dynamic = "force-dynamic";

// Démarrage guidé — scenario-based onboarding. The user picks the path that
// matches their goal; each scenario is an ordered checklist with auto-detected
// completion from org-scoped counts. Generic (no tenant-specific logic).

type StepKey =
  | "agent" | "contacts" | "scripts" | "number" | "campaign"
  | "campaigns_list" | "ivr" | "transfer" | "live" | "simulation"
  | "monitor" | "schedule";

type Counts = {
  agents: number; tables: number; contacts: number;
  campaigns: number; numbers: number; flows: number; scripts: number;
};

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

function stepFor(key: StepKey, c: Counts): {
  title: string; desc: string; href: string; cta: string; done: boolean; optional?: boolean;
} {
  switch (key) {
    case "agent":
      return {
        title: "Créer ou sélectionner vos agents IA",
        desc: "Choisissez un agent existant ou créez-en un nouveau (voix, langue, personnalité).",
        href: "/agents", cta: c.agents > 0 ? "Voir les agents" : "Créer un agent", done: c.agents > 0,
      };
    case "contacts":
      return {
        title: "Ajouter ou sélectionner des contacts",
        desc: "Connectez une table de données existante ou importez une nouvelle liste de contacts.",
        href: "/contacts", cta: c.tables + c.contacts > 0 ? "Voir les contacts" : "Importer", done: c.tables > 0 || c.contacts > 0,
      };
    case "scripts":
      return {
        title: "Écrire ou sélectionner un script",
        desc: "Donnez à l'agent une trame de conversation, ou réutilisez un script existant.",
        href: "/scripts", cta: c.scripts > 0 ? "Voir les scripts" : "Nouveau script", done: c.scripts > 0, optional: true,
      };
    case "number":
      return {
        title: "Prendre ou assigner un numéro",
        desc: "Achetez un numéro depuis la marketplace ou utilisez un numéro existant.",
        href: "/numbers", cta: c.numbers > 0 ? "Voir les numéros" : "Prendre un numéro", done: c.numbers > 0,
      };
    case "campaign":
      return {
        title: "Créer une campagne",
        desc: "Choisissez l'agent, la table, les créneaux et les règles de relance — puis lancez.",
        href: "/campaigns/new", cta: "Nouvelle campagne", done: c.campaigns > 0,
      };
    case "campaigns_list":
      return {
        title: "Reprendre ou cloner une campagne",
        desc: "Repartez d'une campagne existante : reprise après pause, ou duplication pour relance.",
        href: "/campaigns", cta: "Voir les campagnes", done: false,
      };
    case "schedule":
      return {
        title: "Programmer la fenêtre d'appel",
        desc: "Définissez les créneaux autorisés (jours, heures, fuseau horaire) sur la campagne.",
        href: "/campaigns", cta: "Programmer", done: false, optional: true,
      };
    case "monitor":
      return {
        title: "Suivre l'activité depuis le tableau de bord",
        desc: "KPIs, qualifications, coût, performance par agent — sur la période choisie.",
        href: "/dashboard", cta: "Ouvrir le tableau de bord", done: false,
      };
    case "ivr":
      return {
        title: "Construire un flow / IVR",
        desc: "Routez vos appels entrants vers le bon agent ou la bonne file d'attente.",
        href: "/flows", cta: c.flows > 0 ? "Voir les flows" : "Créer un flow", done: c.flows > 0,
      };
    case "transfer":
      return {
        title: "Configurer un transfert humain",
        desc: "Définissez la file d'attente vers laquelle l'IA peut transférer un appel.",
        href: "/settings", cta: "Files d'attente", done: false, optional: true,
      };
    case "live":
      return {
        title: "Suivre en direct",
        desc: "Une fois lancé, suivez les appels en temps réel dans le Live Monitor.",
        href: "/live", cta: "Ouvrir le Live Monitor", done: false,
      };
    case "simulation":
      return {
        title: "Tester l'agent en simulation",
        desc: "Lancez une conversation simulée pour valider le comportement avant de dépenser un appel.",
        href: "/agents", cta: "Lancer une simulation", done: false,
      };
  }
}

type Scenario = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  steps: StepKey[];
};

const SCENARIOS: Scenario[] = [
  // ─── Scénarios validés patron ────────────────────────────────────────────
  {
    id: "campaign",
    emoji: "🚀",
    title: "Lancer ma 1ère campagne",
    subtitle: "Création de campagne → agents → contacts → script → numéro → live.",
    steps: ["campaign", "agent", "contacts", "scripts", "number", "live"],
  },
  {
    id: "agents",
    emoji: "🤖",
    title: "Démarrer côté agent IA",
    subtitle: "Création d'agent → contacts → script → numéro → live.",
    steps: ["agent", "contacts", "scripts", "number", "live"],
  },

  // ─── Scénarios centre d'appel ────────────────────────────────────────────
  {
    id: "import",
    emoji: "📇",
    title: "Importer un fichier de leads et l'attaquer",
    subtitle: "J'ai un CSV/Excel à appeler dès aujourd'hui.",
    steps: ["contacts", "agent", "scripts", "number", "campaign", "live"],
  },
  {
    id: "callback",
    emoji: "🔁",
    title: "Relancer mes non-décrochés",
    subtitle: "Cibler les contacts non joints d'une campagne précédente.",
    steps: ["campaigns_list", "agent", "schedule", "live"],
  },
  {
    id: "reminder",
    emoji: "📅",
    title: "Confirmer des RDV (rappels)",
    subtitle: "Appels courts de confirmation depuis votre table de RDV.",
    steps: ["contacts", "agent", "scripts", "number", "campaign", "live"],
  },
  {
    id: "schedule",
    emoji: "🕒",
    title: "Programmer une campagne pour plus tard",
    subtitle: "Préparer maintenant, lancer aux créneaux autorisés.",
    steps: ["agent", "contacts", "scripts", "number", "campaign", "schedule"],
  },
  {
    id: "clone",
    emoji: "🔄",
    title: "Cloner une campagne qui marche",
    subtitle: "Repartir d'une campagne existante et changer la cible/agent.",
    steps: ["campaigns_list", "contacts", "campaign", "live"],
  },
  {
    id: "ab",
    emoji: "🧪",
    title: "A/B tester deux agents",
    subtitle: "Comparer deux scripts/voix sur la même cible.",
    steps: ["agent", "scripts", "contacts", "campaign", "monitor"],
  },
  {
    id: "inbound",
    emoji: "📞",
    title: "Recevoir des appels entrants",
    subtitle: "Numéro entrant + flow IVR + transfert vers un humain.",
    steps: ["number", "agent", "ivr", "transfer", "live"],
  },
  {
    id: "overflow",
    emoji: "🌙",
    title: "Permanence hors-heures / débordement",
    subtitle: "L'IA prend le relais quand l'équipe humaine n'est pas là.",
    steps: ["number", "agent", "ivr", "transfer", "monitor"],
  },
  {
    id: "monitor",
    emoji: "📊",
    title: "Suivre la performance de mon équipe",
    subtitle: "Aucune création — pilotage et reporting depuis le tableau de bord.",
    steps: ["monitor", "live"],
  },
  {
    id: "test",
    emoji: "🛠",
    title: "Tester sans dépenser un appel",
    subtitle: "Conception et simulation seulement — aucun appel réel.",
    steps: ["agent", "scripts", "simulation"],
  },
];

export default async function GuidedStartPage({
  searchParams,
}: {
  searchParams?: Promise<{ scenario?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const counts: Counts = { agents: 0, tables: 0, contacts: 0, campaigns: 0, numbers: 0, flows: 0, scripts: 0 };
  if (hasSupabase()) {
    const orgId = await currentOrgIdForServer();
    const [agents, tables, contacts, campaigns, numbers, flows, scripts] = await Promise.all([
      count("agent_handles", orgId, (q) => q.eq("kind", "ai").eq("active", true)),
      count("tenant_data_tables", orgId),
      count("contacts", orgId),
      count("campaigns", orgId),
      count("phone_numbers", orgId),
      count("flows", orgId),
      count("scripts", orgId),
    ]);
    Object.assign(counts, { agents, tables, contacts, campaigns, numbers, flows, scripts });
  }

  const selectedId = sp.scenario ?? "campaign";
  const scenario = SCENARIOS.find((s) => s.id === selectedId) ?? SCENARIOS[0];
  const steps = scenario.steps.map((key, i) => ({ n: i + 1, key, ...stepFor(key, counts) }));

  const requiredDone = steps.filter((s) => !s.optional && s.done).length;
  const requiredTotal = steps.filter((s) => !s.optional).length;
  const pct = requiredTotal === 0 ? 0 : Math.round((requiredDone / requiredTotal) * 100);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Démarrage guidé</h1>
          <div className="subtitle">
            Choisissez votre scénario : Axon vous déroule les étapes dans le bon ordre.
          </div>
        </div>
      </div>

      {/* Scenario picker */}
      <div
        className="grid"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 18 }}
      >
        {SCENARIOS.map((s) => {
          const active = s.id === scenario.id;
          return (
            <Link
              key={s.id}
              href={`/start?scenario=${s.id}`}
              className="card"
              style={{
                textDecoration: "none",
                cursor: "pointer",
                padding: 14,
                borderColor: active ? "var(--accent)" : undefined,
                borderWidth: active ? 2 : 1,
                background: active ? "color-mix(in srgb, var(--accent) 8%, var(--panel))" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{s.emoji}</span>
                <strong style={{ color: "var(--text)" }}>{s.title}</strong>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s.subtitle}</div>
            </Link>
          );
        })}
      </div>

      {/* Progress for selected scenario */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>{scenario.title}</strong> · {requiredDone}/{requiredTotal} étapes terminées
            </div>
            <div style={{ height: 10, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .3s" }} />
            </div>
          </div>
          <strong>{pct}%</strong>
        </div>
      </div>

      {/* Steps for selected scenario */}
      <div style={{ display: "grid", gap: 12 }}>
        {steps.map((s) => (
          <div key={s.key} className="card" style={{ display: "flex", alignItems: "center", gap: 16, opacity: s.done ? 0.7 : 1 }}>
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

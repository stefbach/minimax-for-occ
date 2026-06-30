"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";
import { HelpButton } from "@/components/help/HelpButton";

type StepKey =
  | "agent" | "contacts" | "scripts" | "number" | "campaign"
  | "campaigns_list" | "ivr" | "transfer" | "live" | "simulation"
  | "monitor" | "schedule"
  | "desk_discover" | "desk_claim" | "desk_dial" | "desk_qualify" | "desk_callback";

type Counts = {
  agents: number; tables: number; contacts: number;
  campaigns: number; numbers: number; flows: number; scripts: number;
};

export function GuidedStartClient({
  counts: c,
  role,
  selectedId,
}: {
  counts: Counts;
  role: string | null;
  selectedId: string;
}) {
  const t = useT();

  function stepFor(key: StepKey) {
    switch (key) {
      case "agent":
        return {
          title: t("Créer ou sélectionner vos agents IA"),
          desc: t("Choisissez un agent existant ou créez-en un nouveau (voix, langue, personnalité)."),
          href: "/agents", cta: c.agents > 0 ? t("Voir les agents") : t("Créer un agent"), done: c.agents > 0,
        };
      case "contacts":
        return {
          title: t("Ajouter ou sélectionner des contacts"),
          desc: t("Connectez une table de données existante ou importez une nouvelle liste de contacts."),
          href: "/contacts", cta: c.tables + c.contacts > 0 ? t("Voir les contacts") : t("Importer"), done: c.tables > 0 || c.contacts > 0,
        };
      case "scripts":
        return {
          title: t("Écrire ou sélectionner un script"),
          desc: t("Donnez à l'agent une trame de conversation, ou réutilisez un script existant."),
          href: "/scripts", cta: c.scripts > 0 ? t("Voir les scripts") : t("Nouveau script"), done: c.scripts > 0, optional: true,
        };
      case "number":
        return {
          title: t("Prendre ou assigner un numéro"),
          desc: t("Achetez un numéro depuis la marketplace ou utilisez un numéro existant."),
          href: "/numbers", cta: c.numbers > 0 ? t("Voir les numéros") : t("Prendre un numéro"), done: c.numbers > 0,
        };
      case "campaign":
        return {
          title: t("Créer une campagne"),
          desc: t("Choisissez l'agent, la table, les créneaux et les règles de relance — puis lancez."),
          href: "/campaigns/new", cta: t("Nouvelle campagne"), done: c.campaigns > 0,
        };
      case "campaigns_list":
        return {
          title: t("Reprendre ou cloner une campagne"),
          desc: t("Repartez d'une campagne existante : reprise après pause, ou duplication pour relance."),
          href: "/campaigns", cta: t("Voir les campagnes"), done: false,
        };
      case "schedule":
        return {
          title: t("Programmer la fenêtre d'appel"),
          desc: t("Définissez les créneaux autorisés (jours, heures, fuseau horaire) sur la campagne."),
          href: "/campaigns", cta: t("Programmer"), done: false, optional: true,
        };
      case "monitor":
        return {
          title: t("Suivre l'activité depuis le tableau de bord"),
          desc: t("KPIs, qualifications, coût, performance par agent — sur la période choisie."),
          href: "/dashboard", cta: t("Ouvrir le tableau de bord"), done: false,
        };
      case "ivr":
        return {
          title: t("Construire un flow / IVR"),
          desc: t("Routez vos appels entrants vers le bon agent ou la bonne file d'attente."),
          href: "/flows", cta: c.flows > 0 ? t("Voir les flows") : t("Créer un flow"), done: c.flows > 0,
        };
      case "transfer":
        return {
          title: t("Configurer un transfert humain"),
          desc: t("Définissez la file d'attente vers laquelle l'IA peut transférer un appel."),
          href: "/settings", cta: t("Files d'attente"), done: false, optional: true,
        };
      case "live":
        return {
          title: t("Suivre en direct"),
          desc: t("Une fois lancé, suivez les appels en temps réel dans le Live Monitor."),
          href: "/live", cta: t("Ouvrir le Live Monitor"), done: false,
        };
      case "simulation":
        return {
          title: t("Tester l'agent en simulation"),
          desc: t("Lancez une conversation simulée pour valider le comportement avant de dépenser un appel."),
          href: "/agents", cta: t("Lancer une simulation"), done: false,
        };
      case "desk_discover":
        return {
          title: t("Découvrir Mon poste"),
          desc: t("Trois panneaux : ta file du jour à gauche, le contexte patient au centre, le pool partagé à droite."),
          href: "/desk", cta: t("Ouvrir Mon poste"), done: false,
        };
      case "desk_claim":
        return {
          title: t("Prendre un appel du pool partagé"),
          desc: t("Le pool partagé montre les patients à rappeler que personne n'a encore réservés. Clique « Prendre » pour t'en attribuer un."),
          href: "/desk", cta: t("Voir le pool"), done: false,
        };
      case "desk_dial":
        return {
          title: t("Lancer ton premier appel"),
          desc: t("Sélectionne un patient dans ta file, vérifie son contexte au centre, puis clique « Appeler ». Ton micro/écouteurs se connectent automatiquement."),
          href: "/desk", cta: t("Aller à Mon poste"), done: false,
        };
      case "desk_qualify":
        return {
          title: t("Qualifier un appel"),
          desc: t("À la fin de l'appel : choisis une qualification (RDV confirmé, à rappeler, pas intéressé…) et ajoute une note. Le patient avance dans le pipeline."),
          href: "/desk", cta: t("Voir la qualification"), done: false,
        };
      case "desk_callback":
        return {
          title: t("Programmer un rappel"),
          desc: t("Pour les patients à recontacter, fixe une date/heure : ils réapparaîtront dans ta file à ce moment-là."),
          href: "/desk", cta: t("Ouvrir Mon poste"), done: false, optional: true,
        };
    }
  }

  const MGMT_SCENARIOS = [
    { id: "campaign", emoji: "🚀", title: t("Lancer ma 1ère campagne"), subtitle: t("Création de campagne → agents → contacts → script → numéro → live."), steps: ["campaign", "agent", "contacts", "scripts", "number", "live"] as StepKey[] },
    { id: "agents", emoji: "🤖", title: t("Création d'un agent IA"), subtitle: t("Je pars de l'agent : agent → contacts → script → numéro → campagne → live."), steps: ["agent", "contacts", "scripts", "number", "campaign", "live"] as StepKey[] },
    { id: "import", emoji: "📇", title: t("Importer un fichier de leads et l'attaquer"), subtitle: t("Je pars des contacts : j'ai déjà une liste à appeler aujourd'hui."), steps: ["contacts", "agent", "scripts", "number", "campaign", "live"] as StepKey[] },
    { id: "callback", emoji: "🔁", title: t("Relancer mes non-décrochés"), subtitle: t("Cibler les contacts non joints d'une campagne précédente."), steps: ["campaigns_list", "agent", "schedule", "live"] as StepKey[] },
    { id: "reminder", emoji: "📅", title: t("Confirmer des RDV (rappels)"), subtitle: t("Appels courts de confirmation depuis votre table de RDV."), steps: ["contacts", "agent", "scripts", "number", "campaign", "live"] as StepKey[] },
    { id: "schedule", emoji: "🕒", title: t("Programmer une campagne pour plus tard"), subtitle: t("Préparer maintenant, lancer aux créneaux autorisés."), steps: ["agent", "contacts", "scripts", "number", "campaign", "schedule"] as StepKey[] },
    { id: "clone", emoji: "🔄", title: t("Cloner une campagne qui marche"), subtitle: t("Repartir d'une campagne existante et changer la cible/agent."), steps: ["campaigns_list", "contacts", "campaign", "live"] as StepKey[] },
    { id: "ab", emoji: "🧪", title: t("A/B tester deux agents"), subtitle: t("Comparer deux scripts/voix sur la même cible."), steps: ["agent", "scripts", "contacts", "campaign", "monitor"] as StepKey[] },
    { id: "inbound", emoji: "📞", title: t("Recevoir des appels entrants"), subtitle: t("Numéro entrant + flow IVR + transfert vers un humain."), steps: ["number", "agent", "ivr", "transfer", "live"] as StepKey[] },
    { id: "overflow", emoji: "🌙", title: t("Permanence hors-heures / débordement"), subtitle: t("L'IA prend le relais quand l'équipe humaine n'est pas là."), steps: ["number", "agent", "ivr", "transfer", "monitor"] as StepKey[] },
    { id: "monitor", emoji: "📊", title: t("Suivre la performance de mon équipe"), subtitle: t("Aucune création — pilotage et reporting depuis le tableau de bord."), steps: ["monitor", "live"] as StepKey[] },
    { id: "test", emoji: "🛠", title: t("Tester sans dépenser un appel"), subtitle: t("Conception et simulation seulement — aucun appel réel."), steps: ["agent", "scripts", "simulation"] as StepKey[] },
  ];

  const AGENT_SCENARIOS = [
    { id: "first_day", emoji: "🎧", title: t("Mon premier jour"), subtitle: t("Découvre l'interface, prends un appel, qualifie-le, programme un rappel."), steps: ["desk_discover", "desk_claim", "desk_dial", "desk_qualify", "desk_callback"] as StepKey[] },
    { id: "take_call", emoji: "📞", title: t("Prendre un appel maintenant"), subtitle: t("Le plus court chemin du pool partagé jusqu'à la qualification."), steps: ["desk_claim", "desk_dial", "desk_qualify"] as StepKey[] },
    { id: "qualify", emoji: "📝", title: t("Bien qualifier les appels"), subtitle: t("Comprendre quand utiliser quelle qualification, et programmer les rappels."), steps: ["desk_qualify", "desk_callback"] as StepKey[] },
  ];

  const VIEWER_SCENARIOS = [
    { id: "explore", emoji: "📊", title: t("Parcourir le tableau de bord"), subtitle: t("KPIs, qualifications, coût, performance — vue d'ensemble."), steps: ["monitor"] as StepKey[] },
  ];

  const SCENARIOS = role === "agent" ? AGENT_SCENARIOS : role === "viewer" ? VIEWER_SCENARIOS : MGMT_SCENARIOS;
  const scenario = SCENARIOS.find((s) => s.id === selectedId) ?? SCENARIOS[0];
  const steps = scenario?.steps.map((key, i) => ({ n: i + 1, key, ...stepFor(key) })) ?? [];

  const requiredDone = steps.filter((s) => !s.optional && s.done).length;
  const requiredTotal = steps.filter((s) => !s.optional).length;
  const pct = requiredTotal === 0 ? 0 : Math.round((requiredDone / requiredTotal) * 100);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{t("Démarrage guidé")}</h1>
          <div className="subtitle">
            {t("Choisissez votre scénario : Axon vous déroule les étapes dans le bon ordre.")}
          </div>
        </div>
        <HelpButton contextKey="start" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 18 }}>
        {SCENARIOS.map((s) => {
          const active = s.id === scenario?.id;
          return (
            <Link key={s.id} href={`/start?scenario=${s.id}`} className="card" style={{ textDecoration: "none", cursor: "pointer", padding: 14, borderColor: active ? "var(--accent)" : undefined, borderWidth: active ? 2 : 1, background: active ? "color-mix(in srgb, var(--accent) 8%, var(--panel))" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{s.emoji}</span>
                <strong style={{ color: "var(--text)" }}>{s.title}</strong>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{s.subtitle}</div>
            </Link>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>{scenario?.title}</strong> · {requiredDone}/{requiredTotal} {t("étapes terminées")}
            </div>
            <div style={{ height: 10, background: "var(--bg-2)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .3s" }} />
            </div>
          </div>
          <strong>{pct}%</strong>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {steps.map((s) => (
          <div key={s.key} className="card" style={{ display: "flex", alignItems: "center", gap: 16, opacity: s.done ? 0.7 : 1 }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, background: s.done ? "var(--good,#16a34a)" : "var(--bg-2)", color: s.done ? "#fff" : "var(--text)", border: s.done ? "none" : "1px solid var(--border)" }}>
              {s.done ? "✓" : s.n}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong>{s.title}</strong>
                {s.optional && <span className="tag" style={{ fontSize: 10 }}>{t("optionnel")}</span>}
                {s.done && <span className="tag good" style={{ fontSize: 10 }}>{t("fait")}</span>}
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

// Pre-defined campaign templates. The user picks one on /campaigns/new and the
// wizard opens pre-filled with that template's defaults. The "advanced" card
// bypasses templates and opens the wizard with neutral defaults.
//
// Day numbers follow the wizard's existing convention: 0=Dim, 1=Lun, …, 6=Sam.

export type CampaignTemplateDefaults = {
  maxConcurrency: number;
  maxAttempts: number;
  retryDelayMin: number;
  amdEnabled: boolean;
  days: number[];
  timezone: string;
  hourStart: string; // HH:MM in `timezone`
  hourEnd: string;
};

export type CampaignTemplate = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  defaults: CampaignTemplateDefaults;
};

const TZ_DEFAULT = "Indian/Mauritius";

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "prospection",
    emoji: "📞",
    title: "Prospection / Vente sortante",
    subtitle: "Acquérir de nouveaux clients ou leads.",
    defaults: {
      maxConcurrency: 10, maxAttempts: 4, retryDelayMin: 60, amdEnabled: true,
      days: [1, 2, 3, 4, 5], timezone: TZ_DEFAULT, hourStart: "10:00", hourEnd: "19:00",
    },
  },
  {
    id: "rdv_confirm",
    emoji: "📅",
    title: "Confirmation de RDV",
    subtitle: "Rappels patients/clients (la veille et le jour-même).",
    defaults: {
      maxConcurrency: 5, maxAttempts: 2, retryDelayMin: 24 * 60, amdEnabled: true,
      days: [1, 2, 3, 4, 5, 6], timezone: TZ_DEFAULT, hourStart: "08:00", hourEnd: "19:00",
    },
  },
  {
    id: "relance",
    emoji: "🔁",
    title: "Relance non-décrochés",
    subtitle: "Recibler une campagne précédente.",
    defaults: {
      maxConcurrency: 8, maxAttempts: 3, retryDelayMin: 240, amdEnabled: true,
      days: [1, 2, 3, 4, 5], timezone: TZ_DEFAULT, hourStart: "11:00", hourEnd: "19:00",
    },
  },
  {
    id: "recouvrement",
    emoji: "💰",
    title: "Recouvrement",
    subtitle: "Relancer les impayés avec tact.",
    defaults: {
      maxConcurrency: 3, maxAttempts: 3, retryDelayMin: 240, amdEnabled: true,
      days: [1, 2, 3, 4, 5], timezone: TZ_DEFAULT, hourStart: "09:00", hourEnd: "18:00",
    },
  },
  {
    id: "enquete",
    emoji: "📋",
    title: "Enquête / NPS",
    subtitle: "Mesurer la satisfaction de vos clients.",
    defaults: {
      maxConcurrency: 5, maxAttempts: 1, retryDelayMin: 60, amdEnabled: true,
      days: [1, 2, 3, 4, 5, 6], timezone: TZ_DEFAULT, hourStart: "10:00", hourEnd: "19:00",
    },
  },
  {
    id: "notification",
    emoji: "🔔",
    title: "Notification de masse",
    subtitle: "Information massive et courte.",
    defaults: {
      maxConcurrency: 20, maxAttempts: 1, retryDelayMin: 60, amdEnabled: true,
      days: [1, 2, 3, 4, 5], timezone: TZ_DEFAULT, hourStart: "10:00", hourEnd: "18:00",
    },
  },
  {
    id: "inbound",
    emoji: "🌙",
    title: "Permanence entrante",
    subtitle: "Recevoir des appels (l'IA ne passe pas d'appels).",
    defaults: {
      maxConcurrency: 10, maxAttempts: 1, retryDelayMin: 60, amdEnabled: false,
      days: [0, 1, 2, 3, 4, 5, 6], timezone: TZ_DEFAULT, hourStart: "00:00", hourEnd: "23:59",
    },
  },
];

export const ADVANCED_CARD = {
  id: "advanced",
  emoji: "⚙️",
  title: "Avancé (sur-mesure)",
  subtitle: "Tout maîtriser : configuration manuelle, complète.",
};

export function getTemplate(id: string | undefined | null): CampaignTemplate | null {
  if (!id) return null;
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}

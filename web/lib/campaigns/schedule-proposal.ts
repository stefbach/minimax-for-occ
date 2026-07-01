/**
 * Schedule proposal — the structured "Quand ?" payload the campaign
 * scheduling chatbot emits via its `propose_schedule` tool, plus the pure
 * validation/normalization used by BOTH the API route (server-side, inside
 * the tool's execute) and the wizard panel (client-side, when applying a
 * proposal to the live form state).
 *
 * Keeping this in one place means the agent and the UI agree on exactly which
 * timezones are allowed, how HH:MM is validated, and how relance spacing maps
 * onto the dynamic engine's phases.
 */
import { z } from "zod";

// Mirror of the timezone ids offered by the manual wizard dropdown
// (CampaignWizard.tsx TIMEZONE_GROUPS). The agent MUST pick one of these so
// the local→UTC conversion and the recap label keep working. Kept as a flat
// allow-list here; the grouped/labelled version stays in the wizard for the
// manual editor.
export const ALLOWED_TZ_IDS = [
  // Afrique & Océan Indien
  "Indian/Mauritius", "Indian/Reunion", "Indian/Mayotte", "Indian/Antananarivo",
  "Africa/Casablanca", "Africa/Tunis", "Africa/Algiers", "Africa/Cairo",
  "Africa/Dakar", "Africa/Abidjan", "Africa/Lagos", "Africa/Johannesburg",
  "Africa/Nairobi",
  // Europe
  "Europe/Paris", "Europe/Brussels", "Europe/Luxembourg", "Europe/Zurich",
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Madrid",
  "Europe/Berlin", "Europe/Amsterdam", "Europe/Rome", "Europe/Vienna",
  "Europe/Warsaw", "Europe/Stockholm", "Europe/Helsinki", "Europe/Athens",
  "Europe/Istanbul", "Europe/Moscow",
  // Amériques
  "America/St_Johns", "America/Halifax", "America/Toronto", "America/New_York",
  "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Mexico_City",
  "America/Bogota", "America/Lima", "America/Caracas", "America/Santiago",
  "America/Argentina/Buenos_Aires", "America/Sao_Paulo",
  // Asie & Moyen-Orient
  "Asia/Jerusalem", "Asia/Beirut", "Asia/Riyadh", "Asia/Dubai", "Asia/Tehran",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok",
  "Asia/Ho_Chi_Minh", "Asia/Jakarta", "Asia/Singapore", "Asia/Hong_Kong",
  "Asia/Shanghai", "Asia/Manila", "Asia/Taipei", "Asia/Seoul", "Asia/Tokyo",
  // Océanie
  "Australia/Perth", "Australia/Adelaide", "Australia/Sydney", "Pacific/Noumea",
  "Pacific/Auckland", "Pacific/Tahiti",
  // Référence
  "UTC",
] as const;

const ALLOWED_TZ_SET = new Set<string>(ALLOWED_TZ_IDS);

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = z.string().regex(HHMM_RE, "heure attendue au format HH:MM (24h)");

/**
 * Raw shape accepted from the model. Everything beyond days/timezone/hours is
 * optional — the agent only fills what the operator actually asked for, and
 * the relance/volume/status fields are ignored in static (one-shot) mode.
 */
export const scheduleProposalSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).min(1)
    .describe("Jours autorisés : 0=Dimanche, 1=Lundi … 6=Samedi."),
  timezone: z.string()
    .describe("Identifiant IANA du fuseau, ex. 'Indian/Mauritius', 'Europe/London'."),
  hour_ranges: z.array(z.object({ start: hhmm, end: hhmm })).min(1)
    .describe("Plages horaires en heure LOCALE du fuseau, ex. [{start:'09:00',end:'12:00'}]."),
  max_concurrency: z.number().int().min(1).max(50).optional()
    .describe("Appels simultanés max (avancé)."),
  max_attempts: z.number().int().min(1).max(10).optional()
    .describe("Tentatives max par numéro injoignable (avancé)."),
  retry_delay_min: z.number().int().min(1).max(1440).optional()
    .describe("Délai en minutes avant de re-tenter un numéro (avancé)."),
  // ── Dynamique uniquement (campagne continue tirée d'une table) ──
  include_statuses: z.array(z.string()).optional()
    .describe("DYNAMIQUE only — statuts ciblés à appeler (ex. ['NOUVEAU','RAPPEL'])."),
  max_new_per_day: z.number().int().min(1).optional()
    .describe("DYNAMIQUE only — plafond de nouveaux contacts par créneau/jour."),
  wave_size: z.number().int().min(1).optional()
    .describe("DYNAMIQUE only — taille d'une wave d'appels."),
  relance_days_after_first: z.array(z.number().int().min(0)).max(10).optional()
    .describe("DYNAMIQUE only — délais cumulatifs (jours ouvrés) pour chaque phase. Toujours commencer par 0 (J1 démarre immédiatement). Ex: [0,2,4] = J1 immédiat, J3 après 2j ouvrés, J5 après 2j de plus. Pour J1/J3/J5 envoyer 3 valeurs."),
});

export type ScheduleProposal = z.infer<typeof scheduleProposalSchema>;

export interface NormalizedSchedule {
  days: number[];
  timezone: string;
  hour_ranges: { start: string; end: string }[];
  max_concurrency?: number;
  max_attempts?: number;
  retry_delay_min?: number;
  include_statuses?: string[];
  max_new_per_day?: number;
  wave_size?: number;
  /** Cumulative day markers (e.g. [1,3,5]) → cadence phase spacing. */
  relance_days_after_first?: number[];
}

export type NormalizeResult =
  | { ok: true; value: NormalizedSchedule }
  | { ok: false; error: string };

/**
 * Validate + tidy a raw proposal. Pure: no I/O, safe on both server & client.
 *  - timezone must be in the allow-list
 *  - days deduped + sorted
 *  - each range must have start < end
 *  - relance markers deduped + sorted ascending
 */
export function normalizeProposal(raw: unknown): NormalizeResult {
  const parsed = scheduleProposalSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first ? `${first.path.join(".")}: ${first.message}` : "proposition invalide" };
  }
  const p = parsed.data;

  if (!ALLOWED_TZ_SET.has(p.timezone)) {
    return { ok: false, error: `fuseau non supporté: ${p.timezone}` };
  }

  const days = Array.from(new Set(p.days)).sort((a, b) => a - b);

  for (const r of p.hour_ranges) {
    if (r.start >= r.end) {
      return { ok: false, error: `plage invalide ${r.start}–${r.end} (le début doit précéder la fin)` };
    }
  }

  const relance = p.relance_days_after_first
    ? Array.from(new Set(p.relance_days_after_first)).sort((a, b) => a - b)
    : undefined;

  return {
    ok: true,
    value: {
      days,
      timezone: p.timezone,
      hour_ranges: p.hour_ranges,
      max_concurrency: p.max_concurrency,
      max_attempts: p.max_attempts,
      retry_delay_min: p.retry_delay_min,
      include_statuses: p.include_statuses,
      max_new_per_day: p.max_new_per_day,
      wave_size: p.wave_size,
      relance_days_after_first: relance,
    },
  };
}

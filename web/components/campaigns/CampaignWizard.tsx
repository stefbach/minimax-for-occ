"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export interface AgentHandleOption {
  id: string;
  display_name: string;
  llm_model: string | null;
  tts_voice_id: string | null;
}

export interface PhoneNumberOption {
  id: string;
  e164: string;
  label: string | null;
  active: boolean;
}

export interface ContactOption {
  id: string;
  e164: string;
  display_name: string | null;
}

export interface ScriptOption {
  id: string;
  name: string;
  mission: string | null;
  description: string | null;
}

export interface TeamOption {
  id: string;
  name: string;
  description: string | null;
  /** The agent_handle id of the team's lead — auto-selected when the user
   *  picks a team, so they don't also need to pick an answering agent. */
  lead_agent_handle_id: string | null;
  member_count: number;
}

export interface ContactListOption {
  id: string;
  name: string;
  description: string | null;
  contact_count: number;
}

export interface DataTableOption {
  id: string;
  label: string;
  physical_table: string;
  row_count: number;
}

interface Target {
  e164: string;
  name: string | null;
}

const DAYS = [
  { id: 1, label: "Lun" },
  { id: 2, label: "Mar" },
  { id: 3, label: "Mer" },
  { id: 4, label: "Jeu" },
  { id: 5, label: "Ven" },
  { id: 6, label: "Sam" },
  { id: 0, label: "Dim" },
];

const STORAGE_KEY = "axon.campaign.wizard.draft";

// Timezone-aware schedule: the dialer compares with UTC, but users think in
// local time. The wizard lets them pick a timezone, enter HH:MM in that local
// time, and converts to UTC on submit. Grouped by region for fast lookup.
type TimezoneItem = { id: string; label: string };
const TIMEZONE_GROUPS: { group: string; items: TimezoneItem[] }[] = [
  {
    group: "Afrique & Océan Indien",
    items: [
      { id: "Indian/Mauritius",    label: "Maurice (UTC+4)" },
      { id: "Indian/Reunion",      label: "La Réunion (UTC+4)" },
      { id: "Indian/Mayotte",      label: "Mayotte (UTC+3)" },
      { id: "Indian/Antananarivo", label: "Madagascar (UTC+3)" },
      { id: "Africa/Casablanca",   label: "Maroc (UTC+1)" },
      { id: "Africa/Tunis",        label: "Tunisie (UTC+1)" },
      { id: "Africa/Algiers",      label: "Algérie (UTC+1)" },
      { id: "Africa/Cairo",        label: "Égypte (UTC+2)" },
      { id: "Africa/Dakar",        label: "Sénégal (UTC+0)" },
      { id: "Africa/Abidjan",      label: "Côte d'Ivoire (UTC+0)" },
      { id: "Africa/Lagos",        label: "Nigéria (UTC+1)" },
      { id: "Africa/Johannesburg", label: "Afrique du Sud (UTC+2)" },
      { id: "Africa/Nairobi",      label: "Kenya (UTC+3)" },
    ],
  },
  {
    group: "Europe",
    items: [
      { id: "Europe/Paris",     label: "France (UTC+1/+2)" },
      { id: "Europe/Brussels",  label: "Belgique (UTC+1/+2)" },
      { id: "Europe/Luxembourg",label: "Luxembourg (UTC+1/+2)" },
      { id: "Europe/Zurich",    label: "Suisse (UTC+1/+2)" },
      { id: "Europe/London",    label: "Royaume-Uni (UTC+0/+1)" },
      { id: "Europe/Dublin",    label: "Irlande (UTC+0/+1)" },
      { id: "Europe/Lisbon",    label: "Portugal (UTC+0/+1)" },
      { id: "Europe/Madrid",    label: "Espagne (UTC+1/+2)" },
      { id: "Europe/Berlin",    label: "Allemagne (UTC+1/+2)" },
      { id: "Europe/Amsterdam", label: "Pays-Bas (UTC+1/+2)" },
      { id: "Europe/Rome",      label: "Italie (UTC+1/+2)" },
      { id: "Europe/Vienna",    label: "Autriche (UTC+1/+2)" },
      { id: "Europe/Warsaw",    label: "Pologne (UTC+1/+2)" },
      { id: "Europe/Stockholm", label: "Suède (UTC+1/+2)" },
      { id: "Europe/Helsinki",  label: "Finlande (UTC+2/+3)" },
      { id: "Europe/Athens",    label: "Grèce (UTC+2/+3)" },
      { id: "Europe/Istanbul",  label: "Turquie (UTC+3)" },
      { id: "Europe/Moscow",    label: "Russie — Moscou (UTC+3)" },
    ],
  },
  {
    group: "Amériques",
    items: [
      { id: "America/St_Johns",      label: "Terre-Neuve (UTC-3:30/-2:30)" },
      { id: "America/Halifax",       label: "Halifax (UTC-4/-3)" },
      { id: "America/Toronto",       label: "Toronto / Montréal (UTC-5/-4)" },
      { id: "America/New_York",      label: "New York (UTC-5/-4)" },
      { id: "America/Chicago",       label: "Chicago (UTC-6/-5)" },
      { id: "America/Denver",        label: "Denver (UTC-7/-6)" },
      { id: "America/Phoenix",       label: "Phoenix (UTC-7)" },
      { id: "America/Los_Angeles",   label: "Los Angeles (UTC-8/-7)" },
      { id: "America/Anchorage",     label: "Alaska (UTC-9/-8)" },
      { id: "Pacific/Honolulu",      label: "Hawaï (UTC-10)" },
      { id: "America/Mexico_City",   label: "Mexique (UTC-6/-5)" },
      { id: "America/Bogota",        label: "Colombie (UTC-5)" },
      { id: "America/Lima",          label: "Pérou (UTC-5)" },
      { id: "America/Caracas",       label: "Venezuela (UTC-4)" },
      { id: "America/Santiago",      label: "Chili (UTC-4/-3)" },
      { id: "America/Argentina/Buenos_Aires", label: "Argentine (UTC-3)" },
      { id: "America/Sao_Paulo",     label: "Brésil — São Paulo (UTC-3)" },
    ],
  },
  {
    group: "Asie & Moyen-Orient",
    items: [
      { id: "Asia/Jerusalem",  label: "Israël (UTC+2/+3)" },
      { id: "Asia/Beirut",     label: "Liban (UTC+2/+3)" },
      { id: "Asia/Riyadh",     label: "Arabie Saoudite (UTC+3)" },
      { id: "Asia/Dubai",      label: "Dubaï / Émirats (UTC+4)" },
      { id: "Asia/Tehran",     label: "Iran (UTC+3:30)" },
      { id: "Asia/Karachi",    label: "Pakistan (UTC+5)" },
      { id: "Asia/Kolkata",    label: "Inde (UTC+5:30)" },
      { id: "Asia/Dhaka",      label: "Bangladesh (UTC+6)" },
      { id: "Asia/Bangkok",    label: "Thaïlande (UTC+7)" },
      { id: "Asia/Ho_Chi_Minh",label: "Vietnam (UTC+7)" },
      { id: "Asia/Jakarta",    label: "Indonésie — Jakarta (UTC+7)" },
      { id: "Asia/Singapore",  label: "Singapour (UTC+8)" },
      { id: "Asia/Hong_Kong",  label: "Hong Kong (UTC+8)" },
      { id: "Asia/Shanghai",   label: "Chine (UTC+8)" },
      { id: "Asia/Manila",     label: "Philippines (UTC+8)" },
      { id: "Asia/Taipei",     label: "Taïwan (UTC+8)" },
      { id: "Asia/Seoul",      label: "Corée du Sud (UTC+9)" },
      { id: "Asia/Tokyo",      label: "Japon (UTC+9)" },
    ],
  },
  {
    group: "Océanie",
    items: [
      { id: "Australia/Perth",   label: "Perth (UTC+8)" },
      { id: "Australia/Adelaide",label: "Adélaïde (UTC+9:30/+10:30)" },
      { id: "Australia/Sydney",  label: "Sydney / Melbourne (UTC+10/+11)" },
      { id: "Pacific/Noumea",    label: "Nouvelle-Calédonie (UTC+11)" },
      { id: "Pacific/Auckland",  label: "Nouvelle-Zélande (UTC+12/+13)" },
      { id: "Pacific/Tahiti",    label: "Tahiti (UTC-10)" },
    ],
  },
  {
    group: "Référence",
    items: [
      { id: "UTC", label: "UTC (aucune conversion)" },
    ],
  },
];

// Flat lookup: id -> label, for showing the chosen TZ in the recap.
const TZ_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  TIMEZONE_GROUPS.flatMap((g) => g.items.map((t) => [t.id, t.label] as const)),
);

// Offset in minutes from UTC for `tz` at `date`. Positive = east of UTC.
// Handles DST automatically thanks to Intl.DateTimeFormat.
function tzOffsetMinutes(tz: string, date: Date = new Date()): number {
  if (tz === "UTC") return 0;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return Math.round((asIfUtc - date.getTime()) / 60000);
}

// Convert HH:MM in `tz` → HH:MM UTC.
function localToUtc(localTime: string, tz: string): string {
  const offset = tzOffsetMinutes(tz);
  const [h, m] = (localTime || "00:00").split(":").map((x) => Number(x) || 0);
  let utcMin = h * 60 + m - offset;
  utcMin = ((utcMin % 1440) + 1440) % 1440;
  return `${String(Math.floor(utcMin / 60)).padStart(2, "0")}:${String(utcMin % 60).padStart(2, "0")}`;
}

function parseCsv(text: string): Target[] {
  const out: Target[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Skip a header row if it obviously is one.
    if (/^e?\.?164.*,/i.test(line) || /phone.*,/i.test(line)) continue;
    const parts = line.split(",").map((s) => s.trim());
    const e164 = parts[0];
    const name = parts[1] || null;
    if (!e164) continue;
    if (!/^\+?[0-9]{6,}$/.test(e164.replace(/\s+/g, ""))) continue;
    const normalized = e164.startsWith("+") ? e164 : `+${e164}`;
    out.push({ e164: normalized.replace(/\s+/g, ""), name });
  }
  return out;
}

export function CampaignWizard({
  agents,
  numbers,
  contacts,
  scripts = [],
  teams = [],
  contactLists = [],
  dataTables = [],
}: {
  agents: AgentHandleOption[];
  numbers: PhoneNumberOption[];
  contacts: ContactOption[];
  scripts?: ScriptOption[];
  teams?: TeamOption[];
  contactLists?: ContactListOption[];
  dataTables?: DataTableOption[];
}) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // The user picks EITHER a Team (multi-agent journey, auto-resolves to
  // the lead's handle) OR a single Agent handle. Team takes precedence.
  const [teamId, setTeamId] = useState("");
  const selectedTeam = useMemo(() => teams.find((t) => t.id === teamId) ?? null, [teams, teamId]);
  const [agentHandleId, setAgentHandleId] = useState(agents[0]?.id ?? "");
  const effectiveHandleId = selectedTeam?.lead_agent_handle_id ?? agentHandleId;
  const [scriptId, setScriptId] = useState("");
  // Source for the campaign's targets: a data table (preferred — real table
  // like leads_rdv), or fall back to the legacy CSV paste / contact picker.
  const [contactListId, setContactListId] = useState("");
  const [dataTableId, setDataTableId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState(numbers[0]?.id ?? "");
  const [callerIdOverride, setCallerIdOverride] = useState("");
  const [csvText, setCsvText] = useState("");
  const [pickedContactIds, setPickedContactIds] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState("");
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [retryDelayMin, setRetryDelayMin] = useState(60);
  const [amdEnabled, setAmdEnabled] = useState(true);
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  // Timezone in which hourStart/hourEnd are expressed. Default = Mauritius
  // (OCC's market); the wizard converts to UTC before sending to the API.
  const [timezone, setTimezone] = useState("Indian/Mauritius");
  const [hourStart, setHourStart] = useState("09:00");
  const [hourEnd, setHourEnd] = useState("18:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAgent = agents.find((a) => a.id === agentHandleId) ?? null;
  const selectedNumber = numbers.find((n) => n.id === phoneNumberId) ?? null;

  const csvTargets = useMemo(() => parseCsv(csvText), [csvText]);
  const pickedContacts = useMemo(
    () =>
      contacts
        .filter((c) => pickedContactIds.has(c.id))
        .map((c) => ({ e164: c.e164, name: c.display_name })),
    [contacts, pickedContactIds],
  );

  const targets: Target[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Target[] = [];
    for (const t of [...csvTargets, ...pickedContacts]) {
      if (seen.has(t.e164)) continue;
      seen.add(t.e164);
      out.push(t);
    }
    return out;
  }, [csvTargets, pickedContacts]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts.slice(0, 50);
    return contacts
      .filter(
        (c) =>
          c.e164.toLowerCase().includes(q) ||
          (c.display_name ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [contacts, contactSearch]);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  function togglePicked(id: string) {
    setPickedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function persistDraft() {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ name, description, targets }),
      );
    } catch {
      /* ignore quota */
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Le nom est requis.");
      return;
    }
    if (!effectiveHandleId) {
      setError(
        selectedTeam
          ? "Cette team n'a pas d'agent lead actif. Définissez un lead dans Teams IA."
          : "Sélectionnez un agent IA (ou une team).",
      );
      return;
    }
    if (!phoneNumberId && !callerIdOverride) {
      setError("Choisissez un numéro émetteur ou un caller-id.");
      return;
    }
    setSubmitting(true);
    persistDraft();

    // Convert hours from the user-chosen timezone to UTC before sending —
    // the dialer compares with UTC time when deciding which campaigns to run.
    const schedule = {
      days,
      hours: {
        start: localToUtc(hourStart, timezone),
        end: localToUtc(hourEnd, timezone),
      },
    };
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          agent_handle_id: effectiveHandleId,
          agent_team_id: teamId || null,
          script_id: scriptId || null,
          contact_list_id: contactListId || null,
          data_table_id: dataTableId || null,
          phone_number_id: phoneNumberId || null,
          caller_id_e164: callerIdOverride.trim() || null,
          schedule,
          max_concurrency: maxConcurrency,
          max_attempts: maxAttempts,
          retry_delay_min: retryDelayMin,
          amd_enabled: amdEnabled,
          targets,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/campaigns/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      {/* 1. Identité */}
      <section className="card">
        <h3>1. Identité</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr" }}>
          <div>
            <label>Nom *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Relance client Q2"
            />
          </div>
          <div>
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objectif de la campagne, message clé…"
            />
          </div>
        </div>
      </section>

      {/* 2. Qui répond ? — binary choice: single agent vs multi-agent journey */}
      <section className="card">
        <h3>2. Qui répond aux appels ?</h3>

        {agents.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Aucun agent IA disponible. Créez-en un depuis la page Agents.
          </p>
        ) : (
          <>
            {/* Mode selector — two clear radio cards. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              <label
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                  padding: 12, borderRadius: 8,
                  border: `1px solid ${!teamId ? "var(--accent)" : "var(--border)"}`,
                  background: !teamId ? "var(--accent-soft)" : "var(--bg-2)",
                }}
              >
                <input
                  type="radio"
                  name="answer_mode"
                  checked={!teamId}
                  onChange={() => setTeamId("")}
                  style={{ width: "auto", marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>Un seul agent</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Le même agent gère tout l&apos;appel du début à la fin.
                  </div>
                </div>
              </label>

              <label
                style={{
                  display: "flex", gap: 10, alignItems: "flex-start",
                  cursor: teams.length > 0 ? "pointer" : "not-allowed",
                  opacity: teams.length > 0 ? 1 : 0.5,
                  padding: 12, borderRadius: 8,
                  border: `1px solid ${teamId ? "var(--accent)" : "var(--border)"}`,
                  background: teamId ? "var(--accent-soft)" : "var(--bg-2)",
                }}
              >
                <input
                  type="radio"
                  name="answer_mode"
                  checked={!!teamId}
                  disabled={teams.length === 0}
                  onChange={() => {
                    const first = teams[0];
                    if (first) {
                      setTeamId(first.id);
                      if (first.lead_agent_handle_id) setAgentHandleId(first.lead_agent_handle_id);
                    }
                  }}
                  style={{ width: "auto", marginTop: 2 }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>Parcours multi-agents</div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Plusieurs agents se passent le relais (ex&nbsp;: Charlotte → Isabelle → Victoria).
                    {teams.length === 0 && " — créez d'abord une Team IA."}
                  </div>
                </div>
              </label>
            </div>

            {/* Single-agent picker */}
            {!teamId && (
              <div>
                <label>Agent</label>
                <select value={agentHandleId} onChange={(e) => setAgentHandleId(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.display_name}</option>
                  ))}
                </select>
                {selectedAgent && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Modèle : <span className="kbd">{selectedAgent.llm_model ?? "—"}</span>
                    {" · "}
                    Voix : <span className="kbd">{selectedAgent.tts_voice_id ?? "—"}</span>
                  </div>
                )}
              </div>
            )}

            {/* Multi-agent (team) picker */}
            {teamId && (
              <div>
                <label>Parcours (Team IA)</label>
                <select
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    const t = teams.find((x) => x.id === e.target.value);
                    if (t?.lead_agent_handle_id) setAgentHandleId(t.lead_agent_handle_id);
                  }}
                >
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.member_count} agent{t.member_count === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
                {selectedTeam && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                    {selectedTeam.lead_agent_handle_id ? (
                      <>
                        ✅ <strong>{agents.find((a) => a.id === selectedTeam.lead_agent_handle_id)?.display_name ?? "Le 1er agent"}</strong> répond
                        à l&apos;appel, puis transfère automatiquement selon{" "}
                        <a href={`/teams/${selectedTeam.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>
                          le parcours défini
                        </a>.
                      </>
                    ) : (
                      <span style={{ color: "#ffb060" }}>
                        ⚠️ Cette team n&apos;a pas d&apos;agent « 1er appel ». Ouvrez{" "}
                        <a href={`/teams/${selectedTeam.id}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-2)" }}>le parcours</a>{" "}
                        pour en définir un.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Script — optional refinement, clearly secondary. */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          <label>Script de conversation (optionnel)</label>
          <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
            <option value="">— Aucun (l&apos;agent suit son prompt) —</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.mission ? ` — ${s.mission}` : ""}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            {scriptId ? (
              <>{scripts.find((s) => s.id === scriptId)?.description ?? "Ce script guide la conversation pour cette campagne."}</>
            ) : (
              <>Laisse vide pour utiliser le comportement par défaut de l&apos;agent. Un script ajoute un objectif précis pour CETTE campagne.</>
            )}
          </div>
        </div>
      </section>

      {/* 3. Numéro émetteur */}
      <section className="card">
        <h3>3. Numéro émetteur</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <div>
            <label>Numéro Twilio</label>
            <select
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            >
              <option value="">— Aucun —</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.e164} {n.label ? `(${n.label})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Ou caller-id (E.164)</label>
            <input
              value={callerIdOverride}
              onChange={(e) => setCallerIdOverride(e.target.value)}
              placeholder="+33123456789"
            />
          </div>
        </div>
        {selectedNumber && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Sera utilisé comme <span className="kbd">From</span> sur les appels Twilio.
          </div>
        )}
      </section>

      {/* 4. Cibles */}
      <section className="card">
        <h3>4. Cibles</h3>
        <div style={{ display: "grid", gap: 12 }}>
          {dataTables.length > 0 && (
            <div style={{ background: "var(--bg-2)", padding: 12, borderRadius: 8 }}>
              <label>Table de contacts (recommandé)</label>
              <select value={dataTableId} onChange={(e) => setDataTableId(e.target.value)}>
                <option value="">— Pas de table (utiliser CSV ci-dessous) —</option>
                {dataTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.physical_table}) · {t.row_count} contact{t.row_count === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {dataTableId
                  ? `La campagne appellera tous les contacts de cette table. Les variables ({{nom}}, {{bmi}}…) viennent de ses colonnes, et l'agent réécrit ses résultats dedans.`
                  : `Choisis la table à appeler. Gère tes tables dans CRM / Contacts.`}
              </div>
            </div>
          )}

          <div>
            <label>Coller un CSV (e164,nom)</label>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              placeholder={"+33612345678,Jean Dupont\n+33687654321,Marie Martin"}
              style={{ minHeight: 120, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
            />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {csvTargets.length} cible{csvTargets.length === 1 ? "" : "s"} valide{csvTargets.length === 1 ? "" : "s"} détectée{csvTargets.length === 1 ? "" : "s"}.
            </div>
          </div>
          <div>
            <label>… ou importer depuis les contacts existants</label>
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Filtrer (nom ou numéro)…"
            />
            <div
              style={{
                marginTop: 8,
                maxHeight: 200,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: 8,
                background: "var(--bg-2)",
              }}
            >
              {filteredContacts.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>Aucun contact</div>
              ) : (
                filteredContacts.map((c) => (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 0",
                      cursor: "pointer",
                      margin: 0,
                      color: "var(--text)",
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ width: "auto" }}
                      checked={pickedContactIds.has(c.id)}
                      onChange={() => togglePicked(c.id)}
                    />
                    <span>
                      {c.display_name ?? c.e164}{" "}
                      <span className="muted" style={{ fontSize: 12 }}>{c.e164}</span>
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
              {pickedContactIds.size} contact{pickedContactIds.size === 1 ? "" : "s"} sélectionné{pickedContactIds.size === 1 ? "" : "s"}.
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            <strong>Total cibles (déduplication par e164) :</strong> {targets.length}
          </div>
        </div>
      </section>

      {/* 5. Planning */}
      <section className="card">
        <h3>5. Planning</h3>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label>Concurrence max</label>
            <input
              type="number"
              min={1}
              max={50}
              value={maxConcurrency}
              onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label>Tentatives max</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label>Délai retry (min)</label>
            <input
              type="number"
              min={1}
              max={1440}
              value={retryDelayMin}
              onChange={(e) => setRetryDelayMin(Number(e.target.value) || 1)}
            />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>
            <input
              type="checkbox"
              checked={amdEnabled}
              onChange={(e) => setAmdEnabled(e.target.checked)}
              style={{ width: "auto", marginRight: 8 }}
            />
            Détection de répondeur (AMD)
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Jours autorisés</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DAYS.map((d) => {
              const active = days.includes(d.id);
              return (
                <button
                  key={d.id}
                  type="button"
                  className={active ? "" : "ghost"}
                  onClick={() => toggleDay(d.id)}
                  style={{ padding: "6px 12px" }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>Fuseau horaire</label>
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {TIMEZONE_GROUPS.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map((tz) => (
                  <option key={tz.id} value={tz.id}>{tz.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <label>Heure début</label>
            <input
              type="time"
              value={hourStart}
              onChange={(e) => setHourStart(e.target.value)}
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              = {localToUtc(hourStart, timezone)} UTC
            </div>
          </div>
          <div>
            <label>Heure fin</label>
            <input type="time" value={hourEnd} onChange={(e) => setHourEnd(e.target.value)} />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              = {localToUtc(hourEnd, timezone)} UTC
            </div>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          ℹ️ Saisis les heures dans le fuseau horaire choisi (heure locale). On les convertit
          en UTC pour le serveur d&apos;appels — l&apos;équivalent UTC est affiché sous chaque champ.
        </div>
      </section>

      {/* 6. Récap */}
      <section className="card">
        <h3>6. Récapitulatif</h3>
        <ul style={{ margin: 0, paddingLeft: 18, color: "var(--muted)", lineHeight: 1.7 }}>
          <li>
            <strong style={{ color: "var(--text)" }}>{name || "(sans nom)"}</strong>
            {description && ` — ${description}`}
          </li>
          <li>Agent : {selectedAgent?.display_name ?? "—"}</li>
          <li>
            Numéro : {selectedNumber?.e164 ?? callerIdOverride ?? "—"}
          </li>
          <li>{targets.length} cible{targets.length === 1 ? "" : "s"}</li>
          <li>
            Concurrence {maxConcurrency} · Retries {maxAttempts} ({retryDelayMin}min) · AMD{" "}
            {amdEnabled ? "on" : "off"}
          </li>
          <li>
            Fenêtre : {days.map((d) => DAYS.find((x) => x.id === d)?.label).join(", ")} · {hourStart}–{hourEnd} ({TZ_LABEL_BY_ID[timezone] ?? timezone}) <span className="muted">→ {localToUtc(hourStart, timezone)}–{localToUtc(hourEnd, timezone)} UTC</span>
          </li>
        </ul>
        {error && (
          <div style={{ color: "var(--bad)", marginTop: 12, fontSize: 14 }}>{error}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={submit} disabled={submitting}>
            {submitting ? "Création…" : "Créer en brouillon"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => router.push("/campaigns")}
            disabled={submitting}
          >
            Annuler
          </button>
        </div>
      </section>
    </div>
  );
}

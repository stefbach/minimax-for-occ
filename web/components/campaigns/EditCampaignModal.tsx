"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

// Full edit modal: lets the user inspect AND tweak every campaign field —
// both the "safe" tweaks (name / days / ranges / concurrency / AMD) and
// the structural config that lives in metadata.engine (agent, phone,
// data table, selection statuses, phase cadence, volume, callback).
// Structural sections are read-only by default with a "Modify" toggle
// that exposes the inputs and shows a warning before the user can save.

interface HourRange { start: string; end: string }
interface Schedule { days?: number[]; hours?: { start?: string; end?: string; ranges?: HourRange[] } }
interface Phase {
  name: string;
  date_column: string;
  attempts_column: string;
  wait_business_days: number;
}
interface PrecallMessage {
  enabled?: boolean;
  lead_minutes?: number;
  sms?: { content_sid?: string | null; from?: string | null } | null;
  whatsapp?: { content_sid?: string | null; from?: string | null } | null;
}

interface EngineConfig {
  slots?: { days?: number[]; hours?: string[]; timezone?: string };
  volume?: { wave_size?: number; max_new_per_day?: number; wave_pause_secs?: number };
  cadence?: {
    enabled?: boolean;
    business_days_only?: boolean;
    max_attempts_per_phase?: number;
    phases?: Phase[];
  };
  callback?: { enabled?: boolean; status_value?: string; datetime_column?: string };
  selection?: {
    status_column?: string;
    include_statuses?: string[];
    phone_starts_with?: string | null;
    phone_min_len?: number | null;
    phone_max_len?: number | null;
  };
}

interface Props {
  campaignId: string;
  initial: {
    name: string;
    description?: string | null;
    schedule: Schedule;
    max_concurrency: number;
    max_attempts: number;
    retry_delay_min: number;
    amd_enabled: boolean;
    agent_handle_id?: string | null;
    agent_team_id?: string | null;
    phone_number_id?: string | null;
    data_table_id?: string | null;
    metadata?: { engine?: EngineConfig; precall_message?: PrecallMessage | null } | null;
  };
  onClose: () => void;
}

const DAYS = [
  { id: 1, label: "Mon" },
  { id: 2, label: "Tue" },
  { id: 3, label: "Wed" },
  { id: 4, label: "Thu" },
  { id: 5, label: "Fri" },
  { id: 6, label: "Sat" },
  { id: 0, label: "Sun" },
];

const KNOWN_STATUSES = [
  // Statuses actively sourced by OCC campaigns (leads à appeler)
  "NOUVEAU DOSSIER", "RAPPEL", "PAS DE REPONSE", "REPONDEUR",
  // Terminaux côté patient
  "RDV CONFIRME", "RDV MEDECIN", "PAS INTERESSE", "FAUX NUMERO",
  "NON ELIGIBLE", "NE PAS RAPPELER", "A PASSER A L'HUMAIN",
  // Statuses techniques (callback engine + handoffs + workflow OCC)
  "CALLBACK_SCHEDULED", "TRANSFERRED_TO_ISABELLE", "FOLLOW UP",
];

interface AgentOpt { id: string; display_name: string; kind: string }
interface NumberOpt { id: string; e164: string; label: string | null }
interface TableOpt { id: string; physical_table: string; label: string }
interface TeamOpt { id: string; name: string }

export function EditCampaignModal({ campaignId, initial, onClose }: Props) {
  const t = useT();
  const router = useRouter();

  // ─── State: simple fields ──────────────────────────────────────────────
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [days, setDays] = useState<number[]>(initial.schedule.days ?? [1, 2, 3, 4, 5]);
  const initialRanges: HourRange[] = (() => {
    const r = initial.schedule.hours?.ranges;
    if (Array.isArray(r) && r.length > 0) return r;
    const s = initial.schedule.hours?.start;
    const e = initial.schedule.hours?.end;
    return [{ start: s ?? "09:00", end: e ?? "18:00" }];
  })();
  const [ranges, setRanges] = useState<HourRange[]>(initialRanges);
  const [maxConcurrency, setMaxConcurrency] = useState(initial.max_concurrency);
  const [maxAttempts, setMaxAttempts] = useState(initial.max_attempts);
  const [retryDelayMin, setRetryDelayMin] = useState(initial.retry_delay_min);
  const [amdEnabled, setAmdEnabled] = useState(initial.amd_enabled);

  // ─── State: structural fields ──────────────────────────────────────────
  const [agentHandleId, setAgentHandleId] = useState(initial.agent_handle_id ?? "");
  const [agentTeamId, setAgentTeamId] = useState(initial.agent_team_id ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(initial.phone_number_id ?? "");
  const [dataTableId, setDataTableId] = useState(initial.data_table_id ?? "");

  const engine0 = initial.metadata?.engine ?? {};
  const [slotsTz, setSlotsTz] = useState(engine0.slots?.timezone ?? "Indian/Mauritius");
  const [slotHours, setSlotHours] = useState<string[]>(engine0.slots?.hours ?? ["09:00"]);
  const [includeStatuses, setIncludeStatuses] = useState<string[]>(
    engine0.selection?.include_statuses ?? ["NOUVEAU DOSSIER"],
  );
  const [phases, setPhases] = useState<Phase[]>(
    engine0.cadence?.phases ?? [
      { name: "J1", date_column: "date_j1", attempts_column: "j1_attempts", wait_business_days: 0 },
      { name: "J3", date_column: "date_j3", attempts_column: "j3_attempts", wait_business_days: 2 },
      { name: "J5", date_column: "date_j5", attempts_column: "j5_attempts", wait_business_days: 4 },
    ],
  );
  const [maxAttemptsPerPhase, setMaxAttemptsPerPhase] = useState(
    engine0.cadence?.max_attempts_per_phase ?? 3,
  );
  const [businessDaysOnly, setBusinessDaysOnly] = useState(
    engine0.cadence?.business_days_only ?? true,
  );
  const [waveSize, setWaveSize] = useState(engine0.volume?.wave_size ?? 200);
  const [maxNewPerDay, setMaxNewPerDay] = useState(engine0.volume?.max_new_per_day ?? 200);
  const [wavePauseSecs, setWavePauseSecs] = useState(engine0.volume?.wave_pause_secs ?? 60);
  const [callbackEnabled, setCallbackEnabled] = useState(engine0.callback?.enabled ?? true);
  const [callbackStatus, setCallbackStatus] = useState(engine0.callback?.status_value ?? "RAPPEL");
  const [callbackCol, setCallbackCol] = useState(engine0.callback?.datetime_column ?? "rappel_rdv");

  const pm0 = initial.metadata?.precall_message ?? {};
  const [precallEnabled, setPrecallEnabled] = useState(pm0.enabled ?? false);
  const [precallLeadMin, setPrecallLeadMin] = useState(pm0.lead_minutes ?? 2);
  const [precallSmsContentSid, setPrecallSmsContentSid] = useState(pm0.sms?.content_sid ?? "");
  const [precallSmsFrom, setPrecallSmsFrom] = useState(pm0.sms?.from ?? "");
  const [precallWaContentSid, setPrecallWaContentSid] = useState(pm0.whatsapp?.content_sid ?? "");

  // ─── State: which structural sections are unlocked for edit ──────────
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});
  const isUnlocked = (k: string) => !!unlocked[k];
  function tryUnlock(k: string, label: string) {
    if (isUnlocked(k)) return;
    const ok = confirm(
      t("Modifier") + ` "${label}" ` + t("sur une campagne active peut perturber le lot en cours (leads en attente, état des phases, etc.). Continuer ?"),
    );
    if (ok) setUnlocked((u) => ({ ...u, [k]: true }));
  }

  // ─── State: dropdown options (loaded async) ──────────────────────────
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [numbers, setNumbers] = useState<NumberOpt[]>([]);
  const [tables, setTables] = useState<TableOpt[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const [aRes, nRes, tRes, teRes] = await Promise.all([
          fetch("/api/agent-handles").then((r) => r.ok ? r.json() : []),
          fetch("/api/numbers").then((r) => r.ok ? r.json() : []),
          fetch("/api/data-tables").then((r) => r.ok ? r.json() : []),
          fetch("/api/teams").then((r) => r.ok ? r.json() : []),
        ]);
        // Each endpoint may return a bare array OR a {items}/{data} wrapper —
        // normalize defensively. Also tolerate `name` vs `display_name` on
        // the handle objects so older deploys still render something.
        const unwrap = (x: unknown): unknown[] =>
          Array.isArray(x) ? x : ((x as { items?: unknown[]; data?: unknown[] })?.items ?? (x as { data?: unknown[] })?.data ?? []);
        const normHandle = (h: Record<string, unknown>): AgentOpt => ({
          id: String(h.id ?? ""),
          display_name: String(h.display_name ?? h.name ?? h.id ?? "(unnamed)"),
          kind: String(h.kind ?? "ai"),
        });
        setAgents(unwrap(aRes).map((x) => normHandle(x as Record<string, unknown>)));
        setNumbers(unwrap(nRes) as NumberOpt[]);
        setTables(unwrap(tRes) as TableOpt[]);
        setTeams(unwrap(teRes) as TeamOpt[]);
      } catch {
        // best-effort: dropdowns just stay empty if fetch fails
      }
    })();
  }, []);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function addRange() {
    setRanges((prev) => [...prev, { start: "14:00", end: "18:00" }]);
  }
  function removeRange(i: number) {
    setRanges((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }
  function updateRange(i: number, patch: Partial<HourRange>) {
    setRanges((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }
  function toggleStatus(s: string) {
    setIncludeStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }
  function updatePhase(i: number, patch: Partial<Phase>) {
    setPhases((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function addSlotHour() {
    setSlotHours((prev) => [...prev, "09:00"]);
  }
  function removeSlotHour(i: number) {
    setSlotHours((prev) => prev.filter((_, j) => j !== i));
  }
  function updateSlotHour(i: number, v: string) {
    setSlotHours((prev) => prev.map((h, j) => (j === i ? v : h)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const utcStarts = ranges.map((r) => r.start).sort();
      const utcEnds = ranges.map((r) => r.end).sort();
      const schedule = {
        days,
        hours: {
          start: utcStarts[0] ?? "09:00",
          end: utcEnds[utcEnds.length - 1] ?? "18:00",
          ranges,
        },
      };

      // Rebuild engine config from current state. We DON'T blow away unknown
      // sub-fields the caller may have set externally — we only overwrite
      // what we manage.
      const engineMerged: EngineConfig = {
        ...(initial.metadata?.engine ?? {}),
        slots: {
          ...(initial.metadata?.engine?.slots ?? {}),
          days, // also mirror campaign days into engine slots
          hours: [...slotHours].sort(),
          timezone: slotsTz,
        },
        volume: {
          ...(initial.metadata?.engine?.volume ?? {}),
          wave_size: waveSize,
          max_new_per_day: maxNewPerDay,
          wave_pause_secs: wavePauseSecs,
        },
        cadence: {
          ...(initial.metadata?.engine?.cadence ?? {}),
          enabled: true,
          business_days_only: businessDaysOnly,
          max_attempts_per_phase: maxAttemptsPerPhase,
          phases,
        },
        callback: {
          ...(initial.metadata?.engine?.callback ?? {}),
          enabled: callbackEnabled,
          status_value: callbackStatus,
          datetime_column: callbackCol,
        },
        selection: {
          ...(initial.metadata?.engine?.selection ?? {}),
          status_column: initial.metadata?.engine?.selection?.status_column ?? "qualification",
          include_statuses: includeStatuses,
        },
      };
      const precallMessage: PrecallMessage = { enabled: precallEnabled, lead_minutes: precallLeadMin };
      if (precallSmsContentSid) precallMessage.sms = { content_sid: precallSmsContentSid, from: precallSmsFrom || null };
      if (precallWaContentSid) precallMessage.whatsapp = { content_sid: precallWaContentSid, from: null };
      const metadata = { ...(initial.metadata ?? {}), engine: engineMerged, precall_message: precallMessage };

      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        schedule,
        max_concurrency: maxConcurrency,
        max_attempts: maxAttempts,
        retry_delay_min: retryDelayMin,
        amd_enabled: amdEnabled,
        metadata,
      };
      if (agentHandleId) payload.agent_handle_id = agentHandleId;
      if (agentTeamId) payload.agent_team_id = agentTeamId;
      if (phoneNumberId) payload.phone_number_id = phoneNumberId;
      // data_table_id is a column we PATCH directly (extends current API).
      if (dataTableId) (payload as Record<string, unknown>).data_table_id = dataTableId;

      const r = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError((j as { error?: string }).error ?? `HTTP ${r.status}`);
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // ─── Render helpers ────────────────────────────────────────────────────
  const lockedNote = (
    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
      🔒 {t("Verrouillé. Cliquez sur")} &ldquo;{t("Modifier")}&rdquo; {t("pour autoriser les modifications.")}
    </div>
  );
  const unlockBtn = (key: string, label: string) => (
    <button
      type="button"
      className="ghost"
      onClick={() => tryUnlock(key, label)}
      style={{ padding: "2px 8px", fontSize: 11 }}
    >
      {t("Modifier")}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        zIndex: 100, padding: 20, overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{ width: "min(760px, 100%)", marginTop: 30, display: "grid", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{t("Modifier la campagne")}</h3>
          <button className="ghost" onClick={onClose} style={{ padding: "2px 8px" }}>×</button>
        </div>

        {/* ─── Identity ──────────────────────────────────────────────── */}
        <section>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Identité")}</h4>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <label style={{ fontSize: 12 }}>{t("Nom")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 12 }}>{t("Description")}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
              />
            </div>
          </div>
        </section>

        {/* ─── Contact source ────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Source de contacts")}</h4>
            {!isUnlocked("data_table") && unlockBtn("data_table", t("Source de contacts"))}
          </div>
          <select
            value={dataTableId}
            onChange={(e) => setDataTableId(e.target.value)}
            disabled={!isUnlocked("data_table")}
            style={{ width: "100%" }}
          >
            <option value="">{t("— Aucune —")}</option>
            {tables.map((tbl) => (
              <option key={tbl.id} value={tbl.id}>
                {tbl.label} ({tbl.physical_table})
              </option>
            ))}
          </select>
          {!isUnlocked("data_table") && lockedNote}
        </section>

        {/* ─── Who calls ─────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Qui appelle")}</h4>
            {!isUnlocked("agent") && unlockBtn("agent", t("Agent / Équipe"))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 12 }}>{t("Agent principal")}</label>
              <select
                value={agentHandleId}
                onChange={(e) => setAgentHandleId(e.target.value)}
                disabled={!isUnlocked("agent")}
                style={{ width: "100%" }}
              >
                <option value="">{t("— Aucun —")}</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.display_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12 }}>{t("Équipe (parcours)")}</label>
              <select
                value={agentTeamId}
                onChange={(e) => setAgentTeamId(e.target.value)}
                disabled={!isUnlocked("agent")}
                style={{ width: "100%" }}
              >
                <option value="">{t("— Aucune —")}</option>
                {teams.map((tm) => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </select>
            </div>
          </div>
          {!isUnlocked("agent") && lockedNote}
        </section>

        {/* ─── Caller ID ─────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Numéro affiché")}</h4>
            {!isUnlocked("phone") && unlockBtn("phone", t("Numéro affiché"))}
          </div>
          <select
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            disabled={!isUnlocked("phone")}
            style={{ width: "100%" }}
          >
            <option value="">{t("— Aucun —")}</option>
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.e164} {n.label ? `(${n.label})` : ""}
              </option>
            ))}
          </select>
          {!isUnlocked("phone") && lockedNote}
        </section>

        {/* ─── When to call ──────────────────────────────────────────── */}
        <section>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Quand appeler")}</h4>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12 }}>{t("Jours autorisés")}</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map((d) => {
                  const active = days.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      className={active ? "" : "ghost"}
                      onClick={() => toggleDay(d.id)}
                      style={{ padding: "5px 11px" }}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={{ fontSize: 12 }}>{t("Plages horaires (interface — UTC)")}</label>
              <div style={{ display: "grid", gap: 6 }}>
                {ranges.map((r, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="time" value={r.start} onChange={(e) => updateRange(i, { start: e.target.value })} style={{ width: "auto" }} />
                    <span className="muted">→</span>
                    <input type="time" value={r.end} onChange={(e) => updateRange(i, { end: e.target.value })} style={{ width: "auto" }} />
                    {ranges.length > 1 && (
                      <button type="button" onClick={() => removeRange(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4, marginLeft: "auto" }}>✕</button>
                    )}
                  </div>
                ))}
                <button type="button" className="ghost" onClick={addRange} style={{ padding: "4px 10px", alignSelf: "flex-start", fontSize: 12 }}>
                  + {t("Ajouter une plage horaire")}
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <label style={{ fontSize: 12 }}>
                  {t("Créneaux moteur (heures réelles d'appel, en")} {slotsTz})
                </label>
                {!isUnlocked("slots") && unlockBtn("slots", t("Créneaux d'appel"))}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {slotHours.map((h, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="time"
                      value={h}
                      onChange={(e) => updateSlotHour(i, e.target.value)}
                      disabled={!isUnlocked("slots")}
                      style={{ width: "auto" }}
                    />
                    {isUnlocked("slots") && slotHours.length > 1 && (
                      <button type="button" onClick={() => removeSlotHour(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>✕</button>
                    )}
                  </div>
                ))}
                {isUnlocked("slots") && (
                  <button type="button" className="ghost" onClick={addSlotHour} style={{ padding: "4px 10px", alignSelf: "flex-start", fontSize: 12 }}>
                    + {t("Ajouter un créneau")}
                  </button>
                )}
              </div>
              {!isUnlocked("slots") && lockedNote}
            </div>

            <div>
              <label style={{ fontSize: 12 }}>{t("Fuseau horaire (moteur)")}</label>
              <input
                value={slotsTz}
                onChange={(e) => setSlotsTz(e.target.value)}
                disabled={!isUnlocked("slots")}
                placeholder="e.g. Indian/Mauritius, Europe/London"
              />
            </div>
          </div>
        </section>

        {/* ─── Target statuses ───────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Statuts ciblés")}</h4>
            {!isUnlocked("statuses") && unlockBtn("statuses", t("Statuts ciblés"))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {KNOWN_STATUSES.map((s) => {
              const active = includeStatuses.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={active ? "" : "ghost"}
                  onClick={() => isUnlocked("statuses") && toggleStatus(s)}
                  disabled={!isUnlocked("statuses")}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {s}
                </button>
              );
            })}
          </div>
          {!isUnlocked("statuses") && lockedNote}
        </section>

        {/* ─── Follow-up phases ──────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Phases de relance")}</h4>
            {!isUnlocked("phases") && unlockBtn("phases", t("Phases de relance"))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 4 }}>{t("Nom")}</th>
                  <th style={{ textAlign: "left", padding: 4 }}>{t("Col. date")}</th>
                  <th style={{ textAlign: "left", padding: 4 }}>{t("Col. tentatives")}</th>
                  <th style={{ textAlign: "left", padding: 4 }}>{t("Attente (jours ouvrés)")}</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p, i) => (
                  <tr key={i}>
                    <td style={{ padding: 4 }}>
                      <input value={p.name} onChange={(e) => updatePhase(i, { name: e.target.value })} disabled={!isUnlocked("phases")} style={{ width: 70 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input value={p.date_column} onChange={(e) => updatePhase(i, { date_column: e.target.value })} disabled={!isUnlocked("phases")} style={{ width: 110 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input value={p.attempts_column} onChange={(e) => updatePhase(i, { attempts_column: e.target.value })} disabled={!isUnlocked("phases")} style={{ width: 120 }} />
                    </td>
                    <td style={{ padding: 4 }}>
                      <input
                        type="number"
                        min={0}
                        value={p.wait_business_days}
                        onChange={(e) => updatePhase(i, { wait_business_days: Number(e.target.value) || 0 })}
                        disabled={!isUnlocked("phases")}
                        style={{ width: 70 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <div>
              <label style={{ fontSize: 12 }}>{t("Max tentatives par phase")}</label>
              <input
                type="number"
                min={1}
                max={10}
                value={maxAttemptsPerPhase}
                onChange={(e) => setMaxAttemptsPerPhase(Number(e.target.value) || 1)}
                disabled={!isUnlocked("phases")}
              />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginTop: 18 }}>
              <input
                type="checkbox"
                checked={businessDaysOnly}
                onChange={(e) => setBusinessDaysOnly(e.target.checked)}
                disabled={!isUnlocked("phases")}
                style={{ width: "auto" }}
              />
              {t("Compter en jours ouvrés")}
            </label>
          </div>
          {!isUnlocked("phases") && lockedNote}
        </section>

        {/* ─── Volume ────────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Volume / Cadence")}</h4>
            {!isUnlocked("volume") && unlockBtn("volume", t("Volume"))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div>
              <label style={{ fontSize: 12 }}>{t("Plafond leads / jour")}</label>
              <input type="number" min={1} value={maxNewPerDay} onChange={(e) => setMaxNewPerDay(Number(e.target.value) || 1)} disabled={!isUnlocked("volume")} />
            </div>
            <div>
              <label style={{ fontSize: 12 }}>{t("Taille de vague")}</label>
              <input type="number" min={1} value={waveSize} onChange={(e) => setWaveSize(Number(e.target.value) || 1)} disabled={!isUnlocked("volume")} />
            </div>
            <div>
              <label style={{ fontSize: 12 }}>{t("Pause / appel (s)")}</label>
              <input type="number" min={0} value={wavePauseSecs} onChange={(e) => setWavePauseSecs(Number(e.target.value) || 0)} disabled={!isUnlocked("volume")} />
            </div>
          </div>
          {!isUnlocked("volume") && lockedNote}
        </section>

        {/* ─── Callbacks ─────────────────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>{t("Rappels programmés")}</h4>
            {!isUnlocked("callback") && unlockBtn("callback", t("Rappels programmés"))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 8, alignItems: "end" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, paddingBottom: 6 }}>
              <input type="checkbox" checked={callbackEnabled} onChange={(e) => setCallbackEnabled(e.target.checked)} disabled={!isUnlocked("callback")} style={{ width: "auto" }} />
              {t("Activé")}
            </label>
            <div>
              <label style={{ fontSize: 12 }}>{t("Statut déclencheur")}</label>
              <input value={callbackStatus} onChange={(e) => setCallbackStatus(e.target.value)} disabled={!isUnlocked("callback")} />
            </div>
            <div>
              <label style={{ fontSize: 12 }}>{t("Colonne datetime")}</label>
              <input value={callbackCol} onChange={(e) => setCallbackCol(e.target.value)} disabled={!isUnlocked("callback")} />
            </div>
          </div>
          {!isUnlocked("callback") && lockedNote}
        </section>

        {/* ─── Pre-call message ─────────────────────────────────────── */}
        <section>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>Pre-call SMS / WhatsApp</h4>
          <div style={{ display: "grid", gap: 10 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={precallEnabled}
                onChange={(e) => setPrecallEnabled(e.target.checked)}
                style={{ width: "auto" }}
              />
              Send a message X minutes before each call
            </label>
            {precallEnabled && (
              <div style={{ display: "grid", gap: 10, paddingLeft: 22 }}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "end" }}>
                  <div>
                    <label style={{ fontSize: 12 }}>Minutes before call</label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={precallLeadMin}
                      onChange={(e) => setPrecallLeadMin(Math.max(1, Math.min(15, Number(e.target.value) || 2)))}
                    />
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>SMS</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 12 }}>Content SID (HX…)</label>
                      <input
                        value={precallSmsContentSid}
                        onChange={(e) => setPrecallSmsContentSid(e.target.value.trim())}
                        placeholder="HX248b9be8…"
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: 12 }}>From number (optional)</label>
                      <input
                        value={precallSmsFrom}
                        onChange={(e) => setPrecallSmsFrom(e.target.value.trim())}
                        placeholder="+447…"
                      />
                    </div>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>WhatsApp (optional)</label>
                  <div>
                    <label style={{ fontSize: 12 }}>Content SID (HX…)</label>
                    <input
                      value={precallWaContentSid}
                      onChange={(e) => setPrecallWaContentSid(e.target.value.trim())}
                      placeholder="HX… (leave empty to use SMS only)"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ─── Advanced ─────────────────────────────────────────────── */}
        <details>
          <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>▸ {t("Réglages avancés")}</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12 }}>{t("Appels simultanés")}</label>
                <input type="number" min={1} max={50} value={maxConcurrency} onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)} />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>{t("Tentatives totales")}</label>
                <input type="number" min={1} max={10} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)} />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>{t("Délai retry (min)")}</label>
                <input type="number" min={1} max={1440} value={retryDelayMin} onChange={(e) => setRetryDelayMin(Number(e.target.value) || 1)} />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={amdEnabled} onChange={(e) => setAmdEnabled(e.target.checked)} style={{ width: "auto" }} />
              {t("Détection répondeur (AMD)")}
            </label>
          </div>
        </details>

        {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>{t("Annuler")}</button>
          <button type="button" onClick={save} disabled={busy || !name.trim() || days.length === 0}>
            {busy ? t("Enregistrement…") : t("Enregistrer")}
          </button>
        </div>
      </div>
    </div>
  );
}

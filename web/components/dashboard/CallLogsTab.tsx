"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { ArrowDownLeft, ArrowUpRight, Download, Eye, Headphones } from "lucide-react";
import { bucketForCall, QUAL_BUCKETS, type QualBucket } from "@/lib/qualification";
import { fixAudioDuration } from "@/lib/fix-audio-duration";
import { matchesGlobalFilters, hasLeadScopedFilters, DEFAULT_GLOBAL_FILTERS, type GlobalFilters } from "@/lib/global-filters";

// Call Logs tab — Twilio-style call history with our specifics on top:
// the AI agent's name, the normalised qualification (9 fixed buckets),
// inline audio playback of the recording, and a duration-filter strip so
// the operator can isolate < 1 min calls (mostly voicemail) from real
// conversations.

interface CallRow {
  id: string;
  direction: "inbound" | "outbound" | string;
  state: string;
  from_e164: string | null;
  to_e164: string | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  disposition: string | null;
  recording_url: string | null;
  transcript_url: string | null;
  cost_cents: number;
  metadata: { qualification?: string | null } | null;
  agent_handles: { display_name: string | null } | null;
  contacts: { display_name: string | null; e164: string | null } | null;
  // Server-side enrichment from leads_rdv by phone (calls.contact_id is
  // empty for outbound Axon calls so contacts.display_name is null).
  lead?: { name: string | null } | null;
}

const STATE_FILTERS: { id: string; label: string }[] = [
  { id: "ended,failed", label: "Terminés" },
  { id: "ended", label: "Réussis" },
  { id: "failed", label: "Échecs" },
  { id: "ringing,ivr,in_progress,wrap_up", label: "En cours" },
];

const ANSWERED_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "yes", label: "Oui" },
  { id: "no", label: "Non" },
];

// Twilio-style cost-buckets so the operator can spot the cheap garbage
// (< 1 min, mostly voicemails / hangups) from the real conversations.
const DURATION_BUCKETS: { id: string; label: string; min: number; max: number }[] = [
  { id: "all", label: "Toutes durées", min: 0, max: Infinity },
  { id: "lt1", label: "< 1 min", min: 0, max: 60 },
  { id: "1-2", label: "1 - 2 min", min: 60, max: 120 },
  { id: "2-5", label: "2 - 5 min", min: 120, max: 300 },
  { id: "5-10", label: "5 - 10 min", min: 300, max: 600 },
  { id: "gt10", label: "> 10 min", min: 600, max: Infinity },
];

const QUAL_TONE: Record<QualBucket, string> = {
  rdv_confirme: "var(--good)",
  passer_humain: "var(--good)",
  rappel: "var(--accent)",
  pas_interesse: "var(--bad)",
  pas_de_reponse: "var(--warn)",
  repondeur: "var(--warn)",
  faux_numero: "var(--bad)",
  non_eligible: "var(--bad)",
  ne_pas_rappeler: "var(--bad)",
  suivi_requis: "var(--warn)",
  autre: "var(--muted)",
};

function fmtDuration(secs: number | null, answered?: boolean): string {
  // When the call was never answered, `duration_secs` is just the ringback
  // time (INVITE → BYE on a non-answered leg) — displaying it next to
  // "Non décroché" is misleading ("0:58 Non décroché" makes it look like
  // there was 58s of conversation). Show ring-time as "ring Ns" instead.
  if (!secs || secs < 0) return "—";
  if (answered === false) {
    return `ring ${secs}s`;
  }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function fmtCeilMinutes(secs: number | null, answered?: boolean): string {
  // Twilio bills per started minute. Display "billed: N min" so the
  // operator sees what's actually charged. Non-answered calls aren't
  // billed for talk-time so we show "—".
  if (!secs || secs <= 0) return "—";
  if (answered === false) return "—";
  const m = Math.ceil(secs / 60);
  return `${m} ${m > 1 ? "min" : "min"}`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  // DD/MM HH:MM 24h — same format as the Twilio console for consistency.
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function fmtCost(cents: number): string {
  if (!cents || cents <= 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}
function counterpartyName(c: CallRow): string {
  // Outbound Axon calls don't populate calls.contact_id, so contacts.display_name
  // is null on every row. The /api/calls endpoint with enrich=lead joins
  // leads_rdv by phone — use that name first, then fall back to contacts.
  return c.lead?.name || c.contacts?.display_name || "Inconnu";
}
function counterpartyNumber(c: CallRow): string | null {
  return (c.direction === "inbound" || c.direction === "in") ? c.from_e164 : c.to_e164;
}

export function CallLogsTab({ from, to, direction, leadsSource = "prod", system = "all", global = DEFAULT_GLOBAL_FILTERS, campaignId }: { from: string; to: string; direction: string; leadsSource?: "prod" | "test"; system?: "all" | "retell" | "axon"; global?: GlobalFilters; campaignId?: string }) {
  const t = useT();
  const [rows, setRows] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<string>("ended,failed");
  const [answeredFilter, setAnsweredFilter] = useState<string>("all");
  const [durationFilter, setDurationFilter] = useState<string>("all");
  // Custom duration range (in minutes, decimals allowed e.g. 0.5 = 30s). Active
  // when durationFilter === "custom"; either bound may be left blank = open.
  const [customMin, setCustomMin] = useState<string>("");
  const [customMax, setCustomMax] = useState<string>("");
  const [qualFilter, setQualFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openPlayer, setOpenPlayer] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // limit=2000 covers a full prospection day (~1500 calls). enrich=lead
      // resolves patient names from leads_rdv by phone — without it every
      // row displays "Inconnu" since calls.contact_id is empty for the
      // outbound Axon pipeline (Wati June 11).
      const qs = new URLSearchParams({ state: stateFilter, limit: "2000", from, to, leads_source: leadsSource, enrich: "lead" });
      if (direction !== "all") qs.set("direction", direction);
      if (system !== "all") qs.set("system", system);
      if (campaignId && campaignId !== "all") qs.set("campaign_id", campaignId);
      const r = await fetch(`/api/calls?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRows(Array.isArray(j) ? j : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch error");
    } finally {
      setLoading(false);
    }
  }, [stateFilter, from, to, direction, leadsSource, system, campaignId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Resolve the active duration window (seconds). Custom range wins; its
    // bounds are inclusive and either side may be open.
    let lo = 0;
    let hi = Infinity;
    if (durationFilter === "custom") {
      lo = customMin.trim() ? Math.max(0, Number(customMin) * 60) : 0;
      hi = customMax.trim() ? Number(customMax) * 60 : Infinity;
    } else {
      const b = DURATION_BUCKETS.find((x) => x.id === durationFilter) ?? DURATION_BUCKETS[0];
      lo = b.min;
      hi = b.max;
    }
    const inclusiveMax = durationFilter === "custom";
    return rows.filter((c) => {
      if (answeredFilter === "yes" && !c.answered_at) return false;
      if (answeredFilter === "no" && c.answered_at) return false;
      const secs = c.duration_secs ?? 0;
      if (secs < lo) return false;
      if (inclusiveMax ? secs > hi : secs >= hi) return false;
      if (qualFilter !== "all") {
        const b = bucketForCall(c);
        if (b !== qualFilter) return false;
      }
      // Global filter bar — combined with the local strip above (logical
      // AND). Source / tentative / éligibilité need the leads table and are
      // only honoured by the server-computed tabs (a note below flags this),
      // so they're stripped before matching here.
      const evaluable = { ...global, attempt: "all" as const, eligibility: "all" as const, sources: [] };
      if (!matchesGlobalFilters(evaluable, {
        durationSecs: c.duration_secs ?? 0,
        bucket: bucketForCall(c),
        agent: c.agent_handles?.display_name ?? null,
        answered: !!c.answered_at,
        attempt: null,
        eligibility: "unknown",
        source: null,
        haystack: `${counterpartyName(c)} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""} ${c.agent_handles?.display_name ?? ""} ${c.disposition ?? ""}`.toLowerCase(),
      })) return false;
      if (!q) return true;
      const haystack = `${counterpartyName(c)} ${c.from_e164 ?? ""} ${c.to_e164 ?? ""} ${c.agent_handles?.display_name ?? ""} ${c.disposition ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, answeredFilter, durationFilter, customMin, customMax, qualFilter, global]);

  // Live summary above the table, recomputed from whatever's currently
  // filtered. Lets the operator answer "how much did the < 1 min bucket
  // cost me this week?" without leaving the page.
  const summary = useMemo(() => {
    let totalSecs = 0;
    let totalCents = 0;
    let answered = 0;
    for (const c of filtered) {
      // Only sum talk-time on calls that were actually answered — for
      // non-answered calls duration_secs is just ringback and rolling it
      // into totalMinutes inflates the "how much did this cost me" view.
      if (c.answered_at) totalSecs += c.duration_secs ?? 0;
      totalCents += c.cost_cents ?? 0;
      if (c.answered_at) answered += 1;
    }
    return {
      count: filtered.length,
      answered,
      totalMinutes: totalSecs / 60,
      totalCost: totalCents / 100,
      avgCost: filtered.length ? totalCents / 100 / filtered.length : 0,
    };
  }, [filtered]);

  return (
    <>
      {hasLeadScopedFilters(global) && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          ⓘ {t("Les filtres Source / Tentative / Éligibilité s'appliquent aux onglets Vue d'ensemble et Statistiques, pas à cette liste.")}
        </p>
      )}
      {/* ─── Filters: state, answered, search ─── */}
      <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 12 }}>
        <div>
          <label>{t("État")}</label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            {STATE_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("Répondu")}</label>
          <select value={answeredFilter} onChange={(e) => setAnsweredFilter(e.target.value)}>
            {ANSWERED_FILTERS.map((s) => (
              <option key={s.id} value={s.id}>{t(s.label)}</option>
            ))}
          </select>
        </div>
        <div>
          <label>{t("Rechercher")}</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Nom, numéro, agent, qualification…")}
          />
        </div>
      </div>

      {/* ─── Duration filter chips + qualification chips ─── */}
      <div className="card" style={{ display: "grid", gap: 8, padding: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Durée")} :</span>
          {DURATION_BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={durationFilter === b.id ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setDurationFilter(b.id)}
            >
              {t(b.label)}
            </button>
          ))}
          {/* Custom min–max range, in minutes (decimals OK: 0.5 = 30s). */}
          <button
            type="button"
            className={durationFilter === "custom" ? "" : "ghost"}
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setDurationFilter("custom")}
            title={t("Plage de durée personnalisée")}
          >
            {t("Perso")}
          </button>
          <span
            style={{
              display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
              opacity: durationFilter === "custom" ? 1 : 0.55,
            }}
          >
            <span className="muted">{t("de")}</span>
            <input
              type="number" min={0} step={0.5} inputMode="decimal"
              value={customMin}
              onChange={(e) => { setCustomMin(e.target.value); setDurationFilter("custom"); }}
              placeholder="0"
              style={{ width: 56, padding: "3px 6px", fontSize: 12 }}
              aria-label={t("Durée minimum (min)")}
            />
            <span className="muted">{t("à")}</span>
            <input
              type="number" min={0} step={0.5} inputMode="decimal"
              value={customMax}
              onChange={(e) => { setCustomMax(e.target.value); setDurationFilter("custom"); }}
              placeholder="∞"
              style={{ width: 56, padding: "3px 6px", fontSize: 12 }}
              aria-label={t("Durée maximum (min)")}
            />
            <span className="muted">{t("min")}</span>
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t("Qualification")} :</span>
          <button
            type="button"
            className={qualFilter === "all" ? "" : "ghost"}
            style={{ padding: "3px 10px", fontSize: 12 }}
            onClick={() => setQualFilter("all")}
          >
            {t("Toutes")}
          </button>
          {QUAL_BUCKETS.filter((b) => b.key !== "autre").map((b) => (
            <button
              key={b.key}
              type="button"
              className={qualFilter === b.key ? "" : "ghost"}
              style={{ padding: "3px 10px", fontSize: 12 }}
              onClick={() => setQualFilter(b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Summary strip ─── */}
      <div className="grid-kpi" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <div className="card" style={{ padding: 12 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Appels affichés")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{summary.count}</div>
          <div className="muted" style={{ fontSize: 11 }}>{summary.answered} {t("décrochés")}</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Minutes totales")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{summary.totalMinutes.toFixed(1)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{(summary.totalMinutes * 60).toFixed(0)}s</div>
        </div>
        <div className="card" style={{ padding: 12, borderColor: summary.totalCost > 0 ? "var(--warn)" : undefined }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Coût total")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: "var(--warn)" }}>${summary.totalCost.toFixed(2)}</div>
          <div className="muted" style={{ fontSize: 11 }}>{t("filtre actif")}</div>
        </div>
        <div className="card" style={{ padding: 12 }}>
          <div className="muted" style={{ fontSize: 11, textTransform: "uppercase" }}>{t("Coût moyen / appel")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>${summary.avgCost.toFixed(2)}</div>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)" }}>{error}</div>
      )}

      {/* ─── Table — Twilio-style with our columns ─── */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <table className="list" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>{t("Heure")}</th>
              <th>{t("Lead")}</th>
              <th>{t("Numéro")}</th>
              <th>{t("Agent")}</th>
              <th>{t("Durée")}</th>
              <th>{t("Facturée")}</th>
              <th>{t("Qualification")}</th>
              <th>{t("Répondu")}</th>
              <th style={{ textAlign: "right" }}>{t("Coût")}</th>
              <th style={{ textAlign: "center" }}>{t("Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="muted" style={{ padding: 16, textAlign: "center" }}>{t("Chargement…")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="muted" style={{ padding: 16, textAlign: "center" }}>
                {t("Aucun appel ne correspond aux filtres.")}
              </td></tr>
            ) : (
              filtered.map((c) => {
                const answered = Boolean(c.answered_at);
                const isOpen = openPlayer === c.id;
                const bucket = bucketForCall(c);
                const bucketLabel = QUAL_BUCKETS.find((b) => b.key === bucket)?.label ?? "—";
                return (
                  <Fragment key={c.id}>
                    <tr>
                      <td className="muted" style={{ whiteSpace: "nowrap", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {fmtDate(c.started_at)}
                      </td>
                      <td>
                        <span style={{ color: (c.direction === "inbound" || c.direction === "in") ? "var(--info)" : "var(--muted)", marginRight: 4 }}>
                          {(c.direction === "inbound" || c.direction === "in") ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                        </span>
                        {counterpartyName(c)}
                      </td>
                      <td className="muted" style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                        {counterpartyNumber(c) ?? "—"}
                      </td>
                      <td className="muted">{c.agent_handles?.display_name ?? "—"}</td>
                      <td>{fmtDuration(c.duration_secs, !!c.answered_at)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{fmtCeilMinutes(c.duration_secs, !!c.answered_at)}</td>
                      <td>
                        {bucket !== "autre" ? (
                          <span
                            className="tag"
                            style={{
                              color: QUAL_TONE[bucket],
                              borderColor: QUAL_TONE[bucket],
                              fontSize: 10,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {bucketLabel}
                          </span>
                        ) : (
                          <span className="muted" style={{ fontSize: 11 }}>—</span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          title={answered ? t("Oui") : t("Non")}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22, height: 22, borderRadius: "50%",
                            background: answered ? "color-mix(in srgb, var(--good) 18%, transparent)" : "color-mix(in srgb, var(--bad) 18%, transparent)",
                            color: answered ? "var(--good)" : "var(--bad)",
                            fontSize: 14, fontWeight: 700,
                          }}
                        >
                          {answered ? "✓" : "✕"}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>
                        {fmtCost(c.cost_cents)}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                          <button
                            type="button"
                            title={c.recording_url ? t("Écouter l'enregistrement") : t("Aucun enregistrement disponible")}
                            disabled={!c.recording_url}
                            onClick={() => setOpenPlayer(isOpen ? null : c.id)}
                            style={{
                              padding: "4px 8px", fontSize: 14,
                              background: isOpen ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent",
                              border: "1px solid var(--border)",
                              borderRadius: 6, cursor: c.recording_url ? "pointer" : "not-allowed",
                              opacity: c.recording_url ? 1 : 0.35,
                            }}
                          >
                            <Headphones size={14} />
                          </button>
                          <Link
                            href={`/calls/${c.id}`}
                            title={t("Voir les détails")}
                            style={{
                              padding: "4px 8px", fontSize: 14, lineHeight: 1,
                              border: "1px solid var(--border)", borderRadius: 6,
                              textDecoration: "none", color: "var(--text)",
                            }}
                          >
                            <Eye size={14} />
                          </Link>
                        </div>
                      </td>
                    </tr>
                    {isOpen && c.recording_url && (
                      <tr>
                        <td colSpan={10} style={{ background: "var(--bg-2)", padding: "10px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {/* Stream via our origin so playback isn't blocked
                                by the upstream host's CORS / content-type. */}
                            <audio
                              controls
                              autoPlay
                              src={`/api/dashboard/call-recording?id=${encodeURIComponent(c.id)}`}
                              style={{ flex: 1 }}
                              onLoadedMetadata={fixAudioDuration}
                            />
                            <a
                              href={`/api/dashboard/call-recording?id=${encodeURIComponent(c.id)}`}
                              download
                              className="ghost"
                              style={{ padding: "4px 10px", fontSize: 12, textDecoration: "none", color: "var(--text)" }}
                            >
                              <Download size={14} style={{ verticalAlign: "middle" }} /> {t("Télécharger")}
                            </a>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {filtered.length} / {rows.length} {t("appels")} · {t("max 250 par requête")}
      </div>
    </>
  );
}

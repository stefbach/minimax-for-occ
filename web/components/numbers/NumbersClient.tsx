"use client";

import { useMemo, useState } from "react";

export interface PhoneNumberRow {
  id: string;
  org_id: string;
  e164: string;
  label: string | null;
  provider: string;
  provider_sid: string | null;
  flow_id: string | null;
  queue_id?: string | null;
  agent_handle_id?: string | null;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean; fax?: boolean } | null;
  active: boolean;
  country_code?: string | null;
  prefix?: string | null;
  compliance_jurisdiction?: string | null;
  dnc_check_enabled?: boolean | null;
  webhook_configured?: boolean | null;
  webhook_configured_at?: string | null;
  last_call_at?: string | null;
  notes?: string | null;
  is_default?: boolean | null;
  inbound_enabled?: boolean | null;
  human_first_enabled?: boolean | null;
  created_at: string;
}

export interface FlowOption {
  id: string;
  name: string;
}

export interface QueueOption {
  id: string;
  name: string;
}

export interface AgentOption {
  id: string;
  display_name: string | null;
  kind?: string;
}

interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  isoCountry: string;
  locality: string | null;
  region: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean; fax: boolean };
}

const COUNTRY_OPTIONS = [
  { code: "FR", name: "France" },
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "BE", name: "Belgium" },
  { code: "CH", name: "Switzerland" },
  { code: "DE", name: "Germany" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "MU", name: "Mauritius" },
];

const JURISDICTION_OPTIONS = [
  { value: "",         label: "—" },
  { value: "US_TCPA",  label: "US TCPA" },
  { value: "EU_GDPR",  label: "EU GDPR" },
  { value: "GDPR_UK",  label: "UK GDPR" },
  { value: "MU_ICTA",  label: "MU ICTA" },
  { value: "OTHER",    label: "Other" },
];

type StatusFilter = "" | "active" | "inactive";

function healthOf(n: PhoneNumberRow): "active" | "low_volume" | "dormant" | "never_used" {
  if (!n.last_call_at) return "never_used";
  const last = Date.parse(n.last_call_at);
  if (!Number.isFinite(last)) return "never_used";
  const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
  if (days > 30) return "dormant";
  return "active";
}

function HealthBadge({ row }: { row: PhoneNumberRow }) {
  const h = healthOf(row);
  if (h === "active") return <span className="tag good">● Active</span>;
  if (h === "dormant") return <span className="tag" style={{ color: "var(--bad)" }}>● Dormant</span>;
  if (h === "low_volume") return <span className="tag" style={{ color: "var(--warn,#b58900)" }}>● Low</span>;
  return <span className="tag muted">○ Never used</span>;
}

export function NumbersClient({
  initial,
  flows,
  queues,
  agents,
  twilioReady,
}: {
  initial: PhoneNumberRow[];
  flows: FlowOption[];
  queues: QueueOption[];
  agents: AgentOption[];
  twilioReady: boolean;
}) {
  const [rows, setRows] = useState<PhoneNumberRow[]>(initial);

  // ─── Twilio search/purchase state ────────────────────────────────────────
  const [searchCountry, setSearchCountry] = useState("FR");
  const [searchType, setSearchType] = useState<"local" | "mobile" | "tollfree">("local");
  const [searchArea, setSearchArea] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  // ─── Import an existing Twilio number ────────────────────────────────────
  const [importE164, setImportE164] = useState("");
  const [importLabel, setImportLabel] = useState("");
  const [importing, setImporting] = useState(false);

  // ─── Filters ─────────────────────────────────────────────────────────────
  const [fCountry, setFCountry] = useState<string>("");
  const [fStatus, setFStatus] = useState<StatusFilter>("");
  const [fHealth, setFHealth] = useState<string>("");
  const [fQueue, setFQueue] = useState<string>("");
  const [fAgent, setFAgent] = useState<string>("");
  const [fSearch, setFSearch] = useState<string>("");

  // ─── Selection / bulk ────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    return rows.filter((n) => {
      if (fCountry && (n.country_code ?? "") !== fCountry) return false;
      if (fStatus === "active" && !n.active) return false;
      if (fStatus === "inactive" && n.active) return false;
      if (fHealth && healthOf(n) !== fHealth) return false;
      if (fQueue && (n.queue_id ?? "") !== fQueue) return false;
      if (fAgent && (n.agent_handle_id ?? "") !== fAgent) return false;
      if (fSearch) {
        const q = fSearch.trim().toLowerCase();
        if (
          !n.e164.toLowerCase().includes(q) &&
          !(n.label ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, fCountry, fStatus, fHealth, fQueue, fAgent, fSearch]);

  const countryFacets = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.country_code && s.add(r.country_code));
    return Array.from(s).sort();
  }, [rows]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  function toggleOne(id: string, on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAll(on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      filtered.forEach((r) => (on ? next.add(r.id) : next.delete(r.id)));
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  async function refresh() {
    const r = await fetch("/api/numbers", { cache: "no-store" });
    if (r.ok) setRows(await r.json());
  }

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearching(true);
    setSearchError(null);
    setResults(null);
    const qs = new URLSearchParams({ country: searchCountry, type: searchType });
    if (searchArea) qs.set("areaCode", searchArea);
    const r = await fetch(`/api/numbers/search?${qs.toString()}`, { cache: "no-store" });
    setSearching(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setSearchError(j.error ?? "Twilio search failed");
      return;
    }
    setResults((await r.json()) as AvailableNumber[]);
  }

  async function purchase(phoneNumber: string) {
    setPurchasing(phoneNumber);
    setActionError(null);
    setActionNote(null);
    const r = await fetch("/api/numbers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone_number: phoneNumber }),
    });
    setPurchasing(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Purchase failed");
      return;
    }
    const j = await r.json().catch(() => ({} as { webhook_warning?: string }));
    setActionNote(
      j?.webhook_warning
        ? `Number ${phoneNumber} purchased but webhook not configured: ${j.webhook_warning}`
        : `Number ${phoneNumber} purchased and Twilio webhook configured automatically.`,
    );
    setResults((cur) => (cur ? cur.filter((n) => n.phoneNumber !== phoneNumber) : cur));
    refresh();
  }

  async function importExisting(e: React.FormEvent) {
    e.preventDefault();
    const e164 = importE164.trim();
    if (!/^\+\d{6,15}$/.test(e164)) {
      setActionError("Invalid number: E.164 format required (e.g. +447700162160).");
      return;
    }
    setImporting(true);
    setActionError(null);
    setActionNote(null);
    const r = await fetch("/api/numbers/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        phone_number: e164,
        label: importLabel.trim() || undefined,
      }),
    });
    setImporting(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Import failed");
      return;
    }
    const j = await r.json().catch(() => ({} as { webhook_warning?: string }));
    setActionNote(
      j?.webhook_warning
        ? `Number ${e164} imported but webhook not reconfigured: ${j.webhook_warning}`
        : `Number ${e164} imported and Twilio webhook reconfigured automatically.`,
    );
    setImportE164("");
    setImportLabel("");
    refresh();
  }

  async function release(row: PhoneNumberRow) {
    if (!confirm(`Release ${row.e164}? The number will be deleted from Twilio and the database.`)) return;
    setActionError(null);
    setActionNote(null);
    const r = await fetch(`/api/numbers?id=${row.id}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Suppression en échec");
      return;
    }
    const j = await r.json().catch(() => ({}));
    if (j?.warning) setActionNote(j.warning);
    refresh();
  }

  async function patch(id: string, body: Partial<PhoneNumberRow>) {
    setActionError(null);
    const r = await fetch(`/api/numbers/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Update failed");
      return;
    }
    const updated = (await r.json()) as PhoneNumberRow;
    setRows((cur) => cur.map((n) => (n.id === id ? updated : n)));
  }

  async function reconfigureWebhook(row: PhoneNumberRow) {
    setActionError(null);
    setActionNote(null);
    const r = await fetch(`/api/numbers/${row.id}/configure-webhook`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setActionError(j.error ?? "Webhook configuration failed");
      return;
    }
    setActionNote(`Webhook reconfigured for ${row.e164}.`);
    if (j?.row) {
      setRows((cur) => cur.map((n) => (n.id === row.id ? (j.row as PhoneNumberRow) : n)));
    } else {
      refresh();
    }
  }

  // ─── Bulk operations ─────────────────────────────────────────────────────
  async function bulk(
    action: "activate" | "deactivate" | "assign_queue" | "assign_agent" | "assign_flow" | "delete",
    payload?: Record<string, unknown>,
  ) {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    if (action === "delete" && !confirm(`Delete ${ids.length} number(s)? They will also be released from Twilio.`)) {
      return;
    }
    setBulkBusy(true);
    setActionError(null);
    setActionNote(null);
    const r = await fetch("/api/numbers/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, action, payload }),
    });
    setBulkBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Bulk action failed");
      return;
    }
    const j = await r.json().catch(() => ({}));
    setActionNote(
      `Action "${action}" applied to ${j.affected ?? ids.length} number(s).${
        j.warnings?.length ? ` (${j.warnings.length} warning(s))` : ""
      }`,
    );
    clearSelection();
    refresh();
  }

  const queueById = useMemo(() => Object.fromEntries(queues.map((q) => [q.id, q.name])), [queues]);
  const agentById = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.display_name ?? a.id.slice(0, 6)])),
    [agents],
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ─── Search & purchase ─── */}
      <div className="card" data-numbers-search>
        <h3 style={{ marginTop: 0 }}>Search and buy a number</h3>
        <form onSubmit={doSearch} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Country</label>
              <select
                value={searchCountry}
                onChange={(e) => setSearchCountry(e.target.value)}
                disabled={!twilioReady}
              >
                {COUNTRY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Type</label>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as typeof searchType)}
                disabled={!twilioReady}
              >
                <option value="local">Local</option>
                <option value="mobile">Mobile</option>
                <option value="tollfree">Toll-free</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Area code (optional, US/CA)</label>
              <input
                value={searchArea}
                onChange={(e) => setSearchArea(e.target.value)}
                placeholder="e.g. 415"
                disabled={!twilioReady}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" disabled={!twilioReady || searching}>
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
          </div>
          {searchError && (
            <div style={{ color: "var(--bad)", fontSize: 13 }}>{searchError}</div>
          )}
        </form>

        {results !== null && (
          <div style={{ marginTop: 14 }}>
            {results.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>
                No numbers available for these criteria.
              </div>
            ) : (
              <table className="list">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Locality</th>
                    <th>Capabilities</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((n) => (
                    <tr key={n.phoneNumber}>
                      <td>
                        <span className="kbd">{n.phoneNumber}</span>
                      </td>
                      <td>
                        {[n.locality, n.region].filter(Boolean).join(", ") || (
                          <em style={{ color: "var(--muted)" }}>—</em>
                        )}
                      </td>
                      <td>
                        {n.capabilities.voice && <span className="tag" style={{ marginRight: 4 }}>voice</span>}
                        {n.capabilities.sms && <span className="tag" style={{ marginRight: 4 }}>sms</span>}
                        {n.capabilities.mms && <span className="tag" style={{ marginRight: 4 }}>mms</span>}
                        {n.capabilities.fax && <span className="tag" style={{ marginRight: 4 }}>fax</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          onClick={() => purchase(n.phoneNumber)}
                          disabled={purchasing === n.phoneNumber}
                        >
                          {purchasing === n.phoneNumber ? "Buying…" : "Buy"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ─── Import an existing Twilio number ─── */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Import an existing Twilio number</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          For a number already purchased on Twilio (before Axon, or elsewhere). Axon
          verifies that the number belongs to the linked Twilio account, then
          (re)configures its webhooks (VoiceUrl + StatusCallback) so it
          behaves like a number purchased through Axon.
        </p>
        <form onSubmit={importExisting} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Number (E.164)</label>
              <input
                value={importE164}
                onChange={(e) => setImportE164(e.target.value)}
                placeholder="+447700162160"
                disabled={!twilioReady || importing}
                required
              />
            </div>
            <div>
              <label>Label (optional)</label>
              <input
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                placeholder="e.g. UK main line"
                disabled={!twilioReady || importing}
              />
            </div>
          </div>
          <div>
            <button type="submit" disabled={!twilioReady || importing || !importE164.trim()}>
              {importing ? "Importing…" : "Import this number"}
            </button>
          </div>
        </form>
      </div>

      {actionError && (
        <div className="card" style={{ borderColor: "var(--bad)" }}>
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{actionError}</div>
        </div>
      )}
      {actionNote && (
        <div className="card">
          <div className="muted" style={{ fontSize: 13 }}>{actionNote}</div>
        </div>
      )}

      {/* ─── Filters ─── */}
      <div className="card" style={{ display: "grid", gap: 10 }}>
        <div className="form-row" style={{ flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 180px" }}>
            <label>Search (number / label)</label>
            <input
              value={fSearch}
              onChange={(e) => setFSearch(e.target.value)}
              placeholder="e.g. +33, support…"
            />
          </div>
          <div>
            <label>Country</label>
            <select value={fCountry} onChange={(e) => setFCountry(e.target.value)}>
              <option value="">All</option>
              {countryFacets.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Status</label>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as StatusFilter)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label>Health</label>
            <select value={fHealth} onChange={(e) => setFHealth(e.target.value)}>
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="dormant">Dormant</option>
              <option value="never_used">Never used</option>
            </select>
          </div>
          <div>
            <label>Queue</label>
            <select value={fQueue} onChange={(e) => setFQueue(e.target.value)}>
              <option value="">All</option>
              {queues.map((q) => (
                <option key={q.id} value={q.id}>{q.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Agent</label>
            <select value={fAgent} onChange={(e) => setFAgent(e.target.value)}>
              <option value="">All</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.display_name ?? a.id.slice(0, 6)}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setFCountry("");
                setFStatus("");
                setFHealth("");
                setFQueue("");
                setFAgent("");
                setFSearch("");
              }}
            >
              Reset
            </button>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {filtered.length} / {rows.length} numbers shown
        </div>
      </div>

      {/* ─── Bulk action bar ─── */}
      {selected.size > 0 && (
        <div
          className="card"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            borderColor: "var(--accent, #4f46e5)",
          }}
        >
          <strong>{selected.size} number(s) selected</strong>
          <button disabled={bulkBusy} onClick={() => bulk("activate")}>Activate</button>
          <button disabled={bulkBusy} onClick={() => bulk("deactivate")}>Deactivate</button>
          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (v === "__clear__") bulk("assign_queue", { queue_id: null });
              else if (v) bulk("assign_queue", { queue_id: v });
            }}
          >
            <option value="">Assign queue…</option>
            <option value="__clear__">— Remove queue —</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (v === "__clear__") bulk("assign_agent", { agent_handle_id: null });
              else if (v) bulk("assign_agent", { agent_handle_id: v });
            }}
          >
            <option value="">Assign agent…</option>
            <option value="__clear__">— Remove agent —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name ?? a.id.slice(0, 6)}</option>
            ))}
          </select>
          <select
            disabled={bulkBusy}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              e.currentTarget.value = "";
              if (v === "__clear__") bulk("assign_flow", { flow_id: null });
              else if (v) bulk("assign_flow", { flow_id: v });
            }}
          >
            <option value="">Assign flow…</option>
            <option value="__clear__">— Remove flow —</option>
            {flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <button className="danger" disabled={bulkBusy} onClick={() => bulk("delete")}>
            Delete
          </button>
          <button type="button" onClick={clearSelection} disabled={bulkBusy}>
            Clear selection
          </button>
        </div>
      )}

      {/* ─── Numbers table ─── */}
      <div className="card" style={{ padding: 0, overflow: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 20, display: "grid", gap: 10 }}>
            <div style={{ color: "var(--muted)" }}>
              No numbers provisioned yet.
            </div>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 560 }}>
              Buy a Twilio number to connect it to an IVR flow, a queue or an AI agent.
              The Twilio webhook is configured automatically on purchase.
            </div>
            <div>
              <button
                onClick={() => {
                  const el = document.querySelector<HTMLElement>("[data-numbers-search]");
                  el?.scrollIntoView({ behavior: "smooth", block: "start" });
                  el?.querySelector<HTMLInputElement>("input")?.focus();
                }}
                disabled={!twilioReady}
                title={!twilioReady ? "Twilio not configured (missing env variables)" : ""}
              >
                Buy a number
              </button>
            </div>
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allFilteredSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                </th>
                <th>Number</th>
                <th>Country</th>
                <th>Routing</th>
                <th>Health</th>
                <th>Webhook</th>
                <th>Compliance</th>
                <th>Active</th>
                <th>Inbound</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => {
                const isSelected = selected.has(n.id);
                return (
                  <tr key={n.id} style={isSelected ? { background: "var(--row-selected, rgba(79,70,229,0.08))" } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleOne(n.id, e.target.checked)}
                      />
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 2 }}>
                        <span className="kbd">{n.e164}</span>
                        <input
                          defaultValue={n.label ?? ""}
                          placeholder="label…"
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (n.label ?? "")) patch(n.id, { label: v || null });
                          }}
                          style={{ minWidth: 120, fontSize: 12 }}
                        />
                      </div>
                    </td>
                    <td>{n.country_code ?? <em className="muted">—</em>}</td>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ display: "grid", gap: 4 }}>
                        <select
                          value={n.flow_id ?? ""}
                          onChange={(e) => patch(n.id, { flow_id: e.target.value || null })}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">— Flow: none —</option>
                          {flows.map((f) => (
                            <option key={f.id} value={f.id}>Flow: {f.name}</option>
                          ))}
                        </select>
                        <select
                          value={n.queue_id ?? ""}
                          onChange={(e) => patch(n.id, { queue_id: e.target.value || null })}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">— Queue: none —</option>
                          {queues.map((q) => (
                            <option key={q.id} value={q.id}>Queue: {q.name}</option>
                          ))}
                        </select>
                        <select
                          value={n.agent_handle_id ?? ""}
                          onChange={(e) => patch(n.id, { agent_handle_id: e.target.value || null })}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">— Agent: none —</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>Agent: {a.display_name ?? a.id.slice(0, 6)}</option>
                          ))}
                        </select>
                        {(n.queue_id || n.agent_handle_id) && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {n.queue_id && <>→ {queueById[n.queue_id] ?? "?"} </>}
                            {n.agent_handle_id && <>→ {agentById[n.agent_handle_id] ?? "?"}</>}
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <HealthBadge row={n} />
                      {n.last_call_at && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {new Date(n.last_call_at).toLocaleDateString()}
                        </div>
                      )}
                    </td>
                    <td>
                      {n.webhook_configured ? (
                        <span className="tag good">✓ Configured</span>
                      ) : (
                        <div style={{ display: "grid", gap: 4 }}>
                          <span className="tag" style={{ color: "var(--warn,#b58900)" }}>⚠ To configure</span>
                          <button
                            style={{ padding: "3px 7px", fontSize: 11 }}
                            onClick={() => reconfigureWebhook(n)}
                          >
                            Configure
                          </button>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 4 }}>
                        <select
                          value={n.compliance_jurisdiction ?? ""}
                          onChange={(e) =>
                            patch(n.id, { compliance_jurisdiction: e.target.value || null })
                          }
                          style={{ fontSize: 12 }}
                        >
                          {JURISDICTION_OPTIONS.map((j) => (
                            <option key={j.value} value={j.value}>{j.label}</option>
                          ))}
                        </select>
                        <label
                          style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 11 }}
                        >
                          <input
                            type="checkbox"
                            checked={!!n.dnc_check_enabled}
                            onChange={(e) => patch(n.id, { dnc_check_enabled: e.target.checked })}
                          />
                          DNC check
                        </label>
                      </div>
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={n.active}
                          onChange={(e) => patch(n.id, { active: e.target.checked })}
                        />
                        {n.active ? <span className="tag good">active</span> : <span className="tag">inactive</span>}
                      </label>
                    </td>
                    <td>
                      <div style={{ display: "grid", gap: 6, minWidth: 172 }}>
                        {/* Interrupteur principal : ce numéro décroche-t-il les appels entrants ? */}
                        <button
                          type="button"
                          onClick={() => patch(n.id, { inbound_enabled: !n.inbound_enabled })}
                          title="Quand ON, ce numéro décroche les appels ENTRANTS. OFF = aucun décrochage (sécurité)."
                          style={{
                            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                            padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                            border: `1px solid ${n.inbound_enabled ? "var(--good)" : "var(--border)"}`,
                            background: n.inbound_enabled ? "color-mix(in srgb, var(--good) 14%, transparent)" : "transparent",
                            color: n.inbound_enabled ? "var(--good)" : "var(--muted)",
                          }}
                        >
                          {n.inbound_enabled ? "🟢 Entrant ON" : "⚪ Entrant OFF"}
                        </button>
                        {/* Mode — toujours sélectionnable (s'applique dès qu'Entrant est ON). */}
                        <div
                          title="Humain d'abord : faire sonner les agents humains assignés (en ligne) AVANT Charlotte. IA seulement : Charlotte (IA) répond directement."
                          style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr",
                            border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
                            opacity: n.inbound_enabled ? 1 : 0.6,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => patch(n.id, { human_first_enabled: true })}
                            style={{
                              padding: "5px 4px", fontSize: 11, border: "none", cursor: "pointer",
                              background: n.human_first_enabled ? "color-mix(in srgb, var(--accent) 22%, transparent)" : "transparent",
                              color: n.human_first_enabled ? "var(--text)" : "var(--muted)",
                              fontWeight: n.human_first_enabled ? 600 : 400,
                            }}
                          >
                            👤 Humain
                          </button>
                          <button
                            type="button"
                            onClick={() => patch(n.id, { human_first_enabled: false })}
                            style={{
                              padding: "5px 4px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                              background: !n.human_first_enabled ? "color-mix(in srgb, var(--info) 22%, transparent)" : "transparent",
                              color: !n.human_first_enabled ? "var(--text)" : "var(--muted)",
                              fontWeight: !n.human_first_enabled ? 600 : 400,
                            }}
                          >
                            🤖 IA seule
                          </button>
                        </div>
                        {!n.inbound_enabled && (
                          <span className="muted" style={{ fontSize: 10 }}>mode appliqué quand Entrant est ON</span>
                        )}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <a
                          href={`/numbers/${n.id}`}
                          className="button"
                          style={{
                            padding: "5px 9px",
                            textDecoration: "none",
                            fontSize: 12,
                          }}
                        >
                          Settings
                        </a>
                        <button
                          className="danger"
                          style={{ padding: "5px 9px" }}
                          onClick={() => release(n)}
                        >
                          Release
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && rows.length > 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 14, color: "var(--muted)" }}>
                    No numbers match the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

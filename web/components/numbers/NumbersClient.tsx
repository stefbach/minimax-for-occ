"use client";

import { useState } from "react";

export interface PhoneNumberRow {
  id: string;
  org_id: string;
  e164: string;
  label: string | null;
  provider: string;
  provider_sid: string | null;
  flow_id: string | null;
  capabilities: { voice?: boolean; sms?: boolean; mms?: boolean; fax?: boolean } | null;
  active: boolean;
  created_at: string;
}

export interface FlowOption {
  id: string;
  name: string;
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
  { code: "US", name: "États-Unis" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "Royaume-Uni" },
  { code: "BE", name: "Belgique" },
  { code: "CH", name: "Suisse" },
  { code: "DE", name: "Allemagne" },
  { code: "ES", name: "Espagne" },
  { code: "IT", name: "Italie" },
  { code: "NL", name: "Pays-Bas" },
  { code: "MU", name: "Maurice" },
];

export function NumbersClient({
  initial,
  flows,
  twilioReady,
}: {
  initial: PhoneNumberRow[];
  flows: FlowOption[];
  twilioReady: boolean;
}) {
  const [rows, setRows] = useState<PhoneNumberRow[]>(initial);
  const [searchCountry, setSearchCountry] = useState("FR");
  const [searchType, setSearchType] = useState<"local" | "mobile" | "tollfree">("local");
  const [searchArea, setSearchArea] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

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
      setSearchError(j.error ?? "Recherche Twilio en échec");
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
      setActionError(j.error ?? "Achat en échec");
      return;
    }
    setActionNote(`Numéro ${phoneNumber} acheté et webhook Twilio configuré.`);
    setResults((cur) => (cur ? cur.filter((n) => n.phoneNumber !== phoneNumber) : cur));
    refresh();
  }

  async function release(row: PhoneNumberRow) {
    if (!confirm(`Libérer ${row.e164} ? Le numéro sera supprimé de Twilio et de la base.`)) return;
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

  async function patch(id: string, body: Partial<Pick<PhoneNumberRow, "label" | "active" | "flow_id">>) {
    setActionError(null);
    const r = await fetch(`/api/numbers?id=${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setActionError(j.error ?? "Mise à jour en échec");
      return;
    }
    const updated = (await r.json()) as PhoneNumberRow;
    setRows((cur) => cur.map((n) => (n.id === id ? updated : n)));
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Rechercher et acheter un numéro</h3>
        <form onSubmit={doSearch} style={{ display: "grid", gap: 10 }}>
          <div className="form-row">
            <div>
              <label>Pays</label>
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
                <option value="tollfree">Numéro vert (toll-free)</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div>
              <label>Indicatif régional (optionnel, US/CA)</label>
              <input
                value={searchArea}
                onChange={(e) => setSearchArea(e.target.value)}
                placeholder="ex: 415"
                disabled={!twilioReady}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button type="submit" disabled={!twilioReady || searching}>
                {searching ? "Recherche…" : "Rechercher"}
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
                Aucun numéro disponible pour ces critères.
              </div>
            ) : (
              <table className="list">
                <thead>
                  <tr>
                    <th>Numéro</th>
                    <th>Localité</th>
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
                          {purchasing === n.phoneNumber ? "Achat…" : "Acheter"}
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

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, color: "var(--muted)" }}>
            Aucun numéro provisionné pour l&apos;instant. Recherchez et achetez votre premier numéro ci-dessus.
          </div>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Label</th>
                <th>Flow attaché</th>
                <th>Capabilities</th>
                <th>Actif</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const caps = n.capabilities ?? {};
                return (
                  <tr key={n.id}>
                    <td><span className="kbd">{n.e164}</span></td>
                    <td>
                      <input
                        defaultValue={n.label ?? ""}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (n.label ?? "")) patch(n.id, { label: v || null });
                        }}
                        style={{ minWidth: 140 }}
                      />
                    </td>
                    <td>
                      <select
                        value={n.flow_id ?? ""}
                        onChange={(e) => patch(n.id, { flow_id: e.target.value || null })}
                      >
                        <option value="">— Aucun —</option>
                        {flows.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {caps.voice && <span className="tag" style={{ marginRight: 4 }}>voice</span>}
                      {caps.sms && <span className="tag" style={{ marginRight: 4 }}>sms</span>}
                      {caps.mms && <span className="tag" style={{ marginRight: 4 }}>mms</span>}
                      {caps.fax && <span className="tag" style={{ marginRight: 4 }}>fax</span>}
                    </td>
                    <td>
                      <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={n.active}
                          onChange={(e) => patch(n.id, { active: e.target.checked })}
                        />
                        {n.active ? <span className="tag good">actif</span> : <span className="tag">inactif</span>}
                      </label>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="danger" style={{ padding: "5px 9px" }} onClick={() => release(n)}>
                        Libérer
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

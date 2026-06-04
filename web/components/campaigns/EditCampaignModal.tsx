"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Lightweight edit modal for the campaign detail page. Lets the user change
// the most-tweaked fields (name, days, hour ranges, concurrency, attempts,
// retry, AMD) without going back through the 3-step wizard. PATCH endpoint
// already accepts these fields; this is purely UI.

interface HourRange { start: string; end: string }
interface Schedule { days?: number[]; hours?: { start?: string; end?: string; ranges?: HourRange[] } }

interface Props {
  campaignId: string;
  initial: {
    name: string;
    schedule: Schedule;
    max_concurrency: number;
    max_attempts: number;
    retry_delay_min: number;
    amd_enabled: boolean;
  };
  onClose: () => void;
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

export function EditCampaignModal({ campaignId, initial, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const utcStarts = ranges.map((r) => r.start).sort();
      const utcEnds = ranges.map((r) => r.end).sort();
      const schedule = {
        days,
        hours: {
          // Times stay in their original format — the dialer compares with
          // the same string. We don't re-convert because the original draft
          // already had them stored in the same TZ; changing TZ here would
          // require the full wizard.
          start: utcStarts[0] ?? "09:00",
          end: utcEnds[utcEnds.length - 1] ?? "18:00",
          ranges,
        },
      };
      const r = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          schedule,
          max_concurrency: maxConcurrency,
          max_attempts: maxAttempts,
          retry_delay_min: retryDelayMin,
          amd_enabled: amdEnabled,
        }),
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
        style={{ width: "min(640px, 100%)", marginTop: 30, display: "grid", gap: 14 }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Éditer la campagne</h3>
          <button className="ghost" onClick={onClose} style={{ padding: "2px 8px" }}>×</button>
        </div>

        <div>
          <label>Nom</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
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
                  style={{ padding: "5px 11px" }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label>Plages horaires</label>
          <div style={{ display: "grid", gap: 8 }}>
            {ranges.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="time"
                  value={r.start}
                  onChange={(e) => updateRange(i, { start: e.target.value })}
                  style={{ width: "auto" }}
                />
                <span className="muted">→</span>
                <input
                  type="time"
                  value={r.end}
                  onChange={(e) => updateRange(i, { end: e.target.value })}
                  style={{ width: "auto" }}
                />
                {ranges.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeRange(i)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4, marginLeft: "auto" }}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="ghost" onClick={addRange} style={{ padding: "5px 12px", alignSelf: "flex-start" }}>
              + Ajouter une plage
            </button>
          </div>
        </div>

        <details>
          <summary style={{ cursor: "pointer", fontSize: 13 }}>▸ Cadence et AMD</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <div>
                <label style={{ fontSize: 12 }}>Simultanés</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={maxConcurrency}
                  onChange={(e) => setMaxConcurrency(Number(e.target.value) || 1)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Tentatives</label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(Number(e.target.value) || 1)}
                />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>Retry (min)</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={retryDelayMin}
                  onChange={(e) => setRetryDelayMin(Number(e.target.value) || 1)}
                />
              </div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={amdEnabled}
                onChange={(e) => setAmdEnabled(e.target.checked)}
                style={{ width: "auto" }}
              />
              Détection de répondeur (AMD)
            </label>
          </div>
        </details>

        {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button type="button" onClick={save} disabled={busy || !name.trim() || days.length === 0}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>

        <div className="muted" style={{ fontSize: 11 }}>
          Pour changer l&apos;agent, le numéro émetteur, la source des contacts ou les phases de relance, recrée une campagne via le wizard.
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HelpButton } from "@/components/help/HelpButton";
import { EditCampaignModal } from "./EditCampaignModal";

export interface EngineSummary {
  timezone: string;
  days: number[];
  hours: string[];
  max_new_per_day: number | null;
  include_statuses: string[];
  phases: string[];
}

export interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  state: string;
  mode: string;
  agent_handle_name: string | null;
  agent_handle_id: string | null;
  agent_team_id: string | null;
  phone_e164: string | null;
  phone_number_id: string | null;
  data_table_id: string | null;
  max_concurrency: number;
  max_attempts: number;
  retry_delay_min: number;
  amd_enabled: boolean;
  schedule: Record<string, unknown>;
  metadata: Record<string, unknown> | null;
  created_at: string;
  engine: EngineSummary | null;
}

export interface CampaignRunRow {
  id: string;
  run_date: string;
  slot_label: string;
  selected: number | null;
  launched: number | null;
  by_phase: Record<string, number>;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export interface TargetRow {
  id: string;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_call_id: string | null;
  contact_id: string;
  contact_e164: string | null;
  contact_name: string | null;
}

function stateClass(state: string): string {
  if (state === "running") return "tag good";
  if (state === "completed" || state === "scheduled") return "tag accent";
  return "tag";
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export function CampaignDetailClient({
  campaign,
  targets,
  runs = [],
}: {
  campaign: CampaignDetail;
  targets: TargetRow[];
  runs?: CampaignRunRow[];
}) {
  const router = useRouter();
  const [state, setState] = useState(campaign.state);
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");

  const counts = targets.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  async function patchState(next: string) {
    setBusy(next);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setState(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/start`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setState("running");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  async function importTargets() {
    setBusy("import");
    setError(null);
    const contacts = csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [e164, ...rest] = l.split(",").map((s) => s.trim());
        return { e164, name: rest.join(",") || null };
      })
      .filter((r) => r.e164);
    if (contacts.length === 0) {
      setBusy(null);
      setError("No valid targets.");
      return;
    }
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/targets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contacts }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setCsvText("");
      setShowImport(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(null);
    }
  }

  const kpis: Array<{ label: string; key: string; tone?: string }> = [
    { label: "Total", key: "_total" },
    { label: "Dialing", key: "dialing" },
    { label: "Answered", key: "answered" },
    { label: "Done", key: "done" },
    { label: "Failed", key: "failed", tone: "bad" },
  ];
  const total = targets.length;

  return (
    <>
      <div className="page-header">
        <div>
          <Link href="/campaigns" style={{ fontSize: 13, color: "var(--muted)" }}>
            ← All campaigns
          </Link>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {campaign.name}
            <span className={stateClass(state)}>{state}</span>
          </h1>
          {campaign.description && (
            <div className="subtitle">{campaign.description}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {(state === "draft" || state === "paused" || state === "scheduled") && (
            <button
              className="ghost"
              onClick={() => setEditOpen(true)}
              disabled={busy !== null}
              title="Edit name, days, time slots and pacing"
            >
              ✎ Edit
            </button>
          )}
          {state !== "running" && state !== "completed" && state !== "cancelled" && (
            <button onClick={start} disabled={busy !== null}>
              {busy === "start" ? "…" : "Start"}
            </button>
          )}
          {state === "running" && (
            <button
              className="ghost"
              onClick={() => patchState("paused")}
              disabled={busy !== null}
            >
              Pause
            </button>
          )}
          {state === "paused" && (
            <button onClick={() => patchState("running")} disabled={busy !== null}>
              Resume
            </button>
          )}
          {/* Reopen: a finished or cancelled campaign can be reactivated at any
              time. Dynamic campaigns immediately resume their per-slot engine;
              static ones re-dial any remaining/failed targets. */}
          {(state === "completed" || state === "cancelled") && (
            <button onClick={() => patchState("running")} disabled={busy !== null}>
              {busy === "running" ? "…" : "Reopen campaign"}
            </button>
          )}
          {state !== "completed" && state !== "cancelled" && (
            <button
              className="danger"
              onClick={() => patchState("cancelled")}
              disabled={busy !== null}
            >
              Cancel
            </button>
          )}
          <HelpButton contextKey="campaigns" />
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--bad)", color: "var(--bad)", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        {kpis.map((k) => {
          const value = k.key === "_total" ? total : counts[k.key] ?? 0;
          return (
            <div key={k.key} className="card" style={{ padding: 16 }}>
              <div className="muted" style={{ fontSize: 12 }}>{k.label}</div>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: k.tone === "bad" ? "var(--bad)" : "var(--text)",
                }}
              >
                {value}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Agent</div>
            <div>{campaign.agent_handle_name ?? "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Caller ID</div>
            <div>{campaign.phone_e164 ?? "—"}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Concurrency / attempts</div>
            <div>
              {campaign.max_concurrency} · {campaign.max_attempts} (retry {campaign.retry_delay_min}min)
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>AMD</div>
            <div>{campaign.amd_enabled ? "Enabled" : "Disabled"}</div>
          </div>
        </div>
      </div>

      {campaign.mode === "dynamic" && campaign.engine && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>Continuous campaign</h2>
            <span className="tag accent">auto-selection</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 8 }}>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Days</div>
              <div style={{ display: "flex", gap: 4 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <span
                    key={d}
                    className="tag"
                    style={{
                      opacity: campaign.engine!.days.includes(d) ? 1 : 0.25,
                      padding: "2px 7px",
                    }}
                  >
                    {DAY_LABELS[d]}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Slots ({campaign.engine.timezone})</div>
              <div>{campaign.engine.hours.length > 0 ? campaign.engine.hours.join(" · ") : "—"}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Max new / slot</div>
              <div>{campaign.engine.max_new_per_day ?? "∞"}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Follow-up phases</div>
              <div>{campaign.engine.phases.length > 0 ? campaign.engine.phases.join(" → ") : "—"}</div>
            </div>
          </div>
          {campaign.engine.include_statuses.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 12 }}>Target statuses</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {campaign.engine.include_statuses.map((s) => (
                  <span key={s} className="tag">{s}</span>
                ))}
              </div>
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, marginTop: 16, marginBottom: 6 }}>
            Run history (last 60)
          </div>
          {runs.length === 0 ? (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              No runs yet. The engine will select contacts at the next slot.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="list" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Slot</th>
                    <th>Selected</th>
                    <th>Launched</th>
                    <th>By phase</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td>{r.run_date}</td>
                      <td>{r.slot_label}</td>
                      <td>{r.selected ?? "—"}</td>
                      <td>{r.launched ?? "—"}</td>
                      <td className="muted">
                        {Object.keys(r.by_phase).length > 0
                          ? Object.entries(r.by_phase)
                              .map(([k, v]) => `${k}:${v}`)
                              .join("  ")
                          : "—"}
                      </td>
                      <td>
                        {r.error ? (
                          <span className="tag" style={{ color: "var(--bad)" }} title={r.error}>
                            error
                          </span>
                        ) : r.finished_at ? (
                          <span className="tag good">ok</span>
                        ) : (
                          <span className="tag">running</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="page-header" style={{ marginTop: 0 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>
          {campaign.mode === "dynamic" ? "Current call queue" : "Targets"}
        </h2>
        <button className="subtle" onClick={() => setShowImport((v) => !v)}>
          {showImport ? "Cancel" : "Add targets"}
        </button>
      </div>

      {showImport && (
        <div className="card" style={{ marginBottom: 12 }}>
          <label>Paste a CSV (e164,name)</label>
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"+33612345678,Jean Dupont"}
            style={{ minHeight: 100, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
          />
          <div style={{ marginTop: 8 }}>
            <button onClick={importTargets} disabled={busy !== null}>
              {busy === "import" ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      )}

      {targets.length === 0 ? (
        <div className="card">
          {campaign.mode === "dynamic" ? (
            <>
              <p style={{ margin: 0, fontWeight: 600 }}>
                ⟳ Automatic selection at each slot
              </p>
              <p className="muted" style={{ margin: "6px 0 0 0", fontSize: 13, lineHeight: 1.5 }}>
                This campaign is in <strong>continuous</strong> mode: the engine pulls contacts
                directly from your table at each time slot, according to the rules you defined
                (target statuses, follow-ups D+X, daily cap). The queue is never fixed in
                advance — it refreshes automatically.
              </p>
              <p className="muted" style={{ margin: "8px 0 0 0", fontSize: 12 }}>
                Once the campaign is <strong>started</strong>, the run history above will fill up
                progressively (slot, count selected, launched).
              </p>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              No targets for this campaign. Use &ldquo;Add targets&rdquo; to import a CSV or select contacts.
            </p>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="list">
            <thead>
              <tr>
                <th>Contact</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last attempt</th>
                <th>Next attempt</th>
                <th>Call</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div>{t.contact_name ?? t.contact_e164 ?? "—"}</div>
                    {t.contact_name && (
                      <div className="muted" style={{ fontSize: 12 }}>{t.contact_e164}</div>
                    )}
                  </td>
                  <td>
                    <span className="tag">{t.status}</span>
                  </td>
                  <td>{t.attempts}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDate(t.last_attempt_at)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {fmtDate(t.next_attempt_at)}
                  </td>
                  <td>
                    {t.last_call_id ? (
                      <Link href={`/calls/${t.last_call_id}`}>View</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editOpen && (
        <EditCampaignModal
          campaignId={campaign.id}
          initial={{
            name: campaign.name,
            description: campaign.description,
            schedule: campaign.schedule as { days?: number[]; hours?: { start?: string; end?: string; ranges?: { start: string; end: string }[] } },
            max_concurrency: campaign.max_concurrency,
            max_attempts: campaign.max_attempts,
            retry_delay_min: campaign.retry_delay_min,
            amd_enabled: campaign.amd_enabled,
            agent_handle_id: campaign.agent_handle_id,
            agent_team_id: campaign.agent_team_id,
            phone_number_id: campaign.phone_number_id,
            data_table_id: campaign.data_table_id,
            metadata: campaign.metadata as Parameters<typeof EditCampaignModal>[0]["initial"]["metadata"],
          }}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

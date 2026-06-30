"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useT } from "@/lib/i18n";
import { ScriptEditor, type ScriptGraph, type AgentHandleLite, emptyGraph, toGraph } from "./ScriptEditor";

// VoicePanel pulls in the LiveKit browser SDK — load it client-only.
const VoicePanel = dynamic(
  () => import("@/components/voice/VoicePanel").then((m) => m.VoicePanel),
  { ssr: false, loading: () => <p className="muted">Loading simulator…</p> },
);

// Public type re-export so the page can import it from one place.
export type AgentHandleOption = AgentHandleLite;

// React Flow touches `window`/ResizeObserver, so load the visual editor only
// in the browser (no SSR) to avoid hydration hiccups.
const VisualScriptEditor = dynamic(
  () => import("./VisualScriptEditor").then((m) => m.VisualScriptEditor),
  {
    ssr: false,
    loading: () => <p className="muted">Loading visual editor…</p>,
  },
);

type EditorMode = "list" | "visual";

type ScriptRow = {
  id: string;
  org_id: string;
  name: string;
  mission: string | null;
  description: string | null;
  created_at: string;
  latest_version: number | null;
  latest_version_at: string | null;
};

type ScriptDetail = ScriptRow & {
  latest_version: {
    id: string;
    version: number;
    steps: unknown; // graph ({nodes,edges}) or legacy array — normalized via toGraph
    note: string | null;
    created_at: string;
    created_by: string | null;
  } | null;
};

const MISSIONS = ["qualification", "closing", "rappel", "sav", "autre"];

export function ScriptsClient({ handles = [] }: { handles?: AgentHandleLite[] }) {
  const t = useT();
  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state.
  const [name, setName] = useState("");
  const [mission, setMission] = useState("qualification");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/scripts");
      if (!r.ok) throw new Error("fetch scripts failed");
      setScripts((await r.json()) as ScriptRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/scripts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mission,
          description: description.trim() || null,
          steps: emptyGraph(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "create failed");
      setName("");
      setDescription("");
      await refresh();
      setSelectedId(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [name, mission, description, refresh]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm("Delete this script?")) return;
      const r = await fetch(`/api/scripts/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "delete failed");
        return;
      }
      if (selectedId === id) setSelectedId(null);
      await refresh();
    },
    [refresh, selectedId],
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 340px) 1fr", gap: 16, alignItems: "start" }}>
      <div className="card">
        <h3>New script</h3>
        <div style={{ display: "grid", gap: 8 }}>
          <label className="muted" style={{ fontSize: 12 }}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Qualification SaaS B2B"
          />
          <label className="muted" style={{ fontSize: 12 }}>Mission</label>
          <select value={mission} onChange={(e) => setMission(e.target.value)}>
            {MISSIONS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <label className="muted" style={{ fontSize: 12 }}>Description</label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this script for?"
          />
          <div>
            <button onClick={create} disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create script"}
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>
          )}
        </div>

        <MergePanel
          scripts={scripts}
          handles={handles}
          onMerged={async (id) => {
            await refresh();
            setSelectedId(id);
          }}
        />

        <h3 style={{ marginTop: 24 }}>Existing scripts</h3>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : scripts.length === 0 ? (
          <div style={{ display: "grid", gap: 10 }}>
            <p className="muted" style={{ margin: 0 }}>
              No scripts yet.
            </p>
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              A script defines the conversation flow for your agents
              (qualification, closing, support…). Fill in the form above
              to create your first script.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {scripts.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedId(s.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedId(s.id);
                }}
                style={{
                  textAlign: "left",
                  border: "1px solid",
                  borderColor:
                    s.id === selectedId ? "var(--accent)" : "var(--border-2)",
                  background:
                    s.id === selectedId ? "var(--accent-soft)" : "transparent",
                  padding: "10px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>{s.name}</strong>
                  <span className="tag" style={{ fontSize: 10 }}>
                    {s.mission ?? "—"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  v{s.latest_version ?? "?"} ·{" "}
                  {s.description ?? "No description"}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    className="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(s.id);
                    }}
                    style={{
                      fontSize: 11,
                      color: "var(--bad)",
                      padding: "2px 8px",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        {selectedId ? (
          <ScriptDetailView id={selectedId} handles={handles} onSaved={() => void refresh()} />
        ) : (
          <>
            <h3>Edit a script</h3>
            <p className="muted">
              Select a script on the left to edit its steps.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Merge several scripts into one continuous multi-agent "parcours" ──────
function MergePanel({
  scripts,
  handles,
  onMerged,
}: {
  scripts: ScriptRow[];
  handles: AgentHandleLite[];
  onMerged: (id: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [parts, setParts] = useState<Array<{ script_id: string; agent_handle_id: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aiHandles = handles.filter((h) => h.kind !== "human");
  const available = scripts.filter((s) => !parts.some((p) => p.script_id === s.id));

  function addPart(script_id: string) {
    if (!script_id) return;
    setParts((p) => [...p, { script_id, agent_handle_id: "" }]);
  }
  function move(i: number, dir: -1 | 1) {
    setParts((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function setAgent(i: number, agent_handle_id: string) {
    setParts((p) => p.map((x, idx) => (idx === i ? { ...x, agent_handle_id } : x)));
  }
  function removePart(i: number) {
    setParts((p) => p.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/scripts/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          parts: parts.map((p) => ({
            script_id: p.script_id,
            agent_handle_id: p.agent_handle_id || null,
          })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "merge failed");
      setName("");
      setParts([]);
      setOpen(false);
      await onMerged(data.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (id: string) => scripts.find((s) => s.id === id)?.name ?? id;

  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
      <button className="ghost" onClick={() => setOpen((v) => !v)} style={{ fontSize: 13 }}>
        {open ? "🔗 Close" : "🔗 Merge scripts"}
      </button>
      {open && (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
            Combine multiple scripts into ONE continuous journey. Each block is
            assigned to its agent; the handoff happens automatically between
            agents during the call.
          </div>

          <label className="muted" style={{ fontSize: 12 }}>Merged script name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Full OCC journey" />

          {parts.length > 0 && (
            <div style={{ display: "grid", gap: 6 }}>
              {parts.map((p, i) => (
                <div key={p.script_id} style={{ border: "1px solid var(--border-2)", borderRadius: 8, padding: 8, display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <strong style={{ fontSize: 12 }}>{i + 1}. {nameOf(p.script_id)}</strong>
                    <div style={{ display: "flex", gap: 2 }}>
                      <button className="ghost" style={{ padding: "1px 6px" }} onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                      <button className="ghost" style={{ padding: "1px 6px" }} onClick={() => move(i, 1)} disabled={i === parts.length - 1}>↓</button>
                      <button className="ghost" style={{ padding: "1px 6px", color: "var(--bad)" }} onClick={() => removePart(i)}>✕</button>
                    </div>
                  </div>
                  <select value={p.agent_handle_id} onChange={(e) => setAgent(i, e.target.value)} style={{ fontSize: 12 }}>
                    <option value="">Agent: keep the one from the steps</option>
                    {aiHandles.map((h) => (
                      <option key={h.id} value={h.id}>Agent: {h.display_name}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {available.length > 0 && (
            <select value="" onChange={(e) => addPart(e.target.value)} style={{ fontSize: 13 }}>
              <option value="">+ Add a script to the sequence…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}

          <div>
            <button onClick={submit} disabled={busy || !name.trim() || parts.length < 2}>
              {busy ? "Merging…" : `Merge ${parts.length || ""} script${parts.length > 1 ? "s" : ""}`}
            </button>
          </div>
          {parts.length < 2 && (
            <div className="muted" style={{ fontSize: 11 }}>Select at least 2 scripts.</div>
          )}
          {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function ScriptDetailView({
  id,
  handles,
  onSaved,
}: {
  id: string;
  handles: AgentHandleLite[];
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<ScriptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [graph, setGraph] = useState<ScriptGraph>(emptyGraph());
  const [mode, setMode] = useState<EditorMode>("list");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/scripts/${id}`);
      const data = (await r.json()) as ScriptDetail;
      if (!r.ok) {
        throw new Error(
          (data as unknown as { error: string }).error ?? "load failed",
        );
      }
      setDetail(data);
      setGraph(toGraph(data.latest_version?.steps));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveVersion = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/scripts/${id}/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: graph, note: note || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "save failed");
      setNote("");
      onSaved();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [id, graph, note, load, onSaved]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!detail) return <p className="muted">Script not found.</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0 }}>{detail.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {detail.mission ?? "—"} · v
            {detail.latest_version?.version ?? "?"}
          </div>
        </div>
      </div>
      {detail.description && (
        <p className="muted" style={{ fontSize: 13 }}>{detail.description}</p>
      )}

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 4,
          alignItems: "center",
        }}
      >
        <div
          role="tablist"
          style={{
            display: "inline-flex",
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {(["list", "visual"] as EditorMode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className="ghost"
              style={{
                padding: "6px 14px",
                fontSize: 13,
                border: "none",
                borderRadius: 0,
                background: mode === m ? "var(--accent-soft)" : "transparent",
                color: mode === m ? "var(--accent)" : "var(--text)",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === "list" ? "List + branches" : "Visual diagram"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {mode === "list" ? (
          <ScriptEditor value={graph} onChange={setGraph} handles={handles} />
        ) : (
          <VisualScriptEditor value={graph} onChange={setGraph} handles={handles} />
        )}
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        <label className="muted" style={{ fontSize: 12 }}>
          Version note (optional)
        </label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: added price objection"
        />
        <div>
          <button onClick={saveVersion} disabled={saving}>
            {saving ? "Saving…" : "Save as new version"}
          </button>
        </div>
        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>
        )}
      </div>

      <ScriptSimulationPanel scriptId={id} graph={graph} handles={handles} />
    </div>
  );
}

// ── Test a script end-to-end in the browser (incl. multi-agent handoffs) ──
function ScriptSimulationPanel({
  scriptId,
  graph,
  handles,
}: {
  scriptId: string;
  graph: ScriptGraph;
  handles: AgentHandleLite[];
}) {
  const aiHandles = handles.filter((h) => h.kind === "ai" && h.ai_agent_id);

  // The simulation starts as the agent of the FIRST step (e.g. Charlotte).
  // Resolve it; let the tester override if the first step has no agent set.
  const firstNodeAgentHandle = graph.nodes[0]?.agent_handle_id ?? null;
  const resolvedStart =
    handles.find((h) => h.id === firstNodeAgentHandle)?.ai_agent_id ?? aiHandles[0]?.ai_agent_id ?? "";
  const [startAgentId, setStartAgentId] = useState<string>(resolvedStart);
  useMemo(() => setStartAgentId(resolvedStart), [resolvedStart]);

  // Feed the step contents to VoicePanel's launcher so it detects {{vars}}.
  const stepsText = useMemo(
    () => graph.nodes.map((n) => `${n.title}\n${n.content}`).join("\n\n"),
    [graph],
  );

  if (aiHandles.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <h3 style={{ margin: 0 }}>🎧 Test this script (simulation)</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5 }}>
        Launches a browser call that runs THIS script — including agent handoffs.
        No real call is placed.
      </p>
      <div style={{ margin: "10px 0", maxWidth: 360 }}>
        <label className="muted" style={{ fontSize: 12 }}>Start as</label>
        <select value={startAgentId} onChange={(e) => setStartAgentId(e.target.value)}>
          {aiHandles.map((h) => (
            <option key={h.id} value={h.ai_agent_id as string}>{h.display_name}</option>
          ))}
        </select>
        <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
          Defaults to the agent of the 1st script step.
        </div>
      </div>
      {startAgentId ? (
        <VoicePanel agentId={startAgentId} scriptId={scriptId} systemPrompt={stepsText} />
      ) : (
        <p className="muted" style={{ fontSize: 13 }}>
          No AI agent available for simulation.
        </p>
      )}
    </div>
  );
}

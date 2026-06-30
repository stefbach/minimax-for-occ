"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n";

// ─── Graph data model (shared by the simple list editor AND the upcoming
//     visual React-Flow editor) ──────────────────────────────────────────
// A script is a graph: nodes (steps) + edges (branches with a natural-language
// condition). No numbered "goto" — edges point to a target node by id, and the
// UI shows the target by its title. position is for the visual editor; the
// list editor ignores it.
export type ScriptNode = {
  id: string;
  title: string;
  content: string;
  /** Optional override: when set, this step is owned by this agent_handle.
   *  null/undefined = inherit the campaign's primary agent. The worker uses
   *  this to trigger a handoff (AI persona swap or SIP transfer to human). */
  agent_handle_id?: string | null;
  position?: { x: number; y: number };
};

export type AgentHandleLite = {
  id: string;
  display_name: string;
  kind: "ai" | "human";
  ai_agent_id?: string | null;
};

/** Deterministic color per agent_handle id, so the same agent always gets the
 *  same badge color across both editors and the recap. djb2 hash → HSL hue. */
export function agentColor(handleId: string | null | undefined): {
  bg: string; fg: string; border: string;
} {
  if (!handleId) {
    return { bg: "transparent", fg: "var(--muted)", border: "var(--border)" };
  }
  let h = 5381;
  for (let i = 0; i < handleId.length; i++) h = ((h << 5) + h) + handleId.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return {
    bg: `hsl(${hue} 55% 22%)`,
    fg: `hsl(${hue} 85% 82%)`,
    border: `hsl(${hue} 65% 50%)`,
  };
}
export type ScriptEdge = {
  id: string;
  source: string; // node id
  target: string; // node id
  condition: string; // "Si oui", "Si pas intéressé", … (plain French)
};
export type ScriptGraph = {
  nodes: ScriptNode[];
  edges: ScriptEdge[];
};

export function emptyGraph(): ScriptGraph {
  return { nodes: [], edges: [] };
}

function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Normalize whatever is stored in script_versions.steps into a ScriptGraph.
 * Handles three shapes:
 *  - already a graph ({nodes, edges})         → used as-is
 *  - legacy array [{step,title,content,branches:[{label,goto}]}] → converted
 *  - empty / unknown                          → empty graph
 */
export function toGraph(raw: unknown): ScriptGraph {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "nodes" in (raw as object)) {
    const g = raw as ScriptGraph;
    return { nodes: g.nodes ?? [], edges: g.edges ?? [] };
  }
  const arr = Array.isArray(raw) ? (raw as Array<{ title?: string; content?: string; branches?: Array<{ label?: string; goto?: number | string }> }>) : [];
  const nodes: ScriptNode[] = arr.map((s, i) => ({
    id: `n${i + 1}`,
    title: s.title || `Étape ${i + 1}`,
    content: s.content || "",
    position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 160 },
  }));
  const edges: ScriptEdge[] = [];
  arr.forEach((s, i) => {
    (s.branches ?? []).forEach((b, bi) => {
      const targetIdx = Number(b.goto) - 1;
      const target = nodes[targetIdx]?.id;
      if (target) {
        edges.push({ id: `e${i}_${bi}`, source: nodes[i].id, target, condition: b.label || "" });
      }
    });
  });
  return { nodes, edges };
}

/**
 * Simple list-based editor over the graph model. Each node = a step (title +
 * content). Each node can have branches: "Si [condition] → [target step]",
 * the target picked from a dropdown of node titles (no numbers).
 */
export function ScriptEditor({
  value,
  onChange,
  handles = [],
}: {
  value: ScriptGraph;
  onChange: (next: ScriptGraph) => void;
  handles?: AgentHandleLite[];
}) {
  const t = useT();
  const { nodes, edges } = value;
  const handleById = new Map(handles.map((h) => [h.id, h]));
  const aiHandles = handles.filter((h) => h.kind === "ai");
  const humanHandles = handles.filter((h) => h.kind === "human");

  const updateNode = useCallback(
    (id: string, patch: Partial<ScriptNode>) => {
      onChange({ ...value, nodes: nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });
    },
    [value, nodes, onChange],
  );

  const addNode = useCallback(() => {
    const i = nodes.length;
    const node: ScriptNode = {
      id: uid("n"),
      title: `Étape ${i + 1}`,
      content: "",
      position: { x: (i % 3) * 240, y: Math.floor(i / 3) * 160 },
    };
    onChange({ ...value, nodes: [...nodes, node] });
  }, [value, nodes, onChange]);

  const removeNode = useCallback(
    (id: string) => {
      onChange({
        nodes: nodes.filter((n) => n.id !== id),
        edges: edges.filter((e) => e.source !== id && e.target !== id),
      });
    },
    [value, nodes, edges, onChange],
  );

  const addEdge = useCallback(
    (source: string) => {
      const target = nodes.find((n) => n.id !== source)?.id ?? source;
      onChange({
        ...value,
        edges: [...edges, { id: uid("e"), source, target, condition: "Si oui" }],
      });
    },
    [value, nodes, edges, onChange],
  );

  const updateEdge = useCallback(
    (id: string, patch: Partial<ScriptEdge>) => {
      onChange({ ...value, edges: edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    },
    [value, edges, onChange],
  );

  const removeEdge = useCallback(
    (id: string) => {
      onChange({ ...value, edges: edges.filter((e) => e.id !== id) });
    },
    [value, edges, onChange],
  );

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || t("(étape supprimée)");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {nodes.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {t("Aucune étape. Ajoutez la première étape de votre script.")}
        </p>
      )}
      {nodes.map((node, i) => {
        const outgoing = edges.filter((e) => e.source === node.id);
        return (
          <div
            key={node.id}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: 10,
              background: "var(--bg-2)",
              display: "grid",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 13 }}>{t("Étape")} {i + 1}</strong>
                {node.agent_handle_id && (() => {
                  const c = agentColor(node.agent_handle_id);
                  const h = handleById.get(node.agent_handle_id);
                  return (
                    <span
                      title={`${h?.kind === "human" ? t("Humain") : "IA"} — ${h?.display_name ?? node.agent_handle_id}`}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                        background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
                      }}
                    >
                      {h?.kind === "human" ? "👤" : "🤖"} {h?.display_name ?? t("Agent supprimé")}
                    </span>
                  );
                })()}
              </div>
              <button
                className="ghost"
                onClick={() => removeNode(node.id)}
                style={{ padding: "2px 8px", fontSize: 12, color: "var(--bad)" }}
                title={t("Supprimer l'étape")}
              >
                ✕
              </button>
            </div>
            <input
              value={node.title}
              onChange={(e) => updateNode(node.id, { title: e.target.value })}
              placeholder={t("Titre de l'étape (ex: Accroche)")}
              style={{ fontSize: 13 }}
            />
            <textarea
              rows={3}
              value={node.content}
              onChange={(e) => updateNode(node.id, { content: e.target.value })}
              placeholder={t("Ce que l'agent doit dire / faire à cette étape…")}
              style={{ fontSize: 13 }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="muted" style={{ fontSize: 11 }}>{t("Agent à cette étape :")}</span>
              <select
                value={node.agent_handle_id ?? ""}
                onChange={(e) =>
                  updateNode(node.id, { agent_handle_id: e.target.value || null })
                }
                style={{ fontSize: 12, flex: 1 }}
              >
                <option value="">{t("Hériter (agent de la campagne)")}</option>
                {aiHandles.length > 0 && (
                  <optgroup label="🤖 Agents IA">
                    {aiHandles.map((h) => (
                      <option key={h.id} value={h.id}>{h.display_name}</option>
                    ))}
                  </optgroup>
                )}
                {humanHandles.length > 0 && (
                  <optgroup label={t("👤 Agents humains")}>
                    {humanHandles.map((h) => (
                      <option key={h.id} value={h.id}>{h.display_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>

            {outgoing.length > 0 && (
              <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
                <div className="muted" style={{ fontSize: 11 }}>
                  {t("Branches — selon la réponse, l'agent enchaîne sur :")}
                </div>
                {outgoing.map((edge) => (
                  <div key={edge.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      value={edge.condition}
                      onChange={(e) => updateEdge(edge.id, { condition: e.target.value })}
                      placeholder={t("Si… (ex: Si le patient accepte)")}
                      style={{ flex: 1, fontSize: 12 }}
                    />
                    <span className="muted" style={{ fontSize: 12 }}>→</span>
                    <select
                      value={edge.target}
                      onChange={(e) => updateEdge(edge.id, { target: e.target.value })}
                      style={{ flex: 1, fontSize: 12 }}
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>{n.title}</option>
                      ))}
                    </select>
                    <button
                      className="ghost"
                      onClick={() => removeEdge(edge.id)}
                      style={{ padding: "2px 8px", fontSize: 12, color: "var(--bad)" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <button
                className="ghost"
                onClick={() => addEdge(node.id)}
                disabled={nodes.length < 2}
                style={{ padding: "4px 10px", fontSize: 12 }}
                title={nodes.length < 2 ? t("Ajoutez une 2e étape pour pouvoir brancher") : undefined}
              >
                + {t("Branche conditionnelle")}
              </button>
            </div>
          </div>
        );
      })}
      <div>
        <button onClick={addNode} style={{ padding: "8px 14px" }}>
          + {t("Ajouter une étape")}
        </button>
      </div>
    </div>
  );
}

// Merge several scripts into ONE continuous multi-agent "parcours" script.
//
// Each source script may be a legacy linear array
//   [{ step, title, content, branches:[{label, goto}], agent_handle_id? }]
// or already a graph { nodes:[{id,title,content,agent_handle_id}], edges:[{source,target,condition}] }.
//
// The result is always a GRAPH ({nodes,edges}) because only the graph form is
// rendered by the agent runtime with per-step agent handoff instructions
// (load_campaign_script). Node ids are namespaced per part to avoid collisions,
// and consecutive parts are wired end→start so the conversation flows
// Charlotte → Isabelle → Victoria, swapping persona at each boundary.

export interface GraphNode {
  id: string;
  title: string;
  content: string;
  agent_handle_id: string | null;
}
export interface GraphEdge {
  source: string;
  target: string;
  condition: string;
}
export interface ScriptGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MergePart {
  steps: unknown;
  /** Force every step of this part onto this agent (overrides per-step value).
   *  Leave undefined to keep whatever the source steps already carry. */
  agent_handle_id?: string | null;
  /** Human label (agent name) used in the connecting edge condition. */
  label?: string;
}

interface LegacyStep {
  step?: number;
  title?: string;
  content?: string;
  branches?: Array<{ label?: string; goto?: number | string }>;
  agent_handle_id?: string | null;
  id?: string;
}

function isGraph(steps: unknown): steps is ScriptGraph {
  return (
    !!steps &&
    typeof steps === "object" &&
    !Array.isArray(steps) &&
    Array.isArray((steps as ScriptGraph).nodes)
  );
}

function normalizePart(steps: unknown, partIdx: number, override?: string | null): ScriptGraph {
  const prefix = `p${partIdx}_`;

  if (isGraph(steps)) {
    const idMap = new Map<string, string>();
    const nodes: GraphNode[] = steps.nodes.map((n) => {
      const nid = prefix + String(n.id);
      idMap.set(String(n.id), nid);
      return {
        id: nid,
        title: String(n.title ?? ""),
        content: String(n.content ?? ""),
        agent_handle_id: override !== undefined ? override : n.agent_handle_id ?? null,
      };
    });
    const edges: GraphEdge[] = (Array.isArray(steps.edges) ? steps.edges : []).map((e) => ({
      source: idMap.get(String(e.source)) ?? prefix + String(e.source),
      target: idMap.get(String(e.target)) ?? prefix + String(e.target),
      condition: String(e.condition ?? ""),
    }));
    return { nodes, edges };
  }

  // Legacy linear array.
  const arr: LegacyStep[] = Array.isArray(steps) ? (steps as LegacyStep[]) : [];
  const nodes: GraphNode[] = arr.map((s, i) => ({
    id: `${prefix}n${i}`,
    title: String(s.title ?? `Étape ${i + 1}`),
    content: String(s.content ?? ""),
    agent_handle_id: override !== undefined ? override : s.agent_handle_id ?? null,
  }));
  const edges: GraphEdge[] = [];
  arr.forEach((s, i) => {
    for (const b of s.branches ?? []) {
      let tgt: number | null = null;
      if (typeof b.goto === "number") tgt = b.goto - 1;
      else if (typeof b.goto === "string" && /^\d+$/.test(b.goto)) tgt = Number(b.goto) - 1;
      if (tgt !== null && tgt >= 0 && tgt < arr.length) {
        edges.push({ source: `${prefix}n${i}`, target: `${prefix}n${tgt}`, condition: String(b.label ?? "") });
      }
    }
  });
  return { nodes, edges };
}

export function mergeScripts(parts: MergePart[]): ScriptGraph {
  const graphs = parts.map((p, idx) =>
    normalizePart(p.steps, idx, "agent_handle_id" in p ? p.agent_handle_id ?? null : undefined),
  );

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (const g of graphs) {
    nodes.push(...g.nodes);
    edges.push(...g.edges);
  }

  // Wire each part's last node to the next part's first node so the parcours
  // is continuous and the runtime hands off to the next agent.
  for (let k = 0; k < graphs.length - 1; k++) {
    const cur = graphs[k];
    const next = graphs[k + 1];
    if (cur.nodes.length && next.nodes.length) {
      const nextLabel = parts[k + 1].label ?? "agent suivant";
      edges.push({
        source: cur.nodes[cur.nodes.length - 1].id,
        target: next.nodes[0].id,
        condition: `Phase terminée → passe à ${nextLabel}`,
      });
    }
  }

  return { nodes, edges };
}

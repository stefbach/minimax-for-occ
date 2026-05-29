"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge as RFEdge,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/use-toast";

export type StepKind =
  | "welcome"
  | "menu_dtmf"
  | "gather_speech"
  | "ai_agent"
  | "transfer"
  | "route_queue"
  | "voicemail"
  | "hangup";

export type Step = {
  id: string;
  flow_id: string;
  kind: StepKind;
  label: string | null;
  config: Record<string, unknown>;
  position: { x?: number; y?: number } | null;
  created_at: string;
};

export type Edge = {
  id: string;
  flow_id: string;
  from_step_id: string;
  to_step_id: string;
  condition: { kind?: string; key?: string; [k: string]: unknown };
  position: number;
};

export type FlowFull = {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  start_step_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  steps: Step[];
  edges: Edge[];
};

type StepDef = {
  kind: StepKind;
  label: string;
  icon: string;
  color: string;
  description: string;
};

const STEP_DEFS: StepDef[] = [
  { kind: "welcome", label: "Welcome", icon: "▶", color: "#60a5fa", description: "Annonce TTS d'accueil" },
  { kind: "menu_dtmf", label: "Menu DTMF", icon: "⌗", color: "#fbbf24", description: "Choix par touche du clavier" },
  { kind: "gather_speech", label: "Gather voice", icon: "♪", color: "#a78bfa", description: "Reconnaissance vocale" },
  { kind: "ai_agent", label: "Agent IA", icon: "◇", color: "#ff6b35", description: "Conversation avec un agent IA" },
  { kind: "transfer", label: "Transfer", icon: "↳", color: "#4ade80", description: "Transfert vers un numéro" },
  { kind: "route_queue", label: "Queue", icon: "≡", color: "#22d3ee", description: "Mise en file d'attente" },
  { kind: "voicemail", label: "Voicemail", icon: "✉", color: "#f472b6", description: "Boîte vocale" },
  { kind: "hangup", label: "Hangup", icon: "✕", color: "#f87171", description: "Raccrocher" },
];

const KIND_BY: Record<StepKind, StepDef> = STEP_DEFS.reduce(
  (acc, d) => {
    acc[d.kind] = d;
    return acc;
  },
  {} as Record<StepKind, StepDef>,
);

type NodeData = {
  kind: StepKind;
  label: string;
  config: Record<string, unknown>;
  isStart: boolean;
};

// ─── Custom node ────────────────────────────────────────────────────────
function StepNode({ data, selected }: NodeProps) {
  const d = data as unknown as NodeData;
  const def = KIND_BY[d.kind];
  return (
    <div
      style={{
        background: "var(--panel)",
        border: `2px solid ${selected ? "var(--accent)" : def.color}`,
        borderRadius: 10,
        minWidth: 180,
        boxShadow: selected ? "0 0 0 3px var(--accent-soft)" : "0 2px 8px rgba(0,0,0,0.4)",
        color: "var(--text)",
        fontSize: 13,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: def.color }} />
      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(0,0,0,0.2)",
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
        }}
      >
        <span style={{ color: def.color, fontSize: 14 }}>{def.icon}</span>
        <span style={{ fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          {def.label}
        </span>
        {d.isStart && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 9,
              background: "var(--accent)",
              color: "#0a0a0a",
              padding: "1px 5px",
              borderRadius: 4,
              fontWeight: 700,
            }}
          >
            START
          </span>
        )}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontWeight: 500 }}>{d.label || def.label}</div>
        <ConfigPreview kind={d.kind} config={d.config} />
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: def.color }} />
    </div>
  );
}

function ConfigPreview({ kind, config }: { kind: StepKind; config: Record<string, unknown> }) {
  const ms = { color: "var(--muted)", fontSize: 11, marginTop: 4 } as const;
  if (kind === "welcome") {
    const t = (config.text as string) || "";
    return t ? <div style={ms}>« {t.length > 40 ? t.slice(0, 40) + "…" : t} »</div> : null;
  }
  if (kind === "menu_dtmf") {
    const opts = (config.options as Array<{ key?: string; label?: string }>) ?? [];
    return opts.length > 0 ? <div style={ms}>{opts.length} option(s)</div> : null;
  }
  if (kind === "ai_agent") {
    const id = config.agent_handle_id as string | undefined;
    return id ? <div style={ms}>handle: {id.slice(0, 8)}…</div> : null;
  }
  if (kind === "transfer") {
    return config.to_e164 ? <div style={ms}>→ {String(config.to_e164)}</div> : null;
  }
  if (kind === "route_queue") {
    return config.queue_id ? <div style={ms}>queue: {String(config.queue_id).slice(0, 8)}…</div> : null;
  }
  return null;
}

const nodeTypes = { step: StepNode };

// ─── Inner editor ──────────────────────────────────────────────────────
function InnerEditor({ flow }: { flow: FlowFull }) {
  const router = useRouter();
  const toast = useToast();
  const reactFlow = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const initialNodes: Node[] = useMemo(
    () =>
      flow.steps.map((s, i) => ({
        id: s.id,
        type: "step",
        position: {
          x: s.position?.x ?? 100 + (i % 4) * 240,
          y: s.position?.y ?? 80 + Math.floor(i / 4) * 160,
        },
        data: {
          kind: s.kind,
          label: s.label ?? KIND_BY[s.kind].label,
          config: s.config ?? {},
          isStart: flow.start_step_id === s.id,
        } satisfies NodeData,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const initialEdges: RFEdge[] = useMemo(
    () =>
      flow.edges.map((e) => ({
        id: e.id,
        source: e.from_step_id,
        target: e.to_step_id,
        label: edgeLabel(e.condition),
        style: { stroke: "var(--border-2)", strokeWidth: 2 },
        labelStyle: { fill: "var(--muted)", fontSize: 11 },
        labelBgStyle: { fill: "var(--panel)" },
        data: { condition: e.condition },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Track which edges are "new" (not yet in DB) and which db edges were deleted
  const dbEdgeIds = useRef<Set<string>>(new Set(flow.edges.map((e) => e.id)));
  const dbStepIds = useRef<Set<string>>(new Set(flow.steps.map((s) => s.id)));

  // selection
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const [startStepId, setStartStepId] = useState<string | null>(flow.start_step_id);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      const newId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setEdges((es) =>
        addEdge(
          {
            ...params,
            id: newId,
            label: "always",
            style: { stroke: "var(--border-2)", strokeWidth: 2 },
            labelStyle: { fill: "var(--muted)", fontSize: 11 },
            labelBgStyle: { fill: "var(--panel)" },
            data: { condition: { kind: "always" } },
          },
          es,
        ),
      );
    },
    [setEdges],
  );

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData("application/x-flow-kind") as StepKind;
      if (!kind || !KIND_BY[kind]) return;
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position = reactFlow.screenToFlowPosition({
        x: e.clientX - (bounds?.left ?? 0),
        y: e.clientY - (bounds?.top ?? 0),
      });
      const newId = `new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const def = KIND_BY[kind];
      setNodes((ns) => [
        ...ns,
        {
          id: newId,
          type: "step",
          position,
          data: {
            kind,
            label: def.label,
            config: defaultConfig(kind),
            isStart: false,
          } satisfies NodeData,
        },
      ]);
    },
    [reactFlow, setNodes],
  );

  const updateSelectedNode = useCallback(
    (patch: Partial<NodeData>) => {
      if (!selectedNodeId) return;
      setNodes((ns) =>
        ns.map((n) =>
          n.id === selectedNodeId
            ? { ...n, data: { ...(n.data as NodeData), ...patch } as unknown as Record<string, unknown> }
            : n,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const updateSelectedConfig = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      setNodes((ns) =>
        ns.map((n) => {
          if (n.id !== selectedNodeId) return n;
          const d = n.data as unknown as NodeData;
          return {
            ...n,
            data: { ...d, config: { ...d.config, ...patch } } as unknown as Record<string, unknown>,
          };
        }),
      );
    },
    [selectedNodeId, setNodes],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    if (!window.confirm("Supprimer cette étape ?")) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedNodeId));
    setEdges((es) => es.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    if (startStepId === selectedNodeId) setStartStepId(null);
    setSelectedNodeId(null);
  }, [selectedNodeId, setEdges, setNodes, startStepId]);

  const setAsStart = useCallback(() => {
    if (!selectedNodeId) return;
    setStartStepId(selectedNodeId);
    setNodes((ns) =>
      ns.map((n) => ({
        ...n,
        data: { ...(n.data as NodeData), isStart: n.id === selectedNodeId } as unknown as Record<string, unknown>,
      })),
    );
  }, [selectedNodeId, setNodes]);

  // ─── Save ──────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // 1. Build id remap. Iterate nodes. For "new_" ids → POST step; for existing → PUT step.
      const idRemap: Record<string, string> = {};

      for (const n of nodes) {
        const d = n.data as unknown as NodeData;
        const payload = {
          kind: d.kind,
          label: d.label,
          config: d.config,
          position: { x: n.position.x, y: n.position.y },
        };
        if (n.id.startsWith("new_")) {
          const res = await fetch(`/api/flows/${flow.id}/steps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) throw new Error("create step failed: " + (await res.text()));
          const created = (await res.json()) as { id: string };
          idRemap[n.id] = created.id;
        } else {
          const res = await fetch(`/api/flows/${flow.id}/steps`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: n.id, ...payload }),
          });
          if (!res.ok) throw new Error("update step failed: " + (await res.text()));
        }
      }

      // 2. Delete steps that existed but are gone from canvas.
      const currentNodeIds = new Set(nodes.map((n) => n.id));
      for (const dbId of dbStepIds.current) {
        if (!currentNodeIds.has(dbId)) {
          await fetch(`/api/flows/${flow.id}/steps/${dbId}`, { method: "DELETE" });
        }
      }

      // 3. Delete edges that existed but were removed from canvas.
      const currentEdgeIds = new Set(edges.map((e) => e.id));
      for (const dbId of dbEdgeIds.current) {
        if (!currentEdgeIds.has(dbId)) {
          await fetch(`/api/flows/${flow.id}/edges?id=${dbId}`, { method: "DELETE" });
        }
      }

      // 4. Create new edges. Skip existing (they don't need updates in our minimal model).
      const newEdgeRemap: Record<string, string> = {};
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (!e.id.startsWith("new_")) continue;
        const from = idRemap[e.source] ?? e.source;
        const to = idRemap[e.target] ?? e.target;
        const condition = (e.data as { condition?: Record<string, unknown> } | undefined)?.condition ?? {
          kind: "always",
        };
        const res = await fetch(`/api/flows/${flow.id}/edges`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_step_id: from,
            to_step_id: to,
            condition,
            position: i,
          }),
        });
        if (!res.ok) throw new Error("create edge failed: " + (await res.text()));
        const created = (await res.json()) as { id: string };
        newEdgeRemap[e.id] = created.id;
      }

      // 5. Update flow start_step_id (remapping if it was a new node).
      const finalStart = startStepId ? idRemap[startStepId] ?? startStepId : null;
      await fetch(`/api/flows/${flow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_step_id: finalStart }),
      });

      // 6. Update local id refs so subsequent saves see them as existing.
      setNodes((ns) =>
        ns.map((n) => (idRemap[n.id] ? { ...n, id: idRemap[n.id] } : n)),
      );
      setEdges((es) =>
        es.map((e) => {
          let next = e;
          if (newEdgeRemap[e.id]) next = { ...next, id: newEdgeRemap[e.id] };
          if (idRemap[next.source]) next = { ...next, source: idRemap[next.source] };
          if (idRemap[next.target]) next = { ...next, target: idRemap[next.target] };
          return next;
        }),
      );
      if (startStepId && idRemap[startStepId]) {
        setStartStepId(idRemap[startStepId]);
        if (selectedNodeId && idRemap[selectedNodeId]) setSelectedNodeId(idRemap[selectedNodeId]);
      }
      dbStepIds.current = new Set(nodes.map((n) => idRemap[n.id] ?? n.id));
      dbEdgeIds.current = new Set(edges.map((e) => newEdgeRemap[e.id] ?? e.id));

      setSavedAt(new Date());
      toast.success("Flow enregistré.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Enregistrement échoué : ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [edges, flow.id, nodes, router, selectedNodeId, setEdges, setNodes, startStepId, toast]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr 320px",
        height: "calc(100vh - 130px)",
        background: "var(--bg)",
      }}
    >
      {/* Left palette */}
      <aside
        style={{
          borderRight: "1px solid var(--border)",
          padding: 12,
          overflowY: "auto",
          background: "var(--bg-2)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--muted-2)",
            textTransform: "uppercase",
            letterSpacing: 1,
            padding: "4px 6px 10px",
          }}
        >
          Palette
        </div>
        {STEP_DEFS.map((d) => (
          <div
            key={d.kind}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-flow-kind", d.kind);
              e.dataTransfer.effectAllowed = "move";
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              marginBottom: 6,
              border: `1px solid var(--border)`,
              borderLeft: `3px solid ${d.color}`,
              borderRadius: 8,
              cursor: "grab",
              background: "var(--panel)",
              fontSize: 13,
            }}
            title={d.description}
          >
            <span style={{ color: d.color, fontSize: 14 }}>{d.icon}</span>
            <div>
              <div style={{ fontWeight: 500 }}>{d.label}</div>
              <div style={{ fontSize: 10, color: "var(--muted-2)" }}>{d.kind}</div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16, fontSize: 11, color: "var(--muted-2)", lineHeight: 1.5 }}>
          Glissez une étape sur le canvas pour l&apos;ajouter. Reliez les étapes en tirant depuis
          le point inférieur d&apos;un nœud vers le point supérieur d&apos;un autre.
        </div>
      </aside>

      {/* Canvas */}
      <div ref={wrapperRef} style={{ position: "relative" }} onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, n) => setSelectedNodeId(n.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#283045" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(n) => {
              const d = n.data as unknown as NodeData;
              return KIND_BY[d?.kind ?? "welcome"]?.color ?? "#888";
            }}
            style={{ background: "var(--panel)" }}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>

        {/* Save bar */}
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 10,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {error && (
            <div
              style={{
                background: "rgba(248,113,113,0.15)",
                border: "1px solid var(--bad)",
                color: "var(--bad)",
                padding: "6px 10px",
                borderRadius: 6,
                fontSize: 12,
                maxWidth: 320,
              }}
            >
              {error}
            </div>
          )}
          {savedAt && !error && (
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              Enregistré · {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button onClick={save} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {/* Right config panel */}
      <aside
        style={{
          borderLeft: "1px solid var(--border)",
          padding: 16,
          overflowY: "auto",
          background: "var(--bg-2)",
        }}
      >
        {!selectedNode ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "var(--muted-2)",
                marginBottom: 8,
              }}
            >
              Inspecteur
            </div>
            Sélectionnez une étape pour modifier sa configuration, ou glissez une étape depuis la
            palette de gauche pour l&apos;ajouter.
          </div>
        ) : (
          <NodeInspector
            node={selectedNode}
            isStart={startStepId === selectedNode.id}
            onChange={updateSelectedNode}
            onChangeConfig={updateSelectedConfig}
            onDelete={deleteSelected}
            onSetAsStart={setAsStart}
          />
        )}
      </aside>
    </div>
  );
}

export function FlowEditor({ flow }: { flow: FlowFull }) {
  return (
    <ReactFlowProvider>
      <InnerEditor flow={flow} />
    </ReactFlowProvider>
  );
}

// ─── Inspector ──────────────────────────────────────────────────────────
function NodeInspector({
  node,
  isStart,
  onChange,
  onChangeConfig,
  onDelete,
  onSetAsStart,
}: {
  node: Node;
  isStart: boolean;
  onChange: (patch: Partial<NodeData>) => void;
  onChangeConfig: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onSetAsStart: () => void;
}) {
  const d = node.data as unknown as NodeData;
  const def = KIND_BY[d.kind];
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 1,
          color: "var(--muted-2)",
          marginBottom: 8,
        }}
      >
        Inspecteur
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ color: def.color, fontSize: 18 }}>{def.icon}</span>
        <div>
          <div style={{ fontWeight: 600 }}>{def.label}</div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>{d.kind}</div>
        </div>
      </div>

      <label>Label</label>
      <input
        value={d.label}
        onChange={(e) => onChange({ label: e.target.value })}
        placeholder={def.label}
      />

      <div style={{ height: 12 }} />

      <KindConfig kind={d.kind} config={d.config} onChange={onChangeConfig} />

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        <button
          className={isStart ? "subtle" : "ghost"}
          onClick={onSetAsStart}
          disabled={isStart}
          style={{ width: "100%" }}
        >
          {isStart ? "✓ Étape de départ" : "Définir comme étape de départ"}
        </button>
        <button className="danger" onClick={onDelete} style={{ width: "100%" }}>
          Supprimer cette étape
        </button>
      </div>
    </div>
  );
}

function defaultConfig(kind: StepKind): Record<string, unknown> {
  switch (kind) {
    case "welcome":
      return { text: "Bonjour, bienvenue.", voice_id: "" };
    case "menu_dtmf":
      return { prompt: "Tapez 1 pour…", options: [{ key: "1", label: "Option 1" }], timeout_s: 5 };
    case "gather_speech":
      return { prompt: "Que puis-je faire pour vous ?", language: "fr-FR", timeout_s: 6 };
    case "ai_agent":
      return { agent_handle_id: "", max_turns: 12 };
    case "transfer":
      return { to_e164: "", ring_timeout_s: 25 };
    case "route_queue":
      return { queue_id: "", priority: 5 };
    case "voicemail":
      return { prompt: "Laissez votre message après le bip.", max_duration_s: 90 };
    case "hangup":
      return { reason: "completed" };
  }
}

function KindConfig({
  kind,
  config,
  onChange,
}: {
  kind: StepKind;
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const str = (k: string) => (config[k] as string) ?? "";
  const num = (k: string) => (typeof config[k] === "number" ? (config[k] as number) : "");

  if (kind === "welcome") {
    return (
      <>
        <label>Texte d&apos;accueil (TTS)</label>
        <textarea value={str("text")} onChange={(e) => onChange({ text: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Voice ID (optionnel)</label>
        <input value={str("voice_id")} onChange={(e) => onChange({ voice_id: e.target.value })} />
      </>
    );
  }
  if (kind === "menu_dtmf") {
    const options = (config.options as Array<{ key: string; label: string }>) ?? [];
    return (
      <>
        <label>Prompt</label>
        <textarea value={str("prompt")} onChange={(e) => onChange({ prompt: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Options DTMF</label>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input
              style={{ width: 60 }}
              value={opt.key}
              placeholder="1"
              onChange={(e) => {
                const next = [...options];
                next[i] = { ...opt, key: e.target.value };
                onChange({ options: next });
              }}
            />
            <input
              value={opt.label}
              placeholder="Libellé"
              onChange={(e) => {
                const next = [...options];
                next[i] = { ...opt, label: e.target.value };
                onChange({ options: next });
              }}
            />
            <button
              className="ghost"
              style={{ padding: "6px 10px" }}
              onClick={() => onChange({ options: options.filter((_, idx) => idx !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="subtle"
          style={{ marginTop: 4 }}
          onClick={() =>
            onChange({
              options: [...options, { key: String(options.length + 1), label: "" }],
            })
          }
        >
          + Ajouter option
        </button>
        <div style={{ height: 10 }} />
        <label>Timeout (s)</label>
        <input
          type="number"
          value={num("timeout_s")}
          onChange={(e) => onChange({ timeout_s: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "gather_speech") {
    return (
      <>
        <label>Prompt</label>
        <textarea value={str("prompt")} onChange={(e) => onChange({ prompt: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Langue</label>
        <input value={str("language")} onChange={(e) => onChange({ language: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Timeout (s)</label>
        <input
          type="number"
          value={num("timeout_s")}
          onChange={(e) => onChange({ timeout_s: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "ai_agent") {
    return (
      <>
        <label>Agent handle ID</label>
        <input
          value={str("agent_handle_id")}
          onChange={(e) => onChange({ agent_handle_id: e.target.value })}
          placeholder="uuid de l'agent_handle"
        />
        <div style={{ height: 10 }} />
        <label>Max turns</label>
        <input
          type="number"
          value={num("max_turns")}
          onChange={(e) => onChange({ max_turns: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "transfer") {
    return (
      <>
        <label>Numéro de destination (E.164)</label>
        <input
          value={str("to_e164")}
          onChange={(e) => onChange({ to_e164: e.target.value })}
          placeholder="+33123456789"
        />
        <div style={{ height: 10 }} />
        <label>Ring timeout (s)</label>
        <input
          type="number"
          value={num("ring_timeout_s")}
          onChange={(e) => onChange({ ring_timeout_s: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "route_queue") {
    return (
      <>
        <label>Queue ID</label>
        <input value={str("queue_id")} onChange={(e) => onChange({ queue_id: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Priorité</label>
        <input
          type="number"
          value={num("priority")}
          onChange={(e) => onChange({ priority: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "voicemail") {
    return (
      <>
        <label>Prompt</label>
        <textarea value={str("prompt")} onChange={(e) => onChange({ prompt: e.target.value })} />
        <div style={{ height: 10 }} />
        <label>Durée max (s)</label>
        <input
          type="number"
          value={num("max_duration_s")}
          onChange={(e) => onChange({ max_duration_s: Number(e.target.value) })}
        />
      </>
    );
  }
  if (kind === "hangup") {
    return (
      <>
        <label>Raison</label>
        <input value={str("reason")} onChange={(e) => onChange({ reason: e.target.value })} />
      </>
    );
  }
  return null;
}

function edgeLabel(cond: { kind?: string; key?: string } | undefined): string {
  if (!cond || !cond.kind || cond.kind === "always") return "";
  if (cond.kind === "dtmf" && cond.key) return `DTMF ${cond.key}`;
  return cond.kind;
}

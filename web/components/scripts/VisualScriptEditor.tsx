"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { ScriptGraph, ScriptNode } from "./ScriptEditor";

function uid(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Custom node: a script step with inline title + content ────────────────
// Callbacks travel inside node.data so the rendered node can mutate the graph
// (React Flow re-passes data on every render). The index signature keeps the
// data type assignable to React Flow's `Record<string, unknown>` constraint.
type StepData = {
  title: string;
  content: string;
  onChange: (id: string, patch: Partial<ScriptNode>) => void;
  onDelete: (id: string) => void;
  [key: string]: unknown;
};

type BranchData = {
  condition: string;
  onChange: (id: string, condition: string) => void;
  onDelete: (id: string) => void;
  [key: string]: unknown;
};

const HANDLE_STYLE = { width: 10, height: 10, background: "var(--accent)" } as const;

function StepNode({ id, data, selected }: NodeProps) {
  const d = data as StepData;
  return (
    <div
      style={{
        width: 230,
        border: "1px solid",
        borderColor: selected ? "var(--accent)" : "var(--border)",
        borderRadius: 10,
        background: "var(--bg-2)",
        padding: 8,
        display: "grid",
        gap: 6,
        boxShadow: selected ? "0 0 0 2px var(--accent-soft)" : "none",
      }}
    >
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <input
          className="nodrag"
          value={d.title}
          onChange={(e) => d.onChange(id, { title: e.target.value })}
          placeholder="Titre de l'étape"
          style={{ flex: 1, fontSize: 12, fontWeight: 600 }}
        />
        <button
          className="nodrag ghost"
          onClick={() => d.onDelete(id)}
          title="Supprimer l'étape"
          style={{ padding: "2px 6px", fontSize: 11, color: "var(--bad)" }}
        >
          ✕
        </button>
      </div>
      <textarea
        className="nodrag nowheel"
        rows={3}
        value={d.content}
        onChange={(e) => d.onChange(id, { content: e.target.value })}
        placeholder="Ce que l'agent dit / fait…"
        style={{ fontSize: 12, resize: "none" }}
      />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />
    </div>
  );
}

function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const d = data as BranchData;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            display: "flex",
            gap: 4,
            alignItems: "center",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "2px 4px",
          }}
        >
          <input
            value={d?.condition ?? ""}
            onChange={(e) => d.onChange(id, e.target.value)}
            placeholder="Si…"
            style={{ fontSize: 11, width: 120 }}
          />
          <button
            className="ghost"
            onClick={() => d.onDelete(id)}
            title="Supprimer la branche"
            style={{ padding: "0 5px", fontSize: 11, color: "var(--bad)" }}
          >
            ✕
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * Visual flowchart editor over the same ScriptGraph model as the list editor.
 * Drag to reposition, drag handle-to-handle to branch, edit condition on the
 * edge label. The component initializes from `value` on mount and pushes every
 * change up via `onChange`; it intentionally does NOT re-sync from `value`
 * afterwards (the parent swaps editors by remount, so each mount is a fresh
 * snapshot — that avoids a feedback loop with the shared graph state).
 */
export function VisualScriptEditor({
  value,
  onChange,
}: {
  value: ScriptGraph;
  onChange: (next: ScriptGraph) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StepData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<BranchData>>([]);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const patchNode = useCallback(
    (id: string, patch: Partial<ScriptNode>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: { ...(n.data as StepData), ...patch } } : n)),
      );
    },
    [setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    },
    [setNodes, setEdges],
  );

  const patchEdge = useCallback(
    (id: string, condition: string) => {
      setEdges((es) =>
        es.map((e) => (e.id === id ? { ...e, data: { ...(e.data as BranchData), condition } } : e)),
      );
    },
    [setEdges],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((es) => es.filter((e) => e.id !== id));
    },
    [setEdges],
  );

  // Initialize from `value` once, on mount.
  useEffect(() => {
    setNodes(
      value.nodes.map((n, i) => ({
        id: n.id,
        type: "step",
        position: n.position ?? { x: (i % 3) * 270, y: Math.floor(i / 3) * 200 },
        data: { title: n.title, content: n.content, onChange: patchNode, onDelete: deleteNode },
      })),
    );
    setEdges(
      value.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "branch",
        data: { condition: e.condition, onChange: patchEdge, onDelete: deleteEdge },
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push every structural/position change back up to the shared graph.
  useEffect(() => {
    const graph: ScriptGraph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        title: (n.data as StepData).title,
        content: (n.data as StepData).content,
        position: n.position,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        condition: (e.data as BranchData | undefined)?.condition ?? "",
      })),
    };
    onChangeRef.current(graph);
  }, [nodes, edges]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const next: Edge<BranchData> = {
        id: uid("e"),
        source: c.source,
        target: c.target,
        sourceHandle: c.sourceHandle ?? undefined,
        targetHandle: c.targetHandle ?? undefined,
        type: "branch",
        data: { condition: "Si oui", onChange: patchEdge, onDelete: deleteEdge },
      };
      setEdges((es) => [...es, next]);
    },
    [setEdges, patchEdge, deleteEdge],
  );

  const addNode = useCallback(() => {
    setNodes((ns) => {
      const i = ns.length;
      return [
        ...ns,
        {
          id: uid("n"),
          type: "step",
          position: { x: (i % 3) * 270, y: Math.floor(i / 3) * 200 },
          data: { title: `Étape ${i + 1}`, content: "", onChange: patchNode, onDelete: deleteNode },
        },
      ];
    });
  }, [setNodes, patchNode, deleteNode]);

  const nodeTypes = useMemo(() => ({ step: StepNode }), []);
  const edgeTypes = useMemo(() => ({ branch: BranchEdge }), []);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={addNode} style={{ padding: "6px 12px", fontSize: 13 }}>
          + Ajouter une étape
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          Glissez une étape pour la déplacer · tirez d&apos;un point à l&apos;autre pour créer une branche · éditez la condition sur la flèche.
        </span>
      </div>
      <div
        style={{
          height: "clamp(440px, 72vh, 760px)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.25 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

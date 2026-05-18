"use client";

import { useCallback } from "react";

export type ScriptStep = {
  step: number;
  title: string;
  content: string;
  branches?: Array<{ label: string; goto: number | string }>;
};

/**
 * Lightweight list-based editor: each step has a title + content, optional
 * branches (label → target step number). Steps can be reordered with ↑/↓
 * buttons (no external drag-drop dep) and renumbered on save.
 */
export function ScriptEditor({
  value,
  onChange,
}: {
  value: ScriptStep[];
  onChange: (next: ScriptStep[]) => void;
}) {
  const update = useCallback(
    (i: number, patch: Partial<ScriptStep>) => {
      const next = value.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
      onChange(next);
    },
    [value, onChange],
  );

  const move = useCallback(
    (i: number, dir: -1 | 1) => {
      const j = i + dir;
      if (j < 0 || j >= value.length) return;
      const next = [...value];
      const [picked] = next.splice(i, 1);
      next.splice(j, 0, picked);
      onChange(next.map((s, idx) => ({ ...s, step: idx + 1 })));
    },
    [value, onChange],
  );

  const remove = useCallback(
    (i: number) => {
      const next = value.filter((_, idx) => idx !== i);
      onChange(next.map((s, idx) => ({ ...s, step: idx + 1 })));
    },
    [value, onChange],
  );

  const add = useCallback(() => {
    const nextStep = value.length + 1;
    onChange([
      ...value,
      {
        step: nextStep,
        title: `Étape ${nextStep}`,
        content: "",
        branches: [],
      },
    ]);
  }, [value, onChange]);

  const addBranch = useCallback(
    (i: number) => {
      const step = value[i];
      const branches = [
        ...(step.branches ?? []),
        { label: "Si oui", goto: i + 2 },
      ];
      update(i, { branches });
    },
    [value, update],
  );

  const updateBranch = useCallback(
    (
      i: number,
      bi: number,
      patch: Partial<{ label: string; goto: number | string }>,
    ) => {
      const step = value[i];
      const branches = (step.branches ?? []).map((b, idx) =>
        idx === bi ? { ...b, ...patch } : b,
      );
      update(i, { branches });
    },
    [value, update],
  );

  const removeBranch = useCallback(
    (i: number, bi: number) => {
      const step = value[i];
      const branches = (step.branches ?? []).filter((_, idx) => idx !== bi);
      update(i, { branches });
    },
    [value, update],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {value.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Aucune étape. Ajoutez la première étape de votre script.
        </p>
      )}
      {value.map((step, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 10,
            background: "var(--bg-2)",
            display: "grid",
            gap: 6,
          }}
        >
          <div
            style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
          >
            <strong style={{ fontSize: 13 }}>Étape {i + 1}</strong>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                className="ghost"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                style={{ padding: "2px 8px", fontSize: 12 }}
                title="Monter"
              >
                ↑
              </button>
              <button
                className="ghost"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                style={{ padding: "2px 8px", fontSize: 12 }}
                title="Descendre"
              >
                ↓
              </button>
              <button
                className="ghost"
                onClick={() => remove(i)}
                style={{
                  padding: "2px 8px",
                  fontSize: 12,
                  color: "var(--bad)",
                }}
              >
                ✕
              </button>
            </div>
          </div>
          <input
            value={step.title}
            onChange={(e) => update(i, { title: e.target.value })}
            placeholder="Titre de l'étape (ex: Accroche)"
            style={{ fontSize: 13 }}
          />
          <textarea
            rows={3}
            value={step.content}
            onChange={(e) => update(i, { content: e.target.value })}
            placeholder="Contenu / dialogue à dérouler à l'oral…"
            style={{ fontSize: 13 }}
          />
          {(step.branches ?? []).length > 0 && (
            <div style={{ display: "grid", gap: 4 }}>
              <div className="muted" style={{ fontSize: 11 }}>Branches</div>
              {(step.branches ?? []).map((b, bi) => (
                <div key={bi} style={{ display: "flex", gap: 6 }}>
                  <input
                    value={b.label}
                    onChange={(e) =>
                      updateBranch(i, bi, { label: e.target.value })
                    }
                    placeholder="Libellé (ex: Si refus)"
                    style={{ flex: 1, fontSize: 12 }}
                  />
                  <input
                    value={String(b.goto)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const n = Number(raw);
                      updateBranch(i, bi, {
                        goto: Number.isFinite(n) && raw !== "" ? n : raw,
                      });
                    }}
                    placeholder="→ étape"
                    style={{ width: 80, fontSize: 12 }}
                  />
                  <button
                    className="ghost"
                    onClick={() => removeBranch(i, bi)}
                    style={{
                      padding: "2px 8px",
                      fontSize: 12,
                      color: "var(--bad)",
                    }}
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
              onClick={() => addBranch(i)}
              style={{ padding: "4px 10px", fontSize: 12 }}
            >
              + Branche
            </button>
          </div>
        </div>
      ))}
      <div>
        <button onClick={add} style={{ padding: "8px 14px" }}>
          + Ajouter une étape
        </button>
      </div>
    </div>
  );
}

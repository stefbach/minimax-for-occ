"use client";

import { useCallback, useEffect, useState } from "react";

type ScriptStep = {
  step?: number;
  title?: string;
  content?: string;
  branches?: Array<{ label?: string; goto?: number | string }>;
};

type CallContext = {
  call: { id: string; contact_id: string | null } | null;
  contact: { id: string; display_name: string | null } | null;
  campaign:
    | { id: string; name: string; mission: string | null; script_id: string | null }
    | null;
  script:
    | {
        id: string;
        name: string;
        mission: string | null;
        version: number;
        steps: ScriptStep[];
      }
    | null;
  interactions: Array<unknown>;
};

/**
 * Live "Script en cours" panel. Polls /api/calls/[id]/context to find the
 * script attached to the call's campaign, walks through steps with
 * Previous/Next buttons, and lets the human log an interaction note tied
 * to the current step.
 *
 * Renders nothing when the active call has no script (graceful no-op so
 * the existing softphone layout is unchanged for non-campaign calls).
 */
export function ScriptPanel({ callId }: { callId: string | null }) {
  const [ctx, setCtx] = useState<CallContext | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!callId) {
      setCtx(null);
      return;
    }
    try {
      const r = await fetch(`/api/calls/${callId}/context`);
      if (!r.ok) {
        setCtx(null);
        return;
      }
      const data = (await r.json()) as CallContext;
      setCtx(data);
    } catch {
      setCtx(null);
    }
  }, [callId]);

  useEffect(() => {
    setStepIdx(0);
    void load();
    if (!callId) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [callId, load]);

  const addInteraction = useCallback(async () => {
    if (!ctx?.contact?.id || !note.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const step = ctx.script?.steps?.[stepIdx];
      const r = await fetch(`/api/contacts/${ctx.contact.id}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          summary: note.trim(),
          call_id: ctx.call?.id ?? null,
          details: step
            ? { script_step: step.step ?? stepIdx + 1, step_title: step.title }
            : null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "post failed");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  }, [ctx, note, stepIdx]);

  // Graceful no-op: no call, no script → render nothing.
  if (
    !callId ||
    !ctx?.script ||
    !Array.isArray(ctx.script.steps) ||
    ctx.script.steps.length === 0
  ) {
    return null;
  }

  const steps = ctx.script.steps;
  const step = steps[Math.min(stepIdx, steps.length - 1)];

  return (
    <div
      className="card"
      style={{
        marginTop: 12,
        background: "var(--bg-2)",
        borderColor: "var(--accent)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0 }}>Script en cours · {ctx.script.name}</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            v{ctx.script.version} · mission {ctx.script.mission ?? "—"}
            {ctx.campaign && <> · campagne {ctx.campaign.name}</>}
          </div>
        </div>
        <span className="tag" style={{ fontSize: 11 }}>
          étape {stepIdx + 1} / {steps.length}
        </span>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: 10,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <strong style={{ fontSize: 14 }}>
          {step.title ?? `Étape ${stepIdx + 1}`}
        </strong>
        <div style={{ marginTop: 6, whiteSpace: "pre-wrap", fontSize: 13 }}>
          {step.content ?? ""}
        </div>
        {(step.branches ?? []).length > 0 && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {(step.branches ?? []).map((b, i) => {
              const target = typeof b.goto === "number" ? b.goto : Number(b.goto);
              return (
                <button
                  key={i}
                  className="ghost"
                  onClick={() => {
                    if (
                      Number.isFinite(target) &&
                      target >= 1 &&
                      target <= steps.length
                    ) {
                      setStepIdx(target - 1);
                    }
                  }}
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  {b.label ?? "→"} · vers {b.goto}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
        <button
          className="ghost"
          onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
          disabled={stepIdx === 0}
        >
          ← Précédent
        </button>
        <button
          onClick={() =>
            setStepIdx((i) => Math.min(steps.length - 1, i + 1))
          }
          disabled={stepIdx >= steps.length - 1}
        >
          Étape suivante →
        </button>
      </div>

      {ctx.contact?.id && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note liée à cette étape…"
            style={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={addInteraction}
              disabled={posting || !note.trim()}
              style={{ padding: "6px 12px", fontSize: 12 }}
            >
              {posting ? "…" : "+ Ajouter note interaction"}
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--bad)", fontSize: 11 }}>{error}</div>
          )}
        </div>
      )}
    </div>
  );
}

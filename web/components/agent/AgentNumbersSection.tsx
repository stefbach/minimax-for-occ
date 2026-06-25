"use client";

import { useCallback, useEffect, useState } from "react";

// "Numéros pris en charge" — vue côté agent du routing entrant. Autonome :
// charge l'état et enregistre via /api/agents/[id]/numbers, indépendamment du
// submit du formulaire agent (pour ne pas alourdir onSubmit). Affiché
// uniquement en édition (un agent doit déjà exister + avoir un id).
interface NumRow {
  id: string;
  e164: string;
  label: string | null;
  inbound_enabled: boolean;
  assigned: boolean;
  taken_by: string | null;
}

export function AgentNumbersSection({ agentId }: { agentId: string }) {
  const [numbers, setNumbers] = useState<NumRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/numbers`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      const nums = ((j as { numbers?: NumRow[] }).numbers ?? []) as NumRow[];
      setNumbers(nums);
      setSel(new Set(nums.filter((n) => n.assigned).map((n) => n.id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string, on: boolean) {
    setSel((prev) => {
      const s = new Set(prev);
      if (on) s.add(id);
      else s.delete(id);
      return s;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/agents/${agentId}/numbers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ number_ids: Array.from(sel) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
      setSaved(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>📞 Numéros pris en charge</h3>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
        Coche les numéros sur lesquels cet agent décroche les appels <strong>entrants</strong>.
        Rappel : l'entrant ne se déclenche que si le numéro a aussi son interrupteur «&nbsp;Entrant&nbsp;» sur
        ON (page <em>Numéros de téléphone</em>).
      </p>
      {loading ? (
        <div className="muted">Chargement…</div>
      ) : (
        <>
          {numbers.length === 0 && <div className="muted">Aucun numéro dans l'organisation.</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {numbers.map((n) => {
              const checked = sel.has(n.id);
              return (
                <label
                  key={n.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    margin: 0,
                    padding: "9px 12px",
                    fontSize: 13,
                    fontWeight: 400,
                    color: "var(--text)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: checked ? "var(--bg-2)" : "transparent",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggle(n.id, e.target.checked)}
                  />
                  <span className="kbd" style={{ whiteSpace: "nowrap" }}>{n.e164}</span>
                  <span style={{ color: "var(--muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {n.label || "—"}
                    {n.taken_by && !checked && (
                      <span style={{ fontSize: 11 }}> · actuellement : {n.taken_by}</span>
                    )}
                  </span>
                  {n.inbound_enabled ? (
                    <span className="tag good" style={{ fontSize: 10, whiteSpace: "nowrap" }}>entrant ON</span>
                  ) : (
                    <span className="tag" style={{ fontSize: 10, whiteSpace: "nowrap" }}>entrant OFF</span>
                  )}
                </label>
              );
            })}
          </div>
          {err && <div style={{ color: "var(--bad)", fontSize: 13, marginTop: 8 }}>{err}</div>}
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" onClick={save} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer les numéros"}
            </button>
            {saved && <span style={{ color: "var(--good)", fontSize: 12 }}>✓ Enregistré</span>}
          </div>
        </>
      )}
    </div>
  );
}

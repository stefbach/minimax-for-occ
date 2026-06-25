"use client";

import { useCallback, useEffect, useState } from "react";

type DncRow = {
  id: string;
  e164: string;
  reason: string | null;
  added_at: string;
  added_by: string | null;
};

const E164_RE = /^\+\d{6,15}$/;

export function ComplianceClient() {
  const [rows, setRows] = useState<DncRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [e164, setE164] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/dnc", { cache: "no-store" });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${r.status}`);
      }
      setRows(((await r.json()) as DncRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addOne = useCallback(async () => {
    if (!E164_RE.test(e164.trim())) {
      setError("Invalid number. E.164 format required (e.g. +33612345678).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/dnc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164: e164.trim(), reason: reason.trim() || undefined }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setE164("");
      setReason("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [e164, reason, refresh]);

  const addBulk = useCallback(async () => {
    const lines = bulkText
      .split(/\r?\n|,|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      setError("Paste at least one number.");
      return;
    }
    const entries = lines.map((line) => {
      // Allow "e164<TAB|space>reason"
      const m = line.match(/^(\+\d{6,15})\s+(.+)$/);
      if (m) return { e164: m[1], reason: m[2] };
      return { e164: line };
    });
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/dnc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
      setBulkText("");
      setBulkOpen(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [bulkText, refresh]);

  const removeOne = useCallback(
    async (id: string) => {
      if (!confirm("Remove this number from the DNC list?")) return;
      try {
        const r = await fetch(`/api/admin/dnc/${id}`, { method: "DELETE" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error ?? `HTTP ${r.status}`);
        }
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh],
  );

  return (
    <div>
      <div className="card" style={{ marginBottom: 18 }}>
        <h3 style={{ marginTop: 0 }}>Add a number</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="tel"
            placeholder="+33612345678"
            value={e164}
            onChange={(e) => setE164(e.target.value)}
            style={{ minWidth: 180 }}
            disabled={busy}
          />
          <input
            type="text"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ minWidth: 240, flex: 1 }}
            disabled={busy}
          />
          <button onClick={() => void addOne()} disabled={busy || !e164.trim()}>
            {busy ? "…" : "Add"}
          </button>
          <button className="ghost" onClick={() => setBulkOpen((v) => !v)} disabled={busy}>
            {bulkOpen ? "Close import" : "Bulk import"}
          </button>
        </div>
        {bulkOpen && (
          <div style={{ marginTop: 12 }}>
            <textarea
              placeholder={"One number per line (E.164).\nAdvanced format: +33612345678  reason"}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
              disabled={busy}
            />
            <div style={{ marginTop: 8 }}>
              <button onClick={() => void addBulk()} disabled={busy || !bulkText.trim()}>
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, color: "var(--bad)" }}>
          {error}
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>DNC list ({rows.length})</h3>
          <button className="ghost" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="muted" style={{ marginTop: 12 }}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted" style={{ marginTop: 12, margin: 0 }}>
            No blocked numbers yet.
          </p>
        ) : (
          <table className="list" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Number</th>
                <th>Reason</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="kbd">{r.e164}</span></td>
                  <td>{r.reason ?? <span className="muted">—</span>}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {new Date(r.added_at).toLocaleString()}
                  </td>
                  <td>
                    <button className="ghost" onClick={() => void removeOne(r.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

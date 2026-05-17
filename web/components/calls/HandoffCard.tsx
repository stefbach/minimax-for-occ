"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Handle = {
  id: string;
  kind: "ai" | "human";
  display_name: string;
  user_id: string | null;
  active: boolean;
};

type Presence = {
  user_id: string;
  status: string;
};

export function HandoffCard({
  callId,
  orgId,
  currentAgentHandleId,
  onChanged,
}: {
  callId: string;
  orgId: string;
  currentAgentHandleId: string | null;
  onChanged: () => void;
}) {
  const [handles, setHandles] = useState<Handle[]>([]);
  const [presence, setPresence] = useState<Map<string, string>>(new Map());
  const [selectedAi, setSelectedAi] = useState<string>("");
  const [selectedHuman, setSelectedHuman] = useState<string>("");
  const [e164, setE164] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    (async () => {
      const { data: h } = await sb
        .from("agent_handles")
        .select("id, kind, display_name, user_id, active")
        .eq("org_id", orgId)
        .eq("active", true)
        .order("display_name", { ascending: true });
      setHandles((h ?? []) as Handle[]);

      const { data: p } = await sb
        .from("human_presence")
        .select("user_id, status")
        .eq("org_id", orgId);
      const map = new Map<string, string>();
      for (const row of (p ?? []) as Presence[]) {
        map.set(row.user_id, row.status);
      }
      setPresence(map);
    })().catch(() => {});
  }, [orgId]);

  const aiHandles = useMemo(
    () => handles.filter((h) => h.kind === "ai" && h.id !== currentAgentHandleId),
    [handles, currentAgentHandleId],
  );
  const humanHandlesAvailable = useMemo(
    () =>
      handles.filter(
        (h) =>
          h.kind === "human" &&
          h.id !== currentAgentHandleId &&
          h.user_id != null &&
          presence.get(h.user_id) === "available",
      ),
    [handles, presence, currentAgentHandleId],
  );

  const handoff = useCallback(
    async (targetId: string, label: string) => {
      if (!targetId) return;
      setBusy(label);
      setMsg(null);
      try {
        const r = await fetch(`/api/calls/${callId}/handoff`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target_agent_handle_id: targetId }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        setMsg({ kind: "ok", text: "Transfert effectué." });
        onChanged();
      } catch (e) {
        setMsg({
          kind: "err",
          text: e instanceof Error ? e.message : String(e),
        });
      } finally {
        setBusy(null);
      }
    },
    [callId, onChanged],
  );

  const transferPstn = useCallback(async () => {
    if (!e164) return;
    setBusy("pstn");
    setMsg(null);
    try {
      const r = await fetch(`/api/calls/${callId}/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ e164 }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      setMsg({ kind: "ok", text: "Transfert PSTN demandé." });
      setE164("");
      onChanged();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }, [callId, e164, onChanged]);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <h3>Transfert / Handoff</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Réorienter l&apos;appel vers un agent IA, un humain disponible ou un numéro
        externe.
      </p>

      {msg && (
        <div
          style={{
            marginBottom: 12,
            fontSize: 13,
            color: msg.kind === "ok" ? "var(--good)" : "var(--bad)",
          }}
        >
          {msg.text}
        </div>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Vers un agent IA
          </div>
          <select
            value={selectedAi}
            onChange={(e) => setSelectedAi(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          >
            <option value="">— Choisir un agent IA —</option>
            {aiHandles.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name}
              </option>
            ))}
          </select>
          <button
            disabled={!selectedAi || busy !== null}
            onClick={() => void handoff(selectedAi, "ai")}
          >
            {busy === "ai" ? "Transfert…" : "Transférer vers cet agent IA"}
          </button>
        </div>

        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Vers un agent humain (disponible)
          </div>
          <select
            value={selectedHuman}
            onChange={(e) => setSelectedHuman(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          >
            <option value="">— Choisir un humain disponible —</option>
            {humanHandlesAvailable.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name} · disponible
              </option>
            ))}
          </select>
          <button
            disabled={!selectedHuman || busy !== null}
            onClick={() => void handoff(selectedHuman, "human")}
          >
            {busy === "human" ? "Transfert…" : "Transférer"}
          </button>
          {humanHandlesAvailable.length === 0 && (
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Aucun humain disponible.
            </div>
          )}
        </div>

        <div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
            Vers un numéro externe (PSTN)
          </div>
          <input
            type="tel"
            placeholder="+33123456789"
            value={e164}
            onChange={(e) => setE164(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <button
            disabled={!e164 || busy !== null}
            onClick={() => void transferPstn()}
          >
            {busy === "pstn" ? "Transfert…" : "Transférer (PSTN)"}
          </button>
        </div>
      </div>
    </div>
  );
}

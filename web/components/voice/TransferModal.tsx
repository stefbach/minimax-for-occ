"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useT } from "@/lib/i18n";

type Handle = {
  id: string;
  kind: "ai" | "human";
  display_name: string;
  user_id: string | null;
  active: boolean;
};

type Presence = { user_id: string; status: string };

export function TransferModal({
  callId,
  orgId,
  currentAgentHandleId,
  excludeUserId,
  onClose,
  onTransferred,
}: {
  callId: string;
  orgId: string;
  currentAgentHandleId: string | null;
  /** Hide the agent_handle that belongs to this user (= "me"). */
  excludeUserId?: string | null;
  onClose: () => void;
  onTransferred: () => void;
}) {
  const t = useT();
  const [handles, setHandles] = useState<Handle[]>([]);
  const [presence, setPresence] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const targets = useMemo(() => {
    return handles.filter((h) => {
      if (h.id === currentAgentHandleId) return false;
      if (excludeUserId && h.user_id === excludeUserId) return false;
      if (h.kind === "human") {
        if (!h.user_id) return false;
        return presence.get(h.user_id) === "available";
      }
      return true;
    });
  }, [handles, presence, currentAgentHandleId, excludeUserId]);

  const transfer = useCallback(
    async (handleId: string) => {
      setBusy(handleId);
      setError(null);
      try {
        const r = await fetch(`/api/calls/${callId}/handoff`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target_agent_handle_id: handleId }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        onTransferred();
        onClose();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [callId, onClose, onTransferred],
  );

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: "min(520px, 92vw)", maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>{t("Transférer l'appel")}</h3>
          <button className="ghost" onClick={onClose}>
            {t("Fermer")}
          </button>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          {t("Sélectionnez un agent IA ou un agent humain disponible.")}
        </p>

        {error && (
          <div style={{ color: "var(--bad)", fontSize: 13, marginBottom: 10 }}>
            {error}
          </div>
        )}

        {targets.length === 0 ? (
          <p className="muted">{t("Aucune cible disponible.")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {targets.map((h) => (
              <button
                key={h.id}
                className="ghost"
                disabled={busy !== null}
                onClick={() => void transfer(h.id)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  textAlign: "left",
                }}
              >
                <span>
                  <strong style={{ fontSize: 13 }}>{h.display_name}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>
                    {h.kind === "ai" ? "IA" : t("humain · disponible")}
                  </span>
                </span>
                <span className="tag">
                  {busy === h.id ? "…" : t("Transférer")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

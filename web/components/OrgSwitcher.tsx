"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface Org {
  id: string;
  name: string;
  slug: string;
  role?: string;
}

interface MeResponse {
  user: { id: string; email: string | null } | null;
  orgs: Org[];
  current_org_id: string | null;
  current_role: string | null;
}

export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Hydrate from /api/me — single source of truth for the active org
    // (it reads the HttpOnly cookie set by /api/orgs/switch).
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? (r.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (cancelled || !data || !data.user) return;
        setEmail(data.user.email);
        setOrgs(data.orgs);
        setCurrentOrgId(data.current_org_id);
      })
      .catch(() => {
        /* network glitch — leave the switcher empty rather than crashing */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(id: string) {
    if (!id || id === currentOrgId || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/orgs/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ org_id: id }),
      });
      if (r.ok) {
        setCurrentOrgId(id);
        // Refresh server components so the new middleware-applied role
        // takes effect everywhere.
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.push("/login");
  }

  if (!email) return null;

  return (
    <div style={{ display: "grid", gap: 6, padding: "10px 6px", borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 11, color: "var(--muted-2)", padding: "0 6px" }}>Organisation</div>
      <select
        value={currentOrgId ?? ""}
        onChange={(e) => pick(e.target.value)}
        disabled={orgs.length === 0 || busy}
        style={{ padding: "6px 8px", fontSize: 13 }}
      >
        {orgs.length === 0 && <option value="">(aucune)</option>}
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 6px" }}>
        <span style={{ fontSize: 11, color: "var(--muted-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
          {email}
        </span>
        <button className="ghost" onClick={signOut} style={{ padding: "2px 8px", fontSize: 11 }}>
          Quitter
        </button>
      </div>
    </div>
  );
}

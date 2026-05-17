"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";

interface Org {
  id: string;
  name: string;
  slug: string;
}

export function OrgSwitcher() {
  const router = useRouter();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then((res: { data: { user: { email?: string } | null } }) => {
      setEmail(res.data.user?.email ?? null);
    });
    sb.from("memberships")
      .select("organizations(id, name, slug)")
      .then((res: { data: Array<{ organizations: Org | null }> | null }) => {
        const list = (res.data ?? [])
          .map((m) => m.organizations)
          .filter((o): o is Org => o !== null);
        setOrgs(list);
        if (typeof window !== "undefined") {
          const saved = window.localStorage.getItem("axon.org_id");
          setCurrentOrgId(saved ?? list[0]?.id ?? null);
        }
      });
  }, []);

  function pick(id: string) {
    setCurrentOrgId(id);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("axon.org_id", id);
    }
    router.refresh();
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
        disabled={orgs.length === 0}
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

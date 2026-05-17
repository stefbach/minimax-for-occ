"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Brand } from "@/components/brand/Brand";

function SignupForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    // If the project requires email confirmation, there's no session yet.
    if (!data.session) {
      setBusy(false);
      setInfo("Compte créé. Vérifiez votre email pour confirmer.");
      return;
    }
    // Create the org + membership server-side using the freshly-issued JWT.
    const res = await fetch("/api/orgs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session.access_token}`,
      },
      body: JSON.stringify({ name: orgName || `Organisation de ${email.split("@")[0]}` }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Création de l'organisation échouée");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Brand size={22} />
        <span style={{ color: "var(--muted)", marginLeft: 6 }}>· Inscription</span>
      </div>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div>
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label>Mot de passe (8+ caractères)</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label>Nom de votre organisation</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Hôtel Belvédère, Tibok, etc." />
        </div>
        {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
        {info && <div style={{ color: "var(--good)", fontSize: 13 }}>{info}</div>}
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? "Création…" : "Créer mon compte"}
        </button>
      </form>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        Déjà un compte ? <Link href={`/login${next ? `?next=${next}` : ""}`} style={{ color: "var(--accent-2)" }}>Se connecter</Link>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

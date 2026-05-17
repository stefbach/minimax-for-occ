"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Brand } from "@/components/brand/Brand";

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const sb = supabaseBrowser();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Brand size={22} />
        <span style={{ color: "var(--muted)", marginLeft: 6 }}>· Connexion</span>
      </div>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div>
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label>Mot de passe</label>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        Pas de compte ? <Link href={`/signup${next ? `?next=${next}` : ""}`} style={{ color: "var(--accent-2)" }}>Créer un compte</Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

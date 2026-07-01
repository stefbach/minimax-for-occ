"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { AuthMark } from "@/components/auth/AuthMark";
import { useT } from "@/lib/i18n";

function LoginForm() {
  const t = useT();
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
    <>
      <div className="ax-auth-logo">
        <AuthMark size={24} />
        Axon<span className="acc">.</span>ai
      </div>
      <div className="ax-auth-kicker">{t("Espace client")}</div>
      <h1 className="ax-auth-h">{t("Connexion")}</h1>
      <p className="ax-auth-sub">{t("Accédez à vos agents vocaux, vos campagnes et votre supervision en direct.")}</p>

      <form className="ax-auth-form" onSubmit={onSubmit}>
        <div className="ax-auth-field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} placeholder="vous@entreprise.mu" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ax-auth-field">
          <label htmlFor="password">{t("Mot de passe")}</label>
          <input id="password" type="password" required value={password} placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="ax-auth-msg ax-auth-err">{error}</div>}
        <button className="ax-auth-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? t("Connexion…") : t("Se connecter")}
        </button>
      </form>

      <div className="ax-auth-alt">
        {t("Pas de compte ?")}{" "}
        <Link href={`/signup${next ? `?next=${next}` : ""}`} className="ax-auth-link">{t("Créer un compte")}</Link>
      </div>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

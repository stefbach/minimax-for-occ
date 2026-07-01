"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { AuthMark } from "@/components/auth/AuthMark";
import { useT } from "@/lib/i18n";

function landingForRole(role: string | undefined): string {
  switch (role) {
    case "super_admin":
      return "/admin/orgs";
    case "admin":
      return "/admin";
    case "manager":
    case "supervisor":
      return "/desk";
    case "agent":
    default:
      return "/desk";
  }
}

function SignupForm() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get("next") ?? "/";
  const token = sp.get("token");
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
      setInfo(t("Compte créé. Vérifiez votre email pour confirmer, puis reconnectez-vous pour finaliser votre invitation."));
      return;
    }

    if (token) {
      // Invitation flow: attach to existing org instead of creating a new one.
      const res = await fetch("/api/auth/accept-invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, user_id: data.user?.id }),
      });
      setBusy(false);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? t("Échec de l'acceptation de l'invitation"));
        return;
      }
      const j = (await res.json()) as { role?: string };
      router.push(landingForRole(j.role));
      router.refresh();
      return;
    }

    // No token: classic signup creates an org + admin membership.
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
      setError(j.error ?? t("Création de l'organisation échouée"));
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
      <div className="ax-auth-kicker">{token ? t("Acceptation d'invitation") : t("Inscription")}</div>
      <h1 className="ax-auth-h">{token ? t("Rejoindre") : t("Créer un compte")}</h1>
      <p className="ax-auth-sub">
        {token
          ? t("Finalisez votre compte pour rejoindre votre équipe sur Axon.")
          : t("Déployez votre premier agent vocal — opérationnel en 48 heures.")}
      </p>

      {token && <div className="ax-auth-chip" style={{ marginBottom: 22 }}>{t("Vous rejoignez une organisation existante")}</div>}

      <form className="ax-auth-form" onSubmit={onSubmit}>
        <div className="ax-auth-field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} placeholder="vous@entreprise.mu" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="ax-auth-field">
          <label htmlFor="password">{t("Mot de passe (8+ caractères)")}</label>
          <input id="password" type="password" required minLength={8} value={password} placeholder="••••••••" onChange={(e) => setPassword(e.target.value)} />
        </div>
        {!token && (
          <div className="ax-auth-field">
            <label htmlFor="org">{t("Nom de votre organisation")}</label>
            <input id="org" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Hôtel Belvédère, Tibok, etc." />
          </div>
        )}
        {error && <div className="ax-auth-msg ax-auth-err">{error}</div>}
        {info && <div className="ax-auth-msg ax-auth-ok">{info}</div>}
        <button className="ax-auth-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? t("Création…") : token ? t("Rejoindre l'organisation") : t("Créer mon compte")}
        </button>
      </form>

      <div className="ax-auth-alt">
        {t("Déjà un compte ?")}{" "}
        <Link href={`/login${next ? `?next=${next}` : ""}`} className="ax-auth-link">{t("Se connecter")}</Link>
      </div>
    </>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

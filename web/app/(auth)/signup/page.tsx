"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { Brand } from "@/components/brand/Brand";
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
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Brand size={22} />
        <span style={{ color: "var(--muted)", marginLeft: 6 }}>
          · {token ? t("Acceptation d'invitation") : t("Inscription")}
        </span>
      </div>
      {token && (
        <div className="tag" style={{ width: "fit-content" }}>
          {t("Vous rejoignez une organisation existante")}
        </div>
      )}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <div>
          <label>Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label>{t("Mot de passe (8+ caractères)")}</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {!token && (
          <div>
            <label>{t("Nom de votre organisation")}</label>
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Hôtel Belvédère, Tibok, etc." />
          </div>
        )}
        {error && <div style={{ color: "var(--bad)", fontSize: 13 }}>{error}</div>}
        {info && <div style={{ color: "var(--good)", fontSize: 13 }}>{info}</div>}
        <button type="submit" disabled={busy || !email || !password}>
          {busy ? t("Création…") : token ? t("Rejoindre l'organisation") : t("Créer mon compte")}
        </button>
      </form>
      <div style={{ fontSize: 13, color: "var(--muted)" }}>
        {t("Déjà un compte ?")} <Link href={`/login${next ? `?next=${next}` : ""}`} style={{ color: "var(--accent-2)" }}>{t("Se connecter")}</Link>
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

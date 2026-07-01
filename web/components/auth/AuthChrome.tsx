"use client";

import { useLang, useT } from "@/lib/i18n";

// Small client bits for the (server-rendered) auth layout. The layout can't
// read the active language (localStorage is client-only), so the back link and
// the footer tagline live here to translate + point back to the matching
// homepage (FR "/" or EN "/en").

export function AuthBackLink() {
  const t = useT();
  const lang = useLang();
  return (
    <a className="ax-auth-back" href={lang === "en" ? "/en" : "/"}>
      ← Axon.ai · {t("Accueil")}
    </a>
  );
}

export function AuthFooter() {
  const t = useT();
  return (
    <div className="ax-auth-foot">
      {t("Pendant que vous dormez, votre entreprise avance.")}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// Lightweight i18n. The French label IS the key — `t("Appels")` returns the
// English string when the language is EN, otherwise the French original. This
// keeps call-sites readable and means any untranslated string simply stays
// French (no blank labels). The active language is set by ThemeLangSwitcher
// (localStorage `axon.lang` + the `axon:lang` window event).

export type Lang = "fr" | "en";

const EN: Record<string, string> = {
  // ── Sidebar groups ──
  "Overview": "Overview",
  "Configuration": "Configuration",
  "Opérations": "Operations",
  "Données": "Data",
  "Compte": "Account",
  "Avancé": "Advanced",
  // ── Sidebar items ──
  "Démarrage guidé": "Guided start",
  "Tableau d'analyse": "Analytics",
  "Mon poste": "My desk",
  "Agents": "Agents",
  "Teams IA": "AI Teams",
  "Scripts": "Scripts",
  "Campagnes": "Campaigns",
  "Appels": "Calls",
  "Workflows n8n": "n8n Workflows",
  "Automatisation": "Automation",
  "Flows / IVR": "Flows / IVR",
  "Files d'attente": "Queues",
  "Bibliothèque persona": "Persona library",
  "Voice Studio": "Voice Studio",
  "Alertes": "Alerts",
  "Numéros de téléphone": "Phone numbers",
  "Santé des numéros": "Number health",
  "CRM / Contacts": "CRM / Contacts",
  "Paramètres": "Settings",
  "Guide": "Guide",
  "Déconnexion": "Sign out",
  // ── Dashboard header ──
  "Tableau de bord des appels": "Call dashboard",
  "Pilotage et analyse de vos appels Axon": "Monitor and analyse your Axon calls",
  "Actualiser": "Refresh",
  "Actualisation…": "Refreshing…",
  // ── Dashboard tabs ──
  "Vue d'ensemble": "Overview",
  "Statistiques": "Statistics",
  "Call Logs": "Call Logs",
  "Live": "Live",
  // ── Quick actions ──
  "+ Nouvel agent": "+ New agent",
  "+ Nouvelle campagne": "+ New campaign",
  "☎ Voir les appels": "☎ View calls",
  "◐ Contacts": "◐ Contacts",
  // ── KPIs ──
  "Appels aujourd'hui": "Calls today",
  "Durée moyenne": "Avg duration",
  "Taux d'abandon": "Abandon rate",
  "Mix IA / humain": "AI / human mix",
  "Campagnes actives": "Active campaigns",
  "Contacts à rappeler": "Contacts to call back",
  "vs hier": "vs yest",
  // ── Charts ──
  "Volume d'appels (24 h glissantes)": "Call volume (rolling 24h)",
  "Top dispositions (aujourd'hui)": "Top dispositions (today)",
  "Aucune disposition enregistrée aujourd'hui.": "No disposition recorded today.",
  "Campagnes récentes": "Recent campaigns",
  "Performance par agent": "Per-agent performance",
  "Période": "Period",
  "Aujourd'hui": "Today",
  "Hier": "Yesterday",
  "7 derniers j": "Last 7 days",
  "30 derniers j": "Last 30 days",
  "Tout": "All",
  "Coût estimé": "Est. cost",
  "Coût réel": "Real cost",
  "Directeur": "Director",
  "Total appels": "Total calls",
  "Décrochés": "Answered",
  "Coût consommé": "Cost spent",
  "RDV confirmés": "Booked appts",
  "Taux de conversion": "Conversion rate",
  "Callbacks demandés": "Callbacks requested",
  "Qualifications": "Qualifications",
  "Volume d'appels": "Call volume",
  "par heure": "per hour",
  "par jour": "per day",
  "Top dispositions": "Top dispositions",
  "Heures de pointe": "Peak hours",
  "Distribution des durées": "Duration distribution",
  "Tentatives → décroché": "Attempts → answered",
  "tentative": "attempt",
  "réussis": "answered",
  "Aucune donnée": "No data",
  "Lun": "Mon", "Mar": "Tue", "Mer": "Wed", "Jeu": "Thu", "Ven": "Fri", "Sam": "Sat", "Dim": "Sun",
  // ── Co-pilot ──
  "Co-pilot manager": "Manager co-pilot",
  "Pose une question sur l'activité du jour.": "Ask a question about today's activity.",
  "Votre question…": "Your question…",
  // ── Live monitor ──
  "Live Monitor": "Live Monitor",
  "Activité récente": "Recent activity",
  "Historique des appels →": "Call history →",
  "Aucun appel en cours pour le moment. Cette vue se met à jour automatiquement.":
    "No calls in progress right now. This view updates automatically.",
  "Aucun appel récent.": "No recent calls.",
  "Heure": "Time",
  "Contact": "Contact",
  "Sens": "Direction",
  "Agent": "Agent",
  "Durée": "Duration",
  "État": "Status",
  "Date": "Date",
  // ── Call states ──
  "Sonnerie": "Ringing",
  "Menu vocal": "IVR",
  "En conversation": "In call",
  "Clôture": "Wrap-up",
  "Terminé": "Ended",
  "Échec": "Failed",
  // ── Call Logs tab ──
  "Terminés": "Completed",
  "Réussis": "Answered",
  "Échecs": "Failed",
  "En cours": "In progress",
  "Tous": "All",
  "↘ Entrants": "↘ Inbound",
  "↗ Sortants": "↗ Outbound",
  "Rechercher": "Search",
  "Nom, numéro, agent…": "Name, number, agent…",
  "Chargement…": "Loading…",
  "Aucun appel ne correspond aux filtres.": "No call matches the filters.",
  "Voir": "View",
  // ── Guided start ──
  "Les étapes pour lancer votre première campagne.": "Steps to launch your first campaign.",
};

function readLang(): Lang {
  if (typeof window === "undefined") return "fr";
  try {
    return localStorage.getItem("axon.lang") === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

/** Reactive current language — re-renders the component when the user toggles. */
export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>("fr");
  useEffect(() => {
    setLang(readLang());
    const onLang = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setLang(detail === "en" ? "en" : detail === "fr" ? "fr" : readLang());
    };
    const onStorage = () => setLang(readLang());
    window.addEventListener("axon:lang", onLang as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("axon:lang", onLang as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return lang;
}

/** Returns a translator bound to the active language. */
export function useT(): (s: string) => string {
  const lang = useLang();
  return (s: string) => (lang === "en" ? EN[s] ?? s : s);
}

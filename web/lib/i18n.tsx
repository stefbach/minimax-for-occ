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
  "Suivi NHS S2": "NHS S2 tracking",
  "Suivi patient NHS S2": "NHS S2 patient tracking",
  "Pipeline complet · De l'appel initial à la soumission NHS S2": "Full pipeline · From first call to NHS S2 submission",
  "Objectif mensuel NHS S2": "Monthly NHS S2 goal",
  "dossiers soumis ce mois": "files submitted this month",
  "restants à atteindre": "left to reach",
  "Progression": "Progress",
  "jours restants dans le mois": "days left in the month",
  "Escalade requise": "Escalation required",
  "Patients sans réponse depuis 3 jours+": "Patients with no response for 3+ days",
  "Voir et assigner": "View and assign",
  "Prêts à soumettre": "Ready to submit",
  "Dossiers complets — soumission NHS possible": "Complete files — NHS submission possible",
  "Communication patient": "Patient communication",
  "Email explicatif envoyé": "Explanation email sent",
  "Email initial J0": "Initial email D0",
  "Email relance J+2": "D+2 reminder email",
  "Relance avec liste des 11 docs": "Reminder with the 11-doc list",
  "WhatsApp relance J+2": "D+2 WhatsApp reminder",
  "Relance en parallèle de l'email": "Reminder alongside the email",
  "Réponses reçues": "Replies received",
  "Taux réponse": "Reply rate",
  "Aucune table de leads n'est encore enregistrée pour cette organisation. Les chiffres se rempliront dès le premier appel.": "No leads table is registered yet for this organisation. Numbers will start populating from the first call.",
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
  // ── Report button + API status pill (legacy OCC dashboard parity) ──
  "appel(s) concerné(s)": "call(s) concerned",
  "Générer un rapport": "Generate a report",
  "Génération…": "Generating…",
  "Quotidien — PDF": "Daily — PDF",
  "Quotidien — CSV": "Daily — CSV",
  "Hebdomadaire — PDF": "Weekly — PDF",
  "Hebdomadaire — CSV": "Weekly — CSV",
  "API opérationnelle": "API operational",
  "API : incident": "API: incident",
  "API…": "API…",
  "Services en échec": "Failing services",
  "État des services (Supabase, Twilio, LiveKit…)": "Service health (Supabase, Twilio, LiveKit…)",
  // ── Global filter bar (legacy OCC dashboard parity) ──
  "Personnalisé": "Custom",
  "Période active": "Active period",
  "Choisir une date ou un intervalle précis": "Pick a specific day or range",
  "Tentative": "Attempt",
  "Éligibilité": "Eligibility",
  "Décroché": "Answered",
  "Toutes": "All",
  "1ère": "1st",
  "2ème": "2nd",
  "3ème et +": "3rd +",
  "Éligible": "Eligible",
  "Non éligible": "Not eligible",
  "Inconnue": "Unknown",
  "Sans réponse": "No answer",
  "Rechercher nom, téléphone, résumé…": "Search name, phone, summary…",
  "Numéro de tentative pour ce lead dans la période": "Attempt number for this lead within the period",
  "Éligibilité S2 du lead (BMI ≥ 40)": "Lead S2 eligibility (BMI ≥ 40)",
  "Les filtres Source / Tentative / Éligibilité s'appliquent aux onglets Vue d'ensemble et Statistiques, pas à cette liste.":
    "The Source / Attempt / Eligibility filters apply to the Overview and Statistics tabs, not to this list.",
  "Rechercher": "Search",
  "Nom, numéro, agent…": "Name, number, agent…",
  "Chargement…": "Loading…",
  "Aucun appel ne correspond aux filtres.": "No call matches the filters.",
  "Voir": "View",
  // ── Guided start ──
  "Les étapes pour lancer votre première campagne.": "Steps to launch your first campaign.",
  // ── Erreurs & Alertes tab ──
  "Erreurs & Alertes": "Errors & Alerts",
  "Vue consolidée des erreurs système et des appels à retraiter":
    "Consolidated view of system errors and calls that need re-handling",
  "Log des erreurs système": "System error log",
  "Tous les types": "All types",
  "Type": "Type",
  "Message": "Message",
  "Aucune erreur enregistrée. 👍": "No errors logged. 👍",
  "Répondeurs à rappeler": "Voicemails to call back",
  "Aucun rappel en attente.": "No callbacks pending.",
  "Inconnu": "Unknown",
  "voicemail confirmé": "voicemail confirmed",
  "Marquer rappelé": "Mark called back",
  "…": "…",
  "Robot awareness": "Robot awareness",
  "Aucun appel concerné.": "No matching calls.",
  "Recommandation : rappel humain prioritaire": "Recommendation: priority human callback",
  "Anomalies": "Anomalies",
  "Numéro jamais joint": "Number never reached",
  "Numéros avec 3+ tentatives sans aucun décroché (30 derniers jours)":
    "Numbers with 3+ attempts and no answer (last 30 days)",
  "Aucun numéro concerné.": "No matching numbers.",
  "tent.": "att.",
  "3 tentatives sans contact": "3 attempts, no contact",
  "Contacts avec 3+ tentatives sans décroché (30 derniers jours)":
    "Contacts with 3+ attempts and no answer (last 30 days)",
  "Aucun contact concerné.": "No matching contacts.",
  // ── Live tab additions ──
  "Connecté · vérifié à": "Connected · checked at",
  "Flux des appels terminés": "Completed call stream",
  "Aucun appel terminé pour le moment.": "No completed calls yet.",
  "Alertes temps réel": "Real-time alerts",
  "Aucune alerte pour le moment.": "No alerts yet.",
  "Appel anormalement court": "Abnormally short call",
  "Voicemail détecté": "Voicemail detected",
  // ── NHS S2 additions ──
  "État des dossiers": "File status",
  "Aucun document": "No document",
  "Documents partiels": "Partial documents",
  "Dossiers complets": "Complete files",
  "Sans réponse 3j+": "No response 3d+",
  "Suivi NHS S2 (après soumission)": "NHS S2 tracking (after submission)",
  "Envoyés NHS": "Sent to NHS",
  "In review NHS": "NHS in review",
  "Acceptés NHS": "NHS accepted",
  "Refusés NHS": "NHS rejected",
  "Pipeline de conversion — étapes patient": "Conversion pipeline — patient steps",
  "Appel initial": "Initial call",
  "Email relance": "Reminder email",
  "Réponse reçue": "Response received",
  "Dossier complet": "Complete file",
  "Soumis NHS": "Submitted to NHS",
  "Email initial envoyé · aucun document reçu": "Initial email sent · no document received",
  "Au moins un document manquant": "At least one document missing",
  "BMI, DOB, allergies, traitements, antécédents": "BMI, DOB, allergies, medications, history",
  "Escalade nécessaire": "Escalation required",
  "Dossiers transmis au NHS": "Files submitted to NHS",
  "Instruction en cours": "Under review",
  "Dossiers approuvés": "Files approved",
  "Dossiers refusés": "Files rejected",
  // ── Team page ──
  "Équipe": "Team",
  "Gérez les utilisateurs de votre organisation, leurs rôles et leurs accès.":
    "Manage your organisation's users, their roles and access.",
  "Inviter": "Invite",
  "Inviter un utilisateur": "Invite a user",
  "Invitations en attente": "Pending invitations",
  "Aucun membre — ajoutez-en via le bouton Inviter.":
    "No member yet — add some via the Invite button.",
  "Membre": "Member",
  "Rôle": "Role",
  "Statut": "Status",
  "Ajouté le": "Added on",
  "Actif": "Active",
  "Désactivé": "Disabled",
  "Édition à venir": "Editing coming soon",
  "Email": "Email",
  "Expire": "Expires",
  "Expire dans": "Expires in",
  "j": "d",
  "Copier le lien": "Copy link",
  "Renvoyer": "Resend",
  "Révoquer": "Revoke",
  "Révoquer cette invitation ?": "Revoke this invitation?",
  "Lien copié dans le presse-papiers.": "Link copied to clipboard.",
  "Impossible de copier le lien.": "Unable to copy the link.",
  "Invitation révoquée.": "Invitation revoked.",
  "Nouveau lien généré.": "New link generated.",
  "Invitation créée": "Invitation created",
  "Aucun email automatique pour l'instant — partage le lien à la personne.":
    "No automatic email for now — share the link with the person manually.",
  "Annuler": "Cancel",
  "Envoyer l'invitation": "Send invitation",
  "Envoi…": "Sending…",
  "Fermer": "Close",
  "Super admin": "Super admin",
  "Owner": "Owner",
  "Admin": "Admin",
  "Manager": "Manager",
  "Supervisor": "Supervisor",
  "Viewer": "Viewer",
  "Analyst": "Analyst",
  // ── Team member actions (Wave C) ──
  "Changer le rôle": "Change role",
  "Désactiver": "Disable",
  "Réactiver": "Re-enable",
  "Désactiver ce membre ?": "Disable this member?",
  "Réactiver ce membre ?": "Re-enable this member?",
  "Rôle mis à jour.": "Role updated.",
  "Membre désactivé.": "Member disabled.",
  "Membre réactivé.": "Member re-enabled.",
  "Au moins un owner requis": "At least one owner is required",
  "Vous ne pouvez pas modifier votre propre rôle.":
    "You cannot edit your own role.",
  "vous": "you",
  // ── Number detail / inbound routing ──
  "Lorsqu'un appel entrant arrive": "When an inbound call arrives",
  "Choisissez ce qui se passe quand quelqu'un appelle ce numéro. Vous pouvez changer à tout moment — les appels en cours ne sont pas affectés.":
    "Choose what happens when someone calls this number. You can change this at any time — in-progress calls are unaffected.",
  "Confier à l'IA": "Hand off to the AI",
  "L'agent IA décroche, conduit la conversation et qualifie l'appel comme pour un appel sortant.":
    "The AI agent answers, runs the conversation and qualifies the call just like an outbound call.",
  "Lancer un flow IVR": "Run an IVR flow",
  "Joue un menu vocal interactif (touche 1, 2, …) défini dans Flows / IVR.":
    "Plays an interactive voice menu (press 1, 2, …) defined in Flows / IVR.",
  "Sélectionnez un flow": "Select a flow",
  "Sélectionnez un flow.": "Select a flow.",
  "Aucun flow défini. Créez-en un dans Flows / IVR puis revenez ici.":
    "No flows defined. Create one under Flows / IVR then come back here.",
  "Envoyer en file humaine": "Send to a human queue",
  "L'appelant patiente avec une musique ; le premier agent disponible décroche depuis son poste.":
    "The caller hears hold music; the first available agent picks up from their desk.",
  "Sélectionnez une file": "Select a queue",
  "Sélectionnez une file.": "Select a queue.",
  "Aucune file définie. Créez-en une dans Files d'attente puis revenez ici.":
    "No queues defined. Create one under Queues then come back here.",
  "Enregistrement…": "Saving…",
  "Réglages enregistrés.": "Settings saved.",
  // ── Desk: human-agent workstation ──
  "Ma file": "My queue",
  "Pool partagé": "Shared pool",
  "Mes appels du jour": "Today's calls",
  "Mes appels": "My calls",
  "File équipe": "Team queue",
  "Prendre": "Claim",
  "Relâcher": "Release",
  "Appeler": "Call",
  "Patient": "Patient",
  "Aucun patient sélectionné": "No patient selected",
  "Sélectionnez un appel dans Ma file ou dans le Pool partagé pour voir son contexte.":
    "Pick a call from My queue or the Shared pool to see its context.",
  "Notes récentes": "Recent notes",
  "Qualification": "Qualification",
  "Note": "Note",
  "Rappeler le": "Call back at",
  "Disposition": "Disposition",
  "Aucun rappel programmé": "No callback scheduled",
  "Aucun appel à traiter pour le moment.": "No calls to handle right now.",
  "Pool partagé vide.": "Shared pool is empty.",
  "Dernier appel": "Last call",
  "appels": "calls",
  "Sauvegarder": "Save",
  "Enregistré.": "Saved.",
  "Pris en charge.": "Claimed.",
  // ── Director: J1/J3/J5 follow-up tracking ──
  "Suivi J1 / J3 / J5": "D1 / D3 / D5 follow-up",
  "Relances programmées par phase et répartition des appels par créneau":
    "Scheduled follow-ups by phase and call distribution by slot",
  "Pipeline au": "Pipeline as of",
  "leads au total": "leads in total",
  "Leads marqués « à rappeler »": "Leads marked “to call back”",
  "Relance prévue à J+1": "Follow-up due on D+1",
  "Relance prévue à J+3": "Follow-up due on D+3",
  "Relance prévue à J+5": "Follow-up due on D+5",
  "À appeler aujourd'hui": "To call today",
  "auj.": "today",
  "Date de relance dépassée": "Follow-up date overdue",
  "en retard": "overdue",
  "Relance à venir": "Upcoming follow-up",
  "à venir": "upcoming",
  "Les volumes par phase couvrent l'ensemble du pipeline (indépendant de la période sélectionnée).":
    "Phase volumes cover the whole pipeline (independent of the selected period).",
  "Par créneau d'appel": "By call slot",
  "autres heures": "other hours",
  "Fenêtres d'appel Lun–Jeu. Vendredi : créneau matin élargi à 08h–11h UK, pas de midi/soir. Week-end : hors créneau.":
    "Mon–Thu calling windows. Friday: morning slot extended to 08:00–11:00 UK, no midday/evening. Weekend: out of hours.",
  "voir les appels": "view calls",
  "Aucune table de phases configurée pour cette organisation.":
    "No phase table configured for this organisation.",
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

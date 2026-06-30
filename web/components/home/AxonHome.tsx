"use client";

/* eslint-disable react/no-unescaped-entities */

/**
 * AxonHome — public marketing homepage (the "magazine" edition), bilingual.
 *
 * Faithful port of the standalone axon-ai.tech site into the Next.js app so the
 * marketing site and the client app live on one domain. Markup mirrors the
 * original section-for-section; the sector accordion + filters are reimplemented
 * with React state. All copy lives in COPY[lang] (fr | en) — "/" renders FR,
 * "/en" renders EN. Styles live in ./axon-home.css, scoped under .axon-landing.
 *
 * Differences vs. the original static site:
 *  - nav "Se connecter" / "Sign in" CTA added next to "Démo" / "Demo";
 *  - the Pricing section + its nav link were removed on request;
 *  - sections renumbered to stay contiguous after Pricing (§08) was dropped.
 */

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Instrument_Serif, JetBrains_Mono, Inter } from "next/font/google";
import "./axon-home.css";

const instrument = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const jetbrains = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const inter = Inter({ weight: ["300", "400", "500", "600"], subsets: ["latin"], variable: "--font-inter", display: "swap" });

export type Lang = "fr" | "en";

/* Rich text token: plain string, an <em> (terra italic), or a <br>. */
type Tok = string | { em: string } | { br: boolean };
function Rich({ t }: { t: readonly Tok[] }) {
  return (
    <>
      {t.map((x, i) =>
        typeof x === "string" ? <Fragment key={i}>{x}</Fragment> : "em" in x ? <em key={i}>{x.em}</em> : <br key={i} />,
      )}
    </>
  );
}

type Agent = { role: string; kind: string; v: boolean; pre: string; em: string; desc: string; kpi: string; unit: string; kpiL: string };
type Channel = { num: string; pre: string; acc: string; desc: string; meta: string; n: string };
type Step = { time: string; t: string; d: string; live: boolean };
type Proof = { kicker: string; n: string; unit: string; t: string; d: string };
type Process = { num: string; when: string; t: string; d: string };
type Faq = { q: Tok[]; a: string };
type Metier = { t: string; k: string; items: string[] };
type Sector = { id: string; title: string; meta: string; count: number; kpi: string; metiers: Metier[] };
type Cc = { title: string; sub: string; right: string; rightCls?: string };
type FootLink = { l: string; target: string };

const fr = {
  nav: { links: [
    { l: "Agents", t: "agents" }, { l: "Canaux", t: "canaux" }, { l: "Voix", t: "voix" },
    { l: "Secteurs", t: "secteurs" }, { l: "Process", t: "process" },
  ], signin: "Se connecter", space: "Mon espace", demo: "Démo" },
  hero: {
    meta1: "Édition № 01 — Port-Louis, Avril 2026", metaA: "Agents IA", metaB: "Maurice & Afrique",
    h1: { l1: "Une entreprise", l2: "qui travaille", accent: "pendant", mid: " que vous ", sleep: "dormez." },
    ledeL: "Des agents IA vocaux et textuels qui décrochent, écrivent, agissent. 24 heures sur 24, dans votre langue, connectés à vos outils.",
    caption: "« Mon agent a pris 42 appels pendant que je dormais. »",
    lead: "Axon déploie des agents vocaux et textuels qui décrochent le téléphone, tiennent la conversation sur WhatsApp, envoient les devis, rappellent les rendez-vous et mettent à jour votre agenda — sans jamais quitter leur poste.",
    side: [
      { tag: "01 · Déploiement", val: "48", unit: "h", desc: "Du brief initial à l'agent opérationnel sur vos lignes et canaux réels." },
      { tag: "02 · Disponibilité", val: "24", unit: "/7", desc: "Week-ends, jours fériés, milieu de nuit. Votre agent ne prend jamais de congé." },
      { tag: "03 · Charge administrative", val: "−80", unit: "%", desc: "Vos équipes se concentrent enfin sur ce qu'aucune machine ne peut remplacer." },
    ],
    cta1: "Activer mon premier agent", cta2: "Écouter une démo vocale",
    ticker: [
      "Voix naturelle en français · créole · anglais", "Intégré à WhatsApp, Gmail, Outlook, Sage, Zoho",
      "Hébergé sur infrastructure souveraine", "Conforme RGPD + Data Protection Act 2017", "130+ cas d'usage modélisés",
    ],
  },
  promise: {
    num: "§ 01 — LA PROMESSE",
    title: ["Trois ", { em: "gestes" }, " que vos agents font, sans vous."] as Tok[],
    lede: "Pas des chatbots maladroits. Des agents qui décrochent, parlent, écrivent et agissent — connectés à vos outils, entraînés à votre métier, mesurés au résultat.",
    cards: [
      { kicker: "Canal vocal", title: ["Votre téléphone ", { em: "répond" }, " tout seul."] as Tok[], desc: "Votre agent décroche dès la première sonnerie, comprend la demande en français, créole ou anglais, prend le rendez-vous, transfère si nécessaire.", metricN: "−50", metricU: "%", metricL: ["DE NO-SHOW", "GRÂCE AUX RAPPELS AUTO"] },
      { kicker: "Messagerie", title: ["WhatsApp & email ", { em: "en deux minutes." }] as Tok[], desc: "Chaque appel, formulaire ou demande déclenche une réponse personnalisée. Devis PDF, confirmations, rappels — écrits et envoyés sans intervention.", metricN: "< 2", metricU: " min", metricL: ["DÉLAI MOYEN", "DE RÉPONSE CLIENT"] },
      { kicker: "Automatisation", title: ["Vos processus ", { em: "tournent seuls." }] as Tok[], desc: "Réservations, devis, relances, rapports, onboarding — vos flux de travail de bout en bout, pris en charge par des agents autonomes et audités.", metricN: "×10", metricU: "", metricL: ["CAPACITÉ DE TRAITEMENT", "SANS EMBAUCHE"] },
    ],
  },
  channels: {
    num: "§ 02 — OMNICANAL",
    title: ["Un agent. ", { em: "Tous" }, " vos canaux. Simultanément."] as Tok[],
    lede: "Appel entrant, réponse WhatsApp instantanée, email de confirmation, mise à jour CRM — le tout en quelques secondes, avec un seul agent qui garde le contexte.",
    list: [
      { num: "/01", pre: "Téléphone, ", acc: "voix naturelle.", desc: "Décroche en 1 sonnerie. Parle français, créole mauricien et anglais sans accent synthétique. Transfère à un humain quand il le faut.", meta: "ENTRANT · SORTANT · TRANSFERT · WEBCALL", n: "01" },
      { num: "/02", pre: "WhatsApp, ", acc: "instantané.", desc: "Confirmations, rappels, devis, réponses techniques. Templates Business API approuvés, historique conservé par client.", meta: "NOTIFICATIONS · CHATBOT · HUMAN-HANDOFF", n: "02" },
      { num: "/03", pre: "Email, ", acc: "professionnel.", desc: "Rédige et envoie confirmations, devis PDF signés, rapports hebdos. Templates brandés, pièces jointes générées à la volée.", meta: "TRANSACTIONNEL · COMMERCIAL · RAPPORTS", n: "03" },
      { num: "/04", pre: "Mémoire, ", acc: "permanente.", desc: "Votre agent se souvient de chaque interaction, sur tous les canaux. Il connaît vos clients, leur historique, leurs préférences.", meta: "HISTORIQUE · PROFIL · CRM SYNC", n: "04" },
    ] as Channel[],
    visLabel: "LIVE — VUE AGENT · 14:27:03 MUT", visHead: "Une seule conversation qui rebondit entre canaux, sans perdre le fil.",
    cc: [
      { title: "Appel entrant — Mme Appadoo", sub: "+230 5 712 · Rodez & Cie", right: "14:27:03" },
      { title: "\"Je voudrais un devis pour 200 cartons\"", sub: "Transcription + intent: quote_request", right: "EN COURS", rightCls: "t" },
      { title: "WhatsApp envoyé — devis PDF #2814", sub: "Montant: Rs 142.500 · Livraison J+3", right: "+ 00:14" },
      { title: "Email + RDV calendrier + CRM sync", sub: "Sage 100 · Google Calendar · HubSpot", right: "DONE", rightCls: "g" },
    ] as Cc[],
    chartLabel: "VOLUME · DERNIÈRES 24H", chartVal: "2 847 interactions",
  },
  agents: {
    num: "§ 03 — CATALOGUE",
    title: ["Un agent ", { em: "taillé" }, " pour chaque métier."] as Tok[],
    lede: "Neuf figures choisies parmi les plus demandées. Chacune vit sur vos canaux réels, parle votre langue et connaît votre stack — WhatsApp, Sage, HubSpot, Google Workspace.",
    view: "VOIR →",
    items: [
      { role: "Réception · 24/7", kind: "VOCAL", v: true, pre: "La ", em: "standardiste", desc: "Décroche, qualifie, oriente, prend message. Connaît vos horaires, vos équipes, vos procédures d'accueil.", kpi: "96", unit: "%", kpiL: "APPELS PRIS" },
      { role: "Réservation", kind: "VOCAL + CHAT", v: true, pre: "La ", em: "booker", desc: "Tiens l'agenda : hôtels, cliniques, coiffeurs, garages. Confirme, rappelle J−1, gère les annulations et replanifie.", kpi: "−50", unit: "%", kpiL: "NO-SHOW" },
      { role: "Commercial", kind: "WHATSAPP", v: false, pre: "Le ", em: "closeur", desc: "Qualifie les leads entrants, envoie devis en moins d'une minute, relance les opportunités chaudes, transfère le closing.", kpi: "×3.4", unit: "", kpiL: "TAUX CONVERSION" },
      { role: "Support", kind: "VOCAL + EMAIL", v: true, pre: "Le ", em: "premier niveau", desc: "Répond aux questions récurrentes, résout 70% des tickets L1, escalade proprement le reste avec tout le contexte.", kpi: "70", unit: "%", kpiL: "TICKETS RÉSOLUS" },
      { role: "Facturation · Recouvrement", kind: "EMAIL + WA", v: false, pre: "Le ", em: "relanceur", desc: "Surveille les impayés, envoie les relances graduées, téléphone aux mauvais payeurs avec tact. Se synchronise à Sage et Odoo.", kpi: "−18", unit: " j", kpiL: "DÉLAI PAIEMENT" },
      { role: "RH · Recrutement", kind: "VOCAL", v: true, pre: "Le ", em: "préqualifieur", desc: "Appelle 200 candidats par jour, pose les bonnes questions, note les réponses, programme les entretiens des meilleurs.", kpi: "12×", unit: "", kpiL: "VITESSE DE TRI" },
      { role: "Logistique", kind: "CHAT + CRM", v: false, pre: "Le ", em: "traqueur", desc: "Suit les commandes, notifie les retards, gère les réclamations transporteur. Intégré DHL, FedEx, Mauritius Post.", kpi: "98", unit: "%", kpiL: "NOTIFIÉ À TEMPS" },
      { role: "Santé · Médical", kind: "VOCAL", v: true, pre: "La ", em: "secrétaire médicale", desc: "Prend les rendez-vous, gère le télésecrétariat, envoie les ordonnances renouvelées, respecte la confidentialité médicale.", kpi: "100", unit: "%", kpiL: "APPELS RÉPONDUS" },
      { role: "Finance · Ops", kind: "EMAIL + API", v: false, pre: "L'", em: "opérateur", desc: "Rapports hebdos, reportings clients, consolidation de données inter-outils, alertes seuils métiers personnalisées.", kpi: "22", unit: " h", kpiL: "/ SEMAINE ÉCONOMISÉES" },
    ] as Agent[],
  },
  voice: {
    num: "§ 04 — TECHNOLOGIE VOCALE",
    title: ["La voix, comme ", { em: "interface" }, " native."] as Tok[],
    lede: "Un appel déclenche une cascade d'actions : WhatsApp, email, CRM, agenda — exécutées en temps réel, sans latence perceptible par l'appelant.",
    tag: "// ANATOMIE D'UN APPEL · 14 SECONDES",
    steps: [
      { time: "+00:00 · DÉCROCHE", t: "Détection d'appel entrant", d: "L'agent décroche avant la deuxième sonnerie et salue en français, créole ou anglais selon le numéro d'appel.", live: true },
      { time: "+00:02 · COMPRÉHENSION", t: "Transcription streaming + intent", d: "La parole est transcrite en streaming en moins de 300 ms. L'intention et l'entité métier sont identifiées immédiatement.", live: true },
      { time: "+00:05 · ACTION", t: "Appel d'outils en parallèle", d: "L'agent lit votre CRM, consulte l'agenda, calcule un devis, prépare les messages WhatsApp et email à envoyer.", live: true },
      { time: "+00:09 · RÉPONSE VOCALE", t: "Synthèse vocale naturelle", d: "Voix humaine, pauses contextuelles, respirations. Aucun robotisme audible, aucune latence perceptible.", live: false },
      { time: "+00:14 · SUIVI AUTO", t: "Raccroché, mais pas fini", d: "Résumé d'appel envoyé à votre équipe, ticket CRM créé, WhatsApp de confirmation délivré, rappel J−1 planifié.", live: false },
    ] as Step[],
  },
  sectors: {
    num: "§ 05 — PANORAMA SECTORIEL",
    title: ["Huit terrains.", { br: true }, "Quarante-deux ", { em: "métiers." }] as Tok[],
    lede: "Chaque secteur a sa logique, son vocabulaire, ses règles. Nos agents sont pré-modélisés pour les plus courants — et taillés sur mesure pour les autres en 48 heures.",
    filters: [
      { f: "all", l: "Tous" }, { f: "services", l: "Services aux pros" }, { f: "retail", l: "Retail & hôtellerie" },
      { f: "sante", l: "Santé & bien-être" }, { f: "finance", l: "Finance & assurance" },
    ],
    metiersLabel: "MÉTIERS", customTag: "§ SUR-MESURE",
    customTitle: ["Votre secteur n'est pas listé ? ", { em: "On le construit." }] as Tok[],
    customDesc: "Nous modélisons vos processus exacts, votre vocabulaire métier, vos règles de gestion. Un agent qui parle votre langue, respecte vos contraintes, agit selon vos standards — livré en 48 heures.",
    customBtn: "Construire sur mesure",
    data: [
      { id: "services", title: "Services aux professionnels", meta: "8 MÉTIERS · 24 CAS D'USAGE", count: 8, kpi: "TEMPS ×3", metiers: [
        { t: "Cabinet d'avocat", k: "VOCAL", items: ["Standard 24/7 + prise de rendez-vous", "Envoi auto des honoraires et conventions", "Rappels d'audience et de pièces"] },
        { t: "Cabinet comptable", k: "EMAIL", items: ["Relance des pièces clients", "Envoi des bilans et déclarations", "Réponses aux questions récurrentes"] },
        { t: "Agence immobilière", k: "VOCAL", items: ["Pré-qualification des acquéreurs", "Envoi fiches biens par WhatsApp", "Planification des visites"] },
        { t: "Études notariales", k: "VOCAL", items: ["Standard et accueil", "Rappels de signature", "Transmission des pièces manquantes"] },
      ] },
      { id: "retail", title: "Retail & hôtellerie", meta: "12 MÉTIERS · 38 CAS D'USAGE", count: 12, kpi: "CONVERSION ×3", metiers: [
        { t: "Hôtels & lodges", k: "VOCAL", items: ["Réservation directe 24/7", "Confirmation + pré-check-in", "Upsell chambres et services"] },
        { t: "Restaurants", k: "VOCAL", items: ["Prise de réservation", "Rappel J−1 et no-show management", "Menus par WhatsApp"] },
        { t: "E-commerce", k: "WA", items: ["Support commande et SAV", "Suivi de livraison proactif", "Abandons de panier récupérés"] },
        { t: "Spas & salons", k: "VOCAL", items: ["Agenda + rappels", "Vente de cartes cadeaux", "Fidélisation clients"] },
      ] },
      { id: "sante", title: "Santé & bien-être", meta: "10 MÉTIERS · 28 CAS D'USAGE", count: 10, kpi: "−50% NO-SHOW", metiers: [
        { t: "Cabinet médical", k: "VOCAL", items: ["Télésecrétariat 24/7", "Rappels consultation", "Renouvellements ordonnances"] },
        { t: "Clinique privée", k: "VOCAL", items: ["Prise de rendez-vous multi-spé", "Pré-admission et documents", "Info visiteurs"] },
        { t: "Kinés & ostéos", k: "WA", items: ["Agenda optimisé", "Rappels séances", "Fidélisation patient"] },
        { t: "Pharmacies", k: "WA", items: ["Réservation de médicaments", "Renouvellement chroniques", "Alertes disponibilité"] },
      ] },
      { id: "finance", title: "Finance & assurance", meta: "7 MÉTIERS · 22 CAS D'USAGE", count: 7, kpi: "−18J PAIEMENT", metiers: [
        { t: "Cabinet d'assurance", k: "VOCAL", items: ["Cotation et souscription", "Déclaration de sinistre guidée", "Renouvellements automatiques"] },
        { t: "Conseil patrimonial", k: "EMAIL", items: ["Reportings clients automatisés", "Prise de RDV qualifiés", "Veille réglementaire"] },
        { t: "Recouvrement", k: "WA", items: ["Relances graduées multicanal", "Négociation d'échéanciers", "Reporting DSO temps réel"] },
        { t: "Microfinance", k: "VOCAL", items: ["Accueil entrée en relation", "Éducation financière", "Suivi remboursement"] },
      ] },
    ] as Sector[],
  },
  proof: {
    num: "§ 06 — MESURE",
    title: ["Des chiffres.", { br: true }, "Pas des ", { em: "promesses." }] as Tok[],
    lede: "Chaque agent est livré avec un tableau de bord opérationnel. Vous voyez chaque conversation, chaque seconde économisée, chaque opportunité qualifiée.",
    items: [
      { kicker: "§ PRODUCTIVITÉ", n: "−80", unit: "%", t: "Tâches répétitives éliminées", d: "Vos équipes libèrent 4 jours sur 5 pour ce qu'aucune machine ne remplace." },
      { kicker: "§ RÉACTIVITÉ", n: "< 2", unit: "min", t: "Délai de réponse moyen", d: "Contre 4 heures en moyenne pour une réponse humaine pendant les heures ouvrées." },
      { kicker: "§ VITESSE", n: "48", unit: "h", t: "Premier agent actif", d: "Du brief au déploiement en production. Brief lundi matin, agent vivant mercredi." },
      { kicker: "§ DISPONIBILITÉ", n: "24", unit: "/7", t: "Garantie continue", d: "Week-ends, jours fériés, milieu de nuit, Diwali, Noël. Aucune pause." },
    ] as Proof[],
  },
  process: {
    num: "§ 07 — MÉTHODE",
    title: ["Opérationnel en ", { em: "48 heures" }, " chrono."] as Tok[],
    lede: "Un audit, un atelier, un déploiement, un suivi. Quatre étapes, pas de phase discovery interminable, pas de PowerPoint cimenté.",
    items: [
      { num: "01", when: "JOUR 1 · 90 MIN", t: "On écoute votre métier", d: "Audit de vos canaux, de vos points de friction, de votre stack. On identifie l'agent au plus fort impact immédiat." },
      { num: "02", when: "JOUR 1 · FIN", t: "On modélise le flux", d: "Vocabulaire métier, règles, intégrations, persona vocal. Document signé en fin de journée." },
      { num: "03", when: "JOUR 2 · MATIN", t: "On configure l'agent", d: "Agent entraîné, connecté à WhatsApp, Sage, Google Workspace. Tests de bout en bout sur scénarios réels." },
      { num: "04", when: "JOUR 2 · 17H", t: "On passe en live", d: "Bascule progressive, monitoring temps réel, astreinte Axon 24/7 pour la première semaine de production." },
    ] as Process[],
  },
  faq: {
    num: "§ 08 — QUESTIONS",
    title: ["Ce qu'on nous ", { em: "demande" }, " souvent."] as Tok[],
    lede: "Onze réponses directes pour lever les doutes les plus fréquents. Le reste, on en parle en 90 minutes.",
    items: [
      { q: ["Mon agent parle-t-il plusieurs ", { em: "langues ?" }] as Tok[], a: "Oui. L'agent comprend et répond en français, en anglais et en créole mauricien. Il bascule de langue automatiquement selon la façon dont l'appelant lui parle." },
      { q: ["Qui ", { em: "entend" }, " les appels ?"] as Tok[], a: "Personne chez Axon. Les transcriptions sont chiffrées, stockées sur votre tenant. Vous y accédez depuis votre tableau de bord. Rétention paramétrable, 30 jours par défaut." },
      { q: ["Et si l'agent ne comprend pas ?"] as Tok[], a: "Il le dit, reformule, puis transfère à un humain avec tout le contexte déjà noté. Pas de boucle infinie, pas de « je n'ai pas compris » répété cinq fois." },
      { q: ["Peut-on ", { em: "changer la voix ?" }] as Tok[], a: "Oui. Cinq voix préréglées en français, créole et anglais. Clonage de voix humaine sur demande (Plan Entreprise), avec consentement écrit obligatoire." },
      { q: [{ em: "Intégration" }, " avec mes outils existants ?"] as Tok[], a: "Chaque intégration est construite sur mesure pour votre cas, en s'appuyant sur les connecteurs du marché et les APIs de vos outils. CRM, ERP, comptabilité, calendriers, téléphonie : on branche ce que vous utilisez, comme vous l'utilisez." },
      { q: ["Où sont ", { em: "hébergées" }, " mes données ?"] as Tok[], a: "Infrastructure dédiée à Maurice + réplication UE. Conformité RGPD, Data Protection Act 2017. Aucun transfert vers des juridictions tierces non conformes." },
      { q: ["Combien de temps de ", { em: "formation ?" }] as Tok[], a: "Deux sessions de 45 min suffisent à vos équipes pour prendre en main le tableau de bord et configurer les flux d'alertes. Le reste, c'est à l'agent de faire le travail." },
      { q: ["Puis-je ", { em: "arrêter" }, " quand je veux ?"] as Tok[], a: "Oui. Préavis 30 jours. Portabilité totale des données incluse. Aucune pénalité, aucun verrouillage technique. Votre numéro, vos contacts, vos données partent avec vous." },
    ] as Faq[],
  },
  cta: {
    meta: "§ 09 — PRENDRE RENDEZ-VOUS",
    title: ["Votre premier agent,", { br: true }, "vivant dans ", { em: "48 heures." }] as Tok[],
    sub: "Un appel de 90 minutes. On audite, on modélise, on chiffre. Si on ne sait pas faire votre cas en 48h, on vous le dit en fin d'appel — et on vous rembourse le setup si on s'est trompés.",
    book: "Réserver l'appel", phone: "+230 5259 1043", note: "contact@axon-ai.mu · Flic-en-Flac, Maurice · Réponse sous 4h ouvrées",
    mailSubject: "Réserver un appel Axon",
  },
  footer: {
    tag: "Des agents IA vocaux et textuels pour les entreprises de Maurice et d'Afrique. Opérationnels en 48 heures. Mesurés au résultat.",
    brandOf: "§ UNE MARQUE DE",
    colProduct: "Produit", colSectors: "Secteurs",
    product: [
      { l: "Catalogue d'agents", target: "agents" }, { l: "Voix IA", target: "voix" }, { l: "Intégrations", target: "canaux" },
      { l: "Sécurité", target: "contact" }, { l: "Journal des versions", target: "process" },
    ] as FootLink[],
    sectors: [
      { l: "Services pros", target: "secteurs" }, { l: "Retail & hôtellerie", target: "secteurs" }, { l: "Santé", target: "secteurs" },
      { l: "Finance", target: "secteurs" }, { l: "Immobilier", target: "secteurs" },
    ] as FootLink[],
    copyright: "© 2026 AXON.AI — une marque de Digital Data Solutions · Flic-en-Flac, Maurice",
    tagline: "Pendant que vous dormez, votre entreprise avance.",
  },
};

const en: typeof fr = {
  nav: { links: [
    { l: "Agents", t: "agents" }, { l: "Channels", t: "canaux" }, { l: "Voice", t: "voix" },
    { l: "Sectors", t: "secteurs" }, { l: "Process", t: "process" },
  ], signin: "Sign in", space: "My space", demo: "Demo" },
  hero: {
    meta1: "Issue № 01 — Port-Louis, April 2026", metaA: "AI Agents", metaB: "Mauritius & Africa",
    h1: { l1: "A company", l2: "that works", accent: "while", mid: " you ", sleep: "sleep." },
    ledeL: "Voice and text AI agents that pick up the phone, write, and act. Around the clock, in your language, connected to your tools.",
    caption: "“My agent handled 42 calls while I was asleep.”",
    lead: "Axon deploys voice and text agents that answer the phone, handle WhatsApp conversations, send quotes, remind customers of appointments and update your calendar — without ever leaving their post.",
    side: [
      { tag: "01 · Deployment", val: "48", unit: "h", desc: "From initial brief to live agent on your real lines and channels." },
      { tag: "02 · Availability", val: "24", unit: "/7", desc: "Weekends, public holidays, middle of the night. Your agent never takes a day off." },
      { tag: "03 · Admin load", val: "−80", unit: "%", desc: "Your teams finally focus on what no machine can replace." },
    ],
    cta1: "Launch my first agent", cta2: "Listen to a voice demo",
    ticker: [
      "Natural voice in French · Creole · English", "Integrated with WhatsApp, Gmail, Outlook, Sage, Zoho",
      "Hosted on sovereign infrastructure", "GDPR + Data Protection Act 2017 compliant", "130+ modelled use cases",
    ],
  },
  promise: {
    num: "§ 01 — THE PROMISE",
    title: ["Three ", { em: "moves" }, " your agents make, without you."],
    lede: "Not clunky chatbots. Agents that answer, speak, write and act — connected to your tools, trained on your business, measured on results.",
    cards: [
      { kicker: "Voice channel", title: ["Your phone ", { em: "answers" }, " itself."], desc: "Your agent picks up on the first ring, understands the request in French, Creole or English, books the appointment, hands off when needed.", metricN: "−50", metricU: "%", metricL: ["NO-SHOWS", "THANKS TO AUTO REMINDERS"] },
      { kicker: "Messaging", title: ["WhatsApp & email ", { em: "in two minutes." }], desc: "Every call, form or request triggers a personalized reply. PDF quotes, confirmations, reminders — written and sent without lifting a finger.", metricN: "< 2", metricU: " min", metricL: ["AVERAGE CUSTOMER", "RESPONSE TIME"] },
      { kicker: "Automation", title: ["Your workflows ", { em: "run themselves." }], desc: "Bookings, quotes, follow-ups, reports, onboarding — your end-to-end workflows, handled by autonomous, audited agents.", metricN: "×10", metricU: "", metricL: ["PROCESSING CAPACITY", "WITHOUT HIRING"] },
    ],
  },
  channels: {
    num: "§ 02 — OMNICHANNEL",
    title: ["One agent. ", { em: "All" }, " your channels. At once."],
    lede: "Inbound call, instant WhatsApp reply, confirmation email, CRM update — all within seconds, from a single agent that keeps the context.",
    list: [
      { num: "/01", pre: "Phone, ", acc: "natural voice.", desc: "Picks up in one ring. Speaks French, Mauritian Creole and English with no robotic accent. Hands off to a human when needed.", meta: "INBOUND · OUTBOUND · HANDOFF · WEBCALL", n: "01" },
      { num: "/02", pre: "WhatsApp, ", acc: "instant.", desc: "Confirmations, reminders, quotes, technical answers. Approved Business API templates, full history stored per customer.", meta: "NOTIFICATIONS · CHATBOT · HUMAN HANDOFF", n: "02" },
      { num: "/03", pre: "Email, ", acc: "professional.", desc: "Writes and sends confirmations, signed PDF quotes, weekly reports. Branded templates, attachments generated on the fly.", meta: "TRANSACTIONAL · SALES · REPORTS", n: "03" },
      { num: "/04", pre: "Memory, ", acc: "permanent.", desc: "Your agent remembers every interaction, across every channel. It knows your customers, their history, their preferences.", meta: "HISTORY · PROFILE · CRM SYNC", n: "04" },
    ],
    visLabel: "LIVE — AGENT VIEW · 14:27:03 MUT", visHead: "One conversation bouncing between channels, without losing the thread.",
    cc: [
      { title: "Inbound call — Ms. Appadoo", sub: "+230 5 712 · Rodez & Co", right: "14:27:03" },
      { title: "\"I'd like a quote for 200 cartons\"", sub: "Transcript + intent: quote_request", right: "ACTIVE", rightCls: "t" },
      { title: "WhatsApp sent — PDF quote #2814", sub: "Amount: Rs 142,500 · Delivery D+3", right: "+ 00:14" },
      { title: "Email + calendar invite + CRM sync", sub: "Sage 100 · Google Calendar · HubSpot", right: "DONE", rightCls: "g" },
    ],
    chartLabel: "VOLUME · LAST 24H", chartVal: "2,847 interactions",
  },
  agents: {
    num: "§ 03 — CATALOGUE",
    title: ["An agent ", { em: "tailored" }, " to every trade."],
    lede: "Nine figures chosen from the most requested. Each lives on your real channels, speaks your language, and knows your stack — WhatsApp, Sage, HubSpot, Google Workspace.",
    view: "VIEW →",
    items: [
      { role: "Reception · 24/7", kind: "VOICE", v: true, pre: "The ", em: "receptionist", desc: "Answers, qualifies, routes, takes a message. Knows your hours, your teams, your welcome protocols.", kpi: "96", unit: "%", kpiL: "CALLS TAKEN" },
      { role: "Booking", kind: "VOICE + CHAT", v: true, pre: "The ", em: "booker", desc: "Holds the calendar: hotels, clinics, salons, garages. Confirms, reminds D−1, handles cancellations, reschedules.", kpi: "−50", unit: "%", kpiL: "NO-SHOW" },
      { role: "Sales", kind: "WHATSAPP", v: false, pre: "The ", em: "closer", desc: "Qualifies inbound leads, sends quotes in under a minute, nurtures hot opportunities, hands off the close.", kpi: "×3.4", unit: "", kpiL: "CONVERSION RATE" },
      { role: "Support", kind: "VOICE + EMAIL", v: true, pre: "The ", em: "first-line", desc: "Answers recurring questions, resolves 70% of L1 tickets, cleanly escalates the rest with full context.", kpi: "70", unit: "%", kpiL: "TICKETS RESOLVED" },
      { role: "Billing · Collections", kind: "EMAIL + WA", v: false, pre: "The ", em: "dunner", desc: "Watches for overdue invoices, sends graduated reminders, phones late payers tactfully. Syncs with Sage and Odoo.", kpi: "−18", unit: " d", kpiL: "PAYMENT DELAY" },
      { role: "HR · Recruiting", kind: "VOICE", v: true, pre: "The ", em: "pre-screener", desc: "Calls 200 candidates a day, asks the right questions, notes the answers, schedules interviews with the best.", kpi: "12×", unit: "", kpiL: "SCREENING SPEED" },
      { role: "Logistics", kind: "CHAT + CRM", v: false, pre: "The ", em: "tracker", desc: "Tracks orders, notifies of delays, handles carrier claims. Integrated with DHL, FedEx, Mauritius Post.", kpi: "98", unit: "%", kpiL: "NOTIFIED ON TIME" },
      { role: "Health · Medical", kind: "VOICE", v: true, pre: "The ", em: "medical secretary", desc: "Takes appointments, handles tele-secretarial work, sends prescription renewals, respects medical confidentiality.", kpi: "100", unit: "%", kpiL: "CALLS ANSWERED" },
      { role: "Finance · Ops", kind: "EMAIL + API", v: false, pre: "The ", em: "operator", desc: "Weekly reports, client dashboards, cross-tool data consolidation, custom threshold alerts.", kpi: "22", unit: " h", kpiL: "/ WEEK SAVED" },
    ],
  },
  voice: {
    num: "§ 04 — VOICE TECHNOLOGY",
    title: ["Voice as a ", { em: "native" }, " interface."],
    lede: "A single call triggers a cascade of actions: WhatsApp, email, CRM, calendar — executed in real time, with no latency the caller can notice.",
    tag: "// ANATOMY OF A CALL · 14 SECONDS",
    steps: [
      { time: "+00:00 · PICKUP", t: "Inbound call detection", d: "The agent picks up before the second ring and greets in French, Creole or English based on the caller's number.", live: true },
      { time: "+00:02 · UNDERSTANDING", t: "Streaming transcription + intent", d: "Speech is transcribed in streaming in under 300 ms. Intent and business entity are identified immediately.", live: true },
      { time: "+00:05 · ACTION", t: "Parallel tool calls", d: "The agent reads your CRM, checks the calendar, calculates a quote, prepares the WhatsApp and email messages to send.", live: true },
      { time: "+00:09 · VOICE REPLY", t: "Natural speech synthesis", d: "Human voice, contextual pauses, breaths. No audible robotics, no perceptible latency.", live: false },
      { time: "+00:14 · AUTO FOLLOW-UP", t: "Hung up, but not done", d: "Call summary sent to your team, CRM ticket created, WhatsApp confirmation delivered, D−1 reminder scheduled.", live: false },
    ],
  },
  sectors: {
    num: "§ 05 — SECTOR PANORAMA",
    title: ["Eight fields.", { br: true }, "Forty-two ", { em: "trades." }],
    lede: "Every sector has its logic, vocabulary, rules. Our agents come pre-modelled for the most common — tailored to the rest in 48 hours.",
    filters: [
      { f: "all", l: "All" }, { f: "services", l: "Professional services" }, { f: "retail", l: "Retail & hospitality" },
      { f: "sante", l: "Health & wellness" }, { f: "finance", l: "Finance & insurance" },
    ],
    metiersLabel: "TRADES", customTag: "§ CUSTOM-BUILT",
    customTitle: ["Your sector isn't listed? ", { em: "We'll build it." }],
    customDesc: "We model your exact processes, your trade vocabulary, your rules. An agent that speaks your language, respects your constraints, acts to your standards — delivered in 48 hours.",
    customBtn: "Build mine to spec",
    data: [
      { id: "services", title: "Professional services", meta: "8 TRADES · 24 USE CASES", count: 8, kpi: "TIME ×3", metiers: [
        { t: "Law firm", k: "VOCAL", items: ["24/7 reception + appointment booking", "Auto-sending of fees and agreements", "Hearing and document reminders"] },
        { t: "Accounting firm", k: "EMAIL", items: ["Client document follow-ups", "Sending of statements and filings", "Answers to recurring questions"] },
        { t: "Real estate agency", k: "VOCAL", items: ["Buyer pre-qualification", "Property sheets sent via WhatsApp", "Viewing scheduling"] },
        { t: "Notary offices", k: "VOCAL", items: ["Reception and greeting", "Signing reminders", "Missing document relay"] },
      ] },
      { id: "retail", title: "Retail & hospitality", meta: "12 TRADES · 38 USE CASES", count: 12, kpi: "CONVERSION ×3", metiers: [
        { t: "Hotels & lodges", k: "VOCAL", items: ["Direct booking 24/7", "Confirmation + pre-check-in", "Room and service upsell"] },
        { t: "Restaurants", k: "VOCAL", items: ["Reservation booking", "D−1 reminder and no-show management", "Menus via WhatsApp"] },
        { t: "E-commerce", k: "WA", items: ["Order support and aftersales", "Proactive delivery tracking", "Abandoned carts recovered"] },
        { t: "Spas & salons", k: "VOCAL", items: ["Calendar + reminders", "Gift card sales", "Customer loyalty"] },
      ] },
      { id: "sante", title: "Health & wellness", meta: "10 TRADES · 28 USE CASES", count: 10, kpi: "−50% NO-SHOW", metiers: [
        { t: "Medical practice", k: "VOCAL", items: ["24/7 tele-secretarial", "Appointment reminders", "Prescription renewals"] },
        { t: "Private clinic", k: "VOCAL", items: ["Multi-specialty booking", "Pre-admission and documents", "Visitor info"] },
        { t: "Physio & osteo", k: "WA", items: ["Optimised calendar", "Session reminders", "Patient retention"] },
        { t: "Pharmacies", k: "WA", items: ["Medication reservations", "Chronic renewals", "Availability alerts"] },
      ] },
      { id: "finance", title: "Finance & insurance", meta: "7 TRADES · 22 USE CASES", count: 7, kpi: "−18D PAYMENT", metiers: [
        { t: "Insurance broker", k: "VOCAL", items: ["Quoting and underwriting", "Guided claim filing", "Automatic renewals"] },
        { t: "Wealth advisory", k: "EMAIL", items: ["Automated client reports", "Qualified appointment booking", "Regulatory monitoring"] },
        { t: "Collections", k: "WA", items: ["Graduated multi-channel dunning", "Payment plan negotiation", "Real-time DSO reporting"] },
        { t: "Microfinance", k: "VOCAL", items: ["Onboarding welcome", "Financial education", "Repayment follow-up"] },
      ] },
    ],
  },
  proof: {
    num: "§ 06 — METRICS",
    title: ["Numbers.", { br: true }, "Not ", { em: "promises." }],
    lede: "Every agent ships with an operational dashboard. You see every conversation, every second saved, every qualified opportunity.",
    items: [
      { kicker: "§ PRODUCTIVITY", n: "−80", unit: "%", t: "Repetitive tasks eliminated", d: "Your teams free up 4 days out of 5 for what no machine can replace." },
      { kicker: "§ RESPONSIVENESS", n: "< 2", unit: "min", t: "Average response time", d: "Versus 4 hours on average for a human reply during business hours." },
      { kicker: "§ SPEED", n: "48", unit: "h", t: "First agent live", d: "From brief to production deployment. Brief Monday morning, agent alive Wednesday." },
      { kicker: "§ AVAILABILITY", n: "24", unit: "/7", t: "Continuous guarantee", d: "Weekends, public holidays, middle of the night, Diwali, Christmas. No pause." },
    ],
  },
  process: {
    num: "§ 07 — METHOD",
    title: ["Live in ", { em: "48 hours" }, " flat."],
    lede: "One audit, one workshop, one deployment, one follow-up. Four steps, no endless discovery phase, no set-in-stone PowerPoint.",
    items: [
      { num: "01", when: "DAY 1 · 90 MIN", t: "We listen to your business", d: "Audit of your channels, friction points, and stack. We identify the agent with the biggest immediate impact." },
      { num: "02", when: "DAY 1 · END", t: "We model the flow", d: "Business vocabulary, rules, integrations, voice persona. Document signed by end of day." },
      { num: "03", when: "DAY 2 · MORNING", t: "We configure the agent", d: "Agent trained, connected to WhatsApp, Sage, Google Workspace. End-to-end tests on real scenarios." },
      { num: "04", when: "DAY 2 · 5PM", t: "We go live", d: "Progressive cutover, real-time monitoring, Axon on-call 24/7 for the first week in production." },
    ],
  },
  faq: {
    num: "§ 08 — QUESTIONS",
    title: ["What people ", { em: "ask" }, " most."],
    lede: "Eight direct answers to clear the most common doubts. The rest, we cover in a 90-minute call.",
    items: [
      { q: ["Does my agent speak several ", { em: "languages?" }], a: "Yes. The agent understands and replies in French, English and Mauritian Creole. It switches language automatically based on how the caller speaks to it." },
      { q: ["Who ", { em: "hears" }, " the calls?"], a: "No one at Axon. Transcripts are encrypted and stored on your tenant. You access them from your dashboard. Retention is configurable, 30 days by default." },
      { q: ["What if the agent doesn't understand?"], a: "It says so, rephrases, then hands off to a human with full context already noted. No infinite loop, no “I didn't catch that” five times over." },
      { q: ["Can we ", { em: "change the voice?" }], a: "Yes. Five preset voices in French, Creole and English. Human voice cloning on request (Enterprise plan), with mandatory written consent." },
      { q: [{ em: "Integration" }, " with my existing tools?"], a: "Every integration is built to order for your case, using market connectors and the APIs of the tools you run. CRM, ERP, accounting, calendars, telephony — we plug into what you already use, the way you use it." },
      { q: ["Where is my data ", { em: "hosted?" }], a: "Dedicated infrastructure in Mauritius + EU replication. GDPR, Data Protection Act 2017 compliant. No transfer to non-compliant third-party jurisdictions." },
      { q: ["How much ", { em: "training" }, " time?"], a: "Two 45-minute sessions are enough for your teams to master the dashboard and configure alert flows. The rest — the agent does the work." },
      { q: ["Can I ", { em: "cancel" }, " any time?"], a: "Yes. 30 days' notice. Full data portability included. No penalty, no technical lock-in. Your number, your contacts, your data leave with you." },
    ],
  },
  cta: {
    meta: "§ 09 — BOOK A CALL",
    title: ["Your first agent,", { br: true }, "alive in ", { em: "48 hours." }],
    sub: "A 90-minute call. We audit, we model, we quote. If we can't do your case in 48h, we'll tell you by the end of the call — and we'll refund your setup if we were wrong.",
    book: "Book the call", phone: "+230 5259 1043", note: "contact@axon-ai.mu · Flic-en-Flac, Mauritius · Reply within 4 business hours",
    mailSubject: "Book an Axon call",
  },
  footer: {
    tag: "Voice and text AI agents for businesses in Mauritius and Africa. Live in 48 hours. Measured on results.",
    brandOf: "§ A BRAND OF",
    colProduct: "Product", colSectors: "Sectors",
    product: [
      { l: "Agent catalogue", target: "agents" }, { l: "AI Voices", target: "voix" }, { l: "Integrations", target: "canaux" },
      { l: "Security", target: "contact" }, { l: "Changelog", target: "process" },
    ],
    sectors: [
      { l: "Pro services", target: "secteurs" }, { l: "Retail & hospitality", target: "secteurs" }, { l: "Health", target: "secteurs" },
      { l: "Finance", target: "secteurs" }, { l: "Real estate", target: "secteurs" },
    ],
    copyright: "© 2026 AXON.AI — a brand of Digital Data Solutions · Flic-en-Flac, Mauritius",
    tagline: "While you sleep, your business moves forward.",
  },
};

const COPY: Record<Lang, typeof fr> = { fr, en };

/* ─── shared structural bits (language-independent) ─────────────────── */

function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      <circle cx="13" cy="13" r="12.5" stroke="#F5EFE3" strokeWidth=".8" />
      <circle cx="13" cy="13" r="3" fill="#D66B3C" />
      <circle cx="13" cy="4.5" r="1.6" fill="#F5EFE3" />
      <circle cx="21" cy="17" r="1.6" fill="#F5EFE3" />
      <circle cx="5" cy="17" r="1.6" fill="#F5EFE3" />
      <line x1="13" y1="13" x2="13" y2="4.5" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
      <line x1="13" y1="13" x2="21" y2="17" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
      <line x1="13" y1="13" x2="5" y2="17" stroke="#F5EFE3" strokeWidth=".6" strokeOpacity=".5" />
    </svg>
  );
}

const PROMISE_GLYPHS = [
  <svg key="0" width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="5" stroke="#D66B3C" strokeWidth="1.4" />
    <circle cx="11" cy="11" r="9" stroke="#D66B3C" strokeWidth=".7" strokeDasharray="2 3" />
    <circle cx="11" cy="11" r="1.4" fill="#D66B3C" />
  </svg>,
  <svg key="1" width="22" height="22" viewBox="0 0 22 22" fill="none">
    <rect x="3" y="5" width="16" height="12" stroke="#D66B3C" strokeWidth="1.4" />
    <path d="M3 7l8 5 8-5" stroke="#D66B3C" strokeWidth="1.2" fill="none" />
    <circle cx="18" cy="5" r="2" fill="#D66B3C" />
  </svg>,
  <svg key="2" width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="1.6" fill="#D66B3C" />
    <circle cx="4" cy="7" r="1.4" fill="#D66B3C" fillOpacity=".55" />
    <circle cx="18" cy="7" r="1.4" fill="#D66B3C" fillOpacity=".55" />
    <circle cx="4" cy="15" r="1.4" fill="#D66B3C" fillOpacity=".55" />
    <circle cx="18" cy="15" r="1.4" fill="#D66B3C" fillOpacity=".55" />
    <circle cx="11" cy="3" r="1.4" fill="#D66B3C" fillOpacity=".8" />
    <circle cx="11" cy="19" r="1.4" fill="#D66B3C" fillOpacity=".55" />
    <line x1="11" y1="11" x2="4" y2="7" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
    <line x1="11" y1="11" x2="18" y2="7" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
    <line x1="11" y1="11" x2="4" y2="15" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
    <line x1="11" y1="11" x2="18" y2="15" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
    <line x1="11" y1="11" x2="11" y2="3" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
    <line x1="11" y1="11" x2="11" y2="19" stroke="#D66B3C" strokeWidth=".6" strokeOpacity=".5" />
  </svg>,
];

const CC_ICONS = [
  <svg key="0" width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3 2h3l2 3-2 2a8 8 0 0 0 4 4l2-2 3 2v3a2 2 0 0 1-2 2A12 12 0 0 1 1 4a2 2 0 0 1 2-2z" stroke="#D66B3C" strokeWidth="1.2" fill="none" />
  </svg>,
  <div key="1" className="cc-waveform"><span></span><span></span><span></span><span></span><span></span><span></span></div>,
  <svg key="2" width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M1 12l2-3a6 6 0 1 1 2.3 2.3L2 13z" stroke="#7AB8A8" strokeWidth="1.2" fill="none" />
  </svg>,
  <svg key="3" width="14" height="14" viewBox="0 0 14 14" fill="none">
    <rect x="1" y="3" width="12" height="9" stroke="#D4A454" strokeWidth="1.2" fill="none" />
    <path d="M1 4l6 4 6-4" stroke="#D4A454" strokeWidth="1" fill="none" />
  </svg>,
];

const CHART_BARS = [30, 45, 35, 55, 80, 95, 70, 60, 85, 70, 50, 40];

/* ─── component ────────────────────────────────────────────────────── */

export default function AxonHome({ lang = "fr", spaceHref }: { lang?: Lang; spaceHref: string | null }) {
  const c = COPY[lang];
  const [filter, setFilter] = useState<string>("all");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([c.sectors.data[0].id]));

  const visibleSectors = useMemo(
    () => (filter === "all" ? c.sectors.data : c.sectors.data.filter((s) => s.id === filter)),
    [filter, c],
  );

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const applyFilter = (f: string) => {
    setFilter(f);
    const next = f === "all" ? c.sectors.data : c.sectors.data.filter((s) => s.id === f);
    setOpenIds(new Set(next.length ? [next[0].id] : []));
  };

  const toggleSector = (id: string) =>
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const authCta = spaceHref ? (
    <Link href={spaceHref}><button className="btn btn-ghost btn-sm">{c.nav.space}</button></Link>
  ) : (
    <Link href="/login"><button className="btn btn-ghost btn-sm">{c.nav.signin}</button></Link>
  );

  return (
    <div className={`axon-landing ${instrument.variable} ${jetbrains.variable} ${inter.variable}`}>
      {/* ═══════ NAV ═══════ */}
      <nav>
        <div className="wrap nav-inner">
          <a className="nav-logo" href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <span className="nav-logo-mark"><LogoMark /></span>
            Axon<span style={{ color: "var(--terra)", fontStyle: "italic" }}>.</span>ai
          </a>
          <div className="nav-links">
            {c.nav.links.map((l) => (
              <a key={l.t} onClick={() => scrollTo(l.t)}>{l.l}</a>
            ))}
          </div>
          <div className="nav-right">
            <span className="nav-meta">MU · 2026</span>
            <span className="lang-switch">
              {lang === "fr" ? <a className="on">FR</a> : <Link href="/">FR</Link>}
              {lang === "en" ? <a className="on">EN</a> : <Link href="/en">EN</Link>}
            </span>
            {authCta}
            <button className="btn btn-primary btn-sm" onClick={() => scrollTo("contact")}>
              {c.nav.demo} <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </nav>

      {/* ═══════ HERO ═══════ */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-meta">
            <span className="dot"></span>
            <span className="tag">{c.hero.meta1}</span>
            <span style={{ flex: 1, height: 1, background: "var(--rule2)", minWidth: 40 }}></span>
            <span className="tag">{c.hero.metaA}<span style={{ color: "var(--terra)", margin: "0 8px" }}>/</span>{c.hero.metaB}</span>
          </div>

          <div className="hero-split">
            <div className="hero-split-l">
              <h1 className="hero-h1">
                {c.hero.h1.l1}<br />
                {c.hero.h1.l2}<br />
                <span className="accent">{c.hero.h1.accent}</span>{c.hero.h1.mid}<span className="italic" style={{ color: "var(--mute)" }}>{c.hero.h1.sleep}</span>
              </h1>
              <div className="hero-lede-l">{c.hero.ledeL}</div>
            </div>

            <figure className="hero-portrait">
              <div className="portrait-meta">
                <span>A×N · FIG. 001</span>
                <span className="pm-r">
                  <span>COVER</span>
                  <span style={{ color: "var(--terra2)" }}>● LIVE</span>
                </span>
              </div>
              <span className="portrait-frame-tick tl"></span>
              <span className="portrait-frame-tick tr"></span>
              <span className="portrait-frame-tick bl"></span>
              <span className="portrait-frame-tick br"></span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/axon-hero-portrait.png" alt="Opératrice dans un centre d'opérations IA — Maurice" loading="eager" />
              <figcaption className="portrait-caption">
                <span className="pc-t">{c.hero.caption}</span>
                <span className="pc-tag">Port-Louis · 03:14 MUT</span>
              </figcaption>
            </figure>
          </div>

          <div className="hero-body">
            <p className="hero-lead">{c.hero.lead}</p>
            <div className="hero-side">
              {c.hero.side.map((s) => (
                <div className="hero-side-row" key={s.tag}>
                  <span className="tag">{s.tag}</span>
                  <span className="val">{s.val}<span className="unit">{s.unit}</span></span>
                  <span className="desc">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-ctas">
            <button className="btn btn-primary" onClick={() => scrollTo("contact")}>
              {c.hero.cta1} <span className="arrow">→</span>
            </button>
            <button className="btn btn-ghost" onClick={() => scrollTo("voix")}>{c.hero.cta2}</button>
          </div>

          <div className="ticker" aria-hidden="true">
            <div className="ticker-inner">
              {[...c.hero.ticker, ...c.hero.ticker].map((s, i) => (
                <Fragment key={i}><span>{s}</span><span className="sep">◆</span></Fragment>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ PROMISE ═══════ */}
      <section className="promise">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.promise.num}</div>
              <h2 className="s-title"><Rich t={c.promise.title} /></h2>
            </div>
            <p className="s-lede">{c.promise.lede}</p>
          </div>
        </div>
        <div className="promise-grid">
          {c.promise.cards.map((card, i) => (
            <div className="pc" key={i}>
              <div className="pc-idx">{`0${i + 1} / 03`}</div>
              <div className="pc-glyph">{PROMISE_GLYPHS[i]}</div>
              <div className="pc-kicker">{card.kicker}</div>
              <div className="pc-t"><Rich t={card.title} /></div>
              <div className="pc-d">{card.desc}</div>
              <div className="pc-metric">
                <div className="pc-metric-n">{card.metricN}<span style={{ fontSize: "0.5em", color: "var(--mute)" }}>{card.metricU}</span></div>
                <div className="pc-metric-l">{card.metricL.map((l, j) => <Fragment key={j}>{j ? <br /> : null}{l}</Fragment>)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══════ CHANNELS ═══════ */}
      <section className="channels" id="canaux">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.channels.num}</div>
              <h2 className="s-title"><Rich t={c.channels.title} /></h2>
            </div>
            <p className="s-lede">{c.channels.lede}</p>
          </div>

          <div className="ch-grid">
            <div className="ch-list">
              {c.channels.list.map((ch) => (
                <div className="ch-item" key={ch.n}>
                  <div className="ch-num">{ch.num}</div>
                  <div className="ch-body">
                    <div className="ch-t">{ch.pre}<span className="acc">{ch.acc}</span></div>
                    <div className="ch-d">{ch.desc}</div>
                    <div className="ch-meta">{ch.meta}</div>
                  </div>
                  <div className="tag mono">{ch.n}</div>
                </div>
              ))}
            </div>

            <div className="ch-visual">
              <div className="ch-visual-label">{c.channels.visLabel}</div>
              <div className="ch-visual-head">{c.channels.visHead}</div>
              <div className="cc-stack">
                {c.channels.cc.map((cc, i) => (
                  <div className="cc" key={i}>
                    <div className="cc-icon">{CC_ICONS[i]}</div>
                    <div>
                      <div className="cc-title">{cc.title}</div>
                      <div className="cc-sub">{cc.sub}</div>
                    </div>
                    {cc.rightCls === "t" ? <span className="cc-chip t">{cc.right}</span>
                      : cc.rightCls === "g" ? <span className="cc-chip g">{cc.right}</span>
                      : i === 0 ? <div className="cc-time">{cc.right}</div>
                      : <span className="cc-chip">{cc.right}</span>}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <span className="tag">{c.channels.chartLabel}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--terra)" }}>{c.channels.chartVal}</span>
                </div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 44 }}>
                  {CHART_BARS.map((h, i) => (
                    <div key={i} style={{ flex: 1, background: "var(--terra)", height: `${h}%`, opacity: 0.3 + h / 200 }}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ AGENTS ═══════ */}
      <section className="agents" id="agents">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.agents.num}</div>
              <h2 className="s-title"><Rich t={c.agents.title} /></h2>
            </div>
            <p className="s-lede">{c.agents.lede}</p>
          </div>
        </div>
        <div className="wrap">
          <div className="ag-grid">
            {c.agents.items.map((a) => (
              <div className="ag" key={a.em}>
                <div className="ag-head">
                  <span className="ag-role">{a.role}</span>
                  <span className={`ag-kind${a.v ? " v" : ""}`}>{a.kind}</span>
                </div>
                <h3 className="ag-name">{a.pre}<em>{a.em}</em></h3>
                <p className="ag-desc">{a.desc}</p>
                <div className="ag-footer">
                  <div>
                    <div className="ag-kpi">{a.kpi}{a.unit && <span style={{ fontSize: "0.5em", color: "var(--mute)" }}>{a.unit}</span>}</div>
                    <div className="ag-kpi-l">{a.kpiL}</div>
                  </div>
                  <div className="ag-arrow">{c.agents.view}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ VOICE ═══════ */}
      <section className="voice" id="voix">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.voice.num}</div>
              <h2 className="s-title"><Rich t={c.voice.title} /></h2>
            </div>
            <p className="s-lede">{c.voice.lede}</p>
          </div>

          <div className="vx-grid" style={{ gridTemplateColumns: "1fr", maxWidth: 880, margin: "0 auto" }}>
            <div>
              <div className="tag" style={{ marginBottom: 28 }}>{c.voice.tag}</div>
              <div className="vx-timeline">
                {c.voice.steps.map((s) => (
                  <div className={`vx-step${s.live ? " live" : ""}`} key={s.time}>
                    <div className="vx-step-time">{s.time}</div>
                    <div className="vx-step-t">{s.t}</div>
                    <div className="vx-step-d">{s.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ SECTORS ═══════ */}
      <section className="sectors" id="secteurs">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.sectors.num}</div>
              <h2 className="s-title"><Rich t={c.sectors.title} /></h2>
            </div>
            <p className="s-lede">{c.sectors.lede}</p>
          </div>

          <div className="sc-filters">
            {c.sectors.filters.map((b) => (
              <button key={b.f} className={`sc-filter${filter === b.f ? " on" : ""}`} onClick={() => applyFilter(b.f)}>{b.l}</button>
            ))}
          </div>

          <div id="sc-wrap">
            {visibleSectors.map((s) => {
              const open = openIds.has(s.id);
              return (
                <div className={`sc-block${open ? " open" : ""}`} data-sid={s.id} key={s.id}>
                  <div className="sc-head" onClick={() => toggleSector(s.id)}>
                    <div className="sc-glyph">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <circle cx="10" cy="10" r="5" stroke="#D66B3C" strokeWidth="1.3" />
                        <circle cx="10" cy="10" r="1.8" fill="#D66B3C" />
                      </svg>
                    </div>
                    <div>
                      <div className="sc-title">{s.title}</div>
                      <div className="sc-meta">{s.meta}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="sc-count">{s.count}</div>
                      <div className="sc-meta">{c.sectors.metiersLabel}</div>
                    </div>
                    <div className="sc-kpi">{s.kpi}</div>
                    <div className="sc-toggle">+</div>
                  </div>
                  <div className="sc-body">
                    <div className="sc-body-inner">
                      {s.metiers.map((m) => (
                        <div className="mc" key={m.t}>
                          <div className="mc-head">
                            <div className="mc-t">{m.t}</div>
                            <div className={`mc-k${m.k === "WA" ? " w" : ""}`}>{m.k}</div>
                          </div>
                          <div className="mc-list">
                            {m.items.map((it) => (
                              <div className="mc-li" key={it}>{it}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="sc-custom">
            <div>
              <div className="tag" style={{ marginBottom: 16, color: "var(--terra)" }}>{c.sectors.customTag}</div>
              <div className="sc-custom-t"><Rich t={c.sectors.customTitle} /></div>
              <div className="sc-custom-d">{c.sectors.customDesc}</div>
            </div>
            <button className="btn btn-primary" onClick={() => scrollTo("contact")}>
              {c.sectors.customBtn} <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </section>

      {/* ═══════ PROOF ═══════ */}
      <section className="proof">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.proof.num}</div>
              <h2 className="s-title"><Rich t={c.proof.title} /></h2>
            </div>
            <p className="s-lede">{c.proof.lede}</p>
          </div>
        </div>
        <div className="wrap">
          <div className="pf-grid">
            {c.proof.items.map((p) => (
              <div className="pf" key={p.kicker}>
                <div className="pf-kicker">{p.kicker}</div>
                <div className="pf-n">{p.n}<span className="unit">{p.unit}</span></div>
                <div className="pf-t">{p.t}</div>
                <div className="pf-d">{p.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ PROCESS ═══════ */}
      <section className="process" id="process">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.process.num}</div>
              <h2 className="s-title"><Rich t={c.process.title} /></h2>
            </div>
            <p className="s-lede">{c.process.lede}</p>
          </div>

          <div className="ps-timeline">
            {c.process.items.map((p) => (
              <div className="ps" key={p.num}>
                <div className="ps-num">{p.num}</div>
                <div className="ps-dot"></div>
                <div className="ps-when">{p.when}</div>
                <div className="ps-t">{p.t}</div>
                <div className="ps-d">{p.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ FAQ ═══════ */}
      <section className="faq">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">{c.faq.num}</div>
              <h2 className="s-title"><Rich t={c.faq.title} /></h2>
            </div>
            <p className="s-lede">{c.faq.lede}</p>
          </div>

          <div className="faq-grid">
            {c.faq.items.map((q, i) => (
              <div className="faq-item" key={i}>
                <div className="faq-q"><Rich t={q.q} /></div>
                <div className="faq-a">{q.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ CTA ═══════ */}
      <section className="cta-s" id="contact">
        <div className="wrap cta-inner">
          <div className="cta-meta">{c.cta.meta}</div>
          <h2 className="cta-h"><Rich t={c.cta.title} /></h2>
          <p className="cta-sub">{c.cta.sub}</p>
          <div className="cta-btns">
            <a href={`mailto:contact@axon-ai.mu?subject=${encodeURIComponent(c.cta.mailSubject)}`}><button className="btn btn-primary">{c.cta.book} <span className="arrow">→</span></button></a>
            <a href="tel:+23052591043"><button className="btn btn-ghost">{c.cta.phone}</button></a>
          </div>
          <div className="cta-note">{c.cta.note}</div>
        </div>
      </section>

      {/* ═══════ FOOTER ═══════ */}
      <footer>
        <div className="wrap">
          <div className="foot-top">
            <div>
              <div className="foot-brand">
                <LogoMark size={28} />
                Axon<span style={{ color: "var(--terra)", fontStyle: "italic" }}>.</span>ai
              </div>
              <p className="foot-tag">{c.footer.tag}</p>
              <p className="foot-parent">
                <span className="foot-parent-lbl">{c.footer.brandOf}</span>
                <a href="https://www.digital-data-solutions.net/" target="_blank" rel="noopener" className="foot-parent-link">
                  Digital Data Solutions <span className="foot-parent-arrow">↗</span>
                </a>
              </p>
            </div>
            <div className="foot-col">
              <h4>{c.footer.colProduct}</h4>
              {c.footer.product.map((l) => <a key={l.l} onClick={() => scrollTo(l.target)}>{l.l}</a>)}
            </div>
            <div className="foot-col">
              <h4>{c.footer.colSectors}</h4>
              {c.footer.sectors.map((l, i) => <a key={i} onClick={() => scrollTo(l.target)}>{l.l}</a>)}
            </div>
          </div>
          <div className="foot-bot">
            <div className="foot-meta">{c.footer.copyright}</div>
            <div className="foot-meta italic serif" style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14, color: "var(--mute)" }}>{c.footer.tagline}</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

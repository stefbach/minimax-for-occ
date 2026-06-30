"use client";

/* eslint-disable react/no-unescaped-entities */

/**
 * AxonHome — public marketing homepage (the "magazine" edition).
 *
 * Faithful port of the standalone axon-ai.tech static site into the Next.js
 * app, so the platform's real homepage and the client app live on one domain.
 * Markup mirrors the original section-for-section; the two interactive bits
 * (sector accordion + filters, monthly/annual pricing toggle) are reimplemented
 * with React state. Styles live in ./axon-home.css, fully scoped under
 * .axon-landing so the editorial design never leaks into the app shell.
 *
 * The only addition vs. the original is the nav "Se connecter" button (next to
 * "Démo"). Logged-in visitors never see this page — the (marketing) route
 * redirects them to their space — so the auth CTA always points to /login,
 * unless a spaceHref is explicitly provided.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Instrument_Serif, JetBrains_Mono, Inter } from "next/font/google";
import "./axon-home.css";

// Self-hosted via next/font so we don't have to broaden the app's strict CSP
// to allow fonts.googleapis.com / fonts.gstatic.com. Exposed as CSS variables
// the editorial stylesheet (axon-home.css) consumes through --serif/--sans/--mono.
const instrument = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const jetbrains = JetBrains_Mono({ weight: ["400", "500"], subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });
const inter = Inter({ weight: ["300", "400", "500", "600"], subsets: ["latin"], variable: "--font-inter", display: "swap" });

/* ─── data ─────────────────────────────────────────────────────────── */

const AGENTS = [
  { role: "Réception · 24/7", kind: "VOCAL", v: true, pre: "La ", em: "standardiste", post: "", desc: "Décroche, qualifie, oriente, prend message. Connaît vos horaires, vos équipes, vos procédures d'accueil.", kpi: "96", unit: "%", kpiL: "APPELS PRIS" },
  { role: "Réservation", kind: "VOCAL + CHAT", v: true, pre: "La ", em: "booker", post: "", desc: "Tiens l'agenda : hôtels, cliniques, coiffeurs, garages. Confirme, rappelle J−1, gère les annulations et replanifie.", kpi: "−50", unit: "%", kpiL: "NO-SHOW" },
  { role: "Commercial", kind: "WHATSAPP", v: false, pre: "Le ", em: "closeur", post: "", desc: "Qualifie les leads entrants, envoie devis en moins d'une minute, relance les opportunités chaudes, transfère le closing.", kpi: "×3.4", unit: "", kpiL: "TAUX CONVERSION" },
  { role: "Support", kind: "VOCAL + EMAIL", v: true, pre: "Le ", em: "premier niveau", post: "", desc: "Répond aux questions récurrentes, résout 70% des tickets L1, escalade proprement le reste avec tout le contexte.", kpi: "70", unit: "%", kpiL: "TICKETS RÉSOLUS" },
  { role: "Facturation · Recouvrement", kind: "EMAIL + WA", v: false, pre: "Le ", em: "relanceur", post: "", desc: "Surveille les impayés, envoie les relances graduées, téléphone aux mauvais payeurs avec tact. Se synchronise à Sage et Odoo.", kpi: "−18", unit: " j", kpiL: "DÉLAI PAIEMENT" },
  { role: "RH · Recrutement", kind: "VOCAL", v: true, pre: "Le ", em: "préqualifieur", post: "", desc: "Appelle 200 candidats par jour, pose les bonnes questions, note les réponses, programme les entretiens des meilleurs.", kpi: "12×", unit: "", kpiL: "VITESSE DE TRI" },
  { role: "Logistique", kind: "CHAT + CRM", v: false, pre: "Le ", em: "traqueur", post: "", desc: "Suit les commandes, notifie les retards, gère les réclamations transporteur. Intégré DHL, FedEx, Mauritius Post.", kpi: "98", unit: "%", kpiL: "NOTIFIÉ À TEMPS" },
  { role: "Santé · Médical", kind: "VOCAL", v: true, pre: "La ", em: "secrétaire médicale", post: "", desc: "Prend les rendez-vous, gère le télésecrétariat, envoie les ordonnances renouvelées, respecte la confidentialité médicale.", kpi: "100", unit: "%", kpiL: "APPELS RÉPONDUS" },
  { role: "Finance · Ops", kind: "EMAIL + API", v: false, pre: "L'", em: "opérateur", post: "", desc: "Rapports hebdos, reportings clients, consolidation de données inter-outils, alertes seuils métiers personnalisées.", kpi: "22", unit: " h", kpiL: "/ SEMAINE ÉCONOMISÉES" },
];

const CHANNELS = [
  { num: "/01", pre: "Téléphone, ", acc: "voix naturelle.", desc: "Décroche en 1 sonnerie. Parle français, créole mauricien et anglais sans accent synthétique. Transfère à un humain quand il le faut.", meta: "ENTRANT · SORTANT · TRANSFERT · WEBCALL", n: "01" },
  { num: "/02", pre: "WhatsApp, ", acc: "instantané.", desc: "Confirmations, rappels, devis, réponses techniques. Templates Business API approuvés, historique conservé par client.", meta: "NOTIFICATIONS · CHATBOT · HUMAN-HANDOFF", n: "02" },
  { num: "/03", pre: "Email, ", acc: "professionnel.", desc: "Rédige et envoie confirmations, devis PDF signés, rapports hebdos. Templates brandés, pièces jointes générées à la volée.", meta: "TRANSACTIONNEL · COMMERCIAL · RAPPORTS", n: "03" },
  { num: "/04", pre: "Mémoire, ", acc: "permanente.", desc: "Votre agent se souvient de chaque interaction, sur tous les canaux. Il connaît vos clients, leur historique, leurs préférences.", meta: "HISTORIQUE · PROFIL · CRM SYNC", n: "04" },
];

const VOICE_STEPS = [
  { time: "+00:00 · DÉCROCHE", t: "Détection d'appel entrant", d: "L'agent décroche avant la deuxième sonnerie et salue en français, créole ou anglais selon le numéro d'appel.", live: true },
  { time: "+00:02 · COMPRÉHENSION", t: "Transcription streaming + intent", d: "La parole est transcrite en streaming en moins de 300 ms. L'intention et l'entité métier sont identifiées immédiatement.", live: true },
  { time: "+00:05 · ACTION", t: "Appel d'outils en parallèle", d: "L'agent lit votre CRM, consulte l'agenda, calcule un devis, prépare les messages WhatsApp et email à envoyer.", live: true },
  { time: "+00:09 · RÉPONSE VOCALE", t: "Synthèse vocale naturelle", d: "Voix humaine, pauses contextuelles, respirations. Aucun robotisme audible, aucune latence perceptible.", live: false },
  { time: "+00:14 · SUIVI AUTO", t: "Raccroché, mais pas fini", d: "Résumé d'appel envoyé à votre équipe, ticket CRM créé, WhatsApp de confirmation délivré, rappel J−1 planifié.", live: false },
];

const PROOF = [
  { kicker: "§ PRODUCTIVITÉ", n: "−80", unit: "%", t: "Tâches répétitives éliminées", d: "Vos équipes libèrent 4 jours sur 5 pour ce qu'aucune machine ne remplace." },
  { kicker: "§ RÉACTIVITÉ", n: "< 2", unit: "min", t: "Délai de réponse moyen", d: "Contre 4 heures en moyenne pour une réponse humaine pendant les heures ouvrées." },
  { kicker: "§ VITESSE", n: "48", unit: "h", t: "Premier agent actif", d: "Du brief au déploiement en production. Brief lundi matin, agent vivant mercredi." },
  { kicker: "§ DISPONIBILITÉ", n: "24", unit: "/7", t: "Garantie continue", d: "Week-ends, jours fériés, milieu de nuit, Diwali, Noël. Aucune pause." },
];

const PROCESS = [
  { num: "01", when: "JOUR 1 · 90 MIN", t: "On écoute votre métier", d: "Audit de vos canaux, de vos points de friction, de votre stack. On identifie l'agent au plus fort impact immédiat." },
  { num: "02", when: "JOUR 1 · FIN", t: "On modélise le flux", d: "Vocabulaire métier, règles, intégrations, persona vocal. Document signé en fin de journée." },
  { num: "03", when: "JOUR 2 · MATIN", t: "On configure l'agent", d: "Agent entraîné, connecté à WhatsApp, Sage, Google Workspace. Tests de bout en bout sur scénarios réels." },
  { num: "04", when: "JOUR 2 · 17H", t: "On passe en live", d: "Bascule progressive, monitoring temps réel, astreinte Axon 24/7 pour la première semaine de production." },
];

type Feat = { t: string; cls?: string };
type Plan = {
  name: string; target: string; m?: number; a?: number; priceText?: string;
  per?: string; annA?: string; annStatic?: string; setup: string; feats: Feat[]; btn: string; feat?: boolean;
};
const PLANS: Plan[] = [
  { name: "Découverte", target: "TPE · 1 CANAL", m: 9500, a: 7900, per: "/mois", annA: "Rs 94.800 / an · économisez Rs 19.200", setup: "SETUP · Rs 15.000", btn: "Choisir", feats: [
    { t: "1 agent voix ou chat", cls: "hi" }, { t: "200 appels ou 500 messages / mois" }, { t: "Intégration WhatsApp Business" }, { t: "Tableau de bord standard" }, { t: "Voix clonée personnalisée", cls: "dim" }, { t: "Multi-canal unifié", cls: "dim" },
  ] },
  { name: "Croissance", target: "PME · 2 CANAUX", m: 24500, a: 20400, per: "/mois", annA: "Rs 244.800 / an · économisez Rs 49.200", setup: "SETUP · Rs 35.000", btn: "Démarrer", feat: true, feats: [
    { t: "2 agents (voix + messagerie)", cls: "hi" }, { t: "1000 appels + 2500 messages" }, { t: "Intégrations Sage, HubSpot, Zoho" }, { t: "Voix française + créole + anglais" }, { t: "Astreinte 5j/7 · 9h–18h" }, { t: "Voix clonée personnalisée", cls: "dim" },
  ] },
  { name: "Entreprise", target: "ETI · ILLIMITÉ", m: 58000, a: 48300, per: "/mois", annA: "Rs 579.600 / an · économisez Rs 116.400", setup: "SETUP · Rs 65.000", btn: "Contacter", feats: [
    { t: "5 agents — voix, chat, email, API", cls: "hi" }, { t: "Volume illimité raisonnable" }, { t: "Intégrations API personnalisées" }, { t: "Voix clonée personnalisée" }, { t: "Astreinte 24/7" }, { t: "SLA 99,9% garanti", cls: "hi" },
  ] },
  { name: "Sur mesure", target: "GROUPE · FLOTTES", priceText: "Devis", annStatic: "architecture dédiée", setup: "AUDIT · 90 MIN", btn: "Parler à un architecte", feats: [
    { t: "Agents illimités, scope défini", cls: "hi" }, { t: "Infrastructure dédiée MU + UE" }, { t: "Intégration SI complète" }, { t: "Formation équipes métier" }, { t: "Chef de projet dédié" }, { t: "Gouvernance + audit annuel", cls: "hi" },
  ] },
];

const FAQ = [
  { pre: "Mon agent parle-t-il plusieurs ", em: "langues ?", post: "", a: "Oui. L'agent comprend et répond en français, en anglais et en créole mauricien. Il bascule de langue automatiquement selon la façon dont l'appelant lui parle." },
  { pre: "Qui ", em: "entend", post: " les appels ?", a: "Personne chez Axon. Les transcriptions sont chiffrées, stockées sur votre tenant. Vous y accédez depuis votre tableau de bord. Rétention paramétrable, 30 jours par défaut." },
  { pre: "Et si l'agent ne comprend pas ?", em: "", post: "", a: "Il le dit, reformule, puis transfère à un humain avec tout le contexte déjà noté. Pas de boucle infinie, pas de « je n'ai pas compris » répété cinq fois." },
  { pre: "Peut-on ", em: "changer la voix ?", post: "", a: "Oui. Cinq voix préréglées en français, créole et anglais. Clonage de voix humaine sur demande (Plan Entreprise), avec consentement écrit obligatoire." },
  { pre: "", em: "Intégration", post: " avec mes outils existants ?", a: "Chaque intégration est construite sur mesure pour votre cas, en s'appuyant sur les connecteurs du marché et les APIs de vos outils. CRM, ERP, comptabilité, calendriers, téléphonie : on branche ce que vous utilisez, comme vous l'utilisez." },
  { pre: "Où sont ", em: "hébergées", post: " mes données ?", a: "Infrastructure dédiée à Maurice + réplication UE. Conformité RGPD, Data Protection Act 2017. Aucun transfert vers des juridictions tierces non conformes." },
  { pre: "Combien de temps de ", em: "formation ?", post: "", a: "Deux sessions de 45 min suffisent à vos équipes pour prendre en main le tableau de bord et configurer les flux d'alertes. Le reste, c'est à l'agent de faire le travail." },
  { pre: "Puis-je ", em: "arrêter", post: " quand je veux ?", a: "Oui. Préavis 30 jours. Portabilité totale des données incluse. Aucune pénalité, aucun verrouillage technique. Votre numéro, vos contacts, vos données partent avec vous." },
];

type Metier = { t: string; k: string; items: string[] };
type Sector = { id: string; title: string; meta: string; count: number; kpi: string; metiers: Metier[] };
const SECTORS: Sector[] = [
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
];

/* ─── small bits ───────────────────────────────────────────────────── */

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

const fmtRs = (n: number) => "Rs " + n.toLocaleString("fr-FR").replace(/[\s  ]/g, ".");

/* ─── component ────────────────────────────────────────────────────── */

export default function AxonHome({ spaceHref }: { spaceHref: string | null }) {
  const [filter, setFilter] = useState<string>("all");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([SECTORS[0].id]));
  const [annual, setAnnual] = useState(false);

  const visibleSectors = useMemo(
    () => (filter === "all" ? SECTORS : SECTORS.filter((s) => s.id === filter)),
    [filter],
  );

  const scrollTo = (id: string) =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  const applyFilter = (f: string) => {
    setFilter(f);
    const next = f === "all" ? SECTORS : SECTORS.filter((s) => s.id === f);
    setOpenIds(new Set(next.length ? [next[0].id] : []));
  };

  const toggleSector = (id: string) =>
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const authCta = spaceHref ? (
    <Link href={spaceHref}><button className="btn btn-ghost btn-sm">Mon espace</button></Link>
  ) : (
    <Link href="/login"><button className="btn btn-ghost btn-sm">Se connecter</button></Link>
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
            <a onClick={() => scrollTo("agents")}>Agents</a>
            <a onClick={() => scrollTo("canaux")}>Canaux</a>
            <a onClick={() => scrollTo("voix")}>Voix</a>
            <a onClick={() => scrollTo("secteurs")}>Secteurs</a>
            <a onClick={() => scrollTo("tarifs")}>Tarifs</a>
            <a onClick={() => scrollTo("process")}>Process</a>
          </div>
          <div className="nav-right">
            <span className="nav-meta">MU · 2026</span>
            <span className="lang-switch">
              <a className="on">FR</a>
              <Link href="/en">EN</Link>
            </span>
            {authCta}
            <button className="btn btn-primary btn-sm" onClick={() => scrollTo("contact")}>
              Démo <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </nav>

      {/* ═══════ HERO ═══════ */}
      <section className="hero">
        <div className="wrap">
          <div className="hero-meta">
            <span className="dot"></span>
            <span className="tag">Édition № 01 — Port-Louis, Avril 2026</span>
            <span style={{ flex: 1, height: 1, background: "var(--rule2)", minWidth: 40 }}></span>
            <span className="tag">Agents IA<span style={{ color: "var(--terra)", margin: "0 8px" }}>/</span>Maurice & Afrique</span>
          </div>

          <div className="hero-split">
            <div className="hero-split-l">
              <h1 className="hero-h1">
                Une entreprise<br />
                qui travaille<br />
                <span className="accent">pendant</span> que vous <span className="italic" style={{ color: "var(--mute)" }}>dormez.</span>
              </h1>
              <div className="hero-lede-l">
                Des agents IA vocaux et textuels qui décrochent, écrivent, agissent. 24&nbsp;heures sur 24, dans votre langue, connectés à vos outils.
              </div>
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
                <span className="pc-t">« Mon agent a pris&nbsp;42 appels pendant que je dormais. »</span>
                <span className="pc-tag">Port-Louis · 03:14 MUT</span>
              </figcaption>
            </figure>
          </div>

          <div className="hero-body">
            <p className="hero-lead">
              Axon déploie des agents vocaux et textuels qui décrochent le téléphone, tiennent la conversation sur WhatsApp, envoient les devis, rappellent les rendez-vous et mettent à jour votre agenda — sans jamais quitter leur poste.
            </p>

            <div className="hero-side">
              <div className="hero-side-row">
                <span className="tag">01 · Déploiement</span>
                <span className="val">48<span className="unit">h</span></span>
                <span className="desc">Du brief initial à l'agent opérationnel sur vos lignes et canaux réels.</span>
              </div>
              <div className="hero-side-row">
                <span className="tag">02 · Disponibilité</span>
                <span className="val">24<span className="unit">/7</span></span>
                <span className="desc">Week-ends, jours fériés, milieu de nuit. Votre agent ne prend jamais de congé.</span>
              </div>
              <div className="hero-side-row">
                <span className="tag">03 · Charge administrative</span>
                <span className="val">−80<span className="unit">%</span></span>
                <span className="desc">Vos équipes se concentrent enfin sur ce qu'aucune machine ne peut remplacer.</span>
              </div>
            </div>
          </div>

          <div className="hero-ctas">
            <button className="btn btn-primary" onClick={() => scrollTo("contact")}>
              Activer mon premier agent <span className="arrow">→</span>
            </button>
            <button className="btn btn-ghost" onClick={() => scrollTo("voix")}>
              Écouter une démo vocale
            </button>
          </div>

          <div className="ticker" aria-hidden="true">
            <div className="ticker-inner">
              <span>Voix naturelle en français · créole · anglais</span><span className="sep">◆</span>
              <span>Intégré à WhatsApp, Gmail, Outlook, Sage, Zoho</span><span className="sep">◆</span>
              <span>Hébergé sur infrastructure souveraine</span><span className="sep">◆</span>
              <span>Conforme RGPD + Data Protection Act 2017</span><span className="sep">◆</span>
              <span>130+ cas d'usage modélisés</span><span className="sep">◆</span>
              <span>Voix naturelle en français · créole · anglais</span><span className="sep">◆</span>
              <span>Intégré à WhatsApp, Gmail, Outlook, Sage, Zoho</span><span className="sep">◆</span>
              <span>Hébergé sur infrastructure souveraine</span><span className="sep">◆</span>
              <span>Conforme RGPD + Data Protection Act 2017</span><span className="sep">◆</span>
              <span>130+ cas d'usage modélisés</span><span className="sep">◆</span>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ PROMISE ═══════ */}
      <section className="promise">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">§ 01 — LA PROMESSE</div>
              <h2 className="s-title">Trois <em>gestes</em> que vos agents font, sans vous.</h2>
            </div>
            <p className="s-lede">Pas des chatbots maladroits. Des agents qui décrochent, parlent, écrivent et agissent — connectés à vos outils, entraînés à votre métier, mesurés au résultat.</p>
          </div>
        </div>
        <div className="promise-grid">
          <div className="pc">
            <div className="pc-idx">01 / 03</div>
            <div className="pc-glyph">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle cx="11" cy="11" r="5" stroke="#D66B3C" strokeWidth="1.4" />
                <circle cx="11" cy="11" r="9" stroke="#D66B3C" strokeWidth=".7" strokeDasharray="2 3" />
                <circle cx="11" cy="11" r="1.4" fill="#D66B3C" />
              </svg>
            </div>
            <div className="pc-kicker">Canal vocal</div>
            <div className="pc-t">Votre téléphone <em style={{ fontStyle: "italic", color: "var(--terra)" }}>répond</em> tout seul.</div>
            <div className="pc-d">Votre agent décroche dès la première sonnerie, comprend la demande en français, créole ou anglais, prend le rendez-vous, transfère si nécessaire.</div>
            <div className="pc-metric">
              <div className="pc-metric-n">−50<span style={{ fontSize: "0.5em", color: "var(--mute)" }}>%</span></div>
              <div className="pc-metric-l">DE NO-SHOW<br />GRÂCE AUX RAPPELS AUTO</div>
            </div>
          </div>
          <div className="pc">
            <div className="pc-idx">02 / 03</div>
            <div className="pc-glyph">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="3" y="5" width="16" height="12" stroke="#D66B3C" strokeWidth="1.4" />
                <path d="M3 7l8 5 8-5" stroke="#D66B3C" strokeWidth="1.2" fill="none" />
                <circle cx="18" cy="5" r="2" fill="#D66B3C" />
              </svg>
            </div>
            <div className="pc-kicker">Messagerie</div>
            <div className="pc-t">WhatsApp & email <em style={{ fontStyle: "italic", color: "var(--terra)" }}>en deux minutes.</em></div>
            <div className="pc-d">Chaque appel, formulaire ou demande déclenche une réponse personnalisée. Devis PDF, confirmations, rappels — écrits et envoyés sans intervention.</div>
            <div className="pc-metric">
              <div className="pc-metric-n">&lt; 2<span style={{ fontSize: "0.5em", color: "var(--mute)" }}> min</span></div>
              <div className="pc-metric-l">DÉLAI MOYEN<br />DE RÉPONSE CLIENT</div>
            </div>
          </div>
          <div className="pc">
            <div className="pc-idx">03 / 03</div>
            <div className="pc-glyph">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
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
              </svg>
            </div>
            <div className="pc-kicker">Automatisation</div>
            <div className="pc-t">Vos processus <em style={{ fontStyle: "italic", color: "var(--terra)" }}>tournent seuls.</em></div>
            <div className="pc-d">Réservations, devis, relances, rapports, onboarding — vos flux de travail de bout en bout, pris en charge par des agents autonomes et audités.</div>
            <div className="pc-metric">
              <div className="pc-metric-n">×10</div>
              <div className="pc-metric-l">CAPACITÉ DE TRAITEMENT<br />SANS EMBAUCHE</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════ CHANNELS ═══════ */}
      <section className="channels" id="canaux">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">§ 02 — OMNICANAL</div>
              <h2 className="s-title">Un agent. <em>Tous</em> vos canaux. Simultanément.</h2>
            </div>
            <p className="s-lede">Appel entrant, réponse WhatsApp instantanée, email de confirmation, mise à jour CRM — le tout en quelques secondes, avec un seul agent qui garde le contexte.</p>
          </div>

          <div className="ch-grid">
            <div className="ch-list">
              {CHANNELS.map((c) => (
                <div className="ch-item" key={c.n}>
                  <div className="ch-num">{c.num}</div>
                  <div className="ch-body">
                    <div className="ch-t">{c.pre}<span className="acc">{c.acc}</span></div>
                    <div className="ch-d">{c.desc}</div>
                    <div className="ch-meta">{c.meta}</div>
                  </div>
                  <div className="tag mono">{c.n}</div>
                </div>
              ))}
            </div>

            <div className="ch-visual">
              <div className="ch-visual-label">LIVE — VUE AGENT · 14:27:03 MUT</div>
              <div className="ch-visual-head">Une seule conversation qui rebondit entre canaux, sans perdre le fil.</div>
              <div className="cc-stack">
                <div className="cc">
                  <div className="cc-icon">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M3 2h3l2 3-2 2a8 8 0 0 0 4 4l2-2 3 2v3a2 2 0 0 1-2 2A12 12 0 0 1 1 4a2 2 0 0 1 2-2z" stroke="#D66B3C" strokeWidth="1.2" fill="none" />
                    </svg>
                  </div>
                  <div>
                    <div className="cc-title">Appel entrant — Mme Appadoo</div>
                    <div className="cc-sub">+230 5 712 · Rodez & Cie</div>
                  </div>
                  <div className="cc-time">14:27:03</div>
                </div>
                <div className="cc">
                  <div className="cc-icon">
                    <div className="cc-waveform"><span></span><span></span><span></span><span></span><span></span><span></span></div>
                  </div>
                  <div>
                    <div className="cc-title">"Je voudrais un devis pour 200 cartons"</div>
                    <div className="cc-sub">Transcription + intent: quote_request</div>
                  </div>
                  <span className="cc-chip t">EN COURS</span>
                </div>
                <div className="cc">
                  <div className="cc-icon">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M1 12l2-3a6 6 0 1 1 2.3 2.3L2 13z" stroke="#7AB8A8" strokeWidth="1.2" fill="none" />
                    </svg>
                  </div>
                  <div>
                    <div className="cc-title">WhatsApp envoyé — devis PDF #2814</div>
                    <div className="cc-sub">Montant: Rs 142.500 · Livraison J+3</div>
                  </div>
                  <span className="cc-chip">+ 00:14</span>
                </div>
                <div className="cc">
                  <div className="cc-icon">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <rect x="1" y="3" width="12" height="9" stroke="#D4A454" strokeWidth="1.2" fill="none" />
                      <path d="M1 4l6 4 6-4" stroke="#D4A454" strokeWidth="1" fill="none" />
                    </svg>
                  </div>
                  <div>
                    <div className="cc-title">Email + RDV calendrier + CRM sync</div>
                    <div className="cc-sub">Sage 100 · Google Calendar · HubSpot</div>
                  </div>
                  <span className="cc-chip g">DONE</span>
                </div>
              </div>

              <div style={{ marginTop: 32, paddingTop: 20, borderTop: "1px solid var(--rule)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                  <span className="tag">VOLUME · DERNIÈRES 24H</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--terra)" }}>2 847 interactions</span>
                </div>
                <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 44 }}>
                  {[30, 45, 35, 55, 80, 95, 70, 60, 85, 70, 50, 40].map((h, i) => (
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
              <div className="s-num">§ 03 — CATALOGUE</div>
              <h2 className="s-title">Un agent <em>taillé</em> pour chaque métier.</h2>
            </div>
            <p className="s-lede">Neuf figures choisies parmi les plus demandées. Chacune vit sur vos canaux réels, parle votre langue et connaît votre stack — WhatsApp, Sage, HubSpot, Google Workspace.</p>
          </div>
        </div>
        <div className="wrap">
          <div className="ag-grid">
            {AGENTS.map((a) => (
              <div className="ag" key={a.em}>
                <div className="ag-head">
                  <span className="ag-role">{a.role}</span>
                  <span className={`ag-kind${a.v ? " v" : ""}`}>{a.kind}</span>
                </div>
                <h3 className="ag-name">{a.pre}<em>{a.em}</em>{a.post}</h3>
                <p className="ag-desc">{a.desc}</p>
                <div className="ag-footer">
                  <div>
                    <div className="ag-kpi">{a.kpi}{a.unit && <span style={{ fontSize: "0.5em", color: "var(--mute)" }}>{a.unit}</span>}</div>
                    <div className="ag-kpi-l">{a.kpiL}</div>
                  </div>
                  <div className="ag-arrow">VOIR →</div>
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
              <div className="s-num">§ 04 — TECHNOLOGIE VOCALE</div>
              <h2 className="s-title">La voix, comme <em>interface</em> native.</h2>
            </div>
            <p className="s-lede">Un appel déclenche une cascade d'actions : WhatsApp, email, CRM, agenda — exécutées en temps réel, sans latence perceptible par l'appelant.</p>
          </div>

          <div className="vx-grid" style={{ gridTemplateColumns: "1fr", maxWidth: 880, margin: "0 auto" }}>
            <div>
              <div className="tag" style={{ marginBottom: 28 }}>// ANATOMIE D'UN APPEL · 14 SECONDES</div>
              <div className="vx-timeline">
                {VOICE_STEPS.map((s) => (
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
              <div className="s-num">§ 05 — PANORAMA SECTORIEL</div>
              <h2 className="s-title">Huit terrains.<br />Quarante-deux <em>métiers.</em></h2>
            </div>
            <p className="s-lede">Chaque secteur a sa logique, son vocabulaire, ses règles. Nos agents sont pré-modélisés pour les plus courants — et taillés sur mesure pour les autres en 48 heures.</p>
          </div>

          <div className="sc-filters">
            {[
              { f: "all", l: "Tous" },
              { f: "services", l: "Services aux pros" },
              { f: "retail", l: "Retail & hôtellerie" },
              { f: "sante", l: "Santé & bien-être" },
              { f: "finance", l: "Finance & assurance" },
            ].map((b) => (
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
                      <div className="sc-meta">MÉTIERS</div>
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
              <div className="tag" style={{ marginBottom: 16, color: "var(--terra)" }}>§ SUR-MESURE</div>
              <div className="sc-custom-t">Votre secteur n'est pas listé&nbsp;? <em>On&nbsp;le&nbsp;construit.</em></div>
              <div className="sc-custom-d">Nous modélisons vos processus exacts, votre vocabulaire métier, vos règles de gestion. Un agent qui parle votre langue, respecte vos contraintes, agit selon vos standards — livré en 48 heures.</div>
            </div>
            <button className="btn btn-primary" onClick={() => scrollTo("contact")}>
              Construire sur mesure <span className="arrow">→</span>
            </button>
          </div>
        </div>
      </section>

      {/* ═══════ PROOF ═══════ */}
      <section className="proof">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">§ 06 — MESURE</div>
              <h2 className="s-title">Des chiffres.<br />Pas des <em>promesses.</em></h2>
            </div>
            <p className="s-lede">Chaque agent est livré avec un tableau de bord opérationnel. Vous voyez chaque conversation, chaque seconde économisée, chaque opportunité qualifiée.</p>
          </div>
        </div>
        <div className="wrap">
          <div className="pf-grid">
            {PROOF.map((p) => (
              <div className="pf" key={p.kicker}>
                <div className="pf-kicker">{p.kicker}</div>
                <div className="pf-n">{p.n === "< 2" ? <>&lt; 2</> : p.n}<span className="unit">{p.unit}</span></div>
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
              <div className="s-num">§ 07 — MÉTHODE</div>
              <h2 className="s-title">Opérationnel en <em>48 heures</em> chrono.</h2>
            </div>
            <p className="s-lede">Un audit, un atelier, un déploiement, un suivi. Quatre étapes, pas de phase discovery interminable, pas de PowerPoint cimenté.</p>
          </div>

          <div className="ps-timeline">
            {PROCESS.map((p) => (
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

      {/* ═══════ PRICING ═══════ */}
      <section className="pricing" id="tarifs">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">§ 08 — TARIFS</div>
              <h2 className="s-title">Forfaits clairs. Sans <em>surprise.</em></h2>
            </div>
            <div>
              <p className="s-lede">Prix en roupies mauriciennes. Pas de licence cachée. Pas de facture d'appels à la minute. Paiement mensuel ou annuel, résiliable sans pénalité.</p>
              <div className="pr-switch" id="pr-switch">
                <button className={annual ? "" : "on"} onClick={() => setAnnual(false)}>Mensuel</button>
                <button className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annuel <span className="pr-save">−2 MOIS</span></button>
              </div>
            </div>
          </div>

          <div className="plans">
            {PLANS.map((p) => (
              <div className={`plan${p.feat ? " feat" : ""}`} key={p.name}>
                <div className="plan-name">{p.name}</div>
                <div className="plan-target">{p.target}</div>
                <div className="plan-price">
                  <span className="n">{p.priceText ? p.priceText : fmtRs(annual ? p.a! : p.m!)}</span>
                  {p.per && <span className="per">{p.per}</span>}
                </div>
                <div className="plan-ann">{p.annStatic ? p.annStatic : annual ? p.annA : "facturation mensuelle"}</div>
                <div className="plan-setup">{p.setup}</div>
                <div className="plan-div"></div>
                {p.feats.map((f) => (
                  <div className={`plan-feat${f.cls ? " " + f.cls : ""}`} key={f.t}>{f.t}</div>
                ))}
                <button className="plan-btn" onClick={() => scrollTo("contact")}>{p.btn}</button>
              </div>
            ))}
          </div>

          <div className="pr-custom">
            <div>
              <div className="pr-custom-k">§ GARANTIES AXON</div>
              <div className="pr-custom-t">Aucun risque. Résultat mesuré.</div>
              <div className="pr-custom-d">Si votre agent ne tient pas ses KPI au bout de 30 jours, nous le reprenons. Aucune pénalité. Votre setup vous est remboursé à 100%.</div>
              <div className="pr-custom-fs">
                <div className="pr-custom-f">Remboursement 30j</div>
                <div className="pr-custom-f">SLA contractuel</div>
                <div className="pr-custom-f">Portabilité des données</div>
                <div className="pr-custom-f">Aucun verrouillage technique</div>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={() => scrollTo("contact")}>Lire les garanties<span className="arrow">→</span></button>
          </div>
        </div>
      </section>

      {/* ═══════ FAQ ═══════ */}
      <section className="faq">
        <div className="wrap">
          <div className="s-header">
            <div>
              <div className="s-num">§ 09 — QUESTIONS</div>
              <h2 className="s-title">Ce qu'on nous <em>demande</em> souvent.</h2>
            </div>
            <p className="s-lede">Onze réponses directes pour lever les doutes les plus fréquents. Le reste, on en parle en 90 minutes.</p>
          </div>

          <div className="faq-grid">
            {FAQ.map((q, i) => (
              <div className="faq-item" key={i}>
                <div className="faq-q">{q.pre}{q.em && <em>{q.em}</em>}{q.post}</div>
                <div className="faq-a">{q.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════ CTA ═══════ */}
      <section className="cta-s" id="contact">
        <div className="wrap cta-inner">
          <div className="cta-meta">§ 10 — PRENDRE RENDEZ-VOUS</div>
          <h2 className="cta-h">Votre premier agent,<br />vivant dans <em>48 heures.</em></h2>
          <p className="cta-sub">Un appel de 90 minutes. On audite, on modélise, on chiffre. Si on ne sait pas faire votre cas en 48h, on vous le dit en fin d'appel — et on vous rembourse le setup si on s'est trompés.</p>
          <div className="cta-btns">
            <a href="mailto:contact@axon-ai.mu?subject=Réserver un appel Axon"><button className="btn btn-primary">Réserver l'appel <span className="arrow">→</span></button></a>
            <a href="tel:+23052591043"><button className="btn btn-ghost">+230 5259 1043</button></a>
          </div>
          <div className="cta-note">contact@axon-ai.mu · Flic-en-Flac, Maurice · Réponse sous 4h ouvrées</div>
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
              <p className="foot-tag">Des agents IA vocaux et textuels pour les entreprises de Maurice et d'Afrique. Opérationnels en 48 heures. Mesurés au résultat.</p>
              <p className="foot-parent">
                <span className="foot-parent-lbl">§ UNE MARQUE DE</span>
                <a href="https://www.digital-data-solutions.net/" target="_blank" rel="noopener" className="foot-parent-link">
                  Digital Data Solutions <span className="foot-parent-arrow">↗</span>
                </a>
              </p>
            </div>
            <div className="foot-col">
              <h4>Produit</h4>
              <a onClick={() => scrollTo("agents")}>Catalogue d'agents</a>
              <a onClick={() => scrollTo("voix")}>Voix IA</a>
              <a onClick={() => scrollTo("canaux")}>Intégrations</a>
              <a onClick={() => scrollTo("tarifs")}>Sécurité</a>
              <a onClick={() => scrollTo("process")}>Journal des versions</a>
            </div>
            <div className="foot-col">
              <h4>Secteurs</h4>
              <a onClick={() => scrollTo("secteurs")}>Services pros</a>
              <a onClick={() => scrollTo("secteurs")}>Retail & hôtellerie</a>
              <a onClick={() => scrollTo("secteurs")}>Santé</a>
              <a onClick={() => scrollTo("secteurs")}>Finance</a>
              <a onClick={() => scrollTo("secteurs")}>Immobilier</a>
            </div>
          </div>
          <div className="foot-bot">
            <div className="foot-meta">© 2026 AXON.AI — une marque de Digital Data Solutions · Flic-en-Flac, Maurice</div>
            <div className="foot-meta italic serif" style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 14, color: "var(--mute)" }}>Pendant que vous dormez, votre entreprise avance.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

"use client";

/**
 * HomeLanding — public 3D homepage.
 *
 * The platform pitch: 100% voice. Job-specialized AI voice agents handling
 * inbound and outbound calls, orchestrated by the proprietary AXON core,
 * powered by premium voice engines (ElevenLabs, MiniMax) and high-end text
 * LLMs (OpenAI, Anthropic, DeepSeek).
 *
 * Shares the app's theme contract (data-theme on <html> + axon.theme in
 * localStorage) so day/night follows the user into login and the client
 * space.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Brand } from "@/components/brand/Brand";
import { ThemeLangSwitcher, type Theme } from "@/components/ThemeLangSwitcher";
import { VoiceFace } from "./VoiceFace";
import {
  IconAssurance,
  IconClock,
  IconEcommerce,
  IconEye,
  IconGlobe,
  IconHotellerie,
  IconImmobilier,
  IconPhoneIn,
  IconPhoneOut,
  IconSante,
  IconSupport,
} from "./icons";

const VoiceScene = dynamic(() => import("./VoiceScene"), {
  ssr: false,
  loading: () => <div className="mk-scene-loading" aria-hidden />,
});

/** Track <html data-theme> so the 3D scene re-colors when the user toggles. */
function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return theme;
}

const METIERS = [
  {
    icon: <IconSante size={28} />,
    title: "Santé & cliniques",
    desc: "Prise de rendez-vous, rappels patients, pré-qualification des urgences, suivi post-consultation — au téléphone, 24h/24.",
  },
  {
    icon: <IconImmobilier size={28} />,
    title: "Immobilier",
    desc: "Qualification des acquéreurs, organisation des visites, relance des mandats, réponse instantanée à chaque annonce.",
  },
  {
    icon: <IconHotellerie size={28} />,
    title: "Hôtellerie & restauration",
    desc: "Réservations, modifications, demandes spéciales, conciergerie vocale multilingue — sans jamais laisser sonner.",
  },
  {
    icon: <IconEcommerce size={28} />,
    title: "E-commerce & retail",
    desc: "Suivi de commande, retours, réassurance avant achat, campagnes de réactivation des clients dormants.",
  },
  {
    icon: <IconAssurance size={28} />,
    title: "Assurance & finance",
    desc: "Déclaration de sinistre, qualification des leads, relances d'échéances — avec scripts conformes et traçabilité complète.",
  },
  {
    icon: <IconSupport size={28} />,
    title: "Support & service client",
    desc: "Niveau 1 résolu par la voix IA, escalade fluide vers vos agents humains sur la même file d'attente.",
  },
];

export default function HomeLanding({ spaceHref }: { spaceHref: string | null }) {
  const theme = useTheme();

  return (
    <div className="mk-page">
      {/* ── Header ── */}
      <header className="mk-header">
        <Link href="/" className="mk-header-brand">
          <Brand size={18} />
        </Link>
        <nav className="mk-nav">
          <a href="#concept">Le concept</a>
          <a href="#metiers">Métiers</a>
          <a href="#stack">Technologie</a>
        </nav>
        <div className="mk-header-actions">
          <ThemeLangSwitcher />
          {spaceHref ? (
            <Link href={spaceHref}>
              <button>Mon espace</button>
            </Link>
          ) : (
            <Link href="/login">
              <button>Se connecter</button>
            </Link>
          )}
        </div>
      </header>

      {/* ── Hero : full-screen 3D ── */}
      <section className="mk-hero">
        <div className="mk-hero-scene" aria-hidden>
          <VoiceScene theme={theme} />
        </div>
        <div className="mk-hero-copy">
          <div className="mk-overline">Plateforme d&apos;agents vocaux IA</div>
          <h1 className="mk-display">
            Votre téléphone a désormais
            <br />
            un système nerveux.
          </h1>
          <p className="mk-lede">
            Une plateforme exclusivement dédiée à la voix. Des agents vocaux spécialisés par
            métier décrochent vos appels entrants et mènent vos appels sortants — orchestrés par
            le noyau propriétaire AXON, portés par les voix les plus naturelles du marché et les
            meilleurs modèles de langage.
          </p>
          <div className="mk-cta-row">
            <a href="#concept">
              <button>Découvrir la plateforme</button>
            </a>
            {spaceHref ? (
              <Link href={spaceHref}>
                <button className="ghost">Accéder à mon espace</button>
              </Link>
            ) : (
              <Link href="/login">
                <button className="ghost">Espace client</button>
              </Link>
            )}
          </div>
          <div className="mk-chip-row">
            <span className="mk-chip"><IconPhoneIn size={14} /> Entrants + Sortants</span>
            <span className="mk-chip"><IconClock size={14} /> 24h/24 · 7j/7</span>
            <span className="mk-chip"><IconGlobe size={14} /> Multilingue</span>
            <span className="mk-chip"><IconEye size={14} /> Supervision live</span>
          </div>
        </div>
        <div className="mk-scroll-hint" aria-hidden>
          ↓
        </div>
      </section>

      {/* ── Concept : inbound / outbound ── */}
      <section id="concept" className="mk-section">
        <div className="mk-overline mk-center">Le concept</div>
        <h2 className="mk-display mk-h2 mk-center">
          Chaque appel est une décision
          <br />
          qui se prend.
        </h2>
        <p className="mk-lede mk-center">
          Votre voix entre d&apos;un côté. AXON l&apos;oriente vers l&apos;agent vocal du bon
          métier, qui écoute, raisonne et répond en temps réel. Humains et IA travaillent sur le
          même numéro, la même file d&apos;attente.
        </p>

        <div className="mk-duo">
          <div className="mk-card mk-card-in">
            <div className="mk-card-icon"><IconPhoneIn size={30} /></div>
            <h3>Appels entrants</h3>
            <p>Plus jamais un appel perdu. Vos agents vocaux décrochent à la première sonnerie.</p>
            <ul>
              <li>Accueil et orientation intelligente des appelants</li>
              <li>Prise de rendez-vous directement dans vos agendas</li>
              <li>Qualification et fiche contact remplie en direct</li>
              <li>Débordement et hors-horaires absorbés par l&apos;IA</li>
              <li>Escalade fluide vers un agent humain à tout moment</li>
            </ul>
          </div>
          <div className="mk-card mk-card-out">
            <div className="mk-card-icon"><IconPhoneOut size={30} /></div>
            <h3>Appels sortants</h3>
            <p>Des campagnes vocales menées avec le naturel d&apos;un humain et la rigueur d&apos;une machine.</p>
            <ul>
              <li>Campagnes de prospection et de qualification</li>
              <li>Rappels de rendez-vous et relances d&apos;impayés</li>
              <li>Enquêtes de satisfaction post-interaction</li>
              <li>Réactivation de bases clients dormantes</li>
              <li>Chaque conversation transcrite, analysée, mesurée</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Métiers ── */}
      <section id="metiers" className="mk-section">
        <div className="mk-overline mk-center">Les métiers</div>
        <h2 className="mk-display mk-h2 mk-center">Un agent vocal expert, pour chaque métier.</h2>
        <p className="mk-lede mk-center">
          Pas un robot générique : un spécialiste de votre secteur, avec votre vocabulaire, vos
          process et vos contraintes réglementaires.
        </p>
        <VoiceFace />
        <div className="mk-grid-3">
          {METIERS.map((m) => (
            <div key={m.title} className="mk-card mk-card-metier">
              <div className="mk-card-icon">{m.icon}</div>
              <h3>{m.title}</h3>
              <p>{m.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Stack ── */}
      <section id="stack" className="mk-section">
        <div className="mk-overline mk-center">La technologie</div>
        <h2 className="mk-display mk-h2 mk-center">Trois étages. Zéro compromis.</h2>
        <p className="mk-lede mk-center">
          Le très haut de gamme à chaque niveau : notre plateforme propriétaire au centre, les
          meilleures voix et les meilleurs cerveaux du marché autour.
        </p>

        <div className="mk-stack">
          <div className="mk-card mk-tier mk-tier-axon">
            <div className="mk-tier-tag">Noyau propriétaire</div>
            <h3>AXON</h3>
            <p>
              L&apos;orchestrateur. Routage des appels, files d&apos;attente partagées humains +
              IA, flows visuels, RAG sur vos données, supervision live (écoute, chuchotement,
              intervention), analytics et conformité.
            </p>
          </div>
          <div className="mk-card mk-tier mk-tier-voice">
            <div className="mk-tier-tag">Voix haut de gamme</div>
            <h3>ElevenLabs · MiniMax</h3>
            <p>
              Des voix indiscernables de l&apos;humain, multilingues, à latence minimale. Le ton,
              le rythme et l&apos;émotion adaptés à votre marque.
            </p>
          </div>
          <div className="mk-card mk-tier mk-tier-brain">
            <div className="mk-tier-tag">Cerveaux LLM</div>
            <h3>OpenAI · Anthropic · DeepSeek</h3>
            <p>
              Le raisonnement derrière chaque réponse. Compréhension du contexte, respect des
              scripts métier, mémoire de la conversation — le meilleur modèle pour chaque tâche.
            </p>
          </div>
        </div>
      </section>

      {/* ── CTA final ── */}
      <section className="mk-section mk-final">
        <h2 className="mk-display mk-h2 mk-center">
          Votre prochaine équipe ne dort jamais.
        </h2>
        <p className="mk-lede mk-center">
          Connectez-vous à votre espace pour créer vos agents vocaux, lancer vos campagnes et
          superviser chaque appel en direct.
        </p>
        <div className="mk-cta-row mk-center-row">
          {spaceHref ? (
            <Link href={spaceHref}>
              <button>Accéder à mon espace</button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <button>Se connecter</button>
              </Link>
              <Link href="/signup">
                <button className="ghost">Créer un compte</button>
              </Link>
            </>
          )}
        </div>
      </section>

      <footer className="mk-footer">
        <Brand size={15} />
        <span className="muted">Plateforme d&apos;agents vocaux IA · Entrants &amp; sortants</span>
      </footer>
    </div>
  );
}

/**
 * Contextual help registry.
 *
 * Each entry is keyed by a stable "contextKey" used by the <HelpButton/> in
 * page headers. The drawer picks the role-specific markdown if available,
 * otherwise falls back to `default`.
 *
 * Markdown is intentionally simple — see the mini renderer in
 * components/help/HelpDrawer.tsx. Supported syntax:
 *   ## Heading
 *   - bullet
 *   **bold**  *italic*  [link](https://...)
 */

export type HelpRole =
  | "super_admin"
  | "admin"
  | "manager"
  | "supervisor"
  | "agent";

export type HelpEntry = {
  title: string;
  default: string;
  super_admin?: string;
  admin?: string;
  manager?: string;
  supervisor?: string;
  agent?: string;
  /** Optional link appended at the bottom as "En savoir plus". */
  learnMoreHref?: string;
};

const DOC = "/docs/USER_GUIDE.md";

export const HELP: Record<string, HelpEntry> = {
  dashboard: {
    title: "Tableau de bord",
    learnMoreHref: DOC,
    default: `## Bienvenue sur le Dashboard
Vue d'ensemble en temps réel de l'activité de votre centre vocal.

- **KPIs clés** : appels en cours, taux de réponse, durée moyenne, satisfaction
- **Files d'attente** : visualisez les agents disponibles et le volume en attente
- **Campagnes actives** : suivez vos campagnes outbound en cours d'exécution
- **Alertes** : incidents et seuils dépassés à traiter en priorité

**Exemple** : si la durée moyenne d'appel dépasse 4 min, c'est souvent le signe que vos agents IA tombent dans des boucles — vérifiez le prompt système.`,
    agent: `## Bienvenue sur votre espace agent
Cet écran récapitule **votre journée** :

- **Mes appels** : appels traités, en cours, à rappeler
- **Mes performances** : durée moyenne, taux de qualification
- **Mes campagnes** : campagnes auxquelles vous êtes assigné
- **Messages de l'équipe** : annonces de votre superviseur

Cliquez sur n'importe quel appel pour ouvrir la fiche détaillée.`,
    supervisor: `## Tableau de bord superviseur
Pilotez votre équipe en temps réel.

- **Agents en ligne** : qui est connecté, en pause, en appel
- **File d'attente live** : interventions possibles (whisper / barge)
- **Alertes équipe** : appels longs, escalades, sentiment négatif
- **KPIs équipe** : SLA, taux de résolution, NPS

**Cas d'usage** : un agent dépasse 8 min sur un appel — cliquez sur sa ligne pour faire un *whisper* discret.`,
    manager: `## Tableau de bord manager
Vue stratégique de la performance de votre service.

- **Volumétrie** : entrants, sortants, conversion
- **Coûts** : minutes consommées, coût par lead, ROI campagnes
- **Qualité** : sentiment, scoring IA, conformité
- **Évolution** : tendances sur 7 / 30 / 90 jours

Exportez en CSV pour vos comités hebdo.`,
    admin: `## Tableau de bord administrateur
Santé technique et opérationnelle de l'organisation.

- **Infrastructure** : statut Twilio, n8n, Supabase, providers LLM/TTS
- **Quotas** : minutes restantes, crédits API, stockage RAG
- **Sécurité** : tentatives de login, accès récents, rôles modifiés
- **Facturation** : usage du cycle en cours`,
    super_admin: `## Tableau de bord super-admin
Pilotage multi-tenant de la plateforme.

- **Toutes les organisations** : usage, santé, incidents
- **Plateforme** : capacité, queues système, jobs en retard
- **Revenus** : MRR consolidé, churn, expansion
- **Incidents globaux** : pannes provider, dégradations`,
  },

  analytics: {
    title: "Analytics",
    learnMoreHref: DOC,
    default: `## Analytics avancés
Explorez en profondeur les données d'appels et campagnes.

- **Filtres multi-critères** : période, agent, campagne, file, statut
- **KPIs** : volume, durée, taux de qualification, sentiment moyen
- **Graphiques** : tendances horaires, heat-maps, funnels
- **Export** : CSV / PDF pour vos reportings

**Astuce** : croisez "agent IA" × "sentiment" pour identifier les prompts qui irritent vos prospects.`,
    agent: `## Mes analytics
Vos statistiques personnelles d'activité.

- Appels traités sur la période
- Durée moyenne, taux de qualification
- Comparaison avec la moyenne équipe`,
  },

  calls: {
    title: "Appels",
    learnMoreHref: DOC,
    default: `## Liste des appels
Tous les appels — en cours, terminés, manqués.

- **Filtres** : statut, direction (in/out), agent, numéro
- **Live** : voyez les appels en temps réel avec leur transcription partielle
- **Fiche détaillée** : transcription complète, audio, sentiment, événements
- **Actions** : rappeler, requalifier, déclencher une analyse LLM

Cliquez sur un appel pour voir la transcription et l'audio.`,
    supervisor: `## Supervision live des appels
Intervenez en temps réel sur les appels de votre équipe.

- **Listen** : écouter discrètement un appel en cours
- **Whisper** : parler à votre agent sans que l'interlocuteur entende
- **Barge** : prendre la main et entrer dans la conversation
- **Transcription live** : suivez les échanges au fil de l'eau

**Cas d'usage** : un client mécontent — *whisper* pour rappeler la procédure de remboursement.`,
    agent: `## Mes appels
Liste de tous vos appels traités.

- Reprenez un dossier
- Programmez un rappel
- Ajoutez des notes de qualification`,
  },

  queues: {
    title: "Files d'attente",
    learnMoreHref: DOC,
    default: `## Files d'attente
Gérez la distribution des appels entrants.

- **Création** : nom, priorité, débordement, musique d'attente
- **Routing** : skills, langue, agents assignés
- **SLA** : seuils d'alerte (temps d'attente, abandon)
- **Live** : nombre d'appels en queue, agents disponibles

**Exemple** : créez une queue "VIP" avec priorité haute et routing vers vos 3 meilleurs agents IA.`,
  },

  campaigns: {
    title: "Campagnes",
    learnMoreHref: DOC,
    default: `## Campagnes outbound
Pilotez vos campagnes d'appels sortants à grande échelle.

- **Création** : importez un CSV de contacts, choisissez agent IA + script
- **Planification** : fenêtres horaires, fuseaux, cadence (CPS)
- **Pilotage** : pause / reprise, ajustement en temps réel
- **Suivi** : conversions, qualifications, coût par contact

**Cas d'usage** : campagne de prise de RDV — agent IA "Lisa", 500 leads, fenêtre 9h-19h.`,
    agent: `## Campagnes
Liste des campagnes auxquelles vous participez.

- Voyez votre quota du jour
- Reprenez les rappels programmés`,
  },

  agents: {
    title: "Agents IA",
    learnMoreHref: DOC,
    default: `## Agents IA
Vos assistants conversationnels — voix, prompt, connaissances.

- **Liste** : tous les agents de l'organisation
- **Création** : nouvel agent à partir d'un template ou de zéro
- **Configuration** : LLM, voix TTS, langue, RAG, tools
- **Test** : lancez un appel test avant la mise en production

**Exemple** : créez "Lisa" — voix française chaleureuse, GPT-4, RAG sur votre catalogue produits.`,
  },

  "agents.detail": {
    title: "Fiche agent IA",
    learnMoreHref: DOC,
    default: `## Configuration d'un agent IA
Tous les leviers pour façonner le comportement de votre agent.

- **Prompt système** : personnalité, mission, ton, garde-fous
- **Voix (TTS)** : modèle, voix clonée, vitesse, expressivité
- **LLM** : provider, modèle, température, tokens max
- **RAG** : documents accessibles à l'agent pour ses réponses
- **Tools** : fonctions appelables (CRM, calendrier, recherche web…)
- **Greeting** : phrase d'accueil ou démarrage muet

**Astuce** : un bon prompt fait 80 % du résultat. Soyez précis sur la mission, les exemples et les cas d'échec.`,
  },

  voices: {
    title: "Voice Studio",
    learnMoreHref: DOC,
    default: `## Voice Studio
Créez et gérez vos voix synthétiques personnalisées.

- **Bibliothèque** : voix natives du provider + vos clones
- **Clonage** : uploadez 30s-3min d'audio, obtenez une voix synthétique
- **Preview** : générez un échantillon avant assignation
- **Multilingue** : une même voix sur plusieurs langues

**Cas d'usage** : clonez la voix de votre CEO pour les messages d'accueil et VIP.`,
  },

  flows: {
    title: "Flow Builder IVR",
    learnMoreHref: DOC,
    default: `## Flow Builder
Concevez visuellement vos serveurs vocaux interactifs (IVR).

- **Nœuds** : message, menu DTMF, transfert, condition, agent IA, webhook
- **Branches** : routez selon l'input, l'heure, des variables CRM
- **Variables** : capturez les choix utilisateur pour les passer à l'agent
- **Test** : simulateur intégré avant publication

**Exemple** : "Tapez 1 pour le SAV, 2 pour les ventes" → branche SAV vers agent IA "Hugo".`,
  },

  workflows: {
    title: "Workflows n8n",
    learnMoreHref: DOC,
    default: `## Workflows d'automatisation
Connectez la plateforme à vos outils via n8n.

- **Templates** : workflows prêts à l'emploi (CRM sync, Slack, email…)
- **Édition** : ouvrir dans l'éditeur n8n embarqué
- **Triggers** : appel terminé, lead qualifié, escalade, sentiment négatif
- **Actions** : créer un deal HubSpot, envoyer un SMS, mettre à jour Notion

**Cas d'usage** : "appel qualifié 'chaud'" → création d'un deal Salesforce + notif Slack.`,
  },

  documents: {
    title: "Documents (RAG)",
    learnMoreHref: DOC,
    default: `## Base documentaire RAG
Donnez de la connaissance métier à vos agents IA.

- **Upload** : PDF, DOCX, TXT, MD — extraction automatique
- **Chunking & embedding** : découpage intelligent + vectorisation
- **Tags** : organisez par catégorie, langue, agent destinataire
- **Recherche** : interrogez la base comme votre agent le fait

**Exemple** : uploadez votre catalogue produits + FAQ → vos agents répondent avec précision sans hallucination.`,
  },

  teams: {
    title: "Équipes multi-agents",
    learnMoreHref: DOC,
    default: `## Swarm d'agents IA
Orchestrez plusieurs agents qui collaborent sur un appel.

- **Agents membres** : ajoutez des spécialistes (accueil, technique, commercial)
- **Handoff** : règles de passage d'un agent à l'autre
- **Supervisor** : agent orchestrateur qui dispatch selon l'intent
- **Contexte partagé** : la conversation reste cohérente entre handoffs

**Exemple** : agent "Accueil" qualifie → handoff vers "Technique" si problème SAV, "Commercial" si vente.`,
  },

  scripts: {
    title: "Scripts de campagne",
    learnMoreHref: DOC,
    default: `## Scripts de campagne
Bibliothèque de scripts conversationnels réutilisables.

- **Variables** : {{firstname}}, {{company}}, etc. — interpolées au runtime
- **Sections** : ouverture, qualification, pitch, objections, closing
- **Versioning** : gardez l'historique des modifications
- **A/B test** : comparez deux versions sur un échantillon

**Astuce** : démarrez par un script court (3-5 lignes) — l'agent IA improvise mieux qu'un script verbeux.`,
  },

  contacts: {
    title: "Contacts (CRM)",
    learnMoreHref: DOC,
    default: `## Contacts
Votre base CRM intégrée.

- **Recherche** : par nom, téléphone, email, tag
- **Import** : CSV avec mapping automatique des champs
- **Historique** : tous les appels, notes, qualifications
- **Tags & segments** : pour cibler vos campagnes

**Cas d'usage** : segmentez "leads tièdes 30j" → campagne de relance avec agent "Lisa".`,
  },

  numbers: {
    title: "Numéros Twilio",
    learnMoreHref: DOC,
    default: `## Numéros
Gérez vos numéros de téléphone (entrants et sortants).

- **Achat** : achetez un numéro par pays / région directement
- **Routing** : associez chaque numéro à un flow IVR ou un agent
- **Caller ID** : configurez l'identité présentée en sortant
- **Vérification** : numéros vérifiés (STIR/SHAKEN, A2P 10DLC)`,
    admin: `## Numéros
Gestion administrative complète.

- Achat / portage de numéros
- Routing et flows associés
- Compliance STIR/SHAKEN et A2P 10DLC
- Coûts mensuels par numéro`,
  },

  "numbers.health": {
    title: "Santé des numéros",
    learnMoreHref: DOC,
    default: `## Santé des numéros
Surveillance de la réputation et qualité de vos numéros sortants.

- **Spam score** : note attribuée par les opérateurs / apps anti-spam
- **Taux de décroché** : indicateur clé de la santé d'un numéro
- **Rotation** : configurez des pools pour répartir la charge
- **Alertes** : numéros flagués "spam likely" à remplacer

**Action** : si un numéro tombe sous 30 % de décroché, mettez-le en repos.`,
  },

  desk: {
    title: "Softphone",
    learnMoreHref: DOC,
    default: `## Softphone
Votre téléphone web intégré pour passer et recevoir des appels.

- **Composer** : pavé numérique + carnet d'adresses
- **Réception** : sonnerie navigateur, ID appelant
- **En appel** : mute, hold, transfert, conférence
- **Notes** : prenez des notes pendant l'appel — sauvegardées dans la fiche`,
    agent: `## Votre softphone
Outil principal pour traiter les appels.

- Recevez les appels assignés
- Transférez vers un collègue ou un agent IA
- Prenez des notes en direct
- Qualifiez l'appel à la fin`,
  },

  admin: {
    title: "Administration",
    learnMoreHref: DOC,
    default: `## Administration
Paramètres et opérations sur votre organisation.

- **Membres & rôles** : invitez, changez les permissions
- **Organisations** : multi-tenant (super_admin)
- **Connecteurs** : entrants (Twilio, SIP), sortants (CRM, n8n)
- **Facturation** : abonnement, factures, moyens de paiement
- **Audit** : journal des actions sensibles`,
    super_admin: `## Administration plateforme
Vous voyez et gérez **toutes les organisations**.

- Création / suspension d'organisations
- Quotas et limites par tenant
- Audit global
- Templates de plateforme`,
  },

  "admin.orgs": {
    title: "Organisations",
    learnMoreHref: DOC,
    default: `## Gestion des organisations
Espace réservé aux super-admins.

- **Liste** : toutes les organisations de la plateforme
- **Création** : nouveau tenant avec son owner
- **Quotas** : minutes, agents, numéros, stockage
- **Suspension** : geler une org sans la supprimer
- **Switch** : se connecter en tant que support sur une org`,
  },

  "admin.copilot": {
    title: "Copilote IA",
    learnMoreHref: DOC,
    default: `## Copilote IA
Assistant IA pour configurer la plateforme en langage naturel.

- "Crée un agent SAV en français avec voix douce"
- "Lance une campagne sur ces 200 contacts demain à 10h"
- "Pourquoi le numéro +33 1... a un mauvais taux de décroché ?"
- "Génère un script de prospection pour le secteur immobilier"

Le copilote peut **planifier et exécuter** les actions s'il a les permissions.`,
  },

  "admin.inbound": {
    title: "Connecteurs entrants",
    learnMoreHref: DOC,
    default: `## Connecteurs entrants
Sources d'appels et de leads que la plateforme ingère.

- **Twilio** : numéros et flows associés
- **SIP trunks** : interconnexions opérateur
- **Webhooks** : leads poussés par votre site / Meta Ads / Google Ads
- **Email-to-call** : déclenchez un rappel depuis un email entrant`,
  },

  "admin.billing": {
    title: "Facturation",
    learnMoreHref: DOC,
    default: `## Facturation
Suivi de votre consommation et de vos factures.

- **Cycle en cours** : minutes, agents actifs, stockage RAG
- **Factures** : téléchargement PDF, statuts de paiement
- **Moyens de paiement** : carte, prélèvement
- **Plan** : montez en gamme ou souscrivez des add-ons

**Astuce** : activez les alertes de seuil pour éviter les surprises.`,
  },

  alerts: {
    title: "Alertes",
    learnMoreHref: DOC,
    default: `## Alertes
Incidents et seuils dépassés à traiter.

- **Filtres** : sévérité, statut (ouvert / traité), source
- **Catégories** : technique, qualité, conformité, business
- **Acquittement** : prenez en charge, ajoutez un commentaire, fermez
- **Règles** : configurez vos propres seuils (durée, sentiment, abandon…)

**Exemple** : "5 abandons en file VIP sur 10 min" → alerte → vous renforcez l'équipe.`,
  },

  analyses: {
    title: "Analyses LLM",
    learnMoreHref: DOC,
    default: `## Analyses LLM
Analyses post-appel automatiques par IA.

- **Résumé** : 3 lignes synthétiques de l'appel
- **Sentiment** : positif / neutre / négatif, évolution dans l'appel
- **Topics** : sujets abordés, objections, demandes
- **Scoring** : qualité de l'appel, conformité, opportunité commerciale
- **Actions extraites** : rappels, tâches, RDV à créer

**Cas d'usage** : revue qualité hebdo — filtrez "sentiment négatif" + "conformité < 70 %".`,
  },

  settings: {
    title: "Paramètres",
    learnMoreHref: DOC,
    default: `## Paramètres
Votre profil et préférences personnelles.

- **Profil** : nom, photo, langue de l'interface
- **Notifications** : email, in-app, push
- **Sécurité** : mot de passe, 2FA, sessions actives
- **Préférences** : thème, raccourcis clavier`,
    admin: `## Paramètres organisation
Personnalisez votre tenant.

- Identité visuelle (logo, couleurs)
- Domaine personnalisé
- Politiques (mots de passe, 2FA obligatoire, IP allowlist)
- Intégrations globales`,
  },

  signup: {
    title: "Inscription",
    default: `## Créer un compte
Bienvenue ! Quelques infos suffisent pour démarrer.

- **Email & mot de passe** : ou connectez-vous via Google / Microsoft
- **Organisation** : créez la vôtre ou rejoignez-en une par invitation
- **Vérification** : un email de confirmation vous sera envoyé
- **Onboarding** : assistant pas-à-pas pour configurer votre 1er agent`,
  },

  login: {
    title: "Connexion",
    default: `## Se connecter
Accédez à votre espace.

- Email + mot de passe, ou SSO si activé par votre organisation
- Mot de passe oublié ? Utilisez le lien de réinitialisation
- Multi-orgs : vous pourrez switcher d'organisation après connexion`,
  },
};

/** Resolve markdown content for a (contextKey, role) pair. */
export function resolveHelp(
  contextKey: string,
  role: HelpRole | null | undefined
): { title: string; body: string; learnMoreHref?: string } | null {
  const entry = HELP[contextKey];
  if (!entry) return null;
  const body =
    (role && entry[role]) ||
    entry.default;
  return {
    title: entry.title,
    body,
    learnMoreHref: entry.learnMoreHref,
  };
}

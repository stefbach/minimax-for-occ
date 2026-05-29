/**
 * Contextual help registry.
 *
 * Each entry is keyed by a stable "contextKey" used by the <HelpButton/> in
 * page headers. The drawer picks the role-specific markdown if available,
 * otherwise falls back to `default`.
 *
 * Markdown is rendered by `lib/help/markdown.tsx`. Supported syntax:
 *   ## Heading 2 / ### Heading 3
 *   - bullet
 *   1. numbered list
 *   > blockquote
 *   `inline code` / ``` fenced code ```
 *   **bold**  *italic*  [link text](href)
 *
 * Authoring guidelines for each contextKey (default + role variants):
 *   - Start with a one-sentence intro that explains the page in plain French.
 *   - Then sections: "À quoi sert cette page", "Comment l'utiliser",
 *     "Bonnes pratiques", "Cas d'usage typique", "Pièges à éviter",
 *     "Liens utiles".
 *   - Role variants reuse the same skeleton but adjust scope (read-only vs
 *     editable, etc.) and call out role-specific actions.
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

/**
 * Resolve the "Learn more" URL for a context key. We now point to the in-app
 * `/help` page (rendered from `docs/USER_GUIDE.md`) with an anchor matching
 * the context key. This avoids the 404 we had when linking to
 * `/docs/USER_GUIDE.md` (Next does not serve files from the repo root).
 */
export function docHref(contextKey: string): string {
  return `/help#${contextKey}`;
}

export const HELP: Record<string, HelpEntry> = {
  // ──────────────────────────────────────────────────────────────────────
  // DASHBOARD
  // ──────────────────────────────────────────────────────────────────────
  dashboard: {
    title: "Tableau de bord",
    learnMoreHref: docHref("dashboard"),
    default: `## Tableau de bord
Vue d'ensemble en temps réel de l'activité de votre centre de contact vocal.

## À quoi sert cette page
- Détecter en un coup d'œil les **incidents en cours** (file qui sature, agent IA bloqué, alerte qualité).
- Suivre les **KPIs vitaux** : appels en cours, taux de réponse, durée moyenne, satisfaction.
- Visualiser les **campagnes outbound** actives et leur progression.
- Accéder rapidement aux **alertes** qui demandent une action.

## Comment l'utiliser
1. Survolez les **cartes KPI** en haut : chaque valeur a une tendance (▲ / ▼) comparée à la veille.
2. Cliquez sur **"Files d'attente"** pour ouvrir la vue détaillée des queues.
3. Cliquez sur une **alerte rouge** pour ouvrir la fiche incident et l'acquitter.
4. Utilisez le **sélecteur de période** (haut droite) pour comparer Aujourd'hui / 7j / 30j.

## Bonnes pratiques
- Gardez cette page ouverte sur un **second écran** pendant les heures d'ouverture.
- Si la **durée moyenne** monte au-dessus de 4 min sans raison, vérifiez d'abord les prompts agents IA — c'est souvent une boucle conversationnelle.
- Surveillez le **taux d'abandon** : au-delà de 5 %, ajoutez du staffing ou activez le rappel automatique.

## Cas d'usage typique
Vous arrivez le matin → vous ouvrez le dashboard → la carte "Alertes" affiche **3 alertes ouvertes** → vous cliquez, traitez les 3 (faux positif, repos d'un numéro, ouverture de file), puis le dashboard repasse au vert pour la journée.

## Pièges à éviter
- Ne confondez pas "appels en cours" (live) et "appels du jour" (cumul).
- Les KPIs sont **calculés à partir du fuseau de l'organisation** — vérifiez-le dans Paramètres si les chiffres semblent décalés.
- Les chiffres "satisfaction" ne remontent que si le SMS post-call est activé dans la campagne.

## Liens utiles
- [Alertes](/alerts) pour traiter les incidents
- [Analytics](/analytics) pour creuser un KPI
- [Appels live](/calls) pour voir les conversations en direct`,

    agent: `## Mon tableau de bord
Votre vue personnelle : ce que vous avez fait aujourd'hui et ce qui vous attend.

## À quoi sert cette page
- Voir d'un coup d'œil **vos appels** : traités, en cours, à rappeler.
- Suivre **vos performances** (durée moyenne, taux de qualification) et vous comparer à la moyenne équipe.
- Consulter les **campagnes** auxquelles vous êtes assigné et votre quota du jour.
- Lire les **messages** ou consignes laissées par votre superviseur.

## Comment l'utiliser
1. Vérifiez votre **statut** en haut (🟢 Disponible / 🟡 Pause). Vous ne recevrez d'appels que si vous êtes Disponible.
2. Cliquez sur un appel dans **"À rappeler"** pour ouvrir la fiche et programmer le rappel.
3. Cliquez sur **"Mon poste"** pour aller au softphone et prendre/passer un appel.

## Bonnes pratiques
- Avant de prendre votre pause, passez votre statut sur **🟡 Pause** pour ne pas faire sonner vos collègues.
- Les **rappels programmés** apparaissent en haut quand l'heure approche — soyez disponible 5 min avant.

## Cas d'usage typique
9h00 → vous vous connectez → le dashboard affiche **2 rappels programmés pour la matinée** + **1 message superviseur** ("relancer prioritairement les leads tag VIP") → vous traitez les rappels en priorité.

## Pièges à éviter
- Si vous restez en **Disponible** pendant une pause, vous bloquez la file et générez des abandons.
- Ne fermez pas le navigateur sans repasser en **Indisponible** — le routing pourrait continuer à vous adresser des appels.

## Liens utiles
- [Mon poste (softphone)](/desk)
- [Mes contacts](/contacts)`,

    supervisor: `## Tableau de bord superviseur
Pilotez votre équipe en temps réel et intervenez là où ça coince.

## À quoi sert cette page
- Voir qui est **en ligne**, en pause, en appel parmi vos agents.
- Suivre la **file d'attente live** et anticiper les saturations.
- Recevoir les **alertes équipe** (appel trop long, sentiment négatif, escalade).
- Mesurer en continu le **SLA et la qualité** de votre équipe.

## Comment l'utiliser
1. Repérez les **agents en alerte** (entourés en orange / rouge) dans la grille du haut.
2. Cliquez sur un appel rouge dans la liste "Appels actifs" pour ouvrir le panneau de supervision (listen / whisper / barge).
3. Utilisez **"Coaching live"** pour souffler discrètement à un junior.
4. Filtrez par **file d'attente** si vous gérez plusieurs équipes.

## Bonnes pratiques
- Faites un **whisper** plutôt qu'un barge quand l'agent gère — la prise de main directe casse la confiance du client.
- Notez les coachings dans **"Analyses LLM"** après chaque appel pour suivre la progression d'un agent.
- Configurez des **alertes seuil** (Alertes → Règles) pour être notifié dès qu'un appel dépasse N minutes.

## Cas d'usage typique
Un agent dépasse 8 min sur un appel → carte rouge sur le dashboard → vous ouvrez l'appel → écoute discrète 30 sec → vous identifiez un blocage tarif → whisper "propose un -10 % geste commercial" → l'agent conclut, le client est satisfait.

## Pièges à éviter
- Le **barge** s'entend immédiatement par les deux parties — n'en faites pas sans prévenir l'équipe.
- Trop de whispers fait perdre le fil à l'agent ; intervenez seulement aux moments-clés.

## Liens utiles
- [Appels live](/calls)
- [Analyses LLM](/analyses)
- [Alertes](/alerts)`,

    manager: `## Tableau de bord manager
Vue stratégique de la performance de votre service.

## À quoi sert cette page
- Suivre la **volumétrie** (entrants / sortants / conversion) sur 7, 30 ou 90 jours.
- Surveiller les **coûts** : minutes consommées, coût par lead, ROI campagnes.
- Mesurer la **qualité** : sentiment moyen, scoring conformité IA, NPS.
- Identifier les **tendances** à présenter en comité.

## Comment l'utiliser
1. Choisissez la **période** (sélecteur en haut à droite) — 30j est un bon défaut hebdomadaire.
2. Cliquez sur un **KPI** pour ouvrir le détail dans Analytics.
3. Cliquez sur **"Export"** pour récupérer un CSV pour votre comité.
4. Le widget **"Top campagnes"** pointe directement vers les campagnes les plus performantes.

## Bonnes pratiques
- Comparez systématiquement à la **période précédente** (toggle "vs N-1") pour repérer les dérives.
- Si vous lancez beaucoup de campagnes, fixez-vous un **coût par lead cible** et ajustez la vitesse / le script si vous dérapez.
- Faites un point hebdo en **comparant qualité (sentiment) et volume** : un agent qui fait + de volume mais - de qualité ne crée pas forcément de la valeur.

## Cas d'usage typique
Lundi matin, comité hebdo → vous exportez le CSV "30 derniers jours" → vous repérez que la campagne "Relance B2B" a un coût par lead 2× supérieur à la cible → vous demandez à l'admin de revoir le script.

## Pièges à éviter
- Ne tirez pas de conclusions sur **moins de 50 appels** par segment : variance trop grande.
- Le coût Twilio fluctue selon le pays — comparez à pays constant.

## Liens utiles
- [Analytics](/analytics)
- [Campagnes](/campaigns)
- [Copilote IA Manager](/admin/copilot)`,

    admin: `## Tableau de bord admin
Santé technique et opérationnelle de votre organisation.

## À quoi sert cette page
- Vérifier le statut de l'**infrastructure** : Twilio, n8n, Supabase, providers LLM/TTS.
- Suivre les **quotas** : minutes restantes, crédits API, stockage RAG.
- Surveiller la **sécurité** : tentatives de login échouées, accès récents, rôles modifiés.
- Anticiper la **facturation** du cycle en cours.

## Comment l'utiliser
1. Si un voyant de **statut infra** est rouge, cliquez pour ouvrir le détail (provider, code erreur).
2. Si le **quota minutes** descend sous 20 % avant la fin du cycle, ouvrez Facturation → augmenter le plan.
3. Cliquez sur **"Audit log"** pour revoir les actions sensibles des 7 derniers jours.

## Bonnes pratiques
- Mettez en place des **alertes seuil** (Alertes → Règles) pour les quotas (ex: alerte à 80 % de conso).
- Vérifiez la **santé des numéros** (Numéros → Santé) au moins 1× par semaine.
- Gardez un œil sur les **invitations en attente** : un membre qui n'active pas son compte sous 7j voit son lien expirer.

## Cas d'usage typique
Vendredi soir, vous remarquez que **n8n est rouge** → vous cliquez → erreur 502 sur l'instance → vous redémarrez depuis Admin → Connecteurs et le voyant repasse au vert.

## Pièges à éviter
- Les **quotas** sont remis à zéro à la date anniversaire de l'abonnement, pas le 1er du mois.
- Ne supprimez jamais un membre actif sans **réassigner ses contacts** d'abord.

## Liens utiles
- [Administration](/admin)
- [Facturation](/admin/billing)
- [Santé des numéros](/numbers/health)
- [Paramètres](/settings)`,

    super_admin: `## Tableau de bord super-admin
Pilotage multi-tenant de la plateforme Axon.

## À quoi sert cette page
- Avoir une vue **consolidée** sur toutes les organisations.
- Suivre la **capacité plateforme** : queues système, jobs en retard, providers.
- Mesurer le **revenu** (MRR, churn, expansion) en agrégé.
- Recevoir les **incidents globaux** (panne provider, dégradation).

## Comment l'utiliser
1. Utilisez le **switcher d'org** en haut à droite de la sidebar pour basculer sur l'org concernée.
2. Cliquez sur **"Organisations"** pour le management détaillé (création, suspension, quotas).
3. Cliquez sur **"Copilote"** pour interroger la plateforme en langage naturel.

## Bonnes pratiques
- Faites une **revue hebdomadaire** des organisations en bas du leaderboard (faible usage = risque de churn).
- Mettez en place des **playbooks d'incident** : si un provider tombe, qu'est-ce qu'on bascule, vers quoi, en combien de temps ?

## Cas d'usage typique
Twilio annonce une maintenance dans 4h → vous filtrez les **orgs > 100 minutes/jour** → vous leur envoyez un message d'info → vous switchez en mode dégradé (rotation pools).

## Pièges à éviter
- Ne suspendez pas une org sans avoir prévenu son owner : la suspension est instantanée.
- Le **rôle super_admin** donne accès à toutes les données — utilisez-le avec précaution (chaque action est tracée).

## Liens utiles
- [Organisations](/admin) avec switcher
- [Copilote Super Admin](/admin/copilot)
- [Connecteurs](/admin/inbound)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────────────────────────────────────
  analytics: {
    title: "Analytics",
    learnMoreHref: docHref("analytics"),
    default: `## Analytics
Explorez en profondeur les données d'appels et de campagnes pour piloter votre activité.

## À quoi sert cette page
- Mesurer la **volumétrie** par direction (entrants / sortants), par agent, par file.
- Suivre la **qualité** : durée, taux de qualification, sentiment, conformité.
- Comparer des **périodes** ou des **segments** pour identifier ce qui marche.
- **Exporter** vos données vers Excel / votre BI pour des analyses avancées.

## Comment l'utiliser
1. Choisissez la **période** (haut droite) — Aujourd'hui, 7j, 30j, ou plage personnalisée.
2. Affinez avec les **filtres** : direction, agent, campagne, file, statut, langue.
3. Survolez les graphiques pour voir les **détails** par point.
4. Cliquez sur un **segment** (ex: "campagne X") pour ouvrir sa fiche détaillée.
5. Bouton **"Exporter"** → CSV ou PDF.

## Bonnes pratiques
- Pour comparer "agent IA" vs "agent humain", filtrez en deux passes et exportez chacune.
- Croisez **sentiment × agent IA** pour repérer les prompts qui irritent — souvent 1-2 phrases mal tournées.
- Sauvegardez vos **filtres favoris** en bookmark navigateur (l'URL contient l'état complet).

## Cas d'usage typique
Le DG vous demande "combien coûte un lead qualifié sur la campagne Été ?" → vous filtrez campagne = Été, statut = qualifié → division coût total / nb leads → vous avez la réponse en 30 secondes.

## Pièges à éviter
- Les **minutes facturées** incluent la sonnerie ; la **durée parlée** non. Choisissez le bon KPI selon ce que vous mesurez.
- Le **sentiment** dépend du modèle LLM utilisé ; un changement de modèle peut shifter les chiffres de quelques %.

## Liens utiles
- [Appels](/calls) pour voir le détail appel par appel
- [Analyses LLM](/analyses) pour les analyses post-appel automatiques
- [Campagnes](/campaigns)`,

    agent: `## Mes analytics
Vos statistiques personnelles d'activité.

## À quoi sert cette page
- Voir le nombre d'**appels que vous avez traités** sur la période.
- Mesurer votre **durée moyenne** et votre **taux de qualification**.
- Vous **comparer à la moyenne équipe** (sans nominatif sur les autres).
- Repérer vos points forts (taux de transfert IA → humain géré, satisfaction).

## Comment l'utiliser
1. Choisissez la **période**.
2. Consultez les **KPIs personnels** en haut.
3. Le graphique du bas montre votre **évolution sur 30j**.

## Bonnes pratiques
- Si votre **durée moyenne** dérive vers le haut, c'est souvent un signe de fatigue ou de cas complexes — parlez-en à votre superviseur.
- Un **taux de qualification** sous la moyenne équipe ne veut pas dire que vous travaillez mal : ça peut être un mix d'appels plus difficiles.

## Pièges à éviter
- Ne comparez pas votre semaine à un collègue : vous n'avez pas forcément traité les mêmes types d'appel.

## Liens utiles
- [Mon poste](/desk)
- [Mes contacts](/contacts)`,

    manager: `## Analytics manager
Vue détaillée pour piloter votre service.

## À quoi sert cette page
- Mesurer la performance de **chaque agent** (humain et IA) sur la période.
- Comparer **campagnes** entre elles (conversion, coût, durée).
- Identifier les **files d'attente** qui saturent.
- Construire vos **reportings hebdo / mensuels**.

## Comment l'utiliser
1. Période + filtres (agent, campagne, file).
2. Onglet **"Agents"** : leaderboard avec note qualité, volume, satisfaction.
3. Onglet **"Files"** : SLA, abandon, temps d'attente moyen.
4. Onglet **"Campagnes"** : ROI, coût par lead.
5. **Exportez** en CSV pour Excel ou PDF pour un rapport.

## Bonnes pratiques
- Faites un **comité hebdo** sur les mêmes 2-3 KPIs (volumétrie + qualité + coût) pour rester comparable.
- Quand un KPI dégrade, descendez **par segment** avant de conclure : c'est rarement uniforme.

## Liens utiles
- [Analyses LLM](/analyses)
- [Campagnes](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // APPELS
  // ──────────────────────────────────────────────────────────────────────
  calls: {
    title: "Appels",
    learnMoreHref: docHref("calls"),
    default: `## Appels
Liste complète des appels — en cours, terminés, manqués, programmés.

## À quoi sert cette page
- Retrouver un **appel précis** par numéro, date, agent ou tag.
- Voir les appels **en direct** (live) avec leur transcription partielle.
- Ouvrir une **fiche détaillée** : transcription complète, audio, sentiment, événements.
- Déclencher manuellement une **analyse LLM** ou un **rappel**.

## Comment l'utiliser
1. Utilisez la barre de **recherche** (numéro, nom, mot-clé dans la transcription).
2. Affinez avec les **filtres** : direction (in/out), statut, agent, période.
3. Cliquez sur une **ligne d'appel** pour ouvrir la fiche détaillée.
4. Sur la fiche : **lecteur audio**, transcription cliquable (chaque ligne saute à l'audio), boutons "Rappeler", "Requalifier", "Analyser".

## Bonnes pratiques
- Marquez les appels intéressants avec un **tag** (ex: "objection", "à coacher") pour les retrouver via filtre.
- Quand un appel a dérapé, lancez une **analyse LLM** : elle extrait le moment précis du dérapage et le sentiment associé.

## Cas d'usage typique
Un client appelle pour réclamer un remboursement → vous tapez son numéro → vous trouvez l'appel d'origine d'il y a 2 jours → vous écoutez le passage litigieux → vous décidez en 2 minutes.

## Pièges à éviter
- La **transcription** peut comporter des erreurs sur les noms propres ou les chiffres — écoutez l'audio en cas de doute.
- Les appels **abandonnés en file** apparaissent avec une durée parlée = 0.

## Liens utiles
- [Analyses LLM](/analyses) pour les analyses détaillées
- [Contacts](/contacts) pour retrouver l'historique d'un appelant`,

    supervisor: `## Supervision live des appels
Intervenez en temps réel sur les appels en cours dans votre équipe.

## À quoi sert cette page
- Voir les **appels en cours** (live) avec transcription au fil de l'eau.
- **Listen** : écouter discrètement un appel pour évaluer la qualité.
- **Whisper** : parler à votre agent sans que l'interlocuteur entende — pour le coacher en live.
- **Barge** : reprendre la main et entrer dans la conversation à 3.

## Comment l'utiliser
1. Cliquez sur un **appel actif** (badge "Live").
2. Choisissez le mode :
   - 🎧 **Listen** = vous écoutez, personne ne sait que vous êtes là.
   - 🗣️ **Whisper** = vous parlez à l'agent uniquement.
   - ⚡ **Barge** = vous parlez à tout le monde.
3. Vous pouvez **passer d'un mode à l'autre** sans interrompre.

## Bonnes pratiques
- **Listen d'abord, intervenir ensuite**. Quelques secondes d'écoute évitent les intrusions inutiles.
- Le **whisper** est silencieux pour le client mais l'agent vous entend immédiatement — laissez-lui finir sa phrase avant de souffler.
- Notez **après l'appel** dans Analyses LLM le moment exact que vous voulez débriefer.

## Cas d'usage typique
Junior + client mécontent → listen 20 sec → vous comprenez le blocage → whisper "propose un échange standard sous 48h" → l'agent reformule, le client accepte → vous tagguez "résolu en whisper" pour le debrief.

## Pièges à éviter
- **Barge** s'entend par tout le monde — n'en faites pas sans nécessité.
- Évitez les whispers longs (>5 sec) : l'agent décroche du client.

## Liens utiles
- [Analyses LLM](/analyses)
- [Dashboard superviseur](/dashboard)`,

    agent: `## Mes appels
Liste de tous vos appels traités, en cours ou à rappeler.

## À quoi sert cette page
- Reprendre un **dossier client** : tout l'historique avec ses notes et tags.
- Programmer ou voir vos **rappels** du jour.
- Réécouter un **appel** que vous voulez clarifier.
- Ajouter / modifier vos **notes de qualification**.

## Comment l'utiliser
1. Filtrez par **date** ou **statut** ("à rappeler", "manqué", etc.).
2. Cliquez sur un appel pour ouvrir la fiche.
3. Sur la fiche : audio, transcription, notes, tags. Vous pouvez **modifier vos notes** post-appel.
4. Bouton **"Rappeler"** pour relancer un contact.

## Bonnes pratiques
- Mettez un **tag clair** sur chaque appel (ex: "RDV pris", "à recontacter", "réclamation") — ça vous facilite le tri.
- Notez en **2-3 lignes** maximum : pas un roman, l'IA fait déjà un résumé.

## Pièges à éviter
- Les **rappels programmés** se déclenchent uniquement si vous êtes en 🟢 Disponible à l'heure dite.

## Liens utiles
- [Mon poste](/desk)
- [Mes contacts](/contacts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // QUEUES
  // ──────────────────────────────────────────────────────────────────────
  queues: {
    title: "Files d'attente",
    learnMoreHref: docHref("queues"),
    default: `## Files d'attente
Gérez la distribution des appels entrants vers vos agents (humains et IA).

## À quoi sert cette page
- Définir **comment les appels sont routés** : par compétence, par langue, par priorité.
- Mesurer la **performance des files** : SLA, abandon, temps d'attente.
- Configurer le **débordement** (overflow) si une file sature.
- Choisir la **musique d'attente** et les annonces.

## Comment l'utiliser
1. Cliquez **"+ Nouvelle file"** pour créer une queue.
2. Renseignez :
   - **Nom** (ex: "Support Niveau 1")
   - **Stratégie** : \`longest_idle\` (recommandé), \`round_robin\`, ou \`broadcast\`.
   - **Attente max** (en secondes, défaut 600).
   - **Fallback** : voicemail, autre queue, ou agent IA.
3. Onglet **"Membres"** : ajoutez agents humains et agents IA (avec priorité).
4. Onglet **"Routing"** : associez la file à un ou plusieurs numéros / flows IVR.

## Bonnes pratiques
- Mettez un **agent IA en fallback** : il décroche si tous les humains sont occupés, évite l'abandon.
- Pour les VIP, créez une file dédiée à **priorité haute** et avec vos meilleurs agents.
- Configurez une **alerte d'abandon** (Alertes → Règles) au-delà de 5 % pour réagir vite.

## Cas d'usage typique
Vous lancez le SAV : créez une file "SAV", ajoutez vos 4 conseillers + agent IA "Hugo" en fallback, routez le numéro 04 XX XX XX XX vers cette file. Les heures creuses, c'est Hugo qui répond ; les heures pleines, ce sont les humains.

## Pièges à éviter
- \`broadcast\` fait sonner **tous les agents en même temps** — utile pour les petites équipes, mais source de double-décrochés au-delà de 5 agents.
- N'oubliez pas de **désactiver** une file que vous n'utilisez plus, sinon elle peut continuer à recevoir des appels en cas de mauvais routing.

## Liens utiles
- [Numéros](/numbers) pour configurer le routing entrant
- [Flows / IVR](/flows) pour des parcours plus complexes`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CAMPAGNES
  // ──────────────────────────────────────────────────────────────────────
  campaigns: {
    title: "Campagnes",
    learnMoreHref: docHref("campaigns"),
    default: `## Campagnes outbound
Pilotez vos campagnes d'appels sortants à grande échelle.

## À quoi sert cette page
- Lancer des **campagnes** de prospection, relance, satisfaction, recouvrement.
- Suivre la **progression** en live : appels passés / restants, conversions, abandons.
- **Mettre en pause** ou ajuster la vitesse en temps réel.
- Mesurer le **coût par contact** et le **ROI**.

## Comment l'utiliser
1. Cliquez **"+ Nouvelle campagne"**.
2. Renseignez :
   - **Nom** (ex: "Relance juin")
   - **Agent IA assigné**
   - **Numéro émetteur** (Twilio)
   - **Cible** : upload CSV (colonne obligatoire \`phone\`)
   - **Fenêtre horaire** : ex 9h-19h, lundi-vendredi
   - **Vitesse (CPS)** : nombre d'appels simultanés
   - **Script** : prompt spécifique campagne (override agent)
3. Bouton **▶ Démarrer**. Le worker dial les contacts selon la fenêtre.
4. Suivez les **stats live** sur la fiche campagne.

## Bonnes pratiques
- Démarrez à **CPS = 2-3** pour vérifier que tout va bien, puis montez.
- Préparez **2 scripts** (A/B) et lancez-les en parallèle sur 100 leads chacun, gardez le meilleur.
- Activez le **SMS post-call** pour mesurer la satisfaction.
- Configurez un **transfer humain** en cas d'intérêt fort (geste commercial à valider).

## Cas d'usage typique
500 leads d'un salon → vous créez "Relance Salon Oct" → agent IA "Lisa", script "qualifier intérêt formation" → fenêtre 9h-12h / 14h-17h sur 3 jours → vous suivez la conversion en live → 78 RDV pris, ROI x6.

## Pièges à éviter
- **Ne lancez jamais sans tester le script** : 1 appel test minimum avant ▶.
- Vérifiez la **fenêtre horaire et le fuseau** : un dimanche à 8h peut casser votre réputation.
- Respectez les **règles légales** (RGPD, opt-out, DNC list).

## Liens utiles
- [Agents IA](/agents) pour configurer l'agent
- [Scripts](/scripts) pour vos templates
- [Contacts](/contacts) pour préparer vos cibles
- [Numéros (santé)](/numbers/health) pour vérifier vos numéros sortants`,

    agent: `## Mes campagnes
Liste des campagnes auxquelles vous participez (en tant qu'agent humain pour le transfert depuis l'IA).

## À quoi sert cette page
- Voir votre **quota du jour** par campagne.
- Reprendre les **rappels programmés** (leads que l'IA vous a transférés mais qui ont demandé un rappel).
- Consulter le **script** et le **prompt de la campagne** pour rester aligné.

## Comment l'utiliser
1. Cliquez sur une campagne pour voir sa **fiche** : script, leads à votre nom, performance.
2. Vos **rappels** apparaissent en haut avec l'heure prévue.

## Bonnes pratiques
- Avant un rappel, **relisez les notes** de l'appel IA précédent (visibles sur la fiche contact).
- Si le client demande "qui m'a appelé avant", soyez transparent : "C'était notre assistante virtuelle qui a pris quelques infos pour gagner du temps".

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)`,

    manager: `## Campagnes (manager)
Pilotage des campagnes en lecture / arrêt.

## À quoi sert cette page
- Suivre la **performance** des campagnes en cours et terminées.
- **Mettre en pause** une campagne qui dérape.
- Décider du **scaling** d'une campagne qui marche bien.

## Comment l'utiliser
1. Triez par **conversion** ou **coût par lead** pour identifier les top performers.
2. Pour pauser : ouvrez la campagne → bouton **⏸**.
3. Pour scaler : augmentez la vitesse (CPS) ou demandez à l'admin d'ajouter des leads.

## Bonnes pratiques
- Coupez vite les **canards boiteux** (conversion < 5 % du benchmark).
- Communiquez régulièrement les **top scripts** aux autres campagnes.

## Liens utiles
- [Analytics](/analytics)
- [Scripts](/scripts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AGENTS IA
  // ──────────────────────────────────────────────────────────────────────
  agents: {
    title: "Agents IA",
    learnMoreHref: docHref("agents"),
    default: `## Agents IA
Vos assistants conversationnels — chacun avec sa voix, son prompt, ses connaissances et ses outils.

## À quoi sert cette page
- Lister tous les **agents IA** de l'organisation.
- Créer un **nouvel agent** à partir d'un template ou de zéro.
- **Dupliquer** un agent existant pour partir d'une base éprouvée.
- Suivre la **performance** par agent (volume, durée, qualité).

## Comment l'utiliser
1. Cliquez **"+ Nouvel agent"**.
2. Choisissez un **template** ("Concierge hôtel", "Standard B2B", etc.) ou partez de zéro.
3. Renseignez **nom**, **langue**, **voix**, **modèle LLM**, **prompt système**, **greeting**.
4. Optionnel : activez **RAG** (documents) et **outils n8n**.
5. **Testez** : bouton "Appel test" (le système vous appelle pour échanger).
6. **Publiez** : l'agent devient disponible pour les flows, queues, campagnes.

## Bonnes pratiques
- Démarrez avec un **template** : 80 % du chemin est déjà fait.
- Un bon **prompt** = 2-3 paragraphes max, des exemples, des règles "ne fais pas".
- **Testez en condition réelle** avant d'assigner à un numéro de production.

## Cas d'usage typique
Vous voulez automatiser l'accueil d'un cabinet médical → template "Standard santé" → vous personnalisez le greeting et ajoutez le RAG sur la FAQ patient → 30 minutes plus tard, l'agent "Capucine" est en prod.

## Pièges à éviter
- Ne mettez **pas** de chiffres précis (prix, horaires) dans le prompt : utilisez le RAG. Sinon, à chaque changement, il faut éditer le prompt.
- Évitez les voix trop expressives pour un usage pro : elles surjouent.

## Liens utiles
- [Voice Studio](/voices) pour les voix
- [Documents (RAG)](/documents) pour la base de connaissance
- [Workflows n8n](/workflows) pour les outils`,
  },

  "agents.detail": {
    title: "Fiche agent IA",
    learnMoreHref: docHref("agents.detail"),
    default: `## Configuration d'un agent IA
Tous les leviers pour façonner précisément le comportement de votre agent.

## À quoi sert cette page
- Définir la **personnalité** et la **mission** de l'agent (prompt système).
- Choisir la **voix** (TTS) — preset ou voix clonée.
- Régler le **LLM** (provider, modèle, température).
- Activer le **RAG** : documents que l'agent peut consulter en direct.
- Configurer les **tools** : workflows n8n / fonctions que l'agent peut déclencher.
- Personnaliser le **greeting** (phrase d'accueil).

## Comment l'utiliser
1. **Prompt système** : décrivez QUI est l'agent, sa MISSION, son TON, ses LIMITES (ce qu'il ne fait pas).
2. **Voix** : choisissez dans le catalogue. Bouton ▶ pour preview.
3. **LLM** : \`deepseek-v4-flash\` est le défaut (rapide + ~3× moins cher que le tier pro). \`deepseek-v4-pro\` ou \`deepseek-reasoner\` pour les tâches complexes.
4. **RAG** : cochez les documents à exposer. L'agent fera un retrieval avant chaque réponse longue.
5. **Tools** : ajoutez les workflows n8n autorisés (transfer_human, reserver_rdv, etc.).
6. **Greeting** : phrase d'accueil. Court (5-10 mots) marche mieux que long.
7. **Test** : bouton "Appel test" pour valider avant publication.

## Bonnes pratiques
- **Prompt** : structurez en 3 blocs (identité / mission / règles). Donnez 1-2 exemples concrets. Précisez le ton ("naturel, jamais robotique").
- **Greeting** : ne dites pas "Je suis un assistant virtuel" — préférez "Bonjour, c'est Sophie de [marque], comment puis-je vous aider ?".
- **Température** : 0.3-0.5 pour des réponses prévisibles, 0.7+ pour de la conversation chaleureuse.
- **RAG** : ne mettez que les documents pertinents pour CE rôle, sinon l'agent dilue ses réponses.

## Cas d'usage typique
Agent "Concierge hôtel" :
1. Prompt : "Tu es Sophie, conciergerie hôtel des Pins. Tu réponds aux questions horaires/restaurant/chambres, tu prends les messages, tu transfères au standard si demande sensible."
2. RAG : PDF tarifs, PDF horaires resto, FAQ patient.
3. Tools : \`transfer_human\`, \`prendre_message\`, \`envoyer_confirmation_sms\`.
4. Greeting : "Bonjour, c'est Sophie de l'Hôtel des Pins, je vous écoute !"

## Pièges à éviter
- **Ne mettez pas le tarif dans le prompt** : il sera périmé. Utilisez le RAG.
- Trop d'outils tue les outils : 3-5 max, sinon l'agent hésite.
- N'utilisez pas de **voix clonée d'une personne sans consentement** (RGPD).

## Liens utiles
- [Voice Studio](/voices)
- [Documents (RAG)](/documents)
- [Workflows n8n](/workflows)
- [Teams IA](/teams) pour les swarms d'agents`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // VOICES
  // ──────────────────────────────────────────────────────────────────────
  voices: {
    title: "Voice Studio",
    learnMoreHref: docHref("voices"),
    default: `## Voice Studio
Créez, clonez et gérez vos voix synthétiques (TTS).

## À quoi sert cette page
- Parcourir la **bibliothèque** : voix natives du provider + vos voix clonées.
- **Cloner une voix** à partir d'un échantillon audio (10 sec à 5 min).
- **Prévisualiser** chaque voix en générant un échantillon test.
- Voir le **statut** de chaque voix (active, en erreur, en quota dépassé).

## Comment l'utiliser
1. **Bibliothèque** : parcourez les voix préinstallées. Boutton ▶ pour preview.
2. **+ Cloner une voix** :
   - Donnez un **nom** (ex: "Voix Sophie")
   - Uploadez un **MP3/WAV** (mono, 10 sec à 5 min, qualité claire)
   - Cliquez **"Cloner"**
   - Au bout de 10-30 s, la voix apparaît avec un statut "Prête"
3. **Test** : ▶ à côté de la voix → le système synthétise une phrase test.
4. **Assignation** : depuis Agents IA → fiche agent → champ "Voix".

## Bonnes pratiques
- L'audio source doit être **propre** : pas de musique, pas d'écho, une seule personne.
- 1-2 minutes d'audio suffit pour un bon clone — au-delà, gain marginal.
- **Testez sur plusieurs phrases** (court, long, avec chiffres, avec ponctuation) avant prod.

## Cas d'usage typique
Vous voulez personnaliser l'accueil hôtelier → vous demandez à un membre du staff (avec consentement écrit) de lire un petit texte de 1 min → vous clonez → vous assignez à votre agent IA.

## Pièges à éviter
- **Toujours obtenir le consentement écrit** de la personne dont vous clonez la voix (RGPD).
- Un **clone bas-débit** (audio mauvais) donnera une voix robotique.
- Certaines langues marchent mieux que d'autres — testez en condition.

## Diagnostic
Si une voix passe en erreur :
1. Ouvrez **Voices → Diagnostic** pour voir le code d'erreur (clé MiniMax manquante, quota dépassé, etc.).
2. Recliner si l'audio source était mauvais.

## Liens utiles
- [Agents IA](/agents) pour assigner les voix`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // FLOWS / IVR
  // ──────────────────────────────────────────────────────────────────────
  flows: {
    title: "Flow Builder IVR",
    learnMoreHref: docHref("flows"),
    default: `## Flow Builder
Concevez visuellement vos serveurs vocaux interactifs (IVR) en drag-and-drop.

## À quoi sert cette page
- Créer des **parcours d'appel structurés** (menu touche 1 / 2 / 3, captures DTMF, etc.).
- Brancher des **conditions** (heure, langue détectée, variable CRM).
- Appeler des **API externes** au milieu d'un parcours.
- Transférer vers un **agent IA**, une **queue** ou un numéro externe.

## Comment l'utiliser
1. **+ Nouveau flow** → vous arrivez sur un canvas vide.
2. Glissez les **nœuds** depuis la palette :
   - **Start** : entrée du flow.
   - **Say** : l'agent prononce une phrase.
   - **Listen** : capture la voix du client (avec timeout).
   - **Choice** : branche selon ce qu'il a dit (NLU).
   - **API Call** : appelle un endpoint (n8n, votre backend).
   - **Transfer** : vers humain ou autre queue.
   - **Hangup** / **Voicemail**.
3. **Reliez** les nœuds en tirant depuis les sorties.
4. **Variables** : tout ce que vous capturez est utilisable dans les nœuds suivants (\`{{user_choice}}\`).
5. **Testez** dans le simulateur intégré avant publication.
6. **Assignez** à un numéro depuis Numéros → fiche numéro → Routing → Flow.

## Bonnes pratiques
- Commencez **simple** : un Say + un Listen + un Choice + 2-3 branches suffisent souvent.
- Préférez les **agents IA en mode libre** pour les cas conversationnels — gardez l'IVR pour les cas vraiment structurés.
- Ajoutez toujours une **branche fallback** ("Désolé, je n'ai pas compris, je vous passe un conseiller").

## Cas d'usage typique
"Tapez 1 pour le SAV, 2 pour les ventes, 3 pour la facturation" → Choice → 3 branches qui mènent chacune à un agent IA spécialisé.

## Pièges à éviter
- **N'enchaînez pas + de 3 niveaux de menu** : les clients raccrochent.
- Les variables sensibles (carte bancaire) ne doivent jamais être loggées — désactivez la transcription sur ces nœuds.

## Liens utiles
- [Agents IA](/agents)
- [Queues](/queues)
- [Numéros](/numbers)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // WORKFLOWS N8N
  // ──────────────────────────────────────────────────────────────────────
  workflows: {
    title: "Workflows n8n",
    learnMoreHref: docHref("workflows"),
    default: `## Workflows d'automatisation
Connectez la plateforme à vos outils (CRM, Slack, email, calendrier…) via n8n.

## À quoi sert cette page
- Parcourir les **templates** prêts à l'emploi (sync HubSpot, notif Slack, email confirmation…).
- **Éditer** un workflow dans l'éditeur n8n embarqué.
- Définir des **triggers** : appel terminé, lead qualifié, escalade, sentiment négatif.
- Configurer les **outils (tools)** que vos agents IA peuvent appeler en live.

## Comment l'utiliser
1. **+ Nouveau workflow** → choisissez un template ou démarrez vide.
2. L'**éditeur n8n** s'ouvre dans la page.
3. Définissez votre **trigger** (webhook depuis Axon, cron, événement).
4. Ajoutez les **étapes** : HTTP request, Salesforce, Slack, etc.
5. **Activez** le workflow.
6. Pour qu'un agent IA puisse l'appeler en live, allez sur sa fiche → Tools → cochez le workflow.

## Bonnes pratiques
- **Versionnez** vos workflows critiques (export JSON dans git).
- **Testez** chaque workflow en isolé avant de l'exposer à un agent IA.
- Limitez les **side effects** des tools agents : un appel doit pouvoir échouer sans corrompre votre CRM.

## Cas d'usage typique
"Appel qualifié 'chaud'" → trigger sur l'événement \`call.qualified\` → création d'un deal Salesforce + notif Slack #ventes + email récap au commercial assigné.

## Pièges à éviter
- Ne mettez **pas de credentials en dur** dans le workflow — utilisez les credentials n8n.
- Évitez les workflows **trop longs** : > 30 sec et l'agent IA va attendre, le client va trouver ça long.

## Liens utiles
- [Agents IA](/agents) pour exposer les workflows en tools
- [Documents (RAG)](/documents) si vous voulez aussi exposer de la doc`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTS RAG
  // ──────────────────────────────────────────────────────────────────────
  documents: {
    title: "Documents (RAG)",
    learnMoreHref: docHref("documents"),
    default: `## Base documentaire RAG
Donnez de la connaissance métier à vos agents IA — sans qu'ils hallucinent.

## À quoi sert cette page
- **Uploader** vos documents (PDF, DOCX, TXT, MD).
- **Indexer** automatiquement (chunking + embeddings + pgvector).
- **Tagger** par catégorie, langue, agent destinataire.
- **Tester** le retrieval comme votre agent le fait.

## Comment l'utiliser
1. **+ Ajouter un document** → glissez votre fichier ou collez du texte.
2. Choisissez les **tags** (ex: "tarifs", "FAQ", "produit:hôtel").
3. Cliquez **"Indexer"** → l'extraction + embeddings se font en arrière-plan (10 sec à 2 min).
4. Une fois "Indexé", le document apparaît avec son nb de chunks.
5. **Tester** : tapez une question dans le champ "Test retrieval" → voyez les chunks remontés.
6. **Assignez** à un agent : dans sa fiche → RAG → cochez les documents.

## Bonnes pratiques
- **Découpez** vos documents par thématique : un doc "Tarifs" + un doc "Horaires" + un doc "FAQ" marchera mieux qu'un mégadoc de 200 pages.
- **Mettez à jour** régulièrement : un agent qui répond avec un tarif périmé est pire qu'un agent qui dit "je vérifie".
- Préférez le **markdown structuré** (titres clairs) au PDF non balisé.

## Cas d'usage typique
Vous uploadez votre catalogue produits + FAQ → vos agents IA répondent avec précision et citent leurs sources sans inventer.

## Pièges à éviter
- Ne mettez **jamais de données nominatives clients** dans le RAG (RGPD).
- Les **PDF scannés (images)** ne sont pas extractibles sans OCR — préférez un export texte.
- Trop de documents = retrieval moins précis : ciblez par tags.

## Liens utiles
- [Agents IA](/agents) pour assigner le RAG
- [Workflows n8n](/workflows) pour des données plus dynamiques`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // TEAMS (SWARM)
  // ──────────────────────────────────────────────────────────────────────
  teams: {
    title: "Équipes multi-agents",
    learnMoreHref: docHref("teams"),
    default: `## Swarm d'agents IA
Orchestrez plusieurs agents IA qui collaborent sur un même appel.

## À quoi sert cette page
- Construire des **équipes spécialisées** (accueil, technique, commercial, paiement…).
- Définir un **agent orchestrateur** (supervisor) qui dispatch selon l'intent.
- Configurer les **règles de handoff** entre agents.
- Garder un **contexte partagé** : la conversation reste cohérente même après plusieurs handoffs.

## Comment l'utiliser
1. **+ Nouvelle équipe** → donnez un nom (ex: "Squad SAV").
2. **Ajoutez des membres** : sélectionnez les agents IA existants.
3. Définissez l'**orchestrateur** : un agent qui reçoit en premier et route.
4. **Règles de handoff** : ex "si intent = SAV technique → passer à 'Hugo Tech'".
5. **Variables partagées** : ce que tout agent peut lire (nom client, historique).
6. **Testez** : appel test à l'équipe entière.

## Bonnes pratiques
- Spécialisez chaque agent — n'en faites pas des couteaux suisses.
- Le **handoff doit être invisible** pour le client : "un instant, je vous mets en relation avec mon collègue Hugo qui va gérer ça".
- Limitez à **3-5 agents** par équipe : au-delà, c'est ingérable.

## Cas d'usage typique
Squad SAV pour un retailer :
- **Accueil** : reçoit, qualifie l'intent.
- **Tech** : prend la main pour les problèmes produit.
- **SAV** : gère retour / remboursement.
- **Commercial** : pour les opportunités up-sell.
L'accueil dispatch, les autres prennent la suite, et un humain peut prendre la main à tout moment.

## Pièges à éviter
- Ne mettez pas deux agents avec le **même rôle** : conflit de handoff.
- Trop de handoffs ressentis irrite — limiter à 1-2 par appel max.

## Liens utiles
- [Agents IA](/agents)
- [Workflows n8n](/workflows) pour les tools partagés`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SCRIPTS
  // ──────────────────────────────────────────────────────────────────────
  scripts: {
    title: "Scripts de campagne",
    learnMoreHref: docHref("scripts"),
    default: `## Scripts de campagne
Bibliothèque de scripts conversationnels réutilisables pour vos campagnes.

## À quoi sert cette page
- Centraliser vos **scripts** (ouverture, qualification, pitch, objections, closing).
- Gérer les **variables** \`{{firstname}}\`, \`{{company}}\` interpolées au runtime.
- Versionner et **A/B tester** vos scripts.
- Réutiliser un même script sur plusieurs campagnes.

## Comment l'utiliser
1. **+ Nouveau script** → nommez-le (ex: "Prospection B2B SaaS").
2. Rédigez les **sections** :
   - Ouverture (5-10 sec)
   - Qualification (3-5 questions)
   - Pitch (30 sec max)
   - Objections (préparez les 3-5 plus courantes)
   - Closing (RDV ou CTA)
3. Insérez des **variables** entre \`{{ }}\` — elles seront remplacées par les données CSV du contact.
4. **Versionnez** : chaque modif crée une nouvelle version, vous gardez l'historique.
5. **Assignez** à une campagne dans la fiche campagne.

## Bonnes pratiques
- **Court vaut mieux que long** : un agent IA improvise bien à partir de 3-5 lignes claires.
- Préférez des **bullets** au texte continu — l'agent suit mieux.
- **A/B test** : 2 versions, 100 leads chacune, comparez la conversion.

## Cas d'usage typique
Script "Relance lead tiède" : ouverture chaleureuse + 2 questions de qualification + proposition d'envoi documentation ou RDV → conversion mesurée sur 7 jours.

## Pièges à éviter
- Ne mettez **pas** d'informations sensibles (tarifs détaillés) dans le script si elles changent — utilisez le RAG.
- **Ne lisez pas** mot à mot un script : laissez l'agent IA improviser autour.

## Liens utiles
- [Campagnes](/campaigns)
- [Agents IA](/agents)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CONTACTS
  // ──────────────────────────────────────────────────────────────────────
  contacts: {
    title: "Contacts (CRM)",
    learnMoreHref: docHref("contacts"),
    default: `## Contacts
Votre base CRM intégrée — utilisée pour les campagnes et l'historique d'appels.

## À quoi sert cette page
- Centraliser tous vos **contacts** (B2B / B2C).
- Voir l'**historique** : appels, notes, tags, qualifications.
- **Importer** en CSV avec mapping automatique.
- Créer des **segments** (tags) pour cibler vos campagnes.

## Comment l'utiliser
1. **+ Nouveau contact** ou **Importer CSV**.
2. Pour l'import : colonnes obligatoires : \`phone\`. Optionnelles : \`first_name\`, \`last_name\`, \`email\`, \`company\`, etc.
3. Sur la fiche d'un contact : **historique appels**, notes, tags, opt-out.
4. **Recherche** rapide par nom / téléphone / email / tag.
5. **Tags** : créez vos segments ("lead chaud", "VIP", "do-not-call").

## Bonnes pratiques
- **Nettoyez** régulièrement votre base : doublons, numéros invalides.
- Marquez les **opt-out** clairement (tag "DNC") pour qu'ils soient exclus des campagnes.
- Importez par **lots de 5000 max** pour rester fluide.

## Cas d'usage typique
Après un salon, vous recevez 500 leads → import CSV → tag "Salon Oct" → vous lancez une campagne ciblée sur ce tag.

## Pièges à éviter
- **RGPD** : assurez-vous d'avoir la base légale pour appeler (consentement, intérêt légitime).
- Un **mauvais format de téléphone** (sans indicatif pays) fait échouer la composition — ajoutez \`+33\` etc. avant import.

## Liens utiles
- [Campagnes](/campaigns)
- [Appels](/calls)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // NUMBERS
  // ──────────────────────────────────────────────────────────────────────
  numbers: {
    title: "Numéros",
    learnMoreHref: docHref("numbers"),
    default: `## Numéros
Gérez vos numéros de téléphone (entrants et sortants) achetés chez Twilio.

## À quoi sert cette page
- **Acheter** un numéro par pays / région directement depuis l'interface.
- **Router** chaque numéro vers un flow IVR, une queue, ou un agent IA.
- Configurer le **caller ID** (identité affichée en sortant).
- Vérifier la **conformité** (STIR/SHAKEN, A2P 10DLC pour les US).

## Comment l'utiliser
1. **Acheter** : sélectionnez pays + type (Local / Mobile / TollFree) → Twilio liste les numéros disponibles → Achetez.
2. **Configurer** : cliquez sur le numéro → onglet "Routing" → choisissez l'agent IA, la queue ou le flow.
3. **Webhooks Twilio** : automatisés via le bouton "Auto-config webhooks" (ou manuel sur la console Twilio).
4. **Caller ID** : champ "Identité présentée" — utile en sortant.

## Bonnes pratiques
- Pour les **outbound massifs**, achetez un **pool de numéros** et activez la rotation (évite le flag spam).
- Pour les **inbound critiques**, gardez un seul numéro VIP avec une queue dédiée.
- Vérifiez la **santé** mensuellement (Numéros → Santé).

## Cas d'usage typique
Vous lancez un nouveau service en Belgique → vous achetez un numéro BE Local + un mobile → vous routez le local vers la queue support, le mobile vers la campagne outbound.

## Pièges à éviter
- N'oubliez pas de **configurer les webhooks Twilio** sinon les appels arrivent dans le vide.
- En **US**, l'A2P 10DLC est obligatoire pour le SMS — pas pour la voix, mais lisez les guidelines.
- Les **TollFree** coûtent plus cher mais inspirent plus confiance pour le service client.

## Liens utiles
- [Santé numéros](/numbers/health)
- [Queues](/queues)
- [Flows](/flows)`,

    admin: `## Numéros (admin)
Gestion complète des numéros de votre organisation.

## À quoi sert cette page
- **Achat / portage** de numéros.
- **Routing** et flows associés.
- **Compliance** : STIR/SHAKEN, A2P 10DLC, vérification du caller ID.
- Suivi des **coûts mensuels** par numéro.

## Comment l'utiliser
1. **Acheter** depuis Twilio (bouton Acheter), ou **Importer** un numéro déjà chez vous (portage).
2. **Webhooks** : utilisez l'auto-config (recommandé) pour pointer voice + status sur la plateforme.
3. **Pool sortant** : si > 50 appels/jour, créez un pool de 5-10 numéros pour la rotation.
4. **Audit** : ouvrez l'onglet Coûts pour la facturation détaillée.

## Bonnes pratiques
- Notez en **commentaire** l'usage de chaque numéro (entrant SAV, sortant relance…) — votre équipe vous remerciera dans 6 mois.
- Renouvelez vos vérifications **STIR/SHAKEN** annuellement.

## Cas d'usage typique
Vous remarquez qu'un numéro sortant est flagué "Spam Likely" → vous le mettez en repos pendant 30 jours → vous activez 2 nouveaux numéros dans le pool.

## Pièges à éviter
- **Ne supprimez pas** un numéro affecté à un flow en prod : confirmez d'abord qu'il n'est plus routé.
- Les webhooks **manuels Twilio** se cassent à chaque renouvellement de domaine — préférez l'auto-config.

## Liens utiles
- [Santé numéros](/numbers/health)
- [Connecteurs entrants](/admin/inbound)
- [Facturation](/admin/billing)`,
  },

  "numbers.health": {
    title: "Santé des numéros",
    learnMoreHref: docHref("numbers.health"),
    default: `## Santé des numéros
Surveillance de la réputation et de la qualité de vos numéros sortants.

## À quoi sert cette page
- Voir le **spam score** attribué à chaque numéro par les opérateurs / apps anti-spam.
- Suivre le **taux de décroché** par numéro (indicateur clé de la santé).
- Gérer la **rotation** : pools de numéros pour répartir la charge.
- Recevoir des **alertes** sur les numéros flagués.

## Comment l'utiliser
1. Le tableau liste vos numéros sortants avec leurs métriques (taux de décroché, spam score, volume).
2. Cliquez sur un numéro pour voir son **historique 30j**.
3. **Mettre en repos** : bouton pour suspendre un numéro 7/14/30 jours.
4. **Rotation** : Numéros → Pools → assignez plusieurs numéros à une campagne.

## Bonnes pratiques
- **Sous 30 %** de décroché : mettez le numéro en repos 14 jours.
- **Sous 20 %** : changez de numéro (le repos suffit rarement).
- Variez les **patterns** (heures, fréquence) pour éviter les algos anti-spam.
- Faites tourner par **pools de 5-10** numéros.

## Cas d'usage typique
Vous lancez une campagne 5000 appels → vous activez un pool de 8 numéros → la plateforme distribue la charge → aucun ne dépasse 100 appels/jour → spam score reste vert.

## Pièges à éviter
- **Ne dépassez pas 200 appels/jour/numéro** sans suivi rapproché.
- Un numéro flagué garde sa mauvaise réputation **plusieurs semaines** même après repos.

## Liens utiles
- [Numéros](/numbers)
- [Campagnes](/campaigns)
- [Alertes](/alerts) pour les seuils auto`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DESK / SOFTPHONE
  // ──────────────────────────────────────────────────────────────────────
  desk: {
    title: "Mon poste (softphone)",
    learnMoreHref: docHref("desk"),
    default: `## Softphone
Votre téléphone web intégré pour passer et recevoir des appels.

## À quoi sert cette page
- **Recevoir** les appels assignés (queues, transferts depuis IA).
- **Composer** un numéro manuellement.
- **Gérer** mute, hold, transfert, conférence.
- **Prendre des notes** en direct, sauvegardées sur la fiche d'appel.

## Comment l'utiliser
1. Vérifiez votre **statut** (🟢 Disponible / 🟡 Pause / 🔴 Indisponible).
2. **Recevoir** : un appel entrant sonne → ✅ Décrocher / ❌ Refuser.
3. **Composer** : pavé numérique ou bouton "Composer" → tapez ou collez un numéro.
4. **Pendant l'appel** : boutons mute, hold, transfer, conf, raccrocher.
5. **Notes** : panneau de droite — tapez en live, sauvegardé auto.

## Bonnes pratiques
- **Autorisez le micro** dans le navigateur dès le 1er chargement (Chrome / Edge : cadenas → micro → Autoriser).
- Mettez votre statut sur **🟡 Pause** avant de partir en pause café.
- Les notes prises pendant l'appel apparaissent ensuite sur la **fiche contact**.

## Cas d'usage typique
Un appel transféré depuis l'agent IA arrive sur votre softphone → vous voyez un **résumé IA** (ce qui a été dit avant) → vous décrochez → vous prenez le relais sans transition pour le client.

## Pièges à éviter
- Si le micro est **en sourdine système (Windows / Mac)**, le softphone ne pourra rien y faire — vérifiez en dehors du navigateur.
- Ne **rechargez pas** la page pendant un appel : vous le perdez.

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)`,

    agent: `## Votre softphone
Outil principal pour prendre les appels.

## À quoi sert cette page
- **Recevoir** les appels (queue, handoff depuis IA, transfert d'un collègue).
- **Passer** des appels sortants (rappel, prospection manuelle).
- **Transférer** vers un collègue, une queue, ou un numéro externe.
- **Prendre des notes** sauvegardées sur la fiche contact.

## Comment l'utiliser
1. **Connectez-vous** → vous arrivez sur le desk.
2. Passez en **🟢 Disponible** pour recevoir des appels.
3. Quand un appel arrive : ✅ Décrocher (un résumé IA s'affiche s'il y en a un).
4. **Pendant l'appel** : mute / hold / transfer / conf / hangup, et prise de notes en direct.
5. **Après l'appel** : ajoutez un tag (RDV pris / à rappeler / réclamation) → Enregistrer.

## Bonnes pratiques
- Ayez **un casque branché** avant de vous mettre Disponible.
- Soignez les **notes** : votre futur vous (ou un collègue) les relira.
- Un **handoff depuis l'IA** = le contexte est déjà résumé → ne refaites pas tout le brief au client.

## Cas d'usage typique
L'IA a fait l'accueil et qualifié un lead chaud → handoff → votre desk sonne → vous voyez "client intéressé par formule pro, attend une démo" → vous prenez RDV en 5 min.

## Pièges à éviter
- **Ne mute pas pendant longtemps** sans prévenir : le client croit avoir été abandonné.
- Si vous **refusez** un appel, la queue le redistribue mais ça pèse sur vos KPIs.

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)
- [Mes campagnes](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN
  // ──────────────────────────────────────────────────────────────────────
  admin: {
    title: "Administration",
    learnMoreHref: docHref("admin"),
    default: `## Administration
Paramètres et opérations sur votre organisation.

## À quoi sert cette page
- Inviter / gérer les **membres** et leurs rôles.
- Gérer les **organisations** (multi-tenant, super_admin uniquement).
- Configurer les **connecteurs** entrants (Twilio, SIP, webhooks) et sortants (CRM, n8n).
- Suivre la **facturation** (abonnement, factures, moyens de paiement).
- Consulter l'**audit log** des actions sensibles.

## Comment l'utiliser
1. Section **Users** : invitez des membres (email + rôle), suspendez, changez les rôles.
2. Section **Connecteurs** : ajoutez Twilio, configurez les webhooks.
3. Section **Audit** : recherchez par utilisateur, action, période.
4. Section **Facturation** : voir cycle en cours et historique.

## Bonnes pratiques
- Limitez le rôle **admin** à 2-3 personnes max ; les autres en manager / supervisor / agent.
- Activez le **2FA obligatoire** dans Paramètres → Sécurité.
- Surveillez l'**audit log** chaque semaine pour détecter les actions anormales.

## Cas d'usage typique
Vous accueillez un nouveau manager → Users → Inviter → email + rôle "manager" → il reçoit son lien d'activation → vous lui assignez les bonnes équipes en queue.

## Pièges à éviter
- **Ne donnez jamais le rôle admin à un agent terrain** : il aurait accès à tout (facturation, suppression).
- Si un membre **quitte** l'organisation, désactivez immédiatement son compte (ne supprimez pas — pour l'audit).

## Liens utiles
- [Connecteurs entrants](/admin/inbound)
- [Facturation](/admin/billing)
- [Copilote Super Admin](/admin/copilot)
- [Paramètres](/settings)`,

    super_admin: `## Administration plateforme
Vous voyez et gérez **toutes les organisations** de la plateforme.

## À quoi sert cette page
- **Créer / suspendre** des organisations.
- Définir les **quotas** par tenant (minutes, agents, numéros, stockage).
- Consulter l'**audit global** (toutes les orgs).
- Gérer les **templates de plateforme** (agents IA, flows, scripts) réutilisables par toutes les orgs.

## Comment l'utiliser
1. **Organisations** → liste de tous les tenants. Bouton "+ Nouvelle org".
2. **Quotas** : par org, définissez les limites (minutes/mois, nb agents IA, stockage RAG GB).
3. **Suspension** : ⋮ → Suspendre (l'org devient inaccessible mais les données restent).
4. **Switch d'org** : sélecteur en haut à droite de la sidebar.

## Bonnes pratiques
- Mettez en place une **politique de quotas** par défaut (ex: trial = 100 min, paid = 5000 min).
- Faites une **revue trimestrielle** des orgs inactives → relance commerciale ou suspension.
- Avant de **supprimer** une org, faites un export complet (RGPD).

## Cas d'usage typique
Un prospect signe le contrat → vous créez son org → vous mettez ses quotas, vous invitez son owner → en 5 min il a un environnement clean prêt à l'emploi.

## Pièges à éviter
- **Ne supprimez jamais** une org sans backup : c'est irréversible et les données sont perdues.
- La **suspension** est instantanée pour les utilisateurs — prévenez-les avant.

## Liens utiles
- [Organisations](/admin)
- [Copilote](/admin/copilot)
- [Facturation](/admin/billing)`,
  },

  "admin.orgs": {
    title: "Organisations",
    learnMoreHref: docHref("admin.orgs"),
    default: `## Gestion des organisations
Espace réservé aux super-admins pour gérer le multi-tenant.

## À quoi sert cette page
- **Lister** toutes les organisations.
- **Créer** un nouveau tenant avec son owner.
- Définir les **quotas** (minutes, agents, numéros, stockage).
- **Suspendre** ou réactiver une org sans la supprimer.
- **Switch** en tant que support sur une org (avec traçabilité).

## Comment l'utiliser
1. **+ Nouvelle organisation** : nom, slug, plan, owner (email → invitation auto).
2. **Quotas** : par org, ajustez les limites.
3. **Switch** : bouton "Se connecter en tant que" — toutes vos actions sont loggées.
4. **Suspension** : ⋮ → Suspendre (avec motif obligatoire).

## Bonnes pratiques
- Standardisez vos **plans** (Trial / Pro / Enterprise) avec quotas associés.
- Le switch d'org doit être **réservé au support** — c'est un accès sensible.
- Loggez systématiquement le **motif** d'une suspension.

## Cas d'usage typique
Une org dépasse ses quotas → vous la contactez → si pas de réponse 7j → vous la suspendez avec motif "dépassement quota - non-paiement" → email auto envoyé à l'owner.

## Pièges à éviter
- **Ne switchez pas** sans nécessité opérationnelle — c'est tracé et visible côté client.
- **Ne réutilisez pas un slug d'org supprimée** : conflit potentiel.

## Liens utiles
- [Admin](/admin)
- [Facturation](/admin/billing)`,
  },

  "admin.copilot": {
    title: "Copilote IA",
    learnMoreHref: docHref("admin.copilot"),
    default: `## Copilote IA
Assistant IA pour configurer et piloter la plateforme en langage naturel.

## À quoi sert cette page
- **Interroger** la plateforme : "combien d'appels manqués hier ?".
- **Planifier** des actions : "lance une campagne sur ces 200 contacts demain 10h".
- **Diagnostiquer** : "pourquoi le numéro +33 1... a un mauvais taux de décroché ?".
- **Générer** des artefacts : scripts, prompts, flows.

## Comment l'utiliser
1. Tapez votre demande dans la **barre de chat** en langage naturel.
2. Le copilote interroge **Supabase**, **n8n**, le **RAG plateforme** et vous répond avec **données + recommandations**.
3. S'il propose une action (créer agent, lancer campagne…), il vous demande **confirmation** avant exécution.
4. Vous pouvez voir le **plan d'exécution** (tool calls) avant validation.

## Bonnes pratiques
- Soyez **précis** : "campagne pour ces 200 leads avec agent Lisa, fenêtre 9h-12h" → meilleur résultat que "fais une campagne".
- Demandez-lui de **diagnostiquer avant d'agir** ("pourquoi cette campagne convertit mal ?").
- Utilisez-le pour **générer un premier jet** de prompt / script, puis affinez à la main.

## Cas d'usage typique
"Génère-moi un script de prospection pour le secteur immobilier, B2C, qui mène vers une prise de RDV" → le copilote sort un script structuré → vous gardez 80 %, vous adaptez 20 %.

## Pièges à éviter
- Vérifiez toujours le **plan d'exécution** avant de valider une action — le copilote a accès en écriture.
- Pour des actions **massives** (>100 contacts), demandez d'abord un **dry-run** ("simule sans envoyer").

## Liens utiles
- [Workflows n8n](/workflows) (le copilote en utilise)
- [Documents (RAG)](/documents)`,
  },

  "admin.inbound": {
    title: "Connecteurs entrants",
    learnMoreHref: docHref("admin.inbound"),
    default: `## Connecteurs entrants
Sources d'appels et de leads que la plateforme ingère.

## À quoi sert cette page
- Connecter des **trunks SIP** (interconnexions opérateur).
- Configurer les **webhooks Twilio** (auto ou manuel).
- Brancher des **webhooks externes** (Meta Ads, Google Ads, votre site).
- Configurer **email-to-call** : un email entrant déclenche un rappel.

## Comment l'utiliser
1. **+ Nouveau connecteur** → choisissez le type (Twilio, SIP, Webhook, Email).
2. Renseignez les **credentials** (chiffrés côté plateforme).
3. **Testez** la connexion : bouton "Tester" → vous voyez l'événement arriver.
4. **Mappez** : quel agent / queue / flow reçoit les appels de ce connecteur.

## Bonnes pratiques
- Utilisez l'**auto-config Twilio** plutôt que de configurer manuellement les webhooks.
- Préférez **HTTPS + signatures** pour les webhooks externes (sécurité).
- Documentez **chaque connecteur** (à quoi il sert, qui le maintient).

## Cas d'usage typique
Vous voulez transformer chaque lead Meta Ads en appel → vous créez un webhook qui pointe sur la plateforme → quand un lead arrive → la plateforme déclenche un rappel automatique via un agent IA.

## Pièges à éviter
- **Ne stockez pas** les credentials en clair côté n8n — utilisez les credentials chiffrés.
- Les webhooks **non signés** peuvent recevoir du spam → utilisez une signature HMAC.

## Liens utiles
- [Numéros](/numbers)
- [Workflows n8n](/workflows)`,
  },

  "admin.billing": {
    title: "Facturation",
    learnMoreHref: docHref("admin.billing"),
    default: `## Facturation
Suivi de votre consommation et de vos factures.

## À quoi sert cette page
- Voir le **cycle en cours** : minutes consommées, agents IA actifs, stockage RAG, nb numéros.
- Télécharger vos **factures** PDF.
- Gérer vos **moyens de paiement** (carte, prélèvement SEPA).
- **Changer de plan** ou ajouter des add-ons.

## Comment l'utiliser
1. **Cycle en cours** : barre de progression par quota.
2. **Factures** : table avec date, montant, statut, PDF.
3. **Moyens de paiement** : ajoutez / supprimez une carte.
4. **Plan** : voyez votre plan actuel et ses limites. Bouton "Mettre à niveau".
5. **Alertes** : configurez un seuil (ex: alerte à 80 % du quota minutes).

## Bonnes pratiques
- Activez les **alertes seuil** pour éviter les surprises de fin de cycle.
- Préférez le **prélèvement SEPA** pour les abonnements pro (carte = risque d'expiration).
- Téléchargez vos **factures** chaque mois pour votre compta.

## Cas d'usage typique
Vous voyez la barre "Minutes" à 85 % au 20 du mois → vous activez l'add-on "minutes supplémentaires" pour éviter la coupure.

## Pièges à éviter
- Une **carte expirée** déclenche une suspension auto sous 7j si non remplacée.
- Les **add-ons** sont consommés en plus du forfait — vérifiez ce qui est consommé en premier (souvent forfait puis add-on).

## Liens utiles
- [Admin](/admin)
- [Paramètres](/settings)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ALERTS
  // ──────────────────────────────────────────────────────────────────────
  alerts: {
    title: "Alertes",
    learnMoreHref: docHref("alerts"),
    default: `## Alertes
Incidents et seuils dépassés à traiter.

## À quoi sert cette page
- Voir les **alertes ouvertes** (à traiter).
- Filtrer par **sévérité**, **catégorie**, **source**.
- **Acquitter**, commenter, fermer une alerte.
- Définir vos propres **règles** (seuils personnalisés).

## Comment l'utiliser
1. Tri par **sévérité** (critique / haute / moyenne / info).
2. Cliquez sur une alerte pour ouvrir le **détail** (contexte, métrique, suggestion d'action).
3. **Acquitter** : "Je m'en occupe" → l'alerte passe en "en cours".
4. **Fermer** avec un commentaire.
5. **Règles** : tab "Configuration" pour créer / modifier les seuils.

## Catégories
- **Technique** : provider down, webhook KO, job en retard.
- **Qualité** : sentiment négatif, durée trop longue, abandon élevé.
- **Conformité** : appel hors fenêtre, contact opt-out appelé.
- **Business** : conversion qui chute, ROI campagne dégradé.

## Bonnes pratiques
- **Acquittez vite** une alerte critique (< 5 min) — ça évite les escalades vers le manager.
- Affinez vos **règles** : trop de bruit → vous n'en lisez plus aucune.
- Faites un **post-mortem** sur les alertes critiques fréquentes pour les résoudre à la source.

## Cas d'usage typique
"5 abandons en file VIP sur 10 min" → alerte rouge → vous renforcez l'équipe (ajout d'agents IA en fallback) → l'alerte se résout d'elle-même.

## Pièges à éviter
- **Ne fermez pas sans commenter** : l'historique est précieux pour les post-mortems.
- Ne configurez pas des seuils trop **bas** : vous serez noyé.

## Liens utiles
- [Dashboard](/dashboard)
- [Santé numéros](/numbers/health)
- [Files d'attente](/queues)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYSES LLM
  // ──────────────────────────────────────────────────────────────────────
  analyses: {
    title: "Analyses LLM",
    learnMoreHref: docHref("analyses"),
    default: `## Analyses LLM
Analyses post-appel automatiques générées par IA.

## À quoi sert cette page
- **Résumer** chaque appel en 3 lignes.
- Détecter le **sentiment** (positif / neutre / négatif) et son évolution.
- Extraire les **topics** abordés (sujets, objections, demandes).
- Scorer la **qualité** : conformité, opportunité commerciale, ton.
- Extraire les **actions** : rappels à prendre, tâches, RDV à créer.

## Comment l'utiliser
1. Filtrez par **période**, **agent**, **campagne**, **sentiment**.
2. Cliquez sur une analyse pour voir le **détail** (résumé, sentiment, topics, actions).
3. **Lancer une analyse manuelle** sur un appel : depuis Calls → fiche appel → "Analyser".
4. **Exporter** en CSV pour vos comités qualité.

## Bonnes pratiques
- Faites une **revue qualité hebdo** : filtrez "sentiment négatif" + "conformité < 70 %" → débriefez en équipe.
- Croisez **agent × sentiment** pour identifier les besoins de formation.
- Activez les **analyses automatiques** sur 100 % des appels en prod.

## Cas d'usage typique
Lundi matin, vous ouvrez Analyses → filtre "sentiment négatif sur 7j" → vous identifiez 4 appels difficiles → débrief équipe → 2 sont des cas vraiment durs (clients agressifs), 2 sont des erreurs agent → coaching ciblé.

## Pièges à éviter
- Le **sentiment LLM** n'est pas parfait sur l'ironie / les nuances culturelles — écoutez l'audio quand un cas vous étonne.
- Les **analyses coûtent en LLM** : si vous avez 10 000 appels/jour, mieux vaut échantillonner que tout analyser.

## Liens utiles
- [Appels](/calls)
- [Analytics](/analytics)
- [Alertes](/alerts) (vous pouvez transformer un seuil en alerte)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ──────────────────────────────────────────────────────────────────────
  settings: {
    title: "Paramètres",
    learnMoreHref: docHref("settings"),
    default: `## Paramètres
Votre profil et vos préférences personnelles.

## À quoi sert cette page
- Modifier votre **profil** (nom, photo, langue de l'interface).
- Configurer les **notifications** (email, in-app, push).
- Gérer la **sécurité** : mot de passe, 2FA, sessions actives.
- Personnaliser les **préférences** (thème, raccourcis).

## Comment l'utiliser
1. **Profil** : changez votre nom, votre photo. La langue de l'interface s'applique au prochain refresh.
2. **Notifications** : choisissez ce que vous voulez recevoir et par quel canal.
3. **Sécurité** : activez le 2FA (recommandé). Révoquez les sessions inutilisées.
4. **Préférences** : thème (sombre / clair / système).

## Bonnes pratiques
- **Activez le 2FA** — un compte compromis donne accès à des données clients.
- Révoquez les **sessions anciennes** (vieux laptop, café public).
- Notifications **email + in-app** pour les alertes critiques, **in-app** seul pour le reste.

## Pièges à éviter
- Si vous **désactivez toutes les notifications**, vous risquez de manquer un événement important.
- N'utilisez **jamais** le même mot de passe que sur d'autres services.

## Liens utiles
- [Administration](/admin)`,

    admin: `## Paramètres organisation
Personnalisez votre tenant (visuel, sécurité, intégrations).

## À quoi sert cette page
- **Identité visuelle** : logo, couleurs (apparaissent dans les emails, le portail).
- **Domaine personnalisé** : ex \`support.votre-marque.com\` au lieu de l'URL plateforme.
- **Politiques de sécurité** : mots de passe forts, 2FA obligatoire, IP allowlist.
- **Intégrations globales** : LDAP / SSO, providers personnalisés.

## Comment l'utiliser
1. **Branding** : uploadez logo (PNG/SVG transparent recommandé) + couleurs primaires.
2. **Domaine** : ajoutez votre CNAME, validez le DNS, attendez le certificat (5-30 min).
3. **Sécurité** : cochez "2FA obligatoire" (recommandé en prod).
4. **SSO** : configurez SAML / OIDC si vous avez un IdP (Okta, Azure AD).

## Bonnes pratiques
- Activez le **2FA obligatoire** dès que vous avez plus de 5 membres.
- Mettez en place une **politique de mot de passe** (12 char min, complexité, rotation 90j).
- Pour les grands comptes : **SSO via SAML** > comptes locaux (gestion centralisée).

## Cas d'usage typique
Onboarding d'un nouveau client B2B → vous activez son branding (logo + couleurs) en 10 min → l'expérience est immédiatement personnalisée.

## Pièges à éviter
- Une **IP allowlist** mal configurée peut vous bloquer vous-même : testez sur un autre membre avant d'activer.
- Le **changement de domaine** invalide les anciens liens d'invitation — communiquez avant.

## Liens utiles
- [Administration](/admin)
- [Facturation](/admin/billing)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AUTH (kept short — these are pre-app)
  // ──────────────────────────────────────────────────────────────────────
  signup: {
    title: "Inscription",
    learnMoreHref: docHref("signup"),
    default: `## Créer un compte
Bienvenue ! Quelques infos suffisent pour démarrer.

## À quoi sert cette page
- Créer votre compte **en 30 secondes**.
- Vous connecter via **Google / Microsoft** si vous préférez.
- Rejoindre une **organisation existante** par invitation.

## Comment l'utiliser
1. **Email + mot de passe** (8 char min) OU "Continuer avec Google/Microsoft".
2. Choisissez : créer ma propre organisation, ou rejoindre par code d'invitation.
3. Confirmez votre **email** (lien envoyé).
4. Suivez l'**onboarding** : assistant pas-à-pas pour configurer votre 1er agent IA.

## Bonnes pratiques
- Utilisez votre **email professionnel** (pour la facturation et la conformité).
- Démarrez avec un **template d'agent** : 5 min et vous avez quelque chose à tester.

## Pièges à éviter
- Vérifiez vos **spams** si vous ne recevez pas l'email de confirmation.

## Liens utiles
- [Connexion](/login)`,
  },

  login: {
    title: "Connexion",
    learnMoreHref: docHref("login"),
    default: `## Se connecter
Accédez à votre espace Axon.

## À quoi sert cette page
- Vous **connecter** à votre compte (email + mot de passe, ou SSO).
- **Récupérer** un mot de passe oublié.
- **Switcher** entre organisations après login (si membre de plusieurs).

## Comment l'utiliser
1. **Email + mot de passe**, ou "Continuer avec Google/Microsoft" si activé.
2. Si 2FA activé : tapez le **code** de votre app authenticator.
3. **Mot de passe oublié ?** → lien de réinitialisation envoyé par email.

## Bonnes pratiques
- Activez le **2FA** dès que possible (Paramètres → Sécurité).
- Évitez les sessions sur **machines partagées** sans déconnexion.

## Pièges à éviter
- Trop d'échecs → compte temporairement bloqué (5 min) pour sécurité.

## Liens utiles
- [Créer un compte](/signup)`,
  },
};

/** Resolve markdown content for a (contextKey, role) pair. */
export function resolveHelp(
  contextKey: string,
  role: HelpRole | null | undefined
): { title: string; body: string; learnMoreHref?: string } | null {
  const entry = HELP[contextKey];
  if (!entry) return null;
  const body = (role && entry[role]) || entry.default;
  return {
    title: entry.title,
    body,
    learnMoreHref: entry.learnMoreHref,
  };
}

/** Returns all context keys that have at least a `default` body. */
export function allContextKeys(): string[] {
  return Object.keys(HELP);
}

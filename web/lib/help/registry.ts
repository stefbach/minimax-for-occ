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
 *   - Start with a one-sentence intro that explains the page in plain English.
 *   - Then sections: "What this page is for", "How to use it",
 *     "Best practices", "Typical use case", "Pitfalls to avoid",
 *     "Useful links".
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
  /** Optional French title — shown when the interface language is French. */
  title_fr?: string;
  default: string;
  /** French default content — shown when lang="fr" and no role-specific French variant exists. */
  fr?: string;
  super_admin?: string;
  fr_super_admin?: string;
  admin?: string;
  fr_admin?: string;
  manager?: string;
  fr_manager?: string;
  supervisor?: string;
  fr_supervisor?: string;
  agent?: string;
  fr_agent?: string;
  /** Optional link appended at the bottom as "Learn more". */
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
    title: "Dashboard",
    title_fr: "Tableau de bord",
    learnMoreHref: docHref("dashboard"),
    fr: `## Tableau de bord
Vue en temps réel de l'activité de votre centre de contact vocal.

## À quoi sert cette page
- Repérer les **incidents en cours** d'un coup d'œil (saturation de file, agent IA bloqué, alerte qualité).
- Suivre les **KPI essentiels** : appels actifs, taux de décrochage, durée moyenne, satisfaction.
- Visualiser les **campagnes sortantes** actives et leur progression.
- Accéder rapidement aux **alertes** qui nécessitent une action.

## Comment l'utiliser
1. Survolez les **cartes KPI** en haut : chaque valeur affiche une tendance (▲ / ▼) par rapport à hier.
2. Cliquez sur **"Files d'attente"** pour ouvrir la vue détaillée.
3. Cliquez sur une **alerte rouge** pour ouvrir l'incident et l'acquitter.
4. Utilisez le **sélecteur de période** (en haut à droite) pour comparer Aujourd'hui / 7j / 30j.

## Bonnes pratiques
- Gardez cette page ouverte sur un **second écran** pendant les heures de bureau.
- Si la **durée moyenne** monte au-delà de 4 min sans raison évidente, vérifiez d'abord les prompts de l'agent IA — c'est souvent une boucle conversationnelle.
- Surveillez le **taux d'abandon** : au-delà de 5%, renforcez l'équipe ou activez le callback automatique.

## Cas d'usage type
Vous arrivez le matin → vous ouvrez le tableau de bord → la carte "Alertes" affiche **3 alertes ouvertes** → vous cliquez, traitez les 3 (faux positif, numéro au repos, ouverture de file) → le tableau revient au vert pour la journée.

## Pièges à éviter
- Ne confondez pas "appels en cours" (live) et "appels du jour" (cumulatif).
- Les KPI sont **calculés selon le fuseau horaire de l'organisation** — vérifiez-le dans Paramètres si les chiffres semblent décalés.
- Les chiffres de "Satisfaction" n'apparaissent que si le SMS post-appel est activé sur la campagne.

## Liens utiles
- [Alertes](/alerts) pour traiter les incidents
- [Analytics](/analytics) pour approfondir un KPI
- [Appels live](/calls) pour suivre les conversations en temps réel`,

    fr_agent: `## Mon tableau de bord
Votre vue personnelle : ce que vous avez fait aujourd'hui et ce qui arrive.

## À quoi sert cette page
- Voir vos **appels** d'un coup d'œil : traités, en cours, à rappeler.
- Suivre votre **performance** (durée moyenne, taux de qualification) et vous comparer à la moyenne équipe.
- Voir les **campagnes** auxquelles vous participez et votre quota journalier.
- Lire les **messages** ou instructions laissés par votre superviseur.

## Comment l'utiliser
1. Vérifiez votre **statut** en haut (🟢 Disponible / 🟡 En pause). Vous recevez des appels uniquement en Disponible.
2. Cliquez sur un appel dans **"À rappeler"** pour ouvrir la fiche et planifier le rappel.
3. Cliquez sur **"Mon poste"** pour aller au softphone et prendre ou passer un appel.

## Bonnes pratiques
- Avant de prendre une pause, passez votre statut à **🟡 En pause** pour ne pas bloquer la file.
- Les **rappels planifiés** apparaissent en haut à l'approche de l'heure — soyez disponible 5 min avant.

## Liens utiles
- [Mon poste (softphone)](/desk)
- [Mes contacts](/contacts)`,

    fr_supervisor: `## Tableau de bord superviseur
Gérez votre équipe en temps réel et intervenez là où ça coince.

## À quoi sert cette page
- Voir qui est **en ligne**, en pause ou en appel parmi vos agents.
- Surveiller la **file en direct** et anticiper la saturation.
- Recevoir les **alertes équipe** (appel trop long, sentiment négatif, escalade).
- Mesurer en continu le **SLA et la qualité** de votre équipe.

## Comment l'utiliser
1. Repérez les **agents en alerte** (en orange / rouge) dans la grille du haut.
2. Cliquez sur un appel rouge dans la liste "Appels actifs" pour ouvrir le panneau de supervision (écoute / souffler / intervenir).
3. Utilisez le **"Coaching live"** pour guider discrètement un agent junior.

## Liens utiles
- [Appels live](/calls)
- [Analyse LLM](/analyses)
- [Alertes](/alerts)`,

    fr_manager: `## Tableau de bord manager
Vue stratégique de la performance de votre département.

## À quoi sert cette page
- Suivre les **volumes** (entrant / sortant / conversion) sur 7, 30 ou 90 jours.
- Mesurer les **coûts** : minutes consommées, coût par lead, ROI campagne.
- Évaluer la **qualité** : sentiment moyen, scoring de conformité IA, NPS.
- Identifier les **tendances** à présenter en comité.

## Liens utiles
- [Analytics](/analytics)
- [Campagnes](/campaigns)
- [Copilot manager](/admin/copilot)`,

    fr_admin: `## Tableau de bord admin
Santé technique et opérationnelle de votre organisation.

## À quoi sert cette page
- Vérifier l'état de **l'infrastructure** : Twilio, n8n, Supabase, LLM/TTS.
- Suivre les **quotas** : minutes restantes, crédits API, stockage RAG.
- Surveiller la **sécurité** : tentatives de connexion échouées, accès récents, rôles modifiés.
- Anticiper la **facturation** du cycle en cours.

## Liens utiles
- [Administration](/admin)
- [Facturation](/admin/billing)
- [Santé des numéros](/numbers/health)`,

    default: `## Dashboard
A real-time overview of your voice contact centre's activity.

## What this page is for
- Spot **ongoing incidents** at a glance (queue saturation, blocked AI agent, quality alert).
- Track **vital KPIs**: active calls, answer rate, average duration, satisfaction.
- Visualise active **outbound campaigns** and their progress.
- Quickly access **alerts** that require action.

## How to use it
1. Hover over the **KPI cards** at the top: each value shows a trend (▲ / ▼) compared to yesterday.
2. Click **"Queues"** to open the detailed queue view.
3. Click a **red alert** to open the incident record and acknowledge it.
4. Use the **period selector** (top right) to compare Today / 7d / 30d.

## Best practices
- Keep this page open on a **second screen** during business hours.
- If **average duration** climbs above 4 min for no obvious reason, check the AI agent prompts first — it's often a conversational loop.
- Watch the **abandon rate**: above 5%, add staffing or activate automatic callback.

## Typical use case
You arrive in the morning → you open the dashboard → the "Alerts" card shows **3 open alerts** → you click, handle all 3 (false positive, number resting, queue opening), then the dashboard returns to green for the day.

## Pitfalls to avoid
- Don't confuse "calls in progress" (live) with "calls today" (cumulative).
- KPIs are **calculated using the organisation's timezone** — check it in Settings if the numbers look off.
- "Satisfaction" figures only appear if the post-call SMS is enabled on the campaign.

## Useful links
- [Alerts](/alerts) to handle incidents
- [Analytics](/analytics) to drill into a KPI
- [Live calls](/calls) to watch conversations in real time`,

    agent: `## My dashboard
Your personal view: what you've done today and what's coming up.

## What this page is for
- See your **calls** at a glance: handled, in progress, to call back.
- Track **your performance** (average duration, qualification rate) and compare yourself to the team average.
- View the **campaigns** you're assigned to and your daily quota.
- Read **messages** or instructions left by your supervisor.

## How to use it
1. Check your **status** at the top (🟢 Available / 🟡 On break). You'll only receive calls when you're Available.
2. Click a call in **"To call back"** to open the record and schedule the callback.
3. Click **"My desk"** to go to the softphone and take or place a call.

## Best practices
- Before taking a break, switch your status to **🟡 On break** so your colleagues don't get the calls.
- **Scheduled callbacks** appear at the top when the time approaches — be available 5 min beforehand.

## Typical use case
9:00 am → you log in → the dashboard shows **2 callbacks scheduled for the morning** + **1 supervisor message** ("prioritise VIP-tagged leads") → you handle the callbacks first.

## Pitfalls to avoid
- If you stay **Available** during a break, you block the queue and generate abandoned calls.
- Don't close the browser without switching to **Unavailable** — the routing might keep sending you calls.

## Useful links
- [My desk (softphone)](/desk)
- [My contacts](/contacts)`,

    supervisor: `## Supervisor dashboard
Manage your team in real time and step in where things get stuck.

## What this page is for
- See who is **online**, on break, or on a call among your agents.
- Monitor the **live queue** and anticipate saturation.
- Receive **team alerts** (call too long, negative sentiment, escalation).
- Continuously measure your team's **SLA and quality**.

## How to use it
1. Identify **agents with alerts** (highlighted in orange / red) in the top grid.
2. Click a red call in the "Active calls" list to open the supervision panel (listen / whisper / barge).
3. Use **"Live coaching"** to discreetly prompt a junior agent.
4. Filter by **queue** if you manage multiple teams.

## Best practices
- **Whisper** rather than barge when the agent is coping — taking over directly undermines the client's trust.
- Log coaching notes in **"LLM Analysis"** after each call to track an agent's progress.
- Set up **threshold alerts** (Alerts → Rules) to be notified as soon as a call exceeds N minutes.

## Typical use case
An agent goes over 8 min on a call → red card on the dashboard → you open the call → discreet listen for 30 sec → you identify a pricing sticking point → whisper "offer a 10% goodwill discount" → the agent wraps up, the customer is satisfied.

## Pitfalls to avoid
- **Barge** is heard immediately by both parties — don't do it without warning the team.
- Too many whispers cause the agent to lose track of the client; step in only at key moments.

## Useful links
- [Live calls](/calls)
- [LLM Analysis](/analyses)
- [Alerts](/alerts)`,

    manager: `## Manager dashboard
Strategic view of your department's performance.

## What this page is for
- Track **volume** (inbound / outbound / conversion) over 7, 30, or 90 days.
- Monitor **costs**: minutes consumed, cost per lead, campaign ROI.
- Measure **quality**: average sentiment, AI compliance scoring, NPS.
- Identify **trends** to present in committee meetings.

## How to use it
1. Choose the **period** (top-right selector) — 30d is a good weekly default.
2. Click a **KPI** to open the detail in Analytics.
3. Click **"Export"** to download a CSV for your committee.
4. The **"Top campaigns"** widget links directly to the best-performing campaigns.

## Best practices
- Systematically compare to the **previous period** (toggle "vs N-1") to spot drift.
- If you run many campaigns, set a **target cost per lead** and adjust speed / script if you go over it.
- Hold a weekly review **comparing quality (sentiment) and volume**: an agent doing more volume but less quality isn't necessarily creating value.

## Typical use case
Monday morning committee → you export the "last 30 days" CSV → you notice the "B2B Follow-up" campaign has a cost per lead 2× the target → you ask the admin to revise the script.

## Pitfalls to avoid
- Don't draw conclusions from **fewer than 50 calls** per segment: too much variance.
- Twilio costs fluctuate by country — compare on a like-for-like country basis.

## Useful links
- [Analytics](/analytics)
- [Campaigns](/campaigns)
- [AI Manager Copilot](/admin/copilot)`,

    admin: `## Admin dashboard
Technical and operational health of your organisation.

## What this page is for
- Check **infrastructure** status: Twilio, n8n, Supabase, LLM/TTS providers.
- Track **quotas**: remaining minutes, API credits, RAG storage.
- Monitor **security**: failed login attempts, recent access, modified roles.
- Anticipate **billing** for the current cycle.

## How to use it
1. If an **infra status** indicator is red, click it to open the detail (provider, error code).
2. If the **minutes quota** drops below 20% before the end of the cycle, open Billing → upgrade the plan.
3. Click **"Audit log"** to review sensitive actions from the last 7 days.

## Best practices
- Set up **threshold alerts** (Alerts → Rules) for quotas (e.g. alert at 80% consumption).
- Check **number health** (Numbers → Health) at least once a week.
- Keep an eye on **pending invitations**: a member who doesn't activate their account within 7 days will have their link expire.

## Typical use case
Friday evening, you notice **n8n is red** → you click → 502 error on the instance → you restart it from Admin → Connectors and the indicator turns green again.

## Pitfalls to avoid
- **Quotas** reset on the subscription anniversary date, not on the 1st of the month.
- Never delete an active member without **reassigning their contacts** first.

## Useful links
- [Administration](/admin)
- [Billing](/admin/billing)
- [Number health](/numbers/health)
- [Settings](/settings)`,

    super_admin: `## Super-admin dashboard
Multi-tenant management of the Axon platform.

## What this page is for
- Have a **consolidated view** across all organisations.
- Monitor **platform capacity**: system queues, delayed jobs, providers.
- Measure **revenue** (MRR, churn, expansion) in aggregate.
- Receive **global incidents** (provider outage, degradation).

## How to use it
1. Use the **org switcher** in the top right of the sidebar to switch to the relevant org.
2. Click **"Organisations"** for detailed management (creation, suspension, quotas).
3. Click **"Copilot"** to query the platform in natural language.

## Best practices
- Do a **weekly review** of organisations at the bottom of the leaderboard (low usage = churn risk).
- Set up **incident playbooks**: if a provider goes down, what do we switch, to what, in how long?

## Typical use case
Twilio announces maintenance in 4h → you filter **orgs > 100 minutes/day** → you send them an information message → you switch to degraded mode (pool rotation).

## Pitfalls to avoid
- Don't suspend an org without warning its owner: suspension is immediate.
- The **super_admin role** gives access to all data — use it with care (every action is logged).

## Useful links
- [Organisations](/admin) with switcher
- [Super Admin Copilot](/admin/copilot)
- [Connectors](/admin/inbound)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DASHBOARD — per-tab entries
  // ──────────────────────────────────────────────────────────────────────
  "dashboard.overview": {
    title: "Overview tab",
    title_fr: "Vue d'ensemble",
    learnMoreHref: docHref("dashboard"),
    fr: `## Vue d'ensemble
Résumé en temps réel des KPI essentiels, des campagnes actives et des leads du jour.

## À quoi sert cet onglet
- Suivre d'un coup d'œil les **KPI clés** : appels, taux de décrochage, durée moyenne.
- Voir la progression des **campagnes sortantes** actives.
- Consulter les **leads** en cours et leur statut.
- Repérer rapidement les **anomalies** par rapport à la veille.

## Comment l'utiliser
1. Survolez les **cartes KPI** pour voir la tendance vs hier.
2. Cliquez sur une campagne pour voir son détail.
3. Ajustez la **période** (Aujourd'hui / 7j / 30j) en haut à droite.

## Liens utiles
- [Analytics](/analytics) pour approfondir
- [Alertes](/alerts) pour les incidents`,

    default: `## Overview tab
Real-time summary of essential KPIs, active campaigns, and today's leads.

## What this tab is for
- See **key KPIs** at a glance: calls, answer rate, average duration.
- View the progress of active **outbound campaigns**.
- Check **leads** in progress and their status.
- Quickly spot **anomalies** compared to yesterday.

## How to use it
1. Hover over **KPI cards** to see the trend vs yesterday.
2. Click a campaign to see its detail.
3. Adjust the **period** (Today / 7d / 30d) at the top right.

## Useful links
- [Analytics](/analytics) to drill down
- [Alerts](/alerts) for incidents`,
  },

  "dashboard.stats": {
    title: "Statistics tab",
    title_fr: "Onglet Statistiques",
    learnMoreHref: docHref("dashboard"),
    fr: `## Statistiques
Analyse détaillée des volumes, qualifications et performance sur la période sélectionnée.

## À quoi sert cet onglet
- Visualiser les **qualifications d'appels** (intéressé, pas intéressé, passer à l'humain, etc.).
- Suivre le **taux d'efficacité** global et par agent.
- Comparer la performance des **campagnes** et **agents**.
- Identifier les tendances sur la durée.

## Comment l'utiliser
1. Sélectionnez la **période** en haut du tableau de bord.
2. Filtrez par **campagne** ou **agent** pour affiner.
3. Survolez les barres pour voir les compteurs exacts.
4. Utilisez la section "Coûts" pour le suivi budgétaire.

## Liens utiles
- [Analytics](/analytics) pour les exports`,

    default: `## Statistics tab
Detailed analysis of volumes, call qualifications, and performance for the selected period.

## What this tab is for
- Visualise **call qualifications** (interested, not interested, pass to human, etc.).
- Track overall and per-agent **efficacy rate**.
- Compare **campaign** and **agent** performance.
- Identify trends over time.

## How to use it
1. Select the **period** at the top of the dashboard.
2. Filter by **campaign** or **agent** to narrow down.
3. Hover over bars to see exact counts.
4. Use the "Costs" section for budget tracking.

## Useful links
- [Analytics](/analytics) for exports`,
  },

  "dashboard.leads": {
    title: "Leads tab",
    title_fr: "Onglet Leads",
    learnMoreHref: docHref("dashboard"),
    fr: `## Leads
Vue consolidée des leads collectés, leur source et leur état d'avancement dans le pipeline.

## À quoi sert cet onglet
- Voir tous les **leads entrants** du jour avec leur source (formulaire, appel, SMS...).
- Filtrer par **campagne**, **statut** ou **agent assigné**.
- Suivre le **taux de conversion** lead → appel → qualification.
- Identifier les leads **non traités** qui risquent de devenir froids.

## Comment l'utiliser
1. Filtrez par **statut** (Nouveau / En cours / Qualifié / Non joignable).
2. Cliquez sur un lead pour ouvrir sa fiche et son historique d'appels.
3. Exportez la liste en CSV pour votre CRM.

## Conseils
- Rappelez les leads marqués "Non joignable" dans les **24h** — la 2e tentative convertit nettement mieux.

## Liens utiles
- [Contacts](/contacts)
- [Campagnes](/campaigns)`,

    default: `## Leads tab
Consolidated view of collected leads, their source, and pipeline progress.

## What this tab is for
- See all **incoming leads** for the day with their source (form, call, SMS...).
- Filter by **campaign**, **status**, or **assigned agent**.
- Track the **conversion rate** lead → call → qualification.
- Identify **unhandled leads** that risk going cold.

## How to use it
1. Filter by **status** (New / In progress / Qualified / Unreachable).
2. Click a lead to open its record and call history.
3. Export the list as CSV for your CRM.

## Tips
- Call back "Unreachable" leads within **24 hours** — the 2nd attempt converts significantly better.

## Useful links
- [Contacts](/contacts)
- [Campaigns](/campaigns)`,
  },

  "dashboard.logs": {
    title: "Call Logs tab",
    title_fr: "Onglet Call Logs",
    learnMoreHref: docHref("dashboard"),
    fr: `## Call Logs
Historique complet et filtrable de tous les appels de la période.

## À quoi sert cet onglet
- Retrouver un appel spécifique par numéro, agent ou campagne.
- Vérifier la **durée**, la **qualification** et le **sentiment** de chaque appel.
- Écouter les **enregistrements** et lire les **transcriptions** IA.
- Identifier les appels nécessitant un suivi ou une escalade.

## Comment l'utiliser
1. Utilisez les **filtres** (direction, agent, campagne, statut, date).
2. Cliquez sur une ligne pour ouvrir le détail : enregistrement, transcript, qualification.
3. Cliquez sur l'icône IA pour voir l'**analyse LLM** de l'appel.
4. Exportez en CSV pour vos rapports.

## Liens utiles
- [Analyses LLM](/analyses)
- [Contacts](/contacts)`,

    default: `## Call Logs tab
Complete, filterable history of all calls for the period.

## What this tab is for
- Find a specific call by number, agent, or campaign.
- Check each call's **duration**, **qualification**, and **sentiment**.
- Listen to **recordings** and read AI **transcriptions**.
- Identify calls that need follow-up or escalation.

## How to use it
1. Use the **filters** (direction, agent, campaign, status, date).
2. Click a row to open the detail: recording, transcript, qualification.
3. Click the AI icon to see the call's **LLM analysis**.
4. Export as CSV for your reports.

## Useful links
- [LLM Analyses](/analyses)
- [Contacts](/contacts)`,
  },

  "dashboard.entrants": {
    title: "Inbound tab",
    title_fr: "Onglet Entrants",
    learnMoreHref: docHref("dashboard"),
    fr: `## Entrants
Suivi des appels entrants : volume, temps d'attente, décrochage et distribution par file.

## À quoi sert cet onglet
- Mesurer le **taux de décrochage** et le temps d'attente moyen sur les lignes entrantes.
- Suivre la distribution par **file d'attente** et par **agent**.
- Détecter les pics de volume pour ajuster les ressources.
- Analyser les motifs d'appel (classification IA).

## Comment l'utiliser
1. Filtrez par **file d'attente** pour isoler un service.
2. Comparez les courbes de volume entrant par heure pour repérer les pics.
3. Vérifiez le taux d'**abandon** : si > 5%, la file est sous-dimensionnée.

## Liens utiles
- [Files d'attente](/queues)
- [Live](/calls)`,

    default: `## Inbound tab
Inbound call tracking: volume, wait time, answer rate, and queue distribution.

## What this tab is for
- Measure the **answer rate** and average wait time on inbound lines.
- Track distribution by **queue** and by **agent**.
- Detect volume spikes to adjust resources.
- Analyse call reasons (AI classification).

## How to use it
1. Filter by **queue** to isolate a service.
2. Compare hourly inbound volume curves to spot peaks.
3. Check the **abandon rate**: above 5%, the queue is under-staffed.

## Useful links
- [Queues](/queues)
- [Live](/calls)`,
  },

  "dashboard.sms": {
    title: "SMS tab",
    title_fr: "Onglet SMS",
    learnMoreHref: docHref("dashboard"),
    fr: `## SMS
Suivi des SMS pré-appel envoyés et leur impact sur les taux de décrochage.

## À quoi sert cet onglet
- Voir le **volume de SMS** envoyés par campagne.
- Mesurer le **taux d'appels passés après SMS** (leads SMS qui ont décroché).
- Identifier les campagnes où le SMS améliore la conversion.
- Consulter les **statuts de livraison** (envoyé, délivré, échoué).

## Comment l'utiliser
1. Filtrez par **campagne** pour comparer l'impact SMS d'une campagne à l'autre.
2. Vérifiez les SMS en **erreur** (numéro invalide, opérateur bloquant) et corrigez-les dans Contacts.
3. Comparez le taux de décrochage avec/sans SMS pour valider la stratégie.

## Liens utiles
- [Campagnes](/campaigns)
- [Contacts](/contacts)`,

    default: `## SMS tab
Pre-call SMS tracking and their impact on answer rates.

## What this tab is for
- See the **SMS volume** sent per campaign.
- Measure the **post-SMS call rate** (SMS leads who answered).
- Identify campaigns where SMS improves conversion.
- Check **delivery statuses** (sent, delivered, failed).

## How to use it
1. Filter by **campaign** to compare SMS impact across campaigns.
2. Check **failed** SMS (invalid number, operator blocking) and correct them in Contacts.
3. Compare the answer rate with/without SMS to validate the strategy.

## Useful links
- [Campaigns](/campaigns)
- [Contacts](/contacts)`,
  },

  "dashboard.live": {
    title: "Live tab",
    title_fr: "Onglet Live",
    learnMoreHref: docHref("dashboard"),
    fr: `## Live
Vue en temps réel des appels actifs, agents connectés et état des files d'attente.

## À quoi sert cet onglet
- Voir tous les **appels en cours** et leur durée en temps réel.
- Connaître l'état (disponible / en appel / en pause) de chaque **agent**.
- Surveiller la **file d'attente** live et anticiper la saturation.
- Intervenir en **écoute**, **chuchotement** ou **prise en main** sur un appel.

## Comment l'utiliser
1. Repérez les appels en **rouge** (dépassant le seuil de durée critique).
2. Cliquez sur un appel pour ouvrir le panneau de supervision.
3. Utilisez **"Chuchoter"** pour guider discrètement l'agent sans que le client entende.
4. La page se rafraîchit automatiquement toutes les 10 secondes.

## Bonnes pratiques
- Restez sur cet onglet pendant les **heures de pointe** pour réagir immédiatement.
- Configurez des **alertes de durée** (Alertes → Règles) pour être notifié automatiquement.

## Liens utiles
- [Appels live](/calls)
- [Alertes](/alerts)`,

    default: `## Live tab
Real-time view of active calls, connected agents, and queue status.

## What this tab is for
- See all **calls in progress** and their duration in real time.
- Know each **agent**'s status (available / on call / on break).
- Monitor the **live queue** and anticipate saturation.
- Step in to **listen**, **whisper**, or **barge** on a call.

## How to use it
1. Spot calls highlighted in **red** (exceeding the critical duration threshold).
2. Click a call to open the supervision panel.
3. Use **"Whisper"** to guide the agent discreetly without the customer hearing.
4. The page auto-refreshes every 10 seconds.

## Best practices
- Stay on this tab during **peak hours** to react immediately.
- Configure **duration alerts** (Alerts → Rules) to be notified automatically.

## Useful links
- [Live calls](/calls)
- [Alerts](/alerts)`,
  },

  "dashboard.errors": {
    title: "Errors & Alerts tab",
    title_fr: "Onglet Erreurs & Alertes",
    learnMoreHref: docHref("dashboard"),
    fr: `## Erreurs & Alertes
Centralise toutes les erreurs techniques et alertes opérationnelles qui nécessitent votre attention.

## À quoi sert cet onglet
- Voir les **erreurs Twilio** (numéros invalides, erreurs d'appel, codes d'erreur).
- Suivre les **alertes de qualité** déclenchées par l'IA (sentiment négatif, durée anormale).
- Consulter les **échecs de webhook** ou de connecteur n8n.
- Prioriser les incidents à traiter.

## Comment l'utiliser
1. Triez par **sévérité** (Critique → Haute → Normale) pour traiter les urgences en premier.
2. Cliquez sur une erreur pour voir le **contexte complet** (appel, agent, heure).
3. Cliquez **"Acquitter"** une fois l'incident traité pour le sortir de la file.
4. Utilisez **"Ignorer"** pour les faux positifs récurrents.

## Bonnes pratiques
- Vérifiez cet onglet **matin et soir** minimum.
- Les erreurs Twilio 3xxxx indiquent généralement un problème de numérotation.

## Liens utiles
- [Alertes](/alerts)
- [Santé des numéros](/numbers/health)`,

    default: `## Errors & Alerts tab
Centralises all technical errors and operational alerts that need your attention.

## What this tab is for
- See **Twilio errors** (invalid numbers, call errors, error codes).
- Track **quality alerts** triggered by AI (negative sentiment, abnormal duration).
- Check **webhook or n8n connector failures**.
- Prioritise incidents to handle.

## How to use it
1. Sort by **severity** (Critical → High → Normal) to handle urgent issues first.
2. Click an error to see the **full context** (call, agent, time).
3. Click **"Acknowledge"** once the incident is handled to remove it from the queue.
4. Use **"Ignore"** for recurring false positives.

## Best practices
- Check this tab **morning and evening** at minimum.
- Twilio errors starting with 3xxxx generally indicate a dialling issue.

## Useful links
- [Alerts](/alerts)
- [Number health](/numbers/health)`,
  },

  "dashboard.ai": {
    title: "AI Insights tab",
    title_fr: "Onglet AI Insights",
    learnMoreHref: docHref("dashboard"),
    fr: `## AI Insights
Analyse automatique par IA de vos données d'appels pour faire émerger des insights actionnables.

## À quoi sert cet onglet
- Obtenir des **résumés IA** des tendances d'appels sur la période.
- Identifier les **objections récurrentes** et les points de friction clients.
- Recevoir des **recommandations** automatiques (script, formation, horaires).
- Comparer les **thèmes** abordés entre campagnes ou agents.

## Comment l'utiliser
1. Sélectionnez la **période** d'analyse (les insights se régénèrent).
2. Cliquez sur un insight pour voir les **appels sources** qui l'ont généré.
3. Utilisez le bouton **"Régénérer"** si vous venez de modifier des données.
4. Exportez les insights en PDF pour votre rapport de direction.

## Liens utiles
- [Analyses LLM](/analyses)
- [Analytics](/analytics)`,

    default: `## AI Insights tab
Automatic AI analysis of your call data to surface actionable insights.

## What this tab is for
- Get **AI summaries** of call trends for the period.
- Identify **recurring objections** and customer friction points.
- Receive **automatic recommendations** (script, training, timing).
- Compare **topics** discussed across campaigns or agents.

## How to use it
1. Select the **analysis period** (insights regenerate accordingly).
2. Click an insight to see the **source calls** that generated it.
3. Use the **"Regenerate"** button if you've just updated data.
4. Export insights as PDF for your management report.

## Useful links
- [LLM Analyses](/analyses)
- [Analytics](/analytics)`,
  },

  "dashboard.nhs": {
    title: "NHS S2 Tracking tab",
    title_fr: "Onglet Suivi NHS S2",
    learnMoreHref: docHref("dashboard"),
    fr: `## Suivi NHS S2
Tableau de suivi des patients orientés par le NHS en parcours S2 (soins secondaires).

## À quoi sert cet onglet
- Suivre l'**état d'avancement** de chaque patient dans le parcours S2.
- Identifier les patients **en retard** sur les jalons de prise en charge.
- Enregistrer les **tentatives de contact** et les résultats.
- Générer les **rapports de conformité** NHS.

## Comment l'utiliser
1. Filtrez par **statut** (En attente / En cours / Complété / Alerte).
2. Cliquez sur un patient pour ouvrir son dossier de suivi.
3. Enregistrez chaque **tentative d'appel** avec son résultat.
4. Les patients en **rouge** ont dépassé le délai NHS — traitez-les en priorité.

## Bonnes pratiques
- Vérifiez les délais NHS chaque matin : **18 semaines** pour S2 est le seuil réglementaire.
- Documentez toujours le motif de non-contact pour les rapports d'audit.

## Liens utiles
- [Contacts](/contacts)
- [Rapports](/analytics)`,

    default: `## NHS S2 Tracking tab
Tracking dashboard for patients referred by the NHS on an S2 (secondary care) pathway.

## What this tab is for
- Track each patient's **progress** through the S2 pathway.
- Identify patients **behind schedule** on care milestones.
- Record **contact attempts** and outcomes.
- Generate NHS **compliance reports**.

## How to use it
1. Filter by **status** (Waiting / In progress / Completed / Alert).
2. Click a patient to open their tracking record.
3. Log each **call attempt** with its outcome.
4. Patients highlighted in **red** have exceeded the NHS deadline — handle them first.

## Best practices
- Check NHS deadlines every morning: **18 weeks** for S2 is the regulatory threshold.
- Always document the reason for non-contact for audit reports.

## Useful links
- [Contacts](/contacts)
- [Reports](/analytics)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────────────────────────────────────
  analytics: {
    title: "Analytics",
    title_fr: "Analytiques",
    learnMoreHref: docHref("analytics"),
    fr: `## Analytiques
Explorez vos données d'appels et campagnes en profondeur pour piloter votre activité.

## À quoi sert cette page
- Mesurer les **volumes** par direction (entrant/sortant), agent, file d'attente.
- Suivre la **qualité** : durée, taux de qualification, sentiment, conformité.
- Comparer des **périodes** ou **segments** pour identifier ce qui fonctionne.
- **Exporter** en Excel / BI pour analyses avancées.

## Comment l'utiliser
1. Choisissez la **période** (Aujourd'hui, 7j, 30j ou plage personnalisée).
2. Affinez avec les **filtres** : direction, agent, campagne, file, statut, langue.
3. Survolez les graphiques pour voir les **détails** par point de données.
4. Cliquez sur un **segment** pour ouvrir sa fiche détaillée.
5. Bouton **"Export"** → CSV ou PDF.

## Liens utiles
- [Appels](/calls)
- [Analyse LLM](/analyses)
- [Campagnes](/campaigns)`,

    fr_agent: `## Mes analytiques
Vos statistiques personnelles d'activité.

## À quoi sert cette page
- Voir le nombre d'**appels traités** sur la période.
- Mesurer votre **durée moyenne** et **taux de qualification**.
- Vous **comparer à la moyenne équipe** (sans nommer les autres).

## Liens utiles
- [Mon poste](/desk)
- [Mes contacts](/contacts)`,

    fr_manager: `## Analytiques manager
Vue détaillée pour piloter votre département.

## À quoi sert cette page
- Mesurer la performance de chaque **agent** sur la période.
- Comparer les **campagnes** entre elles (conversion, coût, durée).
- Identifier les **files** qui saturent.

## Liens utiles
- [Analyse LLM](/analyses)
- [Campagnes](/campaigns)`,

    default: `## Analytics
Explore call and campaign data in depth to steer your business.

## What this page is for
- Measure **volume** by direction (inbound / outbound), by agent, by queue.
- Track **quality**: duration, qualification rate, sentiment, compliance.
- Compare **periods** or **segments** to identify what works.
- **Export** your data to Excel / your BI tool for advanced analysis.

## How to use it
1. Choose the **period** (top right) — Today, 7d, 30d, or a custom range.
2. Refine with **filters**: direction, agent, campaign, queue, status, language.
3. Hover over the charts to see **details** per data point.
4. Click a **segment** (e.g. "campaign X") to open its detailed record.
5. **"Export"** button → CSV or PDF.

## Best practices
- To compare "AI agent" vs "human agent", filter in two passes and export each one.
- Cross **sentiment × AI agent** to spot prompts that irritate — often just 1-2 poorly worded sentences.
- Save your **favourite filters** as browser bookmarks (the URL contains the full state).

## Typical use case
The CEO asks "how much does a qualified lead cost in the Summer campaign?" → you filter campaign = Summer, status = qualified → divide total cost / number of leads → you have the answer in 30 seconds.

## Pitfalls to avoid
- **Billed minutes** include ringing time; **talk time** does not. Choose the right KPI for what you're measuring.
- **Sentiment** depends on the LLM model used; a model change can shift figures by a few %.

## Useful links
- [Calls](/calls) to see call-by-call detail
- [LLM Analysis](/analyses) for automated post-call analysis
- [Campaigns](/campaigns)`,

    agent: `## My analytics
Your personal activity statistics.

## What this page is for
- See the number of **calls you've handled** over the period.
- Measure your **average duration** and **qualification rate**.
- **Compare yourself to the team average** (without naming other individuals).
- Identify your strengths (AI → human handoff rate handled, satisfaction).

## How to use it
1. Choose the **period**.
2. Check your **personal KPIs** at the top.
3. The chart below shows your **trend over 30 days**.

## Best practices
- If your **average duration** drifts upward, it's often a sign of fatigue or complex cases — talk to your supervisor.
- A **qualification rate** below the team average doesn't mean you're underperforming: it may reflect a harder mix of calls.

## Pitfalls to avoid
- Don't compare your week to a colleague's: you may not have handled the same types of call.

## Useful links
- [My desk](/desk)
- [My contacts](/contacts)`,

    manager: `## Manager analytics
Detailed view for running your department.

## What this page is for
- Measure the performance of **each agent** (human and AI) over the period.
- Compare **campaigns** against each other (conversion, cost, duration).
- Identify **queues** that are saturating.
- Build your **weekly / monthly reports**.

## How to use it
1. Period + filters (agent, campaign, queue).
2. **"Agents"** tab: leaderboard with quality score, volume, satisfaction.
3. **"Queues"** tab: SLA, abandon rate, average wait time.
4. **"Campaigns"** tab: ROI, cost per lead.
5. **Export** to CSV for Excel or PDF for a report.

## Best practices
- Run a **weekly committee** on the same 2-3 KPIs (volume + quality + cost) to stay comparable.
- When a KPI degrades, drill down **by segment** before drawing conclusions: it's rarely uniform.

## Useful links
- [LLM Analysis](/analyses)
- [Campaigns](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CALLS
  // ──────────────────────────────────────────────────────────────────────
  calls: {
    title: "Calls",
    title_fr: "Appels",
    learnMoreHref: docHref("calls"),
    fr: `## Appels
Liste complète des appels — actifs, terminés, manqués et planifiés.

## À quoi sert cette page
- Trouver un **appel spécifique** par numéro, date, agent ou tag.
- Voir les **appels en cours** avec leur transcription partielle.
- Ouvrir une **fiche détaillée** : transcription complète, audio, sentiment, événements.
- Déclencher manuellement une **analyse LLM** ou un **rappel**.

## Comment l'utiliser
1. Utilisez la **barre de recherche** (numéro, nom, mot-clé dans la transcription).
2. Affinez avec les **filtres** : direction (entrant/sortant), statut, agent, période.
3. Cliquez sur une **ligne d'appel** pour ouvrir la fiche détaillée.
4. Sur la fiche : **lecteur audio**, transcription cliquable (chaque ligne saute à l'audio), boutons "Rappeler", "Requalifier", "Analyser".

## Bonnes pratiques
- Taguez les appels intéressants avec un **label** (ex. "objection", "à coacher") pour les retrouver via le filtre.
- Quand un appel s'est mal passé, lancez une **analyse LLM** : elle identifie le moment exact où ça a dérapé.

## Liens utiles
- [Analyse LLM](/analyses)
- [Contacts](/contacts)`,

    fr_agent: `## Mes appels
Liste de tous vos appels traités, actifs ou en attente de rappel.

## À quoi sert cette page
- Récupérer un **dossier client** : historique complet avec notes et tags.
- Planifier ou voir vos **rappels** du jour.
- Réécouter un **appel** que vous souhaitez clarifier.
- Ajouter ou modifier vos **notes de qualification**.

## Liens utiles
- [Mon poste](/desk)
- [Mes contacts](/contacts)`,

    fr_supervisor: `## Supervision des appels live
Intervenir sur les appels qui se déroulent en ce moment dans votre équipe.

## Comment l'utiliser
1. Cliquez sur un **appel actif** (badge "Live").
2. Choisissez le mode : 🎧 Écoute | 🗣️ Souffler | ⚡ Intervenir.

## Bonnes pratiques
- **Écoutez d'abord, intervenez ensuite** — quelques secondes d'écoute évitent les interruptions inutiles.
- **Souffler** est silencieux pour le client mais l'agent vous entend — laissez-le finir sa phrase.

## Liens utiles
- [Analyse LLM](/analyses)`,

    default: `## Calls
Complete list of calls — active, completed, missed, and scheduled.

## What this page is for
- Find a **specific call** by number, date, agent, or tag.
- View **live calls** with their partial transcription.
- Open a **detailed record**: full transcription, audio, sentiment, events.
- Manually trigger an **LLM analysis** or a **callback**.

## How to use it
1. Use the **search bar** (number, name, keyword in the transcription).
2. Refine with **filters**: direction (in/out), status, agent, period.
3. Click a **call row** to open the detailed record.
4. On the record: **audio player**, clickable transcription (each line jumps to the audio), "Call back", "Requalify", "Analyse" buttons.

## Best practices
- Tag interesting calls with a **label** (e.g. "objection", "to coach") so you can retrieve them via filter.
- When a call went wrong, run an **LLM analysis**: it pinpoints the exact moment things derailed and the associated sentiment.

## Typical use case
A customer calls to claim a refund → you type their number → you find the original call from 2 days ago → you listen to the disputed passage → you decide in 2 minutes.

## Pitfalls to avoid
- The **transcription** may contain errors on proper nouns or numbers — listen to the audio if in doubt.
- Calls **abandoned in queue** appear with a talk time of 0.

## Useful links
- [LLM Analysis](/analyses) for detailed analysis
- [Contacts](/contacts) to view a caller's history`,

    supervisor: `## Live call supervision
Step in on calls happening right now within your team.

## What this page is for
- See **calls in progress** (live) with a rolling transcription.
- **Listen**: discreetly monitor a call to assess quality.
- **Whisper**: speak to your agent without the caller hearing — for live coaching.
- **Barge**: take over and join the conversation as a third party.

## How to use it
1. Click an **active call** (with a "Live" badge).
2. Choose the mode:
   - 🎧 **Listen** = you listen; no one knows you're there.
   - 🗣️ **Whisper** = you speak to the agent only.
   - ⚡ **Barge** = you speak to everyone.
3. You can **switch between modes** without interrupting the call.

## Best practices
- **Listen first, then intervene**. A few seconds of listening avoids unnecessary interruptions.
- **Whisper** is silent for the customer but the agent hears you immediately — let them finish their sentence before you speak.
- **After the call**, log the exact moment you want to debrief in LLM Analysis.

## Typical use case
Junior + unhappy customer → listen for 20 sec → you understand the sticking point → whisper "offer a standard exchange within 48h" → the agent rephrases it, the customer agrees → you tag "resolved via whisper" for the debrief.

## Pitfalls to avoid
- **Barge** is heard by everyone — don't do it unless necessary.
- Avoid long whispers (>5 sec): the agent loses track of the customer.

## Useful links
- [LLM Analysis](/analyses)
- [Supervisor dashboard](/dashboard)`,

    agent: `## My calls
List of all your handled, active, or pending callback calls.

## What this page is for
- Pick up a **customer file**: full history with notes and tags.
- Schedule or view your **callbacks** for the day.
- Re-listen to a **call** you want to clarify.
- Add or edit your **qualification notes**.

## How to use it
1. Filter by **date** or **status** ("to call back", "missed", etc.).
2. Click a call to open the record.
3. On the record: audio, transcription, notes, tags. You can **edit your notes** after the call.
4. **"Call back"** button to re-contact a lead.

## Best practices
- Add a **clear tag** to each call (e.g. "appointment set", "to follow up", "complaint") — it makes sorting much easier.
- Keep notes to **2-3 lines** maximum: no novel needed, the AI already produces a summary.

## Pitfalls to avoid
- **Scheduled callbacks** only trigger if you're 🟢 Available at the scheduled time.

## Useful links
- [My desk](/desk)
- [My contacts](/contacts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // QUEUES
  // ──────────────────────────────────────────────────────────────────────
  queues: {
    title: "Queues",
    title_fr: "Files d'attente",
    learnMoreHref: docHref("queues"),
    fr: `## Files d'attente
Gérez la distribution des appels entrants vers vos agents (humains et IA).

## À quoi sert cette page
- Définir **comment les appels sont routés** : par compétence, langue, priorité.
- Mesurer la **performance de la file** : SLA, taux d'abandon, temps d'attente.
- Configurer l'**overflow** si une file sature.
- Choisir la **musique d'attente** et les annonces.

## Comment l'utiliser
1. Cliquez sur **"+ Nouvelle file"**.
2. Remplissez : **Nom**, **Stratégie** (\`longest_idle\` recommandé, \`round_robin\`, \`broadcast\`), **Attente max**, **Fallback** (messagerie, autre file, agent IA).
3. Onglet **"Membres"** : ajoutez agents humains et agents IA (avec priorité).
4. Onglet **"Routage"** : associez la file à des numéros / flows IVR.

## Bonnes pratiques
- Placez un **agent IA en fallback** : il décroche quand tous les humains sont occupés.
- Pour les VIPs, créez une file dédiée avec **priorité haute** et vos meilleurs agents.

## Pièges à éviter
- \`broadcast\` sonne **tous les agents simultanément** — utile pour petites équipes, problématique au-delà de 5 agents.

## Liens utiles
- [Numéros](/numbers)
- [Flows / IVR](/flows)`,

    default: `## Queues
Manage the distribution of inbound calls to your agents (human and AI).

## What this page is for
- Define **how calls are routed**: by skill, by language, by priority.
- Measure **queue performance**: SLA, abandon rate, wait time.
- Configure **overflow** if a queue saturates.
- Choose **hold music** and announcements.

## How to use it
1. Click **"+ New queue"** to create a queue.
2. Fill in:
   - **Name** (e.g. "Level 1 Support")
   - **Strategy**: \`longest_idle\` (recommended), \`round_robin\`, or \`broadcast\`.
   - **Max wait** (in seconds, default 600).
   - **Fallback**: voicemail, another queue, or an AI agent.
3. **"Members"** tab: add human agents and AI agents (with priority).
4. **"Routing"** tab: associate the queue with one or more numbers / IVR flows.

## Best practices
- Put an **AI agent as fallback**: it picks up when all humans are busy, preventing abandonments.
- For VIPs, create a dedicated queue with **high priority** and your best agents.
- Set up an **abandon alert** (Alerts → Rules) above 5% to react quickly.

## Typical use case
You set up customer support: create a "Support" queue, add your 4 advisers + AI agent "Hugo" as fallback, route the number 04 XX XX XX XX to this queue. During quiet hours, Hugo answers; during peak hours, the humans do.

## Pitfalls to avoid
- \`broadcast\` rings **all agents simultaneously** — useful for small teams, but causes double-picks beyond 5 agents.
- Don't forget to **deactivate** a queue you're no longer using; otherwise it may keep receiving calls due to stale routing.

## Useful links
- [Numbers](/numbers) to configure inbound routing
- [Flows / IVR](/flows) for more complex journeys`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CAMPAIGNS
  // ──────────────────────────────────────────────────────────────────────
  campaigns: {
    title: "Campaigns",
    title_fr: "Campagnes",
    learnMoreHref: docHref("campaigns"),
    fr: `## Campagnes sortantes
Lancez vos campagnes d'appels sortants à grande échelle.

## À quoi sert cette page
- Lancer des **campagnes** de prospection, relance, enquêtes de satisfaction ou recouvrement.
- Suivre la **progression** en live : appels effectués / restants, conversions, abandons.
- **Mettre en pause** ou ajuster la vitesse en temps réel.
- Mesurer le **coût par contact** et le **ROI**.

## Comment l'utiliser
1. Cliquez sur **"+ Nouvelle campagne"**.
2. Remplissez : **nom**, **agent IA assigné**, **numéro appelant**, **cible** (CSV avec colonne \`phone\`), **plage horaire**, **vitesse (CPS)**, **script**.
3. Cliquez sur **▶ Démarrer**. Le worker compose les contacts dans la plage horaire.
4. Suivez les **statistiques live** sur la fiche de campagne.

## Bonnes pratiques
- Commencez à **CPS = 2–3** pour vérifier que tout fonctionne, puis montez.
- Préparez **2 scripts (A/B)** et testez sur 100 leads chacun.
- Activez le **SMS post-appel** pour mesurer la satisfaction.

## Pièges à éviter
- **Ne jamais lancer sans tester le script** : au moins 1 appel test avant ▶.
- Vérifiez la **plage horaire et le fuseau** : un dimanche à 8h peut ruiner votre réputation.
- Respectez le **RGPD, l'opt-out et la liste DNC**.

## Liens utiles
- [Agents IA](/agents)
- [Scripts](/scripts)
- [Contacts](/contacts)
- [Santé des numéros](/numbers/health)`,

    fr_agent: `## Mes campagnes
Liste des campagnes auxquelles vous participez (en tant qu'agent humain pour les transferts depuis l'IA).

## À quoi sert cette page
- Voir votre **quota journalier** par campagne.
- Récupérer les **rappels planifiés** (leads que l'IA vous a transférés).
- Relire le **script** et le **prompt de campagne**.

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)`,

    fr_manager: `## Campagnes (manager)
Gestion des campagnes en mode lecture / pause.

## À quoi sert cette page
- Suivre la **performance** des campagnes en cours et terminées.
- **Mettre en pause** une campagne qui déraille.
- Décider de **scaler** une campagne qui performe.

## Liens utiles
- [Analytics](/analytics)
- [Scripts](/scripts)`,

    default: `## Outbound campaigns
Run your outbound call campaigns at scale.

## What this page is for
- Launch **campaigns** for prospecting, follow-up, satisfaction surveys, or debt collection.
- Track **progress** live: calls made / remaining, conversions, abandonments.
- **Pause** or adjust speed in real time.
- Measure **cost per contact** and **ROI**.

## How to use it
1. Click **"+ New campaign"**.
2. Fill in:
   - **Name** (e.g. "June follow-up")
   - **Assigned AI agent**
   - **Caller number** (Twilio)
   - **Target**: upload a CSV (mandatory column: \`phone\`)
   - **Time window**: e.g. 9am–7pm, Monday–Friday
   - **Speed (CPS)**: number of simultaneous calls
   - **Script**: campaign-specific prompt (overrides agent)
3. Click **▶ Start**. The worker dials contacts within the time window.
4. Follow **live stats** on the campaign record.

## Best practices
- Start at **CPS = 2-3** to verify everything is working, then scale up.
- Prepare **2 scripts** (A/B) and run them in parallel on 100 leads each; keep the better one.
- Enable the **post-call SMS** to measure satisfaction.
- Set up a **human transfer** for strong-interest cases (commercial gesture to validate).

## Typical use case
500 leads from a trade show → you create "Oct Show Follow-up" → AI agent "Lisa", script "qualify training interest" → window 9am-12pm / 2pm-5pm over 3 days → you monitor conversion live → 78 appointments booked, ROI ×6.

## Pitfalls to avoid
- **Never launch without testing the script**: at least 1 test call before ▶.
- Check the **time window and timezone**: a Sunday at 8am can ruin your reputation.
- Comply with **legal requirements** (GDPR, opt-out, DNC list).

## Useful links
- [AI Agents](/agents) to configure the agent
- [Scripts](/scripts) for your templates
- [Contacts](/contacts) to prepare your target list
- [Numbers (health)](/numbers/health) to check your outbound numbers`,

    agent: `## My campaigns
List of campaigns you're participating in (as a human agent for handoffs from the AI).

## What this page is for
- See your **daily quota** per campaign.
- Pick up **scheduled callbacks** (leads the AI transferred to you but who requested a callback).
- Review the **script** and **campaign prompt** to stay aligned.

## How to use it
1. Click a campaign to see its **record**: script, leads assigned to you, performance.
2. Your **callbacks** appear at the top with their scheduled time.

## Best practices
- Before a callback, **re-read the notes** from the previous AI call (visible on the contact record).
- If the customer asks "who called me before?", be transparent: "That was our virtual assistant who collected some information to save time."

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)`,

    manager: `## Campaigns (manager)
Campaign management in read / pause mode.

## What this page is for
- Track the **performance** of ongoing and completed campaigns.
- **Pause** a campaign that is going off the rails.
- Decide on **scaling** a campaign that's performing well.

## How to use it
1. Sort by **conversion** or **cost per lead** to identify top performers.
2. To pause: open the campaign → **⏸** button.
3. To scale: increase the speed (CPS) or ask the admin to add more leads.

## Best practices
- Cut **underperformers** quickly (conversion < 5% of benchmark).
- Regularly share **top scripts** with other campaigns.

## Useful links
- [Analytics](/analytics)
- [Scripts](/scripts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AGENTS IA
  // ──────────────────────────────────────────────────────────────────────
  agents: {
    title: "AI Agents",
    title_fr: "Agents IA",
    learnMoreHref: docHref("agents"),
    fr: `## Agents IA
Vos assistants conversationnels — chacun avec sa voix, son prompt, ses connaissances et ses outils.

## À quoi sert cette page
- Lister tous les **agents IA** de l'organisation.
- Créer un **nouvel agent** depuis un template ou de zéro.
- **Dupliquer** un agent existant pour repartir d'une base éprouvée.
- Suivre les **performances** par agent (volume, durée, qualité).

## Comment l'utiliser
1. Cliquez sur **"+ Nouvel agent"**.
2. Choisissez un **template** ou partez de zéro.
3. Remplissez **nom**, **langue**, **voix**, **modèle LLM**, **prompt système**, **phrase d'accueil**.
4. Optionnel : activez le **RAG** (documents) et les **outils n8n**.
5. **Testez** : bouton "Appel test" (le système vous appelle pour un échange live).
6. **Publiez** : l'agent devient disponible pour les flows, files et campagnes.

## Bonnes pratiques
- Partez d'un **template** : 80% du travail est déjà fait.
- Un bon **prompt** = 2-3 paragraphes max, des exemples, des règles "ne pas faire".
- **Testez en conditions réelles** avant d'assigner à un numéro de production.

## Liens utiles
- [Voice Studio](/voices)
- [Documents (RAG)](/documents)
- [Workflows n8n](/workflows)`,

    default: `## AI Agents
Your conversational assistants — each with its own voice, prompt, knowledge, and tools.

## What this page is for
- List all the organisation's **AI agents**.
- Create a **new agent** from a template or from scratch.
- **Duplicate** an existing agent to start from a proven base.
- Track **performance** per agent (volume, duration, quality).

## How to use it
1. Click **"+ New agent"**.
2. Choose a **template** ("Hotel concierge", "B2B switchboard", etc.) or start from scratch.
3. Fill in **name**, **language**, **voice**, **LLM model**, **system prompt**, **greeting**.
4. Optional: enable **RAG** (documents) and **n8n tools**.
5. **Test**: "Test call" button (the system calls you for a live exchange).
6. **Publish**: the agent becomes available for flows, queues, and campaigns.

## Best practices
- Start with a **template**: 80% of the work is already done.
- A good **prompt** = 2-3 paragraphs max, examples, "do not" rules.
- **Test in real conditions** before assigning to a production number.

## Typical use case
You want to automate the reception of a medical practice → template "Healthcare switchboard" → you customise the greeting and add RAG on the patient FAQ → 30 minutes later, the agent "Capucine" is live.

## Pitfalls to avoid
- **Don't** put precise figures (prices, opening hours) in the prompt: use RAG. Otherwise, every change requires editing the prompt.
- Avoid overly expressive voices for professional use: they overact.

## Useful links
- [Voice Studio](/voices) for voices
- [Documents (RAG)](/documents) for the knowledge base
- [n8n Workflows](/workflows) for tools`,
  },

  "agents.detail": {
    title: "AI agent profile",
    title_fr: "Profil agent IA",
    learnMoreHref: docHref("agents.detail"),
    fr: `## Configuration de l'agent IA
Tous les contrôles pour façonner précisément le comportement de votre agent.

## À quoi sert cette page
- Définir la **personnalité** et la **mission** de l'agent (prompt système).
- Choisir la **voix** (TTS) — preset ou voix clonée.
- Paramétrer le **LLM** (fournisseur, modèle, température).
- Activer le **RAG** : documents que l'agent peut consulter à la volée.
- Configurer les **outils** : workflows n8n / fonctions déclenchables par l'agent.
- Personnaliser la **phrase d'accueil**.

## Comment l'utiliser
1. **Prompt système** : décrivez QUI est l'agent, sa MISSION, son TON, ses LIMITES.
2. **Voix** : choisissez dans le catalogue. ▶ pour prévisualiser.
3. **LLM** : \`deepseek-v4-flash\` par défaut (rapide + ~3× moins cher). \`deepseek-v4-pro\` pour les tâches complexes.
4. **RAG** : cochez les documents à exposer.
5. **Outils** : ajoutez les workflows n8n autorisés.
6. **Phrase d'accueil** : courte (5–10 mots), naturelle.
7. **Tester** : bouton "Appel test" pour valider avant publication.

## Bonnes pratiques
- **Prompt** : structurez en 3 blocs (identité / mission / règles). Donnez 1–2 exemples concrets.
- **Accueil** : n'annoncez pas "Je suis un assistant virtuel" — préférez "Bonjour, c'est Sophie de [marque], comment puis-je vous aider ?".
- **Température** : 0.3–0.5 pour des réponses prévisibles, 0.7+ pour une conversation chaleureuse.

## Liens utiles
- [Voice Studio](/voices)
- [Documents (RAG)](/documents)
- [Workflows n8n](/workflows)`,

    default: `## AI agent configuration
All the controls to precisely shape your agent's behaviour.

## What this page is for
- Define the agent's **personality** and **mission** (system prompt).
- Choose the **voice** (TTS) — preset or cloned voice.
- Set the **LLM** (provider, model, temperature).
- Enable **RAG**: documents the agent can consult on the fly.
- Configure **tools**: n8n workflows / functions the agent can trigger.
- Customise the **greeting** (opening phrase).

## How to use it
1. **System prompt**: describe WHO the agent is, its MISSION, its TONE, its LIMITS (what it doesn't do).
2. **Voice**: choose from the catalogue. ▶ button for preview.
3. **LLM**: \`deepseek-v4-flash\` is the default (fast + ~3× cheaper than the pro tier). \`deepseek-v4-pro\` or \`deepseek-reasoner\` for complex tasks.
4. **RAG**: tick the documents to expose. The agent will retrieve before each long answer.
5. **Tools**: add the authorised n8n workflows (transfer_human, book_appointment, etc.).
6. **Greeting**: opening phrase. Short (5-10 words) works better than long.
7. **Test**: "Test call" button to validate before publishing.

## Best practices
- **Prompt**: structure in 3 blocks (identity / mission / rules). Give 1-2 concrete examples. Specify the tone ("natural, never robotic").
- **Greeting**: don't say "I am a virtual assistant" — prefer "Hi, this is Sophie from [brand], how can I help you?".
- **Temperature**: 0.3-0.5 for predictable answers, 0.7+ for warm conversation.
- **RAG**: only include documents relevant to THIS role, otherwise the agent dilutes its answers.

## Typical use case
"Hotel concierge" agent:
1. Prompt: "You are Sophie, concierge at Hôtel des Pins. You answer questions about hours/restaurant/rooms, take messages, and transfer to the front desk for sensitive requests."
2. RAG: rates PDF, restaurant hours PDF, patient FAQ.
3. Tools: \`transfer_human\`, \`take_message\`, \`send_sms_confirmation\`.
4. Greeting: "Hello, this is Sophie from Hôtel des Pins, how can I help you!"

## Pitfalls to avoid
- **Don't put prices in the prompt**: they'll go stale. Use RAG.
- Too many tools kill the tools: 3-5 max, otherwise the agent hesitates.
- Don't use a **cloned voice of a person without their consent** (GDPR).

## Useful links
- [Voice Studio](/voices)
- [Documents (RAG)](/documents)
- [n8n Workflows](/workflows)
- [AI Teams](/teams) for agent swarms`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // VOICES
  // ──────────────────────────────────────────────────────────────────────
  voices: {
    title: "Voice Studio",
    title_fr: "Voice Studio",
    learnMoreHref: docHref("voices"),
    fr: `## Voice Studio
Créez, clonez et gérez vos voix synthétiques (TTS).

## À quoi sert cette page
- Parcourir la **bibliothèque** : voix natives du fournisseur + vos voix clonées.
- **Cloner une voix** depuis un échantillon audio (10 sec à 5 min).
- **Prévisualiser** chaque voix en générant un extrait test.
- Voir le **statut** de chaque voix (active, erreur, quota dépassé).

## Comment l'utiliser
1. **Bibliothèque** : parcourez les voix préinstallées. ▶ pour prévisualiser.
2. **+ Cloner une voix** : nom → upload MP3/WAV (mono, 10 sec à 5 min, qualité nette) → "Cloner" → la voix est prête en 10–30 s.
3. **Test** : ▶ à côté de la voix → synthèse d'une phrase test.
4. **Assignation** : depuis Agents IA → fiche agent → champ "Voix".

## Bonnes pratiques
- L'audio source doit être **propre** : pas de musique, pas d'écho, une seule personne.
- 1–2 minutes d'audio suffisent — au-delà, les gains sont marginaux.
- **Testez sur plusieurs phrases** (courte, longue, avec chiffres) avant de passer en production.

## Pièges à éviter
- **Obtenez toujours un consentement écrit** pour le clonage de voix (RGPD).
- Un **clone de mauvaise qualité** (audio médiocre) produit une voix robotique.

## Liens utiles
- [Agents IA](/agents)`,

    default: `## Voice Studio
Create, clone, and manage your synthetic voices (TTS).

## What this page is for
- Browse the **library**: provider's native voices + your cloned voices.
- **Clone a voice** from an audio sample (10 sec to 5 min).
- **Preview** each voice by generating a test sample.
- View the **status** of each voice (active, error, quota exceeded).

## How to use it
1. **Library**: browse the pre-installed voices. ▶ button for preview.
2. **+ Clone a voice**:
   - Give it a **name** (e.g. "Sophie's voice")
   - Upload an **MP3/WAV** (mono, 10 sec to 5 min, clear quality)
   - Click **"Clone"**
   - After 10-30 s, the voice appears with a "Ready" status
3. **Test**: ▶ next to the voice → the system synthesises a test sentence.
4. **Assignment**: from AI Agents → agent record → "Voice" field.

## Best practices
- The source audio must be **clean**: no music, no echo, one person only.
- 1-2 minutes of audio is enough for a good clone — beyond that, gains are marginal.
- **Test on several sentences** (short, long, with numbers, with punctuation) before going live.

## Typical use case
You want to personalise hotel reception → you ask a staff member (with written consent) to read a short 1-min text → you clone it → you assign it to your AI agent.

## Pitfalls to avoid
- **Always obtain written consent** from the person whose voice you're cloning (GDPR).
- A **low-quality clone** (poor audio) will produce a robotic voice.
- Some languages work better than others — test under real conditions.

## Diagnostic
If a voice goes into error:
1. Open **Voices → Diagnostic** to see the error code (missing MiniMax key, quota exceeded, etc.).
2. Re-clone if the source audio was poor.

## Useful links
- [AI Agents](/agents) to assign voices`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // FLOWS / IVR
  // ──────────────────────────────────────────────────────────────────────
  flows: {
    title: "Flow Builder IVR",
    title_fr: "Flow Builder IVR",
    learnMoreHref: docHref("flows"),
    fr: `## Flow Builder
Concevez visuellement vos serveurs vocaux interactifs (IVR) par glisser-déposer.

## À quoi sert cette page
- Créer des **parcours d'appel structurés** (menus Appuyez 1/2/3, capture DTMF…).
- Ajouter des **conditions** (heure, langue détectée, variable CRM).
- Appeler des **API externes** en cours de parcours.
- Transférer vers un **agent IA**, une **file** ou un numéro externe.

## Comment l'utiliser
1. **+ Nouveau flow** → canvas vide.
2. Glissez des **nœuds** depuis la palette : Start, Say, Listen, Choice, API Call, Transfer, Hangup.
3. **Connectez** les nœuds en tirant depuis leurs sorties.
4. **Variables** : tout ce que vous capturez est utilisable dans les nœuds suivants (\`{{choix_user}}\`).
5. **Testez** dans le simulateur intégré avant publication.
6. **Assignez** à un numéro : Numéros → fiche numéro → Routage → Flow.

## Bonnes pratiques
- Commencez **simple** : Say + Listen + Choice + 2–3 branches est souvent suffisant.
- Préférez les **agents IA en mode libre** pour les cas conversationnels.
- Ajoutez toujours une **branche de fallback** ("Désolé, je n'ai pas compris, je vous transfère").

## Pièges à éviter
- **Pas plus de 3 niveaux de menus** : les clients raccrochent.
- Les données sensibles (CB) ne doivent **jamais être journalisées** — désactivez la transcription sur ces nœuds.

## Liens utiles
- [Agents IA](/agents)
- [Files d'attente](/queues)
- [Numéros](/numbers)`,

    default: `## Flow Builder
Visually design your interactive voice response (IVR) systems with drag-and-drop.

## What this page is for
- Create **structured call journeys** (press 1 / 2 / 3 menus, DTMF capture, etc.).
- Add **conditions** (time of day, detected language, CRM variable).
- Call **external APIs** mid-journey.
- Transfer to an **AI agent**, a **queue**, or an external number.

## How to use it
1. **+ New flow** → you land on an empty canvas.
2. Drag **nodes** from the palette:
   - **Start**: flow entry point.
   - **Say**: the agent speaks a phrase.
   - **Listen**: captures the customer's voice (with timeout).
   - **Choice**: branches based on what they said (NLU).
   - **API Call**: calls an endpoint (n8n, your backend).
   - **Transfer**: to a human or another queue.
   - **Hangup** / **Voicemail**.
3. **Connect** nodes by dragging from their outputs.
4. **Variables**: everything you capture is usable in subsequent nodes (\`{{user_choice}}\`).
5. **Test** in the built-in simulator before publishing.
6. **Assign** to a number from Numbers → number record → Routing → Flow.

## Best practices
- Start **simple**: a Say + a Listen + a Choice + 2-3 branches is often enough.
- Prefer **AI agents in free mode** for conversational cases — keep IVR for truly structured scenarios.
- Always add a **fallback branch** ("Sorry, I didn't catch that, let me transfer you to an adviser").

## Typical use case
"Press 1 for support, 2 for sales, 3 for billing" → Choice → 3 branches each leading to a specialised AI agent.

## Pitfalls to avoid
- **Don't chain more than 3 menu levels**: customers hang up.
- Sensitive variables (bank card details) must never be logged — disable transcription on those nodes.

## Useful links
- [AI Agents](/agents)
- [Queues](/queues)
- [Numbers](/numbers)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // WORKFLOWS N8N
  // ──────────────────────────────────────────────────────────────────────
  workflows: {
    title: "Workflows n8n",
    title_fr: "Workflows n8n",
    learnMoreHref: docHref("workflows"),
    fr: `## Workflows d'automatisation
Connectez la plateforme à vos outils (CRM, Slack, email, calendrier…) via n8n.

## À quoi sert cette page
- Parcourir les **templates prêts à l'emploi** (sync HubSpot, notification Slack, email de confirmation…).
- **Éditer** un workflow dans l'éditeur n8n intégré.
- Définir des **déclencheurs** : appel terminé, lead qualifié, escalade, sentiment négatif.
- Configurer les **outils** que vos agents IA peuvent appeler en live.

## Comment l'utiliser
1. **+ Nouveau workflow** → choisissez un template ou partez de zéro.
2. L'**éditeur n8n** s'ouvre en page.
3. Définissez votre **déclencheur** (webhook Axon, cron, événement).
4. Ajoutez des **étapes** : requête HTTP, Salesforce, Slack, etc.
5. **Activez** le workflow.
6. Pour qu'un agent IA puisse l'appeler : fiche agent → Outils → cochez le workflow.

## Bonnes pratiques
- **Versionnez** vos workflows critiques (export JSON vers git).
- **Testez** chaque workflow en isolation avant de l'exposer à un agent IA.
- Limitez les **effets de bord** : un appel doit pouvoir échouer sans corrompre votre CRM.

## Pièges à éviter
- **Ne codez pas les credentials** dans le workflow — utilisez les credentials n8n.
- Évitez les **workflows trop longs** : >30 sec et l'agent IA attendra, ce que le client remarquera.

## Liens utiles
- [Agents IA](/agents)
- [Documents (RAG)](/documents)`,

    default: `## Automation workflows
Connect the platform to your tools (CRM, Slack, email, calendar…) via n8n.

## What this page is for
- Browse **ready-to-use templates** (HubSpot sync, Slack notification, confirmation email…).
- **Edit** a workflow in the embedded n8n editor.
- Define **triggers**: call ended, lead qualified, escalation, negative sentiment.
- Configure the **tools** your AI agents can call live.

## How to use it
1. **+ New workflow** → choose a template or start empty.
2. The **n8n editor** opens in-page.
3. Define your **trigger** (webhook from Axon, cron, event).
4. Add **steps**: HTTP request, Salesforce, Slack, etc.
5. **Activate** the workflow.
6. For an AI agent to call it live, go to its record → Tools → tick the workflow.

## Best practices
- **Version** your critical workflows (export JSON to git).
- **Test** each workflow in isolation before exposing it to an AI agent.
- Limit the **side effects** of agent tools: a call should be able to fail without corrupting your CRM.

## Typical use case
"Qualified 'hot' call" → trigger on \`call.qualified\` event → Salesforce deal creation + Slack #sales notification + recap email to the assigned salesperson.

## Pitfalls to avoid
- **Don't hard-code credentials** in the workflow — use n8n credentials.
- Avoid **overly long** workflows: > 30 sec and the AI agent will wait, which the customer will notice.

## Useful links
- [AI Agents](/agents) to expose workflows as tools
- [Documents (RAG)](/documents) if you also want to expose documentation`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DOCUMENTS RAG
  // ──────────────────────────────────────────────────────────────────────
  documents: {
    title: "Documents (RAG)",
    title_fr: "Documents (RAG)",
    learnMoreHref: docHref("documents"),
    fr: `## Base documentaire RAG
Donnez à vos agents IA une connaissance métier — sans hallucination.

## À quoi sert cette page
- **Télécharger** vos documents (PDF, DOCX, TXT, MD).
- **Indexer** automatiquement (chunking + embeddings + pgvector).
- **Tagger** par catégorie, langue, agent cible.
- **Tester** la récupération exactement comme votre agent le fait.

## Comment l'utiliser
1. **+ Ajouter un document** → glissez votre fichier ou collez du texte.
2. Choisissez les **tags** (ex. "tarifs", "FAQ", "produit:hotel").
3. Cliquez sur **"Indexer"** → extraction + embeddings en arrière-plan (10 sec à 2 min).
4. Une fois "Indexé", le document apparaît avec son nombre de chunks.
5. **Test** : tapez une question dans "Test de récupération" → voyez les chunks retournés.
6. **Assignez** à un agent : fiche agent → RAG → cochez les documents.

## Bonnes pratiques
- **Découpez** vos documents par sujet : un doc "Tarifs" + un doc "Horaires" + un doc "FAQ" fonctionne mieux qu'un méga-doc.
- **Mettez à jour** régulièrement : un agent qui répond avec des tarifs obsolètes est pire qu'un agent qui dit "je vérifie".
- Préférez le **markdown structuré** (titres clairs) aux PDFs non balisés.

## Pièges à éviter
- **Ne jamais mettre de données clients** dans le RAG (RGPD).
- Les **PDFs scannés (images)** ne peuvent pas être extraits sans OCR — préférez un export texte.

## Liens utiles
- [Agents IA](/agents)
- [Workflows n8n](/workflows)`,

    default: `## RAG document base
Give your AI agents domain knowledge — without hallucination.

## What this page is for
- **Upload** your documents (PDF, DOCX, TXT, MD).
- **Index** automatically (chunking + embeddings + pgvector).
- **Tag** by category, language, target agent.
- **Test** retrieval exactly as your agent does it.

## How to use it
1. **+ Add a document** → drag your file or paste text.
2. Choose the **tags** (e.g. "pricing", "FAQ", "product:hotel").
3. Click **"Index"** → extraction + embeddings happen in the background (10 sec to 2 min).
4. Once "Indexed", the document appears with its chunk count.
5. **Test**: type a question in the "Test retrieval" field → see the chunks returned.
6. **Assign** to an agent: in its record → RAG → tick the documents.

## Best practices
- **Split** your documents by topic: a "Pricing" doc + a "Hours" doc + an "FAQ" doc will work better than a 200-page megadoc.
- **Update** regularly: an agent answering with outdated pricing is worse than one that says "let me check".
- Prefer **structured markdown** (clear headings) over untagged PDFs.

## Typical use case
You upload your product catalogue + FAQ → your AI agents answer accurately and cite their sources without inventing anything.

## Pitfalls to avoid
- **Never put personally identifiable customer data** in RAG (GDPR).
- **Scanned PDFs (images)** cannot be extracted without OCR — prefer a text export.
- Too many documents = less precise retrieval: target with tags.

## Useful links
- [AI Agents](/agents) to assign RAG
- [n8n Workflows](/workflows) for more dynamic data`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // TEAMS (SWARM)
  // ──────────────────────────────────────────────────────────────────────
  teams: {
    title: "Multi-agent teams",
    title_fr: "Équipes multi-agents",
    learnMoreHref: docHref("teams"),
    fr: `## Équipes d'agents IA (swarm)
Orchestrez plusieurs agents IA collaborant sur le même appel.

## À quoi sert cette page
- Construire des **équipes spécialisées** (accueil, technique, commercial, paiement…).
- Définir un **agent orchestrateur** (superviseur) qui dispatche selon l'intention.
- Configurer les **règles de transfert** entre agents.
- Maintenir un **contexte partagé** : la conversation reste cohérente même après plusieurs transferts.

## Comment l'utiliser
1. **+ Nouvelle équipe** → donnez-lui un nom.
2. **Ajoutez des membres** : sélectionnez les agents IA existants.
3. Définissez l'**orchestrateur** : l'agent qui reçoit en premier et route.
4. **Règles de transfert** : ex. "si intention = support technique → passer à 'Hugo Tech'".
5. **Variables partagées** : ce que chaque agent peut lire (nom client, historique).
6. **Testez** : appel test vers l'équipe complète.

## Bonnes pratiques
- Spécialisez chaque agent — n'en faites pas des couteaux suisses.
- Le **transfert doit être invisible** pour le client.
- Limitez à **3–5 agents** par équipe.

## Liens utiles
- [Agents IA](/agents)
- [Workflows n8n](/workflows)`,

    default: `## AI agent swarm
Orchestrate multiple AI agents collaborating on the same call.

## What this page is for
- Build **specialised teams** (reception, technical, sales, payment…).
- Define an **orchestrator agent** (supervisor) that dispatches based on intent.
- Configure **handoff rules** between agents.
- Maintain **shared context**: the conversation stays coherent even after multiple handoffs.

## How to use it
1. **+ New team** → give it a name (e.g. "Support Squad").
2. **Add members**: select existing AI agents.
3. Define the **orchestrator**: an agent that receives first and routes.
4. **Handoff rules**: e.g. "if intent = technical support → pass to 'Hugo Tech'".
5. **Shared variables**: what every agent can read (customer name, history).
6. **Test**: test call to the full team.

## Best practices
- Specialise each agent — don't make them Swiss Army knives.
- The **handoff must be invisible** to the customer: "one moment, I'll connect you with my colleague Hugo who'll handle that".
- Limit to **3-5 agents** per team: beyond that, it becomes unmanageable.

## Typical use case
Support squad for a retailer:
- **Reception**: receives the call, qualifies the intent.
- **Tech**: takes over for product issues.
- **Support**: handles returns / refunds.
- **Sales**: deals with upsell opportunities.
Reception dispatches, the others take over, and a human can step in at any time.

## Pitfalls to avoid
- Don't put two agents with the **same role**: handoff conflicts.
- Too many felt handoffs irritates customers — limit to 1-2 per call maximum.

## Useful links
- [AI Agents](/agents)
- [n8n Workflows](/workflows) for shared tools`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SCRIPTS
  // ──────────────────────────────────────────────────────────────────────
  scripts: {
    title: "Campaign scripts",
    title_fr: "Scripts de campagne",
    learnMoreHref: docHref("scripts"),
    fr: `## Scripts de campagne
Bibliothèque de scripts conversationnels réutilisables pour vos campagnes.

## À quoi sert cette page
- Centraliser vos **scripts** (accroche, qualification, pitch, objections, closing).
- Gérer les **variables** \`{{prenom}}\`, \`{{société}}\` interpolées à l'exécution.
- Versionner et **A/B tester** vos scripts.
- Réutiliser le même script sur plusieurs campagnes.

## Comment l'utiliser
1. **+ Nouveau script** → nommez-le (ex. "Prospection SaaS B2B").
2. Rédigez les **sections** : accroche / qualification / pitch / objections / closing.
3. Insérez des **variables** entre \`{{ }}\` — remplacées par les données CSV du contact.
4. **Versionnez** : chaque modification crée une nouvelle version avec historique.
5. **Assignez** à une campagne dans la fiche de campagne.

## Bonnes pratiques
- **Court bat long** : un agent IA improvise bien à partir de 3–5 bullets claires.
- Préférez les **bullets** à la prose continue — l'agent suit mieux.
- **A/B testez** : 2 versions, 100 leads chacune, comparez la conversion.

## Pièges à éviter
- **Ne mettez pas** d'informations sensibles (tarifs détaillés) dans le script s'ils changent — utilisez le RAG.

## Liens utiles
- [Campagnes](/campaigns)
- [Agents IA](/agents)`,

    default: `## Campaign scripts
Reusable conversational script library for your campaigns.

## What this page is for
- Centralise your **scripts** (opening, qualification, pitch, objections, closing).
- Manage **variables** \`{{firstname}}\`, \`{{company}}\` interpolated at runtime.
- Version and **A/B test** your scripts.
- Reuse the same script across multiple campaigns.

## How to use it
1. **+ New script** → name it (e.g. "B2B SaaS Prospecting").
2. Write the **sections**:
   - Opening (5-10 sec)
   - Qualification (3-5 questions)
   - Pitch (30 sec max)
   - Objections (prepare the 3-5 most common)
   - Closing (appointment or CTA)
3. Insert **variables** between \`{{ }}\` — they'll be replaced by the contact's CSV data.
4. **Version**: each change creates a new version; you keep the history.
5. **Assign** to a campaign in the campaign record.

## Best practices
- **Short beats long**: an AI agent improvises well from 3-5 clear bullet points.
- Prefer **bullets** over continuous prose — the agent follows better.
- **A/B test**: 2 versions, 100 leads each, compare conversion.

## Typical use case
"Warm lead follow-up" script: warm opening + 2 qualification questions + offer to send documentation or book an appointment → conversion measured over 7 days.

## Pitfalls to avoid
- **Don't** put sensitive information (detailed pricing) in the script if it changes — use RAG.
- **Don't read** the script word for word: let the AI agent improvise around it.

## Useful links
- [Campaigns](/campaigns)
- [AI Agents](/agents)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // CONTACTS
  // ──────────────────────────────────────────────────────────────────────
  contacts: {
    title: "Contacts (CRM)",
    title_fr: "Contacts (CRM)",
    learnMoreHref: docHref("contacts"),
    fr: `## Contacts
Votre CRM intégré — utilisé pour les campagnes et l'historique des appels.

## À quoi sert cette page
- Centraliser tous vos **contacts** (B2B / B2C).
- Voir l'**historique** : appels, notes, tags, qualifications.
- **Importer** via CSV avec mapping automatique.
- Créer des **segments** (tags) pour cibler vos campagnes.

## Comment l'utiliser
1. **+ Nouveau contact** ou **Importer CSV**.
2. Pour l'import : colonne obligatoire : \`phone\`. Optionnel : \`prenom\`, \`nom\`, \`email\`, \`societe\`…
3. Sur une fiche contact : **historique d'appels**, notes, tags, opt-out.
4. **Recherche rapide** par nom / téléphone / email / tag.
5. **Tags** : créez vos segments ("hot lead", "VIP", "ne pas appeler").

## Bonnes pratiques
- **Nettoyez** votre base régulièrement : doublons, numéros invalides.
- Marquez les **opt-outs** clairement (tag "DNC") pour les exclure des campagnes.
- Importez par **lots de 5 000 max** pour maintenir les performances.

## Pièges à éviter
- **RGPD** : assurez-vous d'avoir une base légale pour appeler (consentement, intérêt légitime).
- Un **format téléphone incorrect** (sans indicatif pays) fait échouer la composition — ajoutez \`+33\` etc. avant import.

## Liens utiles
- [Campagnes](/campaigns)
- [Appels](/calls)`,

    default: `## Contacts
Your integrated CRM — used for campaigns and call history.

## What this page is for
- Centralise all your **contacts** (B2B / B2C).
- View **history**: calls, notes, tags, qualifications.
- **Import** via CSV with automatic mapping.
- Create **segments** (tags) to target your campaigns.

## How to use it
1. **+ New contact** or **Import CSV**.
2. For import: mandatory column: \`phone\`. Optional: \`first_name\`, \`last_name\`, \`email\`, \`company\`, etc.
3. On a contact record: **call history**, notes, tags, opt-out.
4. **Quick search** by name / phone / email / tag.
5. **Tags**: create your segments ("hot lead", "VIP", "do-not-call").

## Best practices
- **Clean** your database regularly: duplicates, invalid numbers.
- Mark **opt-outs** clearly (tag "DNC") so they're excluded from campaigns.
- Import in **batches of 5,000 max** to keep things running smoothly.

## Typical use case
After a trade show, you receive 500 leads → CSV import → tag "Oct Show" → you launch a targeted campaign on that tag.

## Pitfalls to avoid
- **GDPR**: ensure you have a legal basis to call (consent, legitimate interest).
- A **bad phone format** (without country code) causes dialling to fail — add \`+44\` etc. before import.

## Useful links
- [Campaigns](/campaigns)
- [Calls](/calls)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // NUMBERS
  // ──────────────────────────────────────────────────────────────────────
  numbers: {
    title: "Numbers",
    title_fr: "Numéros",
    learnMoreHref: docHref("numbers"),
    fr: `## Numéros
Gérez vos numéros de téléphone (entrant et sortant) achetés chez Twilio.

## À quoi sert cette page
- **Acheter** un numéro par pays / région directement depuis l'interface.
- **Router** chaque numéro vers un flow IVR, une file ou un agent IA.
- Configurer le **caller ID** (identité affichée en sortant).
- Vérifier la **conformité** (STIR/SHAKEN, A2P 10DLC pour les USA).

## Comment l'utiliser
1. **Acheter** : sélectionnez pays + type (Local / Mobile / TollFree) → Twilio liste les numéros disponibles → Acheter.
2. **Configurer** : cliquez sur le numéro → onglet "Routage" → choisissez l'agent IA, la file ou le flow.
3. **Webhooks Twilio** : automatisés via le bouton "Auto-config webhooks".
4. **Caller ID** : champ "Identité affichée" — utile pour le sortant.

## Bonnes pratiques
- Pour le **sortant à fort volume**, achetez un **pool de numéros** et activez la rotation.
- Pour l'**entrant critique**, gardez un numéro VIP unique avec une file dédiée.

## Pièges à éviter
- N'oubliez pas de **configurer les webhooks Twilio** sinon les appels arrivent dans le vide.

## Liens utiles
- [Santé des numéros](/numbers/health)
- [Files d'attente](/queues)
- [Flows](/flows)`,

    fr_admin: `## Numéros (admin)
Gestion complète des numéros pour votre organisation.

## Bonnes pratiques
- Ajoutez un **commentaire** sur chaque numéro (usage, campagne associée).
- Renouvelez vos **vérifications STIR/SHAKEN** annuellement.
- Pour >50 appels/jour, créez un **pool de 5–10 numéros** en rotation.

## Liens utiles
- [Santé des numéros](/numbers/health)
- [Connecteurs entrants](/admin/inbound)`,

    default: `## Numbers
Manage your phone numbers (inbound and outbound) purchased from Twilio.

## What this page is for
- **Buy** a number by country / region directly from the interface.
- **Route** each number to an IVR flow, a queue, or an AI agent.
- Configure the **caller ID** (identity shown when calling out).
- Verify **compliance** (STIR/SHAKEN, A2P 10DLC for the US).

## How to use it
1. **Buy**: select country + type (Local / Mobile / TollFree) → Twilio lists available numbers → Buy.
2. **Configure**: click the number → "Routing" tab → choose the AI agent, queue, or flow.
3. **Twilio webhooks**: automated via the "Auto-config webhooks" button (or manually on the Twilio console).
4. **Caller ID**: "Displayed identity" field — useful for outbound.

## Best practices
- For **high-volume outbound**, buy a **pool of numbers** and enable rotation (prevents spam flagging).
- For **critical inbound**, keep a single VIP number with a dedicated queue.
- Check **health** monthly (Numbers → Health).

## Typical use case
You launch a new service in Belgium → you buy a BE Local number + a mobile → you route the local to the support queue, the mobile to the outbound campaign.

## Pitfalls to avoid
- Don't forget to **configure Twilio webhooks** otherwise calls arrive in a void.
- In the **US**, A2P 10DLC is mandatory for SMS — not for voice, but read the guidelines.
- **TollFree** numbers cost more but inspire more confidence for customer service.

## Useful links
- [Number health](/numbers/health)
- [Queues](/queues)
- [Flows](/flows)`,

    admin: `## Numbers (admin)
Complete number management for your organisation.

## What this page is for
- **Buy / port** numbers.
- **Routing** and associated flows.
- **Compliance**: STIR/SHAKEN, A2P 10DLC, caller ID verification.
- Track **monthly costs** per number.

## How to use it
1. **Buy** from Twilio (Buy button), or **Import** a number you already have (porting).
2. **Webhooks**: use auto-config (recommended) to point voice + status at the platform.
3. **Outbound pool**: if > 50 calls/day, create a pool of 5-10 numbers for rotation.
4. **Audit**: open the Costs tab for detailed billing.

## Best practices
- Add a **comment** on each number's purpose (inbound support, outbound follow-up…) — your team will thank you in 6 months.
- Renew your **STIR/SHAKEN** verifications annually.

## Typical use case
You notice an outbound number is flagged "Spam Likely" → you rest it for 30 days → you activate 2 new numbers in the pool.

## Pitfalls to avoid
- **Don't delete** a number assigned to a live flow: confirm first that it's no longer routed.
- **Manual Twilio webhooks** break with every domain renewal — prefer auto-config.

## Useful links
- [Number health](/numbers/health)
- [Inbound connectors](/admin/inbound)
- [Billing](/admin/billing)`,
  },

  "numbers.health": {
    title: "Number health",
    title_fr: "Santé des numéros",
    learnMoreHref: docHref("numbers.health"),
    fr: `## Santé des numéros
Surveillance de la réputation et de la qualité de vos numéros sortants.

## À quoi sert cette page
- Voir le **score spam** attribué à chaque numéro par les opérateurs.
- Suivre le **taux de décrochage** par numéro.
- Gérer la **rotation** : pools de numéros pour répartir la charge.
- Recevoir des **alertes** sur les numéros signalés.

## Comment l'utiliser
1. Le tableau liste vos numéros sortants avec leurs métriques (taux de décrochage, score spam, volume).
2. Cliquez sur un numéro pour voir son **historique 30 jours**.
3. **Mettre au repos** : bouton pour suspendre un numéro 7/14/30 jours.
4. **Rotation** : Numéros → Pools → assignez plusieurs numéros à une campagne.

## Bonnes pratiques
- **En dessous de 30%** de taux de décrochage : mettez le numéro au repos 14 jours.
- **En dessous de 20%** : changez le numéro (le repos ne suffit généralement plus).
- Faites tourner sur des **pools de 5–10** numéros.

## Liens utiles
- [Numéros](/numbers)
- [Campagnes](/campaigns)
- [Alertes](/alerts)`,

    default: `## Number health
Reputation and quality monitoring for your outbound numbers.

## What this page is for
- See the **spam score** assigned to each number by carriers / anti-spam apps.
- Track the **answer rate** per number (key health indicator).
- Manage **rotation**: number pools to spread the load.
- Receive **alerts** on flagged numbers.

## How to use it
1. The table lists your outbound numbers with their metrics (answer rate, spam score, volume).
2. Click a number to view its **30-day history**.
3. **Rest**: button to suspend a number for 7/14/30 days.
4. **Rotation**: Numbers → Pools → assign multiple numbers to a campaign.

## Best practices
- **Below 30%** answer rate: rest the number for 14 days.
- **Below 20%**: change the number (resting rarely helps at this point).
- Vary **patterns** (hours, frequency) to avoid anti-spam algorithms.
- Rotate across **pools of 5-10** numbers.

## Typical use case
You launch a campaign of 5,000 calls → you activate a pool of 8 numbers → the platform distributes the load → none exceeds 100 calls/day → spam score stays green.

## Pitfalls to avoid
- **Don't exceed 200 calls/day/number** without close monitoring.
- A flagged number keeps its bad reputation **for several weeks** even after resting.

## Useful links
- [Numbers](/numbers)
- [Campaigns](/campaigns)
- [Alerts](/alerts) for automatic thresholds`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // DESK / SOFTPHONE
  // ──────────────────────────────────────────────────────────────────────
  desk: {
    title: "My desk (softphone)",
    title_fr: "Mon poste (softphone)",
    learnMoreHref: docHref("desk"),
    fr: `## Softphone
Votre téléphone web intégré pour passer et recevoir des appels.

## À quoi sert cette page
- **Recevoir** les appels assignés (files, transferts de l'IA).
- **Composer** un numéro manuellement.
- **Gérer** mute, attente, transfert, conférence.
- **Prendre des notes** en temps réel, sauvegardées dans la fiche d'appel.

## Comment l'utiliser
1. Vérifiez votre **statut** (🟢 Disponible / 🟡 En pause / 🔴 Indisponible).
2. **Recevoir** : un appel entrant sonne → ✅ Décrocher / ❌ Refuser.
3. **Composer** : pavé numérique ou bouton "Appeler" → tapez ou collez un numéro.
4. **Pendant l'appel** : mute, attente, transfert, conférence, raccrocher.
5. **Notes** : panneau de droite — tapez en temps réel, sauvegarde automatique.

## Bonnes pratiques
- **Autorisez le microphone** dans le navigateur au premier chargement (Chrome/Edge : cadenas → microphone → Autoriser).
- Passez en **🟡 En pause** avant d'aller prendre un café.
- Les notes prises pendant l'appel apparaissent ensuite dans la **fiche contact**.

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)`,

    fr_agent: `## Votre softphone
Votre outil principal pour prendre les appels.

## Comment l'utiliser
1. **Connectez-vous** → vous arrivez sur le poste.
2. Passez en **🟢 Disponible** pour recevoir des appels.
3. Quand un appel arrive : ✅ Décrocher (un résumé IA apparaît si disponible).
4. **Pendant l'appel** : mute / attente / transfert / raccrocher, et prise de notes live.
5. **Après l'appel** : ajoutez un tag → Sauvegarder.

## Bonnes pratiques
- Ayez un **casque branché** avant de passer en Disponible.
- Un **transfert depuis l'IA** = le contexte est déjà résumé → ne rebriefez pas le client.

## Liens utiles
- [Mes appels](/calls)
- [Mes contacts](/contacts)`,

    default: `## Softphone
Your integrated web phone for making and receiving calls.

## What this page is for
- **Receive** assigned calls (queues, transfers from AI).
- **Dial** a number manually.
- **Manage** mute, hold, transfer, conference.
- **Take notes** in real time, saved to the call record.

## How to use it
1. Check your **status** (🟢 Available / 🟡 On break / 🔴 Unavailable).
2. **Receive**: an inbound call rings → ✅ Answer / ❌ Decline.
3. **Dial**: number pad or "Dial" button → type or paste a number.
4. **During the call**: mute, hold, transfer, conf, hang up buttons.
5. **Notes**: right panel — type in real time, auto-saved.

## Best practices
- **Allow the microphone** in the browser at first load (Chrome / Edge: padlock → microphone → Allow).
- Set your status to **🟡 On break** before stepping away for a coffee.
- Notes taken during the call appear afterwards on the **contact record**.

## Typical use case
A call transferred from the AI agent arrives on your softphone → you see an **AI summary** (what was said before) → you answer → you pick up seamlessly for the customer.

## Pitfalls to avoid
- If the microphone is **muted at system level (Windows / Mac)**, the softphone can't override it — check outside the browser.
- Don't **reload** the page during a call: you'll lose it.

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)`,

    agent: `## Your softphone
Your main tool for taking calls.

## What this page is for
- **Receive** calls (queue, handoff from AI, transfer from a colleague).
- **Make** outbound calls (callback, manual prospecting).
- **Transfer** to a colleague, a queue, or an external number.
- **Take notes** saved to the contact record.

## How to use it
1. **Log in** → you land on the desk.
2. Switch to **🟢 Available** to receive calls.
3. When a call comes in: ✅ Answer (an AI summary appears if one exists).
4. **During the call**: mute / hold / transfer / conf / hang up, and live note-taking.
5. **After the call**: add a tag (appointment set / to call back / complaint) → Save.

## Best practices
- Have a **headset plugged in** before going Available.
- Keep your **notes** tidy: your future self (or a colleague) will read them.
- A **handoff from AI** = context is already summarised → don't re-brief the customer.

## Typical use case
The AI handled the reception and qualified a hot lead → handoff → your desk rings → you see "client interested in the pro plan, waiting for a demo" → you book an appointment in 5 min.

## Pitfalls to avoid
- **Don't mute for too long** without warning: the customer thinks they've been abandoned.
- If you **decline** a call, the queue redistributes it but it affects your KPIs.

## Useful links
- [My calls](/calls)
- [My contacts](/contacts)
- [My campaigns](/campaigns)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN
  // ──────────────────────────────────────────────────────────────────────
  admin: {
    title: "Administration",
    title_fr: "Administration",
    learnMoreHref: docHref("admin"),
    fr: `## Administration
Paramètres et opérations de votre organisation.

## À quoi sert cette page
- Inviter / gérer les **membres** et leurs rôles.
- Gérer les **organisations** (multi-tenant, super_admin uniquement).
- Configurer les **connecteurs entrants** (Twilio, SIP, webhooks) et sortants (CRM, n8n).
- Suivre la **facturation** (abonnement, factures, modes de paiement).
- Consulter le **journal d'audit** des actions sensibles.

## Comment l'utiliser
1. Section **Utilisateurs** : invitez des membres (email + rôle), suspendez, changez les rôles.
2. Section **Connecteurs** : ajoutez Twilio, configurez les webhooks.
3. Section **Audit** : cherchez par utilisateur, action, période.
4. Section **Facturation** : visualisez le cycle en cours et l'historique.

## Bonnes pratiques
- Limitez le rôle **admin** à 2–3 personnes maximum.
- Activez la **2FA obligatoire** dans Paramètres → Sécurité.
- Révisez le **journal d'audit** chaque semaine.

## Pièges à éviter
- **Ne jamais** donner le rôle admin à un agent front-office.
- Si un membre **quitte** l'organisation, désactivez son compte immédiatement.

## Liens utiles
- [Connecteurs entrants](/admin/inbound)
- [Facturation](/admin/billing)
- [Paramètres](/settings)`,

    fr_super_admin: `## Administration de la plateforme
Vous voyez et gérez **toutes les organisations** de la plateforme.

## À quoi sert cette page
- **Créer / suspendre** des organisations.
- Définir les **quotas** par tenant.
- Consulter l'**audit global** (tous les orgs).
- Gérer les **templates de plateforme** (agents, flows, scripts) réutilisables.

## Bonnes pratiques
- Définissez une **politique de quotas par défaut** (ex. trial = 100 min, payant = 5 000 min).
- Faites une **revue trimestrielle** des orgs inactifs.

## Liens utiles
- [Organisations](/admin)
- [Copilot](/admin/copilot)
- [Facturation](/admin/billing)`,

    default: `## Administration
Settings and operations for your organisation.

## What this page is for
- Invite / manage **members** and their roles.
- Manage **organisations** (multi-tenant, super_admin only).
- Configure **inbound connectors** (Twilio, SIP, webhooks) and outbound (CRM, n8n).
- Track **billing** (subscription, invoices, payment methods).
- View the **audit log** of sensitive actions.

## How to use it
1. **Users** section: invite members (email + role), suspend, change roles.
2. **Connectors** section: add Twilio, configure webhooks.
3. **Audit** section: search by user, action, period.
4. **Billing** section: view current cycle and history.

## Best practices
- Limit the **admin** role to 2-3 people max; others as manager / supervisor / agent.
- Enable **mandatory 2FA** in Settings → Security.
- Review the **audit log** each week to detect unusual actions.

## Typical use case
You onboard a new manager → Users → Invite → email + role "manager" → they receive their activation link → you assign them to the right teams in the queue.

## Pitfalls to avoid
- **Never give the admin role to a frontline agent**: they'd have access to everything (billing, deletion).
- If a member **leaves** the organisation, deactivate their account immediately (don't delete — keep for the audit trail).

## Useful links
- [Inbound connectors](/admin/inbound)
- [Billing](/admin/billing)
- [Super Admin Copilot](/admin/copilot)
- [Settings](/settings)`,

    super_admin: `## Platform administration
You see and manage **all organisations** on the platform.

## What this page is for
- **Create / suspend** organisations.
- Define **quotas** per tenant (minutes, agents, numbers, storage).
- View the **global audit** (all orgs).
- Manage **platform templates** (AI agents, flows, scripts) reusable by all orgs.

## How to use it
1. **Organisations** → list of all tenants. "+ New org" button.
2. **Quotas**: per org, set limits (minutes/month, number of AI agents, RAG storage GB).
3. **Suspension**: ⋮ → Suspend (the org becomes inaccessible but data is retained).
4. **Org switch**: selector in the top right of the sidebar.

## Best practices
- Set up a **default quota policy** (e.g. trial = 100 min, paid = 5,000 min).
- Do a **quarterly review** of inactive orgs → commercial follow-up or suspension.
- Before **deleting** an org, do a full export (GDPR).

## Typical use case
A prospect signs the contract → you create their org → you set their quotas, invite their owner → in 5 min they have a clean, ready-to-use environment.

## Pitfalls to avoid
- **Never delete** an org without a backup: it's irreversible and the data is lost.
- **Suspension** is immediate for users — warn them beforehand.

## Useful links
- [Organisations](/admin)
- [Copilot](/admin/copilot)
- [Billing](/admin/billing)`,
  },

  "admin.orgs": {
    title: "Organisations",
    title_fr: "Organisations",
    learnMoreHref: docHref("admin.orgs"),
    fr: `## Gestion des organisations
Réservé aux super-admins pour gérer le multi-tenant.

## À quoi sert cette page
- **Lister** toutes les organisations.
- **Créer** un nouveau tenant avec son propriétaire.
- Définir les **quotas** (minutes, agents, numéros, stockage).
- **Suspendre** ou réactiver un org sans le supprimer.
- **Prendre le contrôle** d'un org en support (avec traçabilité).

## Comment l'utiliser
1. **+ Nouvelle organisation** : nom, slug, plan, propriétaire (email → invitation automatique).
2. **Quotas** : par org, ajustez les limites.
3. **Prise de contrôle** : bouton "Se connecter en tant que" — toutes vos actions sont journalisées.
4. **Suspension** : ⋮ → Suspendre (avec raison obligatoire).

## Pièges à éviter
- **Ne prenez pas le contrôle** sans nécessité opérationnelle — c'est journalisé et visible du client.
- **Ne réutilisez pas le slug** d'un org supprimé : conflit potentiel.

## Liens utiles
- [Administration](/admin)
- [Facturation](/admin/billing)`,

    default: `## Organisation management
Reserved for super-admins to manage the multi-tenant setup.

## What this page is for
- **List** all organisations.
- **Create** a new tenant with its owner.
- Define **quotas** (minutes, agents, numbers, storage).
- **Suspend** or reactivate an org without deleting it.
- **Switch** to an org as support (with traceability).

## How to use it
1. **+ New organisation**: name, slug, plan, owner (email → automatic invitation).
2. **Quotas**: per org, adjust the limits.
3. **Switch**: "Log in as" button — all your actions are logged.
4. **Suspension**: ⋮ → Suspend (with mandatory reason).

## Best practices
- Standardise your **plans** (Trial / Pro / Enterprise) with associated quotas.
- Org switching should be **reserved for support** — it's sensitive access.
- Always log the **reason** for a suspension.

## Typical use case
An org exceeds its quotas → you contact them → no response after 7 days → you suspend them with reason "quota exceeded - non-payment" → automatic email sent to the owner.

## Pitfalls to avoid
- **Don't switch** without an operational need — it's logged and visible to the client.
- **Don't reuse the slug of a deleted org**: potential conflict.

## Useful links
- [Admin](/admin)
- [Billing](/admin/billing)`,
  },

  "admin.copilot": {
    title: "AI Copilot",
    title_fr: "Copilot IA",
    learnMoreHref: docHref("admin.copilot"),
    fr: `## Copilot IA
Assistant IA pour configurer et gérer la plateforme en langage naturel.

## À quoi sert cette page
- **Interroger** la plateforme : "Combien d'appels manqués hier ?".
- **Planifier** des actions : "Lance une campagne sur ces 200 contacts demain à 10h".
- **Diagnostiquer** : "Pourquoi le numéro +33 1... a-t-il un mauvais taux de décrochage ?".
- **Générer** des artefacts : scripts, prompts, flows.

## Comment l'utiliser
1. Tapez votre demande dans la **barre de chat** en langage naturel.
2. Le copilot interroge Supabase, n8n, le RAG de la plateforme et répond avec données + recommandations.
3. Pour les **actions** (créer agent, lancer campagne…), il demande une **confirmation** avant d'exécuter.
4. Vous pouvez voir le **plan d'exécution** (appels d'outils) avant de valider.

## Bonnes pratiques
- Soyez **précis** : "Campagne pour ces 200 leads avec agent Lisa, plage 9h–12h" → meilleur résultat.
- Demandez un **diagnostic avant d'agir**.
- Utilisez-le pour rédiger des **premières versions** de prompts / scripts.

## Pièges à éviter
- Vérifiez toujours le **plan d'exécution** avant de valider — le copilot a un accès en écriture.
- Pour les **actions à grande échelle** (>100 contacts), demandez d'abord un **dry run**.

## Liens utiles
- [Workflows n8n](/workflows)
- [Documents (RAG)](/documents)`,

    default: `## AI Copilot
AI assistant for configuring and managing the platform in natural language.

## What this page is for
- **Query** the platform: "how many missed calls yesterday?".
- **Plan** actions: "launch a campaign on these 200 contacts tomorrow at 10am".
- **Diagnose**: "why does the number +44 1... have a poor answer rate?".
- **Generate** artefacts: scripts, prompts, flows.

## How to use it
1. Type your request in the **chat bar** in natural language.
2. The copilot queries **Supabase**, **n8n**, the **platform RAG** and responds with **data + recommendations**.
3. If it proposes an action (create agent, launch campaign…), it asks for **confirmation** before executing.
4. You can see the **execution plan** (tool calls) before validating.

## Best practices
- Be **specific**: "campaign for these 200 leads with agent Lisa, window 9am-12pm" → better result than "run a campaign".
- Ask it to **diagnose before acting** ("why is this campaign converting poorly?").
- Use it to **generate a first draft** of a prompt / script, then refine by hand.

## Typical use case
"Generate a prospecting script for the real estate sector, B2C, leading to an appointment booking" → the copilot produces a structured script → you keep 80%, you adapt 20%.

## Pitfalls to avoid
- Always check the **execution plan** before validating an action — the copilot has write access.
- For **large-scale** actions (>100 contacts), first ask for a **dry run** ("simulate without sending").

## Useful links
- [n8n Workflows](/workflows) (the copilot uses them)
- [Documents (RAG)](/documents)`,
  },

  "admin.inbound": {
    title: "Inbound connectors",
    title_fr: "Connecteurs entrants",
    learnMoreHref: docHref("admin.inbound"),
    fr: `## Connecteurs entrants
Sources d'appels et de leads que la plateforme ingère.

## À quoi sert cette page
- Connecter des **trunks SIP** (interconnexions opérateur).
- Configurer les **webhooks Twilio** (automatique ou manuel).
- Brancher des **webhooks externes** (Meta Ads, Google Ads, votre site web).
- Configurer l'**email-to-call** : un email entrant déclenche un rappel.

## Comment l'utiliser
1. **+ Nouveau connecteur** → choisissez le type (Twilio, SIP, Webhook, Email).
2. Remplissez les **credentials** (chiffrés côté plateforme).
3. **Testez** la connexion : bouton "Tester" → vous voyez l'événement arriver.
4. **Mappez** : quel agent / file / flow reçoit les appels de ce connecteur.

## Bonnes pratiques
- Utilisez l'**auto-config Twilio** plutôt que de configurer les webhooks manuellement.
- Préférez **HTTPS + signatures** pour les webhooks externes.

## Pièges à éviter
- **Ne stockez pas** de credentials en clair côté n8n — utilisez les credentials chiffrés.
- Les **webhooks non signés** peuvent recevoir du spam → utilisez une signature HMAC.

## Liens utiles
- [Numéros](/numbers)
- [Workflows n8n](/workflows)`,

    default: `## Inbound connectors
Call and lead sources that the platform ingests.

## What this page is for
- Connect **SIP trunks** (carrier interconnections).
- Configure **Twilio webhooks** (automatic or manual).
- Hook up **external webhooks** (Meta Ads, Google Ads, your website).
- Configure **email-to-call**: an inbound email triggers a callback.

## How to use it
1. **+ New connector** → choose the type (Twilio, SIP, Webhook, Email).
2. Fill in the **credentials** (encrypted on the platform side).
3. **Test** the connection: "Test" button → you see the event arrive.
4. **Map**: which agent / queue / flow receives calls from this connector.

## Best practices
- Use **Twilio auto-config** rather than manually configuring webhooks.
- Prefer **HTTPS + signatures** for external webhooks (security).
- **Document each connector** (what it does, who maintains it).

## Typical use case
You want to turn every Meta Ads lead into a call → you create a webhook pointing to the platform → when a lead arrives → the platform triggers an automatic callback via an AI agent.

## Pitfalls to avoid
- **Don't store** credentials in plain text on the n8n side — use encrypted credentials.
- **Unsigned webhooks** can receive spam → use an HMAC signature.

## Useful links
- [Numbers](/numbers)
- [n8n Workflows](/workflows)`,
  },

  "admin.billing": {
    title: "Billing",
    title_fr: "Facturation",
    learnMoreHref: docHref("admin.billing"),
    fr: `## Facturation
Suivez votre consommation et vos factures.

## À quoi sert cette page
- Voir le **cycle en cours** : minutes consommées, agents IA actifs, stockage RAG, numéros.
- Télécharger vos **factures** en PDF.
- Gérer vos **modes de paiement** (carte, prélèvement SEPA).
- **Changer de plan** ou ajouter des options.

## Comment l'utiliser
1. **Cycle en cours** : barre de progression par quota.
2. **Factures** : tableau avec date, montant, statut, PDF.
3. **Modes de paiement** : ajouter / supprimer une carte.
4. **Plan** : visualisez votre plan actuel et ses limites. Bouton "Mettre à niveau".
5. **Alertes** : définissez un seuil (ex. alerte à 80% du quota minutes).

## Bonnes pratiques
- Activez les **alertes de seuil** pour éviter les mauvaises surprises en fin de cycle.
- Préférez le **prélèvement SEPA** pour les abonnements professionnels.
- Téléchargez vos **factures** chaque mois pour votre comptable.

## Pièges à éviter
- Une **carte expirée** entraîne une suspension automatique sous 7 jours.
- Les **options** sont consommées après le plan — vérifiez ce qui est consommé en premier.

## Liens utiles
- [Administration](/admin)
- [Paramètres](/settings)`,

    default: `## Billing
Track your consumption and invoices.

## What this page is for
- View the **current cycle**: minutes consumed, active AI agents, RAG storage, number of phone numbers.
- Download your **invoices** as PDF.
- Manage your **payment methods** (card, SEPA direct debit).
- **Change plan** or add add-ons.

## How to use it
1. **Current cycle**: progress bar per quota.
2. **Invoices**: table with date, amount, status, PDF.
3. **Payment methods**: add / remove a card.
4. **Plan**: view your current plan and its limits. "Upgrade" button.
5. **Alerts**: set a threshold (e.g. alert at 80% of the minutes quota).

## Best practices
- Enable **threshold alerts** to avoid end-of-cycle surprises.
- Prefer **SEPA direct debit** for professional subscriptions (card = expiry risk).
- Download your **invoices** each month for your accountant.

## Typical use case
You see the "Minutes" bar at 85% on the 20th of the month → you activate the "extra minutes" add-on to avoid a service interruption.

## Pitfalls to avoid
- An **expired card** triggers automatic suspension within 7 days if not replaced.
- **Add-ons** are consumed on top of the plan — check what's consumed first (usually plan, then add-on).

## Useful links
- [Admin](/admin)
- [Settings](/settings)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ALERTS
  // ──────────────────────────────────────────────────────────────────────
  alerts: {
    title: "Alerts",
    title_fr: "Alertes",
    learnMoreHref: docHref("alerts"),
    fr: `## Alertes
Incidents et seuils dépassés à traiter.

## À quoi sert cette page
- Voir les **alertes ouvertes** (à traiter).
- Filtrer par **sévérité**, **catégorie**, **source**.
- **Acquitter**, commenter et clore une alerte.
- Définir vos propres **règles** (seuils personnalisés).

## Comment l'utiliser
1. Triez par **sévérité** (critique / haute / moyenne / info).
2. Cliquez sur une alerte pour ouvrir le **détail** (contexte, métrique, action suggérée).
3. **Acquitter** : "Je prends en charge" → l'alerte passe en "en cours".
4. **Clore** avec un commentaire.
5. **Règles** : onglet "Configuration" pour créer / modifier les seuils.

## Catégories
- **Technique** : fournisseur en panne, webhook en erreur, job en retard.
- **Qualité** : sentiment négatif, appel trop long, taux d'abandon élevé.
- **Conformité** : appel hors plage horaire, contact opt-out appelé.
- **Business** : conversion en baisse, ROI campagne dégradé.

## Bonnes pratiques
- **Acquittez** une alerte critique rapidement (<5 min) — cela évite l'escalade.
- Affinez vos **règles** : trop de bruit → vous arrêtez de les lire.

## Pièges à éviter
- **Ne clôturez pas sans commenter** : l'historique est précieux pour les post-mortems.

## Liens utiles
- [Tableau de bord](/dashboard)
- [Santé des numéros](/numbers/health)
- [Files d'attente](/queues)`,

    default: `## Alerts
Incidents and exceeded thresholds to handle.

## What this page is for
- View **open alerts** (to be handled).
- Filter by **severity**, **category**, **source**.
- **Acknowledge**, comment, and close an alert.
- Define your own **rules** (custom thresholds).

## How to use it
1. Sort by **severity** (critical / high / medium / info).
2. Click an alert to open the **detail** (context, metric, suggested action).
3. **Acknowledge**: "I'm handling this" → the alert moves to "in progress".
4. **Close** with a comment.
5. **Rules**: "Configuration" tab to create / modify thresholds.

## Categories
- **Technical**: provider down, webhook failure, delayed job.
- **Quality**: negative sentiment, call too long, high abandon rate.
- **Compliance**: call outside time window, opted-out contact called.
- **Business**: conversion dropping, degraded campaign ROI.

## Best practices
- **Acknowledge** a critical alert quickly (< 5 min) — it prevents escalation to the manager.
- Refine your **rules**: too much noise → you stop reading any of them.
- Run a **post-mortem** on frequent critical alerts to resolve them at the source.

## Typical use case
"5 abandonments in the VIP queue in 10 min" → red alert → you reinforce the team (add AI agents as fallback) → the alert resolves itself.

## Pitfalls to avoid
- **Don't close without commenting**: the history is valuable for post-mortems.
- Don't set thresholds too **low**: you'll be overwhelmed.

## Useful links
- [Dashboard](/dashboard)
- [Number health](/numbers/health)
- [Queues](/queues)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ANALYSES LLM
  // ──────────────────────────────────────────────────────────────────────
  analyses: {
    title: "LLM Analysis",
    title_fr: "Analyse LLM",
    learnMoreHref: docHref("analyses"),
    fr: `## Analyse LLM
Analyse post-appel automatisée générée par l'IA.

## À quoi sert cette page
- **Résumer** chaque appel en 3 lignes.
- Détecter le **sentiment** (positif / neutre / négatif) et son évolution.
- Extraire les **thèmes** abordés (sujets, objections, demandes).
- Scorer la **qualité** : conformité, opportunité commerciale, ton.
- Extraire les **actions** : rappels à faire, tâches, RDV à créer.

## Comment l'utiliser
1. Filtrez par **période**, **agent**, **campagne**, **sentiment**.
2. Cliquez sur une analyse pour voir le **détail** (résumé, sentiment, thèmes, actions).
3. **Déclenchez une analyse manuelle** sur un appel : depuis Appels → fiche appel → "Analyser".
4. **Exportez** en CSV pour vos comités qualité.

## Bonnes pratiques
- Faites une **revue qualité hebdomadaire** : filtrez "sentiment négatif" + "conformité <70%".
- Croisez **agent × sentiment** pour identifier les besoins de formation.
- Activez l'**analyse automatique** sur 100% des appels de production.

## Pièges à éviter
- Le **sentiment LLM** n'est pas parfait sur l'ironie / les nuances culturelles.
- Les **analyses coûtent des tokens LLM** : sur 10 000 appels/jour, préférez un échantillonnage.

## Liens utiles
- [Appels](/calls)
- [Analytics](/analytics)
- [Alertes](/alerts)`,

    default: `## LLM Analysis
Automated post-call analysis generated by AI.

## What this page is for
- **Summarise** each call in 3 lines.
- Detect **sentiment** (positive / neutral / negative) and its evolution.
- Extract **topics** covered (subjects, objections, requests).
- Score **quality**: compliance, commercial opportunity, tone.
- Extract **actions**: callbacks to make, tasks, appointments to create.

## How to use it
1. Filter by **period**, **agent**, **campaign**, **sentiment**.
2. Click an analysis to see the **detail** (summary, sentiment, topics, actions).
3. **Trigger a manual analysis** on a call: from Calls → call record → "Analyse".
4. **Export** to CSV for your quality committees.

## Best practices
- Run a **weekly quality review**: filter "negative sentiment" + "compliance < 70%" → debrief with the team.
- Cross **agent × sentiment** to identify training needs.
- Enable **automatic analysis** on 100% of production calls.

## Typical use case
Monday morning, you open Analysis → filter "negative sentiment over 7d" → you identify 4 difficult calls → team debrief → 2 are genuinely hard cases (aggressive customers), 2 are agent errors → targeted coaching.

## Pitfalls to avoid
- **LLM sentiment** isn't perfect on irony / cultural nuance — listen to the audio when a case surprises you.
- **Analyses cost LLM tokens**: if you have 10,000 calls/day, it's better to sample than to analyse everything.

## Useful links
- [Calls](/calls)
- [Analytics](/analytics)
- [Alerts](/alerts) (you can turn a threshold into an alert)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ──────────────────────────────────────────────────────────────────────
  settings: {
    title: "Settings",
    title_fr: "Paramètres",
    learnMoreHref: docHref("settings"),
    fr: `## Paramètres
Votre profil et vos préférences personnelles.

## À quoi sert cette page
- Modifier votre **profil** (nom, photo, langue de l'interface).
- Configurer les **notifications** (email, in-app, push).
- Gérer la **sécurité** : mot de passe, 2FA, sessions actives.
- Personnaliser les **préférences** (thème, raccourcis).

## Comment l'utiliser
1. **Profil** : changez votre nom et photo. La langue de l'interface s'applique au prochain rechargement.
2. **Notifications** : choisissez ce que vous voulez recevoir et par quel canal.
3. **Sécurité** : activez la 2FA (recommandé). Révoquez les sessions inutilisées.
4. **Préférences** : thème (sombre / clair / système).

## Bonnes pratiques
- **Activez la 2FA** — un compte compromis donne accès aux données clients.
- Révoquez les **sessions anciennes** (ancien laptop, café public).

## Pièges à éviter
- Si vous **désactivez toutes les notifications**, vous risquez de rater un événement important.

## Liens utiles
- [Administration](/admin)`,

    fr_admin: `## Paramètres de l'organisation (admin)
Personnalisez votre tenant (visuels, sécurité, intégrations).

## Bonnes pratiques
- Activez la **2FA obligatoire** dès que vous avez plus de 5 membres.
- Définissez une **politique de mots de passe** (12 car. min, complexité, rotation 90j).
- Pour les grands comptes : **SSO via SAML** > comptes locaux.

## Pièges à éviter
- Une **allowlist IP** mal configurée peut vous bloquer vous-même : testez sur un autre membre avant d'activer.

## Liens utiles
- [Administration](/admin)
- [Facturation](/admin/billing)`,

    default: `## Settings
Your profile and personal preferences.

## What this page is for
- Edit your **profile** (name, photo, interface language).
- Configure **notifications** (email, in-app, push).
- Manage **security**: password, 2FA, active sessions.
- Customise **preferences** (theme, shortcuts).

## How to use it
1. **Profile**: change your name and photo. The interface language applies on the next refresh.
2. **Notifications**: choose what you want to receive and via which channel.
3. **Security**: enable 2FA (recommended). Revoke unused sessions.
4. **Preferences**: theme (dark / light / system).

## Best practices
- **Enable 2FA** — a compromised account gives access to customer data.
- Revoke **old sessions** (old laptop, public café).
- **Email + in-app** notifications for critical alerts, **in-app only** for the rest.

## Pitfalls to avoid
- If you **disable all notifications**, you risk missing an important event.
- **Never** use the same password as on other services.

## Useful links
- [Administration](/admin)`,

    admin: `## Organisation settings
Customise your tenant (visuals, security, integrations).

## What this page is for
- **Branding**: logo, colours (appear in emails, the portal).
- **Custom domain**: e.g. \`support.your-brand.com\` instead of the platform URL.
- **Security policies**: strong passwords, mandatory 2FA, IP allowlist.
- **Global integrations**: LDAP / SSO, custom providers.

## How to use it
1. **Branding**: upload logo (transparent PNG/SVG recommended) + primary colours.
2. **Domain**: add your CNAME, validate DNS, wait for the certificate (5-30 min).
3. **Security**: tick "Mandatory 2FA" (recommended in production).
4. **SSO**: configure SAML / OIDC if you have an IdP (Okta, Azure AD).

## Best practices
- Enable **mandatory 2FA** as soon as you have more than 5 members.
- Set up a **password policy** (12 char min, complexity, 90-day rotation).
- For large accounts: **SSO via SAML** > local accounts (centralised management).

## Typical use case
Onboarding a new B2B client → you activate their branding (logo + colours) in 10 min → the experience is immediately personalised.

## Pitfalls to avoid
- A poorly configured **IP allowlist** can lock you out yourself: test on another member before enabling.
- **Changing the domain** invalidates old invitation links — communicate this beforehand.

## Useful links
- [Administration](/admin)
- [Billing](/admin/billing)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AUTH (kept short — these are pre-app)
  // ──────────────────────────────────────────────────────────────────────
  signup: {
    title: "Sign up",
    learnMoreHref: docHref("signup"),
    default: `## Create an account
Welcome! A few details are all you need to get started.

## What this page is for
- Create your account **in 30 seconds**.
- Sign in via **Google / Microsoft** if you prefer.
- Join an **existing organisation** by invitation.

## How to use it
1. **Email + password** (8 char min) OR "Continue with Google/Microsoft".
2. Choose: create my own organisation, or join via invitation code.
3. Confirm your **email** (link sent).
4. Follow the **onboarding**: step-by-step wizard to set up your first AI agent.

## Best practices
- Use your **work email** (for billing and compliance).
- Start with an **agent template**: 5 minutes and you have something to test.

## Pitfalls to avoid
- Check your **spam folder** if you don't receive the confirmation email.

## Useful links
- [Log in](/login)`,
  },

  login: {
    title: "Log in",
    learnMoreHref: docHref("login"),
    default: `## Log in
Access your Axon workspace.

## What this page is for
- **Log in** to your account (email + password, or SSO).
- **Recover** a forgotten password.
- **Switch** between organisations after login (if you're a member of several).

## How to use it
1. **Email + password**, or "Continue with Google/Microsoft" if enabled.
2. If 2FA is active: enter the **code** from your authenticator app.
3. **Forgot your password?** → reset link sent by email.

## Best practices
- Enable **2FA** as soon as possible (Settings → Security).
- Avoid sessions on **shared machines** without logging out.

## Pitfalls to avoid
- Too many failures → account temporarily locked (5 min) for security.

## Useful links
- [Create an account](/signup)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AGENT LIBRARY (persona templates)
  // ──────────────────────────────────────────────────────────────────────
  "agents.library": {
    title: "Persona library",
    title_fr: "Bibliothèque de personas",
    learnMoreHref: docHref("agents.library"),
    fr: `## Bibliothèque de personas
Des templates d'agents IA prêts à l'emploi, à cloner en un clic dans votre organisation.

## À quoi sert cette page
- Parcourir les **personas pré-construits** (concierge hôtel, réceptionniste médicale, commercial B2B, support…).
- **Prévisualiser** chaque persona (voix, style, cas d'usage) avant de le cloner.
- **Cloner** un persona dans votre organisation comme agent IA entièrement configuré.
- Utiliser les templates comme **point de départ** pour économiser des heures de prompt engineering.

## Comment l'utiliser
1. Parcourez les cartes — chacune montre le nom du persona, son rôle et son cas d'usage.
2. Cliquez sur **"Prévisualiser"** pour entendre un exemple d'interaction.
3. Cliquez sur **"Cloner"** pour importer le persona comme nouvel agent IA dans votre organisation.
4. L'agent cloné apparaît dans **Agents IA** — vous pouvez ensuite personnaliser son prompt, sa voix et ses outils.

## Bonnes pratiques
- Clonez d'abord, **personnalisez ensuite** : changez la phrase d'accueil et ajoutez le nom de votre marque avant de passer en live.
- Vérifiez la **langue** du persona selon votre audience.
- Après le clonage, assignez les **documents RAG** pertinents pour que l'agent dispose de votre connaissance spécifique.

## Liens utiles
- [Agents IA](/agents)
- [Voice Studio](/voices)`,

    default: `## Persona library
Ready-made AI agent templates you can clone into your organisation in one click.

## What this page is for
- Browse **pre-built personas** (hotel concierge, medical receptionist, B2B sales, support…).
- **Preview** each persona's voice, style, and use case before cloning.
- **Clone** a persona into your organisation as a fully configured AI agent.
- Use templates as a **starting point** to save hours of prompt engineering.

## How to use it
1. Browse the cards — each shows the persona's name, role, and intended use case.
2. Click **"Preview"** to hear a sample interaction.
3. Click **"Clone"** to import the persona as a new AI agent in your organisation.
4. The cloned agent appears in **AI Agents** — you can then customise its prompt, voice, and tools.

## Best practices
- Clone first, then **customise**: change the greeting and add your brand name before going live.
- Check the **language** of the persona matches your audience.
- After cloning, assign the relevant **RAG documents** so the agent has your specific knowledge.

## Typical use case
You're setting up a medical receptionist → clone "Healthcare Receptionist" → update the greeting with your clinic name → add your FAQ PDF to RAG → live in 15 minutes.

## Pitfalls to avoid
- Don't use a persona in production **without testing** first — some prompts may need adjusting for your context.
- The cloned agent starts **inactive** — remember to activate it and assign it to a queue or flow.

## Useful links
- [AI Agents](/agents) to manage cloned agents
- [Voice Studio](/voices) to customise the voice`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // COPILOT (manager client-facing)
  // ──────────────────────────────────────────────────────────────────────
  copilot: {
    title: "Manager co-pilot",
    title_fr: "Co-pilot manager",
    learnMoreHref: docHref("copilot"),
    fr: `## Co-pilot manager
Posez des questions sur votre activité d'appels en langage naturel et obtenez des réponses instantanées.

## À quoi sert cette page
- **Interroger vos données** sans écrire de SQL : "Combien d'appels avons-nous traités cette semaine ?".
- **Diagnostiquer des problèmes** : "Pourquoi les conversions ont-elles chuté lundi ?".
- **Obtenir des recommandations** : "Quelle campagne devrais-je mettre en pause ?".
- **Générer du contenu** : rédiger un script, réécrire un prompt, résumer un rapport.

## Comment l'utiliser
1. Tapez votre question dans la **barre de chat** en langage naturel.
2. Le copilot interroge vos appels, campagnes, agents et KPI, puis répond avec données + recommandations.
3. Les questions de suivi sont supportées : le copilot conserve le contexte de la conversation.
4. Pour les **actions** (créer une campagne, mettre en pause un flow…), il demande une **confirmation** avant d'exécuter.

## Bonnes pratiques
- Soyez **précis** : "Comparez les taux de conversion des campagnes juin et juillet" → meilleur résultat que "Comment vont les campagnes ?".
- Demandez un **diagnostic avant d'agir** : "Pourquoi ce numéro reçoit-il peu de réponses ?" avant "Ajoutez des numéros".
- Utilisez-le pour rédiger des **premières versions** de scripts ou prompts, puis affinez à la main.

## Liens utiles
- [Analytics](/analytics)
- [Campagnes](/campaigns)
- [Agents IA](/agents)`,

    fr_manager: `## Co-pilot manager
Votre assistant IA personnel pour piloter le centre de contact.

## À quoi sert cette page
- Obtenir un **briefing quotidien** : "Que s'est-il passé hier ? Qu'est-ce qui nécessite mon attention aujourd'hui ?".
- **Planifier** : "J'ai 300 leads à appeler — suggère une configuration de campagne".
- **Surveiller la qualité** : "Montre-moi les agents avec le score de satisfaction le plus bas cette semaine".

## Bonnes pratiques
- Commencez la journée avec **"Qu'est-ce qui nécessite mon attention aujourd'hui ?"** — il remonte les alertes, approbations en attente et indicateurs hors norme.
- Utilisez-le pour **préparer les réunions** : "Résume le mois dernier et suggère 3 points à aborder".

## Liens utiles
- [Analytics](/analytics)
- [Rapports](/rapports)`,

    default: `## Manager co-pilot
Ask questions about your call activity in plain language and get instant answers.

## What this page is for
- **Query your data** without writing SQL: "How many calls did we handle this week?".
- **Diagnose issues**: "Why did conversions drop on Monday?".
- **Get recommendations**: "Which campaign should I pause?".
- **Generate content**: draft a script, rewrite a prompt, summarise a report.

## How to use it
1. Type your question in the **chat bar** — natural language, no special syntax.
2. The copilot searches your calls, campaigns, agents, and KPIs, then replies with data + recommendations.
3. Follow-up questions are supported: the copilot keeps the context of the conversation.
4. For **actions** (create a campaign, pause a flow), the copilot asks for confirmation before executing.

## Best practices
- Be **specific**: "Compare conversion rates for the June and July campaigns" → better than "How are campaigns doing?".
- Ask for **diagnosis before action**: "Why is this number getting few answers?" before "Add more numbers".
- Use it to **draft first versions** of scripts or prompts, then refine by hand.

## Typical use case
"Summarise last week's performance and suggest 3 actions to improve our answer rate" → the copilot pulls the KPIs, identifies the bottleneck, and proposes concrete next steps.

## Pitfalls to avoid
- The copilot has **read access** to your data — it won't modify anything unless you confirm an action.
- For **sensitive data** (patient files, PII), be mindful of what you copy into the chat.

## Useful links
- [Analytics](/analytics) for manual exploration
- [Campaigns](/campaigns)
- [AI Agents](/agents)`,

    manager: `## Manager co-pilot
Your personal AI assistant for managing the call centre.

## What this page is for
- Get a **daily briefing**: "What happened yesterday? What needs my attention today?".
- **Plan**: "I have 300 leads to call — suggest a campaign setup".
- **Monitor quality**: "Show me the agents with the lowest satisfaction score this week".

## Best practices
- Start your day with **"What needs my attention today?"** — it surfaces alerts, pending approvals, and performance outliers.
- Use it to **prepare committee meetings**: "Summarise last month and suggest 3 talking points".

## Useful links
- [Analytics](/analytics)
- [Reports](/rapports)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // TEAM (user / member management)
  // ──────────────────────────────────────────────────────────────────────
  team: {
    title: "Team",
    title_fr: "Équipe",
    learnMoreHref: docHref("team"),
    fr: `## Équipe
Gérez les membres de votre organisation — leurs rôles, accès et statuts.

## À quoi sert cette page
- **Inviter** de nouveaux membres par email.
- Attribuer ou modifier les **rôles** (agent, superviseur, manager, admin).
- **Désactiver** les membres partis (sans supprimer leur historique).
- Voir les **invitations en attente** et les renvoyer si nécessaire.

## Comment l'utiliser
1. Cliquez sur **"+ Inviter"** → saisissez l'email et choisissez un rôle.
2. L'invité reçoit un lien d'activation (valable 7 jours).
3. Pour changer un rôle : cliquez sur un membre → "Modifier le rôle".
4. Pour désactiver : cliquez sur un membre → "Désactiver" (l'historique est conservé).

## Aperçu des rôles
| Rôle | Peut faire |
|------|-----------|
| **Agent** | Répondre / passer des appels, gérer ses propres contacts |
| **Superviseur** | Surveiller les appels, souffler/intervenir, coacher les agents |
| **Manager** | Voir les analytics, gérer les campagnes, lire les rapports |
| **Admin** | Accès complet sauf fonctions super-admin |

## Bonnes pratiques
- Limitez le rôle **admin** à 2–3 personnes maximum.
- Désactivez plutôt que supprimez quand quelqu'un part — la piste d'audit est préservée.
- Vérifiez les **invitations en attente** chaque semaine : les liens expirés sont frustrants pour les nouveaux.

## Pièges à éviter
- **Ne jamais** donner le rôle admin à un agent front-office : il aurait accès à la facturation et à toutes les données.
- Si un membre **ne reçoit pas** l'invitation, vérifiez ses spams et renvoyez.

## Liens utiles
- [Administration](/admin)
- [Paramètres](/settings)`,

    fr_admin: `## Gestion de l'équipe (admin)
Contrôle complet sur les membres de votre organisation.

## Bonnes pratiques
- Activez la **2FA obligatoire** (Paramètres → Sécurité) avant de faire grossir l'équipe.
- **Désactivez immédiatement** quand quelqu'un part.

## Liens utiles
- [Administration](/admin)`,

    default: `## Team
Manage the members of your organisation — their roles, access, and status.

## What this page is for
- **Invite** new team members by email.
- Assign or change **roles** (agent, supervisor, manager, admin).
- **Deactivate** members who have left (without deleting their history).
- View **pending invitations** and resend them if needed.

## How to use it
1. Click **"+ Invite"** → enter the email address and choose a role.
2. The invitee receives an activation link (valid 7 days).
3. To change a role: click a member → "Edit role".
4. To deactivate: click a member → "Deactivate" (their history is preserved).

## Role overview
| Role | Can do |
|------|--------|
| **Agent** | Answer / make calls, manage own contacts |
| **Supervisor** | Monitor calls, whisper/barge, coach agents |
| **Manager** | View analytics, manage campaigns, read reports |
| **Admin** | Full access except super-admin features |

## Best practices
- Keep the **admin role** to 2–3 people maximum.
- Deactivate rather than delete when someone leaves — the audit trail is preserved.
- Review **pending invitations** weekly: expired links are frustrating for new joiners.

## Typical use case
You onboard a new supervisor → Invite → email + role "supervisor" → they activate their account → you assign them to the relevant queue in Queues → they can immediately start monitoring calls.

## Pitfalls to avoid
- **Never** give an agent the admin role: they'd have access to billing and all data.
- If a member **doesn't receive** the invitation, check their spam folder and resend.

## Useful links
- [Administration](/admin)
- [Settings](/settings)`,

    admin: `## Team management (admin)
Full control over your organisation's members.

## What this page is for
- Invite, edit roles, deactivate, and manage pending invitations.
- Enforce **security policies** (2FA, strong passwords).
- Keep the **audit trail** clean when people join or leave.

## Best practices
- Enable **mandatory 2FA** (Settings → Security) before scaling the team.
- **Deactivate immediately** when someone leaves — don't wait.
- Keep a log of role changes: who gave admin to whom and when.

## Useful links
- [Administration](/admin)
- [Settings](/settings)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // REPORTS / PILOTAGE
  // ──────────────────────────────────────────────────────────────────────
  rapports: {
    title: "Management reports",
    title_fr: "Rapports de pilotage",
    learnMoreHref: docHref("rapports"),
    fr: `## Rapports de pilotage
Rapports exécutifs générés par l'IA : KPI, tendances et plan d'action — à la demande.

## À quoi sert cette page
- Générer des **rapports hebdomadaires ou mensuels** en un clic.
- Obtenir une **synthèse narrative** (pas seulement des chiffres) : ce qui a bien fonctionné, ce à améliorer.
- Recevoir un **plan d'action concret** basé sur vos données.
- **Exporter** en PDF ou partager avec votre équipe.

## Comment l'utiliser
1. Choisissez le **type de rapport** (Hebdomadaire, Mensuel, Performance par agent, Funnel campagne…).
2. Sélectionnez la **période** (par défaut, la dernière période complète).
3. Cliquez sur **"Générer"** — l'IA analyse vos données et produit le rapport en ~10 sec.
4. Relisez et **modifiez** l'ébauche si nécessaire.
5. **Téléchargez en PDF** ou copiez le contenu.

## Types de rapports disponibles
- **Pilotage hebdomadaire** : funnel de prospection, qualifications, plan d'action.
- **Bilan mensuel** : performance cumulative, tendances, taux de conversion.
- **Performance par agent** : comparaison humain / agent IA *(bientôt)*.
- **Funnel campagne** : analyse détaillée par campagne en cours *(bientôt)*.

## Bonnes pratiques
- Générez le **rapport hebdomadaire le lundi matin** pour briefer l'équipe sur la semaine passée.
- Gardez le **rapport mensuel** pour les présentations en comité — il est pré-formaté.
- Utilisez la **section plan d'action** comme liste de tâches pour la semaine.

## Liens utiles
- [Analytics](/analytics)
- [Campagnes](/campaigns)`,

    fr_manager: `## Rapports de pilotage (manager)
Votre outil pour les présentations en comité et les briefings d'équipe.

## Bonnes pratiques
- Fixez un **jour fixe chaque semaine** pour générer et partager le rapport.
- Associez le rapport à l'onglet **Analytics** pour approfondir quand quelque chose cloche.

## Liens utiles
- [Analytics](/analytics)`,

    default: `## Management reports
AI-generated executive reports: KPIs, trends, and action plan — on demand.

## What this page is for
- Generate **weekly or monthly reports** with a single click.
- Get a **narrative summary** (not just numbers): what went well, what to improve.
- Receive a **concrete action plan** based on your data.
- **Export** as PDF or share with your team.

## How to use it
1. Choose the **report type** (Weekly, Monthly, Agent performance, Campaign funnel…).
2. Select the **period** (defaults to the last completed period).
3. Click **"Generate"** — the AI analyses your data and produces the report in ~10 sec.
4. Review and **edit** the draft if needed.
5. **Download PDF** or copy the content.

## Report types available
- **Weekly management**: prospecting funnel, qualifications, action plan.
- **Monthly summary**: cumulative performance, trends, conversion rates.
- **Agent performance**: comparison by human / AI agent *(coming soon)*.
- **Campaign funnel**: detailed analysis by active campaign *(coming soon)*.

## Best practices
- Generate the **weekly report on Monday morning** to brief the team on last week.
- Keep the **monthly report** for committee presentations — it's pre-formatted.
- Use the **action plan section** as a task list for the week.

## Typical use case
Monday morning → generate "Weekly management" → the report shows conversion dropped 12% on Thursday (identified as a technical issue with the dialler) → action plan: fix the dialler, compensate by adding 50 extra leads this week.

## Pitfalls to avoid
- Reports are based on **completed calls only** — in-progress campaigns won't appear in full.
- A report generated on **Monday morning** won't include Saturday's calls if your data sync runs overnight.

## Useful links
- [Analytics](/analytics)
- [Campaigns](/campaigns)
- [AI Insights](/dashboard?tab=ai)`,

    manager: `## Management reports (manager)
Your go-to for committee presentations and team briefings.

## What this page is for
- **Weekly / monthly reports** for committee meetings.
- **Performance comparisons** to identify what to prioritise.
- **One-click PDF export** for your dashboard.

## Best practices
- Set a **fixed day each week** to generate and share the report with stakeholders.
- Pair the report with the **Analytics tab** for drill-down when something looks off.

## Useful links
- [Analytics](/analytics)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ONBOARDING / GUIDED START
  // ──────────────────────────────────────────────────────────────────────
  start: {
    title: "Guided start",
    title_fr: "Démarrage guidé",
    learnMoreHref: docHref("start"),
    fr: `## Démarrage guidé
Assistant de configuration pas-à-pas pour lancer votre première campagne ou workflow en quelques minutes.

## À quoi sert cette page
- Vous guider à travers les **étapes minimales** pour aller en live selon votre scénario.
- Afficher la **progression** : quelles étapes sont faites, lesquelles restent.
- Fournir des **liens directs** vers chaque page de configuration.
- Prendre en charge plusieurs scénarios : campagne sortante, support entrant, poste agent…

## Comment l'utiliser
1. Sélectionnez votre **scénario** (ex. "Lancer ma 1ère campagne", "Recevoir des appels entrants", "Mon premier jour").
2. L'assistant affiche une **liste d'étapes** — les étapes terminées sont cochées automatiquement.
3. Cliquez sur le **bouton CTA** d'une étape pour ouvrir la page correspondante.
4. Revenez sur cette page à tout moment pour **vérifier la progression**.

## Bonnes pratiques
- Complétez les étapes **dans l'ordre** — chacune dépend de la précédente.
- Ne sautez pas l'étape **"Tester l'agent"** : un mauvais prompt est pire qu'aucun agent.
- L'assistant vérifie vos données réelles — une étape cochée signifie qu'elle est vraiment faite.

## Liens utiles
- [Agents IA](/agents)
- [Contacts](/contacts)
- [Campagnes](/campaigns)
- [Numéros](/numbers)`,

    default: `## Guided start
Step-by-step setup wizard to get your first campaign or workflow running in minutes.

## What this page is for
- Guide you through the **minimum steps** to go live for a given scenario.
- Show **progress**: which steps are done, which are remaining.
- Provide **direct links** to each setup page.
- Support multiple scenarios: outbound campaign, inbound support, agent desk…

## How to use it
1. Select your **scenario** (e.g. "Outbound campaign", "Inbound queue", "Agent desk").
2. The wizard shows a **step list** — completed steps are checked automatically.
3. Click a step's **CTA button** to open the relevant page.
4. Come back to this page to **check progress** at any time.

## Scenarios available
- **Outbound campaign**: create an agent → add contacts → write a script → assign a number → launch.
- **Inbound queue**: create an agent → create a queue → buy a number → route → go live.
- **Agent desk**: discover the softphone → claim a call → qualify → schedule a callback.

## Best practices
- Complete steps **in order** — each depends on the previous.
- Don't skip **"Test the agent"**: a bad prompt is worse than no agent.
- The wizard checks your actual data — a checked step means it's really done.

## Typical use case
New organisation → you open Guided Start → choose "Outbound campaign" → follow the 6 steps → 30 minutes later your first campaign is running.

## Pitfalls to avoid
- Don't launch a campaign without **verifying Twilio webhooks**: calls will go nowhere.
- If a step stays **unchecked** after you complete it, refresh the page — the count updates in real time.

## Useful links
- [AI Agents](/agents)
- [Contacts](/contacts)
- [Campaigns](/campaigns)
- [Numbers](/numbers)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // MY CALENDAR (callbacks)
  // ──────────────────────────────────────────────────────────────────────
  "mon-calendrier": {
    title: "My calendar",
    title_fr: "Mon calendrier",
    learnMoreHref: docHref("mon-calendrier"),
    fr: `## Mon calendrier
Vos rappels et suivis planifiés, groupés par jour.

## À quoi sert cette page
- Voir tous vos **rappels en attente** organisés par jour.
- Identifier les **rappels en retard** d'un coup d'œil (surlignés en rouge).
- **Ouvrir la fiche patient / contact** pour vous préparer avant d'appeler.
- Surveiller les **suivis à venir** pour les 7 ou 30 prochains jours.

## Comment l'utiliser
1. Utilisez les **onglets de filtre** (Aujourd'hui / Demain / 7 jours / 30 jours / Tous).
2. Cliquez sur une ligne pour ouvrir la **fiche contact ou patient** complète.
3. Depuis la fiche, cliquez sur **"Appeler"** pour initier le rappel directement.
4. Après l'appel, mettez à jour la **qualification** et planifiez le prochain suivi si nécessaire.

## Bonnes pratiques
- Commencez chaque journée sur l'onglet **"Aujourd'hui"** : traitez vos rappels planifiés avant midi.
- Les rappels prévus à une **heure précise** doivent être honorés à ±15 min — le patient/contact attend votre appel.
- Passez en 🟢 **Disponible** avant l'heure du rappel.

## Liens utiles
- [Mon poste (softphone)](/desk)
- [Mes contacts](/contacts)`,

    fr_agent: `## Mon calendrier
Vos rappels du jour — la journée en un coup d'œil.

## À quoi sert cette page
- Voir vos **rappels planifiés** pour aujourd'hui et les jours à venir.
- Ouvrir une **fiche patient / contact** pour revoir l'historique avant d'appeler.
- Suivre les **rappels en retard** pour ne rien laisser de côté.

## Liens utiles
- [Mon poste](/desk)
- [Mes contacts](/contacts)`,

    default: `## My calendar
Your scheduled callbacks and follow-ups, grouped by day.

## What this page is for
- See all your **pending callbacks** organised by day.
- Identify **overdue callbacks** at a glance (highlighted in red).
- **Open a patient / contact record** to prepare before calling.
- Monitor **upcoming follow-ups** for the next 7 or 30 days.

## How to use it
1. Use the **filter tabs** (Today / Tomorrow / 7 days / 30 days / All).
2. Click a row to open the full **contact or patient record**.
3. From the record, click **"Call"** to initiate the callback directly.
4. After the call, update the **qualification** and schedule the next follow-up if needed.

## Best practices
- Start each day on **"Today"**: work through your scheduled callbacks before noon.
- Callbacks scheduled for **a specific time** should be honoured within ±15 min — the patient/contact expects your call.
- Set your status to 🟢 **Available** before the callback time so calls can route to you.

## Typical use case
8:30 am → you open your calendar → 3 callbacks today (9am, 11am, 2pm) → you prepare each file 5 min before → the calls go smoothly because you already know the context.

## Pitfalls to avoid
- If you're **Unavailable** at callback time, the call won't route to you and may go to voicemail.
- **Overdue callbacks** accumulate quickly — process them the same day whenever possible.

## Useful links
- [My desk (softphone)](/desk)
- [My contacts](/contacts)`,

    agent: `## My calendar
Your callbacks for today — the day at a glance.

## What this page is for
- See your **scheduled callbacks** for today and the coming days.
- Open a **patient / contact file** to review the history before calling.
- Track **overdue callbacks** so nothing falls through the cracks.

## Best practices
- Process **"Today"** callbacks first thing in the morning.
- Before each call, re-read the **notes** from the previous conversation.

## Useful links
- [My desk](/desk)
- [My contacts](/contacts)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // AI CALENDAR (Charlotte's scheduled callbacks)
  // ──────────────────────────────────────────────────────────────────────
  "mon-calendrier.ia": {
    title: "AI calendar",
    title_fr: "Calendrier IA",
    learnMoreHref: docHref("mon-calendrier.ia"),
    fr: `## Calendrier IA
Les rappels que Charlotte (agent IA) passera à l'heure demandée par le patient.

## À quoi sert cette page
- Voir les **rappels planifiés de l'agent IA** groupés par date et heure.
- Identifier les **rappels en retard** (appels que l'IA n'a pas encore passés après l'heure prévue).
- Surveiller la **file** de rappels pour anticiper la charge.
- Suivre le **coordinateur assigné** pour chaque patient.

## Comment l'utiliser
1. Utilisez les **onglets de filtre** (Aujourd'hui / Demain / 7 jours / 30 jours / Tous).
2. Le tableau affiche chaque patient, son téléphone, l'heure de rappel planifiée et le coordinateur assigné.
3. Les **rappels en retard** apparaissent surlignés — l'IA n'a pas réussi à joindre le patient.
4. Cliquez sur **"Rafraîchir"** pour recharger les dernières données.

## Bonnes pratiques
- Consultez le calendrier IA **en début de journée** pour anticiper le volume de rappels que Charlotte va passer.
- Si un patient est **répétitivement injoignable**, un suivi humain peut s'imposer.
- Les heures affichées sont en **heure UK (Europe/London)** — confirmez que cela correspond à l'attente du patient.

## Pièges à éviter
- Le calendrier IA est **en lecture seule** : vous ne pouvez pas replanifier depuis ici — faites-le depuis la fiche du patient.
- Les rappels n'apparaissent que si la qualification est **"RAPPEL"** avec une heure rappel_rdv dans la fiche patient.

## Liens utiles
- [Mon calendrier](/mon-calendrier) pour vos propres rappels
- [Mes patients](/mes-patients)`,

    default: `## AI calendar
Callbacks that Charlotte (AI agent) will make at the time requested by the patient.

## What this page is for
- See the **AI agent's scheduled callbacks** grouped by date and time.
- Identify **overdue AI callbacks** (calls the AI hasn't made yet past the scheduled time).
- Monitor the **queue** of callbacks to anticipate load.
- Track the assigned **coordinator** for each patient.

## How to use it
1. Use the **filter tabs** (Today / Tomorrow / 7 days / 30 days / All).
2. The table shows each patient, their phone, their scheduled callback time, and the assigned coordinator.
3. **Overdue callbacks** appear highlighted — this means the AI hasn't been able to reach the patient.
4. Click **"Refresh"** to reload the latest data.

## Best practices
- Check the AI calendar **at the start of the day** to anticipate the volume of callbacks Charlotte will make.
- If a patient is **repeatedly unreachable**, a human follow-up may be needed.
- Times shown are in **UK time (Europe/London)** — confirm this matches the patient's expectation.

## Typical use case
It's 10am → you open the AI calendar → 3 callbacks are overdue from 9am → Charlotte failed to connect → you manually call those patients or re-schedule the AI attempt.

## Pitfalls to avoid
- The AI calendar is **read-only**: you cannot reschedule from here — do it from the patient's record.
- Callbacks only appear if the qualification is set to **"RAPPEL"** with a scheduled time in the patient record.

## Useful links
- [My calendar](/mon-calendrier) for your own callbacks
- [My patients](/mes-patients)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // LIVE SUPERVISION
  // ──────────────────────────────────────────────────────────────────────
  "supervise.live": {
    title: "Live supervision",
    title_fr: "Supervision live",
    learnMoreHref: docHref("supervise.live"),
    fr: `## Supervision live
Qui est en ligne, qui parle avec qui, depuis combien de temps — mise à jour toutes les 5 secondes.

## À quoi sert cette page
- Voir **tous les appels actifs** de votre équipe en ce moment.
- Surveiller le **statut des agents** (disponible, en appel, en pause, indisponible).
- Identifier les **appels qui s'éternisent** et qui peuvent nécessiter une intervention.
- Rejoindre un appel via **écoute / souffler / intervenir** si nécessaire.

## Comment l'utiliser
1. Le tableau se met à jour automatiquement toutes les **5 secondes** — pas de rafraîchissement manuel.
2. Les **appels actifs** apparaissent avec le nom de l'agent, la durée et la direction.
3. Cliquez sur un appel actif pour ouvrir le **panneau de supervision** :
   - 🎧 **Écoute** — surveillance silencieuse (aucune des deux parties ne sait que vous êtes là)
   - 🗣️ **Souffler** — parler à l'agent uniquement (le client ne vous entend pas)
   - ⚡ **Intervenir** — rejoindre la conversation comme troisième interlocuteur (tout le monde vous entend)
4. Les agents en alerte (appel long, sentiment négatif) sont **surlignés** pour une identification rapide.

## Bonnes pratiques
- **Écoutez avant d'intervenir** : 10–20 secondes d'écoute évitent les interruptions inutiles.
- Utilisez **Souffler** pour les moments de coaching — moins perturbant qu'Intervenir.
- Consignez vos observations dans **Analyse LLM** après l'appel pour le débriefing.

## Liens utiles
- [Appels](/calls)
- [Analyse LLM](/analyses)
- [Alertes](/alerts)`,

    fr_supervisor: `## Supervision live
Votre vue en temps réel de l'équipe en action.

## Comment l'utiliser
1. Repérez les **surlignages orange/rouge** : appels au-delà de votre durée cible ou avec alertes qualité.
2. Cliquez → choisissez Écoute / Souffler / Intervenir.
3. Après l'appel, ajoutez une note dans Analyse LLM.

## Pièges à éviter
- Ne pas **Intervenir** sans prévenir l'équipe — cela érode la confiance sur le long terme.

## Liens utiles
- [Appels](/calls)
- [Analyse LLM](/analyses)`,

    default: `## Live supervision
Who is online, who is speaking with whom, and for how long — updated every 5 seconds.

## What this page is for
- See **all active calls** in your team right now.
- Monitor **agent status** (available, on a call, on break, unavailable).
- Identify **calls that have been running too long** and may need intervention.
- Jump into a call via **listen / whisper / barge** when needed.

## How to use it
1. The board updates automatically every **5 seconds** — no manual refresh needed.
2. **Active calls** appear with the agent name, duration, and call direction.
3. Click an active call to open the **supervision panel**:
   - 🎧 **Listen** — silent monitoring (neither party knows you're there)
   - 🗣️ **Whisper** — speak to the agent only (customer doesn't hear you)
   - ⚡ **Barge** — join the conversation as a third party (everyone hears you)
4. Agents with alerts (long call, negative sentiment) are **highlighted** for quick identification.

## Best practices
- **Listen before intervening**: 10–20 seconds of listening avoids unnecessary disruptions.
- Use **Whisper** for coaching moments — it's less disruptive than Barge.
- Log coaching observations in **LLM Analysis** after the call for the debrief.

## Typical use case
A junior agent has been on a call for 12 minutes (highlighted in orange) → you click → listen for 30 seconds → you recognise a pricing objection → you whisper "offer the annual plan at a 10% discount" → the agent closes, call ends at 14 minutes.

## Pitfalls to avoid
- **Barge is heard by the customer immediately** — only use it in genuine emergencies.
- Don't **whisper too much** during a single call: the agent loses focus on the customer.

## Useful links
- [Calls](/calls) for full call history
- [LLM Analysis](/analyses) for post-call coaching
- [Alerts](/alerts)`,

    supervisor: `## Live supervision
Your real-time view of the team in action.

## What this page is for
- Monitor **who is on a call right now** and how long they've been talking.
- **Intervene discreetly** when a call needs support.
- Track **queue saturation** and agent availability.

## How to use it
1. Watch for **orange/red highlights**: calls over your target duration or with quality alerts.
2. Click → choose Listen / Whisper / Barge.
3. After the call, add a note in LLM Analysis.

## Pitfalls to avoid
- Don't **Barge** without warning the team — it erodes trust over time.
- Too many whispers per call = the agent can't concentrate.

## Useful links
- [Calls](/calls)
- [LLM Analysis](/analyses)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // PATIENT DESK (OCC / NHS)
  // ──────────────────────────────────────────────────────────────────────
  "desk.my-patients": {
    title: "My patients",
    title_fr: "Mes patients",
    learnMoreHref: docHref("desk.my-patients"),
    fr: `## Mes patients
Liste complète des patients que vous avez traités, avec recherche et filtres.

## À quoi sert cette page
- Accéder à **tous les patients que vous avez pris en charge** en un seul endroit.
- **Chercher** par nom, numéro de téléphone, numéro NHS ou statut.
- Ouvrir la **fiche complète** d'un patient (historique, notes, statut NHS S2, rappels).
- Suivre les **actions en attente** pour chaque patient (rappel nécessaire, formulaire S2 incomplet…).

## Comment l'utiliser
1. Utilisez la **barre de recherche** pour trouver un patient par nom ou téléphone.
2. Appliquez les **filtres** (statut, date, coordinateur) pour affiner la liste.
3. Cliquez sur une ligne pour ouvrir le **panneau de détail** dans Mon poste.
4. Depuis le détail : voir l'historique des appels, ajouter des notes, mettre à jour la qualification, planifier un rappel.

## Bonnes pratiques
- Consultez vos **patients actifs** en début de journée.
- Ajoutez toujours une **note** après chaque interaction — votre collègue peut prendre le prochain appel.
- **Clôturez les dossiers terminés** rapidement pour que votre liste reste gérable.

## Liens utiles
- [Mon poste (softphone)](/desk)
- [Mon calendrier](/mon-calendrier)
- [Suivi NHS S2](/dashboard?tab=nhs)`,

    fr_agent: `## Mes patients
Votre liste de patients avec historique et actions de suivi.

## À quoi sert cette page
- Trouver un **patient** rapidement et voir son historique complet.
- Vérifier quelles **actions sont en attente** pour chaque patient.
- Ouvrir un patient directement dans **Mon poste** pour gérer un appel.

## Liens utiles
- [Mon poste](/desk)
- [Mon calendrier](/mon-calendrier)`,

    default: `## My patients
Complete list of patients you have treated, with search and filters.

## What this page is for
- Access **all patients you have handled** in one place.
- **Search** by name, phone number, NHS number, or status.
- Open a patient's **full record** (history, notes, NHS S2 status, callbacks).
- Track **pending actions** for each patient (callback needed, S2 form incomplete…).

## How to use it
1. Use the **search bar** to find a patient by name or phone.
2. Apply **filters** (status, date, coordinator) to narrow the list.
3. Click a patient row to open their **detail panel** in My desk.
4. From the detail: view call history, add notes, update qualification, schedule a callback.

## Best practices
- Review your **active patients** at the start of each day.
- Always add a **note** after each interaction — your colleague may handle the next call.
- **Close completed cases** promptly so your list stays manageable.

## Typical use case
A patient calls back → you search their name → you see the full call history + previous notes + NHS S2 status → you pick up exactly where the last call left off.

## Pitfalls to avoid
- Don't rely on memory: always **log notes** in the record after each call.
- If a patient's status seems wrong, check the **NHS S2 tracking tab** on the dashboard for the latest pipeline status.

## Useful links
- [My desk (softphone)](/desk)
- [My calendar](/mon-calendrier)
- [NHS S2 tracking](/dashboard?tab=nhs)`,

    agent: `## My patients
Your patient list with history and follow-up actions.

## What this page is for
- Find a **patient** quickly and see their full history.
- Check what **actions are pending** for each patient.
- Open a patient directly in **My desk** to handle a call.

## Best practices
- Add a **clear note** after every call — it makes the next conversation much smoother.
- Keep your **callback schedule** up to date so nothing is missed.

## Useful links
- [My desk](/desk)
- [My calendar](/mon-calendrier)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // WORKFLOWS — NATIVE AUTOMATION EDITOR
  // ──────────────────────────────────────────────────────────────────────
  "workflows.automation": {
    title: "Automation editor",
    title_fr: "Éditeur d'automatisation",
    learnMoreHref: docHref("workflows.automation"),
    fr: `## Éditeur d'automatisation
Configurez les déclencheurs, filtres et actions d'un workflow d'automatisation natif.

## À quoi sert cette page
- Définir le **déclencheur** qui lance cette automatisation (appel terminé, lead qualifié, alerte sentiment…).
- Ajouter des **filtres** pour préciser quand elle se déclenche (ex. uniquement pour la campagne X, uniquement si sentiment < 40%).
- Construire la **chaîne d'actions** : envoyer un email, créer un enregistrement CRM, notifier Slack, mettre à jour un contact…
- **Activer / désactiver** l'automatisation sans la supprimer.

## Comment l'utiliser
1. **Déclencheur** : choisissez le type d'événement (call.ended, lead.qualified, alert.created…).
2. **Filtres** : ajoutez des conditions (ET / OU). Chaque filtre cible un champ du payload d'événement.
3. **Actions** : ajoutez des étapes dans l'ordre. Chaque étape peut utiliser les données du déclencheur (ex. \`{{call.contact_name}}\`).
4. **Testez** : utilisez "Lancer un test" pour simuler avec un payload d'exemple.
5. **Activez** : basculez l'automatisation — elle se déclenchera sur tous les futurs événements correspondants.

## Bonnes pratiques
- **Testez avant d'activer** : une action mal configurée peut spammer votre équipe.
- Gardez les automatisations **focalisées** : un déclencheur, un objectif.

## Liens utiles
- [Workflows](/workflows)
- [Connexions](/workflows/connections)`,

    default: `## Automation editor
Configure triggers, filters, and actions for a native automation workflow.

## What this page is for
- Define the **trigger** that starts this automation (call ended, lead qualified, sentiment alert…).
- Add **filters** to narrow when it fires (e.g. only for campaign X, only if sentiment < 40%).
- Build the **action chain**: send an email, create a CRM record, notify Slack, update a contact…
- **Activate / deactivate** the automation without deleting it.

## How to use it
1. **Trigger**: choose the event type (call.ended, lead.qualified, alert.created…).
2. **Filters**: add conditions (AND / OR). Each filter targets a field on the event payload.
3. **Actions**: add steps in order. Each step can use data from the trigger (e.g. \`{{call.contact_name}}\`).
4. **Test**: use "Run test" to simulate with a sample payload.
5. **Activate**: toggle the automation on — it will fire on all future matching events.

## Available action types
- **Send email** (SMTP)
- **Send WhatsApp message** (WATI)
- **HTTP request** (call any external API)
- **Create / update CRM record**
- **Notify Slack / Teams**

## Best practices
- **Test before activating**: a misconfigured action can spam your team.
- Keep automations **focused**: one trigger, one purpose.
- Use **credentials by ID** (not hardcoded secrets) in HTTP actions.

## Typical use case
Trigger: \`call.qualified\` where \`outcome = hot\` → Action 1: create a Salesforce deal → Action 2: notify #sales Slack → Action 3: send a confirmation email to the lead.

## Pitfalls to avoid
- **Don't chain more than 5 actions** in a single automation: it becomes hard to debug.
- **Slow HTTP calls** (>5s) may time out — use async webhooks for heavy processing.

## Useful links
- [Workflows](/workflows) for all automations
- [Connections](/workflows/connections) for credentials`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // OUTBOUND CALL (manual trigger)
  // ──────────────────────────────────────────────────────────────────────
  "outbound-call": {
    title: "Outbound call",
    title_fr: "Appel sortant",
    learnMoreHref: docHref("outbound-call"),
    fr: `## Appel sortant
Déclenchez un appel sortant IA unique manuellement, en dehors d'une campagne.

## À quoi sert cette page
- Passer un **appel ponctuel** avec un agent IA vers un numéro spécifique.
- **Tester votre agent IA** en conditions réelles avant de le déployer dans une campagne.
- Effectuer un **rappel manuel** quand un contact a demandé à être rappelé à une heure précise.
- **Démontrer la plateforme** à un prospect ou client.

## Comment l'utiliser
1. Choisissez l'**agent IA** à utiliser pour l'appel.
2. Choisissez le **numéro sortant** (identifiant appelant affiché).
3. Saisissez le **numéro de destination** (format E.164 : +44…, +33…).
4. Remplissez optionnellement les **variables de contact** (prénom, société…) utilisées dans le script.
5. Cliquez sur **"Appeler"** — le système compose le numéro et l'agent IA gère la conversation.
6. Consultez la **fiche d'appel** dans Appels une fois terminé.

## Bonnes pratiques
- Utilisez-le pour **tester avant de lancer une campagne** : écoutez la vraie conversation.
- Composez toujours **votre propre téléphone en premier** quand vous configurez un nouvel agent.
- Ajoutez des **variables de contact** pour tester la personnalisation (l'agent salue par le prénom).

## Liens utiles
- [Agents IA](/agents)
- [Campagnes](/campaigns)
- [Appels](/calls)`,

    default: `## Outbound call
Trigger a single AI-powered outbound call manually, outside of a campaign.

## What this page is for
- Make a **one-off call** with an AI agent to a specific number.
- **Test your AI agent** in real conditions before deploying it in a campaign.
- Run a **manual callback** when a contact asked to be called back at a specific time.
- Demonstrate the platform to a **prospect or client**.

## How to use it
1. Choose the **AI agent** to use for the call.
2. Choose the **outbound number** (caller ID shown to the recipient).
3. Enter the **destination number** (E.164 format: +44…, +33…).
4. Optionally fill in **contact variables** (first name, company…) used in the agent's script.
5. Click **"Call"** — the system dials the number and the AI agent handles the conversation.
6. View the **call record** in Calls once it ends.

## Best practices
- Use this to **test before launching a campaign**: listen to the actual conversation.
- Always dial your **own phone first** when setting up a new agent — hear the greeting and flow.
- Add **contact variables** to test personalisation (the agent greets by first name).

## Typical use case
You've just configured a new AI agent for a mortgage broker → you use Outbound Call with your mobile → you listen to the greeting and a simulated conversation → you spot a tone issue → you fix the prompt → you re-test → then you launch the 500-contact campaign.

## Pitfalls to avoid
- Outbound calls consume **real Twilio minutes** — don't spam it for testing.
- The call goes through the **live infrastructure**: make sure your Twilio number is active.

## Useful links
- [AI Agents](/agents) to configure the agent
- [Campaigns](/campaigns) for bulk outbound
- [Calls](/calls) to review the call after it ends`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN — COMPLIANCE (DNC)
  // ──────────────────────────────────────────────────────────────────────
  "admin.compliance": {
    title: "Compliance — DNC",
    title_fr: "Conformité — Liste DNC",
    learnMoreHref: docHref("admin.compliance"),
    fr: `## Conformité — Liste DNC (Do Not Call)
Gérez la liste DNC de votre organisation — obligatoire en vertu de la réglementation TCPA / e-Privacy.

## À quoi sert cette page
- **Ajouter des numéros** à la liste DNC (désinscriptions, plaintes, exigences réglementaires).
- **Importer** une liste DNC en masse depuis un fichier CSV.
- **Vérifier** si un numéro est sur la liste DNC avant d'appeler.
- **Auditer** quand et pourquoi les numéros ont été ajoutés.

## Comment l'utiliser
1. **Ajouter un numéro** : saisissez le numéro au format E.164 (+44…) → "Ajouter au DNC".
2. **Import CSV** : téléchargez un fichier avec un numéro par ligne → confirmez → la liste est fusionnée.
3. **Recherche** : tapez un numéro dans la barre de recherche pour vérifier son statut DNC instantanément.
4. **Export** : téléchargez la liste DNC complète en CSV pour vos dossiers de conformité.

## Contexte légal
- **TCPA (USA)** : vous devez honorer les demandes DNC dans les 30 jours. Non-respect : 500–1 500 $ par appel.
- **e-Privacy (UE/UK)** : les demandes d'opt-out doivent être honorées immédiatement. Respectez également le TPS/CTPS national.
- Les numéros sur la liste DNC sont **automatiquement exclus** de toutes les campagnes sur cette plateforme.

## Bonnes pratiques
- Ajoutez toute **plainte ou désinscription** à la liste DNC immédiatement après réception.
- Effectuez un **rapprochement mensuel** avec le registre TPS/CTPS national.
- Conservez un **champ raison** pour chaque entrée : c'est votre preuve en cas d'audit.

## Liens utiles
- [Contacts](/contacts)
- [Campagnes](/campaigns)
- [Administration](/admin)`,

    fr_admin: `## Conformité — DNC (admin)
Maintenez votre liste DNC et restez conforme TCPA / e-Privacy.

## Bonnes pratiques
- Synchronisez avec le registre **TPS/CTPS** national chaque mois.
- Enregistrez la **raison et la date** pour chaque entrée.
- Exportez et archivez la liste DNC **chaque trimestre**.

## Liens utiles
- [Campagnes](/campaigns)
- [Admin](/admin)`,

    default: `## Compliance — Do Not Call
Manage your organisation's DNC (Do Not Call) list — mandatory under TCPA / e-Privacy regulations.

## What this page is for
- **Add numbers** to the DNC list (opt-outs, complaints, regulatory requirements).
- **Import** a DNC list in bulk from a CSV file.
- **Check** whether a number is on the DNC list before calling.
- **Audit** when and why numbers were added.

## How to use it
1. **Add a number**: enter the number in E.164 format (+44…) → "Add to DNC".
2. **Import CSV**: upload a file with one number per line → confirm → the list is merged.
3. **Search**: type a number in the search bar to check its DNC status instantly.
4. **Export**: download the full DNC list as CSV for your compliance records.

## Legal context
- **TCPA (USA)**: you must honour DNC requests within 30 days. Non-compliance: $500–$1,500 per call.
- **e-Privacy (EU/UK)**: opt-out requests must be honoured immediately. You must also comply with the national TPS/CTPS.
- Numbers on the DNC list are **automatically excluded** from all campaigns on this platform.

## Best practices
- Add any **complaint or opt-out** to the DNC list immediately after receiving it.
- Do a **monthly reconciliation** with the national TPS/CTPS register.
- Keep a **reason field** for every entry: it's your evidence in case of audit.

## Typical use case
A contact calls to complain → you add their number to DNC with reason "opt-out request" → they are immediately excluded from all future campaigns → you're compliant.

## Pitfalls to avoid
- **Never manually call** a DNC-listed number from the softphone either — DNC applies to all channels.
- An empty DNC list is a **red flag**: every active campaign should have generated at least a few opt-outs.

## Useful links
- [Contacts](/contacts)
- [Campaigns](/campaigns)
- [Administration](/admin)`,

    admin: `## Compliance — DNC (admin)
Maintain your DNC list and stay compliant with TCPA / e-Privacy.

## What this page is for
- Centralise all **opt-out and DNC** numbers.
- Ensure they're **automatically excluded** from every campaign.
- Provide **evidence** in case of regulatory audit.

## Best practices
- Synchronise with the **national TPS/CTPS** register monthly.
- Record the **reason and date** for every entry.
- Export and archive the DNC list **quarterly**.

## Useful links
- [Campaigns](/campaigns)
- [Admin](/admin)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN — DATA TABLES (super admin)
  // ──────────────────────────────────────────────────────────────────────
  "admin.data-tables": {
    title: "Data tables — assignment",
    title_fr: "Tables de données — assignation",
    learnMoreHref: docHref("admin.data-tables"),
    fr: `## Tables de données — assignation
Attribuez des tables Supabase (listes de leads, bases patients…) aux organisations clientes.

## À quoi sert cette page
- Mapper des **tables Supabase** à des organisations spécifiques.
- Garantir qu'une organisation **ne voit que ses propres tables** — isolation stricte des données.
- **Ajouter ou retirer** des assignations sans toucher à la base de données.
- Auditer quelle organisation a accès à quelle source de données.

## Comment l'utiliser
1. Sélectionnez l'**organisation** dans la liste déroulante.
2. Le tableau affiche les tables actuellement assignées à cet org.
3. Cliquez sur **"+ Assigner une table"** → saisissez le nom de la table (elle doit exister dans Supabase).
4. Pour retirer : cliquez sur le ✕ à côté d'une table → confirmez.

## Bonnes pratiques
- N'assignez que les tables qui **appartiennent à cet org** : une fuite inter-org est une violation RGPD.
- Utilisez une **convention de nommage** (ex. \`org_slug_leads_2025\`) pour rendre la propriété évidente.
- Révisez les assignations **chaque trimestre** pour supprimer les tables obsolètes.

## Liens utiles
- [Administration](/admin)
- [Organisations](/admin/orgs)`,

    fr_super_admin: `## Tables de données — assignation (super admin)
Gérez la visibilité des tables Supabase par organisation.

## Bonnes pratiques
- Croisez avec la page **RGPD** avant d'assigner des tables sensibles.
- Conservez un **journal des modifications** d'assignation.

## Liens utiles
- [Organisations](/admin/orgs)
- [RGPD](/admin/gdpr)`,
    default: `## Data tables — assignment
Assign physical data tables (imported into Supabase) to client organisations.

## What this page is for
- Map **Supabase tables** (e.g. imported lead lists, patient databases) to specific organisations.
- Ensure each organisation **only sees its own tables** — strict data isolation.
- **Add or remove** table assignments without touching the underlying database.
- Audit which organisation has access to which data source.

## How to use it
1. Select the **organisation** from the dropdown.
2. The table shows all currently assigned data tables for that org.
3. Click **"+ Assign table"** → enter the table name (must already exist in Supabase).
4. To remove: click the ✕ next to a table → confirm.

## Best practices
- Only assign tables that **belong to that organisation**: cross-org data leaks are a GDPR violation.
- Use a **naming convention** (e.g. \`org_slug_leads_2025\`) to make ownership clear at a glance.
- Review assignments **quarterly** to remove stale tables.

## Typical use case
You import a new NHS patient list into Supabase for the OCC organisation → you open Data Tables → select "obesity-care-clinic" → assign the new table → coordinators immediately see it in their contact list.

## Pitfalls to avoid
- **Don't assign a table to the wrong org** — all members of that org will have read access.
- Removing a table assignment **doesn't delete the table**: the data stays in Supabase, it just becomes invisible to the org.

## Useful links
- [Administration](/admin)
- [Organisations](/admin/orgs)`,

    super_admin: `## Data tables — assignment (super admin)
Manage which Supabase tables are visible to each organisation.

## What this page is for
- Assign and revoke data table access per organisation.
- Maintain strict **data isolation** between tenants.

## Best practices
- Cross-check with the **GDPR page** before assigning sensitive tables.
- Keep a **changelog** of assignments in the audit log.

## Useful links
- [Organisations](/admin/orgs)
- [GDPR](/admin/gdpr)`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // ADMIN — GDPR / RIGHT TO ERASURE
  // ──────────────────────────────────────────────────────────────────────
  "admin.gdpr": {
    title: "GDPR — Right to erasure",
    title_fr: "RGPD — Droit à l'effacement",
    learnMoreHref: docHref("admin.gdpr"),
    fr: `## RGPD — Droit à l'effacement
Anonymisez un utilisateur ou effacez un contact ou une organisation. Chaque action est tracée dans le journal d'audit.

## À quoi sert cette page
- **Effacer un contact** (Article 17 RGPD) : supprime la fiche contact. Les appels associés conservent leur historique avec \`contact_id = NULL\`.
- **Anonymiser un utilisateur** : brouille l'email (\`deleted_<id>@axon.local\`), efface le nom affiché et purge ses memberships.
- **Supprimer une organisation** (super admin uniquement) : supprime l'org et toutes ses données liées en cascade. Irréversible.

## Comment l'utiliser
1. **Effacement contact** : collez l'UUID du contact dans le champ "Contact ID" → "Effacer" → confirmez.
2. **Anonymisation utilisateur** : collez l'UUID dans le champ "User ID" → "Effacer" → confirmez.
3. **Suppression organisation** : collez l'UUID dans le champ "Organisation ID" → "Effacer" → confirmez (super admin uniquement).

## Contexte légal
- En vertu de l'**Article 17 du RGPD**, les personnes ont le droit de demander l'effacement de leurs données personnelles.
- Vous devez répondre aux demandes d'effacement dans un délai de **30 jours**.
- Chaque effacement est **automatiquement journalisé** dans la piste d'audit.

## Bonnes pratiques
- **Vérifiez l'identité** de la personne demandant l'effacement avant d'agir.
- Conservez une **trace externe** (échange email confirmant la demande).
- Pour la **suppression d'organisation** : exportez les données si nécessaire à des fins légales.

## Pièges à éviter
- La suppression d'organisation est **irréversible** : pas d'annulation possible. Vérifiez deux fois l'ID avant de confirmer.
- L'**anonymisation utilisateur** n'est pas une suppression : la fiche reste mais les données personnelles sont effacées.
- Les enregistrements audio sont stockés séparément — vérifiez vos paramètres Twilio pour la suppression des médias.

## Liens utiles
- [Administration](/admin)
- [Organisations](/admin/orgs)`,

    fr_super_admin: `## RGPD — Droit à l'effacement (super admin)
Effacez des contacts, anonymisez des utilisateurs, ou supprimez des organisations entières.

## Bonnes pratiques
- Obtenez toujours une **confirmation écrite** de la demande avant d'agir.
- Pour la suppression d'org : **exportez les données** à des fins d'archivage légal.
- Consultez le **journal d'audit** après effacement pour confirmer l'enregistrement.

## Pièges à éviter
- **La suppression d'org est permanente** — pas de récupération possible. Confirmez l'UUID deux fois.
- L'effacement supprime les données personnelles mais **l'audio Twilio** doit être supprimé séparément.

## Liens utiles
- [Admin](/admin)
- [Tables de données](/admin/data-tables)`,
    default: `## GDPR — Right to erasure
Anonymise a user or erase a contact or organisation. Every action is logged in the audit trail.

## What this page is for
- **Erase a contact** (Article 17 GDPR): deletes the contact record. Associated calls retain history with \`contact_id = NULL\`.
- **Anonymise a user**: scrambles their email (\`deleted_<id>@axon.local\`), clears their display name, and purges their memberships.
- **Delete an organisation** (super admin only): cascade-deletes the org and all its related data. Irreversible.

## How to use it
1. **Contact erasure**: paste the contact's UUID in the "Contact ID" field → click "Erase" → confirm.
2. **User anonymisation**: paste the user's UUID in the "User ID" field → click "Erase" → confirm.
3. **Organisation deletion**: paste the org UUID in the "Organisation ID" field → click "Erase" → confirm (super admin only).

## Legal context
- Under **GDPR Article 17**, individuals have the right to request erasure of their personal data.
- You must respond to erasure requests within **30 days**.
- Every erasure on this platform is **automatically logged** in the audit trail (who erased what, when).

## Best practices
- **Verify the identity** of the person requesting erasure before proceeding.
- Keep a **paper trail** outside the platform (email thread confirming the request).
- For **organisation deletion**: export the data first if you need it for legal purposes.

## Pitfalls to avoid
- Organisation deletion is **irreversible**: there is no undo. Double-check the org ID before confirming.
- **User anonymisation** is not the same as deletion: the user record remains but PII is removed.
- Call recordings are stored separately — check your Twilio settings for media deletion.

## Useful links
- [Administration](/admin)
- [Organisations](/admin/orgs)
- [Audit log](/admin)`,

    super_admin: `## GDPR — Right to erasure (super admin)
Erase contacts, anonymise users, or delete entire organisations.

## What this page is for
- Handle **GDPR Article 17** erasure requests across any organisation.
- **Organisation-level deletion** (cascade, irreversible) — super admin only.

## Best practices
- Always get a **written confirmation** of the erasure request before acting.
- For org deletion: **export the data** first for legal record-keeping.
- Check the **audit log** after erasure to confirm all actions were recorded.

## Pitfalls to avoid
- **Org deletion is permanent** — there is no recovery. Confirm the UUID twice.
- Erasure removes PII but **call audio** in Twilio must be deleted separately.

## Useful links
- [Admin](/admin)
- [Data tables](/admin/data-tables)`,
  },
};

/** Resolve markdown content for a (contextKey, role, lang) triplet.
 *  Priority when lang="fr": fr_role → fr → English role → English default.
 *  Priority when lang="en" (or unset): English role → English default.
 */
export function resolveHelp(
  contextKey: string,
  role: HelpRole | null | undefined,
  lang?: "fr" | "en" | null
): { title: string; body: string; learnMoreHref?: string } | null {
  const entry = HELP[contextKey];
  if (!entry) return null;

  let body: string;
  const title = (lang === "fr" && entry.title_fr) ? entry.title_fr : entry.title;

  if (lang === "fr") {
    const frRole = role ? (entry[`fr_${role}` as keyof HelpEntry] as string | undefined) : undefined;
    body = frRole ?? entry.fr ?? (role ? (entry[role as keyof HelpEntry] as string | undefined) : undefined) ?? entry.default;
  } else {
    body = (role ? (entry[role as keyof HelpEntry] as string | undefined) : undefined) ?? entry.default;
  }

  return { title, body, learnMoreHref: entry.learnMoreHref };
}

/** Returns all context keys that have at least a `default` body. */
export function allContextKeys(): string[] {
  return Object.keys(HELP);
}

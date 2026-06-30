# Audit fonctionnel utilisateur — Cahier de recette Axon / OCC

> Objectif : passer en revue **chaque écran et chaque fonction** de la
> plateforme du point de vue de l'utilisateur final, afin de dérouler un
> **test de fonctionnalité (recette)** complet et reproductible.
>
> Périmètre : le front Next.js (`web/`) déployé sur Vercel. Le worker vocal
> Python (`agent/`) et le dialer (`dialer/`) sont couverts en § 12 (chaînes
> de bout-en-bout) — leur recette d'infrastructure détaillée reste dans
> [`END_TO_END_TEST.md`](END_TO_END_TEST.md).
>
> Mode d'emploi : pour chaque cas, suivre les **Étapes**, comparer au
> **Résultat attendu**, puis cocher **OK / KO** et noter l'anomalie.
> Les identifiants de cas (`AUTH-01`, `DASH-03`, …) servent au suivi.

---

## 0. Comment utiliser ce cahier

1. **Préparer 3 comptes de test** couvrant les rôles clés :
   - un `owner`/`admin` (voit tout),
   - un `manager` ou `supervisor` (pilotage + supervision),
   - un `agent` (poste de travail uniquement),
   - + si possible un `super_admin` (espace `/admin` plateforme).
2. **Environnement** : recette sur l'URL de preview Vercel, données de test
   isolées (organisation « SANDBOX ») pour ne pas polluer la prod.
3. **Pré-requis techniques** : migrations Supabase appliquées, variables
   d'environnement présentes (voir `/settings` → vérification des clés, et
   [`ENV_VARS.md`](ENV_VARS.md)).
4. **Statut** par cas : `OK` / `KO` / `N/A` (fonction non activée pour ce
   tenant) / `BLOQUÉ` (dépend d'une clé tierce manquante).

### Légende de criticité

| Niveau | Sens |
|---|---|
| 🔴 Critique | Bloque l'usage métier principal (login, appel, qualification). |
| 🟠 Majeur | Dégrade fortement l'expérience mais contournable. |
| 🟢 Mineur | Confort, cosmétique, secondaire. |

---

## 1. Cartographie des espaces & rôles

L'application a **trois espaces** distincts (groupes de routes Next.js) :

| Espace | Route group | Pour qui | Navigation |
|---|---|---|---|
| **Authentification** | `(auth)` | visiteur non connecté | aucune sidebar |
| **Client** | `(client)` | tous les rôles d'une organisation | `ClientSidebar` |
| **Admin plateforme** | `(admin)` | `super_admin` uniquement | `AdminSidebar` |

### Rôles (membership.role)

`super_admin`, `owner`, `admin`, `manager`, `supervisor`, `builder`,
`agent`, `analyst`, `viewer`.

### Matrice modules → rôles (défauts)

La visibilité de chaque entrée de menu dépend du **module** et du rôle
(`lib/permissions.ts`). À recetter : se connecter avec chaque rôle et
vérifier que **seules** les entrées attendues apparaissent.

| Module | owner/admin | manager | supervisor | agent | analyst/viewer | builder |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| copilot | ✅ | ✅ | — | — | — | — |
| desk (poste) | ✅ | ✅ | ✅ | ✅ | — | — |
| alerts | ✅ | ✅ | ✅ | — | — | — |
| agents (config IA) | ✅ | ✅ | — | — | — | ✅ |
| campaigns | ✅ | ✅ | — | — | — | — |
| workflows | ✅ | ✅ | — | — | — | ✅ |
| flows / IVR | ✅ | ✅ | — | — | — | ✅ |
| queues | ✅ | ✅ | ✅ | — | — | — |
| contacts (CRM) | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| numbers | ✅ | ✅ | — | — | — | — |
| team | ✅ | ✅ | — | — | — | — |
| settings | ✅ | ✅ | — | — | — | — |

> ⚠️ Cas particulier `agent` : même au sein d'un module visible, les pages
> « config/ops » (`/campaigns`, `/agents`, `/scripts`, `/numbers`, `/copilot`…)
> sont masquées. L'agent ne voit que **Mon poste**, **Mon calendrier**,
> **Mes patients**, le **Tableau d'analyse** et le **CRM**.

### Cas de recette — Contrôle d'accès (ACCESS)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| ACCESS-01 | 🔴 | Se connecter en `agent`, inspecter la sidebar | Voir Mon poste / Calendrier / Mes patients / Dashboard / CRM ; **pas** Campagnes, Agents, Numéros, Team, Settings | |
| ACCESS-02 | 🔴 | En `agent`, saisir l'URL `/campaigns` à la main | Redirection / refus d'accès (middleware ou garde API), pas de fuite de données | |
| ACCESS-03 | 🟠 | Se connecter en `supervisor` | Voir Supervision + Supervision live + Files d'attente ; **pas** Campagnes/Agents/Numéros | |
| ACCESS-04 | 🟠 | En `manager`, vérifier l'accès à Rapports pilotage | Entrée « Rapports pilotage » visible et fonctionnelle | |
| ACCESS-05 | 🔴 | En `super_admin`, vérifier le bouton « Mode admin Axon » en bas de sidebar | Bouton présent → mène à `/admin` | |
| ACCESS-06 | 🟠 | En `super_admin`, sous-traiter via `visible_modules` (retirer un module sur la membership) | L'entrée disparaît de la sidebar après rechargement | |

---

## 2. Authentification & onboarding `(auth)`

Écrans : `/login`, `/signup`. Plus le sélecteur d'organisation
(`OrgSwitcher`) et l'invitation (`/api/auth/accept-invite`).

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| AUTH-01 | 🔴 | Ouvrir `/login`, saisir identifiants valides | Connexion → redirection vers l'app (`/` ou `/dashboard`) | |
| AUTH-02 | 🔴 | `/login` avec mauvais mot de passe | Message d'erreur clair, pas de connexion | |
| AUTH-03 | 🟠 | `/signup` créer un compte (email valide) | Compte créé / email de confirmation selon config Supabase | |
| AUTH-04 | 🔴 | Accéder à une page protégée sans session | Redirection vers `/login` | |
| AUTH-05 | 🟠 | Accepter une invitation via lien (`accept-invite`) | Rattachement à l'organisation avec le bon rôle | |
| AUTH-06 | 🔴 | Se déconnecter (« Quitter ») | Session purgée, retour `/login`, back impossible | |
| AUTH-07 | 🟠 | Utilisateur multi-orgs : changer d'organisation via `OrgSwitcher` | Cookie `axon.org_id` mis à jour, données rechargées pour la nouvelle org | |
| AUTH-08 | 🟢 | Basculer thème clair/sombre et langue (`ThemeLangSwitcher`) | Préférence appliquée et persistée | |

---

## 3. Overview — Pilotage & supervision

### 3.1 Démarrage guidé `/start` (STARxx)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| START-01 | 🟢 | Ouvrir `/start` (1ʳᵉ connexion) | Parcours d'amorçage : étapes claires (créer agent, importer contacts, lancer campagne…) avec liens fonctionnels | |

### 3.2 Tableau d'analyse `/dashboard` (DASH)

Composant riche à onglets (`DashboardClient`) : Stats, Call Logs, Director,
NHS-Suivi, Errors/Alerts, AI Insights, Copilot. Sélecteur de période
(`PeriodBar`), KPI (`KpiGrid`), graphes volume, drill-down (`DrillSheet`).

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| DASH-01 | 🔴 | Ouvrir `/dashboard` | KPI principaux chargés (appels, taux de réponse, qualif…), aucun « NaN »/spinner bloqué | |
| DASH-02 | 🟠 | Changer la période (jour / semaine / plage perso) | KPI + graphes se recalculent | |
| DASH-03 | 🟠 | Onglet **Call Logs**, ouvrir le détail d'un appel | Volet détail (`CallDetailPane`) : transcript, enregistrement, dispo | |
| DASH-04 | 🟠 | Lire/écouter l'enregistrement (`call-recording`) | Lecteur audio fonctionnel (URL signée valide) | |
| DASH-05 | 🟠 | Onglet **AI Insights**, poser une question (chat insights) | Réponse générée à partir des données réelles | |
| DASH-06 | 🟠 | Onglet **NHS-Suivi** : assigner un patient | Patient assigné, reflété dans Mes patients de l'agent cible | |
| DASH-07 | 🟠 | Onglet **Errors/Alerts** : marquer « rappelé » | Statut mis à jour (`mark-recalled`) | |
| DASH-08 | 🟢 | Bouton **Sync Twilio** / **Sync Retell** | Synchro déclenchée, compteur d'appels mis à jour | |
| DASH-09 | 🟠 | Cliquer un KPI pour drill-down | Feuille de détail listant les appels correspondants | |
| DASH-10 | 🟢 | Bouton **Rapport** (export) | Génère / télécharge le rapport de la période | |

### 3.3 Co-pilot manager `/copilot` (COPI)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| COPI-01 | 🟠 | Ouvrir `/copilot`, poser une question métier | Réponse en langage naturel avec données du tenant | |
| COPI-02 | 🟠 | Demander une action (ex : créer une tâche / qualifier) | Proposition d'action → **confirmation requise** avant exécution (`actions/[id]/confirm`) | |
| COPI-03 | 🔴 | Confirmer puis annuler une action sensible | Exécutée seulement après confirmation ; annulation sans effet de bord ; journalisée (audit) | |

### 3.4 Rapports pilotage `/rapports` (RAP)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| RAP-01 | 🟠 | En `manager`, générer un rapport (pilotage hebdo) | Rapport produit : funnel d'appels, répartition qualif, vigilance, plan d'action | |
| RAP-02 | 🟢 | En `supervisor`, tenter d'accéder à `/rapports` | Accès refusé (réservé manager+) | |
| RAP-03 | 🟢 | Visualiser / exporter le rapport (`ReportViewer`) | Rendu lisible, export OK | |

### 3.5 Mon poste `/desk` (DESK)

Poste de travail agent (`DeskWorkstation`) : file de tâches, softphone,
fiche contact, script, prise de note, qualification.

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| DESK-01 | 🔴 | En `agent`, ouvrir `/desk` ; badge de tâches en sidebar | File personnelle + pool affichées ; badge rouge = nb de tâches « à passer à l'humain » | |
| DESK-02 | 🔴 | **Réclamer** une tâche du pool (`claim`) | Tâche assignée à l'agent, retirée du pool | |
| DESK-03 | 🔴 | Se mettre **disponible** (présence/register) | Statut « en ligne », éligible à la distribution | |
| DESK-04 | 🔴 | Émettre un appel via le softphone (`desk/dial` / SDK) | Appel passé, état temps réel (sonnerie/connecté), audio bidirectionnel | |
| DESK-05 | 🔴 | Pendant l'appel : ouvrir la fiche contact + script | `ContactPanel` + `ScriptPanel` chargent les bonnes données | |
| DESK-06 | 🟠 | Prendre une note d'appel (`CallNotePanel`) | Note enregistrée et rattachée au contact/appel | |
| DESK-07 | 🔴 | **Qualifier** l'appel (disposition) | Disposition enregistrée, tâche clôturée | |
| DESK-08 | 🟠 | **Transférer** vers un humain (`TransferModal` / transfer) | Transfert effectif, autre agent reçoit l'appel | |
| DESK-09 | 🟠 | Mettre en **attente** / reprendre (`hold`) | Musique d'attente, reprise sans coupure | |
| DESK-10 | 🟠 | **Libérer** une tâche (`release`) | Tâche renvoyée au pool | |
| DESK-11 | 🟢 | Se déconnecter / passer indisponible (`release` présence) | Retiré de la distribution | |

### 3.6 Mon calendrier `/mon-calendrier` (CAL)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| CAL-01 | 🟠 | Ouvrir `/mon-calendrier` | RDV / rappels planifiés affichés (`MyCalendarClient`) | |
| CAL-02 | 🟠 | Ouvrir un créneau → fiche patient (`PatientDrawer`) | Détail patient + actions (rappeler, qualifier) | |

### 3.7 Supervision `/desk/supervise` & `/supervise/live` (SUP)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| SUP-01 | 🟠 | En `supervisor`, ouvrir `/desk/supervise` | Vue agents/tâches, possibilité de réassigner (`tasks/[id]/reassign`) | |
| SUP-02 | 🟠 | **Réassigner** une tâche à un autre agent | Tâche déplacée, agent cible notifié | |
| SUP-03 | 🔴 | `/supervise/live` : liste des appels en cours (`agents-live`) | Appels live listés en temps réel | |
| SUP-04 | 🟠 | **Écoute discrète** d'un appel en cours (token supervision) | Audio entrant capté sans être entendu de l'appelant | |
| SUP-05 | 🟠 | **Chuchotement / barge** (handoff / supervision) | L'agent entend le superviseur (whisper) / superviseur prend la main | |

### 3.8 Mes patients `/mes-patients` (PAT)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| PAT-01 | 🟠 | Ouvrir `/mes-patients` (`MyPatientsClient`) | Liste des patients assignés à l'agent | |
| PAT-02 | 🟠 | Ouvrir une fiche patient, ajouter une note (`patient-note`) | Note persistée | |
| PAT-03 | 🟠 | Mettre à jour une ligne patient (`patient-row`) | Modification enregistrée (data-table) | |

### 3.9 Alertes `/alerts` (ALE)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| ALE-01 | 🟠 | Ouvrir `/alerts` (`AlertsClient`) | Alertes en cours listées (règles d'alerte évaluées) | |
| ALE-02 | 🟠 | Créer / éditer une **règle d'alerte** (`alert-rules`) | Règle sauvegardée, prise en compte | |
| ALE-03 | 🟠 | Acquitter / résoudre une alerte (`alerts/[id]`) | Statut mis à jour | |

---

## 4. Configuration — Agents IA & voix

### 4.1 Agents `/agents`, `/agents/new`, `/agents/[id]`, `/agents/[id]/edit` (AGT)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| AGT-01 | 🔴 | `/agents` : liste | Tous les agents de l'org, plus récents en premier | |
| AGT-02 | 🔴 | **Créer un agent** (`/agents/new`, `AgentForm`) | Choix LLM (openai/anthropic/minimax) + modèle, langue, voix, modèle TTS, emotion, vitesse, greeting, prompt système ; sauvegarde OK | |
| AGT-03 | 🔴 | Ouvrir un agent → onglet **Session** : « Écouter cette voix » | Synthèse TTS jouée en navigateur (valide la chaîne voix) | |
| AGT-04 | 🔴 | Onglet **Session** : « Démarrer la session vocale » | Connexion LiveKit, conversation WebRTC bidirectionnelle avec l'agent | |
| AGT-05 | 🟠 | Onglet **Chat** : envoyer un message (`/api/chat`) | Réponse streamée, augmentée RAG si activé | |
| AGT-06 | 🟠 | **Éditer** l'agent (`/edit`) puis sauvegarder | Mise à jour partielle persistée | |
| AGT-07 | 🟠 | Onglet **Workflows n8n** : binder un workflow | Workflow lié devient outil de l'agent | |
| AGT-08 | 🟠 | Onglet **RAG/Documents** : importer un `.txt`/`.md` | Découpage + embeddings, document listé | |
| AGT-09 | 🟠 | Activer **Recherche documentaire** + top-K | Le chat/voix injecte les passages pertinents | |
| AGT-10 | 🟠 | **Versions de prompt** : modifier puis restaurer (`prompt-versions/[v]/restore`) | Historique présent, restauration fonctionnelle | |
| AGT-11 | 🟢 | **Santé de l'agent** (`agents/[id]/health`) | Diagnostic clés/config OK ou erreurs explicites | |
| AGT-12 | 🔴 | **Supprimer** un agent | Suppression en cascade (bindings + docs), confirmation préalable | |

### 4.2 Appel sortant `/outbound-call` (OUT)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| OUT-01 | 🔴 | Saisir un numéro + choisir un agent IA → lancer (`/api/outbound-call`) | Appel sortant initié, agent IA décroche côté appelé | |
| OUT-02 | 🟠 | Numéro invalide | Validation/erreur claire, pas d'appel | |

### 4.3 Teams IA `/teams`, `/teams/[id]` (TEAM-IA)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| TEAMIA-01 | 🟠 | Créer une **Team IA** (orchestration multi-agents) | Team créée (`TeamsClient`) | |
| TEAMIA-02 | 🟠 | Éditer le **flux d'équipe** (`TeamFlowEditor`) | Nœuds/agents reliés, sauvegarde OK | |

### 4.4 Scripts `/scripts` (SCR)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| SCR-01 | 🟠 | Créer/éditer un script (`ScriptEditor` / `VisualScriptEditor`) | Script sauvegardé | |
| SCR-02 | 🟠 | **Versionner** un script (`scripts/[id]/versions`) | Historique des versions | |
| SCR-03 | 🟢 | **Fusionner** des scripts (`scripts/merge`) | Fusion produite correctement | |

### 4.5 Bibliothèque persona `/agents/library` (PERS)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| PERS-01 | 🟠 | Parcourir la bibliothèque (`PersonaLibraryClient`) | Personas affichés avec aperçu (`PersonaPreview`) | |
| PERS-02 | 🟠 | **Cloner** un persona en agent (`personas/[slug]/clone`) | Nouvel agent pré-rempli créé | |

### 4.6 Voice Studio `/voices` (VOX)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| VOX-01 | 🔴 | Uploader un échantillon (10 s–5 min, mono, ≤20 Mo) + `voice_id` valide → **Cloner** | Voix clonée chez MiniMax + ligne en base | |
| VOX-02 | 🟠 | « ▶ Tester » sur une voix | Audio MP3 synthétisé joué | |
| VOX-03 | 🟠 | Panneau **Diagnostic MiniMax** | Statut par check (clé, group_id…) avec message d'erreur exact | |
| VOX-04 | 🟢 | Voix multi-fournisseurs (ElevenLabs / Cartesia / Replicate) si configurées | Listées et testables selon clés présentes | |
| VOX-05 | 🟠 | **Supprimer** une voix | Voix retirée de la liste | |

---

## 5. Opérations — Campagnes & automatisation

### 5.1 Campagnes `/campaigns`, `/campaigns/new`, `/campaigns/new/wizard`, `/campaigns/[id]` (CMP)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| CMP-01 | 🔴 | `/campaigns` : liste avec statuts | Campagnes listées, actions par ligne (`CampaignRowActions`) | |
| CMP-02 | 🔴 | **Assistant** `/campaigns/new/wizard` : créer une campagne pas-à-pas | Sélection liste de contacts, agent, numéro émetteur, planning, moteur dynamique | |
| CMP-03 | 🟠 | **Preflight** avant lancement (`PreflightPanel`) | Contrôles (numéros valides, DNC, quotas) ; bloque si KO | |
| CMP-04 | 🔴 | **Démarrer** la campagne (`campaigns/[id]/start`) | Cibles passées en file, appels sortants déclenchés | |
| CMP-05 | 🟠 | Suivre la progression (`CampaignDetailClient`, `targets`) | Compteurs cibles (à appeler / fait / qualifié) en quasi temps réel | |
| CMP-06 | 🟠 | **Éditer** une campagne (`EditCampaignModal`) | Modification persistée | |
| CMP-07 | 🟠 | **Mettre en pause / reprendre / stopper** | État respecté, aucun appel hors fenêtre | |
| CMP-08 | 🟢 | Config moteur dynamique (`DynamicEngineConfig`) | Paramètres de cadence sauvegardés | |

### 5.2 Automatisation `/workflows` & `/workflows/automations/[id]` & n8n (WF)

Deux briques : **automatisations natives** (`NativeAutomationsPanel`,
moteur `lib/automations/`) et **n8n** (`/workflows/n8n`, éditeur iframe).

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| WF-01 | 🟠 | `/workflows` : voir automatisations natives + connecteurs | Liste chargée, état (actif/inactif) | |
| WF-02 | 🟠 | Créer une automatisation depuis un template (`/workflows/new`) | Workflow créé (echo / book-appointment / send-email / supabase-insert) | |
| WF-03 | 🟠 | Éditer une automatisation native (`AutomationEditor`) | Étapes ajoutées/réordonnées, sauvegarde OK | |
| WF-04 | 🔴 | **Exécuter** une automatisation (`automations/[id]/run`) | Run déclenché, résultat consultable (`runs/[runId]`) | |
| WF-05 | 🟠 | Gérer les **identifiants** de connecteurs (`CredentialsPanel`) | Secrets stockés, non exposés en clair | |
| WF-06 | 🟢 | **Cron** d'automatisations (`automations/cron`) | Planification respectée | |
| WF-07 | 🟠 | n8n `/workflows/n8n` : lister workflows + tags + webhooks | Découverte OK (clé API n8n) | |
| WF-08 | 🟠 | Éditeur n8n embarqué (`/workflows/[id]`) | iframe affiche l'éditeur OU fallback « ouvrir dans n8n » | |
| WF-09 | 🟠 | **Déclencher** un webhook n8n (`/api/n8n/trigger`) | Webhook reçoit le payload | |
| WF-10 | 🟢 | Webhooks d'org sortants (`OrgWebhooksPanel`, `/api/webhooks`) | Création/édition d'un endpoint, signature HMAC | |

### 5.3 Flows / IVR `/flows`, `/flows/[id]/edit` (FLOW)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| FLOW-01 | 🟠 | Créer un flow IVR (`/flows`) | Flow créé | |
| FLOW-02 | 🟠 | Éditer nœuds + transitions (`steps`, `edges`) | Graphe sauvegardé | |
| FLOW-03 | 🔴 | Appeler le numéro relié → exécution TwiML (`flows/[id]/twiml/start` + `handle`) | Menu vocal joué, choix DTMF routent correctement | |

### 5.4 Files d'attente `/queues` (QUE)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| QUE-01 | 🟠 | Créer une file (`QueuesClient`) | File créée | |
| QUE-02 | 🟠 | Gérer les **membres** d'une file (`queues/[id]/members`) | Agents ajoutés/retirés | |
| QUE-03 | 🟠 | Appel entrant en file → temps d'attente (`twilio/queue-wait`) | Mise en file, musique, distribution au 1ᵉʳ agent libre | |

---

## 6. Données — CRM, contacts & numéros

### 6.1 CRM / Contacts `/contacts`, `/contacts/[id]`, `/contacts/unsorted` (CRM)

Inclut listes de contacts, import CSV, data-tables dynamiques.

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| CRM-01 | 🔴 | `/contacts` : liste + recherche/filtre (`ContactsClient`) | Contacts du tenant listés, pagination/recherche OK | |
| CRM-02 | 🔴 | **Importer** un CSV (`contacts/import`, template via `contacts/template`) | Mapping colonnes, import, doublons gérés | |
| CRM-03 | 🟠 | Ouvrir une fiche contact (`/contacts/[id]`) + interactions | Historique d'interactions affiché | |
| CRM-04 | 🟠 | Créer une **liste de contacts** (`CreateListModal`) + import dans la liste | Liste créée, contacts rattachés (`contact-lists/[id]/import`) | |
| CRM-05 | 🟠 | **Data-tables** : créer une table dynamique (`CreateDataTableModal`) | Table + schéma créés | |
| CRM-06 | 🟠 | Ajouter/éditer/supprimer des lignes (`data-tables/[id]/rows`, `bulk`) | CRUD lignes OK, import en masse | |
| CRM-07 | 🟠 | **Connecter** une table à un usage (`ConnectTableModal`, `assignable`) | Table assignable à une campagne/agent | |
| CRM-08 | 🟢 | `/contacts/unsorted` : contacts non triés | Tri/affectation possible | |

### 6.2 Numéros `/numbers`, `/numbers/[id]`, `/numbers/health` (NUM)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| NUM-01 | 🟠 | `/numbers` : liste des numéros (`NumbersClient`) | Numéros du tenant + statut | |
| NUM-02 | 🟠 | **Rechercher/acheter** un numéro (`numbers/search`) | Résultats par pays/indicatif, achat OK | |
| NUM-03 | 🟠 | **Importer** des numéros (`numbers/import`, `bulk`) | Import en masse OK | |
| NUM-04 | 🔴 | **Configurer le webhook** d'un numéro (`numbers/[id]/configure-webhook`) | Webhook Twilio/Telnyx pointé vers l'app, appel entrant routé | |
| NUM-05 | 🟠 | Détail numéro (`NumberDetailClient`) : éditer | Modification persistée | |
| NUM-06 | 🟠 | **Libérer** un numéro (`ReleaseButton` / release) | Numéro relâché, confirmation préalable | |
| NUM-07 | 🟠 | `/numbers/health` : santé des numéros | Réputation/spam, statut par numéro | |

---

## 7. Compte — Équipe & paramètres

### 7.1 Équipe `/team`, `/teams` humaines (TEAM)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| TEAM-01 | 🔴 | `/team` : lister les membres (`TeamPageClient`) | Membres + rôles affichés | |
| TEAM-02 | 🔴 | **Inviter** un membre (email + rôle) (`team/invites`) | Invitation envoyée, statut « en attente » | |
| TEAM-03 | 🟠 | Modifier le **rôle** d'un membre (`team/members/[user_id]`) | Rôle mis à jour, accès recalculé | |
| TEAM-04 | 🟠 | Restreindre les **modules visibles** d'un membre | `visible_modules` appliqué (cf. ACCESS-06) | |
| TEAM-05 | 🟠 | Révoquer une invitation / retirer un membre | Accès supprimé immédiatement | |

### 7.2 Paramètres `/settings` (SET)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| SET-01 | 🔴 | Ouvrir `/settings` : présence des variables d'env | Statut par service (Supabase, OpenAI, LiveKit, MiniMax, Deepgram, n8n, Twilio) | |
| SET-02 | 🟠 | Modifier les paramètres d'organisation | Sauvegarde persistée | |
| SET-03 | 🟢 | Réglages divers (musique d'attente, caller-id par défaut…) | Appliqués | |

### 7.3 Aide `/help`, `/help/how-it-works` (HELP)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| HELP-01 | 🟢 | Ouvrir `/help` et le drawer d'aide contextuelle (`HelpDrawer`) | Contenu d'aide affiché, navigation par sections | |
| HELP-02 | 🟢 | `/help/how-it-works` | Explication du fonctionnement lisible | |

---

## 8. Espace Admin plateforme `(admin)` — `super_admin`

### 8.1 Vue d'ensemble `/admin` (ADM)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| ADM-01 | 🔴 | En `super_admin`, ouvrir `/admin` | Vue plateforme (toutes orgs), KPI globaux | |
| ADM-02 | 🔴 | En rôle non super_admin, tenter `/admin` | Accès refusé | |

### 8.2 Clients `/admin/orgs` (ORG)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| ORG-01 | 🔴 | Lister les organisations (`OrgsAdminClient`) | Toutes les orgs + métadonnées | |
| ORG-02 | 🟠 | Créer / éditer une organisation | Org créée, propriétaire rattaché | |
| ORG-03 | 🔴 | **Impersonate** une org (`orgs/[id]/impersonate`) | Bascule dans le contexte de l'org, bandeau d'avertissement, retour possible | |
| ORG-04 | 🟠 | Gérer les **utilisateurs** plateforme (`admin/users`) | CRUD utilisateurs | |
| ORG-05 | 🟠 | Gérer les **invitations** (`admin/invitations`) | Suivi des invitations cross-org | |

### 8.3 Copilote Super Admin `/admin/copilot` (ADMCO)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| ADMCO-01 | 🟠 | Poser une question plateforme | Réponse agrégée multi-orgs | |

### 8.4 Connecteurs entrants `/admin/inbound` (INB)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| INB-01 | 🟠 | Configurer un connecteur entrant (`InboundConnectorsClient`, `inbound-secrets`) | Secret entrant créé, leads reçus via `/api/leads/inbound` | |
| INB-02 | 🔴 | Envoyer un lead de test sur le webhook entrant | Lead créé dans la bonne org (signature validée) | |

### 8.5 Conformité DNC `/admin/compliance` (DNC)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| DNC-01 | 🔴 | Ajouter un numéro à la liste **Do-Not-Call** (`admin/dnc`) | Numéro bloqué pour toute campagne | |
| DNC-02 | 🔴 | Lancer une campagne incluant un numéro DNC | Numéro exclu au preflight (cf. CMP-03) | |
| DNC-03 | 🟠 | Retirer un numéro de la DNC (`admin/dnc/[id]`) | Numéro de nouveau appelable | |

### 8.6 RGPD `/admin/gdpr` (RGPD)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| RGPD-01 | 🔴 | Effacer un **contact** (`admin/gdpr/erase`) | Contact supprimé, action journalisée (audit) | |
| RGPD-02 | 🔴 | **Anonymiser** un utilisateur | Email scramblé + memberships purgées | |
| RGPD-03 | 🔴 | Effacer une **organisation** en cascade (super_admin only) | Suppression complète + journal d'audit | |

### 8.7 Facturation `/admin/billing` (BILL)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| BILL-01 | 🟠 | Consulter les plans & usage (`billing/plans`, `billing/usage`) | Plans + consommation par org | |
| BILL-02 | 🟠 | Lancer un **checkout** (`billing/checkout`) | Redirection paiement, retour OK | |
| BILL-03 | 🟠 | Webhook facturation (`billing/webhook`) | Événement traité, abonnement mis à jour | |
| BILL-04 | 🟢 | Tables de données plateforme (`admin/data-tables`) | Consultation OK | |

---

## 9. Téléphonie temps réel & webhooks (TEL)

Ces routes ne sont pas des écrans mais conditionnent tout le métier. À
recetter avec de vrais appels (voir [`TELEPHONY.md`](TELEPHONY.md)).

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| TEL-01 | 🔴 | Appel **entrant** sur un numéro Twilio (`twilio/voice-inbound`) | Routé vers l'agent IA / la file / le flow configuré | |
| TEL-02 | 🔴 | Appel **sortant** (`twilio/voice-outbound`) | Connexion à l'appelé, média OK | |
| TEL-03 | 🔴 | StatusCallback Twilio (`twilio/status`) | `public.calls` + `campaign_targets` mis à jour (statut + AMD/AnsweredBy) | |
| TEL-04 | 🟠 | Enregistrement (`twilio/recording` + `recording-status`) | MP3 téléchargé, uploadé dans Storage, URL signée 7 j sur `calls.recording_url` | |
| TEL-05 | 🔴 | **Signature** Twilio invalide | Requête rejetée (HMAC `X-Twilio-Signature`) | |
| TEL-06 | 🟠 | Variante **Telnyx** (`telnyx-voice`, `telnyx/status`) | Équivalent fonctionnel + signature Telnyx validée | |
| TEL-07 | 🟠 | Webhook agent LiveKit (`livekit/agent-webhook`) | Événements de session traités | |
| TEL-08 | 🟠 | Outils de l'agent IA en appel : transfert humain (`agent-tools/transfer-to-human`), fin d'appel (`end-twilio-call`) | L'IA déclenche transfert/raccroché correctement | |
| TEL-09 | 🟠 | Webhook Retell (`retell/webhook`) si utilisé | Données d'appel synchronisées | |

---

## 10. Sécurité & multi-tenant (SEC)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| SEC-01 | 🔴 | Org A connectée, tenter d'accéder à un ID de ressource d'org B (contact, appel, agent) | 404/403, **aucune** donnée d'une autre org (RLS) | |
| SEC-02 | 🔴 | Inspecter les cookies | Session HttpOnly/Secure ; pas de token en `document.cookie` | |
| SEC-03 | 🟠 | Marteler `/api/token`, `/api/chat`, `/api/desk/dial`, `/api/voices/preview` | Rate-limit déclenché (HTTP 429) au-delà du seuil | |
| SEC-04 | 🟠 | Vérifier les **headers** de sécurité (réponse HTML) | `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP présents | |
| SEC-05 | 🟠 | Tenter d'embarquer l'app dans une iframe tierce | Bloqué par X-Frame-Options/CSP | |
| SEC-06 | 🟠 | Appeler une API en changeant l'`org_id` côté client | Le serveur ignore et utilise le contexte d'org serveur (`request-org`) | |
| SEC-07 | 🟢 | Appeler une route protégée sans le bon rôle | 403 (garde `permissions-server`) | |

---

## 11. Transverse — UX, i18n, responsive, santé (UX)

| ID | Criticité | Étapes | Résultat attendu | Statut |
|---|---|---|---|---|
| UX-01 | 🟢 | Basculer FR/EN partout (`i18n`) | Libellés traduits, pas de clé brute affichée | |
| UX-02 | 🟠 | Affichage mobile (<980 px) | Sidebar devient drawer (hamburger), backdrop, scroll lock OK | |
| UX-03 | 🟢 | Thème clair/sombre sur écrans principaux | Lisibilité conservée | |
| UX-04 | 🟢 | États de chargement (`Skeleton`) et toasts (`Toast`) | Feedback visible sur actions longues | |
| UX-05 | 🟠 | `/api/health` | 200 + statut des dépendances | |
| UX-06 | 🟢 | Page 404 / route inexistante | Page d'erreur propre, lien retour | |
| UX-07 | 🟠 | Navigateurs cibles (Chrome, Safari, Edge) + micro autorisé | Appels WebRTC fonctionnent ; permission micro demandée | |

---

## 12. Chaînes de bout-en-bout (E2E)

Scénarios métier complets — la vraie recette d'acceptation. Chacun
traverse plusieurs modules ; un échec ici prime sur les cas unitaires.

| ID | Scénario | Critères de succès |
|---|---|---|
| E2E-01 | **Voix → appel IA** : cloner une voix → créer un agent → session vocale navigateur → appel téléphonique réel répondu par l'agent → l'IA déclenche un workflow n8n → transfert à un humain | Voir le détail pas-à-pas dans [`END_TO_END_TEST.md`](END_TO_END_TEST.md) |
| E2E-02 | **Campagne sortante** : importer contacts → créer liste → wizard campagne → preflight (DNC OK) → démarrer → appels passés → statuts + enregistrements remontent au dashboard | Cibles qualifiées, `calls` peuplée, KPI dashboard cohérents |
| E2E-03 | **Inbound + desk** : appel entrant → file/flow → distribution à un agent dispo → fiche patient + script → qualification → note → clôture | Appel tracé, patient mis à jour, tâche fermée |
| E2E-04 | **Supervision live** : un appel en cours → superviseur écoute → whisper → barge/transfert | Audio capté, intervention sans coupure |
| E2E-05 | **Lead inbound → rappel** : lead via webhook entrant → contact créé dans la bonne org → tâche/rappel généré → agent rappelle | Lead routé, attribué, traité |
| E2E-06 | **RGPD** : demande d'effacement d'un contact/utilisateur → exécution super_admin → vérif disparition + journal d'audit | Données effacées, action auditée |
| E2E-07 | **Multi-tenant** : 2 orgs en parallèle, données strictement cloisonnées sur tous les modules | Aucune fuite inter-org (cf. SEC-01) |

---

## 13. Synthèse de recette

| Domaine | Cas | OK | KO | N/A | Commentaire |
|---|---|---|---|---|---|
| Accès & rôles (ACCESS) | 6 | | | | |
| Authentification (AUTH) | 8 | | | | |
| Pilotage & supervision (DASH/COPI/RAP/DESK/CAL/SUP/PAT/ALE) | 38 | | | | |
| Agents & voix (AGT/OUT/TEAM-IA/SCR/PERS/VOX) | 30 | | | | |
| Opérations (CMP/WF/FLOW/QUE) | 24 | | | | |
| Données (CRM/NUM) | 15 | | | | |
| Compte (TEAM/SET/HELP) | 10 | | | | |
| Admin plateforme (ADM…BILL) | 20 | | | | |
| Téléphonie (TEL) | 9 | | | | |
| Sécurité (SEC) | 7 | | | | |
| Transverse (UX) | 7 | | | | |
| E2E | 7 | | | | |

**Verdict global** : ☐ Conforme  ☐ Conforme avec réserves  ☐ Non conforme

---

### Annexe — Docs de référence

- [`END_TO_END_TEST.md`](END_TO_END_TEST.md) — recette d'installation E2E (voix → appel).
- [`USER_GUIDE.md`](USER_GUIDE.md) — guide utilisateur.
- [`HOW_IT_WORKS.md`](HOW_IT_WORKS.md) — fonctionnement détaillé.
- [`TELEPHONY.md`](TELEPHONY.md) — pipeline téléphonie & webhooks.
- [`ARCHITECTURE_V2.md`](ARCHITECTURE_V2.md) — architecture multi-tenant v2.
- [`ENV_VARS.md`](ENV_VARS.md) — variables d'environnement par service.
- [`CONNECTORS.md`](CONNECTORS.md) — connecteurs entrants/sortants.
- [`COPILOT.md`](COPILOT.md) — copilote IA.
</content>
</invoke>

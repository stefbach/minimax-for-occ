# Audit complet de la plateforme Axon

> **But de ce document** : comprendre précisément comment la plateforme fonctionne *aujourd'hui* (architecture, téléphonie, base de données, intégrations, déploiement) afin de migrer le domaine web vers **`axon-ai.tech`** proprement, **sans rien casser** — en particulier les appels en production.
>
> Rédigé à partir d'une lecture directe du dépôt `minimax-for-occ`. Chaque affirmation cite un fichier de preuve.

---

## En 30 secondes (résumé pour décideur)

- La plateforme = **4 briques** : le site+app **Web** (Vercel), l'**Agent** vocal Python (Fly.io / LiveKit Cloud), le **Dialer** d'appels sortants (Fly.io), et **n8n** (automatisations, hébergé à part).
- **Migrer le domaine = accrocher `axon-ai.tech` au projet Vercel `minimax-for-occ`.** Le code ne change pas ; l'ancienne URL `.vercel.app` reste valable.
- **Rien ne casse** si on respecte l'ordre : (1) déplacer le domaine, (2) *ensuite* mettre à jour les variables d'URL, (3) recâbler les webhooks tiers (Twilio, LiveKit, n8n…).
- **Bonne nouvelle** : aucun **appel entrant PSTN** n'est actif aujourd'hui (`inbound_enabled` désactivé par défaut) → la migration peut se concentrer sur le sortant, sans risque côté entrant.
- **Le point le plus discret à ne pas rater** : la variable **`NEXT_PUBLIC_APP_URL` sur l'Agent (Fly `axon-agent`)** — sans elle, tout le traitement après-appel devient silencieusement inopérant.

---

## Table des matières
1. [Architecture générale](#1-architecture-générale)
2. [L'application web (Next.js / Vercel)](#2-lapplication-web-nextjs--vercel)
3. [La téléphonie & le pipeline vocal](#3-la-téléphonie--le-pipeline-vocal)
4. [La base de données (Supabase)](#4-la-base-de-données-supabase)
5. [Les intégrations externes](#5-les-intégrations-externes)
6. [Déploiement, variables d'environnement & opérations](#6-déploiement-variables-denvironnement--opérations)
7. [Synthèse : migrer le domaine sans rien casser](#7-synthèse--migrer-le-domaine-sans-rien-casser)
8. [Anomalies & dette technique repérées](#8-anomalies--dette-technique-repérées)

---

## 1. Architecture générale

La plateforme est composée de **4 briques déployables** (dont 3 dans ce dépôt) :

| Brique | Répertoire | Déploiement | Nom | Rôle |
|---|---|---|---|---|
| **Web** | `web/` | **Vercel** | Projet Vercel `minimax-for-occ` | App Next.js 15 : homepage publique, connexion, console client, console admin, **toutes les API `/api/*`**, crons, et **hôte de tous les webhooks** (Twilio, Telnyx, LiveKit, n8n…). **C'est la cible de la migration de domaine.** |
| **Agent** | `agent/` | **Fly.io** (`axon-agent`) **et/ou LiveKit Cloud** | `axon-agent` / agent LK `CA_PFUfvaBhC8Wk` | Worker vocal Python : écoute (STT), réfléchit (LLM), parle (TTS) en temps réel dans l'appel. **Ne sert aucune URL entrante** ; il *rappelle* le web en HTTP après l'appel. |
| **Dialer** | `dialer/` | **Fly.io** | App Fly **`minimax-for-occ`** | Worker Node.js : déclenche les **appels sortants** de campagne, réconcilie les coûts Twilio. |
| **n8n** | `n8n/` (templates) | Hébergé à part (Hostinger / n8n Cloud) | — | Automatisations no-code + connecteurs de **leads entrants** (Google/Facebook Ads → Axon). |

### ⚠️ Deux pièges de nommage à connaître avant de toucher au déploiement
1. **`minimax-for-occ` désigne DEUX choses** : le **projet Vercel** (le web) **ET** l'**app Fly du dialer** (`dialer/fly.toml:1`). Ne jamais faire `fly deploy -a minimax-for-occ` en croyant toucher le web — ça vise le dialer. Le web, lui, se déploie via Vercel (git push).
2. **L'Agent a deux cibles de déploiement concurrentes**, toutes deux vivantes : Fly (`axon-agent`, via `fly-deploy.yml`) **et** LiveKit Cloud (via `livekit-deploy.yml`). Si les deux sont actives, les variables d'URL doivent être mises à jour **aux deux endroits**.

### Le chemin d'un appel (vue macro)
```
Client (téléphone)
   │
   ▼  PSTN
Twilio (opérateur / trunk SIP)
   │
   ▼  SIP
LiveKit Cloud (salle temps réel + pont SIP)
   │
   ▼  dispatch
Agent Python (axon-agent) ── STT AssemblyAI · LLM DeepSeek · TTS Cartesia
   │
   ▼  après l'appel (HTTP)
Web (/api/calls/{id}/sync-lead, /summary, /analyze, /usage…)
   │
   ▼
Supabase (base de données unique)
```

---

## 2. L'application web (Next.js / Vercel)

Projet **Next.js 15 (App Router, React 19)** déployé sur **Vercel**, racine `web/`.
Preuves : `web/package.json`, `web/vercel.json`, `web/next.config.mjs`, `web/middleware.ts`.

### 2.1 Groupes de routes et layouts
Le dossier `web/app/` est organisé en **groupes de routes** (les parenthèses n'apparaissent PAS dans l'URL — elles servent à appliquer un layout différent). Layout racine commun `web/app/layout.tsx`, puis 4 groupes :

| Groupe | Layout | Accès | Contenu |
|---|---|---|---|
| **(marketing)** | transparent | **Public** | Homepage `/` (`AxonHome`, FR) + `/en`. Redirige un utilisateur déjà connecté vers son espace. |
| **(auth)** | carte centrée « Espace client » | **Public** | `/login`, `/signup` (création d'org ou acceptation d'invitation via `?token=`). |
| **(client)** | barre latérale `ClientSidebar` + **softphone persistant** | **Protégé** | Toute la console client (dashboard, agents, appels, campagnes, contacts, desk, supervision, numéros, workflows, voix…). |
| **(admin)** | barre latérale `AdminSidebar` | **Protégé, super_admin** | Console interne Axon (orgs clientes, facturation, RGPD, conformité). |

- Le layout **(client)** monte un **softphone persistant** (`PersistentSoftphoneShell`) au niveau du layout, pour ne pas couper un appel en cours lors des navigations.
- Le layout **(admin)** fait un **contrôle serveur** supplémentaire (`redirect("/")` si pas `super_admin`/`axon_*`), en plus du middleware.

### 2.2 Authentification & contrôle d'accès (RBAC)
- **Techno** : **Supabase Auth** (email + mot de passe). Navigateur : `web/lib/supabase-browser.ts`. Serveur : `web/lib/supabase-auth.ts`.
- **Middleware** (`web/middleware.ts`) = garde-barrière central à chaque requête :
  1. Rafraîchit le cookie de session.
  2. Laisse passer les chemins **publics** : `/`, `/en`, `/login`, `/signup`, `/auth`, `/api`, `/_next`, `/favicon`, **et les fichiers statiques** (extensions) — *cette dernière exclusion a été ajoutée pour que l'image du hero ne soit pas redirigée vers login*.
  3. Sinon exige une session → sinon `redirect("/login?next=…")`.
  4. Résout l'**org active** + le **rôle**, applique le filtrage **par module**.
  5. `super_admin` = accès total ; `/admin/*` réservé au super_admin.
  - Cache mémoire Edge (TTL 60 s) pour éviter un aller-retour DB par requête.
- **Rôles** (`AppRole`) : `super_admin` (plateforme) ; `owner`, `admin`, `manager`, `agent`, `viewer` (client) ; + legacy `supervisor`/`analyst`/`builder`.
- **Modules & visibilité** (`web/lib/permissions.ts`) : l'accès est géré **par module** (`dashboard`, `desk`, `agents`, `campaigns`, `calls`, `workflows`, `flows`, `queues`, `contacts`, `numbers`, `team`, `settings`, `copilot`, `alerts`), pas page par page. `memberships.visible_modules` permet de **restreindre par utilisateur** au-delà de son rôle.
- **Multi-tenant** : org active mémorisée dans un **cookie signé HttpOnly `axon.org_id`** (`web/lib/org-cookie.ts`, posé par `/api/orgs/switch`). Résolution serveur : `requestOrgId(req)` / `currentOrgIdForServer()`. Le `?org_id=` en query est **ignoré** sauf pour super_admin.
- **Atterrissage après connexion** (`landingPathFor`) : `super_admin`/`admin` → `/admin` ; `owner`/`manager`/`analyst`/`viewer` → `/dashboard` ; `supervisor` → `/desk/supervise` ; `builder` → `/agents` ; `agent` → `/desk`.

### 2.3 Pages principales (console client)
- **Vue d'ensemble** : `/start` (onboarding), `/dashboard` (analyse d'appels + onglet Live), `/copilot` (assistant manager), `/rapports`, `/desk` (**softphone de l'agent humain** + file de tâches), `/mon-calendrier`(+`/ia`), `/desk/supervise` & `/supervise/live` (**écoute / chuchotement / intrusion**), `/mes-patients`, `/alerts`.
- **Configuration** : `/agents`(+`/new`,`/[id]`,`/edit`,`/library`), `/outbound-call`, `/teams`, `/scripts`, `/voices` (**Voice Studio** clonage/test), `/documents` (RAG).
- **Opérations** : `/campaigns`(+`/new/wizard`,`/[id]`), `/calls` (journal, retiré du menu mais route active), `/workflows`(+`/n8n`,`/automations`,`/connections`,`/approvals`), `/flows`(+`/[id]/edit`, IVR), `/queues`.
- **Données** : `/contacts`(+`/[id]`,`/unsorted`, CRM/leads), `/numbers`(+`/[id]`,`/health`, gestion Twilio).
- **Compte** : `/team`, `/settings`, `/help`.
- **Admin (super_admin)** : `/admin`, `/admin/orgs`, `/admin/billing`, `/admin/gdpr`, `/admin/inbound`, `/admin/compliance`, `/admin/data-tables`, `/admin/copilot`.

### 2.4 Routes API `/api/**` (runtime Node.js)
Groupées par usage — **celles appelées par des systèmes externes sont signalées** (= à surveiller pour la migration) :
- **Webhooks téléphonie [externes]** : `/api/twilio/status`, `/api/twilio/recording(-status)`, `/api/twilio/voice-inbound`, `/api/twilio/voice-outbound`, `/api/twilio-voice`, `/api/telnyx/status`, `/api/telnyx-voice`, `/api/retell/webhook`.
- **LiveKit** : `/api/token` (JWT session), `/api/desk/token`, `/api/calls/[id]/supervision/token`, **`/api/livekit/agent-webhook` [externe, LiveKit Cloud]**.
- **Outils appelés par l'Agent Python [externes, Bearer `INTERNAL_AGENT_API_TOKEN`]** : `/api/agent-tools/transfer-to-human`, `/schedule-callback`, `/end-twilio-call`.
- **Desk / softphone** : `/api/desk/dial`, `/api/desk/*` (presence, queue, claim/release, tasks…).
- **Dashboard & crons** : `/api/dashboard/sync-twilio`, `/sync-retell` (**crons Vercel**), `/api/dashboard/*`.
- **Automatisations** : `/api/automations/cron` (**cron Vercel**), `/api/n8n/*`.
- **Leads entrants [externes, n8n / Ads]** : `/api/leads/inbound` (authentifié par `secret` par connecteur + HMAC).
- **Agents / voix / chat** : `/api/agents/*`, `/api/voices/*`, `/api/chat`, `/api/copilot/chat`.
- **Orgs / auth / équipe / numéros** : `/api/orgs(/switch)`, `/api/auth/accept-invite`, `/api/team/*`, `/api/numbers/*` (dont **`/[id]/configure-webhook`**), `/api/admin/*`, `/api/health`.

### 2.5 Configuration
- **Crons Vercel** (`web/vercel.json`, Bearer `CRON_SECRET`) : `sync-retell` (horaire), `sync-twilio` (h+15), `automations/cron` (5 min), `desk/cleanup-stuck-calls` (1 min).
- **CSP / en-têtes** (`web/next.config.mjs`) : appliqués à toutes les routes. `connect-src` **restreint** aux tiers réellement utilisés (Supabase, LiveKit, Twilio, OpenAI, MiniMax, Deepgram). ⚠️ Le domaine de l'app est couvert par `'self'` → **changer de domaine ne casse pas la CSP**, mais toute nouvelle origine tierce doit y être ajoutée.
- **Variables d'env** (`web/lib/config.ts`) : objet `cfg` à lecture paresseuse ; requises = `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. `cfg.app.url` résout `APP_URL` → `NEXT_PUBLIC_APP_URL` → `''`.

---

## 3. La téléphonie & le pipeline vocal

> Le cœur du risque migration. Stack média réelle : **Twilio (PSTN) → trunk SIP LiveKit Cloud → worker Python** (STT AssemblyAI · LLM DeepSeek · TTS Cartesia par défaut).

### 3.1 Appel ENTRANT
Deux topologies coexistent selon la config Twilio du numéro (`agent/sip/README.md`) :
- **Topologie A — via Vercel** (par défaut documenté) : Twilio appelle `{APP_URL}/api/twilio/voice-inbound` → validation signature → résout le numéro → **gate `inbound_enabled` (OFF par défaut → message + raccroche)** → sinon route vers un flow (IVR), une file (humain), ou vers `/api/twilio-voice` qui **bridge vers le trunk SIP LiveKit** (`<Dial><Sip>` avec en-têtes `X-LK-*`). LiveKit auto-dispatche l'agent.
- **Topologie B — trunk SIP direct** : l'Origination URI Twilio pointe directement sur `sip:<projet>.sip.livekit.cloud` ; `voice-inbound` n'est jamais appelé, c'est `agent.py` qui crée la ligne `calls` (`human_first._create_inbound_call_row`).

➡️ **Aujourd'hui, `inbound_enabled` est OFF par défaut** (`web/app/api/twilio/voice-inbound/route.ts:79`) → **aucun appel entrant PSTN réel en service**.

### 3.2 Appel SORTANT (campagnes) — piloté par le Dialer
1. **Scheduler** (`dialer/src/main.ts`, toutes les `POLL_INTERVAL_MS`=30 s) : recharge les campagnes `running`, applique fenêtre horaire, sélection dynamique, réquisitionne les cibles `pending`, respecte `max_concurrency` + stagger (1 CPS).
2. **`dialTarget`** (`dialer/src/dial.ts`) choisit un chemin :
   - **Path A (DÉFAUT prod) — originé par LiveKit** (`DIAL_PREFER_LIVEKIT_SIP=true`) : crée room, dispatche l'agent, `SipClient.createSipParticipant` via le trunk sortant LiveKit → Twilio → PSTN. **Ne touche PAS `/api/twilio-voice`, pas de StatusCallback Twilio** (le `call_id` transite par les attributs room).
   - **Path C — desk humain** : bridge dans le softphone humain, sans IA.
   - **Path B (fallback) — Twilio REST + TwiML** : construit `{APP_URL}/api/twilio-voice?…` (TwiML), `{APP_URL}/api/twilio/status?…` (StatusCallback), `{APP_URL}/api/twilio/recording-status?…`. Fallback en dur `https://example.com` si `APP_URL` absent (`dial.ts:894`).
3. `/api/twilio/status` pilote `campaign_targets.status`, enregistre le billing, lance l'auto-qualification.

### 3.3 L'Agent Python (`agent/`)
- **Modèle** : *outbound worker* LiveKit — se connecte à `LIVEKIT_URL`, attend d'être dispatché, **n'écoute aucun port entrant** (`agent/fly.toml`).
- **Rappels HTTP vers le web** (URL = `NEXT_PUBLIC_APP_URL` ou fallback `https://{VERCEL_URL}`) :

| Fonction | Endpoint web | Déclencheur |
|---|---|---|
| `db_writes.trigger_post_call_pipeline` | `POST /api/calls/{id}/sync-lead` → `/summary` → `/analyze` | fin de session |
| `db_writes.record_agent_usage` | `POST /api/usage/agent` | fin de session |
| `tools_transfer._post_transfer` | `POST /api/agent-tools/transfer-to-human` | tool « passer à l'humain » |
| `tools_schedule_callback._post_schedule` | `POST /api/agent-tools/schedule-callback` | tool « rappeler » |
| `agent._twilio_end_call` | `POST /api/agent-tools/end-twilio-call` | raccrocher vite |

> Si `NEXT_PUBLIC_APP_URL` **et** `VERCEL_URL` sont absents → **no-op silencieux** : le post-call ne part pas. C'est le **point de rupture le plus discret** de la migration.

### 3.4 Tableau des dépendances URL/callback (cœur du risque migration)
**Config Twilio** = stocké côté Twilio (par numéro/trunk) → à repointer dans la console. **Runtime** = construit depuis une variable d'env.

| # | Appelant | URL cible | Construit depuis | Type |
|---|---|---|---|---|
| 1 | Twilio (numéro entrant) | `{APP_URL}/api/twilio/voice-inbound` | **Config Twilio** | Config Twilio |
| 2 | Twilio (état d'appel) | `{APP_URL}/api/twilio/status` | **Config Twilio** | Config Twilio |
| 3 | Twilio (trunk direct) | `sip:<projet>.sip.livekit.cloud` | **Config Twilio** | Config Twilio |
| 4 | web `voice-inbound` | `/api/twilio-voice`, `/api/flows/…` | host de la requête | Runtime (self) |
| 5 | web `twilio-voice` | `sip:…@{LIVEKIT_SIP_URI}` | `LIVEKIT_SIP_URI` | Runtime (env, tiers) |
| 6-8 | **dialer** (Path B) | `{APP_URL}/api/twilio-voice`, `/status`, `/recording-status` | `APP_URL` | Runtime (env, **web**) |
| 9 | **dialer** (cron) | `{APP_URL}/api/dashboard/sync-twilio` | `APP_URL`+`CRON_SECRET` | Runtime (env, **web**) |
| 10 | dialer (Path A/C) | trunk SIP sortant LiveKit | `LIVEKIT_SIP_OUTBOUND_TRUNK_ID` | Runtime (env, tiers) |
| 11-15 | **agent** (post-call) | `{APP}/api/calls/…`, `/usage/agent`, `/agent-tools/*` | `NEXT_PUBLIC_APP_URL`∥`VERCEL_URL` | Runtime (env, **web**) |
| 16 | web `desk/dial` | `{APP_URL}/api/twilio-voice`, `/status` | `APP_URL`∥`NEXT_PUBLIC_APP_URL` | Runtime (env, **web**) |

---

## 4. La base de données (Supabase)

Base unique **Supabase (PostgreSQL managé)**, extensions `uuid-ossp` + `vector` (pgvector). `supabase/migrations/0001_axon_init.sql`.

### 4.1 Connexion (3 clients)
| Client | Fichier | Clé | Rôle |
|---|---|---|---|
| Serveur (admin) | `web/lib/supabase.ts` | `SUPABASE_SERVICE_ROLE_KEY` | Accès total, **contourne le RLS** |
| Session serveur | `web/lib/supabase-auth.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Lié aux cookies, **soumis au RLS** |
| Navigateur | `web/lib/supabase-browser.ts` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Front, soumis au RLS |

Auth = **Supabase Auth** (`auth.users`). RLS activé sur quasi toutes les tables (policies `auth.uid()` + fonction `is_member_of(org)`).

### 4.2 Tables principales
| Table | Rôle |
|---|---|
| `organizations` | Tenant racine (client) |
| `memberships` | Lien utilisateur ↔ org + `role` + `visible_modules` |
| `agents` | Config d'un agent IA (persona, LLM, TTS, prompt, RAG, `purpose`) |
| `agent_handles` | Agent unifié **IA ou humain** (`kind`) |
| `documents` | Corpus RAG chunké + `embedding vector` (index HNSW) |
| `phone_numbers` | Numéros gérés (`e164`, `provider`, `flow_id`, `human_first_enabled`) |
| `queues` / `queue_memberships` | Files d'attente skill-based |
| `human_presence` | Présence temps réel des agents humains |
| `contacts` / `conversations` | CRM / fil par contact |
| `calls` / `call_events` | **Machine à états** des appels + timeline |
| `flows` / `flow_steps` / `flow_edges` | Graphe IVR/routage attaché à un numéro |
| `campaigns` / `campaign_targets` | Campagnes sortantes + cibles (leads) |
| `leads_rdv` | Leads/RDV (claiming, callbacks, NHS) |
| `human_callback_tasks` | Rappels humains planifiés par l'IA (« Appels du jour ») |
| `org_workflows` / `org_workflow_runs` / `org_workflow_actions` / `org_credentials` | Moteur d'automatisation natif (« mini-n8n ») |
| `inbound_webhook_secrets` | Secrets des connecteurs de leads entrants |
| `precall_sms_log`, `usage_events`, `billing_plans`, `audit_log`/`event_log`, `dashboard_errors`, `dashboard_insights` | SMS pré-appel, facturation, audit, dashboard |

### 4.3 Multi-tenance
`org_id` sur quasi toutes les tables + **double protection** : RLS base (policies `is_member_of`) **et** filtrage applicatif (`web/lib/request-context.ts`, le service-role contourne le RLS donc l'app refiltre). Org active = cookie signé `axon.org_id` (secret **`AXON_COOKIE_SECRET`**). `LEGACY_ORG_ID` (`00000000-…-0001`) = tenant de repli hors auth.

### 4.4 Migrations
**44 fichiers** `supabase/migrations/` (`0001`→`0045`, `0018` absent). **Pas de `supabase/config.toml`** — appliquées **à la main** (éditeur SQL Supabase / `supabase db push`). Trajectoire : `0001` v1 mono-tenant → `0006`/`0007` fondations v2 multi-tenant → itérations (rôles, billing, transcripts, workflows, numéros) + passes de durcissement RLS (`0023`–`0026`).

### 4.5 URLs dans la DB → **aucune**
Aucun `site_url`/`redirect`/webhook figé dans le schéma. Les URLs sont **résolues à l'exécution via l'environnement**. Les numéros sont configurés côté opérateur (Twilio/Telnyx) — la route `/api/numbers/[id]/configure-webhook` existe « pour repointer après un changement d'`APP_URL` ».
⚠️ **Préserver `AXON_COOKIE_SECRET`** : le changer invalide les sessions actives (sans danger — l'utilisateur se reconnecte).

---

## 5. Les intégrations externes

| Service | Rôle | Variables clés | Rappelle notre app ? |
|---|---|---|---|
| **LiveKit** (Cloud + SIP + Agents) | Salles voix temps réel, pont SIP, dispatch agent | `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_URL`, `LIVEKIT_API_KEY/SECRET`, `LIVEKIT_SIP_*` | **OUI** → `/api/livekit/agent-webhook` (config console LiveKit) |
| **Twilio** (téléphonie) | Numéros, appels REST, pont SIP, SMS, AMD | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | **OUI** → webhooks Voice/Status par numéro |
| **Telnyx** (téléphonie alt.) | Numéros, Call Control, SIP inbound | `TELNYX_API_KEY`, `TELNYX_*` | **OUI** → `/api/telnyx-voice` |
| **Cartesia** (TTS) | **Voix par défaut en prod** (Sonic) | `CARTESIA_API_KEY`, `CARTESIA_BASE_URL`, `CARTESIA_VOICE_ID` | Non |
| **MiniMax** (TTS) | Voix TTS + clonage (Voice Studio) | `MINIMAX_API_KEY`, `MINIMAX_BASE_URL` | Non |
| **ElevenLabs** (TTS) | Voix TTS (WebSocket streaming) | `ELEVEN(LABS)_API_KEY` | Non |
| **Replicate** (passerelle TTS) | Accès ElevenLabs+MiniMax via 1 clé | `REPLICATE_API_TOKEN`, `REPLICATE_BASE_URL` | Non |
| **AssemblyAI** (STT) | **STT par défaut en prod** (Universal Streaming) | `ASSEMBLYAI_API_KEY`, `ASSEMBLYAI_BASE_URL` | Non |
| **DeepSeek** (LLM) | **Cerveau LLM par défaut** + analyse/qualif + copilot | `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL` | Non |
| **OpenAI** | Embeddings RAG | `OPENAI_API_KEY` | Non |
| **Anthropic** | LLM optionnel (`LLM_PROVIDER=anthropic`) | `ANTHROPIC_API_KEY`, `LLM_PROVIDER` | Non |
| **n8n** (automatisation) | Workflows + connecteurs de leads | `N8N_BASE_URL`, `N8N_API_KEY`, `AXON_URL` (côté n8n) | **OUI** → `{AXON_URL}/api/leads/inbound` |
| **Retell** (legacy) | Ingestion d'appels Retell | `RETELL_API_KEY`, `RETELL_SYNC_ORG_ID` | **OUI** → `/api/retell/webhook` |
| **Stripe** | Facturation | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **OUI** → endpoint webhook Stripe |
| **Supabase** | Base / auth / storage | `SUPABASE_URL`, `*_ANON_KEY`, `SERVICE_ROLE_KEY` | Realtime (hors migration) |

**Callbacks entrants à recâbler lors du changement de domaine** : **Twilio**, **Telnyx**, **LiveKit Cloud** (`/api/livekit/agent-webhook`), **n8n** (`AXON_URL`), **Retell** (si actif), **Stripe**, **Google OAuth** (redirect URIs).

---

## 6. Déploiement, variables d'environnement & opérations

### 6.1 Comment chaque brique se déploie
| Brique | Mécanisme | Déclencheur | Verrou |
|---|---|---|---|
| **Web (Vercel)** | Auto-deploy Git Vercel | **`git push` sur `main`** | Aucun — **push = déploiement**. Root Directory = `web`. |
| **Agent (Fly `axon-agent`)** | GH Actions `fly-deploy.yml` | push `main` touchant `agent/**` ou manuel | **PROD VERROUILLÉE** (`vars.DEPLOY_PROD=='true'` ou case cochée) |
| **Agent (LiveKit Cloud)** | GH Actions `livekit-deploy.yml` | idem | Déploie l'agent **test** par défaut ; prod `CA_PFUfvaBhC8Wk` si `deploy_prod` coché |
| **Dialer (Fly `minimax-for-occ`)** | GH Actions `fly-deploy.yml` | push `main` touchant `dialer/**` ou manuel | Même verrou `DEPLOY_PROD` |

Autres workflows : `ci.yml` (tests web vitest), `fly-ops.yml` (opérations manuelles Fly : diagnose/restart/probe), `livekit-*` (agent de test/probe), `evening-slot-monitor.yml` (cron GitHub d'observation). Secret CI Fly : `FLY_API_TOKEN`.

> **Impact pour tes collègues** : rien ne change. Ils continuent de pusher sur `main` → le web se redéploie tout seul sur Vercel, et `axon-ai.tech` (une fois accroché) montrera automatiquement la nouvelle version. Les déploiements Fly (agent/dialer) restent verrouillés comme aujourd'hui.

### 6.2 Crons
- **Vercel** (`web/vercel.json`, Bearer `CRON_SECRET`) : `sync-retell` (h), `sync-twilio` (h+15), `automations/cron` (5 min), `desk/cleanup-stuck-calls` (1 min).
- **Dialer** (interne) : `scheduleTick` (30 s) + sync Twilio (30 s) qui appelle `{APP_URL}/api/dashboard/sync-twilio` — **désactivé silencieusement si `APP_URL`/`CRON_SECRET` manquent**.

### 6.3 Variables « URL vers le web » (les SEULES à changer pour la migration)
| Variable | Où | Rôle |
|---|---|---|
| **`APP_URL`** | Vercel (web) **+ Fly dialer** | Origine publique de l'app ; base des callbacks TwiML + sync |
| **`NEXT_PUBLIC_APP_URL`** | Vercel (web) **+ Fly agent** + Fly dialer (fallback) | Idem, exposée navigateur ; base des rappels de l'agent |
| **`VERCEL_URL`** | auto (Vercel) ; lue aussi par l'agent | Fallback ; reste l'URL `.vercel.app` même avec un domaine custom |
| **`AXON_URL`** | **côté n8n** | Base pour `POST /api/leads/inbound` |
| `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL` | Vercel (si posées explicitement) | Sinon dérivées de `APP_URL` |
| `N8N_SECURITY_HEADERS_FRAME_ANCESTORS` | côté n8n (si figé sur URL exacte) | Autorise l'iframe éditeur n8n |

> **Piège** : `N8N_WEBHOOK_BASE_URL` **ne change PAS** — malgré son nom, il pointe vers **n8n** (défaut `${N8N_BASE_URL}/webhook`), pas vers le web.

**Tout le reste NE change PAS** : `SUPABASE_URL`, `LIVEKIT_URL`/`_SIP_URI`, `N8N_BASE_URL`, tous les `*_BASE_URL` (DeepSeek/MiniMax/Cartesia/ElevenLabs/Replicate/AssemblyAI), `HANDOFF_WEBHOOK_URL`, `NHS_LEGACY_*`, et toutes les clés API.

---

## 7. Synthèse : migrer le domaine sans rien casser

### 7.1 Ce qui change vs. ce qui ne change pas
- **Le code / le repo : NE CHANGE PAS.** Tes collègues continuent normalement.
- **C'est le même projet Vercel** (`minimax-for-occ`). On lui **accroche** `axon-ai.tech`. L'ancienne URL `.vercel.app` reste active.
- Seules **6 variables d'URL** (§6.3) et **quelques webhooks tiers** (§5) pointent vers le web.

### 7.2 Ordre recommandé (zéro coupure)
0. **Publier la homepage** : merger la branche `claude/axon-homepage-implementation-4zentb` dans `main` (déploiement Vercel normal, après validation).
1. **Vercel** : retirer `axon-ai.tech` du projet `axon-ai` → l'ajouter au projet `minimax-for-occ`. *(Aucun changement DNS : même compte Vercel.)*
2. **Vercel — variables** : poser `APP_URL` et `NEXT_PUBLIC_APP_URL` = `https://axon-ai.tech` → redéployer.
3. **Fly `axon-agent`** : `fly secrets set NEXT_PUBLIC_APP_URL=https://axon-ai.tech -a axon-agent` *(⚠️ aussi sur LiveKit Cloud si l'agent y tourne)*.
4. **Fly `minimax-for-occ` (dialer)** : `fly secrets set APP_URL=https://axon-ai.tech -a minimax-for-occ`.
5. **n8n** : `AXON_URL=https://axon-ai.tech`.
6. **Recâbler les webhooks tiers** : Twilio (par numéro, via `/numbers` ou console), Telnyx, LiveKit Cloud (`/api/livekit/agent-webhook`), Retell (si actif), Stripe, Google OAuth.
7. **Tester** : une connexion, un appel sortant de test, vérifier le post-call (résumé/qualif) dans le dashboard.

**Filet de sécurité** : l'ancienne URL `.vercel.app` marche pendant toute l'opération. Tu peux tout faire progressivement. **Ne mets JAMAIS les variables sur `axon-ai.tech` avant l'étape 1** (sinon les callbacks tapent l'ancienne homepage statique → 404).

### 7.3 Les 3 pièges à retenir
1. **`NEXT_PUBLIC_APP_URL` sur l'agent Fly `axon-agent`** — oubli = post-call silencieusement mort (résumés/qualif/transferts).
2. **`APP_URL` sur le dialer Fly `minimax-for-occ`** — oubli = callbacks TwiML vers `https://example.com` + sync prix coupé.
3. **`AXON_URL` côté n8n** — oubli = leads entrants (Ads) qui n'arrivent plus.

---

## 8. Anomalies & dette technique repérées

Découvertes pendant l'audit — **aucune n'empêche la migration**, mais bonnes à corriger/connaître :

1. **`DEEPGRAM_API_KEY` = variable morte.** Le STT prod est **AssemblyAI** ; Deepgram n'est plus référencé dans le code, mais la variable traîne dans `agent/.env.example`.
2. **`REDIS_URL` = documentée mais non utilisée.** `dialer/README.md` décrit un modèle BullMQ/Redis, mais `dialer/src/main.ts` fonctionne par **polling Supabase en mémoire** (« without Redis » en commentaire). Ne pas provisionner Redis en croyant qu'il est requis. → Corriger le README.
3. **Agent = double cible de déploiement** (Fly `axon-agent` **et** LiveKit Cloud `CA_PFUfvaBhC8Wk`), les deux vivantes. Clarifier laquelle est la prod réelle ; mettre à jour les secrets d'URL **aux deux endroits** si les deux tournent.
4. **Double `minimax-for-occ`** (projet Vercel web + app Fly dialer) — source de confusion pour tout `fly deploy`/`fly secrets`.
5. **Appels entrants PSTN désactivés** (`inbound_enabled` OFF) — normal aujourd'hui, mais à savoir avant d'annoncer « les entrants marchent ».
6. **`N8N_WEBHOOK_BASE_URL`** au nom trompeur : pointe vers n8n, pas vers le web (à ne pas migrer par erreur).
7. **Migration `0008`** re-décrit tout le schéma v2 en doublon de `0006`+`0007` (idempotent, mais redondant). En-têtes internes de `0038`/`0039` mal étiquetés (`0036`/`0037`).
8. **Pas de `supabase/config.toml`** : les migrations sont appliquées manuellement — process à documenter pour l'équipe.

---

*Document généré le 2026-07-01 par audit automatisé du dépôt. À mettre à jour si l'architecture évolue.*

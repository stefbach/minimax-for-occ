# Axon · Voice Agent Platform — Récapitulatif complet

> ⚠️ **SECURITÉ — À LIRE AVANT DE PUSHER OU PARTAGER CE REPO**
>
> Ce README contient des clés API et des secrets en clair (à la demande de l'opérateur).
> **Tous ces secrets doivent être révoqués et régénérés avant la mise en production.**
> Si ce repo devient public ou est partagé avec un tiers, considère immédiatement
> chacune de ces clés comme compromise et régénère-la sur le dashboard du service correspondant.
> Pour la production : remplace toutes ces valeurs par des références à un gestionnaire de secrets
> (Vercel Env Vars, Fly secrets, Supabase Vault, 1Password, etc.).

---

## 1. Vue d'ensemble

Plateforme contact-center multi-tenant (CloudTalk-like + Retell AI-like) :

| Composant | Rôle | Hébergement |
|---|---|---|
| **Web app (Next.js 15)** | Console agent + admin + manager + super_admin | Vercel |
| **Agent worker (Python)** | Agent IA voix temps réel + IVR runtime | LiveKit Cloud |
| **Dialer worker (Node)** | Scheduler outbound BullMQ → Twilio | Fly.io |
| **Database** | Postgres + RLS multi-tenant + pgvector + Auth + Storage + Realtime | Supabase |
| **Telephony** | PSTN, SIP, numéros, enregistrements | Twilio |
| **LLM** | gpt-4o-mini / gpt-4o (raisonnement) | OpenAI |
| **STT** | nova-3 multilingue | Deepgram |
| **TTS + voice cloning** | speech-02-hd + voice/clone | MiniMax |
| **Workflow automation** | Tools serveur exposés à l'agent IA | n8n |
| **Queue/broker** | BullMQ pour le dialer | Upstash Redis |
| **Embeddings RAG** | text-embedding-3-small (per-agent docs) | OpenAI |

Repo monorepo :
```
/web         → Next.js 15 App Router (Vercel)
/agent       → Python LiveKit agent worker (LiveKit Cloud)
/dialer      → Node BullMQ dialer (Fly.io)
/supabase    → Migrations SQL
/n8n         → Workflow templates JSON
/Dockerfile  → Build root pour Fly.io GitHub auto-deploy
/fly.toml    → Config Fly.io app axon-agent
```

---

## 2. Architecture data-flow

### Appel entrant (inbound)
```
PSTN → Twilio numéro → webhook POST /api/twilio/voice (Vercel)
     → TwiML <Dial><Sip> vers LiveKit SIP trunk
     → LiveKit room créée, agent.py worker join
     → Agent IA décroche (STT Deepgram + LLM OpenAI + TTS MiniMax)
     → Si flow_id assigné au numéro → FlowRuntime exécute états
     → Sur intent "transfer_human" → metadata watcher → transfer/handoff
     → call_events streamés en Realtime au superviseur
```

### Appel sortant (outbound)
```
Operator crée campagne → campaign_targets en DB
Worker Fly (BullMQ) → poll Supabase toutes les 30s
                    → pour chaque target due, push job Redis
                    → Worker consomme → Twilio.calls.create(from, to, url=TwiML)
                    → TwiML POST /api/twilio/voice (avec target_id)
                    → idem inbound : LiveKit + agent
```

### Live supervision
```
Superviseur ouvre /calls/<id> → /api/calls/[id]/supervision/token
                              → LiveKit token avec permissions hidden=true
                              → Mute en local (listen) / unmute vers agent only (whisper)
                              → unmute vers tous (barge)
```

---

## 3. Services tiers — Comptes, clés, URLs

### 3.1 OpenAI
- Dashboard : https://platform.openai.com
- Compte : `<email>`
- Models utilisés : `gpt-4o-mini` (LLM principal), `gpt-4o` (manager copilot), `text-embedding-3-small` (RAG)
- Clé API :
  ```
  OPENAI_API_KEY=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
  ```
- À set sur : Vercel + LiveKit (agent worker)

### 3.2 Deepgram (STT)
- Dashboard : https://console.deepgram.com
- Model : `nova-3` (multilingue, latence < 300ms)
- Clé API :
  ```
  DEEPGRAM_API_KEY=20e4a8ca70ea76390b8aec544a01bc84fec7117b
  ```
- À set sur : LiveKit (agent worker)

### 3.3 MiniMax (TTS + voice cloning)
- Dashboard : https://www.minimax.io
- Model TTS : `speech-02-hd`
- Endpoint voice clone : `POST /v1/voice_clone`
- Variables :
  ```
  MINIMAX_API_KEY=<TON_MINIMAX_KEY>
  MINIMAX_GROUP_ID=<TON_GROUP_ID>
  MINIMAX_BASE_URL=https://api.minimax.io
  ```
- À set sur : Vercel + LiveKit
- ⚠️ Toujours vérifier `base_resp.status_code` dans les réponses (le HTTP 200 peut cacher un échec applicatif — voir `web/lib/minimax.ts` `ensureBaseRespOk()`)

### 3.4 LiveKit Cloud
- Dashboard : https://cloud.livekit.io
- Project : `<TON_PROJECT_NAME>`
- Variables :
  ```
  LIVEKIT_URL=wss://<projet>.livekit.cloud
  LIVEKIT_API_KEY=APIxxxxxxxxxxxx
  LIVEKIT_API_SECRET=<TON_SECRET>
  ```
- SIP Trunk (pour Twilio → LiveKit) :
  - Configurer un Outbound + Inbound SIP Trunk dans LiveKit Dashboard
  - URI à pointer depuis Twilio TwiML : `<Sip>sip:<numero>@<sip-trunk-id>.sip.livekit.cloud</Sip>`
- À set sur : Vercel + dans le worker Python (agent/)

### 3.5 Twilio
- Console : https://console.twilio.com
- Variables :
  ```
  TWILIO_ACCOUNT_SID=AC<TON_SID>
  TWILIO_AUTH_TOKEN=<TON_TOKEN>
  TWILIO_FROM_NUMBER=+33<TON_NUMERO>
  ```
- À set sur : Vercel + Fly.io (dialer)
- Webhooks à configurer **par numéro** dans Phone Numbers → Active Numbers :
  | Champ | URL |
  |---|---|
  | Voice → A Call Comes In | `POST https://<vercel-domain>/api/twilio/voice` |
  | Voice → Call Status Changes | `POST https://<vercel-domain>/api/twilio/status` |
  | Recording Status Callback (dans le TwiML) | `POST https://<vercel-domain>/api/twilio/recording` |

### 3.6 Supabase
- Dashboard : https://supabase.com/dashboard
- Project ID : `<TON_PROJECT_ID>`
- Variables publiques (Vercel : `NEXT_PUBLIC_*` autorisées côté client) :
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://<projet>.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...   # anon key, OK côté client
  ```
- Variables serveur uniquement :
  ```
  SUPABASE_URL=https://<projet>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   # service_role, JAMAIS côté client
  ```
- À set sur : Vercel (toutes) + Fly.io (URL + service_role) + LiveKit (URL + service_role)
- Storage bucket à créer manuellement : `axon-recordings` (privé)
- Migrations à appliquer dans Editor → SQL : tout `supabase/migrations/*.sql` dans l'ordre (0001 → 0011)

### 3.7 n8n
- Instance : https://<TON_N8N_HOST>
- JWT secret (pour signer les appels server-to-server) :
  ```
  N8N_BASE_URL=https://<TON_N8N_HOST>
  N8N_JWT_SECRET=<TON_JWT_SECRET>
  ```
- Templates fournis dans `n8n/templates/*.json` (Hôtel/Booking/CRM/etc.)
- À set sur : Vercel + LiveKit (agent worker — chargement lazy)

### 3.8 Upstash Redis
- Dashboard : https://console.upstash.com
- Database name : `axon-dialer-redis`
- Type : Regional, Region `eu-west-1`, TLS enabled
- Variable :
  ```
  REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379
  ```
- À set sur : Fly.io (dialer)

### 3.9 Vercel
- Dashboard : https://vercel.com
- Project name : `minimax-for-occ`
- Settings critiques :
  - **Git** → Production Branch : `main`
  - **General** → Root Directory : `web` (sinon les Dockerfile/fly.toml à la racine sont scannés)
  - **Environment Variables** → voir liste section 4.1

### 3.10 Fly.io
- Dashboard : https://fly.io/dashboard
- App name : `axon-agent`
- Région : `cdg` (Paris)
- VM : `shared-cpu-1x` / 512Mb
- Config : `/fly.toml` + `/Dockerfile` à la racine du repo
- Connecté à GitHub : oui, auto-deploy sur push `main`

---

## 4. Variables d'environnement par service

### 4.1 Vercel (Next.js web app)
```bash
# Public (NEXT_PUBLIC_*)
NEXT_PUBLIC_SUPABASE_URL=https://<projet>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_LIVEKIT_URL=wss://<projet>.livekit.cloud

# Server
SUPABASE_URL=https://<projet>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=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
MINIMAX_API_KEY=<TON_KEY>
MINIMAX_GROUP_ID=<TON_GROUP>
MINIMAX_BASE_URL=https://api.minimax.io
LIVEKIT_URL=wss://<projet>.livekit.cloud
LIVEKIT_API_KEY=APIxxx
LIVEKIT_API_SECRET=<SECRET>
TWILIO_ACCOUNT_SID=AC<SID>
TWILIO_AUTH_TOKEN=<TOKEN>
TWILIO_FROM_NUMBER=+33xxxxxxxxx
DEEPGRAM_API_KEY=20e4a8ca70ea76390b8aec544a01bc84fec7117b
N8N_BASE_URL=https://<HOST>
N8N_JWT_SECRET=<SECRET>
```

### 4.2 Fly.io (dialer worker)
```bash
flyctl secrets set -a axon-agent \
  REDIS_URL="rediss://default:xxx@xxx.upstash.io:6379" \
  SUPABASE_URL="https://<projet>.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  TWILIO_ACCOUNT_SID="AC<SID>" \
  TWILIO_AUTH_TOKEN="<TOKEN>" \
  TWILIO_FROM_NUMBER="+33xxxxxxxxx" \
  APP_URL="https://minimax-for-occ.vercel.app"
```

Variables optionnelles avec défaut :
- `POLL_INTERVAL_MS=30000`
- `WORKER_CONCURRENCY=10`

### 4.3 LiveKit Agent (Python)
```bash
# À set via lk agent env set ou dans le dashboard LiveKit
OPENAI_API_KEY=sk-proj-...
DEEPGRAM_API_KEY=20e4a8ca70ea76390b8aec544a01bc84fec7117b
MINIMAX_API_KEY=<KEY>
MINIMAX_GROUP_ID=<GROUP>
SUPABASE_URL=https://<projet>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
N8N_BASE_URL=https://<HOST>
N8N_JWT_SECRET=<SECRET>
LIVEKIT_URL=wss://<projet>.livekit.cloud
LIVEKIT_API_KEY=APIxxx
LIVEKIT_API_SECRET=<SECRET>
```

---

## 5. Commandes de deploy

### 5.1 Web app (Vercel)
Auto-deploy sur push `main`. Pour forcer un redeploy :
- Dashboard Vercel → Deployments → bouton **Redeploy** sur le dernier `main`

### 5.2 Dialer (Fly.io)
Auto-deploy sur push `main` via l'intégration GitHub (utilise `/Dockerfile` et `/fly.toml`).

Pour deploy manuel ou debug :
```bash
flyctl deploy -a axon-agent
flyctl logs -a axon-agent
flyctl status -a axon-agent
flyctl secrets list -a axon-agent
```

### 5.3 LiveKit Agent (Python)
```bash
cd agent
lk agent deploy   # build + push image + update worker
lk agent logs <agent-name>
```

### 5.4 Supabase Migrations
- Dashboard → SQL Editor → copier-coller chaque fichier dans l'ordre :
  - `supabase/migrations/0001_init.sql`
  - `supabase/migrations/0002_*.sql`
  - … jusqu'à `0011_storage_bucket_note.sql`
- Puis créer le bucket Storage `axon-recordings` (Storage → New bucket → privé)

---

## 6. Schéma de base de données (principales tables)

| Table | Rôle |
|---|---|
| `organizations` | Tenant root |
| `memberships` | Lien user ↔ org avec role (super_admin/admin/manager/supervisor/agent) |
| `invitations` | Token-based invite flow |
| `ai_agents` | Définition d'un agent IA (system prompt, voice_id, model) |
| `voices` | Voix MiniMax clonées (voice_id) |
| `phone_numbers` | Numéros Twilio assignés à des agents ou queues |
| `queues` | Files d'appels |
| `agent_handles` | Wrapper unifié (ai ou human) pour membership de queue |
| `queue_memberships` | Membres d'une queue avec priority |
| `flows` + `flow_steps` + `flow_edges` | IVR visual builder |
| `calls` | Appels (status, durations, recording_url) |
| `call_events` | Stream d'événements (Realtime) — pour supervision |
| `contacts` | Contacts par org |
| `conversations` | Sessions chat (non-voix) |
| `campaigns` + `campaign_targets` | Outbound dialer |
| `documents` + `document_chunks` | RAG per-agent (pgvector) |

RLS multi-tenant : toutes les tables `org_id` ont une policy `org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())`.

---

## 7. Configuration Twilio webhooks (par numéro)

Pour chaque numéro Twilio acheté :

1. Console Twilio → **Phone Numbers** → **Manage** → **Active Numbers** → clique le numéro
2. Onglet **Configure** :
   - **Voice Configuration** :
     - A call comes in : `Webhook` → `POST` → `https://<vercel-domain>/api/twilio/voice`
     - Call status changes : `Webhook` → `POST` → `https://<vercel-domain>/api/twilio/status`
   - **Messaging Configuration** : (optionnel, pour SMS satisfaction post-call)
3. Save

Le webhook `/api/twilio/voice` retourne un TwiML qui :
- Crée un enregistrement (`<Record>` ou via `recordingStatusCallback`)
- Forward vers LiveKit SIP trunk via `<Sip>`

---

## 8. Rôles et accès (RBAC)

| Rôle | Pages accessibles |
|---|---|
| `super_admin` | Tout, y compris l'org-switcher cross-tenant |
| `admin` | Tout dans sa propre org : users, invitations, numbers, queues, agents, flows, campaigns, analytics |
| `manager` | Dashboard manager (KPIs + copilot IA), analytics, queues, agents (lecture), contacts |
| `supervisor` | Live supervision (listen/whisper/barge), calls, contacts |
| `agent` | Softphone /desk, contacts, ses propres calls |

Le filtrage est appliqué dans `web/components/Sidebar.tsx` + redirections via `web/lib/supabase-auth.ts` `landingPathFor(role)`.

---

## 9. Checklist post-deploy

- [ ] Vercel : Root Directory = `web`, Production Branch = `main`
- [ ] Vercel : toutes les env vars de la section 4.1 set en Production
- [ ] Supabase : migrations 0001 → 0011 appliquées
- [ ] Supabase : bucket `axon-recordings` créé en privé
- [ ] Supabase : au moins une org créée + un user super_admin invité
- [ ] LiveKit : SIP trunk créé + URI noté
- [ ] LiveKit : agent worker déployé (`lk agent deploy`)
- [ ] Twilio : numéro acheté + webhooks configurés
- [ ] Fly.io : dialer déployé + secrets set + `flyctl status` vert
- [ ] Fly.io : logs montrent `[dialer] worker ready` sans crash
- [ ] Upstash Redis : créé, URL TLS récupérée
- [ ] n8n : instance accessible, JWT secret partagé
- [ ] Test bout-en-bout : appeler le numéro Twilio depuis ton mobile → agent IA décroche

---

## 10. Test bout-en-bout

Voir `docs/END_TO_END_TEST.md` pour le scénario détaillé. Résumé :

1. **Inbound** : appel ton numéro Twilio depuis ton mobile → agent IA répond
2. **Handoff** : dis "passez-moi un humain" → ton softphone web sonne → reprend la conversation
3. **Outbound** : crée une campagne avec ton numéro comme target → ton téléphone sonne sous 30s
4. **Supervision** : pendant un appel, un superviseur va sur `/calls/<id>` → écoute (listen) → whisper à l'agent → barge

---

## 11. Coûts mensuels approximatifs (volume modéré)

| Service | Plan | Estimation |
|---|---|---|
| Vercel | Hobby ou Pro | 0–20 € |
| Supabase | Pro | 25 € |
| Fly.io | Pay-as-you-go (1 machine shared-cpu) | 5 € |
| Upstash Redis | Free tier | 0 € |
| LiveKit Cloud | Build (free tier) puis Ship | 0–50 € |
| Twilio | Numéro 1 €/mois + 0.013 €/min entrant + 0.07 €/min sortant FR | variable |
| OpenAI | gpt-4o-mini ~ 0.15$/1M tokens input | variable, faible |
| Deepgram | $0.0043/min (nova-3) | variable |
| MiniMax | speech-02-hd ~ $20/M chars | variable |
| **Base fixe** | | **~50–100 €/mois** |

---

## 12. Liens utiles

- **Repo GitHub** : https://github.com/stefbach/minimax-for-occ
- **Production Vercel** : https://minimax-for-occ.vercel.app (à confirmer)
- **Fly dashboard** : https://fly.io/apps/axon-agent
- **Supabase** : https://supabase.com/dashboard
- **LiveKit** : https://cloud.livekit.io
- **Twilio Console** : https://console.twilio.com
- **OpenAI Platform** : https://platform.openai.com
- **MiniMax** : https://www.minimax.io
- **Upstash** : https://console.upstash.com
- **n8n** : https://<TON_N8N_HOST>

---

## 13. Notes opérationnelles

- **Le dialer Fly.io ne sert pas de page web** (HTTP 503 si tu accèdes à `axon-agent.fly.dev` — c'est normal, c'est un worker).
- **Les rebuilds LiveKit sont lents** (~3 min). Le label `build_id` dans `agent/Dockerfile` bust le cache si besoin.
- **Les voix MiniMax clonées** sont rattachées à un `group_id`. Si tu changes de group, les `voice_id` deviennent invalides.
- **Vercel auto-deploy** se déclenche sur tout push `main`. Pour éviter les builds inutiles, push vers une feature branch puis PR.
- **Fly auto-deploy** se déclenche aussi sur push `main` — mais seulement si `/Dockerfile` est présent à la racine.

---

## 14. Historique des PRs

Dernières PRs notables :
- PR #15 → Axon v2 foundations (multi-tenant + auth)
- PR #17 → Twilio number provisioning
- PR #18 → Softphone web (agents humains)
- PR #19 → Flow builder visuel (React Flow)
- PR #20 → Manager dashboard + copilot
- PR #21 → Admin users/invitations
- PR #22 → Role-based navigation
- PR #23 → Auth-aware org scoping
- PR #24 → Live supervision (listen/whisper/barge)
- PR #25 → Analytics + export CSV
- PR #26 → Outbound dialer + campaign wizard
- PR #27 → docs/END_TO_END_TEST.md
- PR #28 → Twilio status/recording webhooks
- PR #29 → Mid-call handoff
- PR #30 → Flow runtime Python
- PR #31 → Real /queues page + cleanup PhaseStub
- PR #32 → dialer/fly.toml
- PR #33 → Root Dockerfile + fly.toml pour Fly auto-deploy

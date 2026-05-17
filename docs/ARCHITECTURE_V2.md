# Axon v2 — Architecture

Axon est une **plateforme de contact center hybride IA + humain** dans la lignée
de CloudTalk × Retell AI. Sur le même numéro, sur la même file d'attente, on
peut router un appel vers un agent IA (Retell-style) ou vers un agent humain
(CloudTalk-style), et basculer de l'un à l'autre en cours d'appel.

Use cases ciblés : centres d'appels, services clients, gestion hôtelière et
conciergerie, qualification de leads. Conçu **multi-tenant** dès le premier
jour : une instance, N organisations clientes.

---

## Stack & responsabilités

| Plateforme | Rôle | Pourquoi |
|---|---|---|
| **Vercel** | Dashboard Next.js, API CRUD edge/serverless | Excellent pour le SPA + SSR + auto-deploy. NE convient PAS aux connexions long-vivantes — d'où les autres briques. |
| **Supabase** | Postgres + Realtime + Storage + Auth + pgvector | Un seul provider pour DB, realtime, audio storage, embeddings, et auth multi-tenant. |
| **LiveKit Cloud** | SFU WebRTC + Cloud Agents (worker Python) | Voix temps réel global avec scaling auto. Les agents IA tournent ici, pas sur Vercel. |
| **Twilio** | PSTN, numéros, SIP trunks, SMS | Canal téléphonique mondial. Pas de plateforme à manager. |
| **Fly.io / Railway** | 1 container : call-orchestrator (BullMQ + workers) | Pour le dialer outbound, le retry, les schedulers. Vercel ne fait pas long-running. |
| **Upstash Redis** | Queues + présence agents (managed serverless) | Free tier large, pas de serveur à gérer. |
| **n8n** *(déjà en place)* | Workflows métier déclenchés par les agents | Tools côté agent + post-call automation (CRM, mails). |

**4 plateformes managées + 1 worker container** — pas plus. Le reste (TTS,
LLM, STT) est API.

---

## Plan d'appel — état-machine

```
              ┌───────────────┐         ┌───────────────┐
INBOUND       │ Twilio number │ ──────► │ Flow (IVR)    │
              └───────────────┘         └───────┬───────┘
                                                │
              ┌─────────────────────────────────┼──────────────────────────┐
              │                                 │                          │
        ┌─────▼──────┐                    ┌─────▼──────┐             ┌─────▼─────┐
        │ AI agent   │                    │ Queue      │             │ Voicemail │
        │ (LiveKit)  │                    │ (humans)   │             │ + email   │
        └─────┬──────┘                    └─────┬──────┘             └───────────┘
              │  user wants human               │
              └─────────► handoff ──────────────┘
                            │
                      ┌─────▼─────┐
                      │ in_progress│
                      └─────┬─────┘
                            │
                      ┌─────▼─────┐
                      │  wrap_up  │  ← post-call notes, n8n triggers
                      └─────┬─────┘
                            │
                      ┌─────▼─────┐
                      │   ended   │
                      └───────────┘

OUTBOUND      ┌───────────────┐
              │  Campaign     │ ──► Dialer worker (Fly.io) ──► Twilio dial
              └───────────────┘                                   │
                                                                  ▼
                                                            (same path)
```

État Postgres : `calls.state in ('queued','ringing','ivr','in_progress','wrap_up','ended')`.

---

## Modèle de données

```
organizations                ← top-level tenant
├── memberships              ← (user, org, role: admin|supervisor|agent)
├── phone_numbers            ← numéros Twilio attachés
├── flows                    ← IVR builder visuel
│   └── flow_steps           ← welcome/menu/ai/transfer/voicemail
├── queues                   ← files skill-based
│   └── queue_memberships    ← (queue, agent)
├── agents                   ← UNIFIÉ ai|human
│   ├── ai_agents            ← profil IA (prompt, voix, LLM, RAG, n8n bindings) → existant
│   └── (kind=human) → users.id
├── human_presence           ← (user, status, last_seen) — temps réel via Supabase Realtime
├── voices                   ← clones MiniMax — existant
├── documents                ← RAG corpus + pgvector — existant
├── workflows                ← n8n bindings — existant agent_n8n_workflows
├── contacts                 ← CRM (e164 unique par org)
├── conversations            ← thread persistant par contact
├── calls                    ← état-machine, recording_url, transcript_url
│   └── call_events          ← timeline (transfer, hold, mute, dtmf)
├── campaigns                ← outbound scriptées
│   └── campaign_targets     ← contacts + tentatives
└── event_log                ← audit immuable cross-entité
```

Toutes les tables ci-dessus ont une colonne `org_id` et une **RLS stricte** :
un user ne voit que ses orgs (via `memberships`).

---

## Tenancy & sécurité

- **Multi-tenant strict par RLS** : chaque table porte `org_id`. Les policies
  filtrent par `auth.uid() in memberships(org_id)`. La service_role bypass
  reste utilisable pour les workers backend (Python, dialer).
- **Auth** : Supabase Auth (email+password + magic link + OAuth Google). Les
  users sont liés à 1 ou plusieurs organisations via `memberships`.
- **Rôles** :
  - `admin` — tout, gestion users, billing
  - `supervisor` — pilotage live, supervise les agents, accès analytics
  - `agent` — répond aux appels via le softphone, voit ses propres calls
- **Audit** : chaque action métier (création agent, suppression workflow,
  transfer call) écrit une ligne dans `event_log`.

---

## Roadmap (12 semaines, livraisons hebdomadaires)

| Phase | Sem. | Livrable |
|---|---|---|
| **0. Fondations** *(cette PR)* | S1 | Schéma v2 multi-tenant, auth Supabase, sidebar refondue, contacts CRUD |
| **1. Telephony foundation** | S2-3 | Achat numéros Twilio depuis l'UI, inbound bridge → LiveKit SIP, recording Supabase Storage, transcript live |
| **2. Flow builder visuel** | S4-5 | Page `/flows/[id]/edit` drag-drop (React Flow) — étapes welcome/menu DTMF/route queue/AI/voicemail. Compilé en runtime côté worker. |
| **3. Softphone web (humains)** | S6-7 | Page `/desk`, WebRTC via LiveKit, présence Realtime, mute/hold/transfer. |
| **4. Handoff AI ↔ humain** | S8 | Bouton "transférer" pendant un call AI → queue humaine, transcript transmis. |
| **5. Campagnes outbound** | S9-10 | Worker dialer Fly.io + BullMQ, AMD (answering machine detection), campagne wizard. |
| **6. Pilotage / supervision** | S11 | Live monitor, listen / whisper / barge. |
| **7. Analytics & reporting** | S12 | Volume, durée, taux résolution AI, top intents, satisfaction. |

---

## Ce qui reste de v1 (réutilisé tel quel)

- Worker Python LiveKit (`agent/agent.py`) — lit le nouveau schema v2 via
  `agent_config.py`.
- Voice Studio (`/voices`) — table `voices` scopée par `org_id`.
- RAG par agent (`/documents`) — table `documents` scopée.
- n8n bindings (`agent_n8n_workflows`) — scopés.
- Twilio TwiML bridge (`/api/twilio-voice`) — agrandi avec routage Flow.

## Ce qui est cassé / remplacé

- Les anciens "agents" sans `org_id` sont attachés à l'organisation par défaut
  créée à la migration. Modifiable plus tard.
- Les pages CRUD existantes continuent de marcher (service_role bypass) le
  temps qu'on les migre une à une vers l'auth utilisateur (phase 0+).

---

## Décisions techniques explicites

1. **On garde Vercel** pour le front + APIs CRUD. Pas de switch vers
   Cloudflare / autre. La séparation front / workers via Fly.io évite les
   limites de Vercel.
2. **Twilio uniquement** comme canal téléphonique. Pas de SIP custom, pas de
   Telnyx. Plus tard si pertinent.
3. **LiveKit Cloud Agents** reste le moteur des agents IA. Pas d'auto-host.
4. **Supabase Auth** plutôt que Clerk / Auth0. Moins de plateformes à gérer.
5. **n8n** reste l'outil "tools" pour les agents — pas de redéveloppement
   d'un workflow engine custom.
6. **Multi-LLM** côté agent : openai / anthropic / minimax (déjà), à étendre
   vers gemini / mistral / ollama via une simple entrée dans le sélecteur.

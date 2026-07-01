# Audit de la plateforme Axon — v2 (vérifié sur la base de production)

> **Différence avec la v1** : cette version ne se fie plus aux valeurs par défaut du code ni à la documentation (qui étaient périmées). Chaque affirmation d'état est **vérifiée dans la vraie base de données de production** (`supabase-lime-window`, ref `ehlqjfuutyhpbrqcvdut`) le **2026-07-01**. Deux erreurs de la v1 sont corrigées : (1) les appels **entrants fonctionnent**, (2) **n8n n'est plus utilisé** (automatisations natives).

---

## 0. État réel de la plateforme AUJOURD'HUI (relevé dans la base)

| Constat vérifié | Valeur |
|---|---|
| Base de production | `supabase-lime-window` (`ehlqjfuutyhpbrqcvdut`) — ⚠️ `kgohjmivilsfoewrcovn`/emerald = ancienne base NHS (legacy) |
| Organisations | **4** : **Obesity Care Clinic** (client principal, 5 users, 12 agents), **Axon** (interne, 2 users, 4 agents), Legacy, Test |
| Rôles réellement utilisés | `owner`, `manager`, `supervisor`, `agent` (côté OCC) ; `super_admin`, `agent` (côté Axon) |
| Agents IA | **16** (dont 2 « management ») |
| Cerveaux LLM configurés | **DeepSeek (7), OpenAI (7), Anthropic (2)** |
| Voix (TTS) configurées | **Cartesia par défaut (8), ElevenLabs (5)**, reste par défaut ; langues **en + fr** |
| Appels enregistrés | **27 525** au total — **26 993 sortants**, **532 entrants** |
| Campagnes | **44** créées, **1 active** |
| Appels terminés (24 h) | **414**, dont **284 avec résumé IA généré** en temps réel (dernier : hier 18h35) |
| Numéros de téléphone | **4** (Twilio) ; **seul `+447888861445`** a l'entrant activé |
| Automatisations natives | **11 workflows actifs**, **2 303 exécutions en 7 jours** |
| Bindings n8n | **0** (`agent_n8n_workflows` vide) → **n8n non utilisé** |

**Ce que ça dit** : plateforme **très active**, à dominante **sortante** (campagnes d'appels IA pour OCC), avec de l'**entrant réel** (human-first) et un moteur d'**automatisation natif** intense (pipeline patient/NHS).

---

## 1. Architecture générale

**4 briques** (3 dans ce dépôt) :

| Brique | Répertoire | Déploiement | Rôle |
|---|---|---|---|
| **Web** | `web/` | **Vercel** (projet `minimax-for-occ`) | Homepage, connexion, console client/admin, **toutes les API**, crons, hôte des webhooks. **Cible de la migration de domaine.** |
| **Agent** | `agent/` | **Fly.io `axon-agent`** et/ou **LiveKit Cloud** | Worker vocal Python : écoute (AssemblyAI), réfléchit (DeepSeek/OpenAI/Anthropic), parle (Cartesia/ElevenLabs). **Rappelle** le web après l'appel. |
| **Dialer** | `dialer/` | **Fly.io `minimax-for-occ`** | Lance les **appels sortants** de campagne + réconcilie les coûts Twilio. |
| **n8n** | `n8n/` (templates) | Externe | **Non utilisé aujourd'hui** (0 binding en base). Les automatisations sont natives (§8). |

### ⚠️ Pièges de nommage
1. **`minimax-for-occ` = 2 choses** : projet Vercel (web) **ET** app Fly du dialer.
2. **L'Agent a 2 cibles de déploiement** (Fly `axon-agent` + LiveKit Cloud), les deux vivantes.

### Le chemin réel d'un appel
```
ENTRANT :  Client → Twilio (trunk SIP) → LiveKit → Agent → (human-first : sonne le poste via Supabase realtime)
SORTANT :  Dialer → LiveKit SIP (origine) → Twilio → Client → Agent
APRÈS   :  Agent → Web (/api/calls/{id}/summary, /analyze, /sync-lead, /usage) → Supabase
```

---

## 2. L'application web (Next.js / Vercel)

App **Next.js 15 (App Router)** sur **Vercel**, racine `web/`.

### 2.1 Groupes de routes
| Groupe | Accès | Contenu |
|---|---|---|
| **(marketing)** | Public | Homepage `/` (`AxonHome`, FR) + `/en`. Redirige un connecté vers son espace. |
| **(auth)** | Public | `/login`, `/signup`. |
| **(client)** | Protégé | Console client (barre latérale + **softphone persistant** qui ne coupe pas un appel en navigant). |
| **(admin)** | super_admin | Console interne Axon. |

### 2.2 Auth & rôles
- **Supabase Auth** (email + mot de passe).
- **Middleware** (`web/middleware.ts`) : garde chaque page, laisse passer les pages publiques (`/`, `/en`, `/login`, `/signup`, `/api`, statiques), redirige vers `/login` sinon, applique le filtrage **par module** selon le rôle.
- **Rôles réels** (vérifiés en base) : `super_admin`, `owner`, `manager`, `supervisor`, `agent`.
- **Multi-client** : org active dans un **cookie signé `axon.org_id`** (secret `AXON_COOKIE_SECRET`).

### 2.3 Pages clés
Dashboard (stats + Live), **Desk** (softphone agent humain + file de tâches), Supervision (écoute/chuchotement/intrusion), Agents (config IA), Campagnes (sortant), Contacts/CRM, Numéros (Twilio), **Workflows** (automatisations natives), Voice Studio, Rapports. Admin : orgs, facturation, RGPD.

### 2.4 API `/api/**` (runtime Node)
- **Webhooks téléphonie [externes]** : `/api/twilio/*`, `/api/twilio-voice`, `/api/telnyx/*`, `/api/retell/webhook`.
- **LiveKit** : `/api/token`, **`/api/livekit/agent-webhook`**.
- **Outils appelés par l'Agent [externes]** : `/api/agent-tools/{transfer-to-human,schedule-callback,end-twilio-call}`, `/api/calls/{id}/{sync-lead,summary,analyze}`, `/api/usage/agent`.
- **Desk** : `/api/desk/*`.
- **Crons Vercel** : `/api/dashboard/sync-{twilio,retell}`, **`/api/automations/cron`** (moteur d'automatisations), `/api/desk/cleanup-stuck-calls`.
- **Leads [externes]** : `/api/leads/inbound` (aujourd'hui non alimenté par n8n).

### 2.5 CSP (`web/next.config.mjs`)
`connect-src` restreint aux tiers utilisés. Le domaine de l'app est couvert par `'self'` → **changer de domaine ne casse pas la CSP**.

---

## 3. La téléphonie & le pipeline vocal  ✅ (section corrigée)

Stack média réelle : **Twilio → trunk SIP LiveKit → Agent Python** (STT AssemblyAI · LLM DeepSeek/OpenAI/Anthropic · TTS Cartesia/ElevenLabs).

### 3.1 Appel ENTRANT — **fonctionne** (corrigé)
> La v1 disait « pas d'entrant en service » (basé sur un commentaire de code périmé). **FAUX** : la base montre de vrais appels entrants.

- **Vérifié en base** : appels `direction='in'` avec **`source = "sip_direct"`** et room **`tel-*`** sur **`+447888861445`** (qui a `inbound_enabled=true` + `human_first_enabled=true`).
- **Chemin réel** : Twilio (trunk) → **directement LiveKit SIP** (crée la room `tel-*`) → l'**Agent** détecte l'entrant (attributs `sip.phoneNumber`/`sip.trunkPhoneNumber`) → **`human_first.py`** (gaté par `inbound_enabled` + `human_first_enabled` en base + env `HUMAN_FIRST_INBOUND=1`) estampille la ligne `calls` → le **softphone du poste sonne via Supabase realtime** et rejoint la même room.
- ⚠️ **Ce chemin NE passe PAS par le webhook Vercel `/api/twilio/voice-inbound`.** (Ce webhook existe comme chemin alternatif, gaté par `inbound_enabled` en colonne, mais il n'est pas dans le flux live.)

➡️ **Conséquence migration : changer le domaine web ne casse PAS les entrants** (ils vont Twilio→LiveKit, sans toucher le web). Seuls le softphone (navigateur) et le post-appel touchent le web.

### 3.2 Appel SORTANT — dominant
- Piloté par le **Dialer** (`dialer/src/main.ts`, polling 30 s de Supabase).
- **Chemin par défaut (Path A)** : originé par **LiveKit SIP** (rooms `out-*` observées en base) → **ne touche pas `/api/twilio-voice`**.
- **Fallback (Path B)** : Twilio REST + TwiML `{APP_URL}/api/twilio-voice` + StatusCallback `{APP_URL}/api/twilio/status`.
- Le dialer appelle aussi `{APP_URL}/api/dashboard/sync-twilio` toutes les 30 s (réconciliation prix).

### 3.3 L'Agent Python
- **Worker outbound** LiveKit : se connecte à `LIVEKIT_URL`, attend d'être dispatché, **n'écoute aucun port entrant**.
- **Rappelle le web après chaque appel** (URL depuis `NEXT_PUBLIC_APP_URL` ∥ `VERCEL_URL`) : `sync-lead` → `summary` → `analyze`, `usage/agent`, `agent-tools/*`.
- **Vérifié live** : 284/414 résumés en 24 h → **ce pipeline fonctionne** (donc `NEXT_PUBLIC_APP_URL` est correct aujourd'hui).
- ⚠️ Si `NEXT_PUBLIC_APP_URL` (et `VERCEL_URL`) sont absents → **no-op silencieux** : plus de résumés/qualif. **Point de rupture le plus discret de la migration.**

### 3.4 Dépendances URL par composant (pour la migration)
| Composant | Dépend du domaine web ? | Détail |
|---|---|---|
| **Entrant (SIP direct)** | **NON** | Twilio trunk → LiveKit, sans le web |
| **Sortant Path A (LiveKit)** | **NON** (pour l'appel) | mais le dialer utilise `APP_URL` pour le sync prix + fallback |
| **Sortant Path B (Twilio REST)** | OUI | `{APP_URL}/api/twilio-voice`, `/status` |
| **Post-appel (Agent → web)** | **OUI** | `NEXT_PUBLIC_APP_URL` (résumés/qualif/transferts) |
| **Softphone (poste humain)** | via navigateur | marche sur `.vercel.app` comme sur `axon-ai.tech` |

---

## 4. La base de données (Supabase)

Base unique **`supabase-lime-window`** (PG15, pgvector). 3 clients : serveur admin (`SERVICE_ROLE_KEY`, contourne RLS), session serveur + navigateur (`ANON_KEY`, soumis RLS). Auth = **Supabase Auth**.

### Tables principales (vérifiées présentes)
`organizations`, `memberships` (rôle + `visible_modules`), `agents`, `agent_handles` (IA **ou** humain), `documents` (RAG + embeddings), `phone_numbers` (`inbound_enabled`, `human_first_enabled`), `calls`/`call_events`, `campaigns`/`campaign_targets`, `contacts`, `leads_rdv`, `human_callback_tasks`, `human_presence`, `inbound_number_agents`, `org_workflows`/`org_workflow_runs`/`org_workflow_actions`/`org_credentials`, `inbound_webhook_secrets`, billing/usage/audit.

### Multi-tenance
`org_id` partout + **double protection** : RLS base (`is_member_of`) **et** filtrage applicatif. Org active via cookie signé. `LEGACY_ORG_ID` = tenant de repli.

### URLs dans la base → **aucune**
Aucune URL/domaine figé dans le schéma → **rien à changer côté base** pour la migration. ⚠️ Préserver `AXON_COOKIE_SECRET` (sinon reconnexion — sans danger). Migrations (44 fichiers) **appliquées à la main** (pas de `config.toml`).

---

## 5. Les intégrations externes  ✅ (corrigée : n8n retiré)

| Service | Utilisé aujourd'hui ? | Rappelle le web ? |
|---|---|---|
| **LiveKit** (Cloud + SIP) | Oui, central | Oui → `/api/livekit/agent-webhook` |
| **Twilio** | Oui (trunk + REST + SMS) | Oui → webhooks numéros (mais entrant = SIP direct) |
| **AssemblyAI** (STT) | Oui (défaut prod) | Non |
| **DeepSeek / OpenAI / Anthropic** (LLM) | Oui (7/7/2 agents) | Non |
| **Cartesia / ElevenLabs** (TTS) | Oui (8/5 agents) | Non |
| **MiniMax / Replicate** (TTS) | Dispo (Voice Studio) | Non |
| **n8n** | ❌ **NON** (0 binding en base) | — |
| **Retell** | Legacy (route existe) | Oui si actif |
| **Stripe** | Facturation | Oui (webhook) |
| **Supabase** | Base/auth/storage | Non concerné |

**À recâbler lors de la migration (côté fournisseur)** : Twilio (webhooks numéros + TwiML App), Telnyx (si utilisé), **LiveKit Cloud** (`agent-webhook`), Retell (si actif), Stripe, Google OAuth. **n8n : rien** (non utilisé).

---

## 6. Déploiement & variables d'environnement

### 6.1 Déploiement
| Brique | Mécanisme | Verrou |
|---|---|---|
| **Web (Vercel)** | Auto-deploy à chaque `git push main` | Aucun |
| **Agent (Fly `axon-agent`)** | GH Actions `fly-deploy.yml` | **Verrouillé** (`DEPLOY_PROD`) |
| **Agent (LiveKit Cloud)** | GH Actions `livekit-deploy.yml` | Idem |
| **Dialer (Fly `minimax-for-occ`)** | GH Actions `fly-deploy.yml` | **Verrouillé** |

> Pour tes collègues : rien ne change. `git push` → le web se redéploie tout seul ; `axon-ai.tech` montrera automatiquement la nouvelle version.

### 6.2 Les SEULES variables « URL vers le web » à changer
| Variable | Où | Impact |
|---|---|---|
| **`APP_URL`** + **`NEXT_PUBLIC_APP_URL`** | **Vercel** (web) | Origine publique, liens, callbacks |
| **`NEXT_PUBLIC_APP_URL`** | **Fly `axon-agent`** (+ LiveKit Cloud) | ⚠️ Post-appel (résumés/qualif) |
| **`APP_URL`** | **Fly `minimax-for-occ`** (dialer) | Fallback TwiML + sync prix |
| `STRIPE_SUCCESS_URL` / `CANCEL_URL` | Vercel (si posées) | — |

**Ne changent PAS** : `SUPABASE_URL`, `LIVEKIT_URL`/`_SIP_URI`, tous les `*_BASE_URL` (LLM/TTS), les clés API. **Piège** : `N8N_WEBHOOK_BASE_URL` pointe vers n8n, **pas** le web (et n8n n'est pas utilisé). **`AXON_URL` (n8n) : sans objet** aujourd'hui.

---

## 7. Automatisations natives (le « /workflows »)  ✅ (corrigée)

> La v1 attribuait les automatisations à n8n. **FAUX** : elles sont **natives**, dans la base et exécutées par un cron Vercel.

- **Vérifié en base** : **11 `org_workflows` actifs**, **2 303 exécutions en 7 jours**, **0 binding n8n**.
- Ce sont les pipelines patient/NHS d'OCC : *Premier Contact (Email+WhatsApp)* (5 min), *Orchestrateur Patient A2→A7* (30 min), *Orchestrateur NHS Response A8* (180 min), *Document Monitor* (120 min), + sous-agents (Data Fetcher, Identify & Store, Communicate, Supabase Controller, Document Generator, Screener, NHS Ingest).
- **Moteur** : `web/app/api/automations/cron` (cron Vercel toutes les 5 min) exécute les workflows dus, stocke les résultats dans `org_workflow_runs`. Les identifiants (SMTP, WhatsApp/WATI, Supabase, Anthropic, Gmail…) sont dans `org_credentials`.
- ⚠️ **Point d'attention ops (pas migration)** : plusieurs sous-agents (Agent 2..7) sont en **état `error`** en base — à investiguer séparément.

➡️ **Conséquence migration : les automatisations tournent en interne (cron Vercel → route interne) → AUCUN impact du changement de domaine.**

---

## 8. Synthèse : migrer le domaine sans rien casser

### 8.1 Impact réel par sous-système (vérifié)
| Sous-système | Cassé par le changement de domaine ? |
|---|---|
| Appels **entrants** (SIP direct) | ❌ Non |
| Appels **sortants** (Path A LiveKit) | ❌ Non (l'appel) — ⚠️ dialer `APP_URL` pour sync/fallback |
| **Post-appel** (résumés/qualif) | ⚠️ **Oui si on oublie `NEXT_PUBLIC_APP_URL` sur l'Agent** |
| **Automatisations** natives | ❌ Non (cron interne) |
| **Connexion / dashboard** | ❌ Non (marche sur les 2 URLs) |
| **n8n** | ❌ Sans objet (non utilisé) |

### 8.2 Ordre recommandé (zéro coupure)
0. Merger la homepage dans `main` (déploiement Vercel normal).
1. **Vercel** : déplacer `axon-ai.tech` du projet `axon-ai` vers `minimax-for-occ` (pas de DNS à changer).
2. **Vercel** : `APP_URL` + `NEXT_PUBLIC_APP_URL` = `https://axon-ai.tech` → redéployer.
3. **Fly `axon-agent`** (+ LiveKit Cloud) : `NEXT_PUBLIC_APP_URL=https://axon-ai.tech`.
4. **Fly `minimax-for-occ`** (dialer) : `APP_URL=https://axon-ai.tech`.
5. **Recâbler côté fournisseurs** : Twilio, LiveKit Cloud, Stripe, Google OAuth. *(n8n : rien.)*
6. **Tester** : connexion + un appel sortant de test + vérifier qu'un résumé apparaît.

**Filet** : l'ancienne URL `.vercel.app` marche pendant toute l'opération. Ne jamais poser les variables sur `axon-ai.tech` **avant** l'étape 1.

### 8.3 Les 2 pièges à retenir
1. **`NEXT_PUBLIC_APP_URL` sur l'Agent** (Fly + LiveKit Cloud) — oubli = plus de résumés/qualif.
2. **`APP_URL` sur le Dialer** — oubli = sync prix coupé + fallback TwiML cassé.

---

## 9. Anomalies & dette technique (vérifiées)

1. **`DEEPGRAM_API_KEY`** = variable morte (STT réel = AssemblyAI).
2. **`REDIS_URL`** = documentée mais **non utilisée** (dialer en mémoire) → README à corriger.
3. **Agent = 2 déploiements** (Fly + LiveKit Cloud) → clarifier la vraie prod, mettre les secrets aux 2 endroits.
4. **Deux `minimax-for-occ`** (Vercel web + Fly dialer) → risque de confusion.
5. **Automatisations : sous-agents en `error`** (Agent 2..7 d'OCC) → à investiguer (ops, pas migration).
6. **Commentaires de code périmés** : `voice-inbound/route.ts` dit « no real inbound live » — **faux** aujourd'hui.
7. **Doc n8n obsolète** : les templates `n8n/` ne sont plus utilisés (moteur natif à la place).
8. Migrations Supabase **appliquées à la main** (pas de `config.toml`) → process à documenter.

---

*v2 — 2026-07-01 — état vérifié sur la base de production `ehlqjfuutyhpbrqcvdut`. Les affirmations d'état proviennent de requêtes SQL en lecture seule ; le fonctionnement provient de la lecture du code.*

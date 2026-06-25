# Faisabilité & specs — Webhook Facebook Lead Ads → appel vocal IA (AXON)

> Date : 2026-06-25 · Statut : **specs validées, non implémenté** · Périmètre : recevoir un lead
> Facebook (Lead Ad), récupérer ses coordonnées via la Graph API, l'enregistrer dans Supabase,
> et déclencher un appel vocal IA **dans la minute**.
>
> Décision d'architecture (validée avec le métier) : **tout isolé** de la campagne actuelle —
> table dédiée, agent(s) IA dédié(s), campagne dédiée, numéro dédié — via une **route Facebook
> native dans AXON** (et non via n8n).

---

## 0. Verdict

**FAISABLE.** L'essentiel de la plomberie existe déjà dans AXON :

- une route d'appel **unitaire** (`web/app/api/outbound-call/route.ts`) ;
- un pipeline de **leads entrants signés** qui supporte déjà `source: "facebook_ads"`
  (`web/app/api/leads/inbound/route.ts`) ;
- une logique **speed-to-lead** (priorité 0 → dialer qui *poll* toutes les 30 s ⇒ appel ~1 min) ;
- un **write-back post-appel** défensif vers une table tenant (`web/app/api/calls/[id]/sync-lead/route.ts`) ;
- même un **template n8n Facebook Lead Ads** déjà écrit (`n8n/templates/facebook-lead-ads-to-axon.json`).

Le seul maillon réellement manquant est l'**enrichissement Graph API** (récupérer `field_data`
à partir du `leadgen_id`) + la route native qui orchestre tout. Le reste est de l'assemblage et
de la configuration côté Meta.

> ⚠️ Piège n°1 à intégrer dès le départ : pour qu'un lead soit **appelé dans la minute**, il doit
> atterrir dans **`campaign_targets`** (la file du dialer), **pas** dans une table métier type
> `leads_rdv`. Voir §3.

---

## Sommaire

1. [Vue d'ensemble du flux cible](#1-vue-densemble-du-flux-cible)
2. [État de l'existant (ce qui est déjà là)](#2-état-de-lexistant)
3. [Les deux « mondes de leads » dans AXON](#3-les-deux-mondes-de-leads)
4. [Partie A — Côté compte Facebook / Meta](#4-partie-a--côté-compte-facebook--meta)
5. [Partie B — Côté AXON / Supabase](#5-partie-b--côté-axon--supabase)
6. [Partie C — Pourquoi le « dans la minute » fonctionne](#6-partie-c--pourquoi-le-dans-la-minute-fonctionne)
7. [Partie D — Ordre de réalisation](#7-partie-d--ordre-de-réalisation)
8. [Partie E — Risques & pièges](#8-partie-e--risques--pièges)
9. [Annexes](#9-annexes)

---

## 1. Vue d'ensemble du flux cible

```
[Pub Facebook Lead Ad]
   prospect remplit le formulaire instantané
        │
        ▼
[Meta] envoie un webhook POST  (leadgen_id seulement, PAS les coordonnées)
        │
        ▼
[AXON]  POST /api/facebook/leadgen          ← route NATIVE à créer
   1. vérifie la signature Meta (X-Hub-Signature-256 = HMAC-SHA256(body, APP_SECRET))
   2. répond 200 immédiatement
   3. appelle la Graph API avec le Page Token → récupère field_data (tél, nom, email…)
   4. INSERT dans la table dédiée  leads_facebook  (+ colonnes d'attribution pub)
   5. UPSERT contacts (org_id, e164)
   6. INSERT campaign_targets dans la CAMPAGNE DÉDIÉE :
        priority=0, next_attempt_at=now(),
        source_metadata = { physical_table:'leads_facebook', row_id, phase:'J1' }
        │
        ▼
[Dialer] (poll 30 s) compose via l'AGENT DÉDIÉ + le NUMÉRO DÉDIÉ → appel en ~1 min
        │
        ▼
[Fin d'appel]  POST /api/calls/[id]/sync-lead  → réécrit le résultat dans leads_facebook
```

**« Comment Facebook se relie à Supabase ? »** — Il n'y a **aucune connexion directe**. Meta n'envoie
que le `leadgen_id` ; les coordonnées ne sont récupérables **que** via la Graph API (avec un Page
Token). Le pont est donc : **webhook Meta → route AXON → Graph API → écriture Supabase**. Aucun
connecteur Meta↔Supabase natif n'existe (et c'est voulu : tout le contrôle est dans la route native).

---

## 2. État de l'existant

### 2.1 Déclenchement d'appel (3 mécanismes)

| Mécanisme | Fichier(s) | Déclenche |
|---|---|---|
| **Appel unitaire** (1 numéro, immédiat) | `web/app/api/outbound-call/route.ts` | UN appel tout de suite, sans campagne. **Exige une session utilisateur authentifiée** → inutilisable tel quel depuis un webhook. |
| **Campagne / file** | `web/app/api/campaigns/[id]/start/route.ts` → `dialer/src/main.ts` → `dialer/src/dial.ts` | File `campaign_targets`, *poll* toutes les 30 s (`POLL_INTERVAL_MS`). |
| **Sélection dynamique** (cadence OCC J1/J3/J5) | `dialer/src/dynamic-selection.ts` | Scanne une table tenant **par créneaux** (08/13/18 h) et seed `campaign_targets`. |

Chaîne LiveKit (commune) : `AgentDispatchClient.createDispatch()` (worker `axon-voice-agent`) →
attente warmup → `SipClient.createSipParticipant()` (trunk `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`, Twilio).

**Boucle dialer** (`dialer/src/main.ts`, vérifié) : liste les campagnes `state='running'`, applique
le `schedule`, et pour **toute** campagne (static ou dynamic) compose les `campaign_targets`
`status='pending'` dont `next_attempt_at <= now`, dans la limite de `max_concurrency`, espacés de
`DIAL_STAGGER_MS` (~1,3 s). Le mode `dynamic` ajoute seulement une étape de *seeding* par créneaux ;
le mode `static` **non** → c'est le mode à utiliser pour l'appel immédiat.

### 2.2 Webhooks entrants existants (modèles à copier)

App Router exclusivement (`web/app/api/**/route.ts`, ~205 routes ; aucun `pages/api`).

| Service | Fichier | Vérification |
|---|---|---|
| Retell | `web/app/api/retell/webhook/route.ts` | HMAC-SHA256 inline |
| Twilio | `web/app/api/twilio/status/route.ts`, `.../voice-inbound/route.ts` | `web/lib/twilio-signature.ts` (HMAC-SHA1) |
| Telnyx | `web/app/api/telnyx/status/route.ts` | `validateTelnyxSignature` |
| LiveKit | `web/app/api/livekit/agent-webhook/route.ts` | token LiveKit |
| Stripe | `web/app/api/billing/webhook/route.ts` | `STRIPE_WEBHOOK_SECRET` |
| **Leads entrants** | **`web/app/api/leads/inbound/route.ts`** | **HMAC-SHA256 + secret en base** (meilleur modèle) |

Bonus : `n8n/templates/facebook-lead-ads-to-axon.json` (workflow n8n complet, GET verify + POST
parse `leadgen` → `/api/leads/inbound`) et `docs/CONNECTORS.md`. Le maillon **Graph API** y est laissé
en TODO. On s'en inspire mais on fait la version **native** dans AXON.

### 2.3 Accès Supabase

- Helper serveur : `web/lib/supabase.ts` → `supabaseServer()` = client **service-role** (bypass RLS).
- Config centralisée : `web/lib/config.ts` (`mustEnv` / `optEnv`, getters paresseux).
- Env : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- ⚠️ `web/.env.production` est **commité dans le repo** → n'y mettre **aucun** secret Facebook.

### 2.4 Base de données

- **Projet Supabase AXON (prod)** : `lime-window` (`ehlqjfuutyhpbrqcvdut`).
- Le ref `kgohjmivilsfoewrcovn` (`emerald-ocean`) qui apparaît dans le code (`web/lib/nhs-legacy.ts:10`)
  est l'**ancienne** base OCC = `NHS_LEGACY_SUPABASE_URL` (migration de données), **pas** la prod AXON.

---

## 3. Les deux « mondes de leads »

C'est le point d'architecture le plus important à comprendre.

| | **`contacts` + `campaign_targets`** | **`leads_rdv`** (et tables tenant similaires) |
|---|---|---|
| Nature | File d'appel générique multi-tenant | CRM / cadence métier (propre à OCC) |
| Défini dans | migrations `0006`/`0007`/`0017` | **Aucune migration** — table tenant créée hors-repo, enregistrée dans `tenant_data_tables` |
| Qui l'appelle | dialer, en continu (poll 30 s) | dialer **par créneaux** (08/13/18 h) via `dynamic-selection.ts` |
| Délai d'appel | **~1 min** (speed-to-lead, priorité 0) | prochain créneau (cadence J1/J3/J5) |
| Écrit par `/api/leads/inbound` | ✅ oui | ❌ non |

➡️ **Conséquence** : « enregistrer dans une table métier » et « appeler dans la minute » sont deux
choses distinctes. Le **chemin minute = `campaign_targets`**. La table dédiée FB sera, elle, le
**registre métier + attribution**, et le **write-back** (`sync-lead`) y réécrira le résultat de
l'appel — à condition que le `campaign_target` porte `source_metadata.physical_table` + `row_id`
(voir §5.6 et annexe 9.2). `leads_rdv.next_call_at` existe mais n'est lu **que par l'UI**
(`PatientDrawer.tsx`, `NhsSuiviTab.tsx`), **pas** par le dialer.

---

## 4. Partie A — Côté compte Facebook / Meta

> ⚠️ Les noms de permissions et la version de la Graph API évoluent : **vérifier sur la doc Meta
> courante** au moment de l'implémentation. Les mécaniques ci-dessous sont stables depuis des années.

### A1. Pré-requis « business »
- **Meta Business Manager** (business.facebook.com) propriétaire de la **Page Facebook** OCC.
  *(Les Lead Ads sont toujours rattachées à une Page.)*
- **Compte publicitaire** (Ad Account) + moyen de paiement.
- **Business Verification** du Business Manager — nécessaire pour l'accès avancé aux leads (A2).
  **À lancer tôt** (délai de plusieurs jours).

### A2. L'application Meta (le « connecteur » technique)
Sur developers.facebook.com :
1. Créer une **App** de type *Business*.
2. Récupérer **App ID** + **App Secret** → l'App Secret sert à vérifier la signature des webhooks
   (`FACEBOOK_APP_SECRET`).
3. Ajouter les **produits** : *Webhooks* + *Marketing API* (Leads Access).
4. **Permissions** :
   - `leads_retrieval` — **indispensable** pour lire les données du lead via la Graph API ;
   - `pages_manage_metadata` — pour abonner la Page au webhook `leadgen` ;
   - `pages_show_list`, `pages_read_engagement` — résolution Page / token ;
   - (selon le cas) `ads_management` / `business_management`.
5. ⚠️ **App Review + Advanced Access** : `leads_retrieval` ne fonctionne en **production** (vrais
   leads de vrais utilisateurs) qu'après **App Review** validée + **Business Verification**. En mode
   *Development*, seuls les **admins/testeurs** de l'app et l'**outil de test** (A7) marchent.
   **C'est la principale dépendance de calendrier.**

### A3. Le token d'accès (pour la Graph API)
- Générer un **Page Access Token longue durée** pour la Page OCC, **ou** (recommandé serveur-à-serveur)
  un **System User Token** depuis le Business Manager, avec la Page assignée et `leads_retrieval`.
- Le **System User token n'expire pas** → idéal pour un backend Vercel. → `FACEBOOK_PAGE_ACCESS_TOKEN`.

### A4. Configuration du webhook (branchement Meta → AXON)
Dans l'App Meta → **Webhooks** → objet **Page** :
1. **Callback URL** = `https://<domaine-axon>/api/facebook/leadgen`.
2. **Verify Token** = une chaîne aléatoire que **tu choisis** → `FACEBOOK_VERIFY_TOKEN`. Meta enverra
   un `GET` (`hub.mode`, `hub.verify_token`, `hub.challenge`) ; la route renvoie `hub.challenge` si le
   token correspond.
3. **S'abonner au champ `leadgen`** de l'objet Page.
4. **Abonner la Page précise** : `POST /{page_id}/subscribed_apps` avec `subscribed_fields=leadgen`
   (Page Token). Sans cette étape, la Page n'émet aucun webhook.

### A5. La campagne publicitaire Lead Ads (Ads Manager)
1. **Objectif** = *Leads* (Génération de prospects).
2. **Ad set** : audience, budget, placements.
3. **Publicité** : créa + **formulaire instantané** (*Instant Form*).
   - **Champs** : impérativement **téléphone** (sinon pas d'appel) + nom, email, et questions métier
     (poids/taille/éligibilité NHS… si pré-collecte souhaitée).
   - Facebook **pré-remplit** le téléphone depuis le profil (bonne qualité), mais certains leads
     peuvent ne pas avoir de numéro.
   - ⚠️ **Le libellé des champs compte** : la route mappera `phone_number`/`phone`/`mobile`,
     `first_name`/`full_name`, etc. Les questions personnalisées arrivent avec leur **label** comme clé.
   - **Consentement d'appel** : ajouter une mention de consentement à être rappelé par téléphone.
4. Plusieurs formulaires/ad sets possibles : tous déclenchent le même webhook `leadgen` ; l'attribution
   (`form_id`, `ad_id`) est dans le payload.

### A6. Comment Facebook se relie à Supabase — explicite
- **Aucune connexion directe.** Le seul lien : **webhook `leadgen` → route AXON → Graph API →
  écriture Supabase**.
- Meta n'envoie **que** `leadgen_id` (+ `form_id`/`ad_id`/`page_id`/`created_time`). Les coordonnées
  réelles ne sont **récupérables que via la Graph API** avec le Page Token. D'où l'étape
  d'enrichissement obligatoire.

### A7. Tester sans dépenser
- **Lead Ads Testing Tool** : `developers.facebook.com/tools/lead-ads-testing`. Sélectionner Page +
  formulaire → « Create Lead » déclenche un vrai webhook `leadgen` avec un `field_data` de test.
  Permet de valider toute la chaîne **avant** la pub réelle.

---

## 5. Partie B — Côté AXON / Supabase

### B1. La table dédiée `leads_facebook`
Nouvelle table (via migration `supabase/migrations/00XX_leads_facebook.sql`). Trois familles de colonnes :

**(a) Colonnes « contrat » du write-back `sync-lead`** *(toutes optionnelles — la route est défensive
`has(col)`, mais sans elles on perd le suivi)* :
`id uuid pk`, `numero_telephone`, `nom`, `email`, `qualification`, `call_count`, `last_call_datetime`,
`last_call_id`, `last_updated`, `last_qualification_update`, `cycle_status` (défaut `'ACTIF'`),
`voicemail_detected`, `do_not_call` (défaut `false`).
→ Suffit pour **un appel immédiat**. Pour une **cadence J1/J3/J5**, ajouter `current_phase`,
`date_j1/j3/j5`, `j1/j3/j5_attempts` (mais alors campagne `dynamic` = créneaux, voir note §8).

**(b) Colonnes d'attribution publicitaire** *(le vrai gain d'une table dédiée — absentes de `leads_rdv`)* :
`leadgen_id` (**UNIQUE** → idempotence), `form_id`, `ad_id`, `adset_id`, `fb_campaign_id`, `page_id`,
`platform`, `created_time`, `raw jsonb`.

**(c) Colonnes métier** issues du formulaire (poids, taille, éligibilité…).

Schéma proposé (illustratif, **à créer lors de l'implémentation**) :

```sql
-- supabase/migrations/00XX_leads_facebook.sql  (PROPOSÉ — non appliqué)
create table if not exists public.leads_facebook (
  id                        uuid primary key default gen_random_uuid(),
  -- contact
  nom                       varchar,
  numero_telephone          varchar,
  email                     varchar,
  -- attribution pub (le gain d'une table dédiée)
  leadgen_id                text unique,            -- idempotence sur les retries Meta
  form_id                   text,
  ad_id                     text,
  adset_id                  text,
  fb_campaign_id            text,
  page_id                   text,
  platform                  text,                   -- 'facebook' | 'instagram'
  created_time              timestamptz,
  raw                       jsonb,
  -- contrat sync-lead (suivi d'appel)
  qualification             varchar,
  call_count                integer default 0,
  last_call_datetime        timestamptz,
  last_call_id              text,
  last_qualification_update timestamptz,
  cycle_status              text not null default 'ACTIF',
  voicemail_detected        boolean default false,
  do_not_call               boolean not null default false,
  -- métier (selon formulaire)
  poids                     numeric,
  taille                    numeric,
  bmi                       numeric,
  note                      text,
  date_creation             timestamptz default now()
);
```

### B2. (Optionnel) Rendre la table visible dans le desk AXON
Pour que les agents/le dashboard **voient** ces leads : enregistrer la table dans `tenant_data_tables`
(Admin → Data Tables, ou route `/api/data-tables/register`) avec `phone_column='numero_telephone'`,
`name_column='nom'`. *(Pas nécessaire pour appeler — le dialer lit `campaign_targets`, pas la table.)*

### B3. Les agents IA dédiés
- Créer un (ou plusieurs) **agent(s)** dans AXON (*Agents* → nouveau) : persona, **system prompt**
  taillé pour les leads FB obésité, **voix**, réglages LLM/TTS.
- Chaque agent crée une ligne `agents` + un **`agent_handle`** (kind `ai`). Noter l'**`agent_handle_id`**
  → c'est lui que la campagne référencera.
- Multi-agent (handoff qualif → prise de RDV) possible via `agent_team_id` / `script_id`.

### B4. Le numéro sortant dédié
- Affecter / acheter un **numéro** pour cette campagne (*Numbers*) → sépare réputation d'appel et
  attribution. Renseigné dans `campaigns.caller_id_e164` / `phone_number_id`.

### B5. La campagne dédiée (statique)
Colonnes pertinentes de `campaigns` (vérifiées en base) :
`agent_handle_id`, `agent_team_id`, `script_id`, `caller_id_e164`, `phone_number_id`, `schedule (jsonb)`,
`max_concurrency`, `max_attempts`, `retry_delay_min`, `amd_enabled`, `speed_to_lead_secs (def 60)`,
`data_table_id`, `mode ('static'|'dynamic')`, `state`, `metadata (jsonb)`.

Paramétrage cible :
- `mode = 'static'` ✅ (le moteur dynamique/créneaux ne s'en mêle pas → appel immédiat).
- `agent_handle_id` = **agent dédié** (B3).
- `caller_id_e164` / `phone_number_id` = **numéro dédié** (B4).
- `schedule` = **heures d'appel autorisées** (conformité).
- `speed_to_lead_secs` = 60 (ou moins).
- `max_attempts` / `retry_delay_min` = relance simple (ex. 3 essais, 60 min) — **sans** moteur J1/J3/J5.
- `state = 'running'`.

La route native injectera les `campaign_targets` dans **cette** campagne (résolue par
`FACEBOOK_CAMPAIGN_ID` en env, ou par nom/flag).

### B6. La route webhook native `web/app/api/facebook/leadgen/route.ts`
Calquée sur `web/app/api/leads/inbound/route.ts` + `retell/webhook`.
- `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`
- **`GET`** : si `hub.verify_token === FACEBOOK_VERIFY_TOKEN` → renvoyer `hub.challenge` (200 texte) ;
  sinon 403.
- **`POST`** :
  1. Lire le **body brut** ; vérifier `X-Hub-Signature-256` = `HMAC-SHA256(rawBody, FACEBOOK_APP_SECRET)`
     (comparaison *timing-safe*). Rejeter si KO.
  2. **Répondre 200 tout de suite** (Meta réessaie sinon) ; enrichir + écrire en tâche après-réponse
     (`after()` de `next/server`).
  3. Parcourir `entry[].changes[]` où `field==='leadgen'` → `leadgen_id`, `form_id`, `ad_id`,
     `page_id`, `created_time`.
  4. **Graph API** : `GET https://graph.facebook.com/v{VERSION}/{leadgen_id}?fields=field_data,created_time,ad_id,form_id&access_token={FACEBOOK_PAGE_ACCESS_TOKEN}`
     → aplatir `field_data` en `{ phone, nom, email, … }` (voir annexe 9.1).
  5. **Normaliser le téléphone en E.164** (réutiliser `normalisePhoneToE164` du dialer — défaut UK).
  6. **UPSERT** `leads_facebook` sur `leadgen_id` → récupérer `row_id`.
  7. **UPSERT** `contacts` `(org_id, e164)`.
  8. **INSERT** `campaign_targets` (campagne dédiée) :
     `status='pending'`, `priority=0`, `next_attempt_at=now()`, `contact_id`,
     `source='facebook_ads'`,
     `source_metadata={ physical_table:'leads_facebook', row_id, phase:'J1', leadgen_id, form_id, ad_id }`.
- ⇒ le dialer compose en ~1 min ; en fin d'appel, **`sync-lead` réécrit** dans `leads_facebook`
  (grâce à `physical_table` + `row_id`).

> Bonne pratique : **factoriser** les étapes 7-8 (upsert contact + seed target) dans un helper partagé
> avec `/api/leads/inbound`, plutôt que dupliquer.

### B7. Variables d'environnement (Vercel — via `web/lib/config.ts` + `.env.example`)

| Variable | Rôle |
|---|---|
| `FACEBOOK_VERIFY_TOKEN` | défi `GET` du webhook |
| `FACEBOOK_APP_SECRET` | vérif. `X-Hub-Signature-256` du `POST` |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | appels Graph API (System User token recommandé) |
| `FACEBOOK_GRAPH_VERSION` | version Graph (ex. `v21.0` — mettre la version courante) |
| `FACEBOOK_CAMPAIGN_ID` | la campagne dédiée à alimenter |

⚠️ **Ne PAS** mettre ces secrets dans `web/.env.production` (commité) — uniquement variables Vercel.

---

## 6. Partie C — Pourquoi le « dans la minute » fonctionne

`mode='static'` + `state='running'` ⇒ `dialer/src/main.ts` ignore les créneaux du moteur dynamique et
compose **tout target `pending` échu** au prochain *poll* (`POLL_INTERVAL_MS=30 s`), dans la limite de
`max_concurrency`, espacé de `DIAL_STAGGER_MS` (~1,3 s, non bloquant à faible volume). Avec `priority=0`
+ `next_attempt_at=now()`, le lead FB est en tête de file → **appel sous ~30–60 s**.

---

## 7. Partie D — Ordre de réalisation

1. **Lancer tôt** : Business Verification + demande d'`App Review` / `leads_retrieval`
   (dépendance la plus longue).
2. Créer la **table dédiée** `leads_facebook` (+ contrainte unique `leadgen_id`).
3. Créer **agent(s) dédié(s)** + **numéro dédié** + **campagne dédiée** (`static`, `running`).
4. Développer la **route native** (`GET` + `POST` + Graph API + écritures).
5. Ajouter les **variables Vercel**.
6. **Tester** end-to-end avec le **Lead Ads Testing Tool** (sans pub).
7. Configurer le **webhook Meta** (callback + verify token + abonnement `leadgen` de la Page).
8. **Lancer la pub** (petit budget) → vérifier appel < 1 min + write-back dans `leads_facebook`.

---

## 8. Partie E — Risques & pièges

1. **App Review / `leads_retrieval`** : sans accès avancé, les vrais leads n'arrivent pas (seul le
   testing tool marche). **À débloquer avant la prod.**
2. **Token de Page** : préférer un **System User token** (n'expire pas) ; un token classique peut
   expirer et casser l'enrichissement **silencieusement**.
3. **Idempotence** : Meta peut renvoyer le même `leadgen_id` → unicité sur `leadgen_id` + upsert pour
   éviter le **double appel**.
4. **Accusé rapide** : Meta exige une réponse rapide et réessaie → **répondre 200 d'abord**, enrichir
   ensuite.
5. **Sécurité** : vérifier `X-Hub-Signature-256` (App Secret), pas seulement le verify token GET —
   sinon endpoint falsifiable.
6. **Conformité appel** (UK/Ofcom, GDPR, TCPA) : consentement explicite dans le formulaire, respect
   `do_not_call`/DNC (déjà géré par le dialer), heures d'appel via `schedule`.
7. **Dépendances d'infra partagées** : worker dialer up, **trunk SIP** (`LIVEKIT_SIP_OUTBOUND_TRUNK_ID`)
   opérationnel ; limite **1 CPS Twilio** (avant approbation du Business Profile) sans impact à faible
   volume FB, mais à surveiller en cas de pics.
8. **Qualité des numéros** : certains leads FB n'ont pas de téléphone valide → *fallback* (skip + log)
   plutôt que planter.
9. **Latence/qualité voix** : orthogonal à ce webhook, mais `AUDIT_APPELS_IA.md` documente une latence
   pipeline élevée — pertinent pour la *qualité* de l'appel déclenché, pas pour le déclenchement.

> **Note cadence J1/J3/J5** : pour des relances multi-jours comme sur `leads_rdv`, il faudrait passer
> la campagne en `mode='dynamic'`, enregistrer la table dans `tenant_data_tables`, et fournir un
> `metadata.engine` — mais alors les appels repassent en **créneaux** (08/13/18 h) et on perd le « dans
> la minute ». Les deux peuvent coexister (1er appel immédiat en static + relances en dynamic), au prix
> d'un cran de complexité — à traiter dans un second temps.

---

## 9. Annexes

### 9.1 Mapping `field_data` (formulaire FB → colonnes)

Le payload Graph API renvoie `field_data` comme une liste `[{ name, values: [...] }]`. Aplatir en
normalisant la clé (`name` en minuscules, non-alphanum → `_`), puis mapper avec des *fallbacks*
(logique reprise du template n8n existant) :

| Champ AXON | Clés FB acceptées (fallback dans l'ordre) |
|---|---|
| `e164` (tél) | `phone_number`, `phone`, `mobile` |
| `nom` / `first_name` | `first_name`, `full_name` |
| `last_name` | `last_name` |
| `email` | `email` |
| (attribution) | `leadgen_id`, `form_id`, `ad_id`, `adgroup_id` (=adset), `page_id`, `created_time` |
| (métier) | labels des questions personnalisées du formulaire |

> ⚠️ Les questions personnalisées arrivent avec leur **libellé exact** comme `name` → figer les
> libellés du formulaire FB pour ne pas casser le mapping.

### 9.2 Contrat du write-back `sync-lead` (`web/app/api/calls/[id]/sync-lead/route.ts`)

- Se déclenche en fin d'appel (depuis le worker agent), authentif. optionnelle par `APP_SHARED_TOKEN`.
- Retrouve le `campaign_target` (via `last_call_id`, ou fallback dernier target `data_table_dynamic`
  vers ce numéro), lit `source_metadata.physical_table` + `row_id` + `phase`.
- **N'agit que** si `physical_table` + `row_id` sont présents → **la route native doit les renseigner**
  dans `source_metadata` (étape B6.8).
- Écrit (uniquement les colonnes existantes, `has(col)`) : `call_count +1`, `last_call_datetime`,
  `last_call_id`, `last_updated`, `qualification` (miroir de l'issue d'appel), `last_qualification_update`
  (si qualif explicite), `date_jN`/`jN_attempts` (si cadence), `cycle_status`
  (`RDV`/`CLOS`/`HUMAIN` selon issue), `voicemail_detected`.
- Idempotent : si `last_call_id` == call courant → skip.
- Filet de sécurité : crée un `human_callback_tasks` si issue `A PASSER A L'HUMAIN` / `SUIVI REQUIS`.

### 9.3 Fichiers clés (référence)

| Sujet | Fichier |
|---|---|
| Appel unitaire (auth requise) | `web/app/api/outbound-call/route.ts` |
| Webhook leads (meilleur modèle) | `web/app/api/leads/inbound/route.ts` |
| Write-back post-appel | `web/app/api/calls/[id]/sync-lead/route.ts` |
| Boucle dialer (poll, static/dynamic) | `dialer/src/main.ts` |
| Pose d'appel LiveKit/SIP | `dialer/src/dial.ts` |
| Sélection dynamique (créneaux, `leads_rdv`) | `dialer/src/dynamic-selection.ts` |
| Client Supabase serveur | `web/lib/supabase.ts` |
| Config / env | `web/lib/config.ts`, `web/.env.example` |
| Infra connecteurs entrants | `supabase/migrations/0017_leads_inbound.sql` |
| Template n8n FB (référence) | `n8n/templates/facebook-lead-ads-to-axon.json` |
| Doc connecteurs | `docs/CONNECTORS.md` |

### 9.4 Schéma de référence `leads_rdv` (base lime-window, à titre comparatif)

Table tenant OCC (non présente dans les migrations). Colonnes d'attribution publicitaire **présentes** :
`source_lead` (varchar, générique), `form_facebook` (varchar, texte libre). **Manquantes** :
`form_id`, `ad_id`, `adset_id`, `campaign_id` (pub), `leadgen_id`, `platform`, `page_id`, `utm_*`.
→ C'est précisément ce que la table dédiée `leads_facebook` corrige en natif (§5 B1).

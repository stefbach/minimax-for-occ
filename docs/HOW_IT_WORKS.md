# Comment ça marche — Sous le capot d'Axon

Ce document est le **guide pédagogique** d'Axon. Il complète le [USER_GUIDE.md](USER_GUIDE.md) qui, lui, explique l'**interface** page par page. Ici on ouvre le capot et on regarde **ce qui se passe quand un appel arrive, ce qu'est un LLM, comment un agent IA décide de répondre, et combien ça coûte vraiment à la minute**.

Public visé : opérateurs, admins, et toute personne curieuse de comprendre la mécanique avant d'écrire son premier prompt système.

---

## Table des matières

1. [Vue d'ensemble — Le voyage d'un appel](#1-vue-densemble--le-voyage-dun-appel)
2. [Le LLM — Le cerveau de l'agent](#2-le-llm--le-cerveau-de-lagent)
3. [Le STT — Comprendre ce que dit le client](#3-le-stt--comprendre-ce-que-dit-le-client)
4. [Le TTS — Faire parler l'agent](#4-le-tts--faire-parler-lagent)
5. [Anatomie d'un agent IA dans Axon](#5-anatomie-dun-agent-ia-dans-axon)
6. [Personas — Modèles prêts à cloner](#6-personas--modèles-prêts-à-cloner)
7. [Multi-agent swarm — Plusieurs agents qui collaborent](#7-multi-agent-swarm--plusieurs-agents-qui-collaborent)
8. [RAG — Donner de la mémoire à l'agent](#8-rag--donner-de-la-mémoire-à-lagent)
9. [Tools n8n — Donner des super-pouvoirs à l'agent](#9-tools-n8n--donner-des-super-pouvoirs-à-lagent)
10. [Coûts estimés par minute d'appel](#10-coûts-estimés-par-minute-dappel)
11. [Best practices pour écrire un prompt système](#11-best-practices-pour-écrire-un-prompt-système)
12. [Tester un agent avant de le mettre en prod](#12-tester-un-agent-avant-de-le-mettre-en-prod)
13. [Monitoring en live](#13-monitoring-en-live)
14. [Mode Manager IA — Le copilote Super Admin](#14-mode-manager-ia--le-copilote-super-admin)
15. [FAQ](#15-faq)
16. [Ressources](#16-ressources)

---

## 1. Vue d'ensemble — Le voyage d'un appel

Avant de parler de modèles, de prompts et de coûts, il faut comprendre **ce qui se passe physiquement** quand un client compose un numéro Axon. Le voyage complet, en une carte :

```
                           Client compose +33 7 56 12 34 56
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Twilio reçoit l'appel (PSTN → IP)               │
                │ → webhook POST /api/twilio-voice                │
                │   payload : { From, To, CallSid, ... }          │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Notre serveur Next.js (Vercel) :                │
                │ 1. lit le routing du numéro (table phone_numbers)│
                │ 2. décide quel agent IA répond                  │
                │ 3. retourne du TwiML : <Dial><Sip>...</Sip>     │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Twilio compose un appel SIP vers le trunk LiveKit│
                │ (sip:agent-XYZ@<projet>.sip.livekit.cloud)      │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ LiveKit crée une "room" (salle audio temps réel)│
                │ + déclenche un event "participant joined"       │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Notre agent worker Python (Fly.io) reçoit       │
                │ l'event, rejoint la room en tant que bot, et    │
                │ instancie le pipeline voix LiveKit Agents.      │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
              ┌─────────────────────────────────────────────────────┐
              │  Boucle temps réel (toutes les ~200 ms) :           │
              │                                                     │
              │  ┌──────────┐   audio    ┌──────────┐   texte       │
              │  │ Client   │ ─────────▶ │ Deepgram │ ─────────┐    │
              │  │ parle    │            │ STT      │          │    │
              │  └──────────┘            └──────────┘          ▼    │
              │                                          ┌──────────┐│
              │                                          │ LLM      ││
              │                                          │ (cerveau)││
              │                                          └────┬─────┘│
              │                                               │      │
              │  ┌──────────┐   audio    ┌──────────┐    texte│      │
              │  │ Client   │ ◀───────── │ MiniMax  │ ◀───────┘      │
              │  │ entend   │            │ TTS      │                │
              │  └──────────┘            └──────────┘                │
              └─────────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Fin d'appel : Twilio envoie l'enregistrement    │
                │ → webhook POST /api/twilio/recording            │
                │   payload : { RecordingUrl, CallSid, ... }      │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ Notre serveur :                                 │
                │ 1. télécharge le mp3                            │
                │ 2. stocke dans Supabase Storage                 │
                │ 3. déclenche transcription                      │
                │ 4. lance les analyses LLM activées              │
                │    (sentiment, intent, satisfaction, alertes)   │
                └─────────────────────────────────────────────────┘
                                          │
                                          ▼
                ┌─────────────────────────────────────────────────┐
                │ /calls et /analytics affichent le résultat      │
                └─────────────────────────────────────────────────┘
```

### Les 5 acteurs à retenir

| Acteur | Rôle | Qui le fournit |
|---|---|---|
| **Twilio** | Le téléphone (PSTN → SIP) | Twilio.com |
| **LiveKit** | La salle audio temps réel + le bridge SIP | LiveKit Cloud |
| **Agent worker** | Le programme Python qui orchestre le pipeline | Hébergé chez nous (Fly.io) |
| **STT / LLM / TTS** | Comprendre → Réfléchir → Parler | Deepgram / OpenAI ou Claude / MiniMax |
| **Notre backend** | Routage, persistance, analyses | Next.js sur Vercel + Supabase Postgres |

Tu n'as **rien à installer** pour utiliser ça. Tout est déjà câblé. Le travail d'opérateur, c'est de **régler les bons paramètres** (quel LLM, quel prompt, quelle voix, quel routage) — et c'est l'objet des chapitres suivants.

### Latence ressentie

Quand tout va bien, le client perçoit ~700 ms à 1.2 s entre la fin de sa phrase et le début de la réponse de l'agent. C'est l'addition de :

- **STT (Deepgram)** : ~250–350 ms
- **LLM (gpt-4o-mini)** : ~400–600 ms (premier token)
- **TTS (MiniMax)** : ~150–250 ms (premier paquet audio)
- **Réseau + bridge SIP** : ~100 ms

C'est dans la zone "humaine" (un humain attentif laisse passer 600–900 ms avant de répondre). Au-dessus de 1.5 s, le client a l'impression que l'agent "rame" — c'est souvent un signe qu'il faut changer de LLM ou raccourcir le system prompt.

---

## 2. Le LLM — Le cerveau de l'agent

### C'est quoi un LLM ?

**LLM = Large Language Model**. C'est un modèle d'intelligence artificielle qui prend du texte en entrée et produit du texte en sortie. Les plus connus :

- **GPT-4o / GPT-4o-mini** d'OpenAI
- **Claude (Sonnet, Haiku, Opus)** d'Anthropic
- **MiniMax-M2** de MiniMax

Pour vulgariser : c'est un programme qui a "lu" une énorme quantité de texte du web et qui sait, à partir d'un contexte (le system prompt + l'historique de la conversation), prédire la suite la plus plausible. Quand cette suite est une réponse pertinente à une question, on a l'illusion (souvent juste) qu'il "comprend".

**Ce que le LLM ne fait pas tout seul** :
- Il n'entend pas le son. Il faut un STT en amont.
- Il ne parle pas. Il faut un TTS en aval.
- Il n'a pas accès à ta base clients. Il faut un RAG ou un tool.
- Il n'a pas de mémoire entre deux appels. Chaque appel commence "à zéro".

### Comment Axon utilise un LLM

Chaque agent IA dans Axon est lié à **un et un seul LLM**, via deux colonnes de la table `agents` :

- `llm_provider` (string) — `openai` | `anthropic` | `minimax`
- `llm_model` (string) — l'identifiant exact, ex. `gpt-4o-mini`, `claude-3-5-sonnet-20241022`

À chaque tour de parole, l'agent worker assemble un message du type :

```
SYSTEM: <system_prompt de l'agent>
USER:   <ce que le client vient de dire>
... (historique des derniers tours)
```

…et envoie ça à l'API du provider. La réponse texte part au TTS, qui produit l'audio.

### Comparatif des modèles supportés

| Modèle | Latence (1er token) | Intelligence | Coût / M tokens (in / out) | Quand l'utiliser |
|---|---|---|---|---|
| `gpt-4o-mini` | ~400–600 ms | Bonne | 0.15 $ / 0.60 $ | **DÉFAUT** — 90% des cas, excellent rapport qualité/prix |
| `gpt-4o` | ~600–800 ms | Excellente | 2.50 $ / 10 $ | Cas complexes : négociation, réclamations, expertise |
| `claude-3-5-sonnet` | ~500–700 ms | Excellente | 3 $ / 15 $ | Conversations nuancées, ton très naturel, français impeccable |
| `claude-3-5-haiku` | ~350–500 ms | Très bonne | 1 $ / 5 $ | Bon compromis qualité/prix/latence pour le français |
| `minimax-m2` | ~350–500 ms | Bonne | très bas | Si volume très élevé et que la qualité conversationnelle de base suffit |

> Les chiffres de latence sont indicatifs depuis l'Europe vers la région la plus proche du provider. Les coûts changent : vérifie toujours les prix actuels chez OpenAI / Anthropic / MiniMax.

### Combien de tokens consomme un appel ?

Ordre de grandeur pour un appel de 3 minutes en français :

- System prompt : ~500–1500 tokens (réutilisé à chaque tour, attention si très long)
- Historique : ~50–200 tokens par tour, ~10–20 tours
- Sortie : ~30–80 tokens par réponse de l'agent

Total typique : **~5 000–15 000 tokens input + ~500–1500 output** par appel.
En `gpt-4o-mini`, ça fait < 1 cent de LLM pour un appel de 3 min. C'est presque gratuit.

### Comment changer le LLM d'un agent depuis l'UI

1. Va sur `/agents`
2. Clique sur l'agent à modifier
3. Onglet **Configuration** → section **Modèle de langage (LLM)**
4. Choisis le provider et le modèle dans les listes déroulantes
5. **Save** — le changement est appliqué pour les **prochains** appels (les appels en cours continuent avec l'ancien modèle)

Les clés d'API (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`) sont configurées au niveau de l'agent worker — un Super Admin doit s'assurer qu'elles sont présentes en variables d'environnement Fly.io. Sinon le changement de modèle dans l'UI échouera silencieusement (l'agent décrochera puis raccrochera ; voir [FAQ](#15-faq)).

---

## 3. Le STT — Comprendre ce que dit le client

**STT = Speech-to-Text**, ou "reconnaissance vocale". C'est la couche qui transforme l'audio entrant (la voix du client) en texte exploitable par le LLM.

Axon utilise **Deepgram Nova-3** :

- **Latence** : < 300 ms (streaming, partials en continu)
- **Langues** : auto-détection multilingue (français, anglais, espagnol, allemand, arabe, etc.)
- **Précision** : ~90–95% sur du français standard téléphone (8 kHz)
- **Endpointing** : détection automatique de fin de phrase ("le client a fini de parler")

L'agent worker tient une connexion WebSocket permanente avec Deepgram pendant tout l'appel. À chaque salve de paroles, il reçoit :

1. Des **partials** (transcriptions provisoires, mises à jour à mesure que le client parle)
2. Un **final** quand l'utilisateur s'arrête de parler

Le `final` déclenche l'envoi au LLM. C'est ce qui crée l'effet "le bot écoute, puis répond" — il n'envoie pas une requête au LLM tant que le client parle encore.

### Astuces

- Si tes clients parlent dans des contextes bruyants (rue, voiture), demande à ton admin de monter le seuil d'endpointing pour éviter les "faux silences"
- Si l'agent **coupe la parole**, c'est le contraire : il faut allonger le délai de fin de phrase
- Pour les langues exotiques (japonais, arabe), prévoir un test en conditions réelles avant la prod

---

## 4. Le TTS — Faire parler l'agent

**TTS = Text-to-Speech**, ou "synthèse vocale". À l'inverse du STT, il transforme le texte produit par le LLM en audio que le client entend.

Axon utilise **MiniMax speech-02-hd** par défaut, avec deux fonctionnalités clés :

### 4.1. Voice cloning

Tu peux **cloner une voix** à partir d'un échantillon audio de 30 secondes (un enregistrement WAV/MP3 propre). Une fois clonée, la voix devient un `voice_id` que tu peux assigner à n'importe quel agent.

Pourquoi cloner ? Parce que **la cohérence de marque est massive** : avoir "la voix de la maison" sur tous les appels (au lieu de la même voix générique que 1000 autres SaaS) augmente la perception de professionnalisme et la mémorisation.

Pour cloner :
1. `/voices` → **Nouvelle voix**
2. Upload un échantillon de 30 secondes en français parlé naturellement (pas chuchoté, pas lu)
3. Donne un nom (ex. "Sophie - Concierge")
4. Attends ~30 s de traitement
5. La voix devient disponible dans le sélecteur de chaque agent

### 4.2. Paramètres expressifs

Chaque agent peut configurer :

- `voice_id` : la voix à utiliser
- `voice_speed` : 0.5 (lent) → 2.0 (rapide), défaut 1.0
- `voice_emotion` : `neutral` | `happy` | `sad` | `angry` | `fearful` | `disgusted` | `surprised`

L'émotion influence la prosodie (intonation, rythme) — un agent SAV peut être `happy` par défaut, un agent recouvrement plutôt `neutral` pour rester sérieux.

### Latence TTS

MiniMax streame l'audio par paquets : le premier paquet arrive après ~150–250 ms, et le reste suit en continu. L'agent commence à parler avant même que le LLM ait fini sa phrase — c'est ce qui donne la sensation "live".

---

## 5. Anatomie d'un agent IA dans Axon

Un agent dans Axon, c'est une ligne dans la table Postgres `agents`. Voici les colonnes qui comptent vraiment :

```sql
agents (
  id                uuid           -- identifiant
  org_id            uuid           -- multi-tenant : à qui appartient l'agent
  name              text           -- "Sophie - Concierge réservation"
  status            text           -- "active" | "inactive"

  -- Le CERVEAU
  system_prompt     text           -- le brief pédagogique (peut faire 3000+ chars)
  llm_provider      text           -- "openai" | "anthropic" | "minimax"
  llm_model         text           -- "gpt-4o-mini", "claude-3-5-sonnet-20241022"

  -- La VOIX
  voice_id          text           -- ID MiniMax (voix clonée ou prête)
  voice_speed       numeric        -- 0.5 → 2.0
  voice_emotion     text           -- "neutral" | "happy" | ...
  language          text           -- "fr" | "en" | "multi"

  -- La MÉMOIRE
  rag_enabled       boolean        -- l'agent peut-il chercher dans des docs ?
  rag_top_k         int            -- combien de passages remonter par recherche

  -- Les OUTILS
  n8n_bindings      jsonb          -- liste de workflows n8n qu'il peut appeler

  -- Le SWARM
  team_id           uuid           -- équipe à laquelle il appartient
  specialty         text           -- "lead" | "billing" | "support" | ...

  -- META
  created_at        timestamptz
  updated_at        timestamptz
)
```

### 5.1. `system_prompt` — Le brief pédagogique

C'est **le texte qui décrit le rôle** de l'agent. Quelques exemples de ce qu'il contient :

- Identité ("Tu es Sophie, l'assistante du restaurant Le Bistrot Parisien")
- Mission ("Tu prends les réservations et tu réponds aux questions sur le menu")
- Ton ("Chaleureuse, professionnelle, jamais familière")
- Règles ("Tu refuses poliment les demandes hors-sujet" / "Tu ne donnes jamais le numéro privé du chef")
- Workflow ("D'abord demander date+heure, ensuite nombre de personnes, ensuite nom+téléphone, ensuite confirmer")
- Conditions de transfert ("Si le client est très en colère ou demande un manager, déclenche `transfer_to_specialist('manager')`")

Voir le chapitre [Best practices](#11-best-practices-pour-écrire-un-prompt-système).

### 5.2. `llm_provider` + `llm_model` — Qui réfléchit

Voir chapitre [Le LLM](#2-le-llm--le-cerveau-de-lagent).

### 5.3. `voice_id` + `voice_speed` + `voice_emotion` — Qui parle

Voir chapitre [Le TTS](#4-le-tts--faire-parler-lagent).

### 5.4. `language` — Quelle langue

- `fr` : impose le français au STT et au TTS
- `en` : anglais
- `multi` : auto-détection (utile si la clientèle est mixte)

Important : même en mode `multi`, le **system prompt doit être écrit dans la langue cible**. Un prompt en anglais avec `language=fr` produira souvent des réponses en anglais — le LLM "imite" la langue du prompt.

### 5.5. `rag_enabled` + documents — Sa base de connaissances

Voir chapitre [RAG](#8-rag--donner-de-la-mémoire-à-lagent).

### 5.6. `n8n_bindings` — Ses outils

Voir chapitre [Tools n8n](#9-tools-n8n--donner-des-super-pouvoirs-à-lagent).

### 5.7. `team_id` + `specialty` — Sa place dans le swarm

Voir chapitre [Multi-agent swarm](#7-multi-agent-swarm--plusieurs-agents-qui-collaborent).

---

## 6. Personas — Modèles prêts à cloner

Tout le monde n'a pas le temps d'écrire un système prompt de 2000 caractères. C'est pourquoi Axon embarque une **bibliothèque de personas** : des agents pré-configurés que tu peux cloner en un clic dans ton organisation.

### 6.1. Où sont-ils ?

Dans le repo, sous `/personas/`. Chaque persona est un fichier `.md` avec **YAML frontmatter** + corps en markdown.

### 6.2. Format d'un persona

```yaml
---
slug: concierge-restaurant
name: Concierge Restaurant
description: Prend les réservations, répond aux questions menu/horaires, transfère au manager si besoin
language: fr
llm_model: gpt-4o-mini
voice_emotion: happy
voice_speed: 1.0
specialty: lead
tags:
  - hospitality
  - restauration
  - inbound
---

Tu es Sophie, l'assistante virtuelle du restaurant Le Bistrot Parisien.

# Mission
Tu prends les réservations par téléphone, tu réponds aux questions sur le menu,
les horaires, et l'emplacement. Tu transfères au manager humain en cas de
demande spéciale ou de litige.

# Ton
Chaleureuse, naturelle, jamais familière. Tu dis "vous". Phrases courtes.

# Workflow réservation
1. Demande la date et l'heure souhaitées.
2. Demande le nombre de couverts.
3. Demande le nom et un numéro de téléphone pour confirmer.
4. Confirme la réservation et préviens que tu envoies un SMS de confirmation.
5. Termine par "Très bonne journée et à bientôt !"

# Règles
- Tu ne prends jamais de réservation à plus de 60 jours.
- Tu refuses poliment toute demande sortant du périmètre restaurant.
- Si le client devient agressif, tu transfères au manager via
  `transfer_to_specialist("manager")`.
```

### 6.3. Cloner un persona

Depuis l'UI :

1. Va sur `/agents/library`
2. Parcours les personas (filtres par tag : `hospitality`, `sales`, `support`, `recouvrement`...)
3. Clique sur celui qui te plaît → **Prévisualiser**
4. Bouton **Cloner dans mon organisation**
5. L'agent est créé dans ta `/agents`, avec un suffixe `(clone)` que tu peux retirer
6. Customise (nom, voix, prompt) et active-le

Sous le capot, le clone :

- copie le **corps markdown** → `system_prompt`
- copie `language`, `llm_model`, `voice_emotion`, `voice_speed`, `specialty` → colonnes de la table `agents`
- déduit `llm_provider` à partir de `llm_model` : `claude*` → `anthropic`, `minimax*` → `minimax`, sinon `openai`
- met `status = "inactive"` par défaut (tu actives quand tu es prêt)

### 6.4. Customiser après clone

Tout est modifiable. Le persona n'est qu'un **point de départ**. Quelques modifications fréquentes :

- Remplacer "Sophie" par le prénom que tu veux
- Changer la voix pour celle de ta marque (voir [TTS](#4-le-tts--faire-parler-lagent))
- Ajouter des règles spécifiques à ton métier ("on est fermés le dimanche")
- Brancher des tools n8n (envoi de SMS de confirmation, ajout au CRM)
- Activer le RAG sur ton menu PDF

### 6.5. Exporter un de tes agents pour le partager

L'opération inverse : transformer ton agent en persona réutilisable.

1. `/agents/[id]` → menu `…` → **Exporter en persona**
2. Tu télécharges un `.md` que tu peux soit garder pour toi, soit proposer en pull request dans `/personas/` du repo

C'est aussi comme ça que ta team interne peut partager les bonnes pratiques.

---

## 7. Multi-agent swarm — Plusieurs agents qui collaborent

### 7.1. Pourquoi un swarm ?

Un seul agent qui sait tout faire devient vite **un prompt monstrueux** : 5000 caractères, des règles contradictoires, un LLM qui hésite. La règle d'or : **un agent = une mission**.

Pour des cas où l'appel touche plusieurs missions (ex. un client qui appelle pour une question facture, puis veut prendre rendez-vous), on utilise un **swarm** : une équipe d'agents spécialisés, avec un agent **lead** qui route les conversations vers le bon spécialiste.

### 7.2. Anatomie d'une équipe

Une équipe = une ligne dans la table `agent_teams` + plusieurs `agents` qui pointent dessus via `team_id`.

```
agent_teams
  id: team-bistrot
  name: "Équipe Bistrot"
  org_id: ...

agents
  ├─ Sophie (specialty=lead, team_id=team-bistrot)        -- décroche en premier
  ├─ Pierre (specialty=billing, team_id=team-bistrot)     -- factures, paiement
  ├─ Marie  (specialty=booking, team_id=team-bistrot)     -- réservations complexes
  └─ Manager humain (specialty=manager, team_id=team-bistrot)  -- escalade
```

### 7.3. Le tool `transfer_to_specialist`

Tout agent appartenant à une team reçoit automatiquement un tool LLM :

```
transfer_to_specialist(specialty: string, reason: string)
```

Quand le LLM décide d'appeler ce tool (parce que son system prompt lui dit de le faire dans tel cas), notre agent worker :

1. Cherche dans la même `team_id` un agent dont `specialty` = la valeur demandée
2. Si trouvé, **passe la main dans la MÊME room LiveKit** :
   - L'agent actuel envoie une dernière phrase de transition ("Je vous passe Pierre du service facturation, il va vous aider.")
   - L'agent worker change de system prompt + voice_id à la volée
   - L'historique de conversation est partagé avec le nouveau persona
3. Le client **n'entend pas de cut**, pas de musique d'attente, pas de re-décroché — juste un changement de voix et de rôle, comme un vrai transfert interne

C'est très puissant pour deux raisons :

- **Pas de transfert SIP** : on ne paie pas une seconde minute Twilio sortante, on reste dans la même session
- **Le contexte est préservé** : le nouvel agent voit tout l'historique, le client n'a pas à se répéter

### 7.4. Cas d'usage type — Le Concierge

```
Lead "Concierge"
  ├─ détecte "j'ai un problème de facture"
  │   → transfer_to_specialist("billing")
  │
  ├─ détecte "je veux réserver pour 12 personnes"
  │   → transfer_to_specialist("booking")
  │
  └─ détecte "je veux parler à un vrai humain / votre manager"
      → transfer_to_specialist("manager")
        → bascule sur un softphone humain (LiveKit)
```

Côté system prompt du lead, on ajoute simplement :

> Si le client mentionne une facture, un paiement, ou un remboursement, appelle
> `transfer_to_specialist("billing")` avec un `reason` court.

Le LLM est très bon pour ça : il intercepte les bonnes intentions sans qu'on lui code de règles strictes.

### 7.5. Le manager humain dans le swarm

Le `specialty = "manager"` peut pointer non pas vers un autre agent IA, mais vers une **file d'attente humaine**. Le transfer route alors le client vers le premier agent humain disponible (softphone web) au lieu de changer de persona IA.

---

## 8. RAG — Donner de la mémoire à l'agent

### 8.1. Pourquoi RAG ?

**RAG = Retrieval-Augmented Generation**. Sans RAG, l'agent ne connaît que ce qu'il a vu pendant son entraînement (2023, 2024 selon le modèle). Il ne connaît **pas** :

- Ton catalogue produit
- Tes horaires
- Tes CGV
- Ton menu / ta carte des vins
- L'historique du client qui appelle

Le RAG résout ça : tu **uploades des documents** (PDF, TXT, markdown), Axon les découpe en petits morceaux ("chunks"), les transforme en vecteurs (embeddings) stockés dans Postgres (pgvector), et **à chaque tour de parole**, l'agent peut chercher les passages les plus pertinents.

### 8.2. Comment ça marche concrètement

```
Upload "menu_2025.pdf"
   ↓
Axon découpe en chunks de ~1500 caractères chacun
   ↓
Pour chaque chunk : appel OpenAI embeddings → vecteur de 1536 nombres
   ↓
Stockage dans table `rag_chunks` (pgvector)
   ↓
─────────────────────────────────────────────────────
Pendant l'appel, le client demande "vous avez du vin sans alcool ?"
   ↓
L'agent (LLM) décide d'appeler le tool : search_knowledge_base("vin sans alcool")
   ↓
Axon vectorise la query → cherche les top-K=5 chunks les plus proches
   ↓
Les chunks pertinents sont injectés dans le contexte du LLM
   ↓
Le LLM répond en s'appuyant sur le contenu réel du menu
```

### 8.3. Configurer le RAG d'un agent

1. `/agents/[id]` → onglet **Connaissances (RAG)**
2. Active **RAG enabled**
3. Upload tes documents (PDF / TXT / MD)
4. Attends l'indexation (quelques secondes par doc)
5. Règle `top_k` (3 → 8 selon la densité d'info attendue)
6. Mentionne le tool dans ton system prompt :
   > Tu disposes d'un outil `search_knowledge_base(query)` pour chercher dans le menu.
   > Utilise-le **systématiquement** avant de répondre à une question sur la carte.

### 8.4. Limites pratiques

- **Taille de chunk** : 1500 caractères par défaut. Trop petit → contexte trop fragmenté ; trop grand → recherches imprécises.
- **Top-K** : 5 par défaut. Au-delà de 8, on bourre le contexte et la latence LLM monte.
- **Coût** : ~0.02 $ pour indexer 100 pages, négligeable.
- **Pertinence** : si tes PDF sont mal scannés ou mal structurés (colonnes, tableaux exotiques), l'extraction texte peut être pourrie — vérifie l'aperçu après upload.

### 8.5. Quand ne PAS utiliser le RAG

- Si l'info change toutes les minutes (stock, prix dynamique) → utilise plutôt un **tool n8n** qui requête ton système en live
- Si l'info est triviale (3 ligne d'horaires) → mets-la directement dans le system prompt
- Si la base fait < 5 documents → le RAG ajoute de la latence pour rien

---

## 9. Tools n8n — Donner des super-pouvoirs à l'agent

### 9.1. Pourquoi n8n ?

Un agent IA qui ne sait que parler, c'est limité. Pour qu'il **fasse vraiment des actions** (créer un RDV dans Google Calendar, envoyer un SMS, écrire dans Salesforce, débloquer un compte…), il lui faut des **outils**.

Axon utilise **n8n** comme couche d'orchestration : tu crées un workflow n8n (avec ses 400+ intégrations natives), tu le binds à ton agent, et l'agent peut l'appeler comme un function call LLM.

### 9.2. Anatomie d'un binding

Dans la colonne `agents.n8n_bindings` (jsonb), on a une liste :

```json
[
  {
    "name": "book_appointment",
    "description": "Réserve un créneau dans Google Calendar. Paramètres: date (ISO), duration_min, customer_name, customer_phone.",
    "webhook_url": "https://n8n.example.com/webhook/abc123",
    "schema": {
      "date": "string",
      "duration_min": "number",
      "customer_name": "string",
      "customer_phone": "string"
    }
  },
  {
    "name": "send_sms_confirmation",
    "description": "Envoie un SMS de confirmation au client après une réservation.",
    "webhook_url": "https://n8n.example.com/webhook/def456",
    "schema": {
      "to": "string",
      "message": "string"
    }
  }
]
```

Le champ `description` est **critique** : c'est ce que le LLM voit pour décider quand appeler l'outil. Sois pédagogique et précis.

### 9.3. Le flux d'exécution

```
Le LLM décide : "Je dois appeler book_appointment"
    ↓
Notre agent worker fait POST sur le webhook n8n
   { date, duration_min, customer_name, customer_phone }
    ↓
n8n exécute le workflow (Google Calendar API, etc.)
    ↓
n8n retourne 200 OK avec un body JSON (ex: { success: true, event_id: "..." })
    ↓
L'agent worker injecte ce résultat dans le contexte LLM :
   "Le tool book_appointment a retourné : { success: true, event_id: 'evt_42' }"
    ↓
Le LLM formule une réponse au client :
   "C'est noté, votre rendez-vous est confirmé pour mardi à 14h."
```

### 9.4. Binder un workflow depuis l'UI

1. Va sur `/workflows`
2. Si pas encore fait : connecte ton instance n8n (URL + API key)
3. Liste des workflows disponibles → bouton **Binder à un agent**
4. Choisis l'agent, donne un nom court (qui devient le nom du tool), écris la description et le schema
5. Save — l'agent voit immédiatement le nouveau tool

### 9.5. Comment l'agent décide quand l'utiliser

C'est le LLM, en lisant la `description` et le contexte de la conversation, qui décide. Tu peux **guider** dans le system prompt :

> Quand le client confirme une réservation, tu appelles `book_appointment` puis
> tu appelles `send_sms_confirmation` avec un message court et chaleureux.

Bonne pratique : **toujours vérifier** que le LLM a bien les infos requises avant d'appeler le tool. Si le client n'a pas donné son téléphone, l'agent doit le demander avant, pas hallucinier un numéro.

---

## 10. Coûts estimés par minute d'appel

Soyons concrets. Un appel inbound de 3 minutes en France métropolitaine, géré 100% en IA avec gpt-4o-mini et MiniMax :

### 10.1. Détail par fournisseur (par minute)

| Poste | Coût / min | Note |
|---|---|---|
| Twilio (PSTN voix entrant FR) | ~0.013 € | Numéro français géographique |
| Twilio (PSTN voix sortant FR) | ~0.07 € | Pour les campagnes outbound |
| LiveKit Cloud (audio bridge) | ~0.005 € | Plan standard, ~3 minutes incluses gratuites/jour |
| Deepgram STT (Nova-3) | ~0.004 € | $0.0043 / min |
| MiniMax TTS speech-02-hd | ~0.010 € | ~1500 caractères/min de parole IA |
| OpenAI LLM (gpt-4o-mini) | ~0.005–0.015 € | Selon longueur historique |
| Supabase Storage + Postgres | <0.001 € | Stockage négligeable |
| Vercel / Fly.io (compute) | <0.001 € | Mutualisé |

### 10.2. Totaux par scénario

| Scénario | Coût / minute | Coût pour un appel de 3 min |
|---|---|---|
| **Inbound 100% IA (gpt-4o-mini)** | ~0.035 € | ~0.10 € |
| **Inbound 100% IA (claude-3-5-sonnet)** | ~0.050 € | ~0.15 € |
| **Outbound 100% IA (gpt-4o-mini)** | ~0.09 € | ~0.27 € |
| **Inbound mixte IA → humain (50/50)** | ~0.04 € | ~0.12 € + temps humain |

Comparé à un centre d'appel humain classique (15–30 €/h soit ~0.25–0.50 €/min), **un appel IA coûte 5 à 15 fois moins cher**, sans compter les avantages opérationnels (24/7, pas d'attente, pas de turnover).

### 10.3. Le poste qui coûte vraiment

Pour un appel inbound IA, **Twilio est le 1er poste** (~30–40% du coût). Si tu fais beaucoup de volume :

- Négocier un tarif Twilio dégressif
- Ou passer sur un trunk SIP direct (Voxbone, Twilio Elastic SIP, …) qui coupe le PSTN classique

### 10.4. Comment piloter ses coûts dans Axon

- `/analytics` te donne le **coût estimé par appel** (provider × durée) si les variables d'env de pricing sont renseignées
- Les Super Admins peuvent voir le coût agrégé par org dans `/admin/billing`
- Pour optimiser : surveiller la **durée moyenne** (un agent verbeux coûte plus cher), et tester des LLM moins chers sur les agents simples

---

## 11. Best practices pour écrire un prompt système

Un bon system prompt fait souvent **la différence** entre un agent qui paraît robotique et un agent qui paraît humain. Voici nos règles éprouvées.

### 11.1. Structure recommandée

```
# Identité
Tu es <prénom>, <fonction> de <organisation>.

# Mission
<1-2 phrases sur ce que tu fais et pour qui>

# Ton
<adjectifs courts : chaleureux, professionnel, direct>
<règle de tutoiement ou vouvoiement>
<longueur des phrases ("phrases courtes")>

# Workflow
1. <étape 1>
2. <étape 2>
3. <étape 3>
...

# Règles strictes
- Tu ne fais jamais X
- Tu refuses Y
- Si Z, tu fais W

# Phrases types
- Pour saluer : "Bonjour, ici Sophie, comment puis-je vous aider ?"
- Pour confirmer : "C'est bien noté."
- Pour transférer : "Je vous passe un instant <prénom> qui pourra vous aider."

# Conditions de transfert humain
- Si le client demande explicitement un humain
- Si le client devient agressif (cris, insultes)
- Si la demande sort de ton périmètre

→ appelle transfer_to_specialist("manager")
```

### 11.2. Les pièges classiques

- **Prompt trop long** : au-delà de 3000 caractères, le LLM ralentit, oublie des règles, et coûte plus cher. Si ton prompt fait 4000 caractères, c'est sûrement que tu y mets de la donnée — déplace-la dans le RAG.
- **Règles contradictoires** : "tu refuses toute demande hors-sujet" + "tu réponds aux questions sur la météo" → le LLM hésite. Sois cohérent.
- **Phrases longues** : "Tu dois en toutes circonstances veiller à ce que la conversation se déroule dans les meilleures conditions possibles..." → le LLM imite. Le client entendra des phrases tout aussi longues. Écris court, ton agent parlera court.
- **Pas d'exemples** : un LLM apprend mieux par mimétisme. Donne 2-3 phrases-types qu'il doit imiter.
- **Pas de conditions de sortie** : si tu n'écris pas quand transférer à un humain, l'agent essaiera de tout gérer, même les insultes — mauvaise expérience client.

### 11.3. Itérer rapidement

Le bon workflow :

1. Écris une v1 du prompt (15 minutes)
2. Va sur `/agents/[id]` → onglet **Test chat** → teste en texte (gratuit, instantané)
3. Identifie 3 cas qui ratent → corrige le prompt
4. Quand le chat est solide, passe à l'onglet **Test session** (vrai pipeline voix dans le navigateur)
5. Identifie ce qui ne marche pas en audio (latence, intonation, coupures)
6. Quand c'est bon : route un numéro de test vers cet agent
7. Fais 5 appels réels avec des collègues qui ne connaissent pas le prompt
8. Itère encore

Compter **2-4 heures** pour atteindre un bon niveau sur un nouveau persona, puis quelques itérations pendant les premières semaines en prod.

---

## 12. Tester un agent avant de le mettre en prod

### 12.1. Test chat (texte uniquement)

`/agents/[id]` → onglet **Test chat**

- Tu écris des messages, l'agent répond en texte
- Pas de STT/TTS, donc latence ~500 ms et **coût ~0**
- Idéal pour itérer le prompt rapidement
- Limite : tu ne valides pas la voix, l'intonation, ni les coupures de parole

### 12.2. Test session (pipeline voix complet)

`/agents/[id]` → onglet **Test session**

- Ton navigateur joue le rôle du téléphone
- Le vrai pipeline LiveKit + Deepgram + LLM + MiniMax tourne
- Tu valides la voix, l'émotion, la latence
- Coûts réels (Deepgram + LLM + MiniMax) mais sans Twilio (donc ~0.02 €/min)

### 12.3. Test sur ligne réelle

Une fois validé :

1. `/numbers` → choisis un numéro de test (idéalement pas en prod)
2. Route-le vers ton agent (`Inbound mode = AI agent`, `agent = <ton agent>`)
3. Appelle depuis ton mobile
4. **Écoute en différé** : `/calls` → le call → enregistrement + transcription + analyses

### 12.4. Checklist avant la mise en prod

- [ ] L'agent salue correctement (test 5 fois — il varie un peu chaque fois)
- [ ] L'agent comprend les accents/intonations variés (teste avec 3 collègues différents)
- [ ] L'agent gère les silences (tu ne dis rien pendant 5 s)
- [ ] L'agent gère les interruptions (tu lui coupes la parole)
- [ ] L'agent refuse poliment les demandes hors-sujet
- [ ] L'agent appelle les tools quand il faut (vérifie dans les logs n8n)
- [ ] L'agent transfère au manager dans les bons cas
- [ ] La voix est cohérente (pas de saturation, pas de bug de prononciation sur les noms de marque)

---

## 13. Monitoring en live

Une fois l'agent en prod, voici les pages qui te disent **ce qui se passe maintenant**.

### 13.1. `/calls` — Tous les appels

- Filtres par statut (`in_progress`, `completed`, `failed`, `voicemail`)
- Filtres par direction (`inbound`, `outbound`), agent, numéro, date
- Pour chaque appel : durée, sentiment, intent, satisfaction, transcript, enregistrement
- Pour les appels en cours : indication temps réel + lien vers l'écoute live (supervisor)

### 13.2. `/alerts` — Les signaux faibles

Les alertes sont générées **automatiquement** par les analyses LLM qui tournent sur chaque appel terminé. Exemples :

- Sentiment très négatif détecté sur les 30 dernières secondes
- Mot-clé concurrent prononcé (`"chez votre concurrent X..."`)
- Intent de résiliation détecté
- Plainte / litige
- Agent IA n'a pas su répondre (`"je ne sais pas"` détecté plusieurs fois)

Tu peux **définir tes propres règles d'alerte** dans `/analyses`.

### 13.3. `/analyses` — Configurer les analyses LLM

C'est ici que tu décides **ce qu'Axon analyse** automatiquement sur chaque appel.

- Analyses pré-installées : sentiment, intent, satisfaction, langue
- Tu peux en créer : "détecter intention d'achat", "détecter mention concurrent", "extraire montant mentionné"
- Pour chacune : nom, prompt (texte qui décrit ce que tu cherches), action si match (générer alerte, taguer l'appel)

Chaque analyse a un coût : 1 appel LLM par appel terminé × N analyses = ~0.5 cent par appel pour 5 analyses. Ne pas en mettre 20 si tu n'en exploites que 3.

### 13.4. `/analytics` — Les KPIs

- Volume d'appels (jour / semaine / mois)
- Durée moyenne par agent
- Taux de complétion (combien d'appels finissent normalement vs hangup)
- Taux de transfert vers humain
- Satisfaction moyenne (via l'analyse LLM)
- Coût estimé par appel
- Export CSV

C'est l'outil pour **mesurer l'impact**. Compare avant/après chaque modification de prompt.

---

## 14. Mode Manager IA — Le copilote Super Admin

`/admin/copilot` ouvre un chat où tu **parles à un LLM** qui peut piloter Axon pour toi.

### 14.1. Ce que le copilote peut faire

- Lire la doc et te l'expliquer
- Requêter la base : "combien d'agents actifs ?", "quelle campagne marche le mieux ce mois ?"
- Créer un agent : "crée un agent SAV en français avec une voix joyeuse"
- Modifier un agent : "passe l'agent X en gpt-4o"
- Lancer une analyse one-shot : "résume-moi les 10 derniers appels de l'agent Sophie"
- Configurer des automations n8n
- Lancer des migrations Supabase (pour les Super Admins uniquement)

### 14.2. Comment ça marche

Le copilote est un agent IA qui :

- Tourne sur **Claude 3.5 Sonnet** (besoin d'un LLM intelligent pour piloter du SQL et des appels API)
- A accès à des **tools** internes (lire/écrire Supabase, appeler n8n, lire les logs)
- Vérifie ton rôle (`super_admin`) avant chaque action
- **Confirme** explicitement chaque action `write` (création, modif, suppression) avant de l'exécuter

### 14.3. Exemples de prompts utiles

> Crée un agent de SAV en français qui parle de manière professionnelle, qui utilise gpt-4o-mini, voix neutre, et qui transfère au manager si le client est en colère.

> Liste les 5 campagnes les moins performantes ce mois (taux de réponse < 20%) et propose-moi des hypothèses.

> Passe tous les agents inactifs depuis 30 jours en statut "archived".

> Montre-moi le coût total par jour sur les 14 derniers jours.

### 14.4. Sécurité

- Lecture : libre (mais respecte la séparation multi-tenant)
- Écriture : confirme + journalise dans `audit_log`
- Suppression : double confirmation
- Actions destructives jamais accessibles sans le rôle `super_admin`

---

## 15. FAQ

### Pourquoi mon agent répond en anglais alors que je veux du français ?

3 causes possibles, du plus fréquent au plus rare :

1. **`language` est mal réglé** sur l'agent (vérifie `fr` ou `multi`)
2. **Le system prompt est en anglais** — le LLM imite la langue du prompt. Réécris-le en français.
3. **Le LLM choisi est mauvais en français** (rare avec GPT-4o/Claude/MiniMax, mais ça arrive sur certains modèles open-source). Bascule sur `gpt-4o-mini` ou `claude-3-5-sonnet`.

### L'agent décroche puis raccroche immédiatement

Causes typiques :

- **`voice_id` invalide** (voix MiniMax supprimée ou pas encore prête) → le worker plante au premier "speak"
- **`OPENAI_API_KEY` périmé / quota dépassé** → le LLM ne répond pas
- **`MINIMAX_API_KEY` invalide** → le TTS ne peut pas synthétiser
- **Erreur dans le system prompt** (très rare, mais un caractère invisible peut casser l'appel API)

Pour diagnostiquer : Super Admin → `/admin/logs` → filtre par CallSid → tu vois la stack trace.

### Le transfert ne se fait pas

- Vérifie que les **deux** agents (lead + specialist) ont le **même** `team_id`
- Vérifie que le specialist a la bonne `specialty` (celle utilisée dans `transfer_to_specialist(...)`)
- Vérifie que le specialist est `status = active`
- Vérifie dans le transcript que le LLM a bien essayé d'appeler le tool — sinon c'est ton system prompt qu'il faut renforcer

### Les analyses LLM ne tournent pas

- `/analyses` → assure-toi qu'**au moins une analysis_policy est `enabled = true`**
- Les analyses tournent **après** la fin de l'appel et l'arrivée du recording webhook (peut prendre 30 s à 2 min)
- Vérifie que `OPENAI_API_KEY` (ou autre provider d'analyse) est bien configurée

### Combien d'appels simultanés je peux gérer ?

Limites par défaut :

- **Twilio** : selon ton plan (Trial: 1, Pay-as-you-go: 250 channels, Enterprise: illimité)
- **LiveKit** : ~500 rooms simultanées sur le plan standard
- **Notre agent worker** : ~50 appels par instance Fly.io (CPU lié). Auto-scale possible.
- **Deepgram / MiniMax / OpenAI** : pas de limite hard pour des volumes normaux ; rate-limits par minute à surveiller au-delà de ~1000 appels concurrents

En pratique, **~250 appels simultanés** sans config spéciale.

### Pourquoi mon agent IA dit "comme un grand modèle de langage…" ?

Le LLM laisse échapper sa nature. Ça vient toujours du system prompt :

- Tu as oublié de définir clairement son identité ("Tu es Sophie, …")
- Le client a posé une question piège ("es-tu une IA ?") et le prompt ne dit pas comment répondre

Ajoute une règle :
> Si on te demande si tu es une IA, tu réponds simplement "Je suis l'assistante virtuelle de <marque>, je suis là pour vous aider." sans rentrer dans le détail technique.

### Mon agent coupe la parole au client / le client doit attendre 3 secondes

- **Coupe la parole** : remonter le délai d'endpointing Deepgram (`endpointing_ms`)
- **Attend trop** : baisser le délai d'endpointing OU choisir un LLM plus rapide (gpt-4o-mini ou claude-3-5-haiku)
- Cocher l'option **"barge-in"** si tu veux que le client puisse couper l'agent en parlant par-dessus

### Comment savoir combien je dépense ?

`/analytics` → onglet **Coûts** (Admin et au-dessus). Pour le détail technique par provider, contacte ton Super Admin qui voit `/admin/billing`.

### Mes documents RAG ne sont pas pris en compte

- Vérifie que `rag_enabled = true` sur l'agent
- Vérifie que les documents sont en statut **Indexed** (pas Pending)
- Vérifie que **ton system prompt mentionne explicitement le tool `search_knowledge_base`** — sinon le LLM ne le cherche pas
- Re-teste avec un message qui mentionne clairement le contenu du doc (ex. "vous avez du vin sans alcool ?" si le doc est le menu)

---

## 16. Ressources

### Dans la doc

- [USER_GUIDE.md](USER_GUIDE.md) — Le guide de l'interface (page par page, par rôle)
- [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) — Architecture technique détaillée
- [TELEPHONY.md](TELEPHONY.md) — Détail du routage Twilio / LiveKit
- [CONNECTORS.md](CONNECTORS.md) — Intégrations (CRM, SMS, calendrier)
- [COPILOT.md](COPILOT.md) — Documentation du copilote Super Admin
- [END_TO_END_TEST.md](END_TO_END_TEST.md) — Procédure de test complète

### Doc externe des providers

- [LiveKit Agents](https://docs.livekit.io/agents/) — Le SDK qui orchestre le pipeline voix
- [Deepgram Nova-3](https://developers.deepgram.com/docs/nova-3) — STT
- [MiniMax T2A](https://www.minimax.io/platform_overview) — TTS + voice cloning
- [Twilio Voice](https://www.twilio.com/docs/voice) — Téléphonie
- [OpenAI Platform](https://platform.openai.com/docs) — GPT
- [Anthropic Docs](https://docs.anthropic.com/) — Claude

### Repo

- [stefbach/minimax-for-occ](https://github.com/stefbach/minimax-for-occ) — Code source (privé)
- Branche `main` = production. PR + review obligatoires avant merge.

---

*Document maintenu par l'équipe Axon. Dernière révision : voir le commit log du fichier.*

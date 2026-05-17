# Test bout-en-bout — du clonage de voix à l'appel téléphonique

Ce guide vous fait passer en ~30 min d'une plateforme vierge à un appel
téléphonique réel répondu par un agent vocal IA avec votre voix clonée,
capable de déclencher un workflow n8n et de transférer à un humain.

> Pré-requis : vous êtes loggé sur `https://minimax-for-occ.vercel.app` avec
> un compte de rôle `admin` ou `manager`. Si non, voir [§ 0](#0-prérequis).

---

## 0. Prérequis

### Comptes & clés

| Service | À quoi ça sert | Où récupérer la clé |
|---|---|---|
| **Supabase** | DB, auth, storage, RAG | dashboard → Settings → API |
| **LiveKit Cloud** | WebRTC + agents IA | cloud.livekit.io → Settings → Keys |
| **OpenAI** | LLM + embeddings | platform.openai.com → API keys |
| **MiniMax** | TTS + clonage voix | platform.minimax.io → User Center |
| **Deepgram** | STT multilingue | console.deepgram.com |
| **n8n** | workflows tools des agents | votre instance → Settings → API |
| **Twilio** | numéros téléphone + PSTN | console.twilio.com → Account → API |

### Env vars Vercel

Settings → Environment Variables (Production + Preview + Development) :

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...

NEXT_PUBLIC_LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

OPENAI_API_KEY=sk-...
MINIMAX_API_KEY=...
DEEPGRAM_API_KEY=...

N8N_BASE_URL=https://n8n.example.cloud
N8N_API_KEY=...

TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
APP_URL=https://minimax-for-occ.vercel.app
```

Après chaque modification d'env var → **Redeploy sans cache**.

### Migrations Supabase

Si pas déjà fait, exécuter dans **SQL Editor** dans l'ordre :
```
0001_axon_init.sql
0002_voices.sql
0003_agent_tts_model.sql
0004_voices_cleanup.sql
0005_grant_public_roles.sql
0006_v2_multitenant.sql
0007_v2_flows_campaigns.sql
0008_v2_consolidated_simple.sql    ← idempotent, ré-applicable
0009_roles.sql
0010_invitations.sql
```

### Worker Python LiveKit Agents

Déployé une fois via Codespace :
```
cd /workspaces/minimax-for-occ
git pull origin main
cd agent
lk agent deploy
```

Secrets côté LiveKit Cloud Agents (Cloud → Agents → CA_xxx → Secrets) :
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
OPENAI_API_KEY, MINIMAX_API_KEY, DEEPGRAM_API_KEY,
N8N_BASE_URL, N8N_API_KEY
```

### Worker dialer Node (optionnel — uniquement si campagnes outbound)

```bash
cd dialer
flyctl launch        # ou Railway équivalent
```

Secrets Fly.io / Railway :
```
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
REDIS_URL=redis://default:<password>@<host>:<port>,
APP_URL=https://minimax-for-occ.vercel.app
```

---

## 1. Cloner votre voix (3 min)

1. **`/voices`** → bouton **Tester la connexion** (diagnostic MiniMax) → doit afficher 4 ✓ verts.
2. Préparer un échantillon audio :
   - format `.mp3` / `.wav` / `.m4a`
   - durée **10 sec à 5 min**
   - **mono** si possible, sans musique, un seul speaker, voix claire
   - poids ≤ 20 MB
3. Formulaire **Cloner une nouvelle voix** :
   - **Fichier** : votre échantillon
   - **voice_id** : `ma_voix_demo` (8 chars min, `[A-Za-z][A-Za-z0-9_]+`)
   - **Nom affiché** : `Ma voix démo`
   - **Langue** : `multi` ou `fr`
4. Cliquez **Cloner cette voix**.
5. Une fois la ligne apparue dans **Mes voix clonées** → bouton **▶ Tester** → vous devez vous entendre prononcer la phrase d'écoute.

**Si erreur** :
- `2042 audio invalide` → format ou durée hors limites
- `2055 pas de voix` → silence en début / fin → re-trim
- `1008 insufficient balance` → wallet MiniMax à recharger

---

## 2. Créer un agent IA avec cette voix (2 min)

1. **`/agents/new`**
2. **Identité** : nom = `Conciergerie Demo`, langue = `multi`, description = `Reçoit les appels et oriente`
3. **Cerveau (LLM)** : provider = `openai`, modèle = `gpt-4o`
4. **Prompt système** :
   ```
   Tu es la conciergerie de l'Hôtel Belvédère. Tu réponds avec courtoisie,
   en français ou en anglais selon la langue de l'invité.
   Tu peux :
   - prendre les demandes de room service,
   - réserver une table au restaurant,
   - donner les horaires de la piscine (7h-22h) et du spa (10h-20h),
   - transférer à la réception pour tout autre sujet.
   Réponses courtes, conversationnelles, pas de markdown.
   ```
5. **Voix (MiniMax TTS)** :
   - **Voix** : `ma_voix_demo` (dropdown)
   - **Modèle TTS** : `speech-02-hd (HD multilingue, recommandé)`
   - **Salutation** : `Bonjour, conciergerie de l'Hôtel Belvédère, comment puis-je vous aider ?`
6. **RAG** : désactivé pour ce test (on l'ajoute en § 6)
7. **Créer l'agent** → vous arrivez sur sa page.
8. Bouton **▶ Écouter cette voix** dans la fiche → vérifie la chaîne TTS complète.

---

## 3. Tester l'agent en mode voix web (5 min)

Toujours sur la page de l'agent :

1. Onglet **Session vocale + chat**
2. Cliquez **Démarrer la session vocale**
3. Autorisez le micro dans le navigateur
4. Vous devez entendre **votre voix clonée** dire la salutation.
5. Parlez : *« Quels sont les horaires de la piscine ? »*
6. L'agent répond en utilisant votre voix.
7. *« Je voudrais réserver une table pour ce soir »* → il pose les questions de suivi.

**Si silence** : ouvrir le terminal Codespace + `lk agent logs --log-type=runtime`. Chercher l'erreur.

**Si crash 1008** : wallet MiniMax / OpenAI vide.

---

## 4. Brancher un workflow n8n à l'agent (5 min)

1. **`/workflows/new`** :
   - Template : **Prise de rendez-vous (skeleton)**
   - Slug : `reservation-restaurant`
   - ✓ Activer immédiatement → **Créer**
2. Retournez sur la page de l'agent → onglet **Workflows n8n**
3. **↻ Rafraîchir** → le workflow `[voice-agent] book-appointment reservation-restaurant` apparaît dans « disponibles »
4. Cliquez son chemin de webhook pour le **binder** à l'agent.
5. Rechargez la page → le workflow apparaît dans « workflows accessibles » avec statut activé.
6. Modifier le prompt système (champ Editer) pour ajouter :
   ```
   Quand un invité veut réserver une table, utilise l'outil
   trigger_n8n_workflow avec le webhook 'voice-agent/reservation-restaurant'
   et un payload {date, heure, couverts, nom}.
   ```
7. **Démarrer la session vocale** : *« Je voudrais réserver une table demain soir à 20h pour 4 personnes au nom de Dupont »*.
8. L'agent confirme, déclenche n8n, vous donne un confirmation_id.

Pour vérifier côté n8n : ouvrez votre instance → workflow `reservation-restaurant` → onglet Executions.

---

## 5. Construire un flow IVR visuel (10 min)

1. **`/flows`** → **+ Nouveau flow** → nom = `Entrée Hôtel Belvédère` → ouvre l'éditeur drag-drop.
2. **Glissez** depuis la palette à gauche :
   - 1 nœud **welcome** : `text = "Bienvenue à l'Hôtel Belvédère"`
   - 1 nœud **menu_dtmf** : prompt = `"Tapez 1 pour la conciergerie, 2 pour la réception"`, options = `[{key:'1', label:'Conciergerie'}, {key:'2', label:'Réception'}]`
   - 1 nœud **ai_agent** : `agent_handle_id = <Conciergerie Demo>`
   - 1 nœud **transfer** : `to_e164 = +33612345678` (votre mobile)
   - 1 nœud **hangup**
3. **Reliez** :
   - welcome → menu_dtmf (condition `always`)
   - menu_dtmf → ai_agent (condition `dtmf: 1`)
   - menu_dtmf → transfer (condition `dtmf: 2`)
   - ai_agent → hangup (condition `always`)
   - transfer → hangup (condition `always`)
4. Cliquez **Définir comme étape de départ** sur le nœud welcome.
5. **Enregistrer**.

---

## 6. (Optionnel) Donner une base de connaissances RAG à l'agent

1. Fiche agent → onglet **RAG / Documents**.
2. Ajoutez un texte avec votre FAQ :
   ```
   Source : faq-hotel.txt
   Contenu :
   Le check-in se fait à partir de 15h.
   Le petit-déjeuner est servi de 7h à 10h30 en semaine, jusqu'à 11h le week-end.
   La piscine est ouverte de 7h à 22h.
   Le spa est ouvert de 10h à 20h, réservation conseillée.
   Le wifi est gratuit, mot de passe : Belvedere2026.
   ```
3. Cliquez **Indexer** → les chunks sont embeddés via OpenAI et stockés dans pgvector.
4. Sur la fiche agent (form édition), activez **RAG** + top-K = 4.
5. Démarrez la session vocale : *« Quel est le mot de passe du wifi ? »*. L'agent répond en s'appuyant sur le RAG.

---

## 7. Acheter un numéro Twilio + attacher le flow (5 min)

1. **`/numbers`** → si bannière rouge "Twilio non configuré", ajoutez les env vars puis Redeploy.
2. Section **Rechercher** : pays = `FR`, type = `local`, area code = `01` (ou laisser vide), **Rechercher**.
3. Choisissez un numéro → **Purchase**.
4. Le numéro apparaît dans **Mes numéros**.
5. Dans la cellule **Flow** de la ligne, sélectionnez **Entrée Hôtel Belvédère**.
6. Vérifiez côté Twilio : Console → Phone Numbers → le numéro → onglet Configure → **Voice Webhook = `https://minimax-for-occ.vercel.app/api/twilio-voice`** (auto-configuré à l'achat).

---

## 8. Appel téléphonique réel (le moment de vérité)

1. Avec votre téléphone, **appelez le numéro Twilio acheté**.
2. Vous entendez : *« Bienvenue à l'Hôtel Belvédère. Tapez 1 pour la conciergerie, 2 pour la réception. »*
3. Tapez **1** sur votre clavier téléphone.
4. Vous êtes mis en relation avec votre agent IA (votre voix clonée). Parlez naturellement.
5. Demandez la réservation d'une table → n8n est déclenché → vous recevez la confirmation à l'oral.
6. Raccrochez.

### Vérifications post-appel

- **`/calls`** → l'appel doit apparaître dans l'historique récent (state `ended`, duration_secs > 0).
- **`/dashboard`** → KPI "Appels aujourd'hui" incrémenté de 1.
- **n8n** → l'execution est visible dans l'historique du workflow.

---

## 9. Test d'un appel sortant via campagne (10 min)

> Nécessite le worker `dialer/` déployé sur Fly.io / Railway.

1. **`/contacts`** → ajouter 2-3 contacts test avec leur vrai numéro (votre mobile, un collègue).
2. **`/campaigns/new`** :
   - Identité : `Rappel rendez-vous demain`
   - Agent : l'agent `Conciergerie Demo`
   - Numéro émetteur : le numéro acheté en § 7
   - Cibles : sélectionnez les contacts test
   - Planning : max_concurrency = 1, max_attempts = 2, fenêtre = `mer 9h-18h`
3. **Créer en brouillon** → vous arrivez sur la page détail.
4. Bouton **Démarrer** → la campagne passe en `running`.
5. Dans la minute qui suit (le scheduler dialer poll toutes les 30 s), votre téléphone sonne.
6. Décrochez → l'agent vous parle, déroule son script.
7. KPI cards de la campagne se mettent à jour : `dialing → answered → done`.

---

## 10. Supervision live d'un appel

1. Pendant qu'un appel est en cours (entrant ou sortant), **`/calls`** → la ligne apparaît avec un point pulsant.
2. Cliquez **Écouter** (mode listen) → vous entendez l'agent + l'invité en temps réel, sans qu'ils vous entendent.
3. Cliquez **Souffler** (whisper) → vous parlez à l'agent humain sans que l'invité entende (utile pour briefer).
4. Cliquez **Intervenir** (barge) → vous rejoignez la conversation à 3.

Tous ces événements sont auditables dans `/calls/[id]` → timeline + dans la table `call_events` Supabase.

---

## 11. Handoff AI → humain en cours d'appel

> Disponible après merge des PR de la vague handoff.

1. Pendant un appel répondu par l'agent IA, ouvrir `/calls/[id]`.
2. Section **Transfert / Handoff** → **Vers un agent humain**.
3. Dropdown liste les humains présents (status `available` dans `human_presence`).
4. Cliquez **Transférer** → l'agent IA dit "Je vous passe quelqu'un" puis se retire.
5. Le humain reçoit l'appel sur son softphone à `/desk` avec le **transcript** déjà à l'écran.

---

## 12. Analytics et rapports

1. **`/analytics`** → presets `7 jours` :
   - KPI : total / % réponse / AHT / taux abandon / transferts
   - Charts SVG : volume par heure, volume par jour, dispositions
   - Tableaux : performance par agent, files d'attente, campagnes
2. Filtres : période custom (date picker).
3. **Exporter en CSV** → calls OU campaign_targets sur la période.

---

## Dépannage rapide

| Symptôme | Diagnostic |
|---|---|
| `/numbers` bannière rouge | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` non définis |
| Voice Studio "voice_id not exist" | clone silencieusement échoué — relire l'erreur exacte |
| Appel entrant silencieux | worker LiveKit pas redéployé, ou flow.start_step_id non défini |
| `chat content is empty (2013)` | un step `ai_agent` pointe sur un agent qui n'a pas de prompt système |
| Dialer ne dial pas | worker Fly.io down, ou Redis pas joignable, ou campagne hors fenêtre horaire |
| Recording absent après appel | webhook Twilio recording status pas configuré sur le numéro |
| `/admin` 404 | rôle de l'utilisateur n'est pas admin / super_admin |
| Sidebar vide | session expirée, refresh + re-login |

## Logs utiles

- Front Vercel : Vercel dashboard → Deployments → ⋯ → View Function Logs
- Worker Python : Codespace → `lk agent logs --log-type=runtime`
- Worker dialer : Fly.io / Railway dashboard → Logs
- Supabase : Dashboard → Logs → API / Postgres / Realtime selon le canal
- Twilio : Console → Monitor → Debugger

---

## Cas d'usage rapides à montrer

| Démo | Durée | Setup |
|---|---|---|
| **Conciergerie hôtelière** | 5 min | flow welcome + ai_agent (FAQ horaires) + transfer humain (24/7 selon heure) |
| **Service client e-commerce** | 8 min | flow welcome + menu_dtmf (1 commande / 2 retour / 3 humain) + ai_agent par branche |
| **Standard cabinet médical** | 10 min | flow welcome + gather_speech (intent prise/annulation/info) + workflows n8n vers Google Calendar |
| **Pré-qualification lead** | 6 min | campagne outbound → ai_agent qui qualifie BANT → transfer humain si chaud |

---

## Pour aller plus loin

- Multi-flow : créer 1 flow par numéro / par horaire / par campagne
- Multi-agent IA : avoir plusieurs personas et orchestrer via flow steps
- RAG métier : importer un FAQ produit, le PDF d'un menu de restaurant, les CGV
- Workflows n8n avancés : Slack, Gmail, HubSpot, Calendar, Stripe, Notion
- Voix : cloner différentes voix par persona (commercial, support, conciergerie)
- Analytics : exporter CSV → Looker / Metabase pour reporting custom

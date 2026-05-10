# minimax-for-occ

Agent IA vocal **MiniMax + LiveKit + Vercel** — multilingue (FR/EN), avec chat texte hybride.

```
┌──────────────────────┐      WebRTC       ┌────────────────────────┐
│  Vercel (Next.js)    │  ◄─────────────►  │  LiveKit Cloud (SFU)   │
│  /api/token          │                   └───────────┬────────────┘
│  /api/chat (M2)      │                               │
│  UI voix + chat      │                               │ join as agent
└──────────────────────┘                   ┌───────────▼────────────┐
                                           │ Worker Python LiveKit  │
                                           │ STT  Deepgram nova-3   │
                                           │ LLM  MiniMax-M2        │
                                           │ TTS  MiniMax           │
                                           │ VAD  Silero · Turn-det │
                                           └────────────────────────┘
```

> ⚠️ Le worker Python **ne tourne pas sur Vercel** (pas de WebRTC long-vivant en serverless). Il est déployé sur **LiveKit Cloud Agents** (recommandé) ou tout host containers (Fly.io, Render, Railway).

## Structure

```
agent/   Worker Python LiveKit Agents (voix)
web/     Front-end Next.js déployé sur Vercel (UI + token + chat texte)
```

## 1. Pré-requis

| Service | Variable | Où l'obtenir |
|---|---|---|
| LiveKit Cloud | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | https://cloud.livekit.io |
| MiniMax | `MINIMAX_API_KEY` | https://platform.minimax.io |
| Deepgram | `DEEPGRAM_API_KEY` | https://console.deepgram.com |

## 2. Worker vocal (`agent/`)

```bash
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # remplissez les clés
python agent.py download-files   # cache Silero VAD + turn-detector
python agent.py dev              # mode dev local
```

### Déploiement LiveKit Cloud Agents

Trois chemins selon votre setup :

**① Localement (machine avec terminal)**
```bash
curl -sSL https://get.livekit.io/cli | bash       # installer le CLI
lk cloud auth                                      # auth navigateur
cd agent && lk agent create
```

**② GitHub Codespaces (zéro install, tout dans le navigateur)**

Sur https://github.com/stefbach/minimax-for-occ → bouton vert **Code → Codespaces → Create codespace on main**.
Le devcontainer (`.devcontainer/devcontainer.json`) installe automatiquement Python, Node, le CLI `lk`, et les deps. Au bout de ~1 min vous avez un terminal :
```bash
lk cloud auth
cd agent && lk agent create
```

**③ GitHub Actions auto-deploy (CI/CD)**

À chaque push sur `main` qui touche `agent/**`, un workflow GitHub Actions redéploie le worker. Le YAML est dans `docs/deploy-agent.workflow.yml` — copiez son contenu dans `.github/workflows/deploy-agent.yml` via l'UI GitHub :

1. Sur GitHub, cliquez **Add file → Create new file**
2. Nom : `.github/workflows/deploy-agent.yml`
3. Collez le contenu de `docs/deploy-agent.workflow.yml`
4. Commit

(Le déplacement est dû à une limitation de permission de l'agent qui n'a pas pu écrire directement dans `.github/workflows/`.)

Pré-requis one-shot : ajouter ces secrets dans **GitHub → repo → Settings → Secrets and variables → Actions** :

| Secret | Valeur |
|---|---|
| `LIVEKIT_PROJECT_TOKEN` | `lk cloud token create` une fois en local |
| `LIVEKIT_URL` | `wss://minimax-i107a5a3.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Dashboard LiveKit |
| `MINIMAX_API_KEY` | Dashboard MiniMax |
| `DEEPGRAM_API_KEY` | Console Deepgram |
| `N8N_BASE_URL` / `N8N_API_KEY` | n8n Settings → API |

## 3. Front-end (`web/`)

```bash
cd web
npm install
cp .env.example .env.local  # remplissez les clés
npm run dev
```

Ouvrez http://localhost:3000.

### Déploiement Vercel

> ⚠️ **Le projet Next.js est dans `web/`, pas à la racine.** Si vous obtenez un `404: NOT_FOUND` après déploiement, c'est que Vercel build à la racine.
>
> **Fix** : Vercel Dashboard → Project → **Settings → General → Root Directory → `web`** → Save → Redeploy.

```bash
cd web
vercel               # première fois : choisissez "web" comme root
vercel --prod
```

Variables d'environnement à définir côté Vercel :
- `NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `MINIMAX_API_KEY`
- `N8N_BASE_URL`, `N8N_API_KEY` (si vous utilisez les workflows depuis le chat)
- `LIVEKIT_SIP_URI` (si vous utilisez le webhook Twilio)
- `APP_SHARED_TOKEN` (optionnel, pour protéger `/api/token` côté API non-navigateur)
- `TOKEN_RATE_LIMIT_PER_MINUTE` (défaut 20)

## 4. Comment ça parle ensemble

1. L'utilisateur clique **Démarrer la session vocale** → le front appelle `/api/token` qui mint un JWT LiveKit.
2. Le front rejoint la room WebRTC.
3. Le worker (LiveKit Cloud Agents) reçoit le job de dispatch et rejoint la même room.
4. Boucle audio : micro → Deepgram STT → MiniMax-M2 LLM → MiniMax TTS → haut-parleur.
5. En parallèle, le panneau chat utilise `/api/chat` (Vercel AI SDK + `vercel-minimax-ai-provider`) pour MiniMax-M2 en streaming texte.

## 5. Voice cloning MiniMax

Cloner une voix à partir d'un échantillon audio (10 s – 5 min, mono, sans musique) :

```bash
cd agent
source .venv/bin/activate
python clone_voice.py path/to/sample.wav my_custom_voice
# -> renvoie un voice_id à mettre dans MINIMAX_VOICE_ID
```

L'agent utilisera automatiquement ce `voice_id` au prochain démarrage.
Doc officielle : https://platform.minimax.io/docs/api-reference/voice-clone

## 6. Téléphonie (Twilio → LiveKit SIP → agent MiniMax)

L'agent fonctionne **tel quel** pour les appels téléphoniques. LiveKit gère le SIP nativement, et le worker rejoint automatiquement la room SIP créée par chaque appel entrant.

### Étapes

1. **Twilio** : créez un SIP trunk Elastic et configurez l'origination URI vers votre projet LiveKit (`sip:<project>.sip.livekit.cloud`).
2. **LiveKit** : déclarez le trunk inbound + une dispatch rule qui crée une room par appel et y dispatche l'agent `minimax-voice-agent`.
   ```bash
   lk sip inbound-trunk create inbound-trunk.json
   lk sip dispatch-rule create dispatch-rule.json
   ```
   Exemple `dispatch-rule.json` :
   ```json
   {
     "name": "twilio-to-minimax",
     "trunk_ids": ["<inbound-trunk-id>"],
     "rule": { "dispatchRuleIndividual": { "roomPrefix": "tel-" } },
     "roomConfig": {
       "agents": [{ "agentName": "minimax-voice-agent" }]
     }
   }
   ```
3. **Webhook Twilio** (optionnel) : pointer le webhook *Voice* du numéro vers une route Next.js (`web/app/api/twilio-voice/route.ts`) qui retourne un TwiML `<Dial><Sip>` vers le trunk LiveKit, si vous voulez préfixer la logique (auth, routage, IVR).

Doc officielle SIP : https://docs.livekit.io/sip/

## 7. n8n — orchestration de workflows

L'agent peut **déclencher des workflows n8n** comme tools pendant la conversation
(prise de RDV, création de ticket, envoi d'email, requêtes CRM…).

### Configuration

Dans `agent/.env` (et `web/.env.local` si vous voulez aussi déclencher depuis le front) :

```
N8N_BASE_URL=https://votre-n8n.example.cloud
N8N_API_KEY=<JWT depuis Settings -> API dans n8n>
N8N_WEBHOOK_BASE_URL=          # optionnel, défaut ${N8N_BASE_URL}/webhook
```

Si `N8N_BASE_URL` et `N8N_API_KEY` sont définis, l'agent ajoute automatiquement
trois tools au LLM MiniMax-M2 :

| Tool | Effet |
|---|---|
| `list_n8n_workflows()` | Liste les workflows actifs avec leur nom, tags et chemins de webhook détectés |
| `trigger_n8n_workflow(webhook_path, payload_json)` | POST vers `${WEBHOOK_BASE}/{path}` |
| `get_n8n_execution(execution_id)` | Récupère le résultat d'une exécution |

### Côté front-end

Route Next.js `web/app/api/n8n/trigger/route.ts` :
- `GET /api/n8n/trigger` → liste les workflows actifs
- `POST /api/n8n/trigger` body `{ webhook_path, payload }` → déclenche

### Pattern recommandé

1. Dans n8n, chaque workflow exposé à l'agent commence par un nœud **Webhook** (méthode POST, response mode "When last node finishes" si vous voulez la réponse en synchrone).
2. Donnez au workflow un **nom explicite** et des **tags** : ils servent de description pour le LLM.
3. L'agent appellera `list_n8n_workflows` au démarrage si l'utilisateur demande "que peux-tu faire ?", puis choisira le bon webhook.

### Construire les workflows depuis Claude Code (n8n-mcp)

[`n8n-mcp`](https://github.com/czlonkowski/n8n-mcp) est un serveur MCP qui donne
à un assistant LLM la connaissance complète des 1 650+ nœuds n8n et 20 outils
de gestion (search/get/validate/create/update/delete/test workflow, etc.).

Le projet inclut déjà `.mcp.json` à la racine. Pour l'activer dans Claude Code :

```bash
export N8N_BASE_URL=https://votre-n8n.example.cloud
export N8N_API_KEY=...      # JWT de Settings -> API
claude                       # ou: claude mcp list  pour vérifier
# Acceptez l'autorisation MCP au premier lancement.
```

À partir de là, vous pouvez demander en langage naturel :
> "Crée-moi un workflow n8n qui reçoit `{date, customer}` sur un webhook
> `book-appointment`, vérifie la dispo dans Google Calendar, crée l'événement
> et renvoie l'ID de confirmation."

Claude utilisera `n8n-mcp` pour valider chaque nœud et `create_workflow` pour
le déployer directement sur votre instance — puis l'agent vocal le découvrira
via `list_n8n_workflows`.

> Note runtime : LiveKit Agents 1.5 supporte aussi les serveurs MCP côté agent
> vocal (param `mcp_servers` sur `AgentSession`). On peut donc, en option,
> exposer `n8n-mcp` directement au LLM MiniMax pendant les appels — utile pour
> du self-service avancé, à éviter par défaut car ça ajoute beaucoup de tools
> et augmente la latence vocale.

## 8. Personnalisation

- **Voix / émotion / vitesse MiniMax** : variables `MINIMAX_VOICE_ID`, `MINIMAX_TTS_MODEL`, `MINIMAX_TTS_EMOTION` ou éditez `minimax.TTS(...)` dans `agent/agent.py` (`speed`, `english_normalization`).
- **Prompt système vocal** : `INSTRUCTIONS` dans `agent/agent.py`.
- **Prompt système chat** : `SYSTEM_PROMPT` dans `web/app/api/chat/route.ts`.
- **Langue STT** : Deepgram `nova-3` est en mode `multi`. Pour forcer FR : `language="fr"`.

## Sources

- LiveKit MiniMax TTS : https://docs.livekit.io/agents/models/tts/minimax/
- vercel-minimax-ai-provider : https://github.com/MiniMax-AI/vercel-minimax-ai-provider
- MiniMax Platform : https://platform.minimax.io

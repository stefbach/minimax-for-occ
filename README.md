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

```bash
# Installer le CLI LiveKit (https://docs.livekit.io/home/cli/cli-setup/)
lk cloud auth
cd agent
# Éditez livekit.toml (subdomain de votre projet)
lk agent create
```

## 3. Front-end (`web/`)

```bash
cd web
npm install
cp .env.example .env.local  # remplissez les clés
npm run dev
```

Ouvrez http://localhost:3000.

### Déploiement Vercel

```bash
cd web
vercel
```

Définissez côté Vercel les variables d'environnement :
`NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `MINIMAX_API_KEY`.

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

## 7. Personnalisation

- **Voix / émotion / vitesse MiniMax** : variables `MINIMAX_VOICE_ID`, `MINIMAX_TTS_MODEL`, `MINIMAX_TTS_EMOTION` ou éditez `minimax.TTS(...)` dans `agent/agent.py` (`speed`, `english_normalization`).
- **Prompt système vocal** : `INSTRUCTIONS` dans `agent/agent.py`.
- **Prompt système chat** : `SYSTEM_PROMPT` dans `web/app/api/chat/route.ts`.
- **Langue STT** : Deepgram `nova-3` est en mode `multi`. Pour forcer FR : `language="fr"`.

## Sources

- LiveKit MiniMax TTS : https://docs.livekit.io/agents/models/tts/minimax/
- vercel-minimax-ai-provider : https://github.com/MiniMax-AI/vercel-minimax-ai-provider
- MiniMax Platform : https://platform.minimax.io

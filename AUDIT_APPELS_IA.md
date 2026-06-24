# Audit technique — Problèmes d'appels IA (plateforme AXON / OCC)

> Date : 2026-06-18 · Périmètre : pipeline d'appels sortants (latence, silence, voix robotique, instabilité)
> Méthode : lecture du code de production (`agent/`, `dialer/`, configs SIP, docs voix) + documentation officielle des providers.

---

## 0. AVERTISSEMENT PRÉLIMINAIRE — la prémisse de la mission est fausse

La mission décrit une stack **Retell AI** (agents Retell, paramètres `response_delay`,
`reminder_trigger_ms`, `interruption_sensitivity`…). **Ce n'est pas ce qui tourne en production.**

Le code réel (`agent/agent.py`, 3 971 lignes) est un **worker LiveKit Agents auto-hébergé**.
Retell n'apparaît nulle part dans le pipeline d'appel — seulement une mention conceptuelle
« Retell-style » dans `docs/ARCHITECTURE_V2.md`. Le dépôt s'appelle d'ailleurs `minimax-for-occ` :
c'est une **migration de Retell vers une stack maison** assemblée pour réduire les coûts.

La stack réellement en service :

| Couche | Ce que la mission croit | **Ce qui tourne réellement** |
|---|---|---|
| Orchestration média | Retell (pipeline managé) | **LiveKit Cloud Agents** (worker Python custom) |
| LLM | OpenAI / Claude | **DeepSeek `deepseek-v4-flash`** (défaut, endpoint `api.deepseek.com` = Chine) |
| TTS | ElevenLabs / Cartesia / Minimax | **MiniMax `speech-02-turbo`** (défaut, `api.minimax.io` = Chine), Cartesia/ElevenLabs en option |
| STT | — | AssemblyAI `u3-rt-pro` / Deepgram |
| SIP/Trunk | Twilio Elastic SIP | Twilio → **trunk SIP LiveKit** (et non Retell) |
| Worker | — | Déployé **Fly.io région CDG (Paris)** d'après les commentaires |

**Conséquence directe : la majorité des « paramètres Retell » demandés dans la mission
n'existent pas dans cette stack.** Le vrai problème se diagnostique sur le code LiveKit,
ce que fait ce rapport.

---

## 1. RÉSUMÉ EXÉCUTIF

La cause racine n'est pas un réglage mal positionné : c'est un **choix architectural structurel**.
La plateforme fait transiter, **à chaque tour de parole**, le LLM (DeepSeek) et le TTS (MiniMax)
par des endpoints **hébergés en Chine** (`api.deepseek.com`, `api.minimax.io`), alors que le worker
est en Europe (Paris/CDG) et que l'appelé est au Royaume-Uni. Chaque réponse paie donc **deux
aller-retours intercontinentaux** (LLM + TTS) qui s'additionnent au RTT téléphonique. Les commentaires
du code l'admettent noir sur blanc : DeepSeek « TTFT 1.8–2.1 s », pics « 5–10 s » ; MiniMax
« 400–800 ms over the China RTT ». Aucun réglage ne peut compenser la distance physique.

Par-dessus cela, le silence de début/cours d'appel n'est **pas un bug AXON** mais une **limitation
amont connue de LiveKit SIP** (issues GitHub livekit/livekit#4378 et livekit/agents#3605) : l'audio
émis par l'agent n'atteint pas l'appelé tant que celui-ci n'a pas parlé en premier (chemin RTP
unidirectionnel). Les ~4 000 lignes de `agent.py` sont en grande partie des **contournements** de ce
bug (machine à états « speech-first », gate sur `sip.callStatus`, budget de « re-greeting »…).

En clair : **on a remplacé une plateforme managée (Retell) par un assemblage maison qui combine les
deux composants les plus lents et les plus distants du marché (DeepSeek + MiniMax, Chine), puis on
empile des rustines pour masquer une limitation média SIP non résolue.** C'est un problème de structure,
pas de pansement.

---

## 2. DIAGNOSTIC PAR SYMPTÔME

### 2.1 Latence élevée — **CRITIQUE**

**Causes identifiées (par ordre d'impact) :**

1. **LLM DeepSeek via l'endpoint officiel chinois.**
   `agent/agent.py:343` → `base_url = "https://api.deepseek.com/v1"`, modèle par défaut
   `deepseek-v4-flash` (`agent.py:251,342`). Les commentaires mesurent un **TTFT de 1,8–2,1 s**
   (`agent.py:1023`) avec des **pics de 5–10 s** (`agent.py:2505`).
   *Preuve externe :* même chez les meilleurs hébergeurs tiers, DeepSeek V4 Flash plafonne à
   **~0,97 s de TTFT** ([Artificial Analysis](https://artificialanalysis.ai/models/deepseek-v4-flash/providers)) ;
   l'endpoint officiel Chine appelé depuis l'Europe est structurellement pire et **n'a pas de cache de prompt**.
   Pour de la voix temps réel, il faut viser un TTFT « warm » < 300–500 ms. **On en est loin.**

2. **TTS MiniMax via `api.minimax.io` (Chine), sans vrai streaming.**
   Le plugin `agent/minimax_tts.py` déclare `capabilities=tts.TTSCapabilities(streaming=False)` :
   c'est un `ChunkedStream` qui **synthétise la phrase entière avant de rendre l'audio**, là où
   ElevenLabs/Cartesia rendent les premiers octets en streaming progressif. Commentaire `agent.py:719` :
   MiniMax = **« 400–800 ms TTFB over the China RTT »**.

3. **Re-envoi du prompt complet à chaque tour, sans cache.**
   Le system prompt Charlotte fait **~4 500 tokens** (`agent.py:281` commentaire). DeepSeek ne supporte
   pas le prompt caching → tout est ré-encodé à chaque tour. Le cap `max_tokens=150` (`agent.py:262`)
   limite la sortie mais pas l'entrée.

4. **Détection de fin de tour dégradée en « VAD seul ».**
   Le modèle de turn-detection multilingue **saturait 2 vCPU → EOU 2,5 s+** (`agent.py:37-44`, `3228`),
   donc le défaut a été rabattu sur `"vad"` (`agent.py:3232`). Le VAD seul ajoute un délai
   d'endpointing fixe (`min_endpointing_delay`) ou coupe la parole.

5. **Désalignement géographique total.**
   Worker **CDG (Paris)**, LLM+TTS **Chine**, appelé **UK**, trunk **Twilio**. Chaque tour =
   2× RTT intercontinental incompressible.

**Sévérité : CRITIQUE.** C'est le symptôme dominant et il est d'origine structurelle.

---

### 2.2 Silence de l'IA (début ou cours d'appel) — **CRITIQUE**

**Cause principale (début d'appel) : bug média SIP amont de LiveKit, pas une faute de config AXON.**
Le code le documente explicitement (`agent.py:3484-3493`) en citant
**[livekit/livekit#4378](https://github.com/livekit/livekit/issues/4378)** :
> *« say() audio not heard by callee despite successful TTS; once the callee speaks first, all subsequent responses are heard. »*

Confirmé aussi par **[livekit/agents#3605](https://github.com/livekit/agents/issues/3605)** (Twilio→LiveKit :
seul le greeting initial passe, puis silence). Le chemin RTP reste **unidirectionnel** tant que l'appelé
n'a pas émis de média. Toute la mécanique « speech-first », la gate `sip.callStatus=active`
(`agent.py:1215-1264`), le budget de re-greeting (`agent.py:1104-1132`) et la pré-roll
(`GREETING_PREROLL_SECONDS`) sont des **contournements** de ce bug. Le workaround officiel LiveKit est
exactement ce qu'AXON fait : **attendre que l'appelé parle en premier**.

**Cause secondaire (silence en cours d'appel) :** les **pics de TTFT DeepSeek (5–10 s)**. Le watchdog
est même configuré pour **ne pas couper** un tour DeepSeek lent (`agent.py:2505`) → l'appelé entend
un blanc de plusieurs secondes. S'ajoute le `streaming=False` de MiniMax : sur une phrase longue,
**rien n'est audible avant la fin de la synthèse**.

**Sévérité : CRITIQUE.** Mélange d'une limitation amont (partiellement non corrigible côté AXON) et
des pics de latence LLM (corrigeables en changeant de provider).

---

### 2.3 Voix robotique — **MAJEUR**

**Causes identifiées :**

1. **Téléphonie = 8 kHz G.711 narrowband.** Intrinsèquement, toute voix « sonne plus IA » au
   téléphone qu'en simulation navigateur (`agent.py:776` le note). Le code tente le **rendu natif 8 kHz**
   (`auto-telephony`, `agent.py:3284`) — c'est la bonne approche.

2. **TTS MiniMax `speech-02-turbo`** : le modèle « turbo » privilégie la latence sur la fidélité, et le
   chemin China + `streaming=False` n'aide pas. C'est le maillon le plus « artificiel ».

3. **Identifiant de modèle Cartesia suspect.** La config voix par défaut pointe `tts_model="sonic-3.5"`
   (`agent.py:749`, `VOICE_CONFIG_GUIDE.md`). Or les modèles Cartesia réels sont **`sonic-2`,
   `sonic-turbo`, `sonic-3`** — **`sonic-3.5` n'existe pas** au catalogue officiel. À vérifier d'urgence :
   un identifiant invalide peut provoquer une erreur ou un fallback silencieux.

4. **Prosodie du greeting.** Le greeting court isolé « Hi, is that {{firstname}}? » est sur-accentué
   (aigu/« excité ») par ElevenLabs Flash (`VOICE_CONFIG_OCC_IMPLEMENTATION.md`). Réglages
   `tts_style=0.5`, `tts_speed=0.95`, `tts_emotion=balanced` corrects mais non confirmés en base.

5. **Ambiguïté sur ce qui est réellement actif.** Le nom du dépôt, `minimax_tts.py` et `.env.example`
   pointent **MiniMax/DeepSeek** ; les docs `VOICE_CONFIG_*` recommandent **Cartesia/Claude**. On ne sait
   pas, depuis le code seul, quelle config est en base Supabase pour Charlotte/Isabelle/Victoria.

> ⚠️ Les fichiers `VOICE_CONFIG_*.md` annoncent **« MiniMax ~75–90 ms TTFB »**, ce qui **contredit
> directement** le code (`agent.py:719` : « MiniMax 400–800 ms over the China RTT »). Ces docs
> contiennent des chiffres erronés/optimistes et ne doivent pas servir de référence de décision.

**Sévérité : MAJEUR.** Partiellement inhérent (8 kHz), largement améliorable en changeant de provider TTS.

---

### 2.4 Instabilité générale — **MAJEUR**

Conséquence cumulée : un pipeline dont **chaque maillon critique est lointain et variable**
(DeepSeek Chine + MiniMax Chine), posé sur une **limitation média SIP non résolue**, ne peut pas être
« parfait de bout en bout » de façon reproductible. Les 4 000 lignes de rustines (voicemail detection,
watchdogs, re-greeting, gates) traitent les symptômes, pas la cause.

---

## 3. ANALYSE COMPARATIVE — POURQUOI RETELL « SONNE PARFAIT » ET PAS NOUS

### Ce que Retell (ou Vapi/Bland) fait que notre config ne reproduit pas

1. **Co-localisation du pipeline STT→LLM→TTS** dans une région unique, proche du média. Retell propose
   d'ailleurs leurs LLM colocalisés et des TTS in-region (ElevenLabs, Cartesia, PlayHT, Deepgram).
   **Nous, on envoie LLM et TTS en Chine à chaque tour.**

2. **Streaming de bout en bout** : token LLM → phrase partielle → TTS streaming → audio, sans attendre
   la fin. Notre TTS MiniMax est **`streaming=False`** (synthèse bloquante par phrase).

3. **Chemin média Twilio→plateforme résolu et managé.** Retell gère la négociation RTP/SIP pour vous.
   Nous, on se bat avec le bug LiveKit SIP #4378 à coups de machine à états maison.

4. **Modèles LLM faible latence par défaut** (GPT-4o / Claude, TTFT colocalisé < 500 ms warm avec cache).
   Nous : DeepSeek Chine, **sans cache**, TTFT 1,8–2,1 s, pics 5–10 s.

5. **Turn-taking et endpointing réglables et performants** (`interruption_sensitivity`, `response_delay`,
   `reminder_trigger_ms`, backchanneling). Notre turn-detector a été **désactivé** (rabattu sur VAD) faute
   de CPU.

### La différence de fond

« Utiliser Retell correctement » = déléguer la latence/le média à une plateforme qui a colocalisé et
optimisé tout le pipeline. « Ce qu'on fait » = **réimplémenter cette architecture soi-même avec les deux
composants les plus lents et les plus distants disponibles**, sur une couche SIP dont le bug média n'est
pas résolu. L'ironie : `agent.py:303-313` contient déjà une option **LiveKit Inference** (LLM colocalisé
aux serveurs média, commentée « architecture Retell ») — mais elle n'est **utilisée qu'en A/B**, la prod
reste sur DeepSeek.

---

## 4. PLAN DE CORRECTION — ORDONNÉ PAR PRIORITÉ

> Aucune ligne de code n'est écrite ici : ce sont des décisions de config / d'architecture.

### P0 — Sortir le LLM de l'endpoint DeepSeek Chine (impact : latence + silence en cours d'appel)
- **Quoi** : basculer `llm_provider`/`llm_model` (Supabase, table `agents`) pour Charlotte/Isabelle/Victoria.
- **Actuel** : `deepseek` / `deepseek-v4-flash` via `api.deepseek.com` (Chine), sans cache.
- **Recommandé** : `anthropic` / `claude-haiku-4-5-20251001` (caching ephemeral déjà câblé, `agent.py:293`)
  **ou** `openai` / `gpt-4o-mini` **ou** LiveKit Inference (`provider="livekit"`, LLM colocalisé).
- **Impact attendu** : TTFT warm **< 300–500 ms** au lieu de 1,8–10 s ; suppression des blancs en cours d'appel.
- **Complexité** : **changement de config** (DB + clé API worker). Aucun code.

### P0 — Sortir le TTS de MiniMax Chine vers un TTS in-region streamé (impact : latence + voix robotique)
- **Quoi** : passer `tts_voice_id`/`tts_model` sur Cartesia ou ElevenLabs.
- **Actuel** : MiniMax `speech-02-turbo`, `api.minimax.io` (Chine), **`streaming=False`**, TTFB 400–800 ms.
- **Recommandé** : **Cartesia Sonic** (`sonic-turbo` ~40 ms / `sonic-3` ~90–188 ms TTFA, 8 kHz télécom natif)
  ou **ElevenLabs Flash v2.5** (~75 ms d'inférence, WebSocket streaming). **Corriger `sonic-3.5` → modèle
  valide (`sonic-3`/`sonic-turbo`).**
- **Impact attendu** : TTFB divisé par ~5–10, audio progressif (plus de blanc avant la 1re syllabe), voix
  nettement moins « IA ».
- **Complexité** : **config** (+ vérifier l'ID de modèle et la clé `CARTESIA_API_KEY`/`ELEVEN_API_KEY`).

### P1 — Aligner toutes les régions sur EU/UK (impact : latence, stabilité)
- **Quoi** : worker LiveKit/Fly, LLM, TTS, STT (AssemblyAI **endpoint EU**, déjà prévu via
  `ASSEMBLYAI_BASE_URL=wss://streaming.eu.assemblyai.com`) et **edge Twilio UK/Dublin** sur la même zone.
- **Actuel** : worker CDG, LLM+TTS Chine, mélange de régions.
- **Impact** : supprime les RTT intercontinentaux sur le chemin critique.
- **Complexité** : **config infra** (régions Fly/LiveKit/Twilio).

### P1 — Traiter proprement le silence de début (impact : silence)
- **Quoi** : conserver le mode **speech-first** (déjà le défaut prod) ; **ne pas** utiliser le greeting
  on-answer en sortant ; activer **Krisp** (déjà `krisp_enabled` côté inbound) ; suivre l'évolution de
  l'issue LiveKit #4378.
- **Actuel** : machine à états de contournement, fonctionnelle mais fragile.
- **Impact** : limité — c'est une **limitation amont**. Gain marginal tant que LiveKit n'a pas corrigé le RTP.
- **Complexité** : config + veille amont (pas de fix complet possible côté AXON).

### P2 — Restaurer un vrai turn-detector (impact : latence d'endpointing, coupures)
- **Quoi** : provisionner le worker à **≥ 4 vCPU** et réactiver `EnglishModel` (anglais distillé) au lieu
  de VAD seul ; ajuster `min_endpointing_delay`.
- **Actuel** : `TURN_DETECTOR="vad"` car le multilingue saturait 2 vCPU (EOU 2,5 s+).
- **Impact** : EOU plus fiable, moins de coupures/blancs.
- **Complexité** : **config infra** (taille worker) + 1 variable d'env.

### P2 — Hygiène de prompt (impact : latence LLM)
- **Quoi** : raccourcir les system prompts (~4 500 tokens → cible < 1 500) ; le **prompt caching** ne
  fonctionne que sur Claude/OpenAI (argument supplémentaire pour quitter DeepSeek).
- **Complexité** : édition de contenu (DB), pas de code.

### P2 — Vérifier le codec SIP (impact : qualité voix)
- **Quoi** : confirmer **PCMU/PCMA (G.711) 8 kHz** négocié sur le trunk et le rendu TTS natif 8 kHz
  (déjà forcé par `auto-telephony`, `agent.py:3284`). Éviter tout double resampling 44,1 kHz→8 kHz.
- **Complexité** : vérification config trunk LiveKit/Twilio.

---

## 5. RECOMMANDATION FINALE

**C'est un problème structurel, pas un problème de réglage.** La stack actuelle a choisi, pour un produit
voix temps réel destiné au UK, **les deux composants les plus lents et les plus distants du marché**
(DeepSeek Chine + MiniMax Chine), puis a empilé ~4 000 lignes de contournements sur un bug média SIP
LiveKit non résolu. Le combo **MiniMax + DeepSeek ne pourra jamais atteindre la qualité « Retell natif » :
c'est de la physique (RTT intercontinental à chaque tour), pas de la configuration.**

Deux chemins honnêtes :

**Option A — Réparer la stack LiveKit maison (recommandée si on garde LiveKit).**
Exécuter P0+P1 : LLM in-region (Claude Haiku 4.5 / GPT-4o-mini / LiveKit Inference) + TTS in-region streamé
(Cartesia Sonic / ElevenLabs Flash) + alignement régional EU/UK + turn-detector restauré. On peut atteindre
un niveau **« très bon »**. Limite : **on continue de posséder le bug média SIP LiveKit** (#4378) — le silence
de tout début d'appel restera partiellement subi tant que LiveKit n'aura pas corrigé son RTP.

**Option B — Revenir à une plateforme managée (Retell, éventuellement Vapi) si la barre est « Retell-natif parfait ».**
Si l'objectif est la perfection de bout en bout sans vouloir faire de l'ingénierie média SIP, Retell/Vapi
résolvent **pour vous** le chemin média + le pipeline colocalisé. Le dépôt `minimax-for-occ` est, de fait,
une migration **de** Retell **vers** une stack maison qui a échangé la qualité contre le coût. Si la qualité
prime, ce choix doit être réévalué.

**Verdict :** appliquer **immédiatement P0** (sortir DeepSeek **et** MiniMax de Chine) résoudra la grande
majorité de la latence et du silence en cours d'appel pour un coût quasi nul (changements de config). Le
silence de **tout début** d'appel restera, lui, tributaire de la limitation LiveKit SIP — c'est le seul point
qui peut justifier, à terme, un retour vers une plateforme managée.

---

### Références (documentation officielle / sources)
- DeepSeek V4 Flash — TTFT providers : https://artificialanalysis.ai/models/deepseek-v4-flash/providers
- Cartesia Sonic (latence/8 kHz télécom) : https://docs.cartesia.ai/build-with-cartesia/tts-models/older-models · https://gradium.ai/content/tts-latency-benchmark-2026
- ElevenLabs Flash v2.5 / latence : https://elevenlabs.io/docs/overview/models · https://elevenlabs.io/docs/eleven-api/concepts/latency
- LiveKit — bug média SIP (silence début d'appel) : https://github.com/livekit/livekit/issues/4378 · https://github.com/livekit/agents/issues/3605
- LiveKit Agents — téléphonie : https://docs.livekit.io/agents/start/telephony/

# Guide utilisateur Axon — Plateforme contact-center IA

Ce guide explique **comment utiliser la plateforme au quotidien** selon ton rôle. Pour l'installation et la configuration technique, voir le `README.md`.

---

## Table des matières

1. [Vue d'ensemble](#1-vue-densemble)
2. [Se connecter](#2-se-connecter)
3. [Les rôles](#3-les-rôles)
4. [Guide Super Admin](#4-guide-super-admin)
5. [Guide Admin](#5-guide-admin)
6. [Guide Manager](#6-guide-manager)
7. [Guide Superviseur](#7-guide-superviseur)
8. [Guide Agent (humain)](#8-guide-agent-humain)
9. [Concepts clés](#9-concepts-clés)
10. [Workflows métier complets](#10-workflows-métier-complets)
11. [Dépannage utilisateur](#11-dépannage-utilisateur)

---

## 1. Vue d'ensemble

Axon est une **plateforme de centre de contact** qui combine :
- **Agents IA vocaux** qui décrochent et parlent (voix clonable, multilingue)
- **Agents humains** sur softphone web (pas besoin de logiciel à installer)
- **Bascule fluide IA → humain** en plein appel
- **IVR visuel** (drag-and-drop) pour configurer les parcours d'appel
- **Campagnes outbound** (le système rappelle automatiquement)
- **Supervision en temps réel** (écouter, souffler, intervenir)
- **Analytics** (durée, taux de transfert, satisfaction, export CSV)

Tout est **multi-tenant** : chaque organisation a ses propres agents, numéros, contacts, files d'attente, sans voir celles des autres.

---

## 2. Se connecter

1. Va sur ton URL Axon (ex: `https://minimax-for-occ.vercel.app`)
2. Tu arrives sur la page de login
3. Deux cas :
   - **Tu as reçu une invitation par email** → clique le lien dans le mail → choisis un mot de passe → tu es dans
   - **Tu n'as pas encore de compte** → demande à ton admin de t'envoyer une invitation (page Admin → Users → Invite)

Une fois connecté, Axon te redirige automatiquement vers **ta page d'accueil selon ton rôle** :
- super_admin / admin → `/dashboard`
- manager → `/dashboard`
- supervisor → `/calls` (live)
- agent → `/desk` (softphone)

---

## 3. Les rôles

| Rôle | Mission | Pages accessibles |
|---|---|---|
| **super_admin** | Gère plusieurs organisations (ex: éditeur SaaS) | Tout + switch d'org |
| **admin** | Configure une organisation | Users, Numéros, Agents IA, Flows, Queues, Campagnes, Analytics |
| **manager** | Pilote l'activité quotidienne | Dashboard + Analytics + Agents (lecture) + Copilote IA |
| **supervisor** | Surveille les appels en direct | Live calls (écoute/whisper/barge) |
| **agent** | Prend les appels (humain) | Softphone /desk + ses appels + contacts |

Le menu latéral (sidebar) **s'adapte automatiquement** à ton rôle — tu ne vois que ce qui te concerne.

---

## 4. Guide Super Admin

### 4.1 Switcher entre organisations

En haut à droite de la sidebar, tu as un **sélecteur d'organisation**. Toutes les pages s'adaptent à l'org sélectionnée.

### 4.2 Créer une nouvelle organisation

1. **Admin → Organisations → Nouvelle**
2. Renseigne le nom (ex: "Hôtel des Pins")
3. Une org vide est créée

### 4.3 Inviter un Admin pour cette org

1. Switche sur la nouvelle org
2. **Admin → Users → Inviter**
3. Email + rôle = `admin` → Envoyer
4. La personne reçoit un mail avec un lien magique

### 4.4 Désactiver une org

**Admin → Organisations → ⋮ → Désactiver** (rendre inaccessible sans détruire les données).

---

## 5. Guide Admin

L'admin configure et gère **son** organisation. Tour complet des sections importantes.

### 5.1 Inviter des utilisateurs

**Admin → Users**

- Cliquer **+ Inviter**
- Email + rôle (agent / supervisor / manager / admin)
- L'utilisateur reçoit un mail avec un lien d'activation valide 7 jours
- Tant qu'il n'a pas cliqué : status "Invité"
- Une fois activé : status "Actif" + last_login affiché

**Désactiver un user** : ⋮ → Désactiver. L'utilisateur garde son compte mais ne peut plus se connecter.

**Changer son rôle** : ⋮ → Éditer → choisir nouveau rôle.

### 5.2 Acheter et configurer des numéros

**Numéros → Rechercher / Acheter**

1. Choisis un pays (FR, BE, CH, US, …)
2. Type : Local / Mobile / TollFree
3. Axon liste les numéros disponibles via Twilio
4. Clique **Acheter** sur celui qui te plaît (coût: 1 €/mois environ)
5. Le numéro apparaît dans **Numéros → Mes numéros**

**Assigner un numéro à un agent IA ou une queue** :
- Clique sur le numéro
- **Routage** :
  - "Agent IA" → choisis lequel → tous les appels vont à cet agent
  - "Queue" → choisis laquelle → l'agent libre (ou IA fallback) répond
  - "Flow IVR" → choisis lequel → l'appelant entend un menu IVR

⚠️ **Côté Twilio (à faire une fois par numéro acheté)** : va sur https://console.twilio.com → Phone Numbers → Active → ton numéro → Configure :
- Voice → A Call Comes In : `Webhook POST https://<ton-domaine>/api/twilio/voice`
- Status callback : `https://<ton-domaine>/api/twilio/status`

### 5.3 Créer un agent IA

**Agents → + Nouvel agent**

Champs :
- **Nom** : interne, pour t'y retrouver (ex: "Concierge Hotel Niveau 1")
- **Langue** : `multi` (recommandé, détecte automatiquement), ou `fr`, `en`, …
- **Voix** : choisis dans le catalogue (voix preset ou voix clonée — voir 5.4)
- **Modèle TTS** : `speech-02-hd` (qualité) ou `speech-02-turbo` (latence)
- **LLM** : OpenAI gpt-4o-mini (par défaut, recommandé)
- **System prompt** : la "personnalité" de ton agent
- **Greeting** : phrase d'accueil (sera lue à chaque décrochage)
- **RAG** : on/off — si on, l'agent peut chercher dans les documents que tu lui as fournis
- **Outils n8n** : workflows que l'agent peut déclencher (ex: "réserver un créneau", "envoyer email de confirmation")

**Exemple de system prompt pour un hôtel** :
```
Tu es Sophie, conciergerie de l'Hôtel des Pins.
Tu accueilles les clients chaleureusement et tu peux :
- répondre aux questions sur les chambres, le restaurant, les horaires
- prendre des messages
- transférer à la réception si demande complexe (utilise transfer_human)

Sois concise, naturelle, jamais robotique.
```

### 5.4 Cloner une voix

**Voices → + Cloner une voix**

1. Donne un nom (ex: "Voix Sophie")
2. Upload un fichier audio :
   - Format : MP3 ou WAV mono
   - Durée : 10 secondes à 5 minutes
   - Qualité : claire, sans bruit de fond, une seule personne parle
3. Clique **Cloner**
4. Au bout de 10-30 secondes, la voix apparaît dans le catalogue
5. **Teste-la** : clique sur ▶ à côté → Axon synthétise une phrase test

⚠️ Si "Erreur MiniMax" → va dans **Voices → Diagnostic** pour voir le détail (clés manquantes, quota dépassé, etc.)

### 5.5 Créer un flow IVR (parcours d'appel visuel)

**Flows → + Nouveau flow**

Tu arrives sur un **canvas drag-and-drop** (style Visual Basic).

Types de nœuds disponibles :
- **Start** : point d'entrée
- **Say** : l'agent dit une phrase (ex: "Bienvenue chez X, dites votre demande")
- **Listen** : capture ce que dit l'appelant (timeout configurable)
- **Choice** : branche selon ce qu'il a dit (ex: "réservation" → branche A, "annulation" → branche B)
- **API Call** : appelle un endpoint externe (n8n, ton backend)
- **Transfer** : transfère vers un humain ou une autre queue
- **Hangup** : raccroche
- **Voicemail** : enregistre un message

**Pour relier** : clique sur la sortie d'un nœud → tire vers l'entrée du suivant.

**Pour assigner un flow à un numéro** : Numéros → numéro → Routage → Flow IVR → ton flow.

### 5.6 Créer une queue (file d'attente)

**Queues → + Nouvelle queue**

- Nom (ex: "Support Niveau 1")
- Stratégie de routage :
  - `longest_idle` (recommandé) : l'agent libre depuis le plus longtemps prend l'appel
  - `round_robin` : rotation entre agents
  - `broadcast` : sonne tous les agents en même temps
- Attente max (en secondes) : 600 par défaut
- Fallback voicemail : si personne ne décroche → enregistre un message

**Ajouter des membres** :
- Clique sur la queue → **Membres** → + Ajouter
- Tu peux ajouter :
  - Des **agents humains** (utilisateurs avec rôle `agent`)
  - Des **agents IA** (en fallback, ou en première ligne)

### 5.7 Lancer une campagne outbound

**Campagnes → + Nouvelle campagne**

1. **Nom** : "Relance clients juin"
2. **Agent IA assigné** : qui va passer les appels
3. **Numéro émetteur** : depuis quel numéro Twilio
4. **Cible** : upload un CSV (colonnes obligatoires : `phone`, optionnel : `first_name`, `last_name`, ...)
5. **Fenêtre horaire** : ex 9h-19h, lundi-vendredi seulement
6. **Vitesse** : nb d'appels simultanés (max 10)
7. **Script** : prompt spécifique pour la campagne (override le system prompt de l'agent)

**Démarrer** : bouton ▶ Démarrer. Le worker Fly.io poll Supabase toutes les 30 secondes et dial les contacts dus.

**Stats en live** : la page campagne affiche :
- Appels passés / restants
- Taux de réponse
- Durée moyenne
- Taux de transfert humain

### 5.8 Analytics

**Analytics**

KPIs principaux :
- Nb d'appels (entrants / sortants)
- Durée moyenne
- Taux de réponse
- Taux de transfert IA → humain
- Satisfaction (si SMS post-call activé)
- Coûts (Twilio + LLM + TTS estimés)

Filtres : période, agent, queue, campagne.

**Export CSV** : bouton ⬇️ en haut à droite → télécharge un CSV de tous les appels filtrés.

---

## 6. Guide Manager

Le manager **ne configure pas**, il **pilote**.

### 6.1 Dashboard manager

Page d'accueil après login. Tu vois :
- **KPIs temps réel** : appels en cours, agents disponibles, queue d'attente actuelle
- **Graphiques** : volume appels sur 24h, taux de réponse, top 5 agents
- **Copilote IA** : champ texte en bas — pose une question en langage naturel

### 6.2 Copilote IA (gpt-4o)

Exemples de questions :
- "Combien d'appels manqués hier ?"
- "Quel agent a la meilleure satisfaction cette semaine ?"
- "Liste les 5 derniers appels transférés vers Marie"
- "Y a-t-il une anomalie dans le volume ?"

Le copilote interroge la DB en direct et te répond avec données + recommandations.

### 6.3 Analytics

Mêmes vues que l'admin (lecture seule).

### 6.4 Voir un agent IA (lecture)

**Agents → cliquer un agent** : tu vois sa config, son volume d'appels, sa satisfaction. Tu ne peux **pas modifier** (rôle admin requis).

---

## 7. Guide Superviseur

Le superviseur **surveille les appels en cours** et peut intervenir.

### 7.1 Page Live Calls

**Calls → Live** : tableau temps réel de tous les appels en cours.

Pour chaque appel :
- Numéro appelant / numéro appelé
- Agent (IA ou humain)
- Durée
- Transcription en direct (mise à jour à chaque phrase)
- Statut (ringing / connected / on hold)

### 7.2 Listen / Whisper / Barge

Clique sur un appel en cours → 3 boutons :

- 🎧 **Listen** : tu écoutes l'appel **discrètement**, ni l'agent ni le client ne t'entendent
- 🗣️ **Whisper** : tu parles, **seul l'agent t'entend** (souffler une réponse)
- ⚡ **Barge** : tu rejoins l'appel, **tout le monde t'entend** (intervention directe)

Ces modes s'appuient sur LiveKit (tu rejoins la room en `hidden=true` et tu modules ton mute selon le mode).

### 7.3 Marquer un appel

Pendant ou après un appel, tu peux ajouter :
- **Note** (texte libre)
- **Tag** (escalade / réclamation / vente / etc.)
- **Note de qualité** (1-5 étoiles)

Ces données alimentent les analytics du manager.

---

## 8. Guide Agent (humain)

L'agent humain **prend les appels** via un **softphone dans le navigateur** (pas besoin de logiciel).

### 8.1 Le Desk (softphone)

Page d'accueil : **/desk**

En haut :
- Ton statut : 🟢 Disponible / 🟡 En pause / 🔴 Indisponible
- Bouton pour passer en pause (sera ignoré par le routing)

Au centre : **panneau d'appel**
- Si pas d'appel : "En attente d'appel…"
- Si appel entrant : **🔔 Sonne** avec numéro affichant + nom du contact si connu → bouton ✅ Décrocher / ❌ Refuser

### 8.2 Pendant un appel

- **Couper micro** (mute / unmute)
- **Mettre en attente** (hold)
- **Transférer** :
  - Vers un autre agent → choisis dans la liste
  - Vers une autre queue → choisis dans la liste
  - Vers un numéro externe → tape un numéro PSTN
- **Conférence** : ajoute un 3e participant
- **Notes** : tape tes notes en temps réel, elles sont sauvegardées à la fin de l'appel
- **Voir contact** : panneau de droite avec historique de cet appelant

### 8.3 Recevoir un appel d'IA en handoff

Si un appel commence avec l'IA et que le client demande "passez-moi un humain" :
1. L'IA dit "Je vous passe un conseiller, ne quittez pas"
2. **Ton softphone sonne** dans les 2-3 secondes
3. Tu décroches → tu vois sur le panneau :
   - **Résumé IA** : ce qui s'est dit pendant la phase IA
   - **Contexte client** : tout ce que l'IA a appris sur le client
4. Tu prends le relais sans transition pour le client

### 8.4 Appels sortants manuels

Bouton **Composer** en haut → tape un numéro → l'appel part depuis ton numéro de queue.

### 8.5 Mes contacts

**Contacts** : liste de tous les contacts de ton org. Tu peux :
- Rechercher (par nom / téléphone / email)
- Voir l'historique d'appels d'un contact
- Ajouter une note
- Cliquer ☎️ pour appeler directement

---

## 9. Concepts clés

### 9.1 Agent IA vs Agent humain

- **Agent IA** : entité virtuelle (nom + voix + prompt + LLM) qui prend des appels 24/7
- **Agent humain** : un utilisateur réel avec un compte, qui se connecte au softphone

Ils sont **interchangeables** dans les queues — tu peux mettre un humain en priorité et l'IA en fallback, ou l'inverse.

### 9.2 Flow IVR vs Agent IA direct

- **Flow IVR** : parcours rigide ("tapez 1 pour…") configuré dans le builder visuel. Bon pour des cas structurés.
- **Agent IA direct** : conversation libre. L'agent IA peut elle-même router via ses outils (tools n8n).

Tu peux combiner : un Flow IVR qui aboutit à un Agent IA dans certaines branches.

### 9.3 Queue vs Numéro

- **Numéro** : une ligne PSTN (achetée chez Twilio)
- **Queue** : un regroupement logique d'agents (humains ou IA) avec une stratégie de routage

Un numéro peut être routé directement vers un agent ou vers une queue. Une queue peut recevoir des appels de plusieurs numéros.

### 9.4 Campagne outbound

Une **campagne** = un ensemble de cibles (contacts à rappeler) avec une fenêtre horaire et un script. Le worker Fly.io lance les appels automatiquement et un agent IA (généralement) tient la conversation.

### 9.5 RAG (Retrieval-Augmented Generation)

Tu peux donner à un agent IA des **documents** (PDF, TXT, markdown) qu'il va indexer dans sa base vectorielle (pgvector). Pendant un appel, l'agent peut "chercher dans la doc" pour répondre précisément.

Exemple : un agent IA pour un hôtel a accès au PDF des tarifs → le client demande le prix d'une suite → l'agent retrouve la bonne info et répond.

### 9.6 Tools n8n

Tu peux brancher l'agent IA à des **workflows n8n** que tu as construits visuellement. Ça permet à l'agent de :
- Réserver dans ton CRM
- Envoyer un email/SMS
- Interroger ton API métier
- Logger dans un Google Sheet

Tu décides workflow par workflow lesquels un agent IA peut déclencher.

### 9.7 Handoff (bascule IA → humain)

Pendant un appel IA, si l'agent IA décide (ou si le client demande) :
1. L'IA appelle l'outil `transfer_human`
2. Le système trouve un agent humain disponible dans la queue cible
3. L'humain rejoint la room LiveKit avec un résumé du contexte
4. L'IA peut soit raccrocher, soit rester en sourdine pour intervenir si besoin

### 9.8 Supervision live

Un superviseur peut **rejoindre une room** en mode `hidden=true` (LiveKit) → l'audio passe, mais ni le client ni l'agent ne savent qu'il est là (mode listen). En toggling le mute, il passe en whisper (agent only) ou en barge (tous).

---

## 10. Workflows métier complets

### 10.1 Setup hôtellerie en 30 min

1. **Admin** invite ses agents (réceptionnistes humains)
2. **Admin** achète 1 numéro Twilio (FR mobile)
3. **Admin** clone la voix d'un membre du staff sympa
4. **Admin** crée un agent IA "Concierge" avec system prompt hôtelier + tools n8n (réserver, envoyer confirmation)
5. **Admin** crée une queue "Hôtel" avec : Concierge IA (priorité 1) + Réceptionnistes (priorité 2 = fallback)
6. **Admin** route le numéro → queue "Hôtel"
7. **Admin** configure les webhooks Twilio (voice/status/recording)

Résultat : un client appelle, l'IA décroche en 2 secondes avec la voix du staff, elle répond aux questions courantes (horaires, prix) et bascule sur un humain pour le sensible (réclamation, demande spéciale).

### 10.2 Relance commerciale outbound

1. **Admin** prépare un CSV avec 1000 prospects (colonnes : `phone`, `first_name`)
2. **Admin** crée un agent IA "Commercial" avec script de relance
3. **Admin** crée une campagne :
   - Cible : CSV uploadé
   - Agent : Commercial
   - Fenêtre : 9h-12h et 14h-18h, lundi-vendredi
   - Vitesse : 5 appels simultanés max
4. **Admin** lance ▶
5. Le worker Fly compose les numéros progressivement
6. L'IA propose le RDV, si intérêt → transfert humain (équipe ventes en queue)
7. **Manager** suit le taux de conversion en temps réel
8. À la fin, **export CSV** des résultats pour le CRM

### 10.3 Audit qualité

1. **Supervisor** ouvre Calls → Live
2. Choisit un appel en cours d'un junior
3. **Listen** discret → écoute la qualité
4. Si l'agent bloque, **Whisper** "propose un remboursement partiel"
5. Si dérapage, **Barge** pour reprendre la main
6. À la fin de l'appel → ajoute une note + tag "à coacher" + note 3/5
7. **Manager** voit en dashboard la note qualité moyenne et déclenche un débrief

---

## 11. Dépannage utilisateur

### "Je ne reçois pas d'invitation par email"
- Vérifie tes spams
- Vérifie que ton admin a bien tapé la bonne adresse
- L'admin peut **Renvoyer l'invitation** depuis Admin → Users

### "Je n'entends rien dans le softphone"
- Autorise le micro dans le navigateur (Chrome / Edge → cadenas → micro = Autoriser)
- Recharge la page
- Si Mac → System Settings → Privacy & Security → Microphone → cocher ton navigateur

### "L'agent IA décroche puis raccroche tout de suite"
- C'est probablement un problème de voix clonée invalide ou de quota MiniMax
- **Admin** : va dans Voices → ▶ Tester sur la voix concernée → si erreur → re-cloner
- Vérifier Voices → Diagnostic

### "Mes appels outbound ne partent pas"
- Vérifier que la campagne est bien sur ▶ (pas en pause)
- Vérifier que la fenêtre horaire est ouverte (ex: pas un dimanche si tu as restreint à lundi-vendredi)
- Vérifier les logs Fly : `flyctl logs -a axon-agent`
- Vérifier que ton numéro Twilio source est bien actif et a les bons webhooks

### "Le client n'entend pas l'agent IA / coupures"
- C'est souvent un problème de SIP entre Twilio et LiveKit
- **Admin** : vérifie que le SIP trunk LiveKit est bien configuré et que Twilio TwiML pointe sur la bonne URI
- Tester avec `lk sip dispatch test` depuis la CLI LiveKit

### "Je ne vois pas le menu Campagnes / Analytics / etc."
- Le menu est filtré selon ton rôle. Si tu n'as pas accès, demande à ton admin de te re-attribuer le bon rôle

### "Mes notes ne sauvegardent pas"
- Refresh, puis re-tape
- Si persiste : F12 → Console → screenshot à l'admin

---

## Pour aller plus loin

- **README.md** : config technique, deploys, env vars
- **docs/END_TO_END_TEST.md** : scénario de test complet bout-en-bout
- **docs/ARCHITECTURE_V2.md** : architecture détaillée
- **docs/TELEPHONY.md** : config Twilio + LiveKit SIP

Pour toute question non couverte ici, contacte le super_admin de ta plateforme.

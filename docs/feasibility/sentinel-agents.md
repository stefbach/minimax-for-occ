# Sentinel Agents — Feasibility Study

## TL;DR

Build a slim MVP. **~70% of the value is hard-rule preflight checks** that cost nothing and reuse existing tables (`campaigns`, `agent_handles`, `phone_numbers`, `tenant_data_tables`, `dnc_lists`). LLM post-call quality sentinels are a re-skin of `web/lib/analysis-runner.ts`. Monthly LLM ceiling for OCC at 200 calls/day: **under €15**.

---

## Check Catalogue (30 items)

Stages: **C**=campaign-creation form, **P**=pre-launch (Démarrer click), **R**=runtime (during dialing), **K**=post-call, **T**=periodic (poll).
Types: **H**=hard rule, **L**=LLM, **X**=cross-data heuristic. Severity: **B**=blocker, **W**=warning, **I**=info.

| # | Name | Stage | Sev | Type | Data source | Cost | Remediation hint |
|---|------|-------|-----|------|-------------|------|------------------|
| 1 | Agent sans `system_prompt` | C/P | B | H | `agents.system_prompt` via `agent_handles.ai_agent_id` | 0 | "Ouvrir la fiche agent et écrire un prompt" |
| 2 | Voix TTS introuvable / sans `tts_voice_id` | C/P | B | H | `agents.tts_voice_id` + `voices` | 0 | "Clone ou sélectionne une voix existante" |
| 3 | `agent_handles.active=false` | C/P | B | H | `agent_handles.active` | 0 | "Réactiver l'agent" |
| 4 | Aucun numéro émetteur pour le pays cible | P | B | H | `phone_numbers.country_code` vs target E.164 | 0 | "Acheter un numéro local ou autoriser un fallback" |
| 5 | Numéro émetteur `active=false` ou non par défaut | C/P | W | H | `phone_numbers.active`, `is_default` | 0 | "Activer le numéro" |
| 6 | `schedule.days` vide ou `hours` invalide | C/P | B | H | `campaigns.schedule` (cf. `dialer/src/main.ts:97-115`) | 0 | "Cocher au moins un jour et une plage horaire" |
| 7 | `max_concurrency > 5` (limite AssemblyAI free) | C | W | H | `campaigns.max_concurrency` | 0 | "Réduire ou upgrade STT plan" |
| 8 | `max_attempts > 5` (risque DNC implicite) | C | W | H | `campaigns.max_attempts` | 0 | "3 tentatives suffisent généralement" |
| 9 | 0 cibles seedées | P | B | H | `count(campaign_targets where campaign_id=…)` | 0 | "Importer un CSV ou choisir une Base" |
| 10 | `tenant_data_tables.phone_column` vide / >5% E.164 invalides | C/P | B | H | scan physical table | 0 | "Nettoyer la colonne téléphone" |
| 11 | >30% des targets sur DNC | P | W | H | join `campaign_targets` ↔ `dnc_lists` (migration 0024) | 0 | "Filtrer le CSV avant import" |
| 12 | `caller_id_e164` ≠ tout numéro org-owned | C/P | B | H | `phone_numbers.e164` | 0 | "Choisir un numéro de la liste" |
| 13 | Trunk LiveKit non auth (`ensureOutboundTrunkAuth`) | P | B | H | LiveKit `SipClient.listSipOutboundTrunk` | 0 | "Vérifier `LIVEKIT_SIP_OUTBOUND_TRUNK_ID`" |
| 14 | Langue du prompt ≠ langue déclarée de l'agent | C/P | W | L | `agents.system_prompt` + `agents.language` | 0.02¢ | "Aligner langue agent ↔ prompt" |
| 15 | Prompt promet des actions sans n8n tools mappés | C/P | W | L | `agents.system_prompt` + `agent_n8n_workflows` | 0.03¢ | "Connecter un workflow ou retirer la promesse" |
| 16 | Script de campagne contradictoire avec prompt agent | C | W | L | `scripts.body` + `agents.system_prompt` | 0.04¢ | "Réconcilier les deux textes" |
| 17 | Flow contient un step orphelin (no incoming edge) | C/P | W | H | `flow_steps` ↔ `flow_edges` | 0 | "Connecter ou supprimer le step" |
| 18 | Flow sans `start_step_id` | C/P | B | H | `flows.start_step_id` | 0 | "Désigner un step de départ" |
| 19 | Hors plage horaire mais campaign `running` | R | I | H | `withinSchedule()` returns false | 0 | "Normal — patientera jusqu'au créneau" |
| 20 | Aucun nouveau call démarré depuis 10 min (campagne running, slots dispo) | R | B | X | `calls.started_at` + `campaign_targets.status=pending` | 0 | "Vérifier worker dialer + Twilio quota" |
| 21 | Taux de réponse < 20% sur dernière heure | R | W | X | aggregate `calls.disposition` last 1h | 0 | "Vérifier réputation du numéro / horaire" |
| 22 | Taux d'abandon ≥ 30% sur dernière heure | R | W | X | `calls where disposition='abandoned'` | 0 | "Voix qui démarre trop tard, vérifier TTS latency" |
| 23 | Coût/appel > 2× moyenne org sur 24h | R | W | X | `usage_events.cost_cents` / `calls` | 0 | "Modèle LLM trop verbeux, switch deepseek-v4-flash" |
| 24 | Durée moyenne d'appel < 8 s (hangup précoces) | R | W | X | `calls.duration_secs` 1h window | 0 | "Greeting effrayant ou voix robotique" |
| 25 | Transcript répond dans la mauvaise langue | K | W | L | `call_transcripts.text` | 0.05¢ | "Vérifier prompt + `agents.language`" |
| 26 | Agent n'a pas posé la question-clé du script | K | W | L | `call_transcripts` + `scripts.mission` | 0.05¢ | "Renforcer instruction dans le prompt" |
| 27 | Appel terminé par objection récurrente (>40% des refus) | T | W | L+X | aggregate `call_analyses.result` sur 50 derniers | 0.1¢/jour | "Ajouter un contre-argument au script" |
| 28 | Disposition `voicemail` mais transcript non vide | K | I | H | `calls.disposition` + `call_transcripts.count` | 0 | "Mettre à jour la disposition" |
| 29 | Coût STT > seuil (call > 600 s) | K | I | H | `usage_events.stt_seconds` | 0 | "Couper l'appel après X minutes" |
| 30 | Drift quotidien : prompt modifié pendant campaign running | T | I | H | `event_log` action `agent.updated` ∩ `campaigns.state=running` | 0 | "Logger pour audit, pas bloquant" |

---

## Architecture sketch

Three layers:

1. **Preflight rule engine** — new `web/lib/sentinels/rules.ts`, pure-TS `runPreflight(campaignId): Finding[]`. Each rule is `{id, severity, run(ctx)}`. Called from `web/app/api/campaigns/[id]/route.ts` GET (badges), from `web/app/api/campaigns/[id]/start/route.ts` POST (rejects 409 on any blocker before flipping `state='running'`), and from the wizard final step.
2. **Runtime monitor** — extend the existing 30 s loop in `dialer/src/main.ts:128` with a 5-min branch that iterates `campaigns where state='running'`, runs heuristics #20-24, writes findings to `event_log` / `alerts`. Vercel Cron is not configured (`web/vercel.json` has no `crons` block), so piggy-backing on the dialer worker avoids new infra.
3. **Post-call + periodic LLM** — reuse `runAnalysisPolicies()` (`web/lib/analysis-runner.ts`). Sentinels become seeded `analysis_policies` rows (`sentinel.language_match`, `sentinel.script_coverage`) with seeded `alert_rules`. Zero new tables.

**Storage:** no `sentinel_findings` table. Campaign findings → `event_log` (`entity='campaign', action='sentinel.<rule_id>'`); call findings → `alerts`. Both are RLS-scoped per org and already rendered by `web/components/dashboard/ErrorsAlertsTab.tsx`.

---

## UX integration

**Primary pattern: badge on campaign cards + blocking the `Démarrer` button.** GET returns a finding set; the card shows green/amber/red; the Détail page shows a "Sentinelles" accordion grouped by severity; Démarrer is disabled with a tooltip listing blockers. Runtime + post-call findings flow into the existing "Erreurs & Alertes" tab — no new tab. Toasts only on red transitions for running campaigns.

Rationale: founders don't want a new tab — they want the existing buttons to refuse to do the wrong thing. Reusing `alerts` + `event_log` means zero new schema and the copilot can already query findings via its existing tools.

---

## Cost analysis (OCC: 200 calls/day, 5 campaigns)

| Bucket | Volume/day | €/month |
|--------|-----------:|--------:|
| Hard-rule preflight #1-13, 17-18 | 20 wizard saves × 12 rules | 0 |
| LLM preflight #14-16 | 20 × 3 × ~500 tok | 0.60 € |
| Runtime heuristics (DB only, every 5 min) | 288 ticks | 0 |
| Post-call LLM #25-26 | 200 × 2 × ~1500 tok | 6.00 € |
| Periodic #27 (daily aggregate) | 1 × ~6000 tok | 0.03 € |
| **Total LLM-only** | | **~6.60 €** |

With 2× safety buffer → **~€15/month per active org**. Per-call cost today (`usage_events`) is 4-8¢ — sentinels add <1% overhead.

---

## Delivery plan — 5 waves

| # | Scope | Days |
|---|-------|-----:|
| 1 | Preflight hard rules (#1-13, 17-18); `/api/campaigns/[id]/preflight`; badge + block `Démarrer` | 2 |
| 2 | Runtime heuristics #19-24 via 5-min branch in `dialer/src/main.ts`; emit to `event_log`/`alerts` | 1.5 |
| 3 | Post-call LLM via seeded `analysis_policies` + `alert_rules` (`language_match`, `script_coverage`) | 1 |
| 4 | LLM preflight (#14-16), cached 24h per `agent_id+script_id`, warnings in wizard step 3 | 2 |
| 5 | Daily aggregate (#27, #30) — nightly tick → digest in `event_log`; copilot summarises | 1.5 |

Total **~8 dev days**. Wave 1 alone is the killer demo.

---

## Risks

- **False positives.** Statistical rules (#11, #21-24) only ever `warn`; only deterministic config errors block. Rule #11 (DNC) would otherwise block legit re-engagement of opted-in past customers.
- **LLM hallucinations** on #14-16: mitigate with `temperature=0`, JSON schema with `confidence`, drop findings <0.7 — same pattern as `analysis-runner.ts:114`.
- **Latency on `GET /api/campaigns`.** Cache findings in `campaigns.metadata.sentinel` with `last_checked_at`; recompute on PATCH or every 10 min.
- **No web-app cron.** `web/vercel.json` has no `crons` block — Wave 2 must extend `dialer/src/main.ts`'s `setInterval` rather than introducing Vercel Cron.
- **`exec_sql_admin` not provisioned** (`tools.ts:111`) — sentinels must use the typed Supabase client, not raw RPC.

---

## Recommendation

**Ship Wave 1 immediately, Wave 2 same sprint, defer 3-5 until OCC has been live two weeks.** The killer use case for OCC this week is rules #1, #2, #6, #9, #18: an OCC manager creates an NHS follow-up campaign, forgets to upload contacts or leaves the schedule empty, clicks Démarrer, sees nothing happen. Wave 1 turns that silent failure into "3 erreurs bloquantes : aucune cible importée, aucun jour activé, voix non sélectionnée." Two days of work, zero recurring cost, removes the most expensive support burden for a non-technical launch tenant. LLM sentinels are pure upside on top.

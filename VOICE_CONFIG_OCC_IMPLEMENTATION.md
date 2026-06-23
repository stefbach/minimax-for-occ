# OCC Voice Configuration - Implementation Instructions

## Current Issue

The greeting "Hi, is that {{firstname}}?" sounds **high-pitched, excited, robotic** especially with:
- ElevenLabs Flash (prosody over-emphasizes short isolated questions)
- Default settings (tts_style=1.0 for maximum expressiveness)

## Solution: Greeting Text + Voice Settings Fix

### Step 1: Update Greeting Text in Supabase

**SQL Command**:
```sql
-- Update ALL OCC agents to use the new greeting
UPDATE agents 
SET greeting = 'Hi, am I speaking with {{firstname}}?'
WHERE org_id = 'YOUR_ORG_ID'  -- Replace with actual OCC org_id
  AND greeting ILIKE '%Hi, is that%';
```

**Manual Supabase Studio Update**:
1. Log in to Supabase Dashboard → Your Project
2. Navigate to `auth` → `organizations` to find OCC's org_id
3. Go to `agents` table
4. Filter for agents with greeting containing "Hi, is that"
5. Edit each agent's `greeting` column to: `Hi, am I speaking with {{firstname}}?`
6. Save

**Expected Agents to Update** (OCC):
- Charlotte
- Isabelle
- Victoria

---

### Step 2: Configure TTS Voice Settings

Choose ONE of the three options below and apply to ALL agents:

#### **Option A: Cartesia Sonic-3.5 (RECOMMENDED)**

**Why**: Native telephony support, balanced emotion tone prevents high-pitch.

```sql
UPDATE agents 
SET 
  tts_voice_id = '<cartesia-uuid>',  -- Get from play.cartesia.ai
  tts_model = 'sonic-3.5',
  tts_language = 'en',
  tts_emotion = 'balanced',
  tts_speed = 0.95,
  tts_volume = 1.0
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**Voice Selection Guide**:
- Browse at: https://play.cartesia.ai (create free account)
- Listen to each voice and copy its UUID
- Recommended: Charlotte, Sarah, or Oliver for professional tone
- **Avoid**: Voices labeled "bright", "energetic", "excited" (these are higher-pitched)

---

#### **Option B: ElevenLabs Flash (FASTEST)**

**Why**: WebSocket streaming, ~75ms TTFB (fastest), but needs careful config to avoid high-pitch.

**Critical**: Set `tts_style = 0.5` (NOT default 1.0)

```sql
UPDATE agents 
SET 
  tts_voice_id = 'elevenlabs:flash:rachel',  -- Format required
  tts_stability = 0.5,
  tts_similarity_boost = 0.75,
  tts_style = 0.5,                           -- CRITICAL: prevents "excited" tone
  tts_speaker_boost = FALSE,
  tts_speed = 0.95
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**ElevenLabs Voice Options**:
```
Family: flash (default, English-optimized)
Voices:
  - rachel   (warm, professional) ← Recommended
  - bella    (friendly)
  - adam     (calm, male)
  - emily    (bright - may still sound high-pitched)
```

**If Still Sounds High-Pitched**:
```sql
UPDATE agents 
SET tts_style = 0.3  -- Lower from 0.5
WHERE tts_voice_id LIKE 'elevenlabs:flash:%';
```

---

#### **Option C: MiniMax (COST-EFFECTIVE)**

**Why**: Competitive latency (~80ms), lower cost than ElevenLabs, good English support.

```sql
UPDATE agents 
SET 
  tts_voice_id = 'minimax:speech-01-240822:female-1',  -- Format required
  tts_emotion = 'default',
  tts_pitch = 0,
  tts_volume = 1.0,
  tts_speed = 0.95,
  tts_english_normalization = TRUE  -- Important for UK English
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**MiniMax Voice Options**:
```
Model: speech-01-240822
Voices:
  - female-1  (warm, professional) ← Recommended
  - female-2  (bright - may sound high-pitched)
  - male-1    (calm)
```

---

### Step 3: Configure LLM Provider

Choose ONE option:

#### **Option A: Claude + Prompt Caching (BEST QUALITY)**

```sql
UPDATE agents 
SET 
  llm_provider = 'anthropic',
  llm_model = 'claude-haiku-4-5-20251001'
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**Cost**: ~$0.80 per 1M cached tokens (10x cheaper than fresh)

**Latency**: 
- Cold: ~400-600ms TTFT
- Warm (cached): ~150-200ms TTFT

**Requirements**:
- `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` env var on worker
- (Already implemented in agent.py line ~281: `caching="ephemeral"`)

---

#### **Option B: OpenAI gpt-4o-mini (FAST COLD-START)**

```sql
UPDATE agents 
SET 
  llm_provider = 'openai',
  llm_model = 'gpt-4o-mini'
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**Latency**: 
- Cold: ~300-500ms TTFT
- Warm (request-cached): ~100-150ms TTFT

**Requirements**:
- `OPENAI_API_KEY` env var on worker

---

#### **Option C: DeepSeek (COST-OPTIMIZED, DEFAULT)**

```sql
UPDATE agents 
SET 
  llm_provider = 'deepseek',
  llm_model = 'deepseek-v4-flash'
WHERE org_id = 'YOUR_ORG_ID' AND name IN ('Charlotte', 'Isabelle', 'Victoria');
```

**Cost**: ~$0.07 per 1M tokens (10x cheaper than OpenAI)

**Latency**: 
- Variable: 400-800ms TTFT (depends on API load)
- No caching

**Requirements**:
- `DEEPSEEK_API_KEY` env var on worker (already configured)

---

### Step 4: Recommended Complete Configuration for OCC

**Best Voice Quality + Latency Balance**:

```sql
-- Charlotte (Cartesia + Claude)
UPDATE agents 
SET 
  greeting = 'Hi, am I speaking with {{firstname}}?',
  tts_voice_id = '<uuid-from-play.cartesia.ai>',
  tts_model = 'sonic-3.5',
  tts_language = 'en',
  tts_emotion = 'balanced',
  tts_speed = 0.95,
  llm_provider = 'anthropic',
  llm_model = 'claude-haiku-4-5-20251001'
WHERE name = 'Charlotte' AND org_id = 'YOUR_ORG_ID';

-- Isabelle (ElevenLabs + OpenAI)
UPDATE agents 
SET 
  greeting = 'Hi, am I speaking with {{firstname}}?',
  tts_voice_id = 'elevenlabs:flash:rachel',
  tts_stability = 0.5,
  tts_similarity_boost = 0.75,
  tts_style = 0.5,
  tts_speaker_boost = FALSE,
  tts_speed = 0.95,
  llm_provider = 'openai',
  llm_model = 'gpt-4o-mini'
WHERE name = 'Isabelle' AND org_id = 'YOUR_ORG_ID';

-- Victoria (MiniMax + DeepSeek)
UPDATE agents 
SET 
  greeting = 'Hi, am I speaking with {{firstname}}?',
  tts_voice_id = 'minimax:speech-01-240822:female-1',
  tts_emotion = 'default',
  tts_pitch = 0,
  tts_volume = 1.0,
  tts_speed = 0.95,
  tts_english_normalization = TRUE,
  llm_provider = 'deepseek',
  llm_model = 'deepseek-v4-flash'
WHERE name = 'Victoria' AND org_id = 'YOUR_ORG_ID';
```

---

## Step 5: Verify Configuration

### Test Call Checklist

After updating Supabase, make a test call and verify:

- [ ] **Greeting sounds natural**: Not high-pitched, not robotic
- [ ] **Greeting is clear**: Proper English pronunciation of name
- [ ] **No latency jump**: Greeting flows naturally after call answers
- [ ] **Follow-up response is quick**: <500ms TTFT (cold) or <200ms (warm)
- [ ] **Overall call quality**: No audio artifacts, natural conversation flow

### Database Verification

Verify your changes were saved:
```sql
SELECT 
  name, 
  greeting, 
  tts_voice_id, 
  tts_model, 
  tts_emotion,
  tts_style,
  llm_provider, 
  llm_model 
FROM agents 
WHERE org_id = 'YOUR_ORG_ID'
ORDER BY name;
```

---

## Step 6: Production Rollout

### A/B Test (Recommended)

1. **Control**: Keep 50% of calls on existing config (old greeting + voice)
2. **Test**: Send 50% to new config (new greeting + voice settings)
3. **Measure** (1 week):
   - Call completion rate (same or higher)
   - Patient satisfaction (NPS, manual listen tests)
   - Agent-perceived voice naturalness
4. **Decision**: If test wins, roll to 100%

### Full Rollout

If you're confident in the configuration:
1. Run all UPDATE statements in one batch
2. Monitor first 20 calls for any issues
3. Check agent logs for errors: `grep -i "TTS\|elevenlabs\|cartesia" logs/`
4. If major issue found, rollback greeting to previous value

---

## Troubleshooting

### Greeting Still Sounds High-Pitched

**If using ElevenLabs**:
```sql
-- Reduce expressiveness further
UPDATE agents 
SET tts_style = 0.2  -- Down from 0.5
WHERE tts_voice_id LIKE 'elevenlabs:flash:%';
```

**If using Cartesia**:
```sql
-- Switch emotion to "calm"
UPDATE agents 
SET tts_emotion = 'calm'  -- From "balanced"
WHERE tts_voice_id LIKE '%cartesia%';
```

**If using MiniMax**:
```sql
-- Lower pitch by 3 semitones
UPDATE agents 
SET tts_pitch = -3  -- From 0
WHERE tts_voice_id LIKE 'minimax:%';
```

### Greeting Sounds Too Slow

- Check `tts_speed`: If <0.9, increase to 0.95
- Switch TTS provider: ElevenLabs (75ms TTFB) > Cartesia (90ms) > MiniMax (90ms)

### First Response Takes >2 Seconds

- **If using Claude**: Cache should warm automatically. Check logs for cache miss.
- **If using OpenAI**: Cold-start is normal (~300-500ms). Subsequent turns faster.
- **If using DeepSeek**: Variable TTFT (400-800ms) is expected. Profile specific turns in logs.

### Agent Name Not Rendered (Shows {{firstname}} in audio)

- Check template_vars passed to greeting render
- Verify `contacts.attributes` has `nom` or `firstname` field
- Test with manual SQL query on leads_rdv table

---

## Monitoring & Metrics

### Key Metrics to Log

In your call logs, track:

```
greeting_tts_ttfb_ms: <latency to first byte>
greeting_audio_duration_s: <total greeting length>
first_response_ttft_ms: <LLM generation latency>
call_quality_score: <1-5 based on manual listen>
agent_voice_preset: <which config: cartesia|elevenlabs|minimax>
```

### Healthy Baseline

```
greeting_tts_ttfb_ms:     75-90 ms (ElevenLabs/MiniMax) or 90-100 (Cartesia)
greeting_audio_duration:  3-4 seconds
first_response_ttft_ms:   <300 ms (OpenAI cold) or <200 ms (Claude/warm)
call_quality_score:       >=4.5 (naturalness)
```

---

## Appendix: Finding Your OCC org_id

```sql
-- In Supabase, run this query to find your org_id
SELECT id, slug, name 
FROM organizations 
WHERE name ILIKE '%obesity%' OR name ILIKE '%occ%'
LIMIT 5;
```

Typical result:
```
id                          | slug        | name
---------------------------------------------------
xxxxxxx-xxxxx-xxxxx-xxxxx   | occ-main    | Obesity Care Clinic
```

Use the `id` value in all queries above.

---

## Support

If any configuration fails:
1. Check agent logs: `Vercel Logs → Functions → agent-worker` (cloud)
2. Search for `TTS initialization failed` or `elevenlabs direct init failed`
3. Verify env vars are set: `CARTESIA_API_KEY`, `ELEVEN_API_KEY`, `ANTHROPIC_API_KEY`
4. Test with a single agent first before rolling to all


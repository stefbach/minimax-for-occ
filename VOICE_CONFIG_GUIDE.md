# OCC Voice Configuration Guide - Multi-Provider Setup

## Overview

This guide provides definitive voice configurations for all TTS + LLM combinations across Cartesia, ElevenLabs, Minimax and OpenAI/Claude for English-language UK calls (OCC prospection). The configuration addresses both voice quality (avoiding high-pitched/roboticized greeting) and latency optimization.

## Architecture

```
Voice Pipeline
├── LLM (generates text response)
│   ├── OpenAI (gpt-4o-mini)
│   ├── Claude (claude-haiku-4-5-20251001)
│   └── DeepSeek (deepseek-v4-flash, default)
│
└── TTS (synthesizes speech)
    ├── ElevenLabs (WebSocket, ~75ms TTFB)
    ├── Cartesia Sonic-3.5 (native, ~90ms TTFB)
    ├── MiniMax (SSE, ~75-90ms TTFB)
    └── STT: AssemblyAI u3-rt-pro (EU endpoint, ~100-200ms)
```

## Part 1: TTS Provider Selection

### Cartesia Sonic-3.5 (Recommended Default)

**Why**: Consistent voice quality across short and long utterances, native 8kHz support for telephony, ~90ms TTFB.

**Config Format**:
```python
agents table:
  tts_voice_id: <cartesia-uuid>  # Browse at play.cartesia.ai
  tts_model: "sonic-3.5"          # Default
  tts_language: "en"              # Force English for UK calls
  tts_emotion: "balanced"         # Avoid extremes (friendly, surprised, etc)
  tts_speed: 0.95                 # Slightly slower = more natural, less robotic
  tts_volume: 1.0                 # Default
```

**Why These Settings Avoid High-Pitched Voice**:
- `tts_emotion: "balanced"`: Cartesia's emotion field shifts pitch/energy. Extremes (excited, bright) = higher pitch. Balanced = neutral tone.
- `tts_speed: 0.95`: Slightly slower speech = lower perceived pitch + more natural prosody. Speed 1.0-1.1 sounds rushed and tinny.
- `tts_language: "en"`: Forces UK English prosody (critical for "Hi, am I speaking with {{firstname}}?" to not sound like an American IVR).

**Sample Voices** (test both at play.cartesia.ai):
- Sarah (uuid) - bright, energetic
- Charlotte (uuid) - warm, professional
- Oliver (uuid) - calm, measured

**Latency Impact**: ~90ms TTFB + streaming native 8kHz = 4-6s total for greeting.

---

### ElevenLabs (WebSocket Direct - Low Latency)

**Why**: Fastest TTFB (~75ms), WebSocket streaming reduces perceived latency.

**Config Format**:
```python
agents table:
  tts_voice_id: "elevenlabs:flash:rachel"  # Format: elevenlabs:<family>:<voice_id>
  tts_model: None                           # Plugin sets model_id based on family
  tts_stability: 0.5                        # DEFAULT = neutral
  tts_similarity_boost: 0.75                # DEFAULT = natural variations
  tts_style: 0.5                            # MEDIUM = balanced (avoid 0 = robotic, 1 = overly expressive)
  tts_speaker_boost: False                  # Adds nasality, skip
  tts_speed: 0.95                           # Same as Cartesia - slower = natural
```

**Families (choose one)**:
- `flash`: Turbo replacement, faster, good for greeting (~75ms). **DEFAULT for new calls.**
- `turbo`: More stable prosody (~100-110ms), better for long explanations.
- `multilingual`: Handles FR/EN, slower, use only if multilingual needed.

**Why These Settings Avoid High-Pitched Voice**:
- Family = `flash` NOT `multilingual`: Flash is English-optimized, no pitch distortion.
- `tts_style: 0.5`: This is THE critical knob. ElevenLabs Flash's problem (from the summary: "sa voix est aigue, existée") is that the plugin defaults to style=1.0 (overly expressive), which emphasizes short questions. Setting style=0.5 = neutral.
- `tts_stability: 0.5`: Neutral, allows natural variation. 0.75+ = robotic consistency.
- `tts_similarity_boost: 0.75`: Let the voice vary naturally; don't lock it to the base.

**Sample Voices**:
- rachel: warm, professional (recommended for greetings)
- bella: friendly
- adam: calm male

**Latency Impact**: ~75ms TTFB + WebSocket streaming = 3-4s for greeting (fastest).

---

### MiniMax Direct SSE (Moderate Latency, Good Quality)

**Why**: Competitive TTFB (~75-90ms), native English support, lower cost than ElevenLabs.

**Config Format**:
```python
agents table:
  tts_voice_id: "minimax:speech-01-240822:female-1"  # Format: minimax:<model>:<voice>
  tts_model: None                                      # Not used; voice_id sets model
  tts_emotion: "default"                              # Or: positive, sad (avoid extremes)
  tts_pitch: 0                                         # DEFAULT = neutral (-12 to 12)
  tts_volume: 1.0                                      # DEFAULT
  tts_speed: 0.95                                      # Same as others
  tts_english_normalization: True                     # Respect English phonetics
```

**Voice Selection**:
- `female-1`: Warm, professional
- `female-2`: Bright (can sound high-pitched)
- `male-1`: Calm, measured

**Why These Settings Avoid High-Pitched Voice**:
- `tts_emotion: "default"`: Avoids "bright", "excited" which shift pitch up.
- `tts_pitch: 0`: Neutral. Only adjust if voice still sounds off (-2 to -4 = slightly lower).
- `tts_english_normalization: True`: Ensures "Rachel", "PhD", "St. Mary's" are pronounced correctly (not spelled out).

**Latency Impact**: ~75-90ms TTFB + SSE streaming = 4-5s for greeting.

---

## Part 2: Critical Greeting Configuration

### Greeting Text Template

**Current (High-Pitched Issue)**:
```
"Hi, is that {{firstname}}?"
```
Problem: Short isolated question heavily emphasized by ElevenLabs Flash's prosody.

**Fixed (Recommended)**:
```
"Hi, am I speaking with {{firstname}}?"
```
Why:
1. Longer sentence = more stable prosody (Flash handles multi-word sentences better).
2. Declarative opening ("Hi, am I speaking") + question tag = natural phone greeting cadence.
3. No peak emphasis on short "is that" phrase.

**Alternative** (if still sounds high-pitched):
```
"Hi there. Am I speaking with {{firstname}}?"
```
Break into two sentences = two voice spans = better prosody management.

### Where to Update Greeting

**Supabase UI Path**:
1. Navigate to agents table
2. Find agent rows (Charlotte, Isabelle, Victoria, etc.)
3. Edit `greeting` column
4. Change to: `Hi, am I speaking with {{firstname}}?`
5. Save

**Code Path** (if hardcoding):
- `agent_config.py` line 65-68: DEFAULT_GREETING constant
- `agent.py` uses `axon.greeting` loaded from Supabase (no code changes needed unless using defaults)

---

## Part 3: LLM Configuration & Cache Warming

### Provider Selection

#### OpenAI (gpt-4o-mini)
- Fast (~300-500ms TTFT cold, ~100-150ms warm)
- Good English understanding
- Best for simultaneous multi-call speed

**Config**:
```python
agents table:
  llm_provider: "openai"
  llm_model: "gpt-4o-mini"
```

#### Claude (claude-haiku-4-5-20251001)
- ~400-600ms TTFT cold, ~150-200ms warm
- Excellent instruction following
- **Supports prompt caching** (ephemeral) = 0.1x cost on cached tokens

**Config**:
```python
agents table:
  llm_provider: "anthropic"
  llm_model: "claude-haiku-4-5-20251001"
```

**In agent.py** (already implemented):
```python
if provider == "anthropic":
    return _build_llm_with_max_tokens(
        anthropic.LLM,
        max_tokens,
        model=anth_model,
        api_key=anth_key,
        caching="ephemeral",  # ← ACTIVE: warms on system prompt + tools
    )
```

#### DeepSeek (deepseek-v4-flash) - DEFAULT
- Cheapest (~$0.07 per 1M tokens)
- ~400-800ms TTFT (variable, see logs)
- No prompt caching
- Best for high-volume, cost-sensitive campaigns

**Config**:
```python
agents table:
  llm_provider: "deepseek"
  llm_model: "deepseek-v4-flash"
```

### Cache Warming Strategy

**Problem**: Cold TTFT (first call of the worker) = 1252ms = agent sounds slow.

**Solution**: Pre-warm cache by sending the system prompt + tools metadata BEFORE the greeting.

**Implementation** (in agent.py, line ~3460):
```python
# BEFORE session.start(), warm the LLM cache
if llm_provider == "anthropic":
    try:
        # Anthropic caching is ephemeral (per-request). The prompt is cached
        # when the first streaming call arrives. Trigger cache population
        # before greeting to move the cold-start latency into the background.
        import asyncio
        # Queue a background cache-warm without awaiting (don't block greeting)
        asyncio.create_task(_warm_claude_cache(llm, instructions))
    except Exception:
        clog.debug("claude cache warm failed", exc_info=True)

async def _warm_claude_cache(llm, instructions: str) -> None:
    """Trigger Claude cache population with system prompt + tools.
    Non-blocking; fires in background while greeting plays."""
    try:
        # Send a minimal prompt that forces cache creation without
        # generating audible output. The cache persists for subsequent turns.
        await llm.agenerate("acknowledge this", system=instructions)
    except Exception:
        pass  # Fail silently; cache warming is best-effort
```

**Expected Result**:
- First turn after greeting: TTFT ~150-200ms (cached) instead of 1252ms.
- Greeting plays while cache warms = user doesn't perceive latency.

---

## Part 4: Complete Configuration Examples

### Example 1: Cartesia + Claude (Best Quality + Cost)

```yaml
Agent: Charlotte
tts_voice_id: "<cartesia-charlotte-uuid>"
tts_model: "sonic-3.5"
tts_language: "en"
tts_emotion: "balanced"
tts_speed: 0.95
tts_volume: 1.0

llm_provider: "anthropic"
llm_model: "claude-haiku-4-5-20251001"

greeting: "Hi, am I speaking with {{firstname}}?"
voice_style: "warm, professional, conversational"
```

**Latency Profile**:
- Greeting TTFB: ~90ms (Cartesia)
- Greeting audio: ~3-4s
- First response TTFT: ~150-200ms (cached)
- Total 1st exchange: ~4-5s ✓

---

### Example 2: ElevenLabs Flash + OpenAI (Fastest)

```yaml
Agent: Isabelle
tts_voice_id: "elevenlabs:flash:rachel"
tts_stability: 0.5
tts_similarity_boost: 0.75
tts_style: 0.5          # CRITICAL: prevents high-pitched "excited" tone
tts_speaker_boost: False
tts_speed: 0.95

llm_provider: "openai"
llm_model: "gpt-4o-mini"

greeting: "Hi, am I speaking with {{firstname}}?"
voice_style: "friendly, professional, clear"
```

**Latency Profile**:
- Greeting TTFB: ~75ms (ElevenLabs WebSocket)
- Greeting audio: ~3-4s
- First response TTFT: ~300-500ms (cold) or ~100-150ms (warm)
- Total 1st exchange: ~4-5s ✓

---

### Example 3: MiniMax + DeepSeek (Cost-Optimized)

```yaml
Agent: Victoria
tts_voice_id: "minimax:speech-01-240822:female-1"
tts_emotion: "default"
tts_pitch: 0
tts_volume: 1.0
tts_speed: 0.95
tts_english_normalization: True

llm_provider: "deepseek"
llm_model: "deepseek-v4-flash"

greeting: "Hi, am I speaking with {{firstname}}?"
voice_style: "calm, professional, measured"
```

**Latency Profile**:
- Greeting TTFB: ~80ms (MiniMax SSE)
- Greeting audio: ~3-4s
- First response TTFT: ~400-800ms (variable)
- Total 1st exchange: ~5-7s (slower on first call)

---

## Part 5: Latency Optimization Checklist

- [ ] **STT**: AssemblyAI u3-rt-pro, EU endpoint → ~100-200ms roundtrip
- [ ] **TTS TTFB**: Use ElevenLabs Flash (~75ms) or Cartesia (~90ms) for greeting
- [ ] **LLM Cold-Start**: Pre-warm cache before greeting (Claude ephemeral cache)
- [ ] **LLM Max Tokens**: Set to 150 (line ~260) to cap response length
- [ ] **Greeting Speed**: tts_speed=0.95 to reduce perceived latency
- [ ] **VAD**: Silero multilingual (lightweight) or English model
- [ ] **Turn Detection**: English model (`TURN_DETECTOR="english"` env) not multilingual

---

## Part 6: Implementation Steps

### Step 1: Update Greeting Text

**For all agents in Supabase** (Charlotte, Isabelle, Victoria, etc.):
```sql
UPDATE agents 
SET greeting = 'Hi, am I speaking with {{firstname}}?'
WHERE org_id = 'occ_org_id'
  AND greeting LIKE 'Hi, is that%';
```

### Step 2: Choose One TTS Provider Configuration

Pick ONE of:
- **Cartesia (recommended)**: Balanced, reliable, native telephony
- **ElevenLabs Flash**: Fastest TTFB, needs tts_style=0.5
- **MiniMax**: Cheaper, needs tts_english_normalization=True

Apply to all agents.

### Step 3: Choose One LLM Provider

For OCC campaigns:
- **Claude + Cartesia**: Best voice quality (Cartesia balanced emotion)
- **OpenAI + ElevenLabs**: Fastest cold-start
- **DeepSeek + MiniMax**: Most cost-efficient

### Step 4: Monitor & Adjust

**Metrics to track**:
- `greeting_tts_ttfb`: Should be 75-90ms
- `first_response_ttft`: Should be <300ms (cached) or ~500ms (cold)
- `call_quality_scores`: Listen to 5-10 calls, note voice pitch/naturalness

**If still high-pitched**:
1. Cartesia: Lower tts_emotion severity (balanced → calm)
2. ElevenLabs: Drop tts_style from 0.5 → 0.3
3. MiniMax: Adjust tts_pitch -2 to -4

**If too slow**:
1. Switch to ElevenLabs Flash
2. Implement cache warming for Claude
3. Profile STT latency (should be ~100ms EU, not 800ms)

---

## Part 7: Deployment Checklist

- [ ] Greeting updated: "Hi, am I speaking with {{firstname}}?"
- [ ] TTS voice IDs set on all agents (Cartesia UUIDs or elevenlabs:/minimax: prefix)
- [ ] TTS emotion/style/pitch settings configured (matching provider)
- [ ] LLM provider selected (anthropic, openai, or deepseek)
- [ ] Cache warming enabled (if using Claude)
- [ ] AssemblyAI EU endpoint configured (env: ASSEMBLYAI_BASE_URL=wss://streaming.eu.assemblyai.com)
- [ ] TTFB metrics logged and monitored
- [ ] 5+ test calls completed to verify no high-pitched greeting
- [ ] Production rollout scheduled

---

## Appendix: Environment Variables (Advanced)

```bash
# LLM Selection Overrides (emergency: bypass DB config)
LLM_PROVIDER_FORCE=anthropic          # Force all calls to Claude
LLM_MODEL_FORCE=claude-haiku-4-5      # Force specific model
LLM_MAX_COMPLETION_TOKENS=150         # Cap response length

# Cartesia (default TTS)
CARTESIA_VOICE_ID=<uuid>              # Override all agents
CARTESIA_LANGUAGE=en                  # Force English
CARTESIA_MODEL=sonic-3.5              # (default)

# ElevenLabs (if using direct WebSocket)
ELEVEN_API_KEY=sk_...                 # Required

# MiniMax (if using direct SSE)
MINIMAX_API_KEY=key-...               # Required
MINIMAX_BASE_URL=https://api.minimax.io/v1

# AssemblyAI STT
ASSEMBLYAI_API_KEY=...
ASSEMBLYAI_BASE_URL=wss://streaming.eu.assemblyai.com  # EU endpoint
ASSEMBLYAI_MODEL=u3-rt-pro            # Latest model
ASSEMBLYAI_LANGUAGE=en                # Force English
ASSEMBLYAI_EOT_THRESHOLD=0.3          # Faster EOU detection
ASSEMBLYAI_MIN_TURN_SILENCE=100       # 100ms minimum silence

# Greeting Tuning
GREETING_ON_ANSWER_CAMPAIGN_IDS=campaign-id-1,campaign-id-2  # A/B mode
GREETING_PREROLL_SECONDS=0.3          # Tiny pre-roll before greeting
GREETING_WAIT_FOR_SPEECH_SECONDS=3    # Wait 3s for patient to speak before agent greets
```

---

## References

- **ElevenLabs Voice Settings**: https://elevenlabs.io/docs/api-reference/text-to-speech#voice-settings
- **Cartesia API**: https://cartesia.ai/docs
- **AssemblyAI Real-Time STT**: https://www.assemblyai.com/docs/speech-to-text
- **LiveKit Agents Framework**: https://docs.livekit.io/agents/


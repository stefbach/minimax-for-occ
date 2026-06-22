# Voice Agent Latency Tuning Guide

This document explains the latency components in the voice agent and how to tune them for your use case.

## Current Latency Baseline (Post-Optimization)

After implementing LLM connection warmup and turn-detector improvements, typical latency components are:

| Component | Latency | Notes |
|-----------|---------|-------|
| LLM TTFT (Time to First Token) | 800-900ms | Improved from ~1755ms via post-greeting warmup |
| STT EOU detection (VAD) | 550-600ms | Reduced min_turn_silence from 100→75ms |
| Turn-handling VAD delay | 300ms | Reduced min_endpointing_delay from 0.35→0.30s |
| STT-to-LLM pipeline | 100-150ms | Network/processing overhead |
| TTS TTFB (Time to First Byte) | 115-260ms | ElevenLabs telephony |
| **Total perceived silence** | ~1-1.5s | After patient finishes speaking |

## Tuning Parameters

### 1. Turn Detector Mode (Biggest Impact)

Controls how the agent detects end-of-user-speech (EOU).

**Default: `vad` (Voice Activity Detection)**
- Fast: ~600ms EOU latency
- CPU-light
- Risk: Can cut off natural pauses >300ms

**Options via `campaign.metadata.call_tuning.turn_detector`:**

```json
{
  "turn_detector": "vad"          // VAD-only, fastest, lower CPU
  "turn_detector": "english"      // Semantic English model, saves ~300ms
  "turn_detector": "multilingual" // Transformer-based, 1-2s slower per turn
}
```

Or via environment variable: `TURN_DETECTOR=english`

### 2. STT Endpointing Thresholds

Control how quickly AssemblyAI (u3-rt-pro) declares the user has finished speaking.

**Per-campaign override in `campaign.metadata.call_tuning`:**
```json
{
  "min_turn_silence": 75,      // Silence threshold before EOU (ms). Default 75, was 100
  "max_turn_silence": 350,     // Force EOU after N ms (ms). Default 350, was 400
  "eot_threshold": 0.3         // Confidence threshold for EOU (0-1). Default 0.3
}
```

**Tuning strategy:**
- `min_turn_silence: 75→60ms`: Save ~15ms, but higher risk of cutting mid-sentence
- `eot_threshold: 0.3→0.2`: More aggressive, but lower confidence predictions
- `max_turn_silence: 350→300ms`: Tighter bounding of worst-case latency

**Via environment variables:**
- `ASSEMBLYAI_MIN_TURN_SILENCE=60`
- `ASSEMBLYAI_MAX_TURN_SILENCE=300`
- `ASSEMBLYAI_EOT_THRESHOLD=0.2`

### 3. Turn-Handling Delay

How long the VAD waits after silence to commit the turn.

**Per-campaign in `campaign.metadata.call_tuning`:**
```json
{
  "min_endpointing_delay": 0.30  // Silence buffer before turn commit (s). Default 0.30, was 0.35
}
```

**Via environment variable:** `MIN_ENDPOINTING_DELAY=0.25`

**Tuning strategy:**
- `0.30→0.25s`: Save 50ms, safer margin for natural pauses
- `0.30→0.20s`: Save 100ms, risky (fragments speech like "Megan, Claudia, Kenneth")
- Stay above ~0.15s in production

### 4. Interruption Handling

How long the patient must speak before interrupting the agent.

```json
{
  "min_interruption_duration": 0.8  // Patient speech duration to interrupt agent (s)
}
```

**Via environment variable:** `MIN_INTERRUPTION_DURATION=0.8`

## Tuning Recipes

### Conservative (Safest, Lowest Risk)
Use the current defaults — good balance for production.

### Moderate (Recommended for Latency)
Apply these settings to a test campaign:

```json
{
  "call_tuning": {
    "turn_detector": "english",
    "min_turn_silence": 75,
    "max_turn_silence": 350,
    "min_endpointing_delay": 0.30,
    "eot_threshold": 0.3
  }
}
```

**Expected improvement:** ~300-400ms latency reduction vs default VAD

### Aggressive (Experimental, High Risk)

```json
{
  "call_tuning": {
    "turn_detector": "english",
    "min_turn_silence": 60,
    "max_turn_silence": 300,
    "min_endpointing_delay": 0.25,
    "eot_threshold": 0.2
  }
}
```

**Expected improvement:** ~500-600ms latency reduction vs default VAD
**Risks:** May fragment speech, cut off pauses, lower confidence predictions

## Diagnostics: Measuring Latency

1. **In logs**, search for these messages:
   - `turn_detection=` → shows which detector is active
   - `min_endpointing_delay=` → shows VAD buffer
   - `STT=` → shows transcriber model

2. **In metrics** (Vercel/Datadog), track:
   - `agent.turn.end_of_user_speech_latency` → EOU detection time
   - `agent.turn.tts_generation_time` → TTS production time
   - End-to-end perceived silence = LLM-TTFT + STT-EOU + TTS-TTFB

3. **Manual testing** with logs:
   ```bash
   # On Fly logs, watch for timestamps
   user_speech_ended_at: 12.345s
   llm_first_token_at: 13.150s        # Add 0.5s for TTS startup
   agent_speaking_at: 13.650s
   
   # Perceived silence = 13.650 - 12.345 = 1.305s
   ```

## Known Tradeoffs

| Tuning | Benefit | Risk |
|--------|---------|------|
| Lower `min_turn_silence` | Faster EOU | Cut off pauses, "comma splices" |
| Lower `min_endpointing_delay` | Faster turn handoff | More latency-sensitive to variances |
| `turn_detector="english"` | -300ms latency | +CPU load, needs EnglishModel available |
| Lower `eot_threshold` | More sensitive | Lower confidence, potential false positives |

## Implementation Notes

- All tuning parameters support **per-campaign overrides** in `campaigns.metadata.call_tuning`
- Per-campaign settings override **environment variables**
- Environment variables override **hard-coded defaults**
- Agent-level fallback: `agents.metadata.call_tuning` (for single-agent testing)

## LLM Connection Warmup

Post-greeting warmup task (fires immediately after greeting completes) keeps the inference socket warm, reducing cold-start TTFT from ~1750ms to ~800-900ms.

**Enabled by default.** Disable via `LLM_SESSION_WARMUP=off` if connection pooling is handled upstream.

## Next Steps for Further Optimization

1. **Stream LLM responses** → Start speaking while still generating (architecture change)
2. **Optimize TTS buffering** → Reduce TTFB below 115ms (provider-dependent)
3. **Parallel LLM+TTS** → Queue TTS while LLM is still generating (advanced)
4. **Provider selection** → Test alternative STT/LLM providers for lower latency
5. **Regional routing** → Ensure audio/inference run in same region as patient

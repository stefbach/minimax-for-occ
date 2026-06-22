"""ElevenLabs T2A — direct API in native telephony format (ulaw_8000).

Why this exists (Wati 22/06):
    The official `livekit-plugins-elevenlabs` plugin can only emit pcm_16000
    or higher — it has NO 8 kHz output. On a Twilio SIP leg (G.711 µ-law
    8 kHz, non-negotiable for PSTN) that forces LiveKit to resample
    16 kHz → 8 kHz on every frame, which produced two field-reported
    defects on real calls:
      • "bruit de froissement" — the 32 KB/s pcm_16000 WebSocket underran
        ("inference is slower than realtime" in the worker logs); the
        realtime buffer starved and clicked at the frame joints.
      • "la voix a hurlé" — a mid-call WebSocket reconnect came back at a
        different output rate than the leg expected, so audio played too
        fast = a high-pitched scream.

    Retell makes ElevenLabs sound perfect on the SAME Twilio number because
    it does NOT use the LiveKit plugin: it asks the ElevenLabs API directly
    for `ulaw_8000` (the native Twilio codec) and pipes it straight through.
    This adapter reproduces exactly that:
      • output_format=ulaw_8000 → native 8 kHz, ZERO resampling.
      • µ-law is 8 KB/s on the wire — 4× lighter than pcm_16000, so the
        realtime buffer never starves (kills the crackle).
      • a fresh HTTP streaming request PER utterance — no long-lived
        WebSocket to reconnect (kills the screaming).
    We decode µ-law → PCM16 locally with a precomputed G.711 table (zero
    third-party deps, negligible CPU) and push PCM16 @ 8 kHz to LiveKit,
    which then re-encodes to µ-law for Twilio with no rate change.

This adapter is used ONLY on the telephony leg (sample_rate ≤ 16000). The
web/preview path keeps the official plugin (mp3/16 kHz, higher fidelity,
no 8 kHz constraint) — see `_tts_for` in agent.py.

Voice id format used across the platform: `elevenlabs:<family>:<voice>`
    elevenlabs:flash:HE0XlnHeqQoWUBWhwUa3
    elevenlabs:turbo:Rachel
    elevenlabs:multilingual:<voice_id>

Required env:
    ELEVEN_API_KEY (or ELEVENLABS_API_KEY) — ElevenLabs API key.
    ELEVENLABS_BASE_URL — defaults to https://api.elevenlabs.io
"""

from __future__ import annotations

import asyncio
import logging
import os
import struct
from dataclasses import dataclass
from typing import Optional

import aiohttp
from livekit.agents import APIConnectOptions, APITimeoutError, tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

logger = logging.getLogger("elevenlabs-tts")

_DEFAULT_BASE = "https://api.elevenlabs.io"

# family fragment → ElevenLabs model_id. Mirrors the mapping in agent._tts_for
# so the custom telephony path and the official web path agree on the model.
_FAMILY_TO_MODEL = {
    "flash": "eleven_flash_v2_5",
    "turbo": "eleven_turbo_v2_5",
    "multilingual": "eleven_multilingual_v2",
}
_DEFAULT_MODEL = "eleven_flash_v2_5"


# ── G.711 µ-law → linear PCM16 decode table ─────────────────────────────────
# Standard ITU-T G.711 µ-law expansion. Precomputed once at import: a 256-entry
# table of little-endian int16 byte-pairs, so decoding a chunk is a single
# b"".join over a list lookup — no audioop (removed in Python 3.13), no deps.
def _ulaw_byte_to_linear(u_val: int) -> int:
    u_val = ~u_val & 0xFF
    sign = u_val & 0x80
    exponent = (u_val >> 4) & 0x07
    mantissa = u_val & 0x0F
    sample = ((mantissa << 3) + 0x84) << exponent
    sample -= 0x84
    sample = -sample if sign else sample
    # Clamp to int16 just in case (G.711 max magnitude is ~32124, always safe).
    if sample > 32767:
        sample = 32767
    elif sample < -32768:
        sample = -32768
    return sample


_ULAW_LE = [struct.pack("<h", _ulaw_byte_to_linear(b)) for b in range(256)]


def _ulaw_to_pcm16(data: bytes) -> bytes:
    """Expand raw G.711 µ-law bytes to little-endian PCM16 bytes."""
    if not data:
        return b""
    return b"".join([_ULAW_LE[b] for b in data])


@dataclass
class _VoiceSpec:
    """Decoded from voice_id 'elevenlabs:<family>:<voice>'."""
    model: str
    provider_voice_id: str


def parse_elevenlabs_voice_id(voice_id: str) -> Optional[_VoiceSpec]:
    """None if the voice_id isn't an ElevenLabs direct identifier."""
    if not voice_id or not voice_id.startswith("elevenlabs:"):
        return None
    parts = voice_id.split(":", 2)
    if len(parts) != 3 or not parts[2]:
        return None
    _, family, vid = parts
    model = _FAMILY_TO_MODEL.get(family, _DEFAULT_MODEL)
    return _VoiceSpec(model=model, provider_voice_id=vid)


def is_elevenlabs_voice_id(voice_id: Optional[str]) -> bool:
    """Helper for _tts_for: fast routing without decoding."""
    return bool(voice_id and voice_id.startswith("elevenlabs:"))


class ElevenLabsTelephonyTTS(tts.TTS):
    """LiveKit TTS that streams ElevenLabs audio as native ulaw_8000.

    Telephony-only: emits PCM16 @ 8 kHz (decoded from µ-law) so the Twilio
    SIP leg never resamples. For web/preview use the official plugin instead.
    """

    def __init__(
        self,
        *,
        voice_id: str,
        api_key: Optional[str] = None,
        sample_rate: int = 8000,
        speed: Optional[float] = None,
        stability: Optional[float] = None,
        similarity_boost: Optional[float] = None,
        style: Optional[float] = None,
        speaker_boost: Optional[bool] = None,
        language: Optional[str] = None,
        optimize_streaming_latency: Optional[int] = 3,
    ) -> None:
        spec = parse_elevenlabs_voice_id(voice_id)
        if not spec:
            raise ValueError(f"ElevenLabs voice_id invalide : {voice_id!r}")
        # µ-law is fixed at 8 kHz; we only support the telephony rate here.
        if int(sample_rate) != 8000:
            logger.info(
                "ElevenLabsTelephonyTTS forces 8 kHz (ulaw_8000); ignoring "
                "requested sample_rate=%s",
                sample_rate,
            )
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=8000,
            num_channels=1,
        )
        self._spec = spec
        self._api_key = (
            api_key
            or os.getenv("ELEVEN_API_KEY")
            or os.getenv("ELEVENLABS_API_KEY")
        )
        if not self._api_key:
            raise RuntimeError(
                "ELEVEN_API_KEY missing — set on LK Cloud Agent secrets"
            )
        self._base = os.getenv("ELEVENLABS_BASE_URL", _DEFAULT_BASE).rstrip("/")
        self._speed = speed
        self._stability = stability
        self._similarity_boost = similarity_boost
        self._style = style
        self._speaker_boost = speaker_boost
        self._language = language
        try:
            self._opt_latency = (
                int(optimize_streaming_latency)
                if optimize_streaming_latency is not None
                else None
            )
        except (TypeError, ValueError):
            self._opt_latency = None
        self._session: Optional[aiohttp.ClientSession] = None

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "xi-api-key": self._api_key or "",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=60, connect=10),
            )
        return self._session

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "_ElevenLabsChunkedStream":
        return _ElevenLabsChunkedStream(
            tts=self, input_text=text, conn_options=conn_options
        )

    async def aclose(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()


class _ElevenLabsChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: ElevenLabsTelephonyTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._etts = tts

    def _build_voice_settings(self) -> Optional[dict]:
        vs: dict = {}
        if self._etts._stability is not None:
            vs["stability"] = float(self._etts._stability)
        if self._etts._similarity_boost is not None:
            vs["similarity_boost"] = float(self._etts._similarity_boost)
        if self._etts._style is not None:
            vs["style"] = float(self._etts._style)
        if self._etts._speaker_boost is not None:
            vs["use_speaker_boost"] = bool(self._etts._speaker_boost)
        if self._etts._speed and float(self._etts._speed) != 1.0:
            vs["speed"] = max(0.7, min(1.2, float(self._etts._speed)))
        if not vs:
            return None
        # ElevenLabs requires stability + similarity_boost when voice_settings
        # is present; fill the API defaults if the caller only set optionals.
        vs.setdefault("stability", 0.5)
        vs.setdefault("similarity_boost", 0.75)
        return vs

    def _build_payload(self) -> dict:
        payload: dict = {
            "text": self._input_text,
            "model_id": self._etts._spec.model,
        }
        vs = self._build_voice_settings()
        if vs:
            payload["voice_settings"] = vs
        # language_code is honoured by flash/turbo v2.5 but REJECTED (HTTP 400)
        # by eleven_multilingual_v2, which auto-detects. Only send it for the
        # models that accept it, so a stray language never 400s us back onto
        # the crackly plugin path.
        if self._etts._language and self._etts._spec.model in (
            "eleven_flash_v2_5",
            "eleven_turbo_v2_5",
        ):
            payload["language_code"] = self._etts._language
        return payload

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:  # type: ignore[override]
        session = await self._etts._ensure_session()
        voice = self._etts._spec.provider_voice_id
        # The /stream endpoint streams audio bytes as they're generated.
        # output_format=ulaw_8000 = raw G.711 µ-law @ 8 kHz (the Twilio codec).
        url = f"{self._etts._base}/v1/text-to-speech/{voice}/stream"
        params = {"output_format": "ulaw_8000"}
        if self._etts._opt_latency is not None:
            params["optimize_streaming_latency"] = str(self._etts._opt_latency)
        payload = self._build_payload()

        try:
            async with session.post(url, params=params, json=payload) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise RuntimeError(
                        f"ElevenLabs stream HTTP {resp.status} — {body[:300]}"
                    )
                # We DECLARE the emitter as PCM16 @ 8 kHz: we decode µ-law →
                # PCM16 locally before pushing, so LiveKit receives clean
                # linear audio at the native telephony rate (no resampling).
                output_emitter.initialize(
                    request_id="elevenlabs",
                    sample_rate=8000,
                    num_channels=1,
                    mime_type="audio/pcm",
                )
                pushed = False
                async for raw in resp.content.iter_chunked(4096):
                    if not raw:
                        continue
                    pcm = _ulaw_to_pcm16(raw)
                    if pcm:
                        output_emitter.push(pcm)
                        pushed = True
                if not pushed:
                    raise RuntimeError(
                        "ElevenLabs stream returned no audio (ulaw_8000)"
                    )
                output_emitter.flush()
        except asyncio.TimeoutError as e:
            raise APITimeoutError(str(e)) from e

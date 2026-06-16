"""MiniMax T2A v2 — direct API (no Replicate hop).

Wati 16/06 — MiniMax voices used to land via Replicate (~1-2s TTFB,
non-streaming). This plugin hits MiniMax's `t2a_v2` endpoint directly
with SSE streaming for ~400ms TTFB. Same supported knobs as the
Replicate path (speed, vol, pitch, emotion, english_normalization)
plus access to the built-in voice catalog without the Replicate
catalog gap.

Voice id format used across the platform : `minimax:<model>:<voice_id>`
    minimax:speech-02-turbo:Wise_Woman
    minimax:speech-02-hd:Friendly_Person
    minimax:speech-02-turbo:<cloned_voice_uuid>

Required env :
    MINIMAX_API_KEY   — Bearer token from MiniMax console
    MINIMAX_GROUP_ID  — GroupId tied to the account (query param)
    MINIMAX_BASE_URL  — defaults to https://api.minimax.io
"""

from __future__ import annotations

import asyncio
import binascii
import json
import logging
import os
from dataclasses import dataclass
from typing import Optional

import aiohttp
from livekit.agents import APIConnectOptions, APITimeoutError, tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

logger = logging.getLogger("minimax-tts")

_DEFAULT_BASE = "https://api.minimax.io"
_DEFAULT_MODEL = "speech-02-turbo"
# MiniMax supports both turbo (lowest latency) and hd (higher fidelity).
_SUPPORTED_MODELS = {"speech-02-turbo", "speech-02-hd"}


@dataclass
class _VoiceSpec:
    """Décodé de voice_id 'minimax:<model>:<voice_id>'."""
    model: str
    provider_voice_id: str


def parse_minimax_voice_id(voice_id: str) -> Optional[_VoiceSpec]:
    """None si le voice_id n'est pas un identifiant MiniMax direct."""
    if not voice_id or not voice_id.startswith("minimax:"):
        return None
    parts = voice_id.split(":", 2)
    if len(parts) != 3:
        return None
    _, model, vid = parts
    if not vid:
        return None
    # Default to turbo if the model fragment is unknown.
    if model not in _SUPPORTED_MODELS:
        model = _DEFAULT_MODEL
    return _VoiceSpec(model=model, provider_voice_id=vid)


def is_minimax_voice_id(voice_id: Optional[str]) -> bool:
    """Helper pour _tts_for : routing rapide sans décoder."""
    return bool(voice_id and voice_id.startswith("minimax:"))


class MinimaxTTS(tts.TTS):
    """LiveKit-compatible TTS that streams MiniMax t2a_v2 audio chunks."""

    def __init__(
        self,
        *,
        voice_id: str,
        api_key: Optional[str] = None,
        group_id: Optional[str] = None,
        sample_rate: int = 24000,
        speed: Optional[float] = None,
        pitch: Optional[int] = None,
        emotion: Optional[str] = None,
        volume: Optional[float] = None,
        english_normalization: Optional[bool] = None,
    ) -> None:
        spec = parse_minimax_voice_id(voice_id)
        if not spec:
            raise ValueError(f"MiniMax voice_id invalide : {voice_id!r}")
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._spec = spec
        self._api_key = api_key or os.getenv("MINIMAX_API_KEY")
        self._group_id = group_id or os.getenv("MINIMAX_GROUP_ID")
        if not self._api_key:
            raise RuntimeError("MINIMAX_API_KEY missing — set on LK Cloud Agent secrets")
        if not self._group_id:
            raise RuntimeError("MINIMAX_GROUP_ID missing — set on LK Cloud Agent secrets")
        self._base = os.getenv("MINIMAX_BASE_URL", _DEFAULT_BASE).rstrip("/")
        self._speed = speed
        self._pitch = pitch
        self._emotion = emotion
        self._volume = volume
        self._english_normalization = english_normalization
        self._session: Optional[aiohttp.ClientSession] = None

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {self._api_key}",
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
    ) -> "_MinimaxChunkedStream":
        return _MinimaxChunkedStream(
            tts=self, input_text=text, conn_options=conn_options
        )

    async def aclose(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()


class _MinimaxChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: MinimaxTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._mtts = tts

    def _build_payload(self) -> dict:
        # MiniMax t2a_v2 schema. voice_setting holds the per-voice knobs;
        # audio_setting controls the output codec. We force PCM so the
        # AudioEmitter can push raw frames without an mp3 decode hop.
        voice_setting: dict = {"voice_id": self._mtts._spec.provider_voice_id}
        if self._mtts._speed and self._mtts._speed != 1.0:
            voice_setting["speed"] = max(0.5, min(2.0, float(self._mtts._speed)))
        if self._mtts._pitch is not None and int(self._mtts._pitch) != 0:
            voice_setting["pitch"] = max(-12, min(12, int(self._mtts._pitch)))
        if self._mtts._volume is not None and float(self._mtts._volume) != 1.0:
            voice_setting["vol"] = max(0.01, min(10.0, float(self._mtts._volume)))
        if self._mtts._emotion:
            voice_setting["emotion"] = str(self._mtts._emotion)
        if self._mtts._english_normalization is not None:
            voice_setting["english_normalization"] = bool(self._mtts._english_normalization)

        return {
            "model": self._mtts._spec.model,
            "text": self._input_text,
            "stream": True,
            "voice_setting": voice_setting,
            "audio_setting": {
                "sample_rate": int(self._mtts.sample_rate),
                "bitrate": 128000,
                "format": "pcm",
                "channel": 1,
            },
        }

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:  # type: ignore[override]
        session = await self._mtts._ensure_session()
        url = f"{self._mtts._base}/v1/t2a_v2?GroupId={self._mtts._group_id}"
        payload = self._build_payload()

        try:
            async with session.post(url, json=payload) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise RuntimeError(
                        f"MiniMax t2a_v2 HTTP {resp.status} — {body[:300]}"
                    )
                output_emitter.initialize(
                    request_id="minimax",
                    sample_rate=self._mtts.sample_rate,
                    num_channels=self._mtts.num_channels,
                    mime_type="audio/pcm",
                )
                # SSE-style stream : lines prefixed with `data: ` carrying JSON.
                # Each event has {data: {audio: "<hex>"}, ...}. The final event
                # carries trace_id + status; we just look for audio fragments.
                async for raw in resp.content:
                    if not raw:
                        continue
                    line = raw.strip()
                    if not line or not line.startswith(b"data:"):
                        continue
                    body = line[5:].strip()
                    if not body or body == b"[DONE]":
                        continue
                    try:
                        evt = json.loads(body)
                    except json.JSONDecodeError:
                        continue
                    audio_hex = (evt.get("data") or {}).get("audio")
                    if not audio_hex:
                        continue
                    try:
                        chunk = binascii.unhexlify(audio_hex)
                    except (binascii.Error, ValueError):
                        logger.warning("MiniMax sent non-hex audio chunk, skipping")
                        continue
                    if chunk:
                        output_emitter.push(chunk)
                output_emitter.flush()
        except asyncio.TimeoutError as e:
            raise APITimeoutError(str(e)) from e

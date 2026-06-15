"""Replicate TTS plugin pour LiveKit Agents.

Wati preview 15/06/2026 — alternative à Cartesia, accède aux voix ElevenLabs
(Flash v2.5 + Turbo v2.5) et MiniMax (Speech 02 Turbo + HD) via la passerelle
Replicate avec UNE seule clé API.

Compromis connu : Replicate ne supporte pas le streaming audio comme l'API
directe ElevenLabs. Le modèle renvoie une URL audio complète après la fin
de la génération. On télécharge puis on push d'un coup au pipeline LK :
TTFB ~1-2s par tour vs ~75ms côté ElevenLabs direct. Acceptable pour la
campagne test ; un futur switch ElevenLabs direct serait sans douleur via
le même voice_id (juste un swap de plugin).

Identifiants de voix : format unifié `replicate:famille:provider_voice_id`
décodé par parse_replicate_voice_id(). Les familles supportées :
  • elevenlabs-flash  → modèle elevenlabs/flash-v2.5
  • elevenlabs-turbo  → modèle elevenlabs/turbo-v2.5
  • minimax-turbo     → modèle minimax/speech-02-turbo
  • minimax-hd        → modèle minimax/speech-02-hd
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import aiohttp
from livekit.agents import APIConnectOptions, APITimeoutError, tts
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS

logger = logging.getLogger("replicate-tts")

_REPLICATE_BASE = os.getenv("REPLICATE_BASE_URL", "https://api.replicate.com/v1").rstrip("/")

_FAMILY_TO_MODEL = {
    "elevenlabs-flash": "elevenlabs/flash-v2.5",
    "elevenlabs-turbo": "elevenlabs/turbo-v2.5",
    "minimax-turbo": "minimax/speech-02-turbo",
    "minimax-hd": "minimax/speech-02-hd",
}


@dataclass
class _VoiceSpec:
    """Décodé de voice_id 'replicate:famille:provider_voice_id'."""
    family: str
    model: str
    provider_voice_id: str


def parse_replicate_voice_id(voice_id: str) -> Optional[_VoiceSpec]:
    """Retourne None si le voice_id n'est pas un identifiant Replicate."""
    if not voice_id or not voice_id.startswith("replicate:"):
        return None
    parts = voice_id.split(":", 2)
    if len(parts) != 3:
        return None
    _, family, provider_voice_id = parts
    model = _FAMILY_TO_MODEL.get(family)
    if not model or not provider_voice_id:
        return None
    return _VoiceSpec(family=family, model=model, provider_voice_id=provider_voice_id)


def is_replicate_voice_id(voice_id: Optional[str]) -> bool:
    """Helper pour _tts_for : routing rapide sans décoder."""
    return bool(voice_id and voice_id.startswith("replicate:"))


class ReplicateTTS(tts.TTS):
    """TTS LiveKit qui passe par Replicate predictions API.

    sample_rate est défini à 22050 par défaut (taux courant pour les modèles
    ElevenLabs et MiniMax) ; le AudioEmitter de LK ré-échantillonne si besoin.
    """

    def __init__(
        self,
        *,
        voice_id: str,
        api_key: Optional[str] = None,
        sample_rate: int = 22050,
        language: Optional[str] = None,
        speed: Optional[float] = None,
    ) -> None:
        spec = parse_replicate_voice_id(voice_id)
        if not spec:
            raise ValueError(f"Replicate voice_id invalide : {voice_id!r}")
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._spec = spec
        self._api_key = api_key or os.getenv("REPLICATE_API_TOKEN") or os.getenv("REPLICATE_API_KEY")
        if not self._api_key:
            raise RuntimeError("REPLICATE_API_TOKEN missing — set Fly secret or env")
        self._language = language
        self._speed = speed
        self._session: Optional[aiohttp.ClientSession] = None

    async def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=120),
            )
        return self._session

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> "_ReplicateChunkedStream":
        return _ReplicateChunkedStream(
            tts=self, input_text=text, conn_options=conn_options
        )

    async def aclose(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()


class _ReplicateChunkedStream(tts.ChunkedStream):
    def __init__(
        self,
        *,
        tts: ReplicateTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts, input_text=input_text, conn_options=conn_options)
        self._rtts = tts

    def _build_input(self) -> dict:
        family = self._rtts._spec.family
        vid = self._rtts._spec.provider_voice_id
        if family.startswith("elevenlabs"):
            # ElevenLabs flash/turbo v2.5 sur Replicate attend "prompt"
            # (pas "text") — sinon HTTP 422 "input: prompt is required".
            # Wati preview 15/06.
            payload: dict = {"prompt": self._input_text, "voice_id": vid}
            sp = self._rtts._speed
            if sp and sp != 1.0:
                # voice_settings.speed (0.7-1.2 selon la doc ElevenLabs API).
                # Si Replicate refuse on aura une erreur 422 explicite.
                payload["voice_settings"] = {
                    "speed": max(0.7, min(1.2, sp)),
                }
            return payload
        if family.startswith("minimax"):
            payload = {"text": self._input_text, "voice_id": vid}
            if self._rtts._speed and self._rtts._speed != 1.0:
                payload["speed"] = max(0.5, min(2.0, self._rtts._speed))
            return payload
        return {"text": self._input_text}

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:  # type: ignore[override]
        session = await self._rtts._ensure_session()
        model = self._rtts._spec.model
        url = f"{_REPLICATE_BASE}/models/{model}/predictions"
        payload = {"input": self._build_input()}

        # Prefer: wait demande à Replicate de bloquer jusqu'à completion.
        # Max 60s pour la fenêtre synchrone — au-delà on poll l'URL get.
        try:
            async with session.post(
                url, json=payload, headers={"Prefer": "wait=60"}
            ) as r:
                if r.status >= 400:
                    body = await r.text()
                    raise RuntimeError(
                        f"Replicate predictions HTTP {r.status} — {body[:200]}"
                    )
                pred = await r.json()
        except asyncio.TimeoutError as e:
            raise APITimeoutError(str(e)) from e

        # Si le statut n'est pas 'succeeded' (le modèle a pris plus que la
        # fenêtre Prefer), on poll l'endpoint get jusqu'à terminé.
        output = pred.get("output")
        if pred.get("status") != "succeeded" or not output:
            get_url = (pred.get("urls") or {}).get("get")
            if not get_url:
                raise RuntimeError(f"Replicate sans URL get : {pred}")
            output = await self._poll_until_done(session, get_url)

        audio_url = output[0] if isinstance(output, list) else output
        if not audio_url:
            raise RuntimeError("Replicate returned no audio URL")

        # Télécharger l'audio (MP3 dans tous les cas pour ces modèles).
        async with session.get(audio_url) as audio_resp:
            if audio_resp.status >= 400:
                raise RuntimeError(f"Audio fetch HTTP {audio_resp.status}")
            audio_bytes = await audio_resp.read()

        # Push au pipeline LiveKit en un seul segment.
        request_id = pred.get("id", "replicate")
        output_emitter.initialize(
            request_id=request_id,
            sample_rate=self._rtts.sample_rate,
            num_channels=self._rtts.num_channels,
            mime_type="audio/mp3",
        )
        output_emitter.push(audio_bytes)
        output_emitter.flush()

    async def _poll_until_done(
        self, session: aiohttp.ClientSession, get_url: str, max_secs: float = 30.0
    ) -> Optional[list[str] | str]:
        deadline = asyncio.get_event_loop().time() + max_secs
        while asyncio.get_event_loop().time() < deadline:
            await asyncio.sleep(0.5)
            async with session.get(get_url) as r:
                if r.status >= 400:
                    raise RuntimeError(f"Replicate poll HTTP {r.status}")
                j = await r.json()
            if j.get("status") == "succeeded":
                return j.get("output")
            if j.get("status") in ("failed", "canceled"):
                raise RuntimeError(f"Replicate {j.get('status')}: {j.get('error')}")
        raise RuntimeError("Replicate poll timeout")

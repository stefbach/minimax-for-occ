"""Clone a voice on MiniMax from a local audio sample.

Usage:
    python clone_voice.py path/to/sample.wav my-voice-id

Steps:
    1. Upload the sample with purpose=voice_clone -> file_id
    2. Call /v1/voice_clone with {file_id, voice_id} to register the clone
    3. Print the voice_id to put into MINIMAX_VOICE_ID

Audio sample requirements (per MiniMax docs):
    - Format: mp3 / wav / m4a
    - Duration: 10s - 5min
    - Single speaker, clean recording, no background music
    - File size <= 20 MB

The voice_id you choose must:
    - be 8-64 chars
    - start with a letter
    - contain only letters, digits and underscores

Docs: https://platform.minimax.io/docs/api-reference/voice-clone
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv()


def main() -> int:
    parser = argparse.ArgumentParser(description="Clone a voice on MiniMax.")
    parser.add_argument("audio", type=Path, help="Path to the audio sample (wav/mp3/m4a).")
    parser.add_argument("voice_id", help="Custom voice id (8-64 chars, starts with a letter).")
    parser.add_argument(
        "--text",
        default=None,
        help="Optional reference text matching the audio for higher fidelity.",
    )
    parser.add_argument(
        "--base-url",
        default=os.getenv("MINIMAX_BASE_URL", "https://api.minimax.io/v1"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("MINIMAX_API_KEY")
    if not api_key:
        print("MINIMAX_API_KEY not set", file=sys.stderr)
        return 1

    if not args.audio.exists():
        print(f"audio file not found: {args.audio}", file=sys.stderr)
        return 1

    headers = {"Authorization": f"Bearer {api_key}"}
    base = args.base_url.rstrip("/")

    with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
        # 1. Upload sample
        print(f"Uploading {args.audio} ...")
        with args.audio.open("rb") as fh:
            upload = client.post(
                f"{base}/files/upload",
                headers=headers,
                data={"purpose": "voice_clone"},
                files={"file": (args.audio.name, fh)},
            )
        upload.raise_for_status()
        file_payload = upload.json()
        file_id = file_payload.get("file", {}).get("file_id") or file_payload.get("file_id")
        if not file_id:
            print(f"unexpected upload response: {file_payload}", file=sys.stderr)
            return 2
        print(f"  -> file_id={file_id}")

        # 2. Register clone
        print(f"Cloning voice as id={args.voice_id} ...")
        body: dict = {"file_id": file_id, "voice_id": args.voice_id}
        if args.text:
            body["text"] = args.text
        clone = client.post(f"{base}/voice_clone", headers=headers, json=body)
        clone.raise_for_status()
        print(f"  -> {clone.json()}")

    print()
    print(f"Done. Add to agent/.env:")
    print(f"    MINIMAX_VOICE_ID={args.voice_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

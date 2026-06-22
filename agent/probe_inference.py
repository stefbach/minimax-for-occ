"""One-shot LiveKit Inference probe (multi-model).

Vérifie, SANS passer d'appel téléphonique, quels descripteurs de modèles sont
réellement disponibles via la passerelle LiveKit Inference de CE projet
(celui des secrets LIVEKIT_URL/API_KEY/SECRET).

But principal du 18/06 : déterminer de façon DÉFINITIVE si Claude (Anthropic)
est accessible via Inference, et sous quel identifiant exact — au lieu de
deviner. On teste une liste de descripteurs candidats et on rapporte, pour
chacun : OK (+TTFT) ou l'erreur exacte de la passerelle (404 = pas au catalogue,
401/403 = pas activé, etc.).

Usage :
    LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
        python probe_inference.py "model1,model2,model3"

Sans argument → teste une liste par défaut (OpenAI témoin + tous les candidats
Claude connus). Sortie : exit 0 si AU MOINS un modèle répond, sinon non-zéro.
"""

import asyncio
import os
import sys
import time

# Descripteurs candidats par défaut. Le premier (openai) est un TÉMOIN : on
# sait qu'il marche, donc s'il échoue le problème vient des credentials/region,
# pas du catalogue Claude.
DEFAULT_MODELS = [
    "openai/gpt-4o-mini",            # témoin connu-bon
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-haiku-4-5-20251001",
    "anthropic/claude-3-5-haiku",
    "anthropic/claude-sonnet-4-6",
    "anthropic/claude-3-5-sonnet",
    "claude-haiku-4-5",
    "claude-sonnet-4-6",
]


def _require_env() -> None:
    missing = [k for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET") if not os.getenv(k)]
    if missing:
        print(f"[probe] ABORT — variables manquantes: {', '.join(missing)}")
        sys.exit(2)


async def _probe_one(inference, ChatContext, model: str) -> tuple[bool, str]:
    """Retourne (ok, detail)."""
    try:
        llm = inference.LLM(model=model)
    except Exception as e:  # noqa: BLE001
        return False, f"build error: {type(e).__name__}: {e}"

    ctx = ChatContext.empty() if hasattr(ChatContext, "empty") else ChatContext()
    try:
        ctx.add_message(role="user", content="Reply with the single word: OK")
    except Exception:  # noqa: BLE001
        try:
            from livekit.agents.llm import ChatMessage  # type: ignore
            ctx.messages.append(ChatMessage(role="user", content="Reply with the single word: OK"))  # type: ignore
        except Exception as e:  # noqa: BLE001
            return False, f"chatctx build error: {e}"

    t0 = time.monotonic()
    ttft = None
    got = []
    try:
        stream = llm.chat(chat_ctx=ctx)
        async for chunk in stream:
            delta = getattr(chunk, "delta", None)
            content = getattr(delta, "content", None) if delta is not None else None
            if content:
                if ttft is None:
                    ttft = (time.monotonic() - t0) * 1000.0
                got.append(content)
        try:
            await stream.aclose()
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"

    reply = "".join(got).strip()
    if not reply:
        return False, "empty completion (0 token, no error)"
    return True, f"OK — TTFT={ttft:.0f}ms reply={reply!r}"


async def _run(models: list[str]) -> int:
    try:
        from livekit.agents import inference
        from livekit.agents.llm import ChatContext
    except Exception as e:  # noqa: BLE001
        print(f"[probe] ECHEC import livekit.agents.inference: {e!r}")
        return 3

    print(f"[probe] LIVEKIT_URL = {os.getenv('LIVEKIT_URL')}")
    print(f"[probe] test de {len(models)} descripteurs:\n")
    any_ok = False
    results = []
    for m in models:
        ok, detail = await _probe_one(inference, ChatContext, m)
        flag = "✅" if ok else "❌"
        any_ok = any_ok or ok
        print(f"  {flag} {m:42s} {detail}")
        results.append((m, ok, detail))

    print("\n==================== VERDICT ====================")
    claude_ok = [m for (m, ok, _) in results if ok and "claude" in m.lower()]
    if claude_ok:
        print(f"[probe] Claude EST disponible via Inference. Descripteur(s) valides: {claude_ok}")
        print("[probe] => mettre cet ID dans metadata.call_tuning.anthropic_inference_model")
    else:
        witness_ok = any(ok for (m, ok, _) in results if m.startswith("openai/"))
        if witness_ok:
            print("[probe] Le témoin OpenAI marche mais AUCUN descripteur Claude ne répond.")
            print("[probe] => Claude n'est PAS au catalogue Inference de ce compte (réponse définitive).")
        else:
            print("[probe] Même le témoin OpenAI échoue => problème credentials/region, PAS le catalogue.")
    print("================================================")
    return 0 if any_ok else 5


def main() -> None:
    _require_env()
    if len(sys.argv) > 1 and sys.argv[1].strip():
        models = [m.strip() for m in sys.argv[1].split(",") if m.strip()]
    else:
        models = DEFAULT_MODELS
    rc = asyncio.run(_run(models))
    sys.exit(rc)


if __name__ == "__main__":
    main()

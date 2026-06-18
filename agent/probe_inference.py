"""One-shot LiveKit Inference probe.

Vérifie, SANS passer d'appel téléphonique, si LiveKit Inference est utilisable
sur CE projet LiveKit Cloud (celui des secrets LIVEKIT_URL/API_KEY/SECRET).

Ce que ça prouve :
  • la passerelle Inference répond pour ce projet (crédits / accès OK) ;
  • la latence TTFT réelle (time-to-first-token) depuis l'environnement CI ;
  • sinon : l'erreur EXACTE renvoyée par la passerelle (auth, quota, région…).

Le chemin de code est volontairement identique à agent.py::_llm_for() branche
"livekit" : `from livekit.agents import inference; inference.LLM(model=...)`.

Usage :
    LIVEKIT_URL=... LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... \
        python probe_inference.py [model]

`model` par défaut : openai/gpt-4o-mini (le même que charlotte-teste utiliserait).
Sortie : exit 0 = Inference OK ; exit non-zéro = indisponible (détail au-dessus).
"""

import asyncio
import os
import sys
import time


def _require_env() -> None:
    missing = [k for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET") if not os.getenv(k)]
    if missing:
        print(f"[probe] ABORT — variables manquantes: {', '.join(missing)}")
        print("[probe] (sur CI elles viennent des GitHub Secrets du même nom)")
        sys.exit(2)


async def _run(model: str) -> int:
    try:
        from livekit.agents import inference
    except Exception as e:  # noqa: BLE001
        print(f"[probe] ECHEC import — livekit.agents.inference indisponible: {e!r}")
        print("[probe] => le SDK installé ne supporte pas Inference (besoin livekit-agents>=1.x).")
        return 3

    try:
        from livekit.agents.llm import ChatContext
    except Exception as e:  # noqa: BLE001
        print(f"[probe] ECHEC import ChatContext: {e!r}")
        return 3

    print(f"[probe] modèle = {model}")
    print(f"[probe] LIVEKIT_URL = {os.getenv('LIVEKIT_URL')}")

    try:
        llm = inference.LLM(model=model)
    except Exception as e:  # noqa: BLE001
        print(f"[probe] ECHEC instanciation inference.LLM: {e!r}")
        return 4

    ctx = ChatContext.empty() if hasattr(ChatContext, "empty") else ChatContext()
    try:
        ctx.add_message(role="user", content="Reply with the single word: OK")
    except Exception:  # noqa: BLE001
        # Variante d'API plus ancienne/récente : on tente l'attribut messages.
        try:
            from livekit.agents.llm import ChatMessage  # type: ignore
            ctx.messages.append(ChatMessage(role="user", content="Reply with the single word: OK"))  # type: ignore
        except Exception as e:  # noqa: BLE001
            print(f"[probe] ECHEC construction du ChatContext (API SDK inattendue): {e!r}")
            return 4

    t0 = time.monotonic()
    ttft_ms = None
    text_parts: list[str] = []
    try:
        stream = llm.chat(chat_ctx=ctx)
        async for chunk in stream:
            delta = getattr(chunk, "delta", None)
            content = getattr(delta, "content", None) if delta is not None else None
            if content:
                if ttft_ms is None:
                    ttft_ms = (time.monotonic() - t0) * 1000.0
                text_parts.append(content)
        try:
            await stream.aclose()
        except Exception:  # noqa: BLE001
            pass
    except Exception as e:  # noqa: BLE001
        dt = (time.monotonic() - t0) * 1000.0
        print(f"[probe] ECHEC appel Inference après {dt:.0f}ms")
        print(f"[probe] erreur EXACTE: {type(e).__name__}: {e}")
        print("[probe] => Inference NON utilisable sur ce projet. Causes typiques :")
        print("         • crédits inference épuisés / plan sans Inference")
        print("         • clé API/secret d'un autre projet")
        print("         • modèle non disponible dans la région du projet")
        return 5

    total_ms = (time.monotonic() - t0) * 1000.0
    reply = "".join(text_parts).strip()
    print("")
    print("==================== RESULTAT ====================")
    print(f"[probe] OK — Inference répond sur ce projet ✅")
    print(f"[probe] réponse modèle      : {reply!r}")
    print(f"[probe] TTFT (1er token)    : {ttft_ms:.0f} ms" if ttft_ms is not None else "[probe] TTFT: (aucun token streamé)")
    print(f"[probe] durée totale        : {total_ms:.0f} ms")
    print("==================================================")
    print("")
    print("[probe] Comparaison: OpenAI API directe depuis l'EU mesurait ~1300ms de TTFT.")
    print("[probe] Si le TTFT ci-dessus est nettement plus bas, Inference réduit la latence")
    print("[probe] sans changer de modèle ni de prompt.")
    return 0


def main() -> None:
    _require_env()
    model = sys.argv[1] if len(sys.argv) > 1 else "openai/gpt-4o-mini"
    rc = asyncio.run(_run(model))
    sys.exit(rc)


if __name__ == "__main__":
    main()

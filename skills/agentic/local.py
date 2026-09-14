#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Play the language-model pools of a studyflow: each message a step sends to one is one request to that model.

A partial runner (skills/local/SKILL.md): `--claims` names every participant that is a model (`cognitive:Actor`,
`actorType: llm`) with no process of its own; `--element <pool> --cache <dir>` answers the message the walk hands
over under `message` in `<pool>.state.json`, and writes the model's reply back as `result`.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

COGNITIVE = "http://behaverse.org/schemas/studyflow/cognitive"
AGENTIC = "https://w3id.org/studyflow/agentic"


def extension(element: dict[str, Any], namespace: str, kind: str) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == namespace and ext.get("type") == kind), None)


def model_pools(elements: dict[str, dict[str, Any]]) -> list[str]:
    """The participants that are models and have no process of their own."""
    return [
        element_id for element_id, element in elements.items()
        if element.get("type") == "participant" and not (element.get("attributes") or {}).get("processRef")
        and ((extension(element, COGNITIVE, "actor") or {}).get("attributes") or {}).get("actorType") == "llm"
    ]


def model_of(pool_id: str, pool: dict[str, Any]) -> tuple[str, str]:
    """`claude://<model>` or `ollama://<model>`, as the pool's `implementation` writes it; there is no default."""
    ref = str(((extension(pool, COGNITIVE, "actor") or {}).get("attributes") or {}).get("implementation") or "")
    if "://" not in ref:
        raise ValueError(f"{pool_id} names no model: set its implementation to claude://<model> or ollama://<model>")
    provider, model = ref.split("://", 1)
    return provider, model


def image_of(value: str, run_dir: Path) -> tuple[str, str] | None:
    """(media type, base64) of a `data:image/` value or of an image file in the run; None for any other text."""
    if value.startswith("data:image/") and ";base64," in value:
        media, data = value[len("data:"):].split(";base64,", 1)
        return media, data
    media = mimetypes.guess_type(value)[0] or ""
    if media.startswith("image/") and (run_dir / value).is_file():
        return media, base64.b64encode((run_dir / value).read_bytes()).decode()
    return None


def parts_of(content: Any, elements: dict[str, dict[str, Any]], run_dir: Path) -> list[dict[str, Any]]:
    """The request, part by part, in the content's order: a `Prompt`'s text for a null value its id names, an image
    for an image, text for other text, and JSON for anything else. Nothing is added."""
    parts: list[dict[str, Any]] = []
    for key, value in (content.items() if isinstance(content, dict) else [(None, content)]):
        if value is None:
            prompt = extension(elements.get(str(key)) or {}, AGENTIC, "prompt")
            text = str((prompt or {}).get("attributes", {}).get("template") or "")
            if text:
                parts.append({"text": text})
        elif isinstance(value, str) and (image := image_of(value, run_dir)):
            parts.append({"image": image})
        else:
            parts.append({"text": value if isinstance(value, str) else json.dumps(value)})
    return parts


def post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def ask_claude(model: str, parts: list[dict[str, Any]]) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": part["image"][0], "data": part["image"][1]}}
        if "image" in part else {"type": "text", "text": part["text"]}
        for part in parts
    ]
    data = post("https://api.anthropic.com/v1/messages",
                {"model": model, "max_tokens": 1024, "messages": [{"role": "user", "content": content}]},
                {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=60)
    return "".join(block.get("text", "") for block in data.get("content", []))


def ask_ollama(model: str, parts: list[dict[str, Any]]) -> str:
    message = {
        "role": "user",
        "content": "\n\n".join(part["text"] for part in parts if "text" in part),
        "images": [part["image"][1] for part in parts if "image" in part],
    }
    # `think: false` keeps a thinking model to its answer: a trial window is seconds long.
    data = post("http://localhost:11434/api/chat", {"model": model, "stream": False, "think": False, "messages": [message]},
                {}, timeout=120)
    return data["message"]["content"]


CLIENTS = {"claude": ask_claude, "ollama": ask_ollama}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plan", type=Path, help="the plan digest the walk hands over (plan.json)")
    parser.add_argument("--claims", action="store_true", help="print the model pools this runner plays, and exit")
    parser.add_argument("--element", metavar="ID", default=None, help="answer the message handed to this pool")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state: <pool>.state.json")
    parser.add_argument("--sim", action="store_true", help=argparse.SUPPRESS)  # flags every partial runner takes
    parser.add_argument("--auto", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    elements: dict[str, dict[str, Any]] = json.loads(args.plan.read_text()).get("elements") or {}
    if args.claims:
        print(json.dumps(model_pools(elements)))
        return 0
    if not args.element:
        parser.error("this runner answers one message at a time: pass --element or --claims")
    cache = args.cache or Path(".")
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}
    clock = time.perf_counter()
    try:
        provider, model = model_of(args.element, elements.get(args.element) or {})
        if provider not in CLIENTS:
            raise ValueError(f"{args.element}: this runner speaks {', '.join(CLIENTS)}, not {provider}://")
        run_dir = cache.parent if cache.name == ".cache" else cache
        parts = parts_of((state.get("message") or {}).get("content"), elements, run_dir)
        if not parts:
            raise ValueError(f"the message to {args.element} carries nothing to ask")
        reply = CLIENTS[provider](model, parts)
        print(f"    {provider}://{model}: {reply.strip()[:160]!r}")
        result = {"result": reply, "durationMs": round((time.perf_counter() - clock) * 1000, 1)}
    except Exception as error:  # noqa: BLE001 - reported to the walk, which records it
        result = {"error": f"{type(error).__name__}: {error}"}
    handoff.write_text(json.dumps({**state, **result}, default=str))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    raise SystemExit(main())

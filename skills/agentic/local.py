#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Play the language-model pools of a studyflow: each message a step sends to one is one request to that model.

A partial runner (skills/local/SKILL.md): `--claims` names every participant that is a model (`studyflow:Actor`,
`actorType: llm`) with no process of its own; `--element <pool> --cache <dir>` answers the message the walk hands
over under `message` in `<pool>.state.json`, and writes the model's reply back as `result`, with a `record` of what
answered and what it was asked: the model and its executor's configuration, and the request as sent.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import time
import urllib.request
from pathlib import Path
from typing import Any

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
AGENTIC = "https://w3id.org/studyflow/agentic"
OLLAMA = "http://localhost:11434"
MAX_TOKENS = 1024


def extension(element: dict[str, Any], namespace: str, kind: str) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == namespace and ext.get("type") == kind), None)


def model_pools(elements: dict[str, dict[str, Any]]) -> list[str]:
    """The participants that are models and have no process of their own."""
    return [
        element_id for element_id, element in elements.items()
        if element.get("type") == "participant" and not (element.get("attributes") or {}).get("processRef")
        and ((extension(element, STUDYFLOW, "actor") or {}).get("attributes") or {}).get("actorType") == "llm"
    ]


def model_of(pool_id: str, pool: dict[str, Any]) -> tuple[str, str]:
    """`claude://<model>` or `ollama://<model>`, as the pool's `implementation` writes it; there is no default."""
    ref = str(((extension(pool, STUDYFLOW, "actor") or {}).get("attributes") or {}).get("implementation") or "")
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


PLACEHOLDER = re.compile(r"\{\s*([^\W\d][\w.-]*)\s*\}")  # the modeler's PLACEHOLDER (packages/core/src/document/state.ts)


def dig(value: Any, fields: list[str]) -> Any:
    for field in fields:
        value = value.get(field) if isinstance(value, dict) else None
        if value is None:
            break
    return value


def resolve(path: str, element_id: str, values: dict[str, Any], plan: dict[str, Any]) -> Any:
    """The placeholder rule (docs/reference.qmd, "Placeholders"): `state` from its root; then, from the element
    outward, what each scope holds under the name; then an element's result, by id or unique name; then, for a lone
    `{reached}`, the element's own counter, 0 when no run reached it. `None` when nothing holds the name."""
    head, *fields = path.split(".")
    tree = values.get("state") or {}
    if head == "state":
        return dig(tree, fields)
    elements = plan.get("elements") or {}
    scope = element_id
    while scope:
        found = dig(tree.get(scope), [head, *fields])
        if found is not None:
            return found
        scope = (elements.get(scope) or {}).get("parent")
    ids = {name: eid for eid, name in (plan.get("names") or {}).items()}
    found = dig(values.get(head, values.get(ids.get(head, ""))), fields)
    if found is None and head == "reached" and not fields:
        # The element's own counter, never a container's: one no run reached counts 0.
        return dig(tree.get("_meta"), ["reached", element_id]) or 0
    return found


def filled(text: str, element_id: str, values: dict[str, Any], plan: dict[str, Any]) -> str:
    """A prompt as the model reads it: each placeholder the state resolves filled in, one it does not left as written."""
    return PLACEHOLDER.sub(lambda m: m.group(0) if (v := resolve(m.group(1), element_id, values, plan)) is None else str(v), text)


def parts_of(content: Any, plan: dict[str, Any], run_dir: Path, values: dict[str, Any], scope: str) -> list[dict[str, Any]]:
    """The request, part by part, in the content's order: a `Prompt`'s text for a null value its id names, an image
    for an image, text for other text, and JSON for anything else. Nothing is added; the prompt's placeholders are
    resolved against the state the walk handed over, from the asking step's scope."""
    elements: dict[str, dict[str, Any]] = plan.get("elements") or {}
    parts: list[dict[str, Any]] = []
    for key, value in (content.items() if isinstance(content, dict) else [(None, content)]):
        if value is None:
            prompt = extension(elements.get(str(key)) or {}, AGENTIC, "prompt")
            text = filled(str((prompt or {}).get("attributes", {}).get("template") or ""), scope, values, plan)
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


def get(url: str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def ask_claude(model: str, parts: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """The reply, and for the record the model asked for, the model the response names, and the options sent."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    content = [
        {"type": "image", "source": {"type": "base64", "media_type": part["image"][0], "data": part["image"][1]}}
        if "image" in part else {"type": "text", "text": part["text"]}
        for part in parts
    ]
    options = {"max_tokens": MAX_TOKENS}
    data = post("https://api.anthropic.com/v1/messages",
                {"model": model, **options, "messages": [{"role": "user", "content": content}]},
                {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=60)
    reply = "".join(block.get("text", "") for block in data.get("content", []))
    return reply, {"model": model, "responseModel": data.get("model"), "options": options}


def listed(model: str) -> dict[str, Any]:
    """The model's digest and quantization, as `/api/tags` lists it (a name without a tag is its `:latest`)."""
    name = model if ":" in model else f"{model}:latest"
    found = next((m for m in get(f"{OLLAMA}/api/tags", timeout=5).get("models", []) if m.get("name") == name), None)
    if found is None:
        raise LookupError(f"/api/tags lists no {name}")
    return {"digest": found.get("digest"), "quantization": (found.get("details") or {}).get("quantization_level")}


def ask_ollama(model: str, parts: list[dict[str, Any]]) -> tuple[str, dict[str, Any]]:
    """The reply, and for the record the model's digest and quantization (`/api/tags`), its default sampling
    parameters (`/api/show`), Ollama's version (`/api/version`) and the options sent. The lookups are best effort: one
    that fails is noted under `unrecorded`, and the answer stands."""
    message = {
        "role": "user",
        "content": "\n\n".join(part["text"] for part in parts if "text" in part),
        "images": [part["image"][1] for part in parts if "image" in part],
    }
    # `think: false` keeps a thinking model to its answer: a trial window is seconds long.
    options = {"stream": False, "think": False}
    data = post(f"{OLLAMA}/api/chat", {"model": model, **options, "messages": [message]}, {}, timeout=120)
    record: dict[str, Any] = {"model": model, "options": options}
    # ponytail: three lookups a hand-off, after the answer; keep them in the cache folder if a trial window feels them.
    for path, look in (
        ("/api/tags", lambda: listed(model)),
        ("/api/show", lambda: {"parameters": post(f"{OLLAMA}/api/show", {"model": model}, {}, timeout=5).get("parameters")}),
        ("/api/version", lambda: {"version": f"ollama {get(f'{OLLAMA}/api/version', timeout=5)['version']}"}),
    ):
        try:
            record.update(look())
        except Exception as error:  # noqa: BLE001 - best effort: noted in the record, never failing the answer
            record.setdefault("unrecorded", {})[path] = f"{type(error).__name__}: {error}"
    return data["message"]["content"], record


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

    plan: dict[str, Any] = json.loads(args.plan.read_text())
    elements: dict[str, dict[str, Any]] = plan.get("elements") or {}
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
        message = state.get("message") or {}
        # Placeholders resolve from the asking step's scope: the flow's `sourceRef`, else the pool itself.
        asked_by = str(((elements.get(str(message.get("flow"))) or {}).get("attributes") or {}).get("sourceRef") or args.element)
        parts = parts_of(message.get("content"), plan, run_dir, state, asked_by)
        if not parts:
            raise ValueError(f"the message to {args.element} carries nothing to ask")
        reply, record = CLIENTS[provider](model, parts)
        print(f"    {provider}://{model}: {reply.strip()[:160]!r}")
        # The request as sent: its text, as far as a record needs it, and how many images went with it.
        texts = "\n\n".join(part["text"] for part in parts if "text" in part)
        record["sent"] = {"text": texts[:4000], "images": sum("image" in part for part in parts)}
        result = {"result": reply, "durationMs": round((time.perf_counter() - clock) * 1000, 1), "record": record}
    except Exception as error:  # noqa: BLE001 - reported to the walk, which records it
        result = {"error": f"{type(error).__name__}: {error}"}
    handoff.write_text(json.dumps({**state, **result}, default=str))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    raise SystemExit(main())

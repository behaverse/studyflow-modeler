#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Play the language-model pools of a studyflow: each message a step sends to one is one request to that model.

A partial runner (packages/runtime-local/CONTRACT.md): it claims every participant with no process of its own whose actor's
`implementation` names a model (`claude://…`, `ollama://…`), and answers each message the walk hands to one with
the model's reply, and a record of what answered and what it was asked: the model and its executor's configuration,
and the request as sent.
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[2] / "packages" / "runtime-local" / "python"))
from runner import Step, fill, serve  # noqa: E402 - the runner SDK, beside the local runtime

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
AGENTIC = "https://w3id.org/studyflow/agentic"
OLLAMA = "http://localhost:11434"
MAX_TOKENS = 1024


def extension(element: dict[str, Any], namespace: str, kind: str) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == namespace and ext.get("type") == kind), None)


def model_pools(plan: dict[str, Any]) -> list[str]:
    """The participants with no process of their own whose `implementation` names a model this runner asks
    (`ollama://…`, `claude://…`): the scheme says who plays the pool, so swapping the model, or the actor, is that
    one line."""
    return [
        element_id for element_id, element in (plan.get("elements") or {}).items()
        if element.get("type") == "participant" and not (element.get("attributes") or {}).get("processRef")
        and str(((extension(element, STUDYFLOW, "actor") or {}).get("attributes") or {}).get("implementation") or "")
        .split("://", 1)[0] in CLIENTS
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


def parts_of(content: Any, plan: dict[str, Any], run_dir: Path, values: dict[str, Any], scope: str) -> list[dict[str, Any]]:
    """The request, part by part, in the content's order: a `Prompt`'s text for a null value its id names, an image
    for an image, and for any other value its name, then the value as text, or as JSON when it is not text
    (`Stimulus: {"Value": "3"}`). The name is the element's that its key is, else the key itself (a field of a
    trial). Nothing else is added; the prompt's placeholders are resolved against the state the walk handed over, from
    the asking step's scope."""
    elements: dict[str, dict[str, Any]] = plan.get("elements") or {}
    parts: list[dict[str, Any]] = []
    for key, value in (content.items() if isinstance(content, dict) else [(None, content)]):
        if value is None:
            prompt = extension(elements.get(str(key)) or {}, AGENTIC, "prompt")
            text = fill(str((prompt or {}).get("attributes", {}).get("template") or ""), scope, values, plan)
            if text:
                parts.append({"text": text})
        elif isinstance(value, str) and (image := image_of(value, run_dir)):
            parts.append({"image": image})
        else:
            text = value if isinstance(value, str) else json.dumps(value)
            name = (elements.get(str(key)) or {}).get("name") or key
            parts.append({"text": text if key is None else f"{name}: {text}"})
    return parts


def post(url: str, body: dict[str, Any], headers: dict[str, str], timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def get(url: str, timeout: float) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.load(response)


def ask_claude(model: str, parts: list[dict[str, Any]], history: list[dict[str, Any]] = ()) -> tuple[str, dict[str, Any]]:  # type: ignore[assignment]
    """The reply, and for the record the model asked for, the model the response names, and the options sent. `history`
    is the conversation so far, turn by turn (`{"role", "parts"}`), when the pool remembers."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    def content(turn: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"type": "image", "source": {"type": "base64", "media_type": part["image"][0], "data": part["image"][1]}}
            if "image" in part else {"type": "text", "text": part["text"]}
            for part in turn
        ]
    options = {"max_tokens": MAX_TOKENS}
    messages = [{"role": turn["role"], "content": content(turn["parts"])} for turn in [*history, {"role": "user", "parts": parts}]]
    data = post("https://api.anthropic.com/v1/messages",
                {"model": model, **options, "messages": messages},
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


DESCRIBED: dict[str, dict[str, Any]] = {}


def described(model: str) -> dict[str, Any]:
    """For the record, the model's digest and quantization (`/api/tags`), its default sampling parameters
    (`/api/show`) and Ollama's version (`/api/version`), looked up once a run. The lookups are best effort: one that
    fails is noted under `unrecorded`, and is tried again at the next message."""
    if model in DESCRIBED:
        return DESCRIBED[model]
    record: dict[str, Any] = {}
    for path, look in (
        ("/api/tags", lambda: listed(model)),
        ("/api/show", lambda: {"parameters": post(f"{OLLAMA}/api/show", {"model": model}, {}, timeout=5).get("parameters")}),
        ("/api/version", lambda: {"version": f"ollama {get(f'{OLLAMA}/api/version', timeout=5)['version']}"}),
    ):
        try:
            record.update(look())
        except Exception as error:  # noqa: BLE001 - best effort: noted in the record, never failing the answer
            record.setdefault("unrecorded", {})[path] = f"{type(error).__name__}: {error}"
    if "unrecorded" not in record:
        DESCRIBED[model] = record
    return record


def ask_ollama(model: str, parts: list[dict[str, Any]], history: list[dict[str, Any]] = ()) -> tuple[str, dict[str, Any]]:  # type: ignore[assignment]
    """The reply, and for the record the options sent and what answered (`described`). `history` is the conversation so
    far, turn by turn (`{"role", "parts"}`), when the pool remembers."""
    messages = [{
        "role": turn["role"],
        "content": "\n\n".join(part["text"] for part in turn["parts"] if "text" in part),
        "images": [part["image"][1] for part in turn["parts"] if "image" in part],
    } for turn in [*history, {"role": "user", "parts": parts}]]
    # `think: false` keeps a thinking model to its answer: a trial window is seconds long.
    options = {"stream": False, "think": False}
    data = post(f"{OLLAMA}/api/chat", {"model": model, **options, "messages": messages}, {}, timeout=120)
    return data["message"]["content"], {"model": model, "options": options, **described(model)}


CLIENTS = {"claude": ask_claude, "ollama": ask_ollama}


# The conversations this run has had with the pools that remember, by the id the walk gives each: turn by turn,
# what was sent and what the model answered. They last the run.
CONVERSATIONS: dict[str, list[dict[str, Any]]] = {}


def execute(step: Step) -> str:
    provider, model = model_of(step.id, step.element)
    if provider not in CLIENTS:
        raise ValueError(f"{step.id}: this runner speaks {', '.join(CLIENTS)}, not {provider}://")
    message = step.message or {}
    # Placeholders resolve from the asking step's scope: the flow's `sourceRef`, else the pool itself.
    asked_by = str(((step.elements.get(str(message.get("flow"))) or {}).get("attributes") or {}).get("sourceRef") or step.id)
    parts = parts_of(message.get("content"), step.plan, step.run_dir, step.values, asked_by)
    if not parts:
        raise ValueError(f"the message to {step.id} carries nothing to ask")
    history: list[dict[str, Any]] = []
    if step.conversation:
        history = CONVERSATIONS.setdefault(step.conversation["id"], [])
        if len(history) != 2 * step.conversation["turn"]:
            raise RuntimeError(f"{step.id}: the conversation '{step.conversation['id']}' is at turn {step.conversation['turn']}, and this "
                               f"runner holds {len(history) // 2} of its exchanges: it was started again, and lost them")
    reply, record = CLIENTS[provider](model, parts, history)
    print(f"{provider}://{model}: {reply.strip()[:160]!r}")
    # The request as sent: its text, as far as a record needs it, how many images went with it, and after how many
    # exchanges of its conversation.
    texts = "\n\n".join(part["text"] for part in parts if "text" in part)
    sent = {"text": texts[:4000], "images": sum("image" in part for part in parts)}
    if step.conversation:
        sent["turn"] = step.conversation["turn"]
        history += [{"role": "user", "parts": parts}, {"role": "assistant", "parts": [{"text": reply}]}]
    step.note(**record, sent=sent)
    return reply


if __name__ == "__main__":
    raise SystemExit(serve(model_pools, execute))

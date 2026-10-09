#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""A simulated participant that knows no task (SKILL.md beside this file).

A partial runner (packages/runtime-local/CONTRACT.md): it claims every pool without a process whose actor's
`implementation` is `simulate://random`, and answers each message sent to it with one of the options the message lists
(`ResponseOptions`), drawn by the run's seed and the message's id; a message that lists none is an instruction, which
it confirms with `READY`. It knows no task, so it plants no effect: a study that needs a known truth draws a taker of
the task's own skill (a Behaverse task's `behaverse:SimulatedTaker`).
"""

from __future__ import annotations

import os
import random
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[2] / "packages" / "runtime-local" / "python"))
from runner import Step, serve  # noqa: E402 - the runner SDK, beside the local runtime

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
RANDOM = "simulate://random"


def implementation_of(element: dict[str, Any]) -> str:
    """A pool's actor `implementation`."""
    actor = next((ext for ext in element.get("extensions") or []
                  if ext.get("namespace") == STUDYFLOW and ext.get("type") == "actor"), None)
    return str(((actor or {}).get("attributes") or {}).get("implementation") or "")


def claims(plan: dict[str, Any]) -> list[str]:
    return [eid for eid, element in (plan.get("elements") or {}).items() if element.get("type") == "participant"
            and not (element.get("attributes") or {}).get("processRef") and implementation_of(element).split("@")[0] == RANDOM]


def options_in(content: Any) -> list[str]:
    """The options a message lists: its own `ResponseOptions`, else those of the one value of it that lists some."""
    if isinstance(content, dict) and content.get("ResponseOptions"):
        return [str(option) for option in content["ResponseOptions"]]
    values = content.values() if isinstance(content, dict) else []
    return next(([str(option) for option in value["ResponseOptions"]] for value in values
                 if isinstance(value, dict) and value.get("ResponseOptions")), [])


def answer(seed: Any, message: dict[str, Any]) -> str:
    """One option the message lists, drawn by the seed and the message's id; `READY` when it lists none."""
    options = options_in(message.get("content"))
    return random.Random(f"{seed}:{message.get('id')}").choice(options) if options else "READY"


def execute(step: Step) -> Any:
    step.note(actor=RANDOM)
    return answer(step.seed, step.message or {})


if __name__ == "__main__":
    raise SystemExit(serve(claims, execute))

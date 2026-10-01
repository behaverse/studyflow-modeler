#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Run the `shell://` elements of a studyflow.

A partial runner (packages/runtime-local/CONTRACT.md): it claims every element whose `implementation` is `shell://<command>`
and, per hand-off, runs that command in the run directory with the element's `additionalArguments` as its argument list
(`args` positional, other keys as flags), each `{placeholder}` filled by the rule in docs/reference.qmd. Its stdout
becomes the element's `result`; a non-zero exit is the element's error. Live: a command is a side effect,
never skipped or replayed.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[2] / "packages" / "runtime-local" / "python"))
from runner import Cancelled, Step, fill, serve  # noqa: E402 - the runner SDK, beside the local runtime

SCHEME = "shell://"


def command_of(element: dict[str, Any]) -> str | None:
    implementation = str((element.get("attributes") or {}).get("implementation") or "")
    return implementation[len(SCHEME):].split("@")[0] if implementation.startswith(SCHEME) else None


def claimed(plan: dict[str, Any]) -> list[str]:
    """Plain steps only: a vocabulary step naming a shell:// command (a `reachy:Interact`) is its own runner's."""
    return [eid for eid, element in (plan.get("elements") or {}).items() if command_of(element) is not None and not element.get("extensions")]


def argv_of(element: dict[str, Any], values: dict[str, Any], plan: dict[str, Any]) -> list[str]:
    command = command_of(element)
    if command is None:
        raise ValueError(f"{element.get('id')} is not a {SCHEME} element")
    arguments = yaml.safe_load(element.get("additionalArguments") or "") or {}
    if not isinstance(arguments, dict):
        raise ValueError(f"{element.get('id')}: additionalArguments must be a mapping (`args` lists positional ones)")
    argv = [command]
    for key, value in arguments.items():
        if key == "args":
            continue
        argv += [f"-{key}" if len(str(key)) == 1 else f"--{key}", *([] if value is None else [fill(value, element["id"], values, plan)])]
    return argv + [fill(v, element["id"], values, plan) for v in (arguments.get("args") or [])]


def execute(step: Step) -> str:
    """The command, run in the run directory; its stdout is the result. A step the walk stops ends its command."""
    argv = argv_of(step.element, step.values, step.plan)
    print(f"$ {' '.join(argv)}", file=sys.stderr)
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=step.run_dir, stdin=subprocess.DEVNULL)  # noqa: S603 - the diagram's own command
    while True:
        try:
            out, err = process.communicate(timeout=0.2)
            break
        except subprocess.TimeoutExpired:
            if step.cancelled:
                process.kill()
                process.communicate()
                raise Cancelled(f"{argv[0]} was stopped") from None
    if err.strip():
        print(err.rstrip(), file=sys.stderr)
    if process.returncode != 0:
        raise RuntimeError(f"{argv[0]} exited with code {process.returncode}")
    return out.strip()


if __name__ == "__main__":
    sys.exit(serve(claimed, execute))

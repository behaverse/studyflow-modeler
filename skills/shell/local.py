#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Run the `shell://` elements of a studyflow.

A partial runner: it claims every element whose `implementation` is `shell://<command>` and, per hand-off,
runs that command in the run directory with the element's `additionalArguments` as its argument list
(`args` positional, other keys as flags), `{Name.field}` citations filled from the run's values. Its stdout
becomes the element's `result`; a non-zero exit is the element's error. Live: a command is a side effect,
never skipped or replayed.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import yaml

SCHEME = "shell://"


def command_of(element: dict[str, Any]) -> str | None:
    implementation = str((element.get("attributes") or {}).get("implementation") or "")
    return implementation[len(SCHEME):].split("@")[0] if implementation.startswith(SCHEME) else None


def claimed(elements: dict[str, dict[str, Any]]) -> list[str]:
    """Plain steps only: a vocabulary step naming a shell:// command (a `reachy:Say`) is its own runner's."""
    return [eid for eid, element in elements.items() if command_of(element) is not None and not element.get("extensions")]


def fill(text: str, values: dict[str, Any], names: dict[str, str]) -> str:
    """`{Answer.trials}`: an element (by id or name), then its fields; a citation nothing binds stays as written."""
    ids = {name: eid for eid, name in names.items()}

    def cite(match: re.Match[str]) -> str:
        head, *fields = match.group(1).split(".")
        value: Any = values.get(head, values.get(ids.get(head, "")))
        for field in fields:
            value = value.get(field) if isinstance(value, dict) else getattr(value, field, None)
            if value is None:
                break
        return match.group(0) if value is None else str(value)

    return re.sub(r"\{([^{}]+)\}", cite, text)


def argv_of(element: dict[str, Any], values: dict[str, Any], names: dict[str, str]) -> list[str]:
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
        argv += [f"-{key}" if len(str(key)) == 1 else f"--{key}", *([] if value is None else [str(value)])]
    argv += [str(v) for v in (arguments.get("args") or [])]
    return [fill(arg, values, names) for arg in argv]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plan", type=Path, help="the plan digest studyflow-run-local hands over (plan.json)")
    parser.add_argument("--element", metavar="ID", default=None, help="hand-off mode: execute this one element")
    parser.add_argument("--claims", action="store_true", help="print the claimed element ids and exit")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state dir")
    # Accepted so studyflow-run-local can pass its shared runner flags; this runner has no use for them.
    parser.add_argument("--sim", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--auto", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    digest = json.loads(args.plan.read_text())
    elements: dict[str, dict[str, Any]] = digest.get("elements") or {}
    if args.claims:
        print(json.dumps(claimed(elements)))
        return 0
    if not args.element:
        parser.error("this runner performs one element at a time: pass --element or --claims")

    cache = args.cache or Path(".")
    run_dir = cache.resolve().parent if args.cache else Path.cwd()
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}
    clock = time.perf_counter()
    try:
        element = elements.get(args.element)
        if element is None:
            raise KeyError(f"no element {args.element!r} in the diagram")
        argv = argv_of(element, state, digest.get("names") or {})
        print(f"$ {' '.join(argv)}", file=sys.stderr)
        done = subprocess.run(argv, capture_output=True, text=True, cwd=run_dir, stdin=subprocess.DEVNULL)  # noqa: S603 - the diagram's own command
        if done.stderr.strip():
            print(done.stderr.rstrip(), file=sys.stderr)
        if done.returncode != 0:
            raise RuntimeError(f"{argv[0]} exited with code {done.returncode}")
        state[args.element] = state["result"] = done.stdout.strip()
        state["durationMs"] = round((time.perf_counter() - clock) * 1000, 1)
    except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
        state["error"] = f"{type(error).__name__}: {error}"
    cache.mkdir(parents=True, exist_ok=True)
    handoff.write_text(json.dumps(state, default=str))
    return 1 if "error" in state else 0


if __name__ == "__main__":
    sys.exit(main())

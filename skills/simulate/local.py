#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Simulated tasks and participants with a planted truth (SKILL.md beside this file).

A partial runner (skills/local/SKILL.md): `--claims` names every step whose `implementation` is
`simulate://simon`, `simulate://nback` or `simulate://record`, and every pool without a process whose actor's
`implementation` is `simulate://planted` or `simulate://null`; `--element ID` runs one of them.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import time
from pathlib import Path
from typing import Any

import yaml

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
SCHEME = "simulate://"
STEPS = ("simon", "nback", "record")
ACTORS = ("planted", "null")

# The planted truth: the probability of a correct answer, by task, by condition, by disposition. A study built to
# find a congruency cost and a difference between a cautious and an impulsive instruction should recover both
# from `planted` and neither from `null`.
PLANTED = {
    "planted": {
        ("Simon", "Congruent", "cautious"): 0.95, ("Simon", "Incongruent", "cautious"): 0.80,
        ("Simon", "Congruent", "impulsive"): 0.85, ("Simon", "Incongruent", "impulsive"): 0.60,
        ("NBack", None, "cautious"): 0.90, ("NBack", None, "impulsive"): 0.70,
    },
    "null": {},
}
NULL_ACCURACY = 0.85
MISS_RATE = 1 / 30
SPEED = re.compile(r"\b(fast|first impression)", re.IGNORECASE)
PLACEHOLDER = re.compile(r"\{\s*([^\W\d][\w.-]*)\s*\}")


def implementation_of(element: dict[str, Any]) -> str:
    """The step's `implementation`, or for a pool its actor's."""
    if element.get("type") == "participant":
        actor = next((ext for ext in element.get("extensions") or []
                      if ext.get("namespace") == STUDYFLOW and ext.get("type") == "actor"), None)
        return str(((actor or {}).get("attributes") or {}).get("implementation") or "")
    return str((element.get("attributes") or {}).get("implementation") or "")


def claims(elements: dict[str, dict[str, Any]]) -> list[str]:
    claimed = []
    for element_id, element in elements.items():
        ref = implementation_of(element)
        if not ref.startswith(SCHEME):
            continue
        kind = ref[len(SCHEME):]
        if element.get("type") == "participant":
            if kind in ACTORS and not (element.get("attributes") or {}).get("processRef"):
                claimed.append(element_id)
        elif kind in STEPS:
            claimed.append(element_id)
    return claimed


def rng(*key: Any) -> random.Random:
    return random.Random(":".join(str(part) for part in key))


def simon(seed: Any, step: str, trials: int = 30) -> list[dict[str, Any]]:
    """Half congruent, half incongruent, in a seeded order: a coloured square on one side, answered by its colour."""
    draw = rng(seed, step)
    kinds = ["Congruent", "Incongruent"] * (trials // 2) + ["Congruent"] * (trials % 2)
    draw.shuffle(kinds)
    out = []
    for index, kind in enumerate(kinds, 1):
        colour = draw.choice(["red", "blue"])
        answer = "left" if colour == "red" else "right"
        side = answer if kind == "Congruent" else ("right" if answer == "left" else "left")
        out.append({
            "Task": "Simon", "Block": "Simon", "Trial": index, "Congruency": kind,
            "Stimulus": f"a {colour} square on the {side} of the screen",
            "Rule": "Answer left for a red square and right for a blue one, wherever it appears.",
            "ResponseOptions": ["left", "right"], "Correct": answer,
        })
    return out


def nback(seed: Any, step: str, n: int = 1, trials: int = 28, blocks: list[str] | None = None,
          matchRate: float = 0.33) -> list[dict[str, Any]]:  # noqa: N803 - the attribute's name
    """Digits in blocks; about `matchRate` of them repeat the digit `n` back. Each trial carries the digits before it."""
    draw = rng(seed, step)
    out = []
    for block in blocks or ["Test_A", "Test_B"]:
        digits: list[int] = []
        for index in range(1, trials + 1):
            if len(digits) >= n and draw.random() < matchRate:
                digit = digits[-n]
            else:
                digit = draw.choice([d for d in range(10) if len(digits) < n or d != digits[-n]])
            match = len(digits) >= n and digit == digits[-n]
            out.append({
                "Task": "NBack", "Block": block, "Trial": index, "Digit": digit, "Before": list(digits[-n:]),
                "Rule": f"Answer match when this digit is the one shown {n} before it, else non-match.",
                "ResponseOptions": ["match", "non-match"], "Correct": "match" if match else "non-match",
            })
            digits.append(digit)
    return out


def option_named(reply: Any, options: list[str]) -> str | None:
    """The option a reply names: the whole reply, else the longest option it contains (`non-match` over `match`)."""
    text = str(reply or "").strip().strip(".!\"'").lower()
    by_length = sorted(options, key=len, reverse=True)
    exact = next((option for option in options if option.lower() == text), None)
    return exact or next((option for option in by_length if re.search(rf"(?<![\w-]){re.escape(option.lower())}(?![\w-])", text)), None)


def answer(profile: str, seed: Any, message: dict[str, Any]) -> str:
    """One simulated reply: a trial answered with the planted probability of being right, or an instruction confirmed."""
    content = message.get("content")
    values = content.values() if isinstance(content, dict) else [content]
    trial = next((value for value in values if isinstance(value, dict) and value.get("ResponseOptions")), None)
    if trial is None:
        return "READY"
    instruction = " ".join(value for value in values if isinstance(value, str))
    disposition = "impulsive" if SPEED.search(instruction) else "cautious"
    draw = rng(seed, message.get("id"))
    if draw.random() < MISS_RATE:
        return "I am not sure."
    table = PLANTED[profile]
    p = table.get((trial.get("Task"), trial.get("Congruency"), disposition), NULL_ACCURACY) if table else NULL_ACCURACY
    options = [str(option) for option in trial["ResponseOptions"]]
    wrong = [option for option in options if option != trial.get("Correct")]
    return str(trial.get("Correct")) if draw.random() < p or not wrong else draw.choice(wrong)


def resolve(text: Any, element_id: str, elements: dict[str, dict[str, Any]], state: dict[str, Any]) -> Any:
    """`{name}` by the placeholder rule's first two steps: `state` from its root, then the scopes outward."""
    if not isinstance(text, str):
        return text
    tree = state.get("state") or {}

    def lookup(path: str) -> Any:
        head, *fields = path.split(".")
        if head == "state":
            value: Any = tree
            fields = list(fields)
        else:
            scope, value = element_id, None
            while scope and value is None:
                value = (tree.get(scope) or {}).get(head)
                scope = str((elements.get(scope) or {}).get("parent") or "")
        for field in fields:
            value = value.get(field) if isinstance(value, dict) else None
        return value

    whole = PLACEHOLDER.fullmatch(text.strip())
    if whole:
        return lookup(whole.group(1))
    return PLACEHOLDER.sub(lambda m: str(lookup(m.group(1))), text)


def record(element: dict[str, Any], arguments: dict[str, Any], elements: dict[str, dict[str, Any]],
           state: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    """Score the answers against their trials and append one row per trial to the data store the step writes."""
    sources = [binding.get("source") for binding in element.get("inputs") or []]
    lists = [state.get(source) for source in sources if isinstance(state.get(source), list)]
    trials = next((value for value in lists if value and isinstance(value[0], dict)), None)
    answers = next((value for value in lists if value is not trials), None)
    if trials is None or answers is None or len(trials) != len(answers):
        raise ValueError(f"{element['id']} reads a timeline and the answers collected for it, one per trial; "
                         f"got {len(trials or [])} trials and {len(answers or [])} answers")
    subject = resolve(arguments.get("subject"), element["id"], elements, state)
    arm = resolve(arguments.get("arm"), element["id"], elements, state)
    rows = []
    for trial, reply in zip(trials, answers):
        chosen = option_named(reply, [str(o) for o in trial.get("ResponseOptions") or []])
        rows.append({
            "context": {"subject": subject, "state": {"arm": arm}},
            "trialContext": {"task": {"id": trial.get("Task")}, "block": {"name": trial.get("Block")},
                             "trial": {"id": str(trial.get("Trial"))}, "congruency": trial.get("Congruency")},
            "result": {"response": chosen, "isCorrect": None if chosen is None else chosen == trial.get("Correct")},
        })
    target = next((binding.get("target") for binding in element.get("outputs") or [] if binding.get("target")), None)
    uri = ((elements.get(str(target)) or {}).get("attributes") or {}).get("uri") if target else None
    if uri:
        path = run_dir / uri
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as file:  # a trial log: every subject's rows accumulate
            for row in rows:
                file.write(json.dumps(row, separators=(",", ":")) + "\n")
    answered = sum(row["result"]["isCorrect"] is not None for row in rows)
    return {"trials": len(rows), "answered": answered, "failedTrialRate": (len(rows) - answered) / len(rows) if rows else 0.0}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plan", type=Path, help="the plan digest the walk hands over (plan.json)")
    parser.add_argument("--claims", action="store_true", help="print the claimed element ids and exit")
    parser.add_argument("--element", metavar="ID", default=None, help="run this one element")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state: <id>.state.json")
    args = parser.parse_args()

    plan: dict[str, Any] = json.loads(args.plan.read_text())
    elements: dict[str, dict[str, Any]] = plan.get("elements") or {}
    if args.claims:
        print(json.dumps(claims(elements)))
        return 0
    if not args.element:
        parser.error("pass --element or --claims")
    cache = args.cache or Path(".")
    run_dir = cache.parent if cache.name == ".cache" else cache
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}
    seed = (plan.get("study") or {}).get("seed")
    clock = time.perf_counter()
    element = elements.get(args.element) or {}
    kind = implementation_of(element)[len(SCHEME):]
    try:
        arguments = yaml.safe_load(element.get("additionalArguments") or "") or {}
        if element.get("type") == "participant":
            result: Any = answer(kind, seed, state.get("message") or {})
            out: dict[str, Any] = {"result": result, "record": {"actor": f"{SCHEME}{kind}"}}
        elif kind in ("simon", "nback"):
            result = (simon if kind == "simon" else nback)(seed, args.element, **arguments)
            out = {"result": result, **{b["target"]: result for b in element.get("outputs") or [] if b.get("target")}}
        else:
            out = {"result": record(element, arguments, elements, state, run_dir)}
        if element.get("type") != "participant":
            out[args.element] = out["result"]  # the step's own result, which `{Record.failedTrialRate}` reads
        out["durationMs"] = round((time.perf_counter() - clock) * 1000, 1)
    except Exception as error:  # noqa: BLE001 - reported to the walk, which records it
        out = {"error": f"{type(error).__name__}: {error}"}
    cache.mkdir(parents=True, exist_ok=True)
    handoff.write_text(json.dumps({**state, **out}, default=str))
    return 1 if "error" in out else 0


if __name__ == "__main__":
    raise SystemExit(main())

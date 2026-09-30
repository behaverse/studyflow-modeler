#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Simulated tasks and participants with a planted truth (SKILL.md beside this file).

A partial runner (skills/local/SKILL.md): it claims every step whose `implementation` is `simulate://simon`,
`simulate://nback` or `simulate://record`, and every pool without a process whose actor's `implementation` is
`simulate://planted` or `simulate://null`.
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[1] / "local"))
from runner import Step, read, serve  # noqa: E402 - the runner SDK, beside the local runtime

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


def implementation_of(element: dict[str, Any]) -> str:
    """The step's `implementation`, or for a pool its actor's."""
    if element.get("type") == "participant":
        actor = next((ext for ext in element.get("extensions") or []
                      if ext.get("namespace") == STUDYFLOW and ext.get("type") == "actor"), None)
        return str(((actor or {}).get("attributes") or {}).get("implementation") or "")
    return str((element.get("attributes") or {}).get("implementation") or "")


def claims(plan: dict[str, Any]) -> list[str]:
    claimed = []
    for element_id, element in (plan.get("elements") or {}).items():
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


def simon(seed: Any, step: str, trials: int = 30) -> dict[str, list[dict[str, Any]]]:
    """Half congruent, half incongruent, in a seeded order: a coloured square on one side, answered by its colour.
    `trials` is what a subject is shown; `key`, trial by trial, the right answer and the condition, which a subject is
    never sent and the record step scores by."""
    draw = rng(seed, step)
    kinds = ["Congruent", "Incongruent"] * (trials // 2) + ["Congruent"] * (trials % 2)
    draw.shuffle(kinds)
    shown, key = [], []
    for index, kind in enumerate(kinds, 1):
        colour = draw.choice(["red", "blue"])
        answer = "left" if colour == "red" else "right"
        side = answer if kind == "Congruent" else ("right" if answer == "left" else "left")
        shown.append({
            "Task": "Simon", "Block": "Simon", "Trial": index,
            "Stimulus": f"a {colour} square on the {side} of the screen",
            "Rule": "Answer left for a red square and right for a blue one, wherever it appears.",
            "ResponseOptions": ["left", "right"],
        })
        key.append({"Correct": answer, "Congruency": kind})
    return {"trials": shown, "key": key}


def nback(seed: Any, step: str, n: int = 1, trials: int = 28, blocks: list[str] | None = None,
          matchRate: float = 0.33) -> dict[str, list[dict[str, Any]]]:  # noqa: N803 - the attribute's name
    """Digits in blocks; about `matchRate` of them repeat the digit `n` back. Each trial carries the digits before it.
    `trials` is what a subject is shown; `key`, trial by trial, the right answer, which a subject is never sent."""
    draw = rng(seed, step)
    shown, key = [], []
    for block in blocks or ["Test_A", "Test_B"]:
        digits: list[int] = []
        for index in range(1, trials + 1):
            if len(digits) >= n and draw.random() < matchRate:
                digit = digits[-n]
            else:
                digit = draw.choice([d for d in range(10) if len(digits) < n or d != digits[-n]])
            match = len(digits) >= n and digit == digits[-n]
            shown.append({
                "Task": "NBack", "Block": block, "Trial": index, "Digit": digit, "Before": list(digits[-n:]),
                "Rule": f"Answer match when this digit is the one shown {n} before it, else non-match.",
                "ResponseOptions": ["match", "non-match"],
            })
            key.append({"Correct": "match" if match else "non-match"})
            digits.append(digit)
    return {"trials": shown, "key": key}


def key_of(trial: dict[str, Any]) -> dict[str, Any]:
    """What a subject can tell from a trial as shown, by its rule: the right answer, and for a Simon trial whether
    the square sits on the side of its answer. The simulated subject answers by this, never by the timeline's key."""
    if trial.get("Task") == "Simon":
        colour, side = re.search(r"a (\w+) square on the (\w+)", str(trial.get("Stimulus"))).groups()
        correct = "left" if colour == "red" else "right"
        return {"Correct": correct, "Congruency": "Congruent" if side == correct else "Incongruent"}
    n = int(re.search(r"shown (\d+) before", str(trial.get("Rule"))).group(1))
    before = trial.get("Before") or []
    return {"Correct": "match" if len(before) >= n and before[-n] == trial.get("Digit") else "non-match"}


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
    truth = key_of(trial)
    p = table.get((trial.get("Task"), truth.get("Congruency"), disposition), NULL_ACCURACY) if table else NULL_ACCURACY
    options = [str(option) for option in trial["ResponseOptions"]]
    wrong = [option for option in options if option != truth["Correct"]]
    return truth["Correct"] if draw.random() < p or not wrong else draw.choice(wrong)


def record(element: dict[str, Any], arguments: dict[str, Any], plan: dict[str, Any],
           state: dict[str, Any], run_dir: Path) -> dict[str, Any]:
    """Score the answers by the timeline's key and append one row per trial to the data store the step writes."""
    sources = [binding.get("source") for binding in element.get("inputs") or []]
    lists = [state.get(source) for source in sources if isinstance(state.get(source), list)]
    listing = lambda field: next((value for value in lists if value and isinstance(value[0], dict) and field in value[0]), None)  # noqa: E731
    trials, key = listing("ResponseOptions"), listing("Correct")
    answers = next((value for value in lists if value is not trials and value is not key), None)
    if trials is None or key is None or answers is None or not len(trials) == len(key) == len(answers):
        raise ValueError(f"{element['id']} reads a timeline's trials and key, and the answers collected for it, one per trial; "
                         f"got {len(trials or [])} trials, {len(key or [])} keys and {len(answers or [])} answers")
    subject = read(arguments.get("subject"), element["id"], state, plan)
    arm = read(arguments.get("arm"), element["id"], state, plan)
    rows = []
    for trial, truth, reply in zip(trials, key, answers):
        chosen = option_named(reply, [str(o) for o in trial.get("ResponseOptions") or []])
        rows.append({
            "context": {"subject": subject, "state": {"arm": arm}},
            "trialContext": {"task": {"id": trial.get("Task")}, "block": {"name": trial.get("Block")},
                             "trial": {"id": str(trial.get("Trial"))}, "congruency": truth.get("Congruency")},
            "result": {"response": chosen, "isCorrect": None if chosen is None else chosen == truth.get("Correct")},
        })
    target = next((binding.get("target") for binding in element.get("outputs") or [] if binding.get("target")), None)
    uri = (((plan.get("elements") or {}).get(str(target)) or {}).get("attributes") or {}).get("uri") if target else None
    if uri:
        path = run_dir / uri
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as file:  # a trial log: every subject's rows accumulate
            for row in rows:
                file.write(json.dumps(row, separators=(",", ":")) + "\n")
    answered = sum(row["result"]["isCorrect"] is not None for row in rows)
    return {"trials": len(rows), "answered": answered, "failedTrialRate": (len(rows) - answered) / len(rows) if rows else 0.0}


def execute(step: Step) -> Any:
    element = step.element
    kind = implementation_of(element)[len(SCHEME):]
    arguments = yaml.safe_load(element.get("additionalArguments") or "") or {}
    if element.get("type") == "participant":
        step.note(actor=f"{SCHEME}{kind}")
        return answer(kind, step.seed, step.message or {})
    if kind == "record":
        return record(element, arguments, step.plan, step.values, step.run_dir)
    # `{"trials", "key"}`, into the data outputs each edge's transformation selects (`result.trials`, `result.key`).
    result = (simon if kind == "simon" else nback)(step.seed, step.id, **arguments)
    step.outputs(result)
    return result


if __name__ == "__main__":
    raise SystemExit(serve(claims, execute))

"""Self-check of the simulate runner: its claims, its timelines, and the truth each actor plants."""

import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("simulate", Path(__file__).with_name("local.py"))
simulate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulate)

ACTOR = {"namespace": simulate.STUDYFLOW, "type": "actor"}
elements = {
    "Pool": {"type": "participant", "attributes": {}, "extensions": [{**ACTOR, "attributes": {"implementation": "simulate://planted"}}]},
    "Walked": {"type": "participant", "attributes": {"processRef": "P"}, "extensions": [{**ACTOR, "attributes": {"implementation": "simulate://null"}}]},
    "Model": {"type": "participant", "attributes": {}, "extensions": [{**ACTOR, "attributes": {"implementation": "ollama://gemma4"}}]},
    "Timeline": {"type": "serviceTask", "attributes": {"implementation": "simulate://simon"}},
    "Other": {"type": "serviceTask", "attributes": {"implementation": "python://math.sqrt"}},
}
assert simulate.claims({"elements": elements}) == ["Pool", "Timeline"], simulate.claims({"elements": elements})

# A timeline is the seed's alone: every subject meets the same one, and a Simon block is half congruent.
trials = simulate.simon(42, "Timeline", trials=30)
assert trials == simulate.simon(42, "Timeline", trials=30) and len(trials) == 30
assert sum(t["Congruency"] == "Congruent" for t in trials) == 15
blocks = simulate.nback(42, "NB", trials=28)
assert len(blocks) == 56 and all(len(t["Before"]) == (0 if t["Trial"] == 1 else 1) for t in blocks)
assert all((t["Correct"] == "match") == (t["Before"] == [t["Digit"]]) for t in blocks)


def accuracy(profile: str, instruction: str, kind: str) -> float:
    hits = 0
    pool = [t for t in simulate.simon(7, "S", trials=400) if t["Congruency"] == kind]
    for index, trial in enumerate(pool):
        reply = simulate.answer(profile, 7, {"id": f"M.{kind}.{index}", "content": {"T": trial, "I": instruction}})
        hits += reply == trial["Correct"]
    return hits / len(pool)


calm, hasty = "Take your time; accuracy matters more than speed.", "Go with your first impression."
assert accuracy("planted", calm, "Congruent") - accuracy("planted", calm, "Incongruent") > 0.08
assert accuracy("planted", calm, "Incongruent") - accuracy("planted", hasty, "Incongruent") > 0.1
assert abs(accuracy("null", calm, "Congruent") - accuracy("null", hasty, "Incongruent")) < 0.08
assert simulate.answer("planted", 7, {"id": "M.1", "content": {"Check": None}}) == "READY"
assert simulate.option_named("Non-match.", ["match", "non-match"]) == "non-match"
assert simulate.option_named("match", ["match", "non-match"]) == "match"

# A record scores each answer and appends to the store its output names; a second subject adds to it.
with tempfile.TemporaryDirectory() as tmp:
    run = Path(tmp)
    elements = {"Rec": {"id": "Rec", "type": "serviceTask", "parent": "P", "attributes": {"implementation": "simulate://record"},
                    "inputs": [{"source": "Trials"}, {"source": "Answers"}], "outputs": [{"target": "Store"}]},
                "Store": {"type": "dataStoreReference", "attributes": {"uri": "data/trials.jsonl"}}}
    plan = {"elements": elements}
    two = trials[:2]
    state = {"Trials": two, "Answers": [two[0]["Correct"], "maybe"], "state": {"P": {"arm": "calm"}, "_meta": {"instance": {"Pool": 3}}}}
    args = {"subject": "{state._meta.instance.Pool}", "arm": "{arm}"}
    assert simulate.record(elements["Rec"], args, plan, state, run) == {"trials": 2, "answered": 1, "failedTrialRate": 0.5}
    simulate.record(elements["Rec"], args, plan, state, run)
    rows = [json.loads(line) for line in (run / "data/trials.jsonl").read_text().splitlines()]
    assert len(rows) == 4 and rows[0]["context"] == {"subject": 3, "state": {"arm": "calm"}}
    assert [row["result"]["isCorrect"] for row in rows[:2]] == [True, None]
print("simulate: ok")

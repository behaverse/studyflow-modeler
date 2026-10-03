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
simon = simulate.simon(42, "Timeline", trials=30)
trials, key = simon["trials"], simon["key"]
assert simon == simulate.simon(42, "Timeline", trials=30) and len(trials) == len(key) == 30
assert sum(k["Congruency"] == "Congruent" for k in key) == 15
nback = simulate.nback(42, "NB", trials=28)
blocks = nback["trials"]
assert len(blocks) == 56 and all(len(t["Before"]) == (0 if t["Trial"] == 1 else 1) for t in blocks)
assert all((k["Correct"] == "match") == (t["Before"] == [t["Digit"]]) for t, k in zip(blocks, nback["key"]))
# What a subject is sent carries no answer and no condition; the rule and the stimulus give the answer, the key agrees.
assert not any({"Correct", "Congruency"} & set(t) for t in trials + blocks)
assert [simulate.key_of(t) for t in trials] == key and [simulate.key_of(t) for t in blocks] == nback["key"]


def accuracy(profile: str, instruction: str, kind: str) -> float:
    hits = 0
    drawn = simulate.simon(7, "S", trials=400)
    pool = [(t, k) for t, k in zip(drawn["trials"], drawn["key"]) if k["Congruency"] == kind]
    for index, (trial, truth) in enumerate(pool):
        reply = simulate.answer(profile, 7, {"id": f"M.{kind}.{index}", "content": {"T": trial, "I": instruction}})
        hits += reply == truth["Correct"]
    return hits / len(pool)


calm, hasty = "Take your time; accuracy matters more than speed.", "Go with your first impression."
assert accuracy("planted", calm, "Congruent") - accuracy("planted", calm, "Incongruent") > 0.08
assert accuracy("planted", calm, "Incongruent") - accuracy("planted", hasty, "Incongruent") > 0.1
assert abs(accuracy("null", calm, "Congruent") - accuracy("null", hasty, "Incongruent")) < 0.08
assert simulate.answer("planted", 7, {"id": "M.1", "content": {"Check": None}}) == "READY"

# The Behaverse build sends a trial as the message itself, its ResponseOptions at the top level, and the battery's
# prompt by id alone: the subject answers with an option, telling the right one as a person would (the button of the
# target's colour; a digit against the one sent just before it), with the planted accuracy and the prompt's instruction.
BUTTONS = [{"position": "Left", "color": "#FFC826"}, {"position": "Right", "color": "#2D50C8"}]


def shown(side: str, colour: str) -> dict:
    return {"Stimulus": {"Target": {"position": side, "color": colour}, "Buttons": BUTTONS}, "ResponseOptions": ["Left", "Right"]}


def digit(index: int, value: str) -> dict:
    return {"TrialIndex": index, "Stimulus": {"Value": value}, "ResponseOptions": ["Match", "NonMatch"]}


assert simulate.key_of(shown("Right", "#2D50C8")) == {"Correct": "Right", "Congruency": "Congruent"}
assert simulate.key_of(shown("Left", "#2D50C8")) == {"Correct": "Right", "Congruency": "Incongruent"}
assert simulate.key_of(shown("Center", "#FFC826")) == {"Correct": "Left", "Congruency": "Neutral"}
assert simulate.key_of(digit(2, "3"), {"index": 1, "digit": "3"}) == {"Correct": "Match"}
assert simulate.key_of(digit(1, "3"), {"index": 6, "digit": "3"}) == {"Correct": "NonMatch"}
plan = {"elements": {"Msg_Trial": {"type": "messageFlow", "attributes": {"sourceRef": "Subjects"}},
                     "Prompt_Battery": {"extensions": [{"type": "prompt", "attributes": {"template": "{instruction}\nAnswer."}}]}},
        "names": {"P_Instruction": "instruction"}}


def sent(index: int, trial: dict, instruction: str) -> dict:
    message = {"id": f"B.{index}", "flow": "Msg_Trial", "content": {"Prompt_Battery": None, **trial, "Scene": "WO"}}
    return simulate.written_out(message, plan, {"P_Instruction": instruction})


assert sent(0, shown("Right", "#2D50C8"), hasty)["content"]["Prompt_Battery"] == "Go with your first impression.\nAnswer."
replies = {(side, told): [simulate.answer("planted", 7, sent(i, shown(side, "#2D50C8"), told)) for i in range(300)]
           for side in ("Right", "Left") for told in (calm, hasty)}
assert {reply for answers in replies.values() for reply in answers} <= {"Left", "Right", "I am not sure."}
assert replies[("Right", calm)].count("Right") - replies[("Left", calm)].count("Right") > 0.08 * 300
assert replies[("Left", calm)].count("Right") - replies[("Left", hasty)].count("Right") > 0.1 * 300
seen: dict = {}
assert simulate.answer("null", 7, {"id": "N.1", "content": digit(1, "4")}, seen) in ("Match", "NonMatch", "I am not sure.")
assert seen == {"index": 1, "digit": "4"}

# A record scores each answer and appends to the store its output names; a second subject adds to it. An answer that
# is not one of the options, as the study's selection left it, is no answer.
with tempfile.TemporaryDirectory() as tmp:
    run = Path(tmp)
    elements = {"Rec": {"id": "Rec", "type": "serviceTask", "parent": "P", "attributes": {"implementation": "simulate://record"},
                    "inputs": [{"source": "Trials"}, {"source": "Key"}, {"source": "Answers"}], "outputs": [{"target": "Store"}]},
                "Store": {"type": "dataStoreReference", "attributes": {"uri": "data/trials.jsonl"}}}
    plan = {"elements": elements}
    two = trials[:2]
    state = {"Trials": two, "Key": key[:2], "Answers": [key[0]["Correct"], "Left."], "state": {"P": {"arm": "calm"}, "_meta": {"instance": {"Pool": 3}}}}
    args = {"subject": "{state._meta.instance.Pool}", "arm": "{arm}"}
    assert simulate.record(elements["Rec"], args, plan, state, run) == {"trials": 2, "answered": 1, "failedTrialRate": 0.5}
    simulate.record(elements["Rec"], args, plan, state, run)
    rows = [json.loads(line) for line in (run / "data/trials.jsonl").read_text().splitlines()]
    assert len(rows) == 4 and rows[0]["context"] == {"subject": 3, "state": {"arm": "calm"}}
    assert [row["result"]["isCorrect"] for row in rows[:2]] == [True, None]
print("simulate: ok")

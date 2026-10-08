"""Self-check of the simulate runner: its claims, its timelines, and the truth each actor plants."""

import importlib.util
import json
import random
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
    # A Behaverse task on the simulated build, its version after `@` as the Unity build's would carry one.
    "Task": {"type": "task", "attributes": {}, "extensions": [{"namespace": "http://behaverse.org/schemas/studyflow/behaverse",
                                                                "type": "task", "attributes": {"implementation": "simulate://assessment-unity@26.10"}}]},
    "Unity": {"type": "task", "attributes": {}, "extensions": [{"namespace": "http://behaverse.org/schemas/studyflow/behaverse",
                                                                 "type": "task", "attributes": {"implementation": "behaverse://assessment-unity@26.10"}}]},
}
assert simulate.claims({"elements": elements}) == ["Pool", "Timeline", "Task"], simulate.claims({"elements": elements})

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
assert [simulate.perceived(t, {})["correct"] for t in trials] == [k["Correct"] for k in key]
assert [simulate.perceived(t, {})["condition"] for t in trials] == [k["Congruency"] for k in key]
assert [simulate.perceived(t, {})["correct"] for t in blocks] == [k["Correct"] for k in nback["key"]]


def accuracy(profile: str, kind: str) -> float:
    hits = 0
    drawn = simulate.simon(7, "S", trials=400)
    pool = [(t, k) for t, k in zip(drawn["trials"], drawn["key"]) if k["Congruency"] == kind]
    for index, (trial, truth) in enumerate(pool):
        reply = simulate.answer(profile, 7, {"id": f"M.{kind}.{index}", "content": {"T": trial, "I": "Answer each trial."}})
        hits += reply == truth["Correct"]
    return hits / len(pool)


assert accuracy("planted", "Congruent") - accuracy("planted", "Incongruent") > 0.08
assert abs(accuracy("null", "Congruent") - accuracy("null", "Incongruent")) < 0.08
assert simulate.answer("planted", 7, {"id": "M.1", "content": {"Check": None}}) == "READY"

# The Behaverse build sends a trial as the message itself, its ResponseOptions at the top level, and the prompts wired
# into the task by id alone: the subject answers with an option, telling the right one as a person would.
BUTTONS = [{"position": "Left", "color": "#FFC826"}, {"position": "Right", "color": "#2D50C8"}]
MATCH = ["Match", "NonMatch"]


def shown(side: str, colour: str, index: int = 0) -> dict:
    return {"TrialIndex": index, "Stimulus": {"Target": {"position": side, "color": colour}, "Buttons": BUTTONS}, "ResponseOptions": ["Left", "Right"]}


def letters(text: str) -> list[dict]:
    """One block of AX-CPT letters as the build sends them; a lower-case letter is a distractor."""
    return [{"TrialIndex": i, "Stimulus": {"Letter": c.upper(), "IsDistractor": c.islower()}, "ResponseOptions": MATCH} for i, c in enumerate(text)]


def digits(values: str, load: int, start: int = 0) -> list[dict]:
    return [{"TrialIndex": start + i, "Stimulus": {"Value": v, "Load": load}, "ResponseOptions": MATCH} for i, v in enumerate(values)]


def seen_as(trials: list[dict], memory: dict | None = None) -> list[tuple]:
    memory = {} if memory is None else memory
    return [((p := simulate.perceived(trial, memory))["condition"], p["correct"]) for trial in trials]


# Simon: the button of the target's colour, congruent over it, incongruent over the other, neutral between them.
assert simulate.perceived(shown("Right", "#2D50C8"), {}) == {"task": "Simon", "condition": "Congruent", "correct": "Right"}
assert simulate.perceived(shown("Left", "#2D50C8"), {}) == {"task": "Simon", "condition": "Incongruent", "correct": "Right"}
assert simulate.perceived(shown("Center", "#FFC826"), {})["condition"] == "Neutral"
# AX-CPT: cue and probe alternate among the letters, distractors aside; Match is an X right after an A.
assert seen_as(letters("AXBXaAYBY")) == [("Cue", "NonMatch"), ("AX", "Match"), ("Cue", "NonMatch"), ("BX", "NonMatch"),
                                         ("Distractor", "NonMatch"), ("Cue", "NonMatch"), ("AY", "NonMatch"),
                                         ("Cue", "NonMatch"), ("BY", "NonMatch")]
# A block starts afresh: a TrialIndex that does not follow the last one forgets the letters before it.
memory: dict = {}
seen_as(letters("AXA"), memory)
assert seen_as(letters("X"), memory) == [("Cue", "NonMatch")]
# N-back: the digit `Load` before it, the burn-in included in what is remembered; before there is one, the burn-in.
assert seen_as(digits("47471", 2)) == [("BurnIn", "NonMatch"), ("BurnIn", "NonMatch"), ("2-back", "Match"),
                                       ("2-back", "Match"), ("2-back", "NonMatch")]
assert seen_as(digits("3394", 1)) == [("BurnIn", "NonMatch"), ("1-back", "Match"), ("1-back", "NonMatch"), ("1-back", "NonMatch")]
# An older build sends no burn-in (the first trial it asks is the second) and no load: one back, against the last sent.
assert seen_as(digits("33", 1, start=1)) == [("BurnIn", "NonMatch"), ("1-back", "Match")]

# The goal-support arm is told so by a reminder wired into the task, its text beginning with "Reminder:"; the standard
# arm's reminder is empty. The prompt, sent by id, is written out from its template, as a model's runner writes it.
plan = {"elements": {"Msg_Trial": {"type": "messageFlow", "attributes": {"sourceRef": "Subjects"}},
                     "Prompt_Reminder": {"extensions": [{"type": "prompt", "attributes": {"template": "{reminder_axcpt}"}}]}},
        "names": {"P_Reminder": "reminder_axcpt"}}
REMIND = "Reminder: answer Match only to an X that comes right after an A."


def sent(index: int, trial: dict, reminder: str, subject: int = 1) -> dict:
    message = {"id": f"T.{subject}.{index}", "flow": "Msg_Trial", "content": {"Prompt_Reminder": None, **trial, "Scene": "RE"}}
    return simulate.written_out(message, plan, {"P_Reminder": reminder})


assert sent(0, letters("A")[0], REMIND)["content"]["Prompt_Reminder"] == REMIND
assert sent(0, letters("A")[0], "")["content"]["Prompt_Reminder"] == ""


def replies(reminder: str) -> list[str]:
    """One subject's answers to 300 B-X pairs, in one conversation."""
    memory: dict = {}
    return [simulate.answer("planted", 7, sent(i, trial, reminder), memory) for i, trial in enumerate(letters("BX" * 300))]


standard, goal = replies(""), replies(REMIND)
assert set(standard + goal) <= {"Match", "NonMatch", "I am not sure."}
assert goal[1::2].count("NonMatch") - standard[1::2].count("NonMatch") > 0.1 * 300  # the 300 BX probes

# The planted effects are large enough for the study they are planted for. About 20 completers per arm, each taking
# the AX-CPT's four test blocks (160 probes: 64 AX, 16 AY, 16 BX, 64 BY), 80 Simon trials, and two 1-back and four
# 2-back test blocks, as the simulated build presents them, reach one-sided p < .05/9 on each of the three questions:
# Welch's t between arms on each subject's BX - BY error cost, and one-sample t on the Simon incongruent - congruent
# error cost and on 1-back - 2-back accuracy. Null's do not. 3.0 is above Student's critical t for one-sided
# p < .05/9 from 19 degrees of freedom on.
spec = importlib.util.spec_from_file_location("assessment", Path(__file__).with_name("assessment.py"))
assessment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assessment)
draw = random.Random(1)
pairs = ["AX"] * 64 + ["AY"] * 16 + ["BX"] * 16 + ["BY"] * 64
draw.shuffle(pairs)
CODES = {"A": 0, "B": 1, "X": 23, "Y": 24}
LETTERING = {"StimulusType": "UpperCaseLetters", "ResponsePatterns": ["AX"], "UseNonMatchButton": True, "StimulusColor": "#FFFFFF"}
BATTERY = {
    "AX-CPT": [assessment.regex(assessment.Block(f"Test_{k}", {"Parameters": {**LETTERING, "ItemSequence": [
        CODES[letter] for pair in pairs[40 * k:40 * k + 40] for letter in pair]}}), draw) for k in range(4)],
    "Simon": [assessment.which_one(assessment.Block("Test", {
        "Trials": [{"Parameters": {"Congruency": c, "CorrectButton": b}} for c in ("Congruent", "Incongruent") for b in ("Left", "Right")],
        "TrialOrder": {"Replacement": "WithoutInBlock", "ItemOccurrences": 20},
        "Parameters": {"PrimaryFeature": "Color", "SecondaryFeature": "Position", "ButtonColors": ["#FFC826", "#2D50C8"]}}), draw)],
    "N-back": [assessment.nback(assessment.Block(f"Test_{n}_{k}", {"Parameters": {
        "NValue": n, "UseNonMatchButton": True, "Streams": [{"StimulusValue": {"Sequence": {
            "Type": "NBack", "StreamSize": 27 + n, "FeatureValuesCount": 9, "MatchCount": 9}}}]}}), draw)
        for n, count in ((1, 2), (2, 4)) for k in range(count)],
}


def subject(profile: str, arm: str, number: int) -> dict[str, float]:
    """One subject's three measures, from its answers to the battery in one conversation."""
    memory: dict = {}
    right: dict[tuple, list[bool]] = {}
    for task, blocks in BATTERY.items():
        for b, block in enumerate(blocks):
            for index, trial in enumerate(block):
                content = {"Prompt_Reminder": REMIND if arm == "goal support" else "", "TrialIndex": index,
                           "Stimulus": trial["Stimulus"], "ResponseOptions": trial["ResponseOptions"]}
                reply = simulate.answer(profile, 42, {"id": f"{arm}.{number}.{task}.{b}.{index}", "content": content}, memory)
                condition = f"{trial['load']}-back" if task == "N-back" and trial["condition"] != "BurnIn" else trial["condition"]
                right.setdefault((task, condition), []).append(reply == trial["correct"])
    rate = {key: sum(values) / len(values) for key, values in right.items()}
    return {"bx_cost": rate[("AX-CPT", "BY")] - rate[("AX-CPT", "BX")],
            "congruency_cost": rate[("Simon", "Congruent")] - rate[("Simon", "Incongruent")],
            "load_cost": rate[("N-back", "1-back")] - rate[("N-back", "2-back")]}


def mean(values: list[float]) -> float:
    return sum(values) / len(values)


def variance(values: list[float]) -> float:
    return sum((value - mean(values)) ** 2 for value in values) / (len(values) - 1)


def welch(first: list[float], second: list[float]) -> float:
    return (mean(first) - mean(second)) / (variance(first) / len(first) + variance(second) / len(second)) ** 0.5


def one_sample(values: list[float]) -> float:
    return mean(values) / (variance(values) / len(values)) ** 0.5


for profile in ("planted", "null"):
    cohort = {arm: [subject(profile, arm, number) for number in range(1, 21)] for arm in ("standard", "goal support")}
    everyone = cohort["standard"] + cohort["goal support"]
    scores = [welch(*([measures["bx_cost"] for measures in cohort[arm]] for arm in ("standard", "goal support"))),
         one_sample([measures["congruency_cost"] for measures in everyone]),
         one_sample([measures["load_cost"] for measures in everyone])]
    assert [score > 3.0 for score in scores] == [profile == "planted"] * 3, (profile, scores)

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

"""Self-check of the simulated Behaverse build (assessment.py): the trials it presents, as the message the Unity build's
runner sends, how it scores them, the records it writes, and its failed-trial rate. Run it with
`python3 skills/simulate/test_assessment.py`; a scripted responder stands in for the pool that answers."""

import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("assessment", Path(__file__).with_name("assessment.py"))
assessment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assessment)
behaverse = assessment.behaverse
STUDYFLOW, BEHAVERSE = behaverse.STUDYFLOW, behaverse.BEHAVERSE


class Played(behaverse.Step):
    """A hand-off of the task whose messages `reply` answers, as the pool along its flows would."""

    def __init__(self, plan, folder, reply):
        super().__init__("Task", plan, {"state": {"_meta": {"instance": {"Subjects": 3}}, "S": {"arm": "standard"}}},
                         run_dir=folder, cache=folder / ".cache")
        self.reply, self.sent = reply, []

    def ask(self, flow, content, id, timeout=None):  # noqa: A002 - the SDK's own signature
        self.sent.append({"flow": flow, "id": id, "content": content, "timeout": timeout})
        answer = self.reply(content)
        return None if answer is None else {"id": f"a-{id}", "flow": "Msg_Response", "content": answer, "inReplyTo": id}


def plan_of(instrument, parameters, timeline="T"):
    """One subject's pool, whose task sends its trials to an actor's pool and writes its records to a dataset."""
    task = {"id": "Task", "type": "task", "name": "Play", "parent": "S", "attributes": {},
            "extensions": [{"namespace": BEHAVERSE, "type": "task", "attributes": {
                "instrument": instrument, "timeline": timeline, "implementation": "simulate://assessment-unity"}}],
            "inputs": [{"source": "Prompt"}], "outputs": [{"target": "Trials"}], "parameters": parameters}
    elements = {
        "Task": task, "Trials": {"id": "Trials", "attributes": {"uri": "data/trials.jsonl"}},
        "Subjects": {"id": "Subjects", "type": "participant", "attributes": {"processRef": "S"}},
        "Actor": {"id": "Actor", "type": "participant", "name": "Simulated", "attributes": {},
                  "extensions": [{"namespace": STUDYFLOW, "type": "actor", "attributes": {"implementation": "simulate://planted"}}]},
        "Msg_Trial": {"id": "Msg_Trial", "type": "messageFlow", "attributes": {"sourceRef": "Subjects", "targetRef": "Actor"}},
        "Msg_Response": {"id": "Msg_Response", "type": "messageFlow", "attributes": {"sourceRef": "Actor", "targetRef": "Subjects"}},
    }
    return {"study": {"seed": "7"}, "elements": elements}  # as the plan holds it, in text


def played(instrument, parameters, reply, timeline="T"):
    """The task played once: its result, the messages it sent, and its records."""
    with tempfile.TemporaryDirectory() as folder:
        step = Played(plan_of(instrument, parameters, timeline), Path(folder), reply)
        result = assessment.play(step)
        records = [json.loads(line) for line in Path(result["events"]).read_text().splitlines()]
    return result, step.sent, records


def refused(instrument, parameters, message, timeline="T"):
    try:
        played(instrument, parameters, lambda content: "Match", timeline)
    except ValueError as error:
        assert message in str(error), error
        return
    raise AssertionError(f"played what it should refuse: {message}")


def after(skipped, answer):
    """A responder that answers nothing to the first `skipped` trials, then `answer` to every one."""
    calls = []

    def reply(content):
        calls.append(content)
        return None if len(calls) <= skipped else answer
    return reply


def trial_ends(records):
    return [record for record in records if record["object"]["name"].endswith(".TrialEnd")]


# --- AX-CPT (RE): a letter per trial, cue and probe alike, distractors too; the class is the cue and the probe ---
LETTERS = {"StimulusType": "UpperCaseLetters", "ResponsePatterns": {"Generate": "Once", "Sequence": {"Type": "Ordered", "Values": ["AX"]}},
           "UseNonMatchButton": True, "StimulusColor": "#ffffff", "DistractorColor": "#618DA6",
           "StimulusDisplayDuration": 0.5, "InterStimulusInterval": {"Generate": "OncePerBlock", "Sequence": {"Type": "Ordered", "Values": [4.5, 2]}}}
# A X, B X, A Y, B Y, a distractor A, then A X: 0 is A, 23 X, 1 B, 24 Y, and -1 the distractor A.
SEQUENCE = {"ItemSequence": {"Generate": "OncePerBlock", "Sequence": {"Type": "Ordered", "Values": [0, 23, 1, 23, 0, 24, 1, 24, -1, 0, 23]}}}
RE = {"Timelines": {"T": {"Blocks": [{"Instructions": []}, {"Name": "Practice"}, {"Name": "Test"}]}},
      "Blocks": {"Practice": {"Parameters": {**LETTERS, **SEQUENCE, "SequenceLength": 4}}, "Test": {"Parameters": {**LETTERS, **SEQUENCE}}},
      "ScoredBlocks": ["Test"]}
# The responder answers Match to every letter, whatever its case, and nothing to the practice block's four.
result, sent, records = played("RE", RE, after(4, "match"))
ends = trial_ends(records)
assert [record["object"]["name"] for record in (records[0], records[-1])] == ["RE.TaskStart", "RE.TaskEnd"]
assert len(ends) == len(sent) == 4 + 11
test = [record for record in ends if record["trialContext"]["block"]["name"] == "Test"]
assert [record["trialContext"]["condition"] for record in test] == \
    ["Cue", "AX", "Cue", "BX", "Cue", "AY", "Cue", "BY", "Distractor", "Cue", "AX"]
# Match is right only on an X right after an A, distractors aside; an answer naming an option whatever its case counts.
assert [record["result"]["isCorrect"] for record in test] == [c == "AX" for c in ["Cue", "AX", "Cue", "BX", "Cue", "AY", "Cue", "BY", "Distractor", "Cue", "AX"]]
assert all(record["result"]["isAnswered"] and record["result"]["response"] == "Match" for record in test)
# The message is the Unity build's: the task's data inputs, then the trial, its window the protocol's for that letter.
assert sent[4]["content"] == {"Prompt": None, "TrialIndex": 0, "Stimulus": {"Letter": "A", "Color": "#FFFFFF", "IsDistractor": False},
                              "ResponseOptions": ["Match", "NonMatch"], "MaxResponseTime": 5.0, "Scene": "RE"}
assert sent[5]["content"]["MaxResponseTime"] == 2.5 and sent[12]["content"]["Stimulus"]["IsDistractor"] is True
assert sent[12]["content"]["Stimulus"] == {"Letter": "A", "Color": "#618DA6", "IsDistractor": True}
# Each record carries the contract's fields and the runner's own stamp, the subject and the properties in scope.
first = ends[4]
assert first["trialContext"]["task"] == {"id": "RE", "timelineName": "T", "seed": 7}
# The build's ids: the page of instructions takes block id 1, so the test block, the second block of trials, is 3; a
# trial's id counts the timeline's trials from 1, its index in the block from 1 again in each block.
assert first["trialContext"]["block"] == {"id": 3, "name": "Test", "gameBlockIndex": 2}
assert first["trialContext"]["trial"] == {"id": 5, "indexInBlock": 1}
assert [record["trialContext"]["trial"]["id"] for record in ends] == list(range(1, 16))
assert [record["trialContext"]["trial"]["indexInBlock"] for record in ends] == [1, 2, 3, 4] + list(range(1, 12))
assert all(record["trialContext"]["types"] == ["TaskEvent", "BlockEvent", "TrialEvent", "TrialEnd"] for record in ends)
assert first["context"] == {"subject": 3, "state": {"arm": "standard"}}
assert set(first["result"]) == {"isAnswered", "isCorrect", "response", "responseTime"}
assert ends[0]["result"] == {"isAnswered": False, "isCorrect": False, "response": None, "responseTime": None}
# The practice block went unanswered, but only the test block is scored: none of its trials went unanswered.
assert result == {"TaskId": "RE", "TimelineId": "T", "IsCompleted": True, "trials": 11, "failedTrialRate": 0.0, "events": result["events"]}
unscored = {key: value for key, value in RE.items() if key != "ScoredBlocks"}
assert played("RE", unscored, after(4, "Match"))[0]["failedTrialRate"] == 4 / 15
# Each request is the subject's own, so two subjects' trials never share an id (which a simulated actor draws by). Its
# block is the block of trials played (1 for the practice, the page before it aside) and its trial the 0-based
# `TrialIndex`, as they always were, so a study run again draws the same answers.
assert [message["id"] for message in sent[:2]] == ["Task.3.1.0", "Task.3.1.1"] and sent[4]["id"] == "Task.3.2.0"
# A responder given a window of its own (the build's `Bot.MaxExternalResponseTime`) is sent it in every trial.
patient = {**RE, "Bot": {"MaxExternalResponseTime": 30, "Speed": 4}}
assert {message["content"]["MaxResponseTime"] for message in played("RE", patient, lambda content: "Match")[1]} == {30.0}

# --- Simon (WO): the cells, each ItemOccurrences times in a seeded order; the disk has the correct button's colour ---
CELLS = [{"Parameters": {"Congruency": congruency, "CorrectButton": button}}
         for congruency in ("Congruent", "Incongruent") for button in ("Left", "Right")]
SIMON = {"PrimaryFeature": "Color", "SecondaryFeature": "Position", "ButtonColors": ["#FFC826", "#2D50C8"], "ButtonSymbols": "Disk",
         "NeutralSymbol": "Disk", "NeutralColor": "#FFFFFF", "MaxResponseTime": 5}
WO = {"Timelines": {"T": {"Blocks": [{"Name": "Simon", "Trials": CELLS, "TrialOrder": {"Replacement": "WithoutInBlock", "ItemOccurrences": 2},
                                      "Parameters": SIMON}]}}}
result, sent, records = played("WO", WO, lambda content: "Left")
ends = trial_ends(records)
assert len(ends) == 8 and sorted(record["trialContext"]["condition"] for record in ends) == ["Congruent"] * 4 + ["Incongruent"] * 4
for message, record in zip(sent, ends):
    stimulus = message["content"]["Stimulus"]
    correct = next(button["position"] for button in stimulus["Buttons"] if button["color"] == stimulus["Target"]["color"])
    assert (stimulus["Target"]["position"] == correct) == (record["trialContext"]["condition"] == "Congruent")
    assert record["result"]["isCorrect"] == (correct == "Left") and message["content"]["MaxResponseTime"] == 5.0
assert sent[0]["content"]["Stimulus"]["Buttons"] == [{"position": "Left", "symbol": "Disk", "color": "#FFC826"},
                                                     {"position": "Right", "symbol": "Disk", "color": "#2D50C8"}]
# The order is the run's seed's, the step's and the block's: every subject meets the same one.
assert [m["content"]["Stimulus"] for m in played("WO", WO, lambda content: "Left")[1]] == [m["content"]["Stimulus"] for m in sent]

# --- N-back (NB): the burn-in is sent too, never scored; the window is the stream's, or the response time when paced ---
DIGITS = {"NValue": 2, "UseNonMatchButton": True, "Feature": "Digits", "StimulusDisplayDuration": 0.5, "InterStimulusInterval": 2.2,
          "Streams": [{"Feature": {"Reference": "Feature"},
                       "StimulusValue": {"Generate": "OncePerBlock", "Sequence": {"Type": "Ordered", "Values": [4, 7, 4, 7, 1, 7]}}}]}
NB = {"Timelines": {"T": {"Blocks": [{"Name": "Two"}]}}, "Blocks": {"Two": {"Parameters": DIGITS}}, "ScoredBlocks": ["Two"]}
result, sent, records = played("NB", NB, after(2, "NonMatch"))
ends = trial_ends(records)
assert [record["trialContext"]["condition"] for record in ends] == ["BurnIn", "BurnIn", "Match", "Match", "NonMatch", "Match"]
assert all(record["trialContext"]["load"] == 2 for record in ends)
assert sent[0]["content"]["Stimulus"] == {"Value": "4", "Load": 2} and sent[0]["content"]["MaxResponseTime"] == 2.7
# A burn-in digit is never scored: its isCorrect is null, answered or not.
assert [record["result"]["isCorrect"] for record in ends] == [None, None, False, False, True, False]
assert result["failedTrialRate"] == 0.0  # the burn-in went unanswered, and is never scored
# Answered, a burn-in digit keeps its answer and response time, and still counts neither way: the four scored digits
# went unanswered, so all of the scored trials failed.
result, sent, records = played("NB", NB, lambda content: "Match" if content["TrialIndex"] < 2 else None)
burn_in = trial_ends(records)[:2]
assert all(record["result"]["isAnswered"] and record["result"]["isCorrect"] is None and record["result"]["response"] == "Match"
           and record["result"]["responseTime"] is not None for record in burn_in)
assert result["failedTrialRate"] == 1.0
# A generated stream holds exactly MatchCount matches, at the seed's places.
generated = {**DIGITS, "PlayerPaced": True, "MaxResponseTime": 3, "StreamSize": 20,
             "Streams": [{"Feature": "Digits", "StimulusValue": {"Generate": "OncePerBlock", "Sequence": {
                 "Type": "NBack", "NValue": {"Reference": "NValue"}, "StreamSize": {"Reference": "StreamSize"},
                 "FeatureValuesCount": 9, "MatchCount": 6, "PreLureCount": 5, "PostLureCount": 5}}}]}
result, sent, records = played("NB", {**NB, "Blocks": {"Two": {"Parameters": generated}}}, lambda content: "Match")
conditions = [record["trialContext"]["condition"] for record in trial_ends(records)]
assert len(conditions) == 20 and conditions.count("Match") == 6 and sent[5]["content"]["MaxResponseTime"] == 3.0

# --- a block's course: an exit rule ends it, and a failed block is played again, up to its repeats ---
TUTORIAL = {**NB, "Blocks": {"Two": {"Parameters": DIGITS, "ExitRules": [{"Trials": 2, "Type": "Failures", "Action": "FailBlock"}, {"Time": 300}]}}}
records = trial_ends(played("NB", TUTORIAL, lambda content: "Match" if content["TrialIndex"] < 2 else "NonMatch")[2])
# Two burn-in digits, then a Match it answers NonMatch, twice: failed, and played again twice more. A replay is a block
# of its own (a new id) under the same name and the same place among the blocks; the burn-in's wrong answers never fail it.
assert [record["trialContext"]["block"]["id"] for record in records] == [1] * 4 + [2] * 4 + [3] * 4
assert {record["trialContext"]["block"]["gameBlockIndex"] for record in records} == {1}
assert [record["trialContext"]["trial"]["id"] for record in records] == list(range(1, 13))
assert [record["trialContext"]["trial"]["indexInBlock"] for record in records] == [1, 2, 3, 4] * 3
assert len(trial_ends(played("NB", TUTORIAL, lambda content: "Match")[2])) == 6  # right throughout: once, to its end
counted = {**NB, "Blocks": {"Two": {"Parameters": DIGITS, "ExitRules": [{"Trials": 4}]}}}
assert len(trial_ends(played("NB", counted, lambda content: "Match")[2])) == 4
# Every entry the timeline plays takes a block id, as in the build: a page of instructions, a break, and, before a failed
# block is played again, the pages right before it marked ShowAgainOnNextBlockFailure. A group's blocks and another
# timeline's are played in its place.
PAGE = {"Instructions": [{"Content": [{"Text": "Read me"}]}]}
paged = {**TUTORIAL, "Timelines": {
    "T": {"Blocks": [PAGE, {**PAGE, "ShowAgainOnNextBlockFailure": True}, {"Name": "Two"},
                     {"Name": "Group", "Blocks": [{"WaitMessage": "Pause", "Duration": 5}, {"Timeline": "Other"}]}]},
    "Other": {"Blocks": [{"Name": "Two"}]}}}
result, sent, records = played("NB", paged, lambda content: "Match" if content["TrialIndex"] < 2 else "NonMatch")
records = trial_ends(records)
# Pages 1 and 2, the block 3, failed: page 2 again as 4, the block 5, failed: 6 and 7, failed, no repeat left; the
# break 8, then the other timeline's block 9, played again as 10 and 11 (no page before it says to show it again).
assert [record["trialContext"]["block"]["id"] for record in records] == [3] * 4 + [5] * 4 + [7] * 4 + [9] * 4 + [10] * 4 + [11] * 4
assert [record["trialContext"]["block"]["gameBlockIndex"] for record in records] == [1] * 12 + [2] * 12
assert [record["trialContext"]["trial"]["id"] for record in records] == list(range(1, 25))
assert [message["id"] for message in sent[::4]] == [f"Task.3.{n}.0" for n in range(1, 7)]  # the request ids, as before

# --- what it cannot play as written it refuses, naming the key ---
refused("RE", {**RE, "Blocks": {**RE["Blocks"], "Test": {"Parameters": LETTERS}}}, "ItemSequence")
refused("RE", {**RE, "Blocks": {**RE["Blocks"], "Test": {"Parameters": {**LETTERS, **SEQUENCE, "ResponsePatterns": ["A*X"]}}}}, "ResponsePatterns")
refused("WO", {"Timelines": {"T": {"Blocks": [{"Name": "Simon", "RepeatTrials": True, "Parameters": SIMON}]}}}, "RepeatTrials")
refused("WO", {"Timelines": {"T": {"Blocks": [{"Name": "Simon", "Trials": CELLS, "Parameters": {**SIMON, "SecondaryFeature": "Flanker"}}]}}},
        "SecondaryFeature")
random_digits = {**DIGITS, "Streams": [{"Feature": "Digits", "StimulusValue": {"Sequence": {"Type": "Random"}}}]}
refused("NB", {**NB, "Blocks": {"Two": {"Parameters": random_digits}}}, "Ordered")
refused("NB", NB, "XCIT_NB_01 is not one", timeline="XCIT_NB_01")
refused("NB", {**NB, "ScoredBlocks": ["Twoo"]}, "ScoredBlocks names Twoo")
refused("NB", {**NB, "Timelines": {"T": {"Blocks": [{"Name": "Two"}, {"Pause": 3}]}}}, "none of the entries the build plays")
refused("NB", {**NB, "Timelines": {"T": {"Blocks": [{"Name": "Two"}, {"Timeline": "T"}]}}}, "timeline T plays itself")
print("simulated build: ok")

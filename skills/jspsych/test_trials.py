"""Self-check of what a jsPsych trial is to the actor and to the record (trials.py): the builds a reference plays, the
timeline the Parameters make, what a trial offers and what each option presses, the message, the response a reply makes,
and the record. Run it with `python3 skills/jspsych/test_trials.py`."""

import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("trials", Path(__file__).with_name("trials.py"))
trials = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trials)


def refused(call, message):
    try:
        call()
    except ValueError as error:
        assert message in str(error), error
        return
    raise AssertionError(f"accepted what it should refuse: {message}")


# A reference is read as the browser runtime reads it, and its builds are the ones that runtime loads from unpkg.
builds = trials.builds_of("jspsych://html-keyboard-response@8")
assert (builds["plugin"], builds["version"], builds["global"]) == ("html-keyboard-response", "8", "jsPsychHtmlKeyboardResponse")
assert trials.unpkg(builds["core"]) == "https://unpkg.com/jspsych@8/dist/index.browser.min.js"
assert trials.unpkg(builds["script"]) == "https://unpkg.com/@jspsych/plugin-html-keyboard-response@2/dist/index.browser.min.js"
assert trials.builds_of("jspsych://plugin-html-button-response@8.3.0")["script"]["package"] == "@jspsych/plugin-html-button-response"
refused(lambda: trials.builds_of("jspsych://html-keyboard-response"), "names no jsPsych version")
refused(lambda: trials.builds_of("jspsych://html-keyboard-response@7"), "jsPsych 7 is not one the local runner plays")
refused(lambda: trials.builds_of("python://m.f"), "no jspsych://")

# The timeline is the browser runtime's, held to the rows its own spec reads (tests/jspsych-trial.unit.spec.ts).
for label, parameters, timeline in json.loads((Path(__file__).parent / "tests" / "timelines.json").read_text(encoding="utf-8")):
    assert trials.timeline_of("P", parameters) == timeline, label
assert trials.variable_names({"timeline_variables": [{"stimulus": "A"}, {"stimulus": "X", "block": "Test"}]}) == ["stimulus", "block"]

# A trial's block, condition, right answer and task are its timeline variables, else its `data`'s fields.
assert trials.field("block", {"block": "Test"}, {"block": "Practice"}) == "Test"
assert trials.field("task", {}, {"task": "AXCPT"}) == "AXCPT" and trials.field("condition", {}, {}) is None

# What a trial offers the actor: the options ResponseOptions names, each pressing its key as the trial's choices spell
# it; without it, the choices themselves. A plugin of buttons responds with the button's place. A trial that takes no
# answer, or any key, offers nothing.
MAPPING = {"Match": "F", "NonMatch": "j"}
assert trials.offered(["f", "j"], True, MAPPING) == {"Match": "f", "NonMatch": "j"}
assert trials.offered(["f", "j"], True, None) == {"f": "f", "j": "j"}
assert trials.offered(["Match", "NonMatch"], False, None) == {"Match": 0, "NonMatch": 1}
assert trials.offered(["Yes", "No"], False, {"Match": "yes"}) == {"Match": 0}
assert trials.offered(["f"], True, MAPPING) == {"Match": "f"}  # a trial that takes fewer keys offers fewer options
assert trials.offered("NO_KEYS", True, MAPPING) == {} and trials.offered("ALL_KEYS", True, None) == {} and trials.offered(None, True, None) == {}
assert trials.response_options({"ResponseOptions": MAPPING, "choices": ["f", "j"]}, "T") == MAPPING
assert trials.response_options({}, "T") is None
refused(lambda: trials.response_options({"ResponseOptions": ["Match", "NonMatch"]}, "T"), "ResponseOptions maps each option")
refused(lambda: trials.response_options({"ResponseOptions": {"Match": "k"}, "choices": ["f", "j"]}, "T"), "do not list (Match: k)")

# The stimulus goes as the text its markup shows, a line per block.
assert trials.text_of('<p style="font-size:60px">A</p>') == "A"
assert trials.text_of("<p>Press <b>F</b></p><p>for &lt;left&gt;</p>") == "Press F\nfor <left>"
assert trials.text_of("<style>p { color: red }</style><div>+</div>") == "+"
assert trials.text_of("<<<<<") == "<<<<<" and trials.text_of("img/a.png") == "img/a.png" and trials.text_of(None) is None

# The task settings are the Parameters' `Bot` entry, which the Behaverse builds read too: the protocol and the settings
# reach the runner merged into one mapping, so they are told apart by key. jsPsych plays all but the runner's keys.
SETTINGS = {"Bot": {"MaxExternalResponseTime": 30, "Speed": 1, "SkipInstructions": True, "AutoClickInstructions": True,
                    "SkipFocusArea": True}}
PROTOCOL = {"choices": ["f", "j"], "trial_duration": 2500, "ResponseOptions": {"Match": "f", "NonMatch": "j"},
            "timeline_variables": [{"stimulus": "A"}]}
assert trials.played({**PROTOCOL, **SETTINGS}) == {"choices": ["f", "j"], "trial_duration": 2500, "timeline_variables": [{"stimulus": "A"}]}
# Its `MaxExternalResponseTime`, above 0, is the seconds the actor has for every trial; the build's own keys mean nothing
# here, and without it (or at 0) the trial's window holds.
assert trials.external_deadline({**PROTOCOL, **SETTINGS}, "T") == 30.0
assert trials.external_deadline(PROTOCOL, "T") is None and trials.external_deadline({"Bot": {"Speed": 1}}, "T") is None
assert trials.external_deadline({"Bot": {"MaxExternalResponseTime": 0}}, "T") is None
refused(lambda: trials.external_deadline({"Bot": {"MaxExternalResponseTime": "30s"}}, "T"), "the seconds the actor has")
refused(lambda: trials.external_deadline({"MaxExternalResponseTime": 30}, "T"), "write it under Bot:")
# The deadline a trial is sent: the settings', else its `trial_duration` in seconds, else the wait for a trial with none.
assert trials.deadline_of({"trial_duration": 2500}, None) == 2.5 and trials.deadline_of({"trial_duration": 2500}, 30.0) == 30.0
assert trials.deadline_of({"trial_duration": None}, None) == trials.WAIT == 30.0 and trials.deadline_of({}, 12.0) == 12.0

# The message is the Behaverse runner's: request id, place in the block, stimulus, options, and the deadline in seconds
# the actor has. What the trial is and its right answer never go with it.
asked = {"stimulus": "<p>X</p>", "choices": ["f", "j"], "trial_duration": 2500, "prompt": "<p>Press F</p>"}
assert trials.message_of("T.1.2.0", 0, asked, {"Match": "f", "NonMatch": "j"}, 2.5) == {
    "RequestId": "T.1.2.0", "TrialIndex": 0, "Stimulus": "X", "ResponseOptions": ["Match", "NonMatch"], "MaxResponseTime": 2.5}
assert trials.message_of("T.1.2.1", 1, asked, {"f": "f"}, 30.0)["MaxResponseTime"] == 30.0

# The reply's option becomes the key it presses (or the button's place), with its time in ms; any other reply, or none
# in time (the exchange's `{}`), is no response.
OFFERED = {"Match": "f", "NonMatch": "j"}
assert trials.answer_of({"Response": "Match", "Agent": "Actor"}, OFFERED, 812.4) == {"response": "f", "rt": 812}
assert trials.answer_of({}, OFFERED, 3000) == {"response": None, "rt": None}
assert trials.answer_of({"Response": "Maybe"}, OFFERED, 10) == {"response": None, "rt": None}
assert trials.answer_of({"Response": "Yes"}, {"Yes": 0, "No": 1}, 10) == {"response": 0, "rt": 10}
# Given longer by the task settings, an answer later than the trial's window reaches jsPsych at the window's end, which
# its own check keeps; one inside the window keeps its time. Without the settings it goes as it came, and jsPsych's check
# drops it as later than the trial's `trial_duration`.
assert trials.answer_of({"Response": "Match"}, OFFERED, 7300.2, window=2500) == {"response": "f", "rt": 2500}
assert trials.answer_of({"Response": "Match"}, OFFERED, 800.0, window=2500) == {"response": "f", "rt": 800}
assert trials.answer_of({"Response": "Match"}, OFFERED, 7300.2) == {"response": "f", "rt": 7300}
assert trials.answer_of({"Response": "Match"}, OFFERED, 7300.2, window=None) == {"response": "f", "rt": 7300}

# The record is the battery's: jsPsych's data say what was answered (a response it dropped as later than the trial's
# window is none), the option names the response, the right answer is compared as jsPsych compares keys, and the time is
# the actor's real latency.
TRIAL = {"task": "AXCPT", "block": "Test", "blockId": 2, "trialId": 7, "index": 2, "condition": "AX", "correct": "F",
         "options": OFFERED, "latency": 640.4}
CONTEXT = {"subject": 4, "state": {"arm": "standard"}}
answered = trials.record_of(TRIAL, {"response": "f", "rt": 640, "stimulus": "X"}, CONTEXT)
assert answered == {
    "object": {"name": "AXCPT.TrialEnd"},
    "trialContext": {"task": {"id": "AXCPT"}, "block": {"id": 2, "name": "Test"}, "trial": {"id": 7, "indexInBlock": 3},
                     "condition": "AX", "types": ["TaskEvent", "BlockEvent", "TrialEvent", "TrialEnd"]},
    "result": {"isAnswered": True, "isCorrect": True, "response": "Match", "responseTime": 0.64},
    "data": {"response": "f", "rt": 640, "stimulus": "X"},
    "context": CONTEXT,
}, answered
assert trials.record_of(TRIAL, {"response": "j", "rt": 300}, CONTEXT)["result"]["isCorrect"] is False
# An answer the settings' deadline let in after the window: jsPsych's row keeps the window's end, the record the real time.
late = trials.record_of({**TRIAL, "latency": 7300.2}, {"response": "f", "rt": 2500}, CONTEXT)
assert late["result"]["responseTime"] == 7.3 and late["data"]["rt"] == 2500 and late["result"]["isAnswered"] is True
dropped = trials.record_of(TRIAL, {"response": None, "rt": None}, CONTEXT)["result"]
assert dropped == {"isAnswered": False, "isCorrect": False, "response": None, "responseTime": None}
assert trials.record_of({**TRIAL, "correct": None}, {"response": "f", "rt": 1}, CONTEXT)["result"]["isCorrect"] is None
assert trials.record_of({**TRIAL, "options": {"Yes": 0, "No": 1}, "correct": 1}, {"response": 1, "rt": 1}, CONTEXT)["result"][
    "response"] == "No"

print("jspsych trials: ok")

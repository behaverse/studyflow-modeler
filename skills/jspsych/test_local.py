"""Self-check of the jspsych skill's local runner (local.py): what it claims, where it takes the jsPsych builds from, the
browser it opens, what it refuses before a timeline starts, how a session asks and records each trial, and what the
trials came to. Run it with `python3 skills/jspsych/test_local.py`; tests/jspsych-local.unit.spec.ts plays a timeline
through it."""

import argparse
import importlib.util
import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))  # local.py imports trials.py from beside it
spec = importlib.util.spec_from_file_location("jspsych_local", Path(__file__).with_name("local.py"))
local = importlib.util.module_from_spec(spec)
spec.loader.exec_module(local)
COGNITIVE = "http://behaverse.org/schemas/studyflow/cognitive"


def task(implementation="jspsych://html-keyboard-response@8", **element):
    return {"id": "AXCPT", "type": "choreographyTask", "parent": "Subject", "attributes": {},
            "extensions": [{"namespace": COGNITIVE, "type": "cognitiveTask", "attributes": {"platform": "jspsych", "implementation": implementation}}],
            **element}


def refused(call, message):
    try:
        call()
    except ValueError as error:
        assert message in str(error), error
        return
    raise AssertionError(f"accepted what it should refuse: {message}")


# It claims every step a jspsych:// reference implements, held on the step or on its cognitive task, and no pool.
elements = {
    "AXCPT": task(),
    "Plain": {"id": "Plain", "type": "userTask", "attributes": {"implementation": "jspsych://html-button-response@8"}},
    "Simon": {"id": "Simon", "type": "task", "attributes": {}, "extensions": [{"namespace": "x", "type": "task", "attributes": {"implementation": "behaverse://assessment-unity"}}]},
    "Pool": {"id": "Pool", "type": "participant", "attributes": {"implementation": "jspsych://html-keyboard-response@8"}},
}
assert local.claimed_steps({"elements": elements}) == ["AXCPT", "Plain"]
# A reference it cannot play stops the run before the walk, naming the step.
refused(lambda: local.claimed_steps({"elements": {"Old": task("jspsych://html-keyboard-response@7")}}), "Old: jsPsych 7 is not one")

# The builds come from a node_modules folder that holds them at the reference's versions, else from unpkg.
with tempfile.TemporaryDirectory() as folder:
    modules = Path(folder)
    for package, version in (("jspsych", "8.3.0"), ("@jspsych/plugin-html-keyboard-response", "2.2.0")):
        (modules / package / "dist").mkdir(parents=True)
        (modules / package / "package.json").write_text(json.dumps({"version": version}))
        (modules / package / "dist" / "index.browser.min.js").write_text("")
    builds = local.trials.builds_of("jspsych://html-keyboard-response@8")
    assert local.local_build(builds["core"], modules) == modules / "jspsych" / "dist" / "index.browser.min.js"
    assert local.local_build(builds["script"], modules) is not None
    assert local.local_build({**builds["core"], "version": "8.3"}, modules) is not None
    assert local.local_build({**builds["core"], "version": "8.2"}, modules) is None  # another 8.x than the one named
    assert local.local_build(local.trials.builds_of("jspsych://survey-text@8")["script"], modules) is None  # not installed
assert local.modules_of(Path("/x")) == Path("/x")

# The browser has no window and is not throttled, though nobody looks at its page.
argv = local.headless_argv("chrome", "http://127.0.0.1:1/", "/tmp/profile")
assert argv[:2] == ["chrome", "--headless=new"] and argv[-1] == "http://127.0.0.1:1/", argv
assert {"--user-data-dir=/tmp/profile", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"} <= set(argv)

# What a timeline cannot play as written it refuses before it starts: an actor answers along message flows only,
# ResponseOptions names keys its choices list, and the actor's deadline is a task setting, under Bot:.
ROWS = [{"block": "Practice", "stimulus": "A"}, {"block": "Test", "stimulus": "X"}]


def performed(parameters, flows=True):
    plan = {"study": {"seed": "7"}, "elements": {
        "AXCPT": task(parameters=parameters),
        "Subjects": {"id": "Subjects", "type": "participant", "attributes": {"processRef": "Subject"}},
        "Actor": {"id": "Actor", "type": "participant", "attributes": {}},
        **({"Msg_Trial": {"type": "messageFlow", "attributes": {"sourceRef": "Subjects", "targetRef": "Actor"}},
            "Msg_Response": {"type": "messageFlow", "attributes": {"sourceRef": "Actor", "targetRef": "Subjects"}}} if flows else {})}}
    with tempfile.TemporaryDirectory() as folder:
        step = local.Step("AXCPT", plan, {}, run_dir=Path(folder))
        local.perform(step, argparse.Namespace(modules=None, port=0, timeout=0, no_browser=True))


refused(lambda: performed({"choices": ["f", "j"], "timeline_variables": ROWS}, flows=False), "which a local run sends along message flows")
refused(lambda: performed({"choices": ["f", "j"], "ResponseOptions": {"Match": "m"}}), "ResponseOptions names what its choices")
refused(lambda: performed({"choices": ["f", "j"], "MaxExternalResponseTime": 30}), "write it under Bot:")


# A session asks the actor about each trial that offers options, as one message along the trial flow, and records the
# data jsPsych keeps for it. The request id is the step's, the subject's, the block's (from 1) and the trial's (from 0);
# a new `block` starts the count again. A trial that offers nothing (a fixation) is neither asked nor recorded.
class Asking:
    """The SDK's exchange, as a session uses it: the message's content, its id, its options and its window go out, and
    the option the answer names comes back (None for none)."""
    flow = "Msg_Trial"

    def __init__(self, replies, wait=0.0):
        self.replies, self.asked, self.wait = replies, [], wait

    def ask(self, content, id, options, window):  # noqa: A002 - the SDK's own field
        self.asked.append({**content, "id": id, "options": options, "window": window})
        time.sleep(self.wait)  # the actor takes its time
        return self.replies.pop(0)


with tempfile.TemporaryDirectory() as folder:
    events = Path(folder) / "trials.jsonl"
    exchange = Asking(["Match", None, "NonMatch"])
    session = local.Session(local.Step("AXCPT", {"elements": {}}, {}), exchange, {"Match": "f", "NonMatch": "j"},
                            {"subject": 2, "state": {"arm": "standard"}}, events)

    def trial(index, block, stimulus, choices=("f", "j"), **variables):
        return {"index": index, "keys": True, "data": {"task": "AXCPT"}, "variables": {"block": block, **variables},
                "parameters": {"stimulus": f"<p>{stimulus}</p>", "choices": list(choices) if choices else "NO_KEYS", "trial_duration": 2000}}

    assert session.respond(trial(0, "Practice", "A", condition="Cue", correct_response="j"))["response"] == "f"
    assert session.respond(trial(1, "Practice", "+", choices=None)) == {"response": None, "rt": None}
    assert session.respond(trial(2, "Test", "A", condition="Cue", correct_response="j")) == {"response": None, "rt": None}
    assert session.respond(trial(3, "Test", "X", condition="AX", correct_response="f"))["response"] == "j"
    # Without task settings, each is sent its own window, its `trial_duration`, as the deadline.
    assert [(message["id"], message["TrialIndex"], message["Stimulus"], message["MaxResponseTime"], message["window"])
            for message in exchange.asked] == [
        ("AXCPT.2.1.0", 0, "A", 2.0, 2.0), ("AXCPT.2.2.0", 0, "A", 2.0, 2.0), ("AXCPT.2.2.1", 1, "X", 2.0, 2.0)]
    for index, response in ((0, "f"), (1, None), (2, None), (3, "j")):
        session.recorded({"index": index, "row": {"response": response, "rt": 5 if response else None}})
    lines = [json.loads(line) for line in events.read_text().splitlines()]
    assert [(line["trialContext"]["block"], line["trialContext"]["trial"]) for line in lines] == [
        ({"id": 1, "name": "Practice"}, {"id": 1, "indexInBlock": 1}), ({"id": 2, "name": "Test"}, {"id": 2, "indexInBlock": 1}),
        ({"id": 2, "name": "Test"}, {"id": 3, "indexInBlock": 2})]
    assert [line["result"]["isCorrect"] for line in lines] == [False, False, False]
    assert lines[0]["object"]["name"] == "AXCPT.TrialEnd" and lines[0]["context"] == {"subject": 2, "state": {"arm": "standard"}}

    # What the trials came to: those answered, and each block's counts, in the shape a Behaverse task's result has.
    assert local.counts(session.records) == {"trials": 2, "blocks": [
        {"block": "Practice", "trials": 1, "answered": 1, "unanswered": 0, "correct": 0},
        {"block": "Test", "trials": 2, "answered": 1, "unanswered": 1, "correct": 0}]}

# With task settings giving the actor 30 s, every trial is sent that deadline, and an answer later than the trial's own
# window (here 10 ms, the actor taking about 50) reaches jsPsych at the window's end, so jsPsych keeps it; the record
# keeps the time it took. Without the settings, the same answer goes as late as it came, for jsPsych to drop.
with tempfile.TemporaryDirectory() as folder:
    def slow(external):
        exchange = Asking(["Match"], wait=0.05)
        session = local.Session(local.Step("AXCPT", {"elements": {}}, {}), exchange, {"Match": "f", "NonMatch": "j"},
                                {"subject": 1, "state": {}}, Path(folder) / "slow.jsonl", external)
        answer = session.respond({"index": 0, "keys": True, "data": {}, "variables": {"block": "Test", "correct_response": "f"},
                                  "parameters": {"stimulus": "X", "choices": ["f", "j"], "trial_duration": 10}})
        return exchange.asked[0], answer, session

    message, answer, session = slow(30.0)
    assert message["MaxResponseTime"] == 30.0 and answer == {"response": "f", "rt": 10}, (message, answer)
    session.recorded({"index": 0, "row": {"response": "f", "rt": 10}})
    assert session.records[0]["result"]["isAnswered"] and session.records[0]["result"]["responseTime"] >= 0.05
    message, answer, _ = slow(None)
    assert message["MaxResponseTime"] == 0.01 and answer["rt"] >= 50, (message, answer)
print("jspsych runner: ok")

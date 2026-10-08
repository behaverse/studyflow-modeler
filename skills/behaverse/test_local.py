"""One check for the failed-trial rate, the context stamped on trials and the option a reply names; run it with
`python3 skills/behaverse/test_local.py`."""

import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("behaverse", Path(__file__).with_name("local.py"))
behaverse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(behaverse)


def task(**attributes):
    return {"id": "Play", "type": "choreographyTask", "parent": "Subject",
            "extensions": [{"namespace": behaverse.BEHAVERSE, "type": "task", "attributes": {"instrument": "NB", **attributes}}]}


# The share of the trials the build showed that it recorded no response for. A `Click` answers a trial, and so does
# a `TrialEnd` with a `responseTime`; the reply this runner sent does not, since the build may have stopped waiting.
def record(*events):
    trials = behaverse.Trials()
    for event in events:
        behaverse.tally(trials, event)
    return trials


def trial(n, types, **rest):
    return {"trialContext": {"block": {"id": 1}, "trial": {"id": n}, "types": types}, **rest}


# WhichOne: 15 trials shown, 10 with a click, as subject 4's events read.
simon = record(*[trial(n, ["TrialStart"]) for n in range(1, 16)],
               *[trial(n, ["Click"]) for n in range(6, 16)])
assert (len(simon.shown), len(simon.answered)) == (15, 10)
assert round(behaverse.failed_trial_rate(simon), 3) == 0.333
# N-back: the trial ends with a `responseTime`, or with none, which is the miss.
nback = record(*[trial(n, ["TrialStart"]) for n in range(1, 5)],
               trial(1, ["TrialEnd"], result={"responseTime": 9.66}), trial(2, ["TrialEnd"], result={"responseTime": None}),
               trial(3, ["TrialEnd"], result={"responseTime": 5.5}), trial(4, ["TrialEnd"], result={}))
assert behaverse.failed_trial_rate(nback) == 0.5
# The N-back's first trial of a block is a burn-in, which takes no response: every stream of its `TrialEnd` says
# `BurnInDisabled`. It is no trial the rate counts, so of the two that took a response, one failed.
def ended(n, response_time, *responses):
    return trial(n, ["TrialEnd"], result={"responseTime": response_time,
                                          "streamResults": [{"userResponseType": kind} for kind in responses]})


burn_in = record(*[trial(n, ["TrialStart"]) for n in range(1, 4)], ended(1, None, "BurnInDisabled", "BurnInDisabled"),
                 ended(2, 1.2, "Hit", "TimeOut"), ended(3, None, "TimeOut", "TimeOut"))
assert behaverse.failed_trial_rate(burn_in) == 0.5
# A build that reports no trial reports no failure; an event with no trial of its own is not one.
assert behaverse.failed_trial_rate(behaverse.Trials()) == 0.0
assert record({"trialContext": {"types": ["AppStarted"]}}).shown == set()


# `ScoredBlocks` counts the trials of those blocks alone. A build that writes the battery's `<TASK>.TrialEnd` says
# itself whether each trial it presented was answered, and its condition: the N-back's burn-in is presented (so the
# responder sees every digit) but never scored. Here the practice block's misses and the burn-in's do not count: of
# the four scored test trials, one went unanswered.
def ends(block, n, answered, condition):
    return {"object": {"name": "NB.TrialEnd"}, "result": {"isAnswered": answered},
            "trialContext": {"block": {"id": block, "name": ["Practice", "Test_A"][block]}, "trial": {"id": n}, "condition": condition}}


battery = record(ends(0, 0, False, "BurnIn"), ends(0, 1, False, "Match"), ends(0, 2, False, "NonMatch"),
                 ends(1, 0, False, "BurnIn"), ends(1, 1, True, "Match"), ends(1, 2, True, "NonMatch"),
                 ends(1, 3, False, "NonMatch"), ends(1, 4, True, "Match"))
assert behaverse.failed_trial_rate(battery, ["Test_A"]) == 0.25
assert behaverse.failed_trial_rate(battery) == 3 / 6  # every block, the burn-in still aside
# An older build's records name their blocks too: the same rule restricts them to the scored ones.
older = record(*[{"trialContext": {"block": {"id": b, "name": ["Practice", "Test_A"][b]}, "trial": {"id": n}, "types": ["TrialStart"]}}
                 for b in (0, 1) for n in (1, 2)],
               {"trialContext": {"block": {"id": 1, "name": "Test_A"}, "trial": {"id": 1}, "types": ["Click"]}})
assert behaverse.failed_trial_rate(older, ["Test_A"]) == 0.5 and behaverse.failed_trial_rate(older) == 0.75
# The runner reads `ScoredBlocks` and never sends it to the build; it is a list of block names, and one the task's
# inline timeline does not play is named before the task starts.
scoring = {**task(timeline="T"), "parameters": {"ScoredBlocks": ["Test_A"], "Timelines": {"T": {"Blocks": [
    {"Instructions": []}, {"Name": "Practice"}, {"Name": "Test_A"}]}}}}
assert behaverse.scored_blocks(scoring) == ["Test_A"] and behaverse.scored_blocks(task()) is None
assert "ScoredBlocks" not in behaverse.task_payload(scoring, auto=True)["parameters"]
assert behaverse.timeline_blocks(scoring["parameters"], "T") == ["Practice", "Test_A"]
assert behaverse.timeline_blocks(scoring["parameters"], "XCIT_NB_01") is None  # the build's own: only it knows
assert behaverse.unplayed(["Test_A", "Test_Z"], ["Practice", "Test_A"]) == ["Test_Z"] and behaverse.unplayed(["X"], None) == []
try:
    behaverse.scored_blocks({**task(), "parameters": {"ScoredBlocks": "Test_A"}})
    raise AssertionError("a ScoredBlocks that is no list was read")
except ValueError as error:
    assert "ScoredBlocks lists the names" in str(error), error

# Every trial line says whose it is: the task's visit count (kept in the study's state, so a loop's iterations number the
# subjects) and the properties in scope at the hand-off, an inner scope shadowing an outer one.
plan = {"Play": task(), "Subject": {"type": "subProcess", "parent": "Study"}}
state = {"state": {"Study": {"arm": "none", "site": "lux"}, "Subject": {"arm": "cautious"},
                   "_meta": {"reached": {"Play": 3}}}}
assert behaverse.trial_context(task(), plan, state) == {"subject": 3, "state": {"arm": "cautious", "site": "lux"}}
assert behaverse.trial_context(task(), plan, {}) == {"subject": 1, "state": {}}
# With a repeating activity around it, the subject is the instance that activity is on, not the task's own count:
# both tasks of one subject stamp the same number, and a task played twice per subject stamps it twice.
subjects = {"state": {"_meta": {"reached": {"Play": 7}, "instance": {"Subject": 2}}}}
assert behaverse.trial_context(task(), plan, subjects)["subject"] == 2
# A pool of several instances is the subject when nothing inside it repeats: the walk keeps its instance under the
# participant's id. The fourth subject plays this task as the third to reach it, the first having left before it.
in_pool = {"Play": task(), "Subject": {"type": "subProcess", "parent": "Study"},
           "Participant_Subject": {"type": "participant", "attributes": {"processRef": "Study"}}}
fourth = {"state": {"_meta": {"reached": {"Play": 3}, "instance": {"Participant_Subject": 4}}}}
assert behaverse.trial_context(task(), in_pool, fourth)["subject"] == 4

# A task inside a sub-process talks along the sub-process's message flows when it draws none of its own.
def flow(fid, source, target):
    return (fid, {"id": fid, "type": "messageFlow", "attributes": {"sourceRef": source, "targetRef": target}})


nested = {"Play": task(), "Subject": {"id": "Subject", "type": "subProcess", "parent": "Study"},
          "Model": {"id": "Model", "type": "participant", "extensions": [
              {"namespace": behaverse.STUDYFLOW, "type": "actor", "attributes": {"actorType": "llm", "implementation": "ollama://gemma4"}}]},
          **dict([flow("M_Trial", "Subject", "Model"), flow("M_Answer", "Model", "Subject")])}
assert behaverse.talking_scope(task(), nested) == "Subject"
assert behaverse.trial_flows(task(), nested) == ("M_Trial", "M_Answer")
assert behaverse.answered_by(task(), nested, auto=False) == "messages"
# Its own flows win: nothing is inherited then.
own = {**nested, **dict([flow("M_Own", "Play", "Model"), flow("M_Back", "Model", "Play")])}
assert behaverse.talking_scope(task(), own) == "Play"
assert behaverse.trial_flows(task(), own) == ("M_Own", "M_Back")

# A task drawn straight in a pool, lane or no lane, talks along the pool's own message flows.
pooled = {"Play": {**task(), "parent": "Example_Study"}, "Model": nested["Model"],
          "Study": {"id": "Study", "type": "participant", "attributes": {"processRef": "Example_Study"}},
          **dict([flow("M_Trial", "Study", "Model"), flow("M_Answer", "Model", "Study")])}
assert behaverse.talking_scope(pooled["Play"], pooled) == "Study"
assert behaverse.trial_flows(pooled["Play"], pooled) == ("M_Trial", "M_Answer")
# The pool also sends the cohort's once-only message to a step in another pool ("all subjects complete"). It names no
# message, so the flows that carry a trial and a response outrank it, as they do in `message_partners`.
def typed(fid, source, target, message):
    return (fid, {"id": fid, "type": "messageFlow", "attributes": {"sourceRef": source, "targetRef": target, "messageRef": message}})


cohort = {**pooled, "A0": {"id": "A0", "type": "startEvent", "parent": "Analysis_Report"},
          "Trial": {"type": "message", "attributes": {"itemRef": "Trial_Item"}},
          "Trial_Item": {"type": "itemDefinition", "attributes": {"structureRef": behaverse.TRIAL}},
          "Response": {"type": "message", "attributes": {"itemRef": "Response_Item"}},
          "Response_Item": {"type": "itemDefinition", "attributes": {"structureRef": behaverse.RESPONSE}},
          **dict([typed("M_Trial", "Study", "Model", "Trial"), typed("M_Answer", "Model", "Study", "Response"),
                  flow("M_Done", "Study", "A0")])}
assert behaverse.trial_flows(cohort["Play"], cohort) == ("M_Trial", "M_Answer")

# Its dataset the same way: one edge on the sub-process is where every task inside it deposits its trials.
trials = {**nested, "Dataset": {"id": "Dataset", "attributes": {"uri": "data/trials.jsonl"}}}
trials["Subject"] = {**trials["Subject"], "outputs": [{"target": "Dataset"}]}
assert behaverse.events_uri(task(), trials) == "data/trials.jsonl"
assert behaverse.events_uri(task(), nested) == "Play.events.jsonl"  # nobody draws one
own_dataset = {**trials, "Own": {"id": "Own", "attributes": {"uri": "play.jsonl"}}}
assert behaverse.events_uri({**task(), "outputs": [{"target": "Own"}]}, own_dataset) == "play.jsonl"
# Every trial carries the task's data inputs too, so the prompt wired into it reaches whoever answers.
assert behaverse.data_inputs({"inputs": [{"source": "Instructions"}, {"source": "Knobs"}]}, {"Knobs": {"n": 1}}) == {
    "Instructions": None, "Knobs": {"n": 1}}
# One drawn dataset, two tasks, four subjects: the first write of a run starts the file, the rest append, and a
# later run starts it again.
import os  # noqa: E402
import tempfile  # noqa: E402

with tempfile.TemporaryDirectory() as folder:
    cache, events = Path(folder), Path(folder) / "data" / "trials.jsonl"
    os.environ["STUDYFLOW_RUN_PID"] = "111"
    assert behaverse.opened_this_run(cache, events) is False  # the first task truncates
    assert behaverse.opened_this_run(cache, events) is True   # the second appends, and so does every later subject
    assert behaverse.opened_this_run(cache, Path(folder) / "Other.events.jsonl") is False  # its own file, its own start
    os.environ["STUDYFLOW_RUN_PID"] = "222"
    assert behaverse.opened_this_run(cache, events) is False  # the next run starts it again
# The stage window runs at full speed even when it is occluded or on another Space.
argv = behaverse.stage_argv("chrome", "http://127.0.0.1:1/", "/tmp/profile")
assert argv[:2] == ["chrome", "--app=http://127.0.0.1:1/"], argv
assert {"--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling"} <= set(argv), argv
print("ok")

# The Unity runner plays the tasks set to the Unity build, checking the build first; one set to the Godot build stops
# the run before its first step, since no runner plays that build yet.
checked = []
unity_plan = {"elements": {"Play": task(), "Other": {"id": "Other", "type": "task"}}}
assert behaverse.claimed_tasks(unity_plan, lambda: checked.append(True)) == ["Play"] and checked == [True]
assert behaverse.claimed_tasks({"elements": {"Play": task(runtime="unity")}}, lambda: None) == ["Play"]
try:
    behaverse.claimed_tasks({"elements": {"Play": task(runtime="godot")}}, lambda: None)
    raise AssertionError("a Godot task was claimed")
except ValueError as error:
    assert "Play is set to the Godot build" in str(error), error

# The option a reply names, read as the browser's model bot reads one (tests/replies.json holds both to it); a send
# task's one data input arrives as a mapping of one value.
for reply, options, named in json.loads((Path(__file__).parent / "tests" / "replies.json").read_text(encoding="utf-8")):
    assert behaverse.option_named(reply, options) == named, (reply, named)
assert behaverse.option_named({"Answer": " match."}, ["Match", "NonMatch"]) == "Match"

# A task the walk stops answers at once, so the walk never has to end this runner, and its window closes behind the
# answer. A sleeping process stands in for the browser, and an empty folder for the build.
import argparse  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402

with tempfile.TemporaryDirectory() as folder:
    build, profile = Path(folder) / "build", Path(folder) / "profile"
    build.mkdir()
    (build / "index.html").write_text("")
    profile.mkdir()
    windows = []
    behaverse.open_stage = lambda url: windows.append(subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)", f"--user-data-dir={profile}"])) or windows[-1]
    step = behaverse.Step("Play", {"elements": {"Play": task(timeline="T")}}, {}, run_dir=Path(folder) / "run")
    stopped = []
    threading.Timer(0.3, lambda: stopped.append(time.monotonic()) or step._cancelled.set()).start()
    try:
        behaverse.perform(step, argparse.Namespace(build=build, port=0, timeout=0, no_browser=False, auto=True))
        raise AssertionError("a stopped task completed")
    except behaverse.Cancelled:
        answered = time.monotonic() - stopped[0]
    assert answered < 0.5, f"a stopped task answered {answered:.2f}s after the stop"
    assert windows[0].wait(timeout=5) is not None  # its window closes
    for _ in range(50):  # and its profile goes
        if not profile.exists():
            break
        time.sleep(0.1)
    assert not profile.exists()

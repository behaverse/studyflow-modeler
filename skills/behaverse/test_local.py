"""One check for the block counts, the payload, who answers a task, what the runner claims, the stage's command line
and a stopped task; run it with `python3 skills/behaverse/test_local.py`. The exchange along message flows and the
records' file and stamp are the runner SDK's, checked by packages/runtime-local/python/test_exchange.py."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("behaverse", Path(__file__).with_name("local.py"))
behaverse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(behaverse)


def task(**attributes):
    return {"id": "Play", "type": "choreographyTask", "parent": "Subject",
            "extensions": [{"namespace": behaverse.BEHAVERSE, "type": "task", "attributes": {"instrument": "NB", **attributes}}]}


# What the task's trials came to, block by block. A `Click` answers a trial, and so does a `TrialEnd` with a
# `responseTime`; the reply this runner sent does not, since the build may have stopped waiting.
def record(*events):
    trials = behaverse.Trials()
    for event in events:
        behaverse.tally(trials, event)
    return trials


def trial(n, types, **rest):
    return {"trialContext": {"block": {"id": 1}, "trial": {"id": n}, "types": types}, **rest}


def counts(block, trials, answered, correct=None):
    return {"block": block, "trials": trials, "answered": answered, "unanswered": trials - answered, "correct": correct}


# WhichOne: 15 trials shown, 10 with a click, as subject 4's events read; the block is unnamed, and nothing says which
# answers were right.
simon = record(*[trial(n, ["TrialStart"]) for n in range(1, 16)],
               *[trial(n, ["Click"]) for n in range(6, 16)])
assert (len(simon.shown), len(simon.answered)) == (15, 10)
assert behaverse.block_counts(simon) == [counts(None, 15, 10)]
# N-back: the trial ends with a `responseTime`, or with none, which is the miss.
nback = record(*[trial(n, ["TrialStart"]) for n in range(1, 5)],
               trial(1, ["TrialEnd"], result={"responseTime": 9.66}), trial(2, ["TrialEnd"], result={"responseTime": None}),
               trial(3, ["TrialEnd"], result={"responseTime": 5.5}), trial(4, ["TrialEnd"], result={}))
assert behaverse.block_counts(nback) == [counts(None, 4, 2)]
# The N-back's first trial of a block is a burn-in, which takes no response: every stream of its `TrialEnd` says
# `BurnInDisabled`. It is no trial the counts hold, so of the two that took a response, one was answered.
def ended(n, response_time, *responses):
    return trial(n, ["TrialEnd"], result={"responseTime": response_time,
                                          "streamResults": [{"userResponseType": kind} for kind in responses]})


burn_in = record(*[trial(n, ["TrialStart"]) for n in range(1, 4)], ended(1, None, "BurnInDisabled", "BurnInDisabled"),
                 ended(2, 1.2, "Hit", "TimeOut"), ended(3, None, "TimeOut", "TimeOut"))
assert behaverse.block_counts(burn_in) == [counts(None, 2, 1)]
# A build that reports no trial reports no block; an event with no trial of its own is not one.
assert behaverse.block_counts(behaverse.Trials()) == []
assert record({"trialContext": {"types": ["AppStarted"]}}).shown == set()


# A build that writes the battery's `<TASK>.TrialEnd` says itself whether each trial it presented was answered, and
# right, and its condition: the N-back's burn-in is presented (so the responder sees every digit) but never counted.
# The counts keep the blocks apart, in the order played, so a study picks the ones it scores in FEEL
# (`result.blocks[block in scored_blocks]`), not here.
def ends(block, n, answered, condition, correct=None):
    return {"object": {"name": "NB.TrialEnd"}, "result": {"isAnswered": answered, "isCorrect": correct},
            "trialContext": {"block": {"id": block, "name": ["Practice", "Test_A"][block]}, "trial": {"id": n}, "condition": condition}}


battery = record(ends(0, 0, False, "BurnIn"), ends(0, 1, False, "Match", False), ends(0, 2, False, "NonMatch", False),
                 ends(1, 0, False, "BurnIn"), ends(1, 1, True, "Match", True), ends(1, 2, True, "NonMatch", False),
                 ends(1, 3, False, "NonMatch", False), ends(1, 4, True, "Match", True))
assert behaverse.block_counts(battery) == [counts("Practice", 2, 0, 0), counts("Test_A", 4, 3, 2)]
# A record that says nothing of correctness leaves its block's `correct` null rather than counting it wrong.
assert behaverse.block_counts(record(ends(1, 1, True, "Match")))[0]["correct"] is None
# An older build's records name their blocks too.
older = record(*[{"trialContext": {"block": {"id": b, "name": ["Practice", "Test_A"][b]}, "trial": {"id": n}, "types": ["TrialStart"]}}
                 for b in (0, 1) for n in (1, 2)],
               {"trialContext": {"block": {"id": 1, "name": "Test_A"}, "trial": {"id": 1}, "types": ["Click"]}})
assert behaverse.block_counts(older) == [counts("Practice", 2, 0), counts("Test_A", 2, 1)]

# An attribute may cite a property the run wrote: the walk hands the step its attributes resolved, so one task plays the
# timeline the allocation drew; what the walk could not resolve it hands as written.
assert behaverse.task_payload(task(timeline="{nback_order}"), auto=True, resolved={"timeline": "NBack_2back_first"})["timeline"] == "NBack_2back_first"
assert behaverse.task_payload(task(timeline="{unset}"), auto=True, resolved={"timeline": "{unset}"})["timeline"] == "{unset}"

# A task inside a sub-process is answered along the sub-process's message flows when it draws none of its own: the
# SDK finds them (`exchange_flows`, held to its rules in packages/runtime-local/python/test_exchange.py).
def flow(fid, source, target):
    return (fid, {"id": fid, "type": "messageFlow", "attributes": {"sourceRef": source, "targetRef": target}})


nested = {"Play": task(), "Subject": {"id": "Subject", "type": "subProcess", "parent": "Study"},
          "Model": {"id": "Model", "type": "participant", "extensions": [
              {"namespace": behaverse.STUDYFLOW, "type": "actor", "attributes": {"actorType": "llm", "implementation": "ollama://gemma4"}}]},
          **dict([flow("M_Trial", "Subject", "Model"), flow("M_Answer", "Model", "Subject")])}
assert behaverse.answered_by(task(), nested, auto=False) == "messages"
assert behaverse.actor_of(task(), nested) == {"kind": "llm", "model": "ollama://gemma4"}
# The stage window runs at full speed even when it is occluded or on another Space.
argv = behaverse.stage_argv("chrome", "http://127.0.0.1:1/", "/tmp/profile")
assert argv[:2] == ["chrome", "--app=http://127.0.0.1:1/"], argv
assert set(behaverse.chromium.UNTHROTTLED) <= set(argv), argv
print("ok")

# The Unity runner plays the tasks on the Unity build, checking the build first; one set to the Godot build stops
# the run before its first step, since no runner plays that build yet.
checked = []
unity_plan = {"elements": {"Play": task(), "Other": {"id": "Other", "type": "task"}}}
assert behaverse.claimed_tasks(unity_plan, lambda: checked.append(True)) == ["Play"] and checked == [True]
assert behaverse.claimed_tasks({"elements": {"Play": task(runtime="unity")}}, lambda: None) == ["Play"]
# A task whose trials go to a pool typed `behaverse:SimulatedActor`, along its own flows or those it inherits, plays on
# the simulated build whatever its `runtime` says, so a study of such tasks alone needs no Unity build; the pool is this
# runner's too, which simulated.py answers for. The same task answered by a model plays on the Unity build. A task
# another skill's scheme implements is that skill's to play.
assert behaverse.claimed_tasks({"elements": {"Play": task(implementation="behaverse://assessment-unity@26.10")}}, lambda: None) == ["Play"]

def unchecked():
    raise AssertionError("the build was checked")


simulated = {**nested, "Model": {"id": "Model", "type": "participant", "attributes": {}, "extensions": [
    {"namespace": behaverse.BEHAVERSE, "type": "simulatedActor", "attributes": {"accuracy": "default: 0.9"}}]}}
assert behaverse.build_of(task(), simulated) == "simulated" and behaverse.build_of(task(), nested) == "unity"
assert behaverse.claimed_tasks({"elements": simulated}, unchecked) == ["Play", "Model"]
assert behaverse.claimed_tasks({"elements": {**simulated, "Play": task(runtime="godot")}}, unchecked) == ["Play", "Model"]
assert behaverse.claimed_tasks({"elements": {"Play": task(implementation="other://assessment")}}, unchecked) == []
try:
    behaverse.claimed_tasks({"elements": {"Play": task(runtime="godot")}}, lambda: None)
    raise AssertionError("a Godot task was claimed")
except ValueError as error:
    assert "Play is set to the Godot build" in str(error), error

# A task the walk stops answers at once, so the walk never has to end this runner, and its window closes behind the
# answer. A sleeping process stands in for the browser, and an empty folder for the build.
import argparse  # noqa: E402
import subprocess  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402
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

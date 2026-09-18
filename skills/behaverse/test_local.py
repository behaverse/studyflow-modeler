"""One check for the failed-trial rate and the context stamped on trials; run it with `python3 skills/behaverse/test_local.py`."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("behaverse", Path(__file__).with_name("local.py"))
behaverse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(behaverse)


def task(**attributes):
    return {"id": "Play", "type": "choreographyTask", "parent": "Subject",
            "extensions": [{"namespace": behaverse.BEHAVERSE, "type": "task", "attributes": {"instrument": "NB", **attributes}}]}


# The share of the trials the build showed that it recorded no response for. A `Click` answers a trial, and so does
# a `TrialEnd` with a `responseTime`; the reply this runner sent does not, since the build may have stopped waiting.
class Stage:
    def __init__(self):
        self.shown, self.answered = set(), set()


def record(*events):
    stage = Stage()
    for event in events:
        behaverse.tally(stage, event)
    return stage


def trial(n, types, **rest):
    return {"trialContext": {"block": {"id": 1}, "trial": {"id": n}, "types": types}, **rest}


# WhichOne: 15 trials shown, 10 with a click, as subject 4's events read.
simon = record(*[trial(n, ["TrialStart"]) for n in range(1, 16)],
               *[trial(n, ["Click"]) for n in range(6, 16)])
assert (len(simon.shown), len(simon.answered)) == (15, 10)
assert round(behaverse.failed_trial_rate(simon.shown, simon.answered), 3) == 0.333
# N-back: the trial ends with a `responseTime`, or with none, which is the miss.
nback = record(*[trial(n, ["TrialStart"]) for n in range(1, 5)],
               trial(1, ["TrialEnd"], result={"responseTime": 9.66}), trial(2, ["TrialEnd"], result={"responseTime": None}),
               trial(3, ["TrialEnd"], result={"responseTime": 5.5}), trial(4, ["TrialEnd"], result={}))
assert behaverse.failed_trial_rate(nback.shown, nback.answered) == 0.5
# A build that reports no trial reports no failure; an event with no trial of its own is not one.
assert behaverse.failed_trial_rate(set(), set()) == 0.0
assert record({"trialContext": {"types": ["AppStarted"]}}).shown == set()

# Every trial line says whose it is: the task's visit count (study-lifetime, so a loop's iterations number the
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

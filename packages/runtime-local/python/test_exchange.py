"""The SDK's exchange along message flows and the records it stamps (exchange.py), and the Chromium a page opens in
(chromium.py); run it with `python3 packages/runtime-local/python/test_exchange.py`."""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import chromium  # noqa: E402
import exchange  # noqa: E402

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
STRUCTURES = ("cognitive:Trial", "cognitive:Response")


def task(**element):
    return {"id": "Play", "type": "choreographyTask", "parent": "Subject", **element}


# Every record says whose it is: the step's visit count (kept in the study's state, so a loop's iterations number the
# subjects) and the properties in scope at the hand-off, an inner scope shadowing an outer one.
plan = {"Play": task(), "Subject": {"type": "subProcess", "parent": "Study"}}
state = {"state": {"Study": {"arm": "none", "site": "lux"}, "Subject": {"arm": "cautious"},
                   "_meta": {"reached": {"Play": 3}}}}
assert exchange.record_context(task(), plan, state) == {"subject": 3, "state": {"arm": "cautious", "site": "lux"}}
assert exchange.record_context(task(), plan, {}) == {"subject": 1, "state": {}}
# With a repeating activity around it, the subject is the instance that activity is on, not the step's own count:
# both tasks of one subject stamp the same number, and a task played twice per subject stamps it twice.
subjects = {"state": {"_meta": {"reached": {"Play": 7}, "instance": {"Subject": 2}}}}
assert exchange.record_context(task(), plan, subjects)["subject"] == 2
# A pool of several instances is the subject when nothing inside it repeats: the walk keeps its instance under the
# participant's id. The fourth subject plays this task as the third to reach it, the first having left before it.
in_pool = {"Play": task(), "Subject": {"type": "subProcess", "parent": "Study"},
           "Participant_Subject": {"type": "participant", "attributes": {"processRef": "Study"}}}
fourth = {"state": {"_meta": {"reached": {"Play": 3}, "instance": {"Participant_Subject": 4}}}}
assert exchange.record_context(task(), in_pool, fourth)["subject"] == 4
# What a record carries under `context.state` is the study's to say: the properties the schema of the dataset the step
# writes names as `context.state.<name>` columns; all of them in scope when no dataset it writes has a schema.
SCHEMA = "tableSchema:\n  columns:\n    - {name: context.subject}\n    - {name: context.state.arm}\n"
declared = {"Play": task(outputs=[{"target": "Trials"}]), "Subject": {"type": "subProcess", "parent": "Study"},
            "Trials": {"attributes": {}, "extensions": [{"type": "bdmDataset", "attributes": {"schema": "Trial_Schema"}}]},
            "Trial_Schema": {"attributes": {}, "extensions": [{"type": "schema", "attributes": {"body": SCHEMA}}]}}
assert exchange.record_context(declared["Play"], declared, state) == {"subject": 3, "state": {"arm": "cautious"}}


# A step inside a sub-process talks along the sub-process's message flows when it draws none of its own.
def flow(fid, source, target, message=None):
    attributes = {"sourceRef": source, "targetRef": target, **({"messageRef": message} if message else {})}
    return (fid, {"id": fid, "type": "messageFlow", "attributes": attributes})


nested = {"Play": task(), "Subject": {"id": "Subject", "type": "subProcess", "parent": "Study"},
          "Model": {"id": "Model", "type": "participant", "extensions": [
              {"namespace": STUDYFLOW, "type": "actor", "attributes": {"actorType": "llm", "implementation": "ollama://gemma4"}}]},
          **dict([flow("M_Trial", "Subject", "Model"), flow("M_Answer", "Model", "Subject")])}
assert exchange.talking_scope(task(), nested) == "Subject"
assert exchange.exchange_flows(task(), nested, STRUCTURES) == ("M_Trial", "M_Answer")
assert exchange.message_partners(task(), nested, STRUCTURES) == ["Model"]
# Its own flows win: nothing is inherited then.
own = {**nested, **dict([flow("M_Own", "Play", "Model"), flow("M_Back", "Model", "Play")])}
assert exchange.talking_scope(task(), own) == "Play"
assert exchange.exchange_flows(task(), own, STRUCTURES) == ("M_Own", "M_Back")
# A step with no flow anywhere around it has no partner, and so no exchange.
assert exchange.exchange_flows(task(), {"Play": task(), "Subject": nested["Subject"]}, STRUCTURES) is None

# A step drawn straight in a pool, lane or no lane, talks along the pool's own message flows.
pooled = {"Play": task(parent="Example_Study"), "Model": nested["Model"],
          "Study": {"id": "Study", "type": "participant", "attributes": {"processRef": "Example_Study"}},
          **dict([flow("M_Trial", "Study", "Model"), flow("M_Answer", "Model", "Study")])}
assert exchange.talking_scope(pooled["Play"], pooled) == "Study"
assert exchange.exchange_flows(pooled["Play"], pooled, STRUCTURES) == ("M_Trial", "M_Answer")
# The pool also sends the cohort's once-only message to a step in another pool ("all subjects complete"). It names no
# message, so the flows that carry the step's two messages outrank it, as they do in `message_partners`.
cohort = {**pooled, "A0": {"id": "A0", "type": "startEvent", "parent": "Analysis_Report"},
          "Trial": {"type": "message", "attributes": {"itemRef": "Trial_Item"}},
          "Trial_Item": {"type": "itemDefinition", "attributes": {"structureRef": STRUCTURES[0]}},
          "Response": {"type": "message", "attributes": {"itemRef": "Response_Item"}},
          "Response_Item": {"type": "itemDefinition", "attributes": {"structureRef": STRUCTURES[1]}},
          **dict([flow("M_Trial", "Study", "Model", "Trial"), flow("M_Answer", "Model", "Study", "Response"),
                  flow("M_Done", "Study", "A0")])}
assert exchange.exchange_flows(cohort["Play"], cohort, STRUCTURES) == ("M_Trial", "M_Answer")
# A flow naming another message is another skill's exchange (a marker to an EEG pool), and one carrying the step's
# message the wrong way is a fault of the diagram.
marked = {**cohort, "EEG": {"id": "EEG", "type": "participant", "attributes": {}},
          "Marker": {"type": "message", "attributes": {"itemRef": "Marker_Item"}},
          "Marker_Item": {"type": "itemDefinition", "attributes": {"structureRef": "eeg:Marker"}},
          **dict([flow("M_Mark", "Study", "EEG", "Marker")])}
assert exchange.message_partners(marked["Play"], marked, STRUCTURES) == ["Model"]
backwards = {**cohort, **dict([flow("M_Trial", "Model", "Study", "Trial")])}
try:
    exchange.message_partners(backwards["Play"], backwards, STRUCTURES)
    raise AssertionError("a trial flowing into the step was accepted")
except ValueError as error:
    assert f"carries {STRUCTURES[0]} the wrong way" in str(error), error

# Its records the same way: one edge on the sub-process is where every step inside it deposits its records.
trials = {**nested, "Dataset": {"id": "Dataset", "attributes": {"uri": "data/trials.jsonl"}}}
trials["Subject"] = {**trials["Subject"], "outputs": [{"target": "Dataset"}]}
assert exchange.records_uri(task(), trials) == "data/trials.jsonl"
assert exchange.records_uri(task(), nested) == "Play.events.jsonl"  # nobody draws one
own_dataset = {**trials, "Own": {"id": "Own", "attributes": {"uri": "play.jsonl"}}}
assert exchange.records_uri(task(outputs=[{"target": "Own"}]), own_dataset) == "play.jsonl"

# Every message carries the step's data inputs too, so the prompt wired into it reaches whoever answers...
assert exchange.data_inputs({"inputs": [{"source": "Instructions"}, {"source": "Knobs"}]}, {"Knobs": {"n": 1}}) == {
    "Instructions": None, "Knobs": {"n": 1}}
# ...but not the Parameters wired in: they configure the tool, and would reach the actor as noise.
configured = {"Protocol": {"id": "Protocol", "type": "dataObjectReference",
                           "extensions": [{"namespace": "x", "type": "Parameters", "attributes": {}}]}}
assert exchange.data_inputs({"inputs": [{"source": "Instructions"}, {"source": "Protocol"}]}, {}, configured) == {"Instructions": None}

# One drawn dataset, two steps, four subjects: the first write of a run starts the file, the rest append, and a later
# run starts it again.
with tempfile.TemporaryDirectory() as folder:
    cache, records = Path(folder), Path(folder) / "data" / "trials.jsonl"
    os.environ["STUDYFLOW_RUN_PID"] = "111"
    assert exchange.opened_this_run(cache, records) is False  # the first step truncates
    assert exchange.opened_this_run(cache, records) is True   # the second appends, and so does every later subject
    assert exchange.opened_this_run(cache, Path(folder) / "Other.events.jsonl") is False  # its own file, its own start
    os.environ["STUDYFLOW_RUN_PID"] = "222"
    assert exchange.opened_this_run(cache, records) is False  # the next run starts it again

# The option an answer names, whole and without case (replies.json holds the cases a browser runner is held to too);
# a send task's one data input arrives as a mapping of one value.
for reply, options, named in json.loads((Path(__file__).parent / "replies.json").read_text(encoding="utf-8")):
    assert exchange.option_named(reply, options) == named, (reply, named)
assert exchange.option_named({"Answer": " match."}, ["Match", "NonMatch"]) == "Match"


# A message goes out with the step's data inputs before its content, and the answer that names it is the option it
# names; an answer counts a quarter of a second before the window ends, never under a second, and 30 s without one.
class Asked:
    def __init__(self, answer):
        self.answer, self.sent = answer, []

    def ask(self, flow, content, id, timeout):  # noqa: A002 - the SDK's own field
        self.sent.append((flow, content, id, timeout))
        return self.answer


step = Asked({"inReplyTo": "T.1", "content": "nonmatch"})
asking = exchange.Exchange(step, "M_Trial", "Model", {"Prompt": "Answer."})
assert asking.ask({"Stimulus": "X"}, "T.1", ["Match", "NonMatch"], 2.5) == "NonMatch"
assert step.sent == [("M_Trial", {"Prompt": "Answer.", "Stimulus": "X"}, "T.1", 2.25)]
asking.ask({}, "T.2", ["Match"], 0.5)
asking.ask({}, "T.3", ["Match"], None)
assert [timeout for *_, timeout in step.sent[1:]] == [1.0, exchange.WAIT]
assert exchange.Exchange(Asked(None), "M_Trial", "Model").ask({}, "T.4", ["Match"], 2.0) is None  # none in time

# A prompt delivered `once` (the instructions) rides with the step's first message only; one without it (a reminder)
# with every message.
AGENTIC = "https://w3id.org/studyflow/agentic"
step = Asked({"inReplyTo": "T.1", "content": "Match"})
step.elements = {"Rules": {"extensions": [{"namespace": AGENTIC, "type": "prompt", "attributes": {"template": "Rules.", "delivery": "once"}}]},
                 "Reminder": {"extensions": [{"namespace": AGENTIC, "type": "prompt", "attributes": {"template": "Reminder."}}]}}
asking = exchange.Exchange(step, "M_Trial", "Model", {"Rules": None, "Reminder": None})
for trial in ("T.1", "T.2", "T.3"):
    asking.ask({"Stimulus": "X"}, trial, ["Match"], 2.0)
assert [content for _, content, *_ in step.sent] == [{"Rules": None, "Reminder": None, "Stimulus": "X"},
                                                       {"Reminder": None, "Stimulus": "X"}, {"Reminder": None, "Stimulus": "X"}]

# A page's Chromium closes with its page: the process ends, the page stops being served, and its profile goes. A
# sleeping process stands in for the browser.
with tempfile.TemporaryDirectory() as folder:
    profile = Path(folder) / "profile"
    profile.mkdir()
    browser = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)", f"--user-data-dir={profile}"])
    served = []

    class Server:
        def shutdown(self):
            served.append("stopped")

    started = time.monotonic()
    chromium.close(Server(), browser)
    assert browser.poll() is not None and served == ["stopped"] and not profile.exists()
    assert time.monotonic() - started < 5
    chromium.close(Server(), None)  # a page in the default browser: only the serving stops
    assert served == ["stopped", "stopped"]
print("exchange and chromium: ok")

"""One check for what the runner plays, what it sends, and what it records; run it with
`python3 skills/agentic/test_local.py`."""

import importlib.util
import io
import os
import tempfile
import threading
import time
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location("agentic", Path(__file__).with_name("local.py"))
agentic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agentic)
import runner  # noqa: E402 - the SDK the runner put on the path


def actor(**attributes):
    return {"type": "participant", "attributes": attributes.pop("_", {}),
            "extensions": [{"namespace": agentic.STUDYFLOW, "type": "actor", "attributes": attributes}]}


# It plays a model with no process of its own: not a person, not a model a pool walks.
elements = {
    "Model": actor(actorType="llm", implementation="ollama://gemma4:12b-it-qat"),
    "Walked": actor(actorType="llm", implementation="ollama://gemma4", _={"processRef": "P"}),
    "Person": actor(actorType="human"),
    "Instructions": {"type": "dataObjectReference", "extensions": [
        {"namespace": agentic.AGENTIC, "type": "prompt", "attributes": {"template": "Answer Left or Right."}}]},
    "Arm": {"type": "dataObjectReference", "extensions": [
        {"namespace": agentic.AGENTIC, "type": "prompt", "attributes": {
            "template": "Be {arm}. Trial {reached} of {Play.trials}, in {state.Study.room}. {nothing}"}}]},
    "Task": {"type": "task", "parent": "Subject"},
    "Subject": {"type": "subProcess", "parent": "Study"},
    "P_Instruction": {"type": "property", "name": "instruction"},
}
plan = {"elements": elements, "names": {"Play_1": "Play"}}
assert agentic.model_pools(plan) == ["Model"]
assert agentic.model_of("Model", elements["Model"]) == ("ollama", "gemma4:12b-it-qat")
try:
    agentic.model_of("Person", actor(actorType="llm"))
    raise AssertionError("a model pool with no implementation has no default")
except ValueError:
    pass

# The request is the content, in order: a prompt's text, an image in the run, and any other value under its name, as
# text or as JSON; nothing added. The name is the element's its key is, else the key.
with tempfile.TemporaryDirectory() as run:
    (Path(run) / "frames").mkdir()
    (Path(run) / "frames" / "trial-1.jpg").write_bytes(b"\xff\xd8jpeg")
    content = {"Frame": "frames/trial-1.jpg", "Instructions": None, "Note": "left is yellow", "Trial": {"n": 1},
               "P_Instruction": "Take your time."}
    parts = agentic.parts_of(content, plan, Path(run), {}, "Task")
    assert parts == [{"image": ("image/jpeg", "/9hqcGVn")}, {"text": "Answer Left or Right."},
                     {"text": "Note: left is yellow"}, {"text": 'Trial: {"n": 1}'}, {"text": "instruction: Take your time."}], parts
    # A Behaverse trial, as its task sends it: the model reads each field of it by name, the stimulus above all.
    trial = {"Instructions": None, "TrialIndex": 1, "Stimulus": {"Value": "3"}, "ResponseOptions": ["Match", "NonMatch"],
             "MaxResponseTime": 20, "Scene": "NB"}
    assert agentic.parts_of(trial, plan, Path(run), {}, "Task") == [
        {"text": "Answer Left or Right."}, {"text": "TrialIndex: 1"}, {"text": 'Stimulus: {"Value": "3"}'},
        {"text": 'ResponseOptions: ["Match", "NonMatch"]'}, {"text": "MaxResponseTime: 20"}, {"text": "Scene: NB"}]
    assert agentic.parts_of("data:image/png;base64,AAAA", plan, Path(run), {}, "Task") == [{"image": ("image/png", "AAAA")}]
    assert agentic.parts_of({"Missing": None}, plan, Path(run), {}, "Task") == []

    # A prompt's placeholders read the state the walk handed over: `state` from its root, then the nearest scope
    # outward from the asking step, then an element's result by id or name. One that resolves to nothing stays as written.
    values = {"state": {"Study": {"arm": "impulsive", "room": "B12"}, "Subject": {"arm": "cautious"},
                        "_meta": {"reached": {"Task": 3}}}, "Play_1": {"trials": 8}}
    assert agentic.parts_of({"Arm": None}, plan, Path(run), values, "Task") == [
        {"text": "Be cautious. Trial 3 of 8, in B12. {nothing}"}]
    # Asked from the study's own scope instead, the study's own `arm` is the one in reach, and a step no run
    # reached counts 0 rather than borrowing its container's count.
    assert agentic.parts_of({"Arm": None}, plan, Path(run), values, "Study")[0]["text"].startswith("Be impulsive. Trial 0 ")

# A hand-off hands back, beside the reply, a record of what answered and what it was asked: the model's digest and
# quantization, its default sampling parameters, Ollama's version, the options sent, and the request's text and images.
# No network: the HTTP helpers answer as Ollama and the Messages API would.
TAGS = {"models": [{"name": "gemma4:12b-it-qat", "digest": "ab12", "details": {"quantization_level": "Q4_0"}}]}


def post(url, body, headers, timeout):
    if url.endswith("/api/chat"):
        return {"message": {"content": "Left"}}
    if url.endswith("/api/show"):
        return {"parameters": "temperature 1\ntop_k 64", "model_info": {"gemma4.context_length": 131072}}
    return {"model": "claude-haiku-4-5-20251001", "content": [{"type": "text", "text": "Right"}]}


def get(url, timeout):
    return TAGS if url.endswith("/api/tags") else {"version": "0.12.3"}


real_post = agentic.post
agentic.post, agentic.get = post, get
asked = {"elements": {"Model": elements["Model"], "M_Ask": {"type": "messageFlow", "attributes": {"sourceRef": "Task", "targetRef": "Model"}}}}
content = {"Note": "left is yellow", "Frame": "data:image/png;base64,AAAA", "Trial": {"n": 1}}
step = agentic.Step("Model", asked, {}, {"id": "m1", "flow": "M_Ask", "content": content})
assert agentic.execute(step) == "Left" and step.record == {
    "model": "gemma4:12b-it-qat", "options": {"stream": False, "think": False, "options": {"num_ctx": 32768}},
    "contextEstimate": 271, "digest": "ab12", "quantization": "Q4_0", "memory": "none",
    "parameters": "temperature 1\ntop_k 64", "contextLength": 131072, "kind": "chat", "version": "ollama 0.12.3",
    "sent": {"text": 'Note: left is yellow\n\nTrial: {"n": 1}', "images": 1},
}, step.record


# A pool that remembers (`memory: conversation`): each message goes with the conversation so far, the walk says which
# conversation and turn, and a turn this runner holds no record of fails rather than asking without it.
chats = []


def remembering(url, body, headers, timeout):
    if "messages" in body:
        chats.append(body["messages"])
    return post(url, body, headers, timeout)


agentic.post = remembering
for turn in (0, 1):
    step = agentic.Step("Model", asked, {}, {"id": f"t{turn}", "flow": "M_Ask", "content": {"Note": f"trial {turn}"}},
                        conversation={"id": "Model with Subjects #1", "turn": turn})
    assert agentic.execute(step) == "Left"
assert [(m["role"], m["content"]) for m in chats[-1]] == [("user", "Note: trial 0"), ("assistant", "Left"), ("user", "Note: trial 1")], chats[-1]
assert step.record["sent"]["turn"] == 1
lost = agentic.Step("Model", asked, {}, {"id": "t9", "flow": "M_Ask", "content": {"Note": "trial 9"}},
                    conversation={"id": "Model with Subjects #2", "turn": 3})
try:
    agentic.execute(lost)
    raise AssertionError("a conversation this runner lost is refused")
except RuntimeError as error:
    assert "lost them" in str(error), error
# A turn the walk stops (`--step-timeout`) answers at once, so the runner is never ended for it, and is no part of the
# conversation: the walk asks that turn again, and the model hears the turns before it, not the stopped one.
def slow(url, body, headers, timeout):
    time.sleep(0.5)
    return post(url, body, headers, timeout)


agentic.post = slow
stopped = agentic.Step("Model", asked, {}, {"id": "t2", "flow": "M_Ask", "content": {"Note": "trial 2, stopped"}},
                       conversation={"id": "Model with Subjects #1", "turn": 2})
threading.Timer(0.1, stopped._cancelled.set).start()
try:
    agentic.execute(stopped)
    raise AssertionError("a stopped turn waited for its reply")
except runner.Cancelled:
    pass
agentic.post = remembering
again = agentic.Step("Model", asked, {}, {"id": "t2", "flow": "M_Ask", "content": {"Note": "trial 2"}},
                     conversation={"id": "Model with Subjects #1", "turn": 2})
assert agentic.execute(again) == "Left"
assert [m["content"] for m in chats[-1] if m["role"] == "user"] == ["Note: trial 0", "Note: trial 1", "Note: trial 2"], chats[-1]
agentic.post = post

# The window holds the whole conversation: it grows in powers of two as the conversation does, never shrinks within a
# run, and a conversation past the model's own context length fails rather than lose its earliest turns.
agentic.CONTEXT.clear()
assert agentic.context_window("m", [{"content": "x"}], 131072) == (32768, 257)
assert agentic.context_window("m", [{"content": "x" * 80_000}], 131072) == (65536, 32256)
assert agentic.context_window("m", [{"content": "x"}], 131072) == (65536, 257)
assert agentic.context_window("m", [{"content": "x" * 300_000}], 131072)[0] == 131072
try:
    agentic.context_window("m", [{"content": "x" * 400_000}], 131072)
    raise AssertionError("a conversation past the model's context length is refused")
except RuntimeError as error:
    assert "would be dropped" in str(error), error

# Under `memory: window` the walk says how many of the latest exchanges the pool remembers: the model is sent those,
# and the exchanges that carried a step's instructions (a prompt delivered once), however long ago.
elements["Rules"] = {"type": "dataObjectReference", "extensions": [
    {"namespace": agentic.AGENTIC, "type": "prompt", "attributes": {"template": "The rules.", "delivery": "once"}}]}
windowed = {"elements": {**asked["elements"], "Rules": elements["Rules"]}}
chats.clear()
agentic.post = remembering
for turn in range(5):
    content = {"Rules": None, "Note": f"trial {turn}"} if turn == 0 else {"Note": f"trial {turn}"}
    step = agentic.Step("Model", windowed, {}, {"id": f"w{turn}", "flow": "M_Ask", "content": content},
                        conversation={"id": "Model with Subjects #4", "turn": turn, "window": 2})
    agentic.execute(step)
assert [m["content"] for m in chats[-1] if m["role"] == "user"] == [
    "The rules.\n\nNote: trial 0", "Note: trial 2", "Note: trial 3", "Note: trial 4"], chats[-1]
assert step.record["memory"] == "window" and step.record["window"] == 2 and step.record["sent"]["remembered"] == 3, step.record
assert len(agentic.CONVERSATIONS["Model with Subjects #4"]) == 10  # the runner keeps it all; the window is what it sends
assert agentic.remembered([{"role": "user"}, {"role": "assistant"}], None) == [{"role": "user"}, {"role": "assistant"}]
agentic.post = post

# A lookup that fails is noted, and the answer stands; a model is described once a run, so this is another one.
def unreachable(url, timeout):
    raise urllib.error.URLError("connection refused")


agentic.get = unreachable
reply, record = agentic.ask_ollama("gemma4:1b", [{"text": "Left or Right?"}])
assert reply == "Left" and "digest" not in record and set(record["unrecorded"]) == {"/api/tags", "/api/version"}, record
assert record["parameters"] == "temperature 1\ntop_k 64", record

# A decision model (`/api/show` lists `decision`) writes no text: it is asked `/v1/systemone` one choice question, the
# message's text its instructions and the answers it lists under ResponseOptions its criteria, with the conversation so
# far as its state. The answer is drawn from its probabilities by the seed, the participant and the trial, and the record
# keeps the probabilities and the draw.
agentic.get = get
TAGS["models"].append({"name": "d1:3b", "digest": "cd34", "details": {"quantization_level": "Q8_0"}})
decisions = []


def deciding(url, body, headers, timeout):
    if url.endswith("/api/show"):
        return {"capabilities": ["decision", "vision"], "model_info": {"lfm2.context_length": 128000}}
    if url.endswith("/v1/systemone"):
        decisions.append(body)
        return {"answers": {"response": {"type": "choice", "choice": "NonMatch", "confidence": 0.5,
                                         "probabilities": {"Match": 0.25, "NonMatch": 0.75}}}, "usage": {"input_tokens": 40, "output_tokens": 0}}
    raise AssertionError(f"a decision model is never asked {url}")


agentic.post = deciding
d1 = {"elements": {**asked["elements"], "Model": actor(actorType="llm", implementation="ollama://d1:3b"),
                   "P_Options": {"type": "property", "name": "ResponseOptions"}}}
assert agentic.options_in({"Prompt_Check": None, "P_Options": ["READY", "NOT READY"]}, d1) == ["READY", "NOT READY"]
assert agentic.options_in({"ResponseOptions": ["Match", "NonMatch"]}, d1) == ["Match", "NonMatch"]
assert agentic.options_in({"Note": "x"}, d1) == []
letters = []
for turn, letter in enumerate("AX"):
    step = agentic.Step("Model", d1, {}, {"id": f"d{turn}", "flow": "M_Ask", "content": {
        "Stimulus": letter, "ResponseOptions": ["Match", "NonMatch"], "Frame": "data:image/png;base64,AAAA"}},
        conversation={"id": "Model with Subjects #3", "turn": turn}, asker={"id": "Model with Subjects #3", "n": turn})
    letters.append(agentic.execute(step))
assert decisions[-1] == {
    "model": "d1:3b",
    "state": [{"role": "user", "content": 'Stimulus: A\n\nResponseOptions: ["Match", "NonMatch"]'}, {"role": "assistant", "content": letters[0]}],
    "images": ["AAAA"],
    "questions": {"response": {"type": "choice", "instructions": 'Stimulus: X\n\nResponseOptions: ["Match", "NonMatch"]',
                               "criteria": {"Match": None, "NonMatch": None}}},
}, decisions[-1]
assert "state" not in decisions[0], decisions[0]
record = step.record
assert record["kind"] == "decision" and record["probabilities"] == {"Match": 0.25, "NonMatch": 0.75} and record["choice"] == "NonMatch"
assert record["draw"]["key"] == "None:Model with Subjects #3:1" and 0 <= record["draw"]["u"] < 1, record
assert record["digest"] == "cd34" and record["sent"]["turn"] == 1, record
# A pool that remembers nothing draws by who asks and how often too, not by the message's id, which a task may mint at
# random (a Unity build's RequestId): the same participant and trial draw the same answer under any id.
draws = []
for message_id in ("a1b2-random", "c3d4-other"):
    step = agentic.Step("Model", d1, {}, {"id": message_id, "flow": "M_Ask", "content": {"Stimulus": "X", "ResponseOptions": ["Match", "NonMatch"]}},
                        asker={"id": "Model with Subjects #5", "n": 7})
    agentic.execute(step)
    draws.append(step.record["draw"])
assert draws[0] == draws[1] and draws[0]["key"] == "None:Model with Subjects #5:7", draws
# A message that lists no answers has nothing for a decision model to choose among.
try:
    agentic.execute(agentic.Step("Model", d1, {}, {"id": "d9", "flow": "M_Ask", "content": {"Note": "say READY"}}))
    raise AssertionError("a decision model answered a message that lists no options")
except ValueError as error:
    assert "lists none" in str(error), error

# Ollama serves a decision model with its own `num_ctx`, which a request cannot raise: a conversation past that window
# fails before it is sent, and a refusal from Ollama says what it refused, not just its status.
assert agentic.served_window({"parameters": "num_ctx                        16384", "contextLength": 32768}) == 16384
assert agentic.served_window({"parameters": "temperature 1", "contextLength": 32768}) == 32768
long = {"Stimulus": "X", "ResponseOptions": ["Match", "NonMatch"], "Note": "x" * 50_000}
agentic.DESCRIBED["d1:3b"]["parameters"] = "num_ctx 16384"
try:
    agentic.execute(agentic.Step("Model", d1, {}, {"id": "d10", "flow": "M_Ask", "content": long}))
    raise AssertionError("a conversation past the served window was sent")
except RuntimeError as error:
    assert "past the 16384 the model holds" in str(error), error

# Under `memory: window` a decision model is sent as its state the exchanges that carried the instructions and the last
# `window` others of this participant's session, never another's; under `memory: none` the message alone. A state past
# the served window loses its oldest exchanges first, never the instructions nor the message, and the record says how
# many it kept and that it was cut.
d1_rules = {"elements": {**d1["elements"], "Rules": elements["Rules"]}}
agentic.DESCRIBED["d1:3b"]["parameters"] = "num_ctx 16384"


def decided(pool, turn, note="", window=3, remembers=True):
    content = {**({"Rules": None} if turn == 0 else {}), "Stimulus": f"{pool}-{turn}", "ResponseOptions": ["Match", "NonMatch"],
               **({"Note": note} if note else {})}
    step = agentic.Step("Model", d1_rules, {}, {"id": f"{pool}{turn}", "flow": "M_Ask", "content": content},
                        conversation={"id": f"Model with Subjects #{pool}", "turn": turn, "window": window} if remembers else None,
                        asker={"id": f"Model with Subjects #{pool}", "n": turn})
    agentic.execute(step)
    return step.record, decisions[-1]


for turn in range(6):
    decided(10, turn)
    decided(11, turn)
record, body = decided(10, 6)
states = [m["content"] for m in body["state"] if m["role"] == "user"]
assert states[0].startswith("The rules.") and [s.split("\n\n")[-2] for s in states] == [
    "Stimulus: 10-0", "Stimulus: 10-3", "Stimulus: 10-4", "Stimulus: 10-5"], states
assert not any("11-" in m["content"] for m in body["state"]), body["state"]
assert record["memory"] == "window" and record["window"] == 3 and record["kept"] == 4 and "truncated" not in record, record
record, body = decided(12, 0, remembers=False)
assert "state" not in body and record["memory"] == "none" and record["kept"] == 0, record
# Each trial about 1600 tokens: at the sixth, the instructions' exchange, the last three and the message would need
# about 8400 tokens, past a window of 7000, so the oldest of the three is dropped.
agentic.DESCRIBED["d1:3b"]["parameters"] = "num_ctx 7000"
for turn in range(6):
    record, body = decided(13, turn, note="x" * 4000)
assert record["kept"] == 3 and record["truncated"] is True and record["sent"]["remembered"] == 3, record
assert body["state"][0]["content"].startswith("The rules.") and "13-5" in body["questions"]["response"]["instructions"], body
assert [m["content"].split("\n\n")[-3] for m in body["state"] if m["role"] == "user"] == [
    "Stimulus: 13-0", "Stimulus: 13-3", "Stimulus: 13-4"], body["state"]
agentic.DESCRIBED["d1:3b"]["parameters"] = "num_ctx 16384"
# A chat model under the same window is sent the same exchanges, and its record keeps no draw and no cut.
agentic.post = remembering
chats.clear()
for turn in range(5):
    content = {"Rules": None, "Note": f"trial {turn}"} if turn == 0 else {"Note": f"trial {turn}"}
    step = agentic.Step("Model", windowed, {}, {"id": f"c{turn}", "flow": "M_Ask", "content": content},
                        conversation={"id": "Model with Subjects #14", "turn": turn, "window": 3})
    agentic.execute(step)
assert step.record["kind"] == "chat" and step.record["sent"]["remembered"] == 4 and "draw" not in step.record and "truncated" not in step.record
agentic.post = deciding


def refused(url, timeout):
    raise urllib.error.HTTPError(url, 400, "Bad Request", {}, io.BytesIO(b'{"error":"request exceeds the available context size"}'))


real_urlopen = agentic.urllib.request.urlopen
agentic.urllib.request.urlopen = refused
try:
    real_post("http://localhost:11434/v1/systemone", {}, {}, timeout=1)
    raise AssertionError("a refusal passed")
except RuntimeError as error:
    assert str(error) == 'http://localhost:11434/v1/systemone answered 400: {"error":"request exceeds the available context size"}', error
agentic.urllib.request.urlopen = real_urlopen

# The draw: `u` falls on an option as wide as its probability, the options in the message's order; the same key draws
# the same answer, other participants draw their own, and over many keys each answer comes up as often as its probability.
assert [agentic.drawn({"Match": 0.25, "NonMatch": 0.75}, ["Match", "NonMatch"], u) for u in (0.0, 0.2499, 0.25, 0.9999)] == [
    "Match", "Match", "NonMatch", "NonMatch"]
assert agentic.drawn({"A": 0.0, "B": 1.0}, ["A", "B"], 0.0) == "B"
probabilities = {"Match": 0.3, "NonMatch": 0.7}
key = "42:Model with Subjects #1:13"
assert len({agentic.drawn(probabilities, ["Match", "NonMatch"], agentic.random.Random(key).random()) for _ in range(1000)}) == 1
us = {agentic.random.Random(f"42:Model with Subjects #{n}:13").random() for n in range(1, 49)}
assert len(us) == 48
share = sum(agentic.drawn(probabilities, ["Match", "NonMatch"], agentic.random.Random(f"42:Model with Subjects #{n % 48}:{n}").random()) == "Match"
            for n in range(20_000)) / 20_000
assert abs(share - 0.3) < 0.02, share
agentic.post = post

# Claude: the model asked for, the model the response names, and the options sent.
os.environ.setdefault("ANTHROPIC_API_KEY", "not used: the helpers answer")
assert agentic.ask_claude("claude-haiku-4-5", [{"text": "Left or Right?"}]) == (
    "Right", {"model": "claude-haiku-4-5", "responseModel": "claude-haiku-4-5-20251001", "options": {"max_tokens": 1024}})
print("ok")

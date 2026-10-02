"""One check for what the runner plays, what it sends, and what it records; run it with
`python3 skills/agentic/test_local.py`."""

import importlib.util
import os
import tempfile
import urllib.error
from pathlib import Path

spec = importlib.util.spec_from_file_location("agentic", Path(__file__).with_name("local.py"))
agentic = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agentic)


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
        return {"parameters": "temperature 1\ntop_k 64"}
    return {"model": "claude-haiku-4-5-20251001", "content": [{"type": "text", "text": "Right"}]}


def get(url, timeout):
    return TAGS if url.endswith("/api/tags") else {"version": "0.12.3"}


agentic.post, agentic.get = post, get
asked = {"elements": {"Model": elements["Model"], "M_Ask": {"type": "messageFlow", "attributes": {"sourceRef": "Task", "targetRef": "Model"}}}}
content = {"Note": "left is yellow", "Frame": "data:image/png;base64,AAAA", "Trial": {"n": 1}}
step = agentic.Step("Model", asked, {}, {"id": "m1", "flow": "M_Ask", "content": content})
assert agentic.execute(step) == "Left" and step.record == {
    "model": "gemma4:12b-it-qat", "options": {"stream": False, "think": False}, "digest": "ab12", "quantization": "Q4_0",
    "parameters": "temperature 1\ntop_k 64", "version": "ollama 0.12.3",
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
agentic.post = post

# A lookup that fails is noted, and the answer stands; a model is described once a run, so this is another one.
def unreachable(url, timeout):
    raise urllib.error.URLError("connection refused")


agentic.get = unreachable
reply, record = agentic.ask_ollama("gemma4:1b", [{"text": "Left or Right?"}])
assert reply == "Left" and "digest" not in record and set(record["unrecorded"]) == {"/api/tags", "/api/version"}, record
assert record["parameters"] == "temperature 1\ntop_k 64", record

# Claude: the model asked for, the model the response names, and the options sent.
os.environ.setdefault("ANTHROPIC_API_KEY", "not used: the helpers answer")
assert agentic.ask_claude("claude-haiku-4-5", [{"text": "Left or Right?"}]) == (
    "Right", {"model": "claude-haiku-4-5", "responseModel": "claude-haiku-4-5-20251001", "options": {"max_tokens": 1024}})
print("ok")

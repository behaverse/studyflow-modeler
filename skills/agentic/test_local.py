"""One check for what the runner plays and what it sends; run it with `python3 skills/agentic/test_local.py`."""

import importlib.util
import tempfile
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
}
plan = {"elements": elements, "names": {"Play_1": "Play"}}
assert agentic.model_pools(elements) == ["Model"]
assert agentic.model_of("Model", elements["Model"]) == ("ollama", "gemma4:12b-it-qat")
try:
    agentic.model_of("Person", actor(actorType="llm"))
    raise AssertionError("a model pool with no implementation has no default")
except ValueError:
    pass

# The request is the content, in order: a prompt's text, an image in the run, other text, JSON; nothing added.
with tempfile.TemporaryDirectory() as run:
    (Path(run) / "frames").mkdir()
    (Path(run) / "frames" / "trial-1.jpg").write_bytes(b"\xff\xd8jpeg")
    content = {"Frame": "frames/trial-1.jpg", "Instructions": None, "Note": "left is yellow", "Trial": {"n": 1}}
    parts = agentic.parts_of(content, plan, Path(run), {}, "Task")
    assert parts == [{"image": ("image/jpeg", "/9hqcGVn")}, {"text": "Answer Left or Right."},
                     {"text": "left is yellow"}, {"text": '{"n": 1}'}], parts
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
    assert agentic.parts_of({"Arm": None}, plan, Path(run), values, "Study")[0]["text"].startswith("Be impulsive.")
    assert agentic.resolve("reached", "Subject", values, plan) == 0
print("ok")

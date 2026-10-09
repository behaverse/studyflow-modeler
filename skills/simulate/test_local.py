"""Self-check of the simulate runner: what it claims, and that it answers with an option the message lists."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("simulate", Path(__file__).with_name("local.py"))
simulate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(simulate)

ACTOR = {"namespace": simulate.STUDYFLOW, "type": "actor"}
elements = {
    "Pool": {"type": "participant", "attributes": {}, "extensions": [{**ACTOR, "attributes": {"implementation": "simulate://random"}}]},
    "Walked": {"type": "participant", "attributes": {"processRef": "P"}, "extensions": [{**ACTOR, "attributes": {"implementation": "simulate://random"}}]},
    "Model": {"type": "participant", "attributes": {}, "extensions": [{**ACTOR, "attributes": {"implementation": "ollama://gemma4"}}]},
    "Step": {"type": "serviceTask", "attributes": {"implementation": "python://math.sqrt"}},
}
assert simulate.claims({"elements": elements}) == ["Pool"], simulate.claims({"elements": elements})
# An option the trial lists, at its top level or in the one value of the message that lists some; the same each run.
trial = {"Stimulus": "a red square on the left", "ResponseOptions": ["left", "right"]}
replies = [simulate.answer(7, {"id": f"M.{i}", "content": trial}) for i in range(200)]
assert set(replies) == {"left", "right"} and replies == [simulate.answer(7, {"id": f"M.{i}", "content": trial}) for i in range(200)]
assert simulate.answer(7, {"id": "M.1", "content": {"Prompt": "Answer.", "Trial": trial}}) in {"left", "right"}
assert simulate.answer(7, {"id": "M.1", "content": {"Check": None}}) == "READY"
print("simulate: ok")

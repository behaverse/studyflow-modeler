"""One check for the participant bridge's parsing; run it with `python3 runners/test_studyflow_reachy.py`."""

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("reachy", Path(__file__).with_name("studyflow-reachy.py"))
reachy = importlib.util.module_from_spec(spec)
sys.modules["reachy"] = reachy  # dataclasses resolve the module by name
spec.loader.exec_module(reachy)

assert reachy.parse_screen_reply("Screen: no\nHorizontal: middle") is None
assert reachy.parse_screen_reply("Screen: Yes\nHorizontal: Left\nVertical: top") == (-1, -1)
assert reachy.parse_screen_reply("screen: yes\nhorizontal: middle\nvertical: middle") == (0, 0)
assert reachy.parse_screen_reply("Screen: yes, a monitor\nHorizontal: right third\nVertical: bottom") == (1, 1)
assert reachy.screen_is_centred((0, 0)) and not reachy.screen_is_centred((0, 1))
assert reachy.match_option("Seen: a blue disk on the left\nAnswer: Right", ["Left", "Right"]) == "Right"
assert reachy.match_option("I would press left.", ["Left", "Right"]) == "Left"

robot = {"type": "participant", "extensions": [{"namespace": reachy.REACHY, "type": "robot", "attributes": {}}]}
end = {"type": "endEvent"}
assert reachy.Plan({"elements": {"pool": robot, "done": end}}).has_robot()
assert not reachy.Plan({"elements": {"done": end}}).has_robot()
task = {"type": "task", "extensions": [{"namespace": "cognitive", "type": "BehaverseTask", "attributes": {"botConfigurations": "ResponseSource: external\nSpeed: 1"}}]}
assert reachy.Plan({"elements": {"pool": robot, "t": task}}).wants_participant()
assert not reachy.Plan({"elements": {"pool": robot, "done": end}}).wants_participant()
assert not reachy.Plan({"elements": {"t": task}}).wants_participant()
assert reachy.parse_vlm("ollama:gemma4:12b-it-qat") == ("ollama", "gemma4:12b-it-qat") and reachy.parse_vlm("gemma4") == ("ollama", "gemma4")
assert reachy.answer_side("Right", ["Left", "Right"]) == "right" and reachy.answer_side("Left", ["Left", "Right"]) == "left"
assert reachy.answer_side("B", ["A", "B", "C"]) == "both"
assert reachy.is_gaze({"yaw": 1, "pitch": 2}) and not reachy.is_gaze("screen")
plan = reachy.Plan({"elements": {
    "Study": {"type": "process"},
    "P_gaze": {"type": "property", "name": "screenGaze", "parent": "Study"},
    "Look": {"id": "Look", "name": "Face the screen", "parent": "Study", "outputs": [{"target": "P_gaze"}]},
    "Exit": {"type": "endEvent", "parent": "Study"},
}})
run = reachy.Run(plan, auto=True, robot=reachy.TerminalRobot())
run.tree.update({"_meta": {"reached": {"Exit": 3}}})
run.scope = "Look"
run.store(plan.elements["Look"], {"yaw": 48.0, "pitch": -10.0})
assert run.tree["Study"]["screenGaze"] == {"yaw": 48.0, "pitch": -10.0}
assert run.value_of("{screenGaze}") == {"yaw": 48.0, "pitch": -10.0}
assert run.value_of("{state.Study.screenGaze}") == {"yaw": 48.0, "pitch": -10.0}
assert run.value_of("screen") == "screen" and run.value_of("{nothing}") == "{nothing}"
run.scope = "Exit"
assert run.fill("n={reached}") == "n=3" and run.fill("{state._meta.reached.Exit}") == "3"
assert run.fill("{Look}").startswith("{'yaw'")  # an element's own result, by id, as a last resort
print("ok")

"""One check for the runner's claims and the state it reads and writes; run it with `python3 skills/reachy/test_local.py`."""

import importlib.util
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("reachy", Path(__file__).with_name("local.py"))
reachy = importlib.util.module_from_spec(spec)
sys.modules["reachy"] = reachy  # dataclasses resolve the module by name
spec.loader.exec_module(reachy)

# The runner claims its own steps, and the robot pool's end events, not another pool's; with no pools, every end.
robot = {"type": "participant", "extensions": [{"namespace": reachy.REACHY, "type": "robot", "attributes": {}}]}
end = {"type": "endEvent"}
pool = {**robot, "attributes": {"processRef": "R"}}
take = {"type": "serviceTask", "parent": "R", "extensions": [{"namespace": reachy.REACHY, "type": "snapshot", "attributes": {}}]}
pools = reachy.Plan({"elements": {"pool": pool, "Take": take, "r_end": {**end, "parent": "R"}, "s_end": {**end, "parent": "S"}}})
assert reachy.claimed(pools) == ["Take", "r_end"] and pools.needs_camera()
assert reachy.claimed(reachy.Plan({"elements": {"pool": robot, "done": end}})) == ["done"]

# A step asks the model its message flow reaches, a pool with no process, never another pool's step.
flows = reachy.Plan({"elements": {
    "Model": {"type": "participant", "attributes": {}},
    "Screen": {"type": "participant", "attributes": {"processRef": "S"}},
    "M1": {"type": "messageFlow", "attributes": {"sourceRef": "Look", "targetRef": "Screen"}},
    "M2": {"type": "messageFlow", "attributes": {"sourceRef": "Look", "targetRef": "Model"}},
}})
assert flows.model_flow("Look") == "M2" and flows.model_flow("Other") is None


# The search sweeps until the model sees a screen, nudges until it is centred, and keeps where it found it; a look
# right after that only turns back there, asking nothing.
class Head:
    host = "test-host"

    def __init__(self):
        self.aims = []

    def aim(self, gaze, remember=False):
        self.aims.append((gaze["yaw"], remember))

    def snapshot(self, path, width=None, fresh=False):
        return True


reachy.GAZE_FILE = Path(tempfile.mkdtemp()) / "gaze.json"
replies = iter(["Screen: no", "Screen: yes\nHorizontal: left\nVertical: middle", "Screen: yes\nHorizontal: middle\nVertical: middle"])
asked = []
head = Head()
assert reachy.find_screen(head, lambda content: asked.append(content) or next(replies), Path("/run"), "reachy/look")
assert head.aims == [(0.0, False), (45.0, False), (65.0, False), (65.0, True)], head.aims  # left of centre: turn left
assert asked[0] == {"Question": reachy.SCREEN_QUESTION, "View": "reachy/look/view-1.jpg"} and len(asked) == 3
assert reachy.find_screen(head, lambda content: asked.append(content), Path("/run"), "reachy/look") and len(asked) == 3
assert head.aims[-1] == (65.0, True)

# A data edge lands on the property it names; a placeholder reads `state` from its root, then the nearest scope,
# then the scope's `_meta` counter, then an element's result by id.
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
assert run.resolve("screenGaze") == {"yaw": 48.0, "pitch": -10.0}
assert run.resolve("state.Study.screenGaze") == {"yaw": 48.0, "pitch": -10.0}
assert run.fill("{nothing}") == "{nothing}"
run.scope = "Exit"
assert run.fill("n={reached}") == "n=3" and run.fill("{state._meta.reached.Exit}") == "3"
assert run.fill("{Look}").startswith("{'yaw'")  # an element's own result, by id, as a last resort
run.values["Play"] = {"TaskId": "WO", "trials": 5}  # an earlier element's result, into its keys
assert run.fill("{Play.trials} trials") == "5 trials" and run.fill("{Play.nothing}") == "{Play.nothing}"
assert reachy.Plan({"elements": {"t": {"type": "task", "name": "Play"}}, "names": {}}).names == {}  # the digest's `names` are the binding, even empty
# An output edge's transformation narrows the step's result, into a captured value or a declared property.
narrowing = reachy.Plan({"elements": {
    "Study": {"type": "process"},
    "Answer": {"type": "receiveTask", "parent": "Study", "outputs": [{"target": "Seen", "transformation": "result['trials']"}, {"target": "N"}]},
    "Seen": {"type": "dataObjectReference"}, "N": {"type": "property", "parent": "Study", "name": "n"}}})
run = reachy.Run(narrowing, auto=True)
run.store(narrowing.elements["Answer"], {"trials": 5, "log": []})
assert run.values["Seen"] == 5 and run.tree["Study"]["n"] == {"trials": 5, "log": []}
print("ok")

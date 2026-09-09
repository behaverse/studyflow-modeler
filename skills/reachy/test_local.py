"""One check for the participant bridge's parsing; run it with `python3 skills/reachy/test_local.py`."""

import importlib.util
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("reachy", Path(__file__).with_name("local.py"))
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
# A cognitive task is a choreography: the robot on its lower band is the actor who takes it, and wants the seat.
screen = {"type": "participant", "attributes": {}, "extensions": [{"namespace": "cognitive", "type": "actor", "attributes": {"actorType": "instrument"}}]}
pool = {"type": "participant", "attributes": {"processRef": "R"}, "extensions": robot["extensions"]}
task = {"type": "choreographyTask", "parent": "R", "attributes": {"initiatingParticipantRef": "screen"}, "participants": ["screen", "pool"],
        "extensions": [{"namespace": "cognitive", "type": "BehaverseTask", "attributes": {}}]}
seated = reachy.Plan({"elements": {"pool": pool, "screen": screen, "t": task, "r_end": {"type": "endEvent", "parent": "R"},
                                   "s_end": {"type": "endEvent", "parent": "S"}}})
assert seated.robot_participants() == {"pool"} and seated.wants_participant()
assert not reachy.Plan({"elements": {"pool": pool, "t": {**task, "participants": ["screen"], "parent": "S"}}}).wants_participant()  # another pool's task, no robot band
assert reachy.Plan({"elements": {"pool": pool, "t": {**task, "participants": []}}}).wants_participant()  # no bands: the robot pool holds it
assert not reachy.Plan({"elements": {"screen": screen, "t": task}}).wants_participant()  # no robot at all
# Pool message passing: the task in the screen's pool, a message flow to the robot's own step, which carries the prompt in.
flow = {"type": "messageFlow", "attributes": {"sourceRef": "t2", "targetRef": "Answer"}}
pools = reachy.Plan({"elements": {
    "pool": pool, "screen": {**screen, "attributes": {"processRef": "S"}}, "m": flow,
    "t2": {**task, "participants": [], "parent": "S", "attributes": {}},
    "Answer": {"type": "receiveTask", "parent": "R", "inputs": [{"source": "Instructions"}],
               "extensions": [{"namespace": reachy.REACHY, "type": "participate", "attributes": {}}]},
    "Instructions": {"type": "dataObjectReference", "parent": "R",
                     "extensions": [{"namespace": reachy.AGENTIC, "type": "prompt", "attributes": {"template": "Answer by colour."}}]},
}})
assert pools.wants_participant() and "Answer" in reachy.claimed(pools)
assert pools.instructions_of(pools.elements["Answer"]) == "Answer by colour."
assert not reachy.Plan({"elements": {"pool": pool, "screen": {**screen, "attributes": {"processRef": "S"}}, "t2": {**task, "participants": [], "parent": "S"}}}).wants_participant()  # no flow, no band
# A flow naming its message: a trial seats the robot, another skill's message (a marker) does not.
messages = {"Trial": {"type": "message", "attributes": {"itemRef": "Trial_Item"}}, "Trial_Item": {"type": "itemDefinition", "attributes": {"structureRef": "behaverse:Trial"}},
            "Marker": {"type": "message", "attributes": {"itemRef": "Marker_Item"}}, "Marker_Item": {"type": "itemDefinition", "attributes": {"structureRef": "eeg:Marker"}}}
typed = reachy.Plan({"elements": {**pools.elements, **messages, "m": {**flow, "attributes": {**flow["attributes"], "messageRef": "Trial"}}}})
assert typed.message_structure(typed.elements["m"]) == "behaverse:Trial" and typed.wants_participant()
marked = reachy.Plan({"elements": {**pools.elements, **messages, "m": {**flow, "attributes": {**flow["attributes"], "messageRef": "Marker"}}}})
assert marked.message_structure(marked.elements["m"]) == "eeg:Marker" and not marked.wants_participant()
assert pools.message_structure(pools.elements["m"]) == ""
# What the seated robot keeps goes where the Participate step's data output says, `reachy/` when it says nothing.
assert pools.recording_uri() == "reachy/"
named = reachy.Plan({"elements": {**pools.elements, "Answer": {**pools.elements["Answer"], "outputs": [{"target": "Seen"}]},
                                  "Seen": {"type": "dataObjectReference", "attributes": {"uri": "robot/seen/"}}}})
assert named.recording_uri() == "robot/seen/"
assert reachy.Plan({"elements": {"t": {**task, "name": "Play"}}, "names": {}}).names == {}  # the digest's `names` are the binding, even empty
assert seated.robot_processes() == {"R"}
assert reachy.claimed(seated) == ["r_end"]  # the robot's own end, not another pool's
assert reachy.claimed(reachy.Plan({"elements": {"pool": robot, "done": end}})) == ["done"]  # no pools: every end
assert reachy.reply_line("Seen: a blue disk\nRule: blue means Right\nAnswer: Right", "rule") == "blue means Right"
assert reachy.reply_line("Answer: Right", "seen") == "?"
import tempfile
tmp = Path(tempfile.mkdtemp())
reachy.note_reasoning(tmp / "frames", {"trial": 1, "answer": "Right"})
reachy.note_reasoning(None, {"trial": 2})  # no frames dir: nothing kept
assert (tmp / "reasoning.jsonl").read_text() == '{"trial": 1, "answer": "Right"}\n'
assert reachy.parse_vlm("ollama:gemma4:12b-it-qat") == ("ollama", "gemma4:12b-it-qat") and reachy.parse_vlm("gemma4") == ("ollama", "gemma4")
assert reachy.answer_side("Right", ["Left", "Right"]) == "right" and reachy.answer_side("Left", ["Left", "Right"]) == "left"
assert reachy.answer_side("B", ["A", "B", "C"]) == "both"
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

# The camera stream has one reader; a frame the reader saw is what everyone else gets, however slow the feed.
import threading
import time
from types import SimpleNamespace

class SlowSink:
    """A sink that yields one frame every fifth pull, like a paced WebRTC feed emptied by each pull."""
    pulls = 0
    def get_frame(self):
        self.pulls += 1
        return "frame" if self.pulls % 5 == 0 else None

camera = SimpleNamespace(mini=SimpleNamespace(media=SlowSink()), media_backend="webrtc")
threading.Thread(target=reachy.read_stream, args=(camera,), daemon=True).start()
for _ in range(3):
    assert reachy.camera_frame(camera) == "frame"
camera.mini = None  # a closed robot ends the reader
assert reachy.camera_frame(SimpleNamespace(media_backend="no_media")) is None
reachy.LATEST_FRAME = (0.0, None)
assert reachy.camera_frame(SimpleNamespace(mini=None, media_backend="webrtc"), wait=0.2) is None
print("ok")
assert reachy.bridge_port("ws://localhost:9000") == 9000 and reachy.bridge_port("ws://robot.local") == 8765
# An output edge's transformation narrows the step's result, into a captured value or a declared property.
narrowing = reachy.Plan({"elements": {
    "Study": {"type": "process"},
    "Answer": {"type": "receiveTask", "parent": "Study", "outputs": [{"target": "Seen", "transformation": "result['trials']"}, {"target": "N"}]},
    "Seen": {"type": "dataObjectReference"}, "N": {"type": "property", "parent": "Study", "name": "n"}}})
run = reachy.Run(narrowing, auto=True)
run.store(narrowing.elements["Answer"], {"trials": 5, "log": []})
assert run.values["Seen"] == 5 and run.tree["Study"]["n"] == {"trials": 5, "log": []}
# A Say step may name its renderer: `shell://say` with the line in `args`, flags as keys; the robot plays the result.
said = {"id": "Greet", "attributes": {"implementation": "shell://say"}, "additionalArguments": "v: Alex\nargs:\n  - Hello there\n"}
assert reachy.renderer_of(said) == (["say", "-v", "Alex"], "Hello there")
assert reachy.renderer_of({"id": "Greet", "attributes": {}}) == (None, "")

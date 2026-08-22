#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["reachy-mini[mujoco]>=1.9", "websockets>=13", "pillow>=10"]
# ///
"""Run the Reachy Mini elements of a studyflow.

Usage:
    ./studyflow-reachy.py <diagram>.studyflow.png [--sim] [--auto] [--max-steps N]
    ./studyflow-reachy.py <diagram>.studyflow.png --participant [--sim] [--port N]

With `--participant` the roles flip: the robot sits in front of the screen as the
participant. It serves the browser runner's response bridge (`ws://localhost:8765`),
and each time a Behaverse task awaits a response (`ResponseSource: external` in the
task's bot configurations) it looks at the screen, takes a camera frame — falling
back to the screenshot the task attaches when it has no camera — asks the diagram's
model what it sees and how to respond, and the browser injects the answer.

Walks the diagram's flow and performs each `reachy:*` element. By default it is a
terminal dry run: the robot's speech is printed, and its senses and the
participant's lines come from stdin (`--auto` answers them with canned values
instead, for CI). With `--sim` — or when the diagram's Robot pool says
`variant: simulation` — it drives a MuJoCo-simulated Reachy Mini through the
`reachy_mini` Python SDK, starting a headless sim daemon if none is listening;
gestures, look-ats, and speech taps move the simulated robot for real.
Elements from other schemas are logged and passed over. In hand-off mode
(`--element <id> --cache <dir>`, driven by studyflow-run-local) it executes that
one element, reading the state from the cache's `<id>.state.json` and writing
the updated state back into the same file (`result`, `durationMs`, and on
failure `error` merged in); the person stays on stderr and the tty.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import signal
import re
import struct
import sys
import time
import zlib
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

REACHY = "https://w3id.org/studyflow/reachy"

END_TAGS = {"endEvent"}
GATEWAY_TAGS = {"exclusiveGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway"}
CONTAINER_TAGS = {"subProcess", "adHocSubProcess", "transaction"}
PASSTHROUGH_TAGS = {"startEvent", "intermediateCatchEvent", "intermediateThrowEvent"}

# The schema's defaults; moddle omits an attribute whose value equals its default.
DEFAULTS: dict[str, dict[str, Any]] = {
    "robot": {"variant": "wireless", "host": "reachy-mini.local", "voice": "", "language": "", "volume": "80"},
    "say": {"text": ""},
    "gesture": {"move": "cheerful1"},
    "lookAt": {"target": "face"},
    "listen": {"timeoutSeconds": "10"},
    "converse": {"model": "", "persona": "", "maxTurns": "10", "stopPhrase": ""},
    "teleoperation": {"instructions": ""},
    "senseEvent": {"trigger": "wake_word", "wakeWord": "Hey Reachy"},
    "perceptionGateway": {"channel": "face_count"},
}

AUTO_SAMPLES = {"face_count": "1", "sound_level": "42.0", "emotion": "neutral", "speech_intent": "chat"}
AUTO_LINES = ["It went well — the second block was hard!", "goodbye"]


def local(element: ET.Element) -> str:
    return element.tag.split("}")[-1]


def studyflow_from_png(path: Path) -> str:
    """Mirrors `studyflow-prov.py's studyflow_from_png`: the diagram travels in a PNG text chunk."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    offset = 8
    while offset + 8 <= len(data):
        (length,) = struct.unpack(">I", data[offset:offset + 4])
        kind = data[offset + 4:offset + 8].decode("ascii", "replace")
        body = data[offset + 8:offset + 8 + length]
        if kind in ("iTXt", "tEXt", "zTXt"):
            keyword, _, rest = body.partition(b"\x00")
            if keyword == b"studyflow":
                if kind == "iTXt":
                    compressed = rest[0]
                    rest = rest[2:].split(b"\x00", 2)[2]
                    return zlib.decompress(rest).decode() if compressed else rest.decode()
                return rest.decode()
        offset += 12 + length
    raise ValueError(f"{path} carries no studyflow payload")


def reachy_extension(element: ET.Element) -> ET.Element | None:
    for ext in element:
        if local(ext) != "extensionElements":
            continue
        for child in ext:
            if child.tag.startswith(f"{{{REACHY}}}"):
                return child
    return None


def settings_of(ext: ET.Element) -> dict[str, Any]:
    """Defaults, overlaid by the extension's attributes and child-element bodies."""
    merged: dict[str, Any] = dict(DEFAULTS.get(local(ext), {}))
    merged.update(ext.attrib)
    for child in ext:
        name, text = local(child), (child.text or "").strip()
        if name in merged and isinstance(merged[name], list):
            merged[name].append(text)
        elif name in merged and not isinstance(merged[name], str):
            merged[name] = [merged[name], text]
        else:
            merged[name] = text
    return merged


class Studyflow:
    def __init__(self, xml: str) -> None:
        self.definitions = ET.fromstring(xml)
        self.process = self._find_process()
        self.elements: dict[str, ET.Element] = {}
        self.outgoing: dict[str, list[ET.Element]] = {}
        self.incoming: dict[str, int] = {}

        def index(container: ET.Element) -> None:
            for element in container:
                if element.get("id"):
                    self.elements[element.get("id")] = element
                if local(element) == "sequenceFlow":
                    self.outgoing.setdefault(element.get("sourceRef"), []).append(element)
                    self.incoming[element.get("targetRef")] = self.incoming.get(element.get("targetRef"), 0) + 1
                if local(element) in CONTAINER_TAGS:
                    index(element)

        index(self.process)
        self.names = {
            eid: el.get("name") for eid, el in self.elements.items()
            if el.get("name") and re.fullmatch(r"[A-Za-z_]\w*", el.get("name"))
        }

    def _find_process(self) -> ET.Element:
        processes = [el for el in self.definitions if local(el) == "process"]
        # A pool diagram: prefer the process the Robot participant references.
        for collab in self.definitions:
            if local(collab) != "collaboration":
                continue
            for participant in collab:
                if local(participant) == "participant" and reachy_extension(participant) is not None:
                    ref = participant.get("processRef")
                    for process in processes:
                        if process.get("id") == ref:
                            return process
        for process in processes:
            if any(local(c) == "sequenceFlow" for c in process):
                return process
        raise ValueError("no process with a sequence flow to walk")

    def start_of(self, container: ET.Element) -> ET.Element:
        for element in container:
            if local(element) == "startEvent":
                return element
        # A fragment (e.g. a wake-word sub-process) may open with an event instead.
        for element in container:
            if element.get("id") and local(element) != "sequenceFlow" and not self.incoming.get(element.get("id")):
                return element
        raise ValueError(f"{container.get('id')}: no start event and no unentered node")

    def robot_config(self) -> dict[str, Any]:
        for collab in self.definitions:
            if local(collab) != "collaboration":
                continue
            for participant in collab:
                ext = reachy_extension(participant) if local(participant) == "participant" else None
                if ext is not None and local(ext) == "robot":
                    return settings_of(ext)
        return dict(DEFAULTS["robot"])

    def title(self) -> str:
        if self.process.get("name"):
            return self.process.get("name")
        for collab in self.definitions:
            if local(collab) != "collaboration":
                continue
            for participant in collab:
                if participant.get("processRef") == self.process.get("id") and participant.get("name"):
                    return participant.get("name")
        return self.process.get("id") or "studyflow"


# --- robots: the terminal robot only narrates; the sim robot also moves ---

class TerminalRobot:
    label = "dry run"

    def speak(self, text: str) -> None: ...
    def gesture(self, move: str) -> None: ...
    def look_at(self, target: str) -> None: ...
    def listening(self) -> None: ...
    def perk(self) -> None: ...
    def close(self) -> None: ...


# The SDK's official recorded-move library, played through `play_move`.
EMOTIONS_LIBRARY = "pollen-robotics/reachy-mini-emotions-library"

# Names the schema used before it adopted the library's own, kept working here.
MOVE_ALIASES = {"happy": "cheerful1", "sad": "sad1", "curious": "curious1", "surprised": "surprised1",
                "nod": "yes1", "shake": "no1", "look_around": "attentive1", "dance": "dance1", "rest": "sleep1"}


class SimRobot:
    """Drives a Reachy Mini through the `reachy_mini` SDK — a MuJoCo sim, or in
    participant mode a real unit whose daemon already answers on the host."""

    def __init__(self, host: str, media_backend: str = "no_media") -> None:
        self.host = host
        self.media_backend = media_backend
        self.label = "simulation" if media_backend == "no_media" else "robot"
        self.mini: Any = None
        self._pose: Any = None
        self._moves: Any = None
        self._daemon: Any = None

    def connect(self) -> None:
        from reachy_mini import ReachyMini  # imported lazily so dry runs never pay for it
        from reachy_mini.utils import create_head_pose

        self._pose = create_head_pose
        self._ensure_daemon(self.host)
        local_only = self.host in ("localhost", "127.0.0.1")
        self.mini = ReachyMini(
            host=self.host,
            connection_mode="localhost_only" if local_only else "auto",
            media_backend=self.media_backend,
            log_level="WARNING",
        )

    def _ensure_daemon(self, host: str) -> None:
        import shutil
        import subprocess
        import time
        import urllib.request

        def up() -> bool:
            try:
                urllib.request.urlopen(f"http://{host}:8000/", timeout=2)
                return True
            except OSError:
                return False

        if up():
            return
        if host not in ("localhost", "127.0.0.1"):
            raise ConnectionError(f"no Reachy daemon answers on {host}:8000")
        print("    starting a headless sim daemon…")
        daemon = shutil.which("reachy-mini-daemon") or str(Path(sys.executable).with_name("reachy-mini-daemon"))
        # Held on self from the moment it exists, so a hard stop can always fold it.
        self._daemon = subprocess.Popen(
            [daemon, "--sim", "--headless", "--no-media", "--log-level", "WARNING"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if up():
                time.sleep(2)  # let the backend finish waking the robot
                return
            if self._daemon.poll() is not None:
                raise ConnectionError("the sim daemon exited during startup")
            time.sleep(0.5)
        self.close()
        raise ConnectionError("timed out waiting for the sim daemon")

    def _go(self, head: dict | None, antennas: list[float] | None, duration: float, body_yaw: float | None) -> None:
        self.mini.goto_target(
            head=self._pose(**head) if head is not None else None,
            antennas=antennas,
            duration=duration,
            body_yaw=body_yaw,
        )

    def _act(self, steps: list[tuple[dict | None, list[float] | None, float, float | None]]) -> None:
        try:
            for head, antennas, duration, body_yaw in steps:
                self._go(head, antennas, duration, body_yaw)
        except Exception as error:
            print(f"    (sim motion failed: {error})")

    def speak(self, text: str) -> None:
        # No TTS in the headless sim: tap the antennas while the line prints.
        self._act([(None, [0.25, -0.25], 0.15, None), (None, [0.0, 0.0], 0.15, None)])

    def gesture(self, move: str) -> None:
        try:
            if self._moves is None:
                from reachy_mini.motion.recorded_move import RecordedMoves
                self._moves = RecordedMoves(EMOTIONS_LIBRARY)
            self.mini.play_move(self._moves.get(MOVE_ALIASES.get(move, move)), initial_goto_duration=1.0, sound=False)
        except Exception as error:
            print(f"    (sim move failed: {error})")

    def look_at(self, target: str) -> None:
        try:
            if target == "face":
                self.mini.look_at_world(0.4, 0.0, 0.15, duration=0.7)
            elif target == "sound":
                self._act([({"yaw": 20}, None, 0.5, None), ({"yaw": -20}, None, 0.7, None), ({}, None, 0.5, None)])
            else:
                self._act([({}, [0.0, 0.0], 0.6, None)])
        except Exception as error:
            print(f"    (sim motion failed: {error})")

    def listening(self) -> None:
        self._act([({"roll": 8}, None, 0.4, None)])

    def perk(self) -> None:
        self._act([(None, [0.5, -0.5], 0.15, None), (None, [0.1, -0.1], 0.2, None)])

    def close(self) -> None:
        if self.mini is not None:
            self._act([({}, [0.0, 0.0], 0.5, None)])
            try:
                self.mini.__exit__(None, None, None)  # the SDK's only public teardown path
            except Exception:
                pass
            self.mini = None
        # Only the daemon this run spawned; one that was already serving stays.
        if self._daemon is not None:
            self._daemon.terminate()
            self._daemon = None


def output_targets(element: ET.Element) -> list[str]:
    targets = []
    for association in element:
        if local(association) != "dataOutputAssociation":
            continue
        target = next((c for c in association if local(c) == "targetRef"), None)
        if target is not None and (target.text or "").strip():
            targets.append(target.text.strip())
    return targets


@dataclass
class Run:
    studyflow: Studyflow
    auto: bool
    robot: Any = field(default_factory=TerminalRobot)
    values: dict[str, Any] = field(default_factory=dict)
    trace: list[str] = field(default_factory=list)
    auto_lines: list[str] = field(default_factory=lambda: list(AUTO_LINES))

    def say_line(self, text: str) -> None:
        print(f'    Reachy ▶ "{text}"')
        self.robot.speak(text)

    def ask(self, prompt: str, default: str) -> str:
        if self.auto:
            print(f"    {prompt} [auto: {default}]")
            return default
        answer = input(f"    {prompt} [{default}]: ").strip()
        return answer or default

    def fill(self, text: str) -> str:
        space = self.namespace()
        return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda m: str(space.get(m.group(1), m.group(0))), text)

    def namespace(self) -> dict[str, Any]:
        space: dict[str, Any] = {"state": SimpleNamespace(trace=self.trace)}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.studyflow.names.get(element_id)
            if name:
                space[name] = value
        return space

    def store(self, element: ET.Element, value: Any) -> None:
        self.values[element.get("id")] = value
        for target in output_targets(element):
            self.values[target] = value
            print(f"    → {self.studyflow.names.get(target) or target}  (captured)")


# --- dry-run handlers: one per reachy element, keyed by the extension's local name ---

def run_say(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    run.say_line(run.fill(str(spec["text"])) or "(nothing to say)")
    return None


def run_gesture(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    print(f"    Reachy plays the '{spec['move']}' move")
    run.robot.gesture(str(spec["move"]))
    return None


def run_look_at(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    print(f"    Reachy turns toward: {spec['target']}")
    run.robot.look_at(str(spec["target"]))
    return None


def run_listen(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    run.robot.listening()
    canned = run.auto_lines.pop(0) if run.auto and run.auto_lines else "Thanks, that was fun!"
    return run.ask(f"participant says (within {spec['timeoutSeconds']}s)", canned)


def run_converse(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    stop = str(spec["stopPhrase"]).lower()
    if spec["persona"]:
        print(f"    persona: {str(spec['persona']).splitlines()[0]}…")
    turns: list[dict[str, str]] = []
    for turn in range(int(float(spec["maxTurns"]))):
        heard = run.ask("participant says", run.auto_lines.pop(0) if run.auto and run.auto_lines else "goodbye")
        turns.append({"participant": heard})
        if stop and stop in heard.lower():
            run.say_line("Alright — goodbye!")
            break
        reply = f"(dry run — {spec['model'] or 'a model'} would reply to: {heard})"
        run.say_line(reply)
        turns.append({"robot": reply})
    return turns


def run_teleoperation(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    if spec["instructions"]:
        print(f"    operator instructions: {spec['instructions']}")
    run.ask("operator ready — press Enter", "ok")
    return None


def wait_sense(run: Run, element: ET.Element, spec: dict[str, Any]) -> Any:
    what = f"the wake word ('{spec['wakeWord']}')" if spec["trigger"] == "wake_word" else spec["trigger"]
    run.ask(f"waiting for {what} — press Enter to sense it", "sensed")
    run.robot.perk()
    return {"trigger": spec["trigger"]}


def sample_perception(run: Run, element: ET.Element, spec: dict[str, Any]) -> dict[str, Any]:
    channel = str(spec["channel"])
    raw = run.ask(f"perception sample: {channel} =", AUTO_SAMPLES.get(channel, "0"))
    try:
        value: Any = float(raw) if "." in raw else int(raw)
    except ValueError:
        value = raw
    return {channel: value}


# Every reachy element this runner claims, keyed by the extension's local name.
HANDLERS: dict[str, Callable[[Run, ET.Element, dict[str, Any]], Any]] = {
    "say": run_say,
    "gesture": run_gesture,
    "lookAt": run_look_at,
    "listen": run_listen,
    "converse": run_converse,
    "teleoperation": run_teleoperation,
    "senseEvent": wait_sense,
    "perceptionGateway": sample_perception,
}


# --- participant mode: the robot sits in front of the screen and plays the task ---

VLM_SYSTEM = (
    "You are a small desktop robot taking part in a cognitive task, looking at the task "
    "screen. Decide from the image what the correct response is."
)


def frame_data_url(robot: Any) -> str | None:
    """What the robot's camera sees, as a data-URL JPEG; None without a camera."""
    if getattr(robot, "media_backend", "no_media") == "no_media":
        return None
    try:
        frame = robot.mini.media.get_frame()
        if frame is None:
            return None
        import base64
        from io import BytesIO
        from PIL import Image

        buffer = BytesIO()
        Image.fromarray(frame[:, :, ::-1]).save(buffer, format="JPEG", quality=85)  # BGR → RGB
        return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()
    except Exception:
        return None


def call_claude(model: str, user: str, image: str | None) -> str:
    import urllib.request

    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    content: list[dict[str, Any]] = []
    if image:
        media_type, data = image.removeprefix("data:").split(";base64,", 1)
        content.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    content.append({"type": "text", "text": user})
    body = {"model": model, "max_tokens": 64, "system": VLM_SYSTEM,
            "messages": [{"role": "user", "content": content}]}
    request = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        data = json.load(response)
    return "".join(block.get("text", "") for block in data.get("content", []))


def call_ollama(model: str, user: str, image: str | None) -> str:
    import urllib.request

    message: dict[str, Any] = {"role": "user", "content": user}
    if image:
        message["images"] = [image.split(";base64,", 1)[1]]
    body = {"model": model, "stream": False, "think": False,
            "messages": [{"role": "system", "content": VLM_SYSTEM}, message]}
    request = urllib.request.Request(
        "http://localhost:11434/api/chat", data=json.dumps(body).encode(),
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
    return data["message"]["content"]


def match_option(reply: str, options: list[str]) -> str | None:
    """The `Answer:` line if the reply has one, else the whole reply, matched to an option."""
    answers = [line.split(":", 1)[1] for line in reply.splitlines() if line.strip().lower().startswith("answer:")]
    for candidate in answers + [reply]:
        cleaned = candidate.strip().strip("`\"'. ").lower()
        for option in options:
            if option.lower() == cleaned:
                return option
        for option in options:
            if option.lower() in cleaned:
                return option
    return None


def answer_trial(robot: Any, trial: dict[str, Any], history: list[str]) -> tuple[str, str]:
    """Perceive, decide, and pick a response option: (response, agent id)."""
    options = [str(o) for o in trial.get("ResponseOptions", [])]
    robot.perk()
    image = frame_data_url(robot) or trial.get("Screenshot")
    llm = trial.get("LLM") if isinstance(trial.get("LLM"), dict) else {}
    provider = str(llm.get("Provider") or "claude")
    model = str(llm.get("Model") or ("claude-haiku-4-5" if provider == "claude" else "llama3.2-vision"))

    lines = [trial["Prompt"]] if trial.get("Prompt") else []
    lines += [f"Task: {trial.get('Scene', '?')} — trial {trial.get('TrialIndex', '?')}."]
    if history:
        lines += ["Your previous trials:"] + [f"  {entry}" for entry in history[-12:]]
    lines += [
        "The attached image is your view of the task screen." if image
        else "No image is available this trial; answer as well as you can.",
        "Reply with exactly two lines:",
        "Seen: <the stimulus you see on the screen>",
        f"Answer: <one of: {', '.join(options)}>",
    ]
    try:
        call = call_claude if provider == "claude" else call_ollama
        reply = call(model, "\n".join(lines), image)
        response = match_option(reply, options)
        if response is None:
            raise ValueError(f"reply named no option: {reply[:80]!r}")
        seen = next((line.split(":", 1)[1].strip() for line in reply.splitlines()
                     if line.strip().lower().startswith("seen:")), "?")
        history.append(f"trial {trial.get('TrialIndex', '?')}: seen={seen}, answered={response}")
        return response, f"reachy:{provider}:{model}"
    except Exception as error:
        print(f"    (VLM unavailable: {error}) — answering at random")
        response = random.choice(options)
        history.append(f"trial {trial.get('TrialIndex', '?')}: seen=?, answered={response} (random)")
        return response, "reachy:random"


def participant_loop(robot: Any, port: int) -> int:
    """Serve the browser runner's response bridge until interrupted (Ctrl-C)."""
    import asyncio

    import websockets

    sys.stdout.reconfigure(line_buffering=True)  # trial lines stream even when piped
    history: list[str] = []

    async def handle(socket: Any) -> None:
        print("    the task runner connected")
        async for raw in socket:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "completed":
                print(f"● task complete — {message.get('TaskId') or 'done'}")
                # In a thread: the SDK's play_move sync wrapper refuses to run on the event loop.
                await asyncio.to_thread(robot.gesture, "cheerful1")
                history.clear()
            elif message.get("type") == "trial":
                response, agent = await asyncio.to_thread(answer_trial, robot, message, history)
                print(f"    trial {message.get('TrialIndex', '?')}: {response}  ({agent})")
                await socket.send(json.dumps({
                    "type": "response", "RequestId": message.get("RequestId"),
                    "Response": response, "Agent": {"Id": agent},
                }))

    async def serve() -> None:
        async with websockets.serve(handle, "localhost", port):
            print(f"Reachy participant ({robot.label}) — bridge on ws://localhost:{port}, Ctrl-C to leave the seat")
            print("Run the study in the browser; the task's bot needs `ResponseSource: external`.")
            robot.look_at("face")  # the screen is straight ahead
            await asyncio.Future()

    asyncio.run(serve())
    return 0


# --- the walk: studyflow-run-local's control flow, minus records, repos, and reuse ---

def evaluate(run: Run, expression: str, extra: dict[str, Any]) -> Any:
    space = run.namespace() | extra
    try:
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - dry run, authored plan
    except NameError as error:
        print(f"    condition '{expression}' names a value this dry run never made ({error}) — treated as False")
        return False


def choose_flow(run: Run, element: ET.Element, bindings: dict[str, Any]) -> ET.Element:
    flows = run.studyflow.outgoing.get(element.get("id"), [])
    for flow in flows:
        condition = next((c for c in flow if local(c) == "conditionExpression"), None)
        if condition is None or not (condition.text or "").strip():
            continue
        if evaluate(run, condition.text.strip(), bindings):
            print(f"    {condition.text.strip()} → {flow.get('id')}")
            return flow
    default = next((f for f in flows if f.get("id") == element.get("default")), None)
    if default is None:
        raise RuntimeError(f"{element.get('id')}: no condition held and no default flow")
    print(f"    default → {default.get('id')}")
    return default


def next_element(run: Run, element: ET.Element) -> ET.Element | None:
    flows = run.studyflow.outgoing.get(element.get("id"), [])
    if not flows:
        return None
    if local(element) not in GATEWAY_TAGS:
        return run.studyflow.elements.get(flows[0].get("targetRef"))
    ext = reachy_extension(element)
    bindings = sample_perception(run, element, settings_of(ext)) if ext is not None and local(ext) == "perceptionGateway" else {}
    return run.studyflow.elements.get(choose_flow(run, element, bindings).get("targetRef"))


def walk(run: Run, element: ET.Element | None, max_steps: int) -> None:
    steps = 0
    while element is not None:
        steps += 1
        if steps > max_steps:
            raise RuntimeError("step budget exhausted — is the flow cycling without an exit?")
        element_id = element.get("id")
        run.trace.append(element_id)
        tag = local(element)
        label = run.studyflow.elements[element_id].get("name") or element_id
        ext = reachy_extension(element)

        if tag in END_TAGS:
            print(f"● {label}")
            return
        if tag in GATEWAY_TAGS:
            print(f"◇ {label}")
        elif tag in CONTAINER_TAGS:
            print(f"⊞ {label}")
            walk(run, run.studyflow.start_of(element), max_steps)
        elif tag in PASSTHROUGH_TAGS:
            if ext is not None and local(ext) == "senseEvent":
                perform(run, element, ext)
            else:
                print(f"○ {label}")
        elif ext is not None and local(ext) in HANDLERS:
            perform(run, element, ext)
        else:
            print(f"· {label}  (not a Reachy element — passed over)")

        element = next_element(run, element)


def perform(run: Run, element: ET.Element, ext: ET.Element) -> dict[str, Any]:
    """One reachy element, as the keys a hand-off merges into the state: its result and timing."""
    kind, spec = local(ext), settings_of(ext)
    if kind not in HANDLERS:
        raise KeyError(f"no handler for reachy:{kind}")
    glyph = {"perceptionGateway": "◇", "senseEvent": "◐"}.get(kind, "□")
    print(f"{glyph} {element.get('name') or element.get('id')}")
    clock = time.perf_counter()
    value = HANDLERS[kind](run, element, spec)
    if kind == "senseEvent":
        run.values[element.get("id")] = value
    elif kind != "perceptionGateway" and value is not None:
        run.store(element, value)
    return {"result": value, "durationMs": round((time.perf_counter() - clock) * 1000, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("diagram", type=Path, help="a .studyflow.png (or .bpmn/.xml) to walk")
    parser.add_argument("--sim", action="store_true", help="drive a simulated robot through the reachy_mini SDK")
    parser.add_argument("--auto", action="store_true", help="answer every prompt with a canned value")
    parser.add_argument("--max-steps", type=int, default=200)
    parser.add_argument(
        "--participant", action="store_true",
        help="sit in the participant's seat: answer the browser task's trials from what the robot sees",
    )
    parser.add_argument("--port", type=int, default=8765, help="participant bridge port (the runner's BridgeUrl)")
    parser.add_argument(
        "--element", metavar="ID", default=None,
        help="hand-off mode: execute this one element, then exit (driven by studyflow-run-local)",
    )
    parser.add_argument(
        "--claims", action="store_true",
        help="print the element ids this runner would execute, as a JSON array, and exit",
    )
    parser.add_argument(
        "--cache", type=Path, default=None, metavar="DIR",
        help="hand-off state: the run's values arrive in <element>.state.json, the result goes back into it",
    )
    args = parser.parse_args()

    xml = studyflow_from_png(args.diagram) if args.diagram.suffix.lower() == ".png" else args.diagram.read_text()
    studyflow = Studyflow(xml)

    if args.claims:
        # This runner claims every element carrying a reachy extension it has a handler for.
        print(json.dumps([
            element_id for element_id, element in studyflow.elements.items()
            if (ext := reachy_extension(element)) is not None and local(ext) in HANDLERS
        ]))
        return 0

    config = studyflow.robot_config()

    robot: Any = TerminalRobot()

    def handle_stop(signum: int, frame: Any) -> None:
        # A hard stop skips every `finally`, so fold the spawned sim daemon here before leaving.
        robot.close()
        os._exit(128 + signum)

    # Registered before any daemon can exist, so even a stop mid-startup folds it.
    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    sim = args.sim or config["variant"] == "simulation"
    if sim or args.participant:
        # The sim daemon is local; only an explicitly set host points elsewhere.
        host = str(config["host"])
        if sim and host == DEFAULTS["robot"]["host"]:
            host = "localhost"
        local = host in ("localhost", "127.0.0.1")
        # The sim has no camera; a Lite's camera hangs off this machine, a wireless unit streams its own.
        media = "no_media" if sim else ("default" if local else "webrtc")
        robot = SimRobot(host=host, media_backend=media)
        try:
            robot.connect()
        except Exception as error:
            robot.close()
            robot = TerminalRobot()
            print(f"robot unavailable ({error}) — carrying on as a dry run")

    if args.participant:
        try:
            return participant_loop(robot, args.port)
        finally:
            robot.close()

    # In hand-off mode stdin is never a channel: without a terminal the runner answers itself.
    run = Run(studyflow, auto=args.auto or bool(args.element and not sys.stdin.isatty()), robot=robot)

    if args.element:
        # The person is on stderr and the tty; stdout is captured into the run log.
        sys.stdout = sys.stderr
        cache = args.cache or Path(".")
        handoff = cache / f"{args.element}.state.json"
        state = json.loads(handoff.read_text()) if handoff.exists() else {}
        run.values.update(state)
        try:
            element = studyflow.elements.get(args.element)
            ext = reachy_extension(element) if element is not None else None
            if element is None or ext is None:
                raise KeyError(f"no reachy element {args.element!r} in the diagram")
            result = perform(run, element, ext)
        except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
            result = {"error": f"{type(error).__name__}: {error}"}
        finally:
            robot.close()
        cache.mkdir(parents=True, exist_ok=True)
        handoff.write_text(json.dumps({**state, **result}, default=str))
        return 1 if "error" in result else 0

    print(f"{studyflow.title()}  —  Reachy {robot.label}  ({config['variant']} @ {getattr(robot, 'host', config['host'])}, volume {config['volume']})")
    try:
        walk(run, studyflow.start_of(studyflow.process), args.max_steps)
    except (RuntimeError, ValueError) as error:
        print(f"stuck: {error}", file=sys.stderr)
        return 1
    finally:
        robot.close()
    captured = {k: v for k, v in run.values.items() if isinstance(v, (str, list))}
    if captured:
        print("captured:")
        for key, value in captured.items():
            print(f"  {studyflow.names.get(key) or key}: {value if isinstance(value, str) else f'{len(value)} turns'}")
    return 0


if __name__ == "__main__":
    code = main()
    # The SDK's websocket thread is not a daemon thread; flush and leave without joining it.
    sys.stdout.flush()
    sys.stderr.flush()
    import os
    os._exit(code)

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["reachy-mini[mujoco]>=1.9", "websockets>=13", "pillow>=10"]
# ///
"""Run the Reachy Mini elements of a studyflow.

Usage:
    studyflow run <diagram> --runtime local [--sim] [--auto]     # studyflow-run-local walks, this runner performs
    ./studyflow-reachy.py --participant [--sim] [--port N] [--vlm ollama:gemma4:12b-it-qat] [--frames DIR]

A study whose task expects an external participant (`ResponseSource: external`) needs no second command: the
walk seats the robot itself, in the background, and the end event dismisses it. Text attributes may cite the
study state as the modeler does, `{name}` from the element outward or `{state.scope.name}`; a `screen` look's
gaze reaches the state through a data edge into a declared property, and a later look can take it as its target.

A partial runner: studyflow-run-local walks the diagram and hands this script one
`reachy:*` element at a time (`<plan.json> --element <id> --cache <dir>`), with the
run's values in `<id>.state.json`; the updated state goes back into the same file
(`result`, `durationMs`, and on failure `error` merged in). It never opens the
diagram itself: `plan.json` is the digest studyflow-run-local writes. By default it
is a terminal dry run only when no robot answers: the robot's speech is printed, and its senses and the
participant's lines come from stdin (`--auto` answers them with canned values
instead, for CI). With `--sim`, or when the diagram's Robot pool says
`variant: simulation`, it drives a MuJoCo-simulated Reachy Mini through the
`reachy_mini` Python SDK, starting a headless sim daemon if none is listening.

With `--participant` the roles flip and no plan is needed: the robot sits in front
of the screen as the participant. It serves the browser runner's response bridge
(`ws://localhost:8765`), and each time a Behaverse task awaits a response
(`ResponseSource: external` in the task's bot configurations) it looks at the
screen, takes a camera frame (the screenshot the task attaches stands in only when
it has no camera), asks the model what it sees and how to respond, and the browser
injects the answer. On taking the seat it turns its body in steps until the camera
finds a screen and centres on it. The daemon serves one media client, so while it is seated the
walk's own reachy elements (say, gesture, look at the screen…) are performed through it; the
study's end event (claimed here too) dismisses it.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import signal
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

REACHY = "https://w3id.org/studyflow/reachy"

# The schema's defaults; moddle omits an attribute whose value equals its default.
DEFAULTS: dict[str, dict[str, Any]] = {
    "robot": {"variant": "wireless", "host": "reachy-mini.local", "voice": "", "language": "", "volume": "80",
              "vision": "ollama:gemma4:12b-it-qat"},
    "say": {"text": ""},
    "gesture": {"move": "cheerful1", "dataset": "pollen-robotics/reachy-mini-emotions-library"},
    "goto": {"roll": "0", "pitch": "0", "yaw": "0", "x": "0", "y": "0", "z": "0",
             "leftAntenna": "0", "rightAntenna": "0", "bodyYaw": "0",
             "motionDuration": "2", "interpolation": "minjerk"},
    "playSound": {"file": ""},
    "lookAt": {"target": "face", "trackingWeight": "1"},
    "listen": {"timeout": "10"},
    "converse": {"model": "", "persona": "", "maxTurns": "10", "stopPhrase": ""},
    "teleoperation": {"instructions": ""},
    "senseEvent": {"trigger": "wake_word", "wakeWord": "Hey Reachy"},
    "perceptionGateway": {"channel": "face_count"},
}

AUTO_SAMPLES = {"face_count": "1", "sound_angle": "1.57", "speech_detected": "1", "speech_intent": "chat"}
AUTO_LINES = ["It went well — the second block was hard!", "goodbye"]


def reachy_extension(element: dict[str, Any]) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or [] if ext.get("namespace") == REACHY), None)


def settings_of(ext: dict[str, Any]) -> dict[str, Any]:
    """The schema's defaults, overlaid by what the diagram says."""
    return {**DEFAULTS.get(ext["type"], {}), **(ext.get("attributes") or {})}


class Plan:
    """The digest studyflow-run-local hands over (`plan.json`): the study, and every element by id, pool participants included."""

    def __init__(self, digest: dict[str, Any]) -> None:
        self.study: dict[str, Any] = digest.get("study") or {}
        self.elements: dict[str, dict[str, Any]] = digest.get("elements") or {}
        self.parents: dict[str, str] = {eid: el["parent"] for eid, el in self.elements.items() if el.get("parent")}
        self.names = {
            eid: el["name"] for eid, el in self.elements.items()
            if el.get("name") and re.fullmatch(r"[A-Za-z_]\w*", el["name"])
        }

    def scope_chain(self, element_id: str) -> list[str]:
        """The element, then its containers outward to the process."""
        chain = [element_id]
        while chain[-1] in self.parents:
            chain.append(self.parents[chain[-1]])
        return chain

    def property_of(self, target: str) -> tuple[str, str] | None:
        """A data edge's target that is a declared `bpmn:Property`: (its scope, its name)."""
        element = self.elements.get(target)
        if element is None or element.get("type") != "property":
            return None
        return (self.parents.get(target, ""), element.get("name") or target)

    def has_robot(self) -> bool:
        return any(reachy_extension(element) is not None for element in self.elements.values())

    def wants_participant(self) -> bool:
        """A task whose bot answers from outside (`ResponseSource: external`) wants the robot in the seat."""
        return self.has_robot() and any(
            re.search(r'ResponseSource\W+external', json.dumps(element))  # on the task's extension, as written
            for element in self.elements.values()
        )

    def robot_config(self) -> dict[str, Any]:
        for element in self.elements.values():
            ext = reachy_extension(element)
            if ext is not None and ext["type"] == "robot":
                return settings_of(ext)
        return dict(DEFAULTS["robot"])


# --- robots: the terminal robot only narrates; the sim robot also moves ---

class TerminalRobot:
    label = "dry run"

    def speak(self, text: str) -> None: ...
    def gesture(self, move: str, dataset: str | None = None) -> None: ...
    def goto(self, spec: dict[str, Any]) -> None: ...
    def play_sound(self, file: str) -> None: ...
    def look_at(self, target: str) -> dict[str, float] | None: ...
    def look_at_gaze(self, gaze: dict[str, float]) -> None: ...
    def signal(self, side: str) -> None: ...
    def listening(self) -> None: ...
    def perk(self) -> None: ...
    def close(self) -> None: ...


# The SDK's official recorded-move library, played through `play_move`.
EMOTIONS_LIBRARY = "pollen-robotics/reachy-mini-emotions-library"

# Names the schema used before it adopted the library's own, kept working here.
MOVE_ALIASES = {"happy": "cheerful1", "sad": "sad1", "curious": "curious1", "surprised": "surprised1",
                "nod": "yes1", "shake": "no1", "look_around": "attentive1", "dance": "dance1", "rest": "sleep1"}


class SimRobot:
    """Drives a Reachy Mini through the `reachy_mini` SDK: a MuJoCo sim, or in
    participant mode a real unit whose daemon already answers on the host."""

    def __init__(self, host: str, media_backend: str = "no_media", sim: bool | None = None, voice: str = "",
                 vision: str = DEFAULTS["robot"]["vision"]) -> None:
        self.host = host
        self.media_backend = media_backend
        self.sim = media_backend == "no_media" if sim is None else sim
        self.voice = voice
        self.vision = vision
        self.label = "simulation" if self.sim else "robot"
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

        last_error: list[BaseException] = []

        def up() -> bool:
            try:
                urllib.request.urlopen(f"http://{host}:8000/", timeout=5)
                return True
            except OSError as error:
                last_error[:] = [error]
                return False

        if up():
            return
        if host not in ("localhost", "127.0.0.1"):
            raise ConnectionError(f"no Reachy daemon answers on {host}:8000 ({last_error[0]!r})")
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
        # The antennas tap while the line prints; a real unit also says it, through its own speaker.
        self._act([(None, [0.25, -0.25], 0.15, None), (None, [0.0, 0.0], 0.15, None)])
        if self.sim:
            return
        try:
            self._say(text)
        except Exception as error:
            print(f"    (speech failed: {error})")

    def _say(self, text: str) -> float:
        """Render the line with the Mac's `say` and play it on the unit; how long it lasts."""
        import hashlib
        import subprocess
        import tempfile

        if shutil.which("say") is None:
            return 0.0  # ponytail: macOS TTS only; a robot-side TTS app would replace this
        name = f"studyflow-{hashlib.sha1((self.voice + text).encode()).hexdigest()[:12]}.wav"
        path = Path(tempfile.gettempdir()) / name
        if not path.exists():
            subprocess.run(  # noqa: S603 - the study's own line
                ["say", "-o", str(path), "--data-format=LEI16@22050", *(["-v", self.voice] if self.voice else []), text],
                check=True, capture_output=True,
            )
        seconds = self._play_file(path)
        time.sleep(seconds + 0.3)
        return seconds

    _uploaded: set[str] = set()

    def _play_file(self, path: Path) -> float:
        """Upload a sound file to the daemon (once per name) and play it on the unit's speaker; its length in seconds."""
        import urllib.request
        import wave

        name = path.name
        if name not in self._uploaded:
            boundary = "studyflow-sound"
            body = (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                "Content-Type: application/octet-stream\r\n\r\n"
            ).encode() + path.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
            urllib.request.urlopen(urllib.request.Request(
                f"http://{self.host}:8000/api/media/sounds/upload", data=body, method="POST",
                headers={"content-type": f"multipart/form-data; boundary={boundary}"},
            ), timeout=15)
            self._uploaded.add(name)
        self._post("/api/media/play_sound", {"file": name})
        try:
            with wave.open(str(path)) as audio:
                return audio.getnframes() / audio.getframerate()
        except Exception:
            return 0.0

    def gesture(self, move: str, dataset: str | None = None) -> None:
        try:
            move = MOVE_ALIASES.get(move, move)
            if move in ("wake_up", "goto_sleep"):
                # Built-in moves live behind their own daemon endpoints, not a dataset.
                self._post(f"/api/move/play/{move}")
                return
            dataset = dataset or EMOTIONS_LIBRARY
            if self._moves is None:
                self._moves = {}
            if dataset not in self._moves:
                from reachy_mini.motion.recorded_move import RecordedMoves
                self._moves[dataset] = RecordedMoves(dataset)
            recorded = self._moves[dataset].get(move)
            if not self.sim and recorded.sound_path is not None:
                # The library's sidecar sound, through the unit's own speaker (the client's player is host-side).
                try:
                    self._play_file(Path(recorded.sound_path))
                except Exception as error:
                    print(f"    (move sound failed: {error})")
            self.mini.play_move(recorded, initial_goto_duration=1.0, sound=False)
        except Exception as error:
            print(f"    (sim move failed: {error})")
        restore_gaze(self)  # a recorded move starts and ends at rest: back to the screen

    def _post(self, path: str, body: dict[str, Any] | None = None) -> None:
        import urllib.request
        urllib.request.urlopen(
            urllib.request.Request(
                f"http://{self.host}:8000{path}",
                data=json.dumps(body).encode() if body is not None else None,
                headers={"content-type": "application/json"}, method="POST",
            ),
            timeout=10,
        )

    def goto(self, spec: dict[str, Any]) -> None:
        # The daemon's goto speaks radians and meters, exactly as the schema does.
        try:
            duration = float(spec["motionDuration"])
            self._post("/api/move/goto", {
                "head_pose": {k: float(spec[k]) for k in ("x", "y", "z", "roll", "pitch", "yaw")},
                "antennas": [float(spec["leftAntenna"]), float(spec["rightAntenna"])],
                "body_yaw": float(spec["bodyYaw"]),
                "duration": duration,
                "interpolation": spec["interpolation"],
            })
            time.sleep(duration)  # goto returns a move uuid immediately; wait it out
        except Exception as error:
            print(f"    (goto failed: {error})")
        restore_gaze(self)

    def play_sound(self, file: str) -> None:
        try:
            self._post("/api/media/play_sound", {"file": file})
        except Exception as error:
            print(f"    (sound failed: {error})")

    def look_at(self, target: str) -> dict[str, float] | None:
        try:
            if target == "screen":
                if find_screen(self, parse_vlm(self.vision)):
                    return dict(LAST_GAZE or {})
                self.mini.look_at_world(0.5, 0.0, 0.25, duration=0.7)  # no camera, or nothing found: straight ahead, a little up
            elif target == "face":
                self.mini.look_at_world(0.4, 0.0, 0.15, duration=0.7)
            elif target == "sound":
                self._act([({"yaw": 20}, None, 0.5, None), ({"yaw": -20}, None, 0.7, None), ({}, None, 0.5, None)])
            else:
                self._act([({}, [0.0, 0.0], 0.6, None)])
        except Exception as error:
            print(f"    (sim motion failed: {error})")
        return None

    def look_at_gaze(self, gaze: dict[str, float]) -> None:
        """Aim where the study state says the screen is, and remember it as the gaze to come back to."""
        global LAST_GAZE
        LAST_GAZE = {"yaw": float(gaze["yaw"]), "pitch": float(gaze["pitch"])}
        restore_gaze(self)

    def signal(self, side: str) -> None:
        """Answer with the antennas, outward: the left one for the left option, the right one for the right, both
        otherwise (the SDK orders them [right, left]; outward is a negative right and a positive left angle)."""
        out = {"left": [0.0, 1.0], "right": [-1.0, 0.0]}.get(side, [-1.0, 1.0])  # ponytail: signs measured on this unit; flip if yours folds the other way
        self._act([(None, out, 0.25, None), (None, out, 0.35, None), (None, [0.0, 0.0], 0.3, None)])

    def listening(self) -> None:
        self._act([({"roll": 8}, None, 0.4, None)])

    def perk(self) -> None:
        # Both antennas draw inward when a trial starts: the robot is thinking.
        self._act([(None, [0.6, -0.6], 0.15, None), (None, [0.15, -0.15], 0.2, None)])

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


def lookup(tree: Any, keys: list[str]) -> Any:
    for key in keys:
        if not isinstance(tree, dict) or key not in tree:
            return None
        tree = tree[key]
    return tree


def output_targets(element: dict[str, Any]) -> list[str]:
    return [binding["target"] for binding in element.get("outputs") or [] if binding.get("target")]


@dataclass
class Run:
    studyflow: Plan
    auto: bool
    robot: Any = field(default_factory=TerminalRobot)
    values: dict[str, Any] = field(default_factory=dict)
    trace: list[str] = field(default_factory=list)
    auto_lines: list[str] = field(default_factory=lambda: list(AUTO_LINES))
    scope: str = ""  # the element being performed: where `{name}` lookups start

    @property
    def tree(self) -> dict[str, Any]:
        """The study's state tree, `state.<scope>.<property>` and `state._meta`, shared with the hand-off file."""
        return self.values.setdefault("state", {})

    def say_line(self, text: str) -> None:
        print(f'    Reachy ▶ "{text}"')
        self.robot.speak(text)

    def ask(self, prompt: str, default: str) -> str:
        if self.auto:
            print(f"    {prompt} [auto: {default}]")
            return default
        answer = input(f"    {prompt} [{default}]: ").strip()
        return answer or default

    # Placeholders as the modeler resolves them: `{path}`, a dotted lookup from the element outward through its
    # containers (`{count}`, `{screenGaze}`), a single name also as the runner's counter `_meta.<name>.<scope>`,
    # and `{state.a.b}` absolute. Unresolved, a placeholder stays as written.
    def resolve(self, path: str) -> Any:
        keys = [key.strip() for key in path.split(".") if key.strip()]
        if not keys:
            return None
        if keys[0] == "state":
            return lookup(self.tree, keys[1:])
        for scope in self.studyflow.scope_chain(self.scope):
            value = lookup(self.tree, [scope, *keys])
            if value is None and len(keys) == 1:
                value = lookup(self.tree, ["_meta", keys[0], scope])
            if value is not None:
                return value
        return self.namespace().get(keys[0]) if len(keys) == 1 else None  # an element's result, by id or name

    def fill(self, text: str) -> str:
        return re.sub(r"\{([^{}]+)\}", lambda m: str(v) if (v := self.resolve(m.group(1))) is not None else m.group(0), text)

    def value_of(self, text: str) -> Any:
        """An attribute that is one `{path}` placeholder resolves to that value itself; any other text stays text."""
        match = re.fullmatch(r"\s*\{([^{}]+)\}\s*", text)
        if not match:
            return text
        value = self.resolve(match.group(1))
        return text if value is None else value

    def namespace(self) -> dict[str, Any]:
        space: dict[str, Any] = {"state": SimpleNamespace(trace=self.trace)}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.studyflow.names.get(element_id)
            if name:
                space[name] = value
        return space

    def store(self, element: dict[str, Any], value: Any) -> None:
        self.values[element.get("id")] = value
        for target in output_targets(element):
            declared = self.studyflow.property_of(target)
            if declared:
                # A data edge into a declared property writes the study state: `state.<scope>.<name>`.
                scope, name = declared
                self.tree.setdefault(scope, {})[name] = value
                print(f"    → {name}  (state of {self.studyflow.names.get(scope) or scope})")
            else:
                self.values[target] = value
                print(f"    → {self.studyflow.names.get(target) or target}  (captured)")


# --- dry-run handlers: one per reachy element, keyed by the extension's local name ---

def run_say(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    run.say_line(run.fill(str(spec["text"])) or "(nothing to say)")
    return None


def run_gesture(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    print(f"    Reachy plays the '{spec['move']}' move")
    run.robot.gesture(str(spec["move"]), str(spec["dataset"]))
    return None


def run_goto(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    print(f"    Reachy moves to pose (roll {spec['roll']}, pitch {spec['pitch']}, yaw {spec['yaw']}, "
          f"body {spec['bodyYaw']}) over {spec['motionDuration']}s ({spec['interpolation']})")
    run.robot.goto(spec)
    return None


def run_play_sound(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    print(f"    Reachy plays the sound '{spec['file']}'")
    run.robot.play_sound(str(spec["file"]))
    return None


def run_look_at(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    target = run.value_of(str(spec["target"]))
    if is_gaze(target):
        # A gaze the study state holds, e.g. `{{ Look }}` from an earlier `screen` look.
        print(f"    Reachy turns to the gaze the state holds: yaw {float(target['yaw']):+.0f}°, pitch {float(target['pitch']):+.0f}°")
        run.robot.look_at_gaze(target)
        return dict(target)
    print(f"    Reachy turns toward: {target}")
    gaze = run.robot.look_at(str(target))
    return gaze or None  # the found gaze is this element's result: the study state keeps it for what follows


def run_listen(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    run.robot.listening()
    canned = run.auto_lines.pop(0) if run.auto and run.auto_lines else "Thanks, that was fun!"
    return run.ask(f"participant says (within {spec['timeout']}s)", canned)


def run_converse(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
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


def run_teleoperation(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    if spec["instructions"]:
        print(f"    operator instructions: {spec['instructions']}")
    run.ask("operator ready — press Enter", "ok")
    return None


def wait_sense(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    what = f"the wake word ('{spec['wakeWord']}')" if spec["trigger"] == "wake_word" else spec["trigger"]
    run.ask(f"waiting for {what} — press Enter to sense it", "sensed")
    run.robot.perk()
    return {"trigger": spec["trigger"]}


def sample_perception(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> dict[str, Any]:
    channel = str(spec["channel"])
    raw = run.ask(f"perception sample: {channel} =", AUTO_SAMPLES.get(channel, "0"))
    try:
        value: Any = float(raw) if "." in raw else int(raw)
    except ValueError:
        value = raw
    return {channel: value}


# Every reachy element this runner claims, keyed by the extension's local name.
HANDLERS: dict[str, Callable[[Run, dict[str, Any], dict[str, Any]], Any]] = {
    "say": run_say,
    "gesture": run_gesture,
    "goto": run_goto,
    "playSound": run_play_sound,
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


def has_camera(robot: Any) -> bool:
    return getattr(robot, "media_backend", "no_media") != "no_media"


def camera_frame(robot: Any) -> Any:
    """The camera's latest BGR frame, or None."""
    try:
        frame = robot.mini.media.get_frame() if has_camera(robot) else None
    except Exception as error:
        print(f"    (camera frame failed: {error})")
        return None
    if frame is None and has_camera(robot):
        print("    (camera gave no frame)")
    return frame


def jpeg_data_url(frame: Any) -> str:
    import base64
    from io import BytesIO
    from PIL import Image

    buffer = BytesIO()
    Image.fromarray(frame[:, :, ::-1]).save(buffer, format="JPEG", quality=85)  # BGR → RGB
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def frame_data_url(robot: Any) -> str | None:
    """What the robot's camera sees, as a data-URL JPEG; None without a camera."""
    frame = camera_frame(robot)
    return jpeg_data_url(frame) if frame is not None else None


def save_image(frames: Path | None, name: str, image: str) -> None:
    if frames:
        import base64
        frames.mkdir(parents=True, exist_ok=True)
        (frames / f"{name}.jpg").write_bytes(base64.b64decode(image.split(";base64,", 1)[1]))


def vlm_call(provider: str) -> Callable[[str, str, str | None], str]:
    return call_claude if provider == "claude" else call_ollama


def parse_screen_reply(reply: str) -> tuple[int, int] | None:
    """Which way the screen lies from the frame's centre, as (dx, dy) in {-1, 0, 1} with x to the right and y
    down; (0, 0) once its centre is in the middle third both ways. None when the model sees no screen.

    Small vision models place a box poorly and misjudge whether a screen is whole, but they name the third
    of the image that holds it reliably, so that is all the model is asked."""
    lines = {k.strip().lower(): v.strip().lower() for k, _, v in (line.partition(":") for line in reply.splitlines()) if v}
    if not lines.get("screen", "").startswith("yes"):
        return None
    dx = -1 if "left" in lines.get("horizontal", "") else 1 if "right" in lines.get("horizontal", "") else 0
    dy = -1 if "top" in lines.get("vertical", "") else 1 if "bottom" in lines.get("vertical", "") else 0
    return (dx, dy)


def screen_is_centred(where: tuple[int, int]) -> bool:
    return where == (0, 0)


SEARCH_STEP_DEG = (12.0, 8.0)  # ponytail: one nudge of yaw and pitch per look; halve it if the head overshoots a small screen
SEARCH_PITCH_DEG = -10.0  # ponytail: a desk robot looks up at a monitor; tune to the robot's perch (negative is up)
LAST_GAZE: dict[str, float] | None = None  # where the screen was last found, so a repeat look starts (and a failed one ends) there


def restore_gaze(robot: Any) -> None:
    """Back to where the screen was found, if it ever was: every move and pose leaves the head at rest."""
    import math

    if LAST_GAZE and getattr(robot, "mini", None) is not None:
        robot._act([(dict(LAST_GAZE), None, 0.8, math.radians(LAST_GAZE["yaw"]))])


SCREEN_SWEEP_DEG = (0, 45, -45, 90, -90, 135, -135, 180)  # ponytail: fixed body-yaw sweep; a finer or head-pitch sweep if screens sit high or low


def find_screen(robot: Any, vlm: tuple[str, str], frames: Path | None = None) -> bool:
    """Turn the body in steps until the camera sees the task screen, then centre on it with head and base."""
    import math

    if not has_camera(robot):
        return False
    provider, model = vlm
    ask = (
        "Is a computer monitor, laptop screen, or TV visible in this image? If so, which third of the image "
        "contains the centre of the monitor, horizontally (left, middle, or right) and vertically (top, middle, "
        "or bottom)?\n"
        "Reply with exactly three lines:\n"
        "Screen: yes or no\n"
        "Horizontal: left, middle, or right\n"
        "Vertical: top, middle, or bottom"
    )

    def glance(name: str) -> tuple[float, float] | None:
        """Where the screen sits in the current frame, as fractions; None when no screen is in view."""
        time.sleep(1.0)  # let the head settle and the stream catch up, or the frame smears
        frame = camera_frame(robot)
        for _ in range(6):  # the feed skips a beat now and then, right after a move or a fresh connection
            if frame is not None:
                break
            time.sleep(0.5)
            frame = camera_frame(robot)
        if frame is None:
            raise RuntimeError("no camera frame")
        image = jpeg_data_url(frame)
        save_image(frames, name, image)
        return parse_screen_reply(vlm_call(provider)(model, ask, image))

    def aim(gaze: dict[str, float]) -> None:
        # The head pose is in the world frame and the daemon keeps it there whatever the base does, so the base
        # follows the gaze: the neck stays straight and the camera can turn all the way round.
        robot._act([(gaze, None, 1.0, math.radians(gaze["yaw"]))])

    global LAST_GAZE
    try:
        for yaw in (("last",) if LAST_GAZE else ()) + SCREEN_SWEEP_DEG:
            gaze = dict(LAST_GAZE) if yaw == "last" else {"yaw": float(yaw), "pitch": SEARCH_PITCH_DEG}
            yaw = int(gaze["yaw"])
            aim(gaze)
            where = glance(f"search-{yaw:+d}")
            if where is None:
                continue
            # Nudge toward the screen and look again (yaw left and pitch up are positive and negative degrees).
            for step in range(8):
                if screen_is_centred(where):
                    break
                gaze["yaw"] -= where[0] * SEARCH_STEP_DEG[0]
                gaze["pitch"] += where[1] * SEARCH_STEP_DEG[1]
                aim(gaze)
                where = glance(f"search-{yaw:+d}-{step + 1}") or where
            print(f"    found the screen: yaw {gaze['yaw']:+.0f}°, pitch {gaze['pitch']:+.0f}°")
            LAST_GAZE = dict(gaze)
            return True
    except Exception as error:
        print(f"    (could not look for the screen: {error})")
        if LAST_GAZE:
            # The camera failed us, not the memory: the screen is where it was last found.
            try:
                aim(LAST_GAZE)
                print(f"    back to where the screen was: yaw {LAST_GAZE['yaw']:+.0f}°, pitch {LAST_GAZE['pitch']:+.0f}°")
                return True
            except Exception:
                pass
    else:
        print("    no screen in sight after a full turn")
    try:
        aim(LAST_GAZE or {"yaw": 0.0, "pitch": SEARCH_PITCH_DEG})  # back to where the screen was, or to rest
    except Exception:
        pass
    return False


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


def answer_trial(
    robot: Any, trial: dict[str, Any], history: list[str], frames: Path | None = None,
    vlm: tuple[str, str] = ("ollama", "gemma4:12b-it-qat"),
) -> tuple[str, str]:
    """Perceive, decide, and pick a response option: (response, agent id)."""
    options = [str(o) for o in trial.get("ResponseOptions", [])]
    robot.perk()
    # A robot with a camera plays from what it sees; the task's screenshot only stands in when it has none.
    frame = frame_data_url(robot)
    image = frame if has_camera(robot) else trial.get("Screenshot")
    print(f"    sees: {'camera' if frame else 'screenshot' if image else 'nothing'}")
    if image:
        save_image(frames, f"trial-{trial.get('TrialIndex', '?')}", image)
    llm = trial.get("LLM") if isinstance(trial.get("LLM"), dict) else {}
    provider = str(llm.get("Provider") or vlm[0])
    model = str(llm.get("Model") or (vlm[1] if provider == vlm[0] else "claude-haiku-4-5" if provider == "claude" else "gemma4:12b-it-qat"))

    lines = [trial["Prompt"]] if trial.get("Prompt") else []
    lines += [f"Task: {trial.get('Scene', '?')} — trial {trial.get('TrialIndex', '?')}."]
    if history:
        lines += ["Your previous trials:"] + [f"  {entry}" for entry in history[-12:]]
    lines += [
        "The attached image is your view of the task screen." if image
        else "No image is available this trial; answer as well as you can.",
        "Reply with exactly three lines:",
        "Seen: <the stimulus you see on the screen>",
        "Rule: <what your instructions say that stimulus calls for>",
        f"Answer: <one of: {', '.join(options)}>",
    ]
    try:
        reply = vlm_call(provider)(model, "\n".join(lines), image)
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


BRIDGE_PORT = 8765  # set from --port; where a seated participant listens


def parse_vlm(text: str) -> tuple[str, str]:
    """`provider:model` → (provider, model); a bare model is Ollama's."""
    return tuple(text.split(":", 1)) if ":" in text else ("ollama", text)  # type: ignore[return-value]


def is_gaze(value: Any) -> bool:
    return isinstance(value, dict) and {"yaw", "pitch"} <= set(value)

ACTIONS = ("speak", "gesture", "goto", "play_sound", "look_at", "listening", "perk", "signal")


class SeatedRobot:
    """The robot as its seated participant drives it. The daemon serves one media client, so while the bridge
    holds the camera the walk's actions travel over the bridge's socket and the bridge performs them."""

    label = "seated participant"

    def __init__(self, port: int, voice: str = "") -> None:
        self.port = port
        self.voice = voice

    def act(self, kind: str, **spec: Any) -> dict[str, Any]:
        import asyncio

        import websockets

        async def send() -> dict[str, Any]:
            async with websockets.connect(f"ws://localhost:{self.port}", open_timeout=3) as socket:
                await socket.send(json.dumps({"type": "act", "kind": kind, "voice": self.voice, **spec}))
                return json.loads(await asyncio.wait_for(socket.recv(), timeout=180))

        try:
            return asyncio.run(send())
        except Exception as error:
            print(f"    (the seated participant could not {kind}: {error})")
            return {}

    def speak(self, text: str) -> None:
        self.act("speak", text=text)

    def gesture(self, move: str, dataset: str | None = None) -> None:
        self.act("gesture", move=move, dataset=dataset)

    def goto(self, spec: dict[str, Any]) -> None:
        self.act("goto", spec=spec)

    def play_sound(self, file: str) -> None:
        self.act("play_sound", file=file)

    def look_at(self, target: str) -> dict[str, float] | None:
        reply = self.act("look_at", target=target)
        if target == "screen" and reply:
            print("    the seated participant " + ("found the screen" if reply.get("found") else "saw no screen"))
            return reply.get("gaze") if reply.get("found") else None
        return None

    def look_at_gaze(self, gaze: dict[str, float]) -> None:
        self.act("look_at", gaze={"yaw": float(gaze["yaw"]), "pitch": float(gaze["pitch"])})

    def signal(self, side: str) -> None:
        self.act("signal", side=side)

    def listening(self) -> None:
        self.act("listening")

    def perk(self) -> None:
        self.act("perk")

    def close(self) -> None:
        pass


def seat_participant(args: argparse.Namespace, config: dict[str, Any]) -> bool:
    """Start the participant bridge in the background for this run, and wait until it answers on the port.
    It logs to the run directory, keeps what the robot saw there, follows the run (it leaves when the walk's
    process is gone), and the study's end event dismisses it."""
    import subprocess

    cache = args.cache or Path(".")
    run_dir = cache.parent if cache.name == ".cache" else cache  # the run directory, not its swept `.cache`
    run_dir.mkdir(parents=True, exist_ok=True)
    argv = [sys.executable, str(Path(__file__).resolve()), "--participant", "--port", str(args.port),
            "--frames", str(run_dir / "frames"), "--vlm", str(config["vision"] or DEFAULTS["robot"]["vision"])]
    if os.environ.get("STUDYFLOW_RUN_PID"):  # the walk's pid (this process's parent is only its launcher)
        argv += ["--watch-pid", os.environ["STUDYFLOW_RUN_PID"]]
    if config["variant"] == "simulation":
        argv.append("--sim")
    log = (run_dir / "participant.log").open("ab")
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)  # noqa: S603
    print("    seating the robot as the participant (its log: participant.log in the run)")
    for _ in range(90):
        if seated_participant(args.port):
            return True
        time.sleep(2)
    print("    (the participant bridge did not come up)")
    return False


def seated_participant(port: int) -> bool:
    """Whether a participant bridge answers on the port."""
    import asyncio

    import websockets

    async def probe() -> None:
        async with websockets.connect(f"ws://localhost:{port}", open_timeout=2):
            pass

    try:
        asyncio.run(probe())
        return True
    except Exception:
        return False


def end_study(port: int) -> str:
    """Tell the seated robot the study is over, so it leaves the seat and folds whatever it started."""
    import asyncio

    import websockets

    async def send() -> None:
        async with websockets.connect(f"ws://localhost:{port}", open_timeout=3) as socket:
            await socket.send(json.dumps({"type": "end"}))

    try:
        asyncio.run(send())
    except Exception as error:
        print(f"    (no participant bridge on port {port} to dismiss: {error})")
        return "no participant seated"
    print("    the participant bridge was told the study is over")
    return "participant dismissed"


def answer_side(response: str, options: list[str]) -> str:
    """Which antenna answers: "left" for the first of two options, "right" for the second, "both" otherwise."""
    if len(options) == 2 and response in options:
        return "left" if options.index(response) == 0 else "right"
    return "both"


def participant_loop(
    robot: Any, port: int, frames: Path | None = None, vlm: tuple[str, str] = ("ollama", "gemma4:12b-it-qat"),
    watch_pid: int | None = None,
) -> int:
    """Serve the browser runner's response bridge until the study ends or Ctrl-C."""
    import asyncio

    import websockets

    sys.stdout.reconfigure(line_buffering=True)  # trial lines stream even when piped
    history: list[str] = []
    seat = asyncio.Lock()  # one trial at a time: the robot has one camera and the model one queue
    over: asyncio.Future[None] | None = None

    async def answer(socket: Any, message: dict[str, Any]) -> None:
        received = time.monotonic()
        async with seat:
            # The task moves on without us after MaxResponseTime; a late answer would only delay the next trial.
            limit = float(message.get("MaxResponseTime") or 0)
            if limit and time.monotonic() - received > limit:
                print(f"    trial {message.get('TrialIndex', '?')}: skipped — it aged out of its {limit:g}s window")
                return
            response, agent = await asyncio.to_thread(answer_trial, robot, message, history, frames, vlm)
            print(f"    trial {message.get('TrialIndex', '?')}: {response}  ({agent})")
            await socket.send(json.dumps({
                "type": "response", "RequestId": message.get("RequestId"),
                "Response": response, "Agent": {"Id": agent},
            }))
            # Then say it with the antennas: the left one for the first option, the right one for the second.
            options = [str(o) for o in message.get("ResponseOptions", [])]
            await asyncio.to_thread(robot.signal, answer_side(response, options))

    async def handle(socket: Any) -> None:
        print("    the task runner connected")
        async for raw in socket:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "act" and message.get("kind") in ACTIONS:
                kind = message["kind"]
                async with seat:
                    if kind == "look_at" and message.get("target") == "screen":
                        found = await asyncio.to_thread(find_screen, robot, vlm, frames)
                        await socket.send(json.dumps({"type": "acted", "found": found, "gaze": LAST_GAZE if found else None}))
                        continue
                    if kind == "look_at" and is_gaze(message.get("gaze")):
                        await asyncio.to_thread(robot.look_at_gaze, message["gaze"])
                        await socket.send(json.dumps({"type": "acted", "gaze": LAST_GAZE}))
                        continue
                    if kind == "signal":
                        await asyncio.to_thread(robot.signal, str(message.get("side")))
                    if kind == "speak":
                        robot.voice = message.get("voice") or ""
                        await asyncio.to_thread(robot.speak, str(message.get("text", "")))
                    elif kind == "gesture":
                        await asyncio.to_thread(robot.gesture, str(message.get("move")), message.get("dataset"))
                    elif kind == "goto":
                        await asyncio.to_thread(robot.goto, message.get("spec") or {})
                    elif kind == "play_sound":
                        await asyncio.to_thread(robot.play_sound, str(message.get("file")))
                    elif kind == "look_at":
                        await asyncio.to_thread(robot.look_at, str(message.get("target")))
                    elif kind == "signal":
                        pass  # done above
                    else:
                        await asyncio.to_thread(getattr(robot, kind))
                await socket.send(json.dumps({"type": "acted"}))
            elif message.get("type") == "end":
                print("● the study is over — leaving the seat")
                if over is not None and not over.done():
                    over.set_result(None)
            elif message.get("type") == "completed":
                print(f"● task complete — {message.get('TaskId') or 'done'}")
                # In a thread: the SDK's play_move sync wrapper refuses to run on the event loop.
                await asyncio.to_thread(robot.gesture, "cheerful1")
                history.clear()
            elif message.get("type") == "trial":
                asyncio.ensure_future(answer(socket, message))

    async def serve() -> None:
        nonlocal over
        over = asyncio.get_running_loop().create_future()
        async with websockets.serve(handle, "localhost", port):
            print(f"Reachy participant ({robot.label}) — bridge on ws://localhost:{port}, Ctrl-C to leave the seat")
            print("Run the study in the browser; the task's bot needs `ResponseSource: external`.")
            async with seat:  # the walk's first request waits for the robot to be settled
                if not await asyncio.to_thread(find_screen, robot, vlm, frames):
                    robot.look_at("face")  # no camera, or nothing found: assume the screen is straight ahead
            if watch_pid:
                async def follow_the_walk() -> None:
                    while True:
                        await asyncio.sleep(3)
                        try:
                            os.kill(watch_pid, 0)
                        except OSError:
                            print("● the walk is gone — leaving the seat")
                            if not over.done():
                                over.set_result(None)
                            return

                asyncio.ensure_future(follow_the_walk())
            if has_camera(robot):
                import threading

                def keep_stream_alive() -> None:
                    # The WebRTC feed stops delivering after a minute or so unread; keep reading it between trials.
                    while True:
                        try:
                            robot.mini.media.get_frame()
                        except Exception:
                            pass
                        time.sleep(0.5)

                threading.Thread(target=keep_stream_alive, daemon=True).start()
            await over

    asyncio.run(serve())
    return 0


# --- the walk: studyflow-run-local's control flow, minus records, repos, and reuse ---

def perform(run: Run, element: dict[str, Any], ext: dict[str, Any]) -> dict[str, Any]:
    """One reachy element, as the keys a hand-off merges into the state: its result and timing."""
    kind, spec = ext["type"], settings_of(ext)
    if kind not in HANDLERS:
        raise KeyError(f"no handler for reachy:{kind}")
    run.scope = element.get("id") or ""
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
    parser.add_argument("plan", type=Path, nargs="?", help="the plan digest studyflow-run-local hands over (plan.json); --participant needs none")
    parser.add_argument("--sim", action="store_true", help="drive a simulated robot through the reachy_mini SDK")
    parser.add_argument("--auto", action="store_true", help="answer every prompt with a canned value")
    parser.add_argument(
        "--participant", action="store_true",
        help="sit in the participant's seat: answer the browser task's trials from what the robot sees",
    )
    parser.add_argument("--port", type=int, default=8765, help="participant bridge port (the runner's BridgeUrl)")
    parser.add_argument("--frames", type=Path, default=None, metavar="DIR", help="participant mode: keep what the robot saw, one JPEG per trial")
    parser.add_argument("--watch-pid", type=int, default=None, metavar="PID", help="participant mode: leave the seat when this process (the walk) is gone")
    parser.add_argument(
        "--vlm", default="ollama:gemma4:12b-it-qat", metavar="PROVIDER:MODEL",
        help="participant mode: the vision model that finds the screen and answers trials whose bot names none (claude:… or ollama:…)",
    )
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

    if args.plan is None and not args.participant:
        parser.error("a plan.json is needed: `studyflow run <diagram> --runtime local` walks the diagram and hands elements here")
    studyflow = Plan(json.loads(args.plan.read_text()) if args.plan else {})

    if args.claims:
        # This runner claims every element carrying a reachy extension it has a handler for, and when the
        # diagram has a robot at all, its end events: reaching one tells the seated robot the study is over.
        print(json.dumps([
            element_id for element_id, element in studyflow.elements.items()
            if ((ext := reachy_extension(element)) is not None and ext["type"] in HANDLERS)
            or (studyflow.has_robot() and element.get("type") == "endEvent")
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

    global BRIDGE_PORT
    BRIDGE_PORT = args.port
    if args.element and not args.sim and (
        seated_participant(args.port) or (studyflow.wants_participant() and seat_participant(args, config))
    ):
        robot = SeatedRobot(args.port, voice=str(config["voice"]))
    sim = args.sim or config["variant"] == "simulation"
    # The sim daemon is local; only an explicitly set host points elsewhere.
    host = str(config["host"])
    if sim and host == DEFAULTS["robot"]["host"]:
        host = "localhost"
    local_host = host in ("localhost", "127.0.0.1")
    # The sim has no camera; a Lite's camera hangs off this machine, a wireless unit streams its own. In the
    # walk a real unit only moves and speaks: the seated participant (the bridge) owns the camera.
    media = "no_media" if sim or not args.participant else ("default" if local_host else "webrtc")
    if not isinstance(robot, SeatedRobot):
        robot = SimRobot(host=host, media_backend=media, sim=sim, voice=str(config["voice"]), vision=str(config["vision"] or DEFAULTS["robot"]["vision"]))
        try:
            robot.connect()
        except Exception as error:
            robot.close()
            robot = TerminalRobot()
            print(f"robot unavailable ({error}) — carrying on as a dry run")

    if args.participant:
        try:
            return participant_loop(robot, args.port, args.frames, parse_vlm(args.vlm), args.watch_pid)
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
        run.values.update(json.loads(json.dumps(state)))  # a copy: what changed is what goes back
        try:
            element = studyflow.elements.get(args.element)
            ext = reachy_extension(element) if element is not None else None
            if element is not None and element.get("type") == "endEvent":
                result = {"result": end_study(args.port)}
            elif element is None or ext is None:
                raise KeyError(f"no reachy element {args.element!r} in the diagram")
            else:
                result = perform(run, element, ext)
        except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
            result = {"error": f"{type(error).__name__}: {error}"}
        finally:
            robot.close()
        cache.mkdir(parents=True, exist_ok=True)
        # What this element captured into the study's values goes back too (its own result under its id,
        # and any data object it points at): the leading runner adopts every key that changed.
        captured = {key: value for key, value in run.values.items() if state.get(key, ...) != value}
        handoff.write_text(json.dumps({**state, **captured, **result}, default=str))
        return 1 if "error" in result else 0

    parser.error("this runner performs one element at a time: pass --element, --claims, or --participant")


if __name__ == "__main__":
    code = main()
    # The SDK's websocket thread is not a daemon thread; flush and leave without joining it.
    sys.stdout.flush()
    sys.stderr.flush()
    import os
    os._exit(code)

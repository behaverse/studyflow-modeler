#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = ["reachy-mini[mujoco]>=1.9", "websockets>=13", "pillow>=10", "pyyaml>=6"]
# ///
"""Run the Reachy Mini elements of a studyflow.

Usage:
    studyflow run --runtime local <diagram> [--sim] [--auto]     # studyflow-run-local walks, this runner performs
    skills/reachy/local.py --participant [--sim] [--port N]      # the seat, started by the walk when a step needs the camera

The robot is its body: it speaks, moves, looks, and takes pictures. Whatever decides for it is another pool the
diagram draws, a model asked along message flows (skills/local/SKILL.md, "Messages"); nothing here calls a model.
A `screen` look sends each view of its search along the step's message flow to the model's pool and turns by what
comes back; it remembers where it found the screen (`~/.studyflow/reachy/gaze.json`, per robot host), so the next
look, and the next run, start there. A snapshot saves a picture in the run, where the step's data output names a
folder (`reachy/frames/` when it names none), and its path is the step's result. Text attributes may cite the study
state as the modeler does, `{name}` from the element outward, `{state.scope.name}`, or `{Play.trials}` for an
earlier element's result.

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

With `--participant` it is the seat: one process holding the robot and its camera stream, since the daemon serves
one media client. The walk starts it in the background at the first robot step when a step needs the camera, and
every hand-off after that acts through it; the robot pool's end event (claimed here too) dismisses it.
"""

from __future__ import annotations

import argparse
import json
import math
import os
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
    "robot": {"variant": "wireless", "host": "reachy-mini.local", "voice": "", "language": "", "volume": "80"},
    "interact": {"text": "", "move": "", "dataset": "pollen-robotics/reachy-mini-emotions-library", "side": "", "sound": ""},
    "goto": {"roll": "0", "pitch": "0", "yaw": "0", "x": "0", "y": "0", "z": "0",
             "leftAntenna": "0", "rightAntenna": "0", "bodyYaw": "0",
             "motionDuration": "2", "interpolation": "minjerk"},
    "lookAt": {"target": "face", "trackingWeight": "1"},
    "listen": {"timeout": "10"},
    "teleoperation": {"instructions": ""},
    "senseEvent": {"trigger": "wake_word", "wakeWord": "Hey Reachy"},
    "perceptionGateway": {"channel": "face_count"},
    "snapshot": {},
}

AUTO_SAMPLES = {"face_count": "1", "sound_angle": "1.57", "speech_detected": "1"}
AUTO_LINES = ["It went well — the second block was hard!", "goodbye"]
SEAT_PORT = 8765  # where the seat listens, on this machine


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
        # The digest's `names` cite one element each; a digest without them (a hand-written one) binds every identifier-shaped name.
        self.names: dict[str, str] = digest["names"] if "names" in digest else {
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

    def needs_camera(self) -> bool:
        """Whether a step looks through the camera: a snapshot, or a look for the screen."""
        return any(
            (ext := reachy_extension(element)) is not None
            and (ext["type"] == "snapshot" or (ext["type"] == "lookAt" and settings_of(ext)["target"] == "screen"))
            for element in self.elements.values()
        )

    def model_flow(self, element_id: str) -> str | None:
        """The message flow from the step to a pool with no process of its own, the model it asks; None without one."""
        for flow_id, flow in self.elements.items():
            attrs = flow.get("attributes") or {}
            target = self.elements.get(str(attrs.get("targetRef"))) or {}
            if (flow.get("type") == "messageFlow" and attrs.get("sourceRef") == element_id
                    and target.get("type") == "participant" and not (target.get("attributes") or {}).get("processRef")):
                return flow_id
        return None

    def robot_config(self) -> dict[str, Any]:
        for element in self.elements.values():
            ext = reachy_extension(element)
            if ext is not None and ext["type"] == "robot":
                return settings_of(ext)
        return dict(DEFAULTS["robot"])

    def robot_processes(self) -> set[str]:
        """The processes of the Robot pools: their end events are the robot's, another pool's are not."""
        return {
            str((element.get("attributes") or {}).get("processRef"))
            for element in self.elements.values()
            if element.get("type") == "participant" and reachy_extension(element) is not None
            and (element.get("attributes") or {}).get("processRef")
        }


def claimed(studyflow: Plan) -> list[str]:
    """Every element carrying a reachy extension this runner has a handler for, and when the diagram has a
    robot, the end events of its own pool (reaching one tells the seat the study is over)."""
    pools = studyflow.robot_processes()
    return [
        element_id for element_id, element in studyflow.elements.items()
        if ((ext := reachy_extension(element)) is not None and ext["type"] in HANDLERS)
        or (studyflow.has_robot() and element.get("type") == "endEvent" and (not pools or element.get("parent") in pools))
    ]


# --- robots: the terminal robot only narrates; the sim robot also moves ---

class TerminalRobot:
    label = "dry run"
    host = ""

    def speak(self, text: str, renderer: list[str] | None = None) -> None: ...
    def gesture(self, move: str, dataset: str | None = None) -> None: ...
    def goto(self, spec: dict[str, Any]) -> None: ...
    def play_sound(self, file: str) -> None: ...
    def look_at(self, target: str) -> None: ...
    def aim(self, gaze: dict[str, float], remember: bool = False) -> None: ...
    def signal(self, side: str) -> None: ...
    def listening(self) -> None: ...
    def perk(self) -> None: ...
    def snapshot(self, path: Path, width: int | None = None, fresh: bool = False) -> bool: return False
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
                 volume: int | None = None) -> None:
        self.host = host
        self.media_backend = media_backend
        self.sim = media_backend == "no_media" if sim is None else sim
        self.voice = voice
        self.volume = volume  # the Robot pool's `volume`; None leaves the unit as it is
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
        if not self.sim and self.volume is not None:
            self._set_volume(self.volume)
        local_only = self.host in ("localhost", "127.0.0.1")
        # Straight to the unit named in the diagram: "auto" would go through a Reachy Mini Control app's
        # localhost proxy when one is open, and lose the link when it does.
        self.mini = ReachyMini(
            host=self.host,
            connection_mode="localhost_only" if local_only else "network",
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
            self._ensure_backend(host)
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

    def _ensure_backend(self, host: str) -> None:
        """A daemon that answers may still have its backend stopped (nothing moves, no state streams, so the
        SDK never connects): start it, waking the robot, and wait until it reports running."""
        import urllib.request

        def status() -> dict[str, Any]:
            with urllib.request.urlopen(f"http://{host}:8000/api/daemon/status", timeout=5) as response:
                return json.load(response)

        try:
            state = status().get("state")
        except Exception:
            return  # not a daemon that reports; the SDK will say what is wrong
        if state == "running":
            return
        print(f"    the robot's backend is {state or 'stopped'}: starting it…")
        if state != "starting":
            urllib.request.urlopen(urllib.request.Request(
                f"http://{host}:8000/api/daemon/start?wake_up=true", method="POST"), timeout=30)
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            current = status()
            if current.get("state") == "running":
                time.sleep(1)  # let the state stream start
                return
            if current.get("error"):
                raise ConnectionError(f"the robot's backend failed to start: {current['error']}")
            time.sleep(2)
        raise ConnectionError("timed out waiting for the robot's backend to start")

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

    def speak(self, text: str, renderer: list[str] | None = None) -> None:
        # The antennas tap while the line prints; a real unit also says it, through its own speaker.
        self._act([(None, [0.25, -0.25], 0.15, None), (None, [0.0, 0.0], 0.15, None)])
        if self.sim:
            return
        try:
            self._say(text, renderer)
        except Exception as error:
            print(f"    (speech failed: {error})")

    def _say(self, text: str, renderer: list[str] | None = None) -> float:
        """Render the line on this machine with `say` (or the step's own `shell://` command and flags, one that
        takes `-o <wav>` and the text like `say` does) and play it on the unit; how long it lasts."""
        import hashlib
        import subprocess
        import tempfile

        command, *flags = renderer or ["say"]
        if shutil.which(command) is None:
            print(f"    (no `{command}` on this machine to render the line)")
            return 0.0  # ponytail: macOS TTS only; a robot-side TTS app would replace this
        if self.voice and "-v" not in flags:
            flags += ["-v", self.voice]
        name = f"studyflow-{hashlib.sha1(json.dumps([command, flags, text]).encode()).hexdigest()[:12]}.wav"
        path = Path(tempfile.gettempdir()) / name
        if not path.exists():
            subprocess.run(  # noqa: S603 - the study's own line
                [command, "-o", str(path), "--data-format=LEI16@22050", *flags, text],
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

    def _set_volume(self, volume: int) -> None:
        """The unit's speaker at the pool's `volume`; only when it differs, as setting it plays a test sound."""
        import urllib.request

        try:
            with urllib.request.urlopen(f"http://{self.host}:8000/api/volume/current", timeout=5) as response:
                current = json.load(response).get("volume")
            if current != volume:
                self._post("/api/volume/set", {"volume": volume})
                print(f"    the unit's volume goes from {current} to {volume}")
        except Exception as error:
            print(f"    (could not set the volume: {error})")

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

    def look_at(self, target: str) -> None:
        """Turn toward the target. The screen is where a search last found it (`find_screen` does the searching,
        asking a model), else straight ahead and a little up."""
        try:
            if target == "screen":
                self.aim(LAST_GAZE or recall_gaze(self) or {"yaw": 0.0, "pitch": SEARCH_PITCH_DEG})
            elif target == "face":
                self.mini.look_at_world(0.4, 0.0, 0.15, duration=0.7)
            elif target == "sound":
                self._act([({"yaw": 20}, None, 0.5, None), ({"yaw": -20}, None, 0.7, None), ({}, None, 0.5, None)])
            else:
                self._act([({}, [0.0, 0.0], 0.6, None)])
        except Exception as error:
            print(f"    (sim motion failed: {error})")

    def aim(self, gaze: dict[str, float], remember: bool = False) -> None:
        """Head and base toward a gaze (degrees). The head pose is in the world frame and the daemon keeps it there
        whatever the base does, so the base follows the gaze: the neck stays straight and the camera turns all the
        way round. `remember` makes it where later moves come back to."""
        global LAST_GAZE
        if remember:
            LAST_GAZE = {"yaw": float(gaze["yaw"]), "pitch": float(gaze["pitch"])}
        self._act([({"yaw": gaze["yaw"], "pitch": gaze["pitch"]}, None, 1.0, math.radians(gaze["yaw"]))])

    def snapshot(self, path: Path, width: int | None = None, fresh: bool = False) -> bool:
        """Save what the camera sees as a JPEG at `path`, `width` pixels wide at most; `fresh` waits for a frame the
        stream shows after the head has settled. False without a camera or a frame."""
        frame = camera_frame(self, after=time.monotonic() + STREAM_LAG_S if fresh else 0.0)
        if frame is None:
            return False
        save_jpeg(frame, path, width)
        return True

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
            mini, self.mini = self.mini, None  # the stream reader stops before the camera goes
            try:
                mini.__exit__(None, None, None)  # the SDK's only public teardown path
            except Exception:
                pass
        # Only the daemon this run spawned; one that was already serving stays.
        if self._daemon is not None:
            self._daemon.terminate()
            self._daemon = None


PLACEHOLDER = re.compile(r"\{\s*([^\W\d][\w.-]*)\s*\}")  # the modeler's PLACEHOLDER (packages/core/src/document/state.ts)


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
    cache: Path = Path(".")  # the hand-off directory: the state file, and a step's outbox and inbox

    @property
    def run_dir(self) -> Path:
        """The run directory, not its `.cache`, which the walk sweeps when the run ends."""
        return self.cache.parent if self.cache.name == ".cache" else self.cache

    @property
    def tree(self) -> dict[str, Any]:
        """The study's state tree, `state.<scope>.<property>` and `state._meta`, shared with the hand-off file."""
        return self.values.setdefault("state", {})

    def say_line(self, text: str, renderer: list[str] | None = None) -> None:
        print(f'    Reachy ▶ "{text}"')
        self.robot.speak(text, renderer)

    def ask(self, prompt: str, default: str) -> str:
        if self.auto:
            print(f"    {prompt} [auto: {default}]")
            return default
        answer = input(f"    {prompt} [{default}]: ").strip()
        return answer or default

    # The placeholder rule (docs/reference.qmd, "Placeholders"): `{state.a.b}` from the root; then a dotted lookup
    # from the element outward through its containers (`{count}`, `{screenGaze}`), a lone name also as the runner's
    # counter `_meta.<name>.<scope>`; last an element's result by id or name (`{Play.trials}`). Unresolved, a
    # placeholder stays as written.
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
        result = self.namespace().get(keys[0])
        return lookup(result, keys[1:]) if len(keys) > 1 else result

    def fill(self, text: str) -> str:
        return PLACEHOLDER.sub(lambda m: str(v) if (v := self.resolve(m.group(1))) is not None else m.group(0), text)

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
        for binding in element.get("outputs") or []:
            target = binding.get("target")
            if not target:
                continue
            # An output edge's `transformation` narrows the result (`result['trials']`), as the python runner's does.
            expression = binding.get("transformation") or ""
            bound = self.narrow(expression, value, binding.get("language")) if expression else value
            declared = self.studyflow.property_of(target)
            if declared:
                # A data edge into a declared property writes the study state: `state.<scope>.<name>`.
                scope, name = declared
                self.tree.setdefault(scope, {})[name] = bound
                print(f"    → {name}  (state of {self.studyflow.names.get(scope) or scope})")
            else:
                self.values[target] = bound
                print(f"    → {self.studyflow.names.get(target) or target}  (captured)")

    def narrow(self, expression: str, result: Any, language: str | None) -> Any:
        """A data edge's selection over the step's result, in Python; BPMN's per-expression `language` may say otherwise."""
        if language and language.lower() not in ("py", "python"):
            raise ValueError(f"a {language} expression on a data edge — this runner evaluates Python")
        return eval(expression, {"__builtins__": {}}, {**self.namespace(), "result": result})  # noqa: S307 - an authored diagram's expression


class Messages:
    """A step's end of its message flows while it runs (skills/local/SKILL.md, "Messages"): what it sends goes into
    `<id>.outbox.jsonl`, and the answer that names it comes back into `<id>.inbox.jsonl`."""

    def __init__(self, cache: Path, element_id: str, flow: str) -> None:
        self.outbox, self.inbox = cache / f"{element_id}.outbox.jsonl", cache / f"{element_id}.inbox.jsonl"
        self.element_id, self.flow, self.sent = element_id, flow, 0

    def ask(self, content: Any, timeout: float = 90.0) -> Any:
        self.sent += 1
        request = f"{self.element_id}.{self.sent}"
        with self.outbox.open("a") as file:
            file.write(json.dumps({"flow": self.flow, "id": request, "content": content}) + "\n")
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for line in self.inbox.read_text().splitlines() if self.inbox.exists() else []:
                try:
                    message = json.loads(line)
                except ValueError:
                    continue  # the walk may be writing it
                if message.get("inReplyTo") == request:
                    return message.get("content")
            time.sleep(0.05)
        raise TimeoutError(f"no answer to {request} within {timeout:g}s")


# --- handlers: one per reachy element, keyed by the extension's local name ---

def renderer_of(element: dict[str, Any]) -> tuple[list[str] | None, str]:
    """An Interact step's `implementation: shell://<command>` with its `additionalArguments`, as the command and its
    flags (`v: Alex` → `-v Alex`) and the line its `args` give; (None, '') for a step naming none."""
    import yaml

    implementation = str((element.get("attributes") or {}).get("implementation") or "")
    if not implementation:
        return None, ""
    if not implementation.startswith("shell://"):
        raise ValueError(f"{element.get('id')}: an Interact step renders its line with a shell:// command, not {implementation}")
    arguments = yaml.safe_load(element.get("additionalArguments") or "") or {}
    renderer = [implementation[len("shell://"):].split("@")[0]]
    for key, value in arguments.items():
        if key != "args":
            renderer += [f"-{key}" if len(str(key)) == 1 else f"--{key}", *([] if value is None else [str(value)])]
    return renderer, " ".join(str(arg) for arg in arguments.get("args") or [])


def run_interact(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    """Each part the step sets, in the schema's order: the move, the antenna, the sound, then the line."""
    if spec["move"]:
        print(f"    Reachy plays the '{spec['move']}' move")
        run.robot.gesture(str(spec["move"]), str(spec["dataset"]))
    if spec["side"]:
        side = run.fill(str(spec["side"])).strip().strip("`\"'.").lower()
        side = side if side in ("left", "right") else "both"
        print(f"    Reachy raises {'both antennas' if side == 'both' else f'the {side} antenna'}")
        run.robot.signal(side)
    if spec["sound"]:
        print(f"    Reachy plays the sound '{spec['sound']}'")
        run.robot.play_sound(str(spec["sound"]))
    renderer, line = renderer_of(element)
    if line or spec["text"]:
        run.say_line(run.fill(line or str(spec["text"])), renderer)
    return None


def run_goto(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    print(f"    Reachy moves to pose (roll {spec['roll']}, pitch {spec['pitch']}, yaw {spec['yaw']}, "
          f"body {spec['bodyYaw']}) over {spec['motionDuration']}s ({spec['interpolation']})")
    run.robot.goto(spec)
    return None


def run_look_at(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    """Turn toward the target. For the screen, a step with a message flow to a model's pool searches, asking that
    model about each view; one without turns to where the screen was found, else straight ahead."""
    target = str(spec["target"])
    print(f"    Reachy turns toward: {target}")
    flow = run.studyflow.model_flow(str(element.get("id"))) if target == "screen" else None
    if flow is None:
        if target == "screen":
            print("    (no message flow from this step reaches a model: turning to where the screen was, or straight ahead)")
        run.robot.look_at(target)
        return None
    found = find_screen(run.robot, Messages(run.cache, str(element.get("id")), flow).ask, run.run_dir, "reachy/look")
    print("    " + ("found the screen" if found else "saw no screen"))
    return None


def run_snapshot(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    """A picture from the camera, saved in the folder the step's data output names (`reachy/frames/` when none),
    one file per visit; its path in the run is the result. Without a camera there is no picture: null."""
    element_id = str(element.get("id"))
    folder = next((uri for target in output_targets(element)
                   if (uri := str(((run.studyflow.elements.get(target) or {}).get("attributes") or {}).get("uri") or "")).endswith("/")),
                  "reachy/frames/")
    visit = ((run.tree.get("_meta") or {}).get("reached") or {}).get(element_id, 1)
    picture = f"{folder}{element_id}-{visit}.jpg"
    if not run.robot.snapshot(run.run_dir / picture):
        print("    (no camera, so no picture)")
        return None
    print(f"    Reachy takes a picture: {picture}")
    return picture


def run_listen(run: Run, element: dict[str, Any], spec: dict[str, Any]) -> Any:
    run.robot.listening()
    canned = run.auto_lines.pop(0) if run.auto and run.auto_lines else "Thanks, that was fun!"
    return run.ask(f"participant says (within {spec['timeout']}s)", canned)


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
    "interact": run_interact,
    "goto": run_goto,
    "lookAt": run_look_at,
    "snapshot": run_snapshot,
    "listen": run_listen,
    "teleoperation": run_teleoperation,
    "senseEvent": wait_sense,
    "perceptionGateway": sample_perception,
}


# --- the camera, and the search for the screen ---

def has_camera(robot: Any) -> bool:
    return getattr(robot, "media_backend", "no_media") != "no_media"


LATEST_FRAME: tuple[float, Any] = (0.0, None)  # when (monotonic) the stream reader last saw a frame, and the frame


def read_stream(robot: Any) -> None:
    """The one reader of the camera stream. The SDK's sink keeps a single frame and every pull empties it, so
    a second reader takes frames the first one wanted: everyone reads LATEST_FRAME instead. Reading without
    pause also keeps the WebRTC feed alive, which stops delivering after a minute or so unread."""
    global LATEST_FRAME
    quiet_since, said_quiet = 0.0, False
    while getattr(robot, "mini", None) is not None:
        try:
            frame = robot.mini.media.get_frame()
        except Exception:
            frame = None
        now = time.monotonic()
        if frame is not None:
            if quiet_since and now - quiet_since > 5.0:
                print(f"    (the camera stream is back after {now - quiet_since:.0f} s)")
            LATEST_FRAME = (now, frame)
            quiet_since = 0.0
        elif not quiet_since:
            quiet_since = now
        elif now - quiet_since > 5.0 and not said_quiet:
            print("    (the camera stream has gone quiet)")
        said_quiet = bool(quiet_since) and now - quiet_since > 5.0
        time.sleep(0.05)


def camera_frame(robot: Any, wait: float = 4.0, after: float = 0.0) -> Any:
    """The camera's newest BGR frame, under a second old and seen after the moment `after`, waiting up to `wait`
    seconds for one; None without."""
    if not has_camera(robot):
        return None
    deadline = time.monotonic() + wait  # ponytail: covers the stream's warm-up after connecting; shorten if trials feel slow
    while True:
        seen, frame = LATEST_FRAME
        if frame is not None and seen >= after and time.monotonic() - seen < 1.0:
            return frame
        if time.monotonic() >= deadline:
            print("    (camera gave no frame)")
            return None
        time.sleep(0.05)


def save_jpeg(frame: Any, path: Path, width: int | None = None) -> None:
    from PIL import Image

    image = Image.fromarray(frame[:, :, ::-1])  # BGR → RGB
    if width and image.width > width:
        image = image.resize((width, round(image.height * width / image.width)))
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="JPEG", quality=85)


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


# What a `screen` look asks the model about each view: the look parses the reply, so the question is the step's own.
SCREEN_QUESTION = (
    "Is a computer monitor, laptop screen, or TV visible in this image? If so, which third of the image "
    "contains the centre of the monitor, horizontally (left, middle, or right) and vertically (top, middle, "
    "or bottom)?\n"
    "Reply with exactly three lines:\n"
    "Screen: yes or no\n"
    "Horizontal: left, middle, or right\n"
    "Vertical: top, middle, or bottom"
)
SEARCH_STEP_DEG = (20.0, 12.0)  # ponytail: one nudge of yaw and pitch per look, a third of the frame or so; halve it if the head overshoots a small far screen
SEARCH_PITCH_DEG = -10.0  # ponytail: a desk robot looks up at a monitor; tune to the robot's perch (negative is up)
LAST_GAZE: dict[str, float] | None = None  # in the seat: where the screen was found this run, where moves come back to
GAZE_FILE = Path.home() / ".studyflow" / "reachy" / "gaze.json"  # where the screen was found, per robot host, and when
STREAM_LAG_S = 0.3  # ponytail: WebRTC delay between the head settling and the frame showing it; raise if search frames smear
RELOOK_S = 30.0  # ponytail: a look this soon after a find only turns back to it; lower if the screen or the robot gets moved mid-study
SCREEN_SWEEP_DEG = (0, 45, -45, 90, -90, 135, -135, 180)  # ponytail: fixed body-yaw sweep; a finer or head-pitch sweep if screens sit high or low


def recall_gaze(robot: Any) -> dict[str, float] | None:
    try:
        return json.loads(GAZE_FILE.read_text()).get(str(getattr(robot, "host", ""))) or None
    except (OSError, ValueError):
        return None


def remember_gaze(robot: Any, gaze: dict[str, float]) -> None:
    try:
        known = json.loads(GAZE_FILE.read_text()) if GAZE_FILE.exists() else {}
    except (OSError, ValueError):
        known = {}
    GAZE_FILE.parent.mkdir(parents=True, exist_ok=True)
    GAZE_FILE.write_text(json.dumps({**known, str(getattr(robot, "host", "")): {**gaze, "at": time.time()}}))


def restore_gaze(robot: Any) -> None:
    """Back to where the screen was found this run, if it was: every move and pose leaves the head at rest."""
    if LAST_GAZE and getattr(robot, "mini", None) is not None:
        robot.aim(LAST_GAZE)


def find_screen(robot: Any, ask: Callable[[Any], Any], run_dir: Path, looks: str) -> bool:
    """Turn the body in steps until the camera sees the task screen, then centre on it with head and base. Each view
    goes to the model the step asks (`ask`, along its message flow), saved under `looks` in the run."""
    known = recall_gaze(robot)
    if known and time.time() - float(known.get("at") or 0) < RELOOK_S:
        robot.aim(known, remember=True)  # just found: a look right after another only turns back to it
        return True
    views = 0

    def glance(gaze: dict[str, float]) -> tuple[int, int] | None:
        """Where the screen sits in the view from `gaze`, as thirds; None when no screen is in view."""
        nonlocal views
        robot.aim(gaze)
        views += 1
        view = f"{looks}/view-{views}.jpg"
        if not robot.snapshot(run_dir / view, width=640, fresh=True):  # which third holds the screen needs no more
            raise RuntimeError("no camera frame")
        return parse_screen_reply(str(ask({"Question": SCREEN_QUESTION, "View": view}) or ""))

    try:
        for start in ([known] if known else []) + [{"yaw": float(yaw), "pitch": SEARCH_PITCH_DEG} for yaw in SCREEN_SWEEP_DEG]:
            gaze = {"yaw": float(start["yaw"]), "pitch": float(start["pitch"])}
            where = glance(gaze)
            if where is None:
                continue
            # Nudge toward the screen and look again (yaw left and pitch up are positive and negative degrees).
            for _ in range(8):
                if screen_is_centred(where):
                    break
                gaze["yaw"] -= where[0] * SEARCH_STEP_DEG[0]
                gaze["pitch"] += where[1] * SEARCH_STEP_DEG[1]
                where = glance(gaze) or where
            print(f"    found the screen: yaw {gaze['yaw']:+.0f}°, pitch {gaze['pitch']:+.0f}°")
            robot.aim(gaze, remember=True)
            remember_gaze(robot, gaze)
            return True
        print("    no screen in sight after a full turn")
    except Exception as error:
        print(f"    (could not look for the screen: {error})")
    # The camera or the model failed us, not the memory: the screen is where it was last found, else straight ahead.
    try:
        robot.aim(known or {"yaw": 0.0, "pitch": SEARCH_PITCH_DEG}, remember=bool(known))
    except Exception:
        pass
    return bool(known)


# --- the seat: one process holding the robot and its camera, which the walk's hand-offs act through ---

ACTIONS = ("speak", "gesture", "goto", "play_sound", "look_at", "aim", "snapshot", "listening", "perk", "signal")


class SeatedRobot:
    """The robot as the seat drives it. The daemon serves one media client, so while the seat holds the camera
    the walk's actions travel over the seat's socket and the seat performs them."""

    label = "seated participant"

    def __init__(self, port: int, voice: str = "", host: str = "") -> None:
        self.port = port
        self.voice = voice
        self.host = host  # the robot's, for the remembered gaze

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

    def speak(self, text: str, renderer: list[str] | None = None) -> None:
        self.act("speak", text=text, renderer=renderer)

    def gesture(self, move: str, dataset: str | None = None) -> None:
        self.act("gesture", move=move, dataset=dataset)

    def goto(self, spec: dict[str, Any]) -> None:
        self.act("goto", spec=spec)

    def play_sound(self, file: str) -> None:
        self.act("play_sound", file=file)

    def look_at(self, target: str) -> None:
        self.act("look_at", target=target)

    def aim(self, gaze: dict[str, float], remember: bool = False) -> None:
        self.act("aim", gaze={"yaw": float(gaze["yaw"]), "pitch": float(gaze["pitch"])}, remember=remember)

    def snapshot(self, path: Path, width: int | None = None, fresh: bool = False) -> bool:
        return bool(self.act("snapshot", path=str(path), width=width, fresh=fresh).get("saved"))

    def signal(self, side: str) -> None:
        self.act("signal", side=side)

    def listening(self) -> None:
        self.act("listening")

    def perk(self) -> None:
        self.act("perk")

    def close(self) -> None:
        pass


def seat_robot(args: argparse.Namespace, config: dict[str, Any]) -> bool:
    """Start the seat in the background for this run, and wait until it answers on the port. It logs to the run
    directory, follows the run (it leaves when the walk's process is gone), and the study's end event dismisses it."""
    import subprocess

    cache = args.cache or Path(".")
    run_dir = cache.parent if cache.name == ".cache" else cache  # the run directory, not its swept `.cache`
    run_dir.mkdir(parents=True, exist_ok=True)
    argv = [sys.executable, str(Path(__file__).resolve()), "--participant", "--port", str(args.port)]
    if os.environ.get("STUDYFLOW_RUN_PID"):  # the walk's pid (this process's parent is only its launcher)
        argv += ["--watch-pid", os.environ["STUDYFLOW_RUN_PID"]]
    if config["variant"] == "simulation":
        argv.append("--sim")
    log = (run_dir / "participant.log").open("ab")
    seat = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)  # noqa: S603
    print("    seating the robot: connecting and opening the camera "
          "(20 s warm, up to 3 min the first time; its log: participant.log in the run)")
    for tick in range(90):
        if seated_participant(args.port):
            return True
        if seat.poll() is not None:
            print(f"    (the seat exited with code {seat.returncode} — see participant.log in the run)")
            return False
        if tick and tick % 5 == 0:
            print(f"    still seating the robot ({tick * 2}s)")
        time.sleep(2)
    print("    (the seat did not come up)")
    return False


def seated_participant(port: int) -> bool:
    """Whether a seat answers on the port."""
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
    """Tell the seat the study is over, so it leaves and folds whatever it started."""
    import asyncio

    import websockets

    async def send() -> None:
        async with websockets.connect(f"ws://localhost:{port}", open_timeout=3) as socket:
            await socket.send(json.dumps({"type": "end"}))

    try:
        asyncio.run(send())
    except Exception as error:
        print(f"    (no seat on port {port} to dismiss: {error})")
        return "no participant seated"
    print("    the seat was told the study is over")
    return "participant dismissed"


def participant_loop(robot: Any, port: int, watch_pid: int | None = None) -> int:
    """Serve the walk's actions until the study ends or Ctrl-C."""
    import asyncio

    import websockets

    sys.stdout.reconfigure(line_buffering=True)  # lines stream even when piped
    if has_camera(robot):
        import threading

        threading.Thread(target=read_stream, args=(robot,), daemon=True).start()
    seat = asyncio.Lock()  # one action at a time: the robot has one body and one camera
    over: asyncio.Future[None] | None = None

    async def act(message: dict[str, Any]) -> dict[str, Any]:
        kind = message["kind"]
        if kind == "speak":
            robot.voice = message.get("voice") or ""
            await asyncio.to_thread(robot.speak, str(message.get("text", "")), message.get("renderer"))
        elif kind == "gesture":
            await asyncio.to_thread(robot.gesture, str(message.get("move")), message.get("dataset"))
        elif kind == "goto":
            await asyncio.to_thread(robot.goto, message.get("spec") or {})
        elif kind == "play_sound":
            await asyncio.to_thread(robot.play_sound, str(message.get("file")))
        elif kind == "look_at":
            await asyncio.to_thread(robot.look_at, str(message.get("target")))
        elif kind == "aim":
            await asyncio.to_thread(robot.aim, message.get("gaze") or {}, bool(message.get("remember")))
        elif kind == "snapshot":
            saved = await asyncio.to_thread(robot.snapshot, Path(str(message.get("path"))), message.get("width"), bool(message.get("fresh")))
            return {"type": "acted", "saved": saved}
        elif kind == "signal":
            await asyncio.to_thread(robot.signal, str(message.get("side")))
        else:
            await asyncio.to_thread(getattr(robot, kind))
        return {"type": "acted"}

    async def handle(socket: Any) -> None:
        async for raw in socket:
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "act" and message.get("kind") in ACTIONS:
                async with seat:
                    await socket.send(json.dumps(await act(message)))
            elif message.get("type") == "end":
                print("● the study is over — leaving the seat")
                if over is not None and not over.done():
                    over.set_result(None)

    async def serve() -> None:
        nonlocal over
        over = asyncio.get_running_loop().create_future()
        async with websockets.serve(handle, "localhost", port):
            print(f"Reachy seat ({robot.label}) — on ws://localhost:{port}, Ctrl-C to leave")
            if watch_pid:
                # From the start, and a hard stop: an interrupted walk must not leave this seat driving the robot
                # and holding the port for the next run.
                async def follow_the_walk() -> None:
                    while True:
                        await asyncio.sleep(3)
                        try:
                            os.kill(watch_pid, 0)
                        except OSError:
                            print("● the walk is gone — leaving the seat")
                            os.kill(os.getpid(), signal.SIGTERM)  # handle_stop folds the robot and exits

                asyncio.ensure_future(follow_the_walk())
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
    parser.add_argument("--participant", action="store_true", help="be the seat: hold the robot and its camera, and act for the walk's hand-offs")
    parser.add_argument("--port", type=int, default=SEAT_PORT, help=f"the seat's port (default {SEAT_PORT})")
    parser.add_argument("--watch-pid", type=int, default=None, metavar="PID", help="seat: leave when this process (the walk) is gone")
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
        parser.error("a plan.json is needed: `studyflow run --runtime local <diagram>` walks the diagram and hands elements here")
    studyflow = Plan(json.loads(args.plan.read_text()) if args.plan else {})

    if args.claims:
        print(json.dumps(claimed(studyflow)))
        return 0

    config = studyflow.robot_config()
    robot: Any = TerminalRobot()

    def handle_stop(signum: int, frame: Any) -> None:
        # A hard stop skips every `finally`, so fold the spawned sim daemon here before leaving. The SDK's
        # teardown can retry a lost link for a long while; the port must be free for the next run sooner.
        import threading

        deadline = threading.Timer(5.0, os._exit, args=(128 + signum,))
        deadline.daemon = True
        deadline.start()
        robot.close()
        os._exit(128 + signum)

    # Registered before any daemon can exist, so even a stop mid-startup folds it.
    signal.signal(signal.SIGTERM, handle_stop)
    signal.signal(signal.SIGINT, handle_stop)

    if args.element and not args.sim and (
        seated_participant(args.port) or (studyflow.needs_camera() and seat_robot(args, config))
    ):
        robot = SeatedRobot(args.port, voice=str(config["voice"]), host=str(config["host"]))
    sim = args.sim or config["variant"] == "simulation"
    # The sim daemon is local; only an explicitly set host points elsewhere.
    host = str(config["host"])
    if sim and host == DEFAULTS["robot"]["host"]:
        host = "localhost"
    local_host = host in ("localhost", "127.0.0.1")
    # The sim has no camera; a Lite's camera hangs off this machine, a wireless unit streams its own. In the
    # walk a real unit only moves and speaks: the seat owns the camera.
    media = "no_media" if sim or not args.participant else ("default" if local_host else "webrtc")
    if not isinstance(robot, SeatedRobot):
        robot = SimRobot(host=host, media_backend=media, sim=sim, voice=str(config["voice"]),
                         volume=int(config["volume"]) if str(config["volume"]).isdigit() else None)
        try:
            robot.connect()
        except Exception as error:
            robot.close()
            if args.participant:
                # A seat with no robot in it would act for nothing; the walk must know.
                print(f"robot unavailable ({error}) — not taking the seat")
                return 1
            robot = TerminalRobot()
            print(f"robot unavailable ({error}) — carrying on as a dry run")

    if args.participant:
        try:
            return participant_loop(robot, args.port, args.watch_pid)
        finally:
            robot.close()

    # In hand-off mode stdin is never a channel: without a terminal the runner answers itself.
    run = Run(studyflow, auto=args.auto or bool(args.element and not sys.stdin.isatty()), robot=robot,
              cache=args.cache or Path("."))

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

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["reachy-mini[mujoco]>=1.9", "websockets>=13", "pillow>=10"]
# ///
"""Run the Reachy Mini elements of a studyflow.

Usage:
    studyflow run <diagram> --runtime local [--sim] [--auto]     # studyflow-run-local walks, this runner performs
    ./studyflow-reachy.py --participant [--sim] [--port N]

A partial runner: studyflow-run-local walks the diagram and hands this script one
`reachy:*` element at a time (`<plan.json> --element <id> --cache <dir>`), with the
run's values in `<id>.state.json`; the updated state goes back into the same file
(`result`, `durationMs`, and on failure `error` merged in). It never opens the
diagram itself: `plan.json` is the digest studyflow-run-local writes. By default it
is a terminal dry run: the robot's speech is printed, and its senses and the
participant's lines come from stdin (`--auto` answers them with canned values
instead, for CI). With `--sim`, or when the diagram's Robot pool says
`variant: simulation`, it drives a MuJoCo-simulated Reachy Mini through the
`reachy_mini` Python SDK, starting a headless sim daemon if none is listening.

With `--participant` the roles flip and no plan is needed: the robot sits in front
of the screen as the participant. It serves the browser runner's response bridge
(`ws://localhost:8765`), and each time a Behaverse task awaits a response
(`ResponseSource: external` in the task's bot configurations) it looks at the
screen, takes a camera frame (falling back to the screenshot the task attaches when
it has no camera), asks the model what it sees and how to respond, and the browser
injects the answer.
"""

from __future__ import annotations

import argparse
import json
import os
import random
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
        self.names = {
            eid: el["name"] for eid, el in self.elements.items()
            if el.get("name") and re.fullmatch(r"[A-Za-z_]\w*", el["name"])
        }

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
    """Drives a Reachy Mini through the `reachy_mini` SDK: a MuJoCo sim, or in
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
            self.mini.play_move(self._moves[dataset].get(move), initial_goto_duration=1.0, sound=False)
        except Exception as error:
            print(f"    (sim move failed: {error})")

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

    def play_sound(self, file: str) -> None:
        try:
            self._post("/api/media/play_sound", {"file": file})
        except Exception as error:
            print(f"    (sound failed: {error})")

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

    def store(self, element: dict[str, Any], value: Any) -> None:
        self.values[element.get("id")] = value
        for target in output_targets(element):
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
    print(f"    Reachy turns toward: {spec['target']}")
    run.robot.look_at(str(spec["target"]))
    return None


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

def perform(run: Run, element: dict[str, Any], ext: dict[str, Any]) -> dict[str, Any]:
    """One reachy element, as the keys a hand-off merges into the state: its result and timing."""
    kind, spec = ext["type"], settings_of(ext)
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
    parser.add_argument("plan", type=Path, nargs="?", help="the plan digest studyflow-run-local hands over (plan.json); --participant needs none")
    parser.add_argument("--sim", action="store_true", help="drive a simulated robot through the reachy_mini SDK")
    parser.add_argument("--auto", action="store_true", help="answer every prompt with a canned value")
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

    if args.plan is None and not args.participant:
        parser.error("a plan.json is needed: `studyflow run <diagram> --runtime local` walks the diagram and hands elements here")
    studyflow = Plan(json.loads(args.plan.read_text()) if args.plan else {})

    if args.claims:
        # This runner claims every element carrying a reachy extension it has a handler for.
        print(json.dumps([
            element_id for element_id, element in studyflow.elements.items()
            if (ext := reachy_extension(element)) is not None and ext["type"] in HANDLERS
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
        local_host = host in ("localhost", "127.0.0.1")
        # The sim has no camera; a Lite's camera hangs off this machine, a wireless unit streams its own.
        media = "no_media" if sim else ("default" if local_host else "webrtc")
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

    parser.error("this runner performs one element at a time: pass --element, --claims, or --participant")


if __name__ == "__main__":
    code = main()
    # The SDK's websocket thread is not a daemon thread; flush and leave without joining it.
    sys.stdout.flush()
    sys.stderr.flush()
    import os
    os._exit(code)

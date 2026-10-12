#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Run the Behaverse tasks of a studyflow: on the Unity WebGL build in this machine's browser, or on the simulated build.

Usage:
    studyflow run <diagram> --runtime local [--option auto]   # the local runtime walks, this runner performs

A partial runner (packages/runtime-local/CONTRACT.md): it claims every `behaverse:Task` and every pool typed
`behaverse:SimulatedActor`. A task set to the simulated build (`runtime: simulated`) and such a pool are played by
`simulated.py` beside this file; for any other task, per hand-off, it serves the Unity WebGL build and a small stage page from a local port, opens the page in the default
browser, starts the task through the build's `RunCognitiveTask` entry point, and waits for
`studyflow:TaskCompleted`. The page relays what the build reports back to this process:
every `studyflow:Event` to the task's events file in the run directory, each answered trial to the
terminal, and the completion, which becomes the element's `result`. Who answers is what the
diagram draws. A task with message flows sends each awaiting trial along the one out of it and
takes the answer back from the one into it (packages/runtime-local/CONTRACT.md, "Messages", through the SDK's
`exchange.py`); an answer that
names no option in time is no answer, and the trial's own window makes it a miss. Without flows,
a person plays the task, or the build's own random bot does for a `software` actor whose
`implementation` is `behaverse://bot`. `--option auto` gives every person's task to that bot, so a run needs
nobody at the screen.

The build is looked for at `$UNITY_BUILD_PATH`, then `<repo>/run/assessment-unity/Build/WebGL`,
then the assessment-unity checkout beside the repo (`<repo>/../assessment-unity/Build/WebGL`):
the same places the browser runner's dev server looks.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[2] / "packages" / "runtime-local" / "python"))
from runner import Cancelled, Step, serve  # noqa: E402 - the runner SDK, beside the local runtime
import chromium  # noqa: E402 - the SDK's Chromium, for the stage
from exchange import (  # noqa: E402 - the SDK's exchange along message flows, and the records it stamps
    Exchange, data_inputs, element_process, exchange_flows, message_partners, opened_this_run, pool_participants,
    record_context, records_uri)

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
BEHAVERSE = "http://behaverse.org/schemas/studyflow/behaverse"
BUILD_MOUNT = "/assessment-unity"
# Who answers a task is the drawing's to say, never `Bot:`'s (the browser runner's types.ts `WHO_ANSWERS_KEYS`).
WHO_ANSWERS_KEYS = ("ResponseSource", "LLM", "Prompt")
# The messages this runner's task exchanges, as a message flow's `messageRef` → `itemRef` → `structureRef` names them:
# a trial out of the task, and its response back.
TRIAL, RESPONSE = "cognitive:Trial", "cognitive:Response"
STRUCTURES = (TRIAL, RESPONSE)
MIME ={".wasm": "application/wasm", ".data": "application/octet-stream", ".unityweb": "application/octet-stream",
        ".js": "application/javascript", ".json": "application/json"}


def behaverse_extension(element: dict[str, Any]) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == BEHAVERSE and str(ext.get("type", "")).lower() == "task"), None)


def build_of(element: dict[str, Any]) -> str:
    """Which build plays a task: its `runtime`, the Unity build unless it says otherwise."""
    return str(((behaverse_extension(element) or {}).get("attributes") or {}).get("runtime") or "unity")


def implementation_of(element: dict[str, Any]) -> str:
    """The task's `implementation`: the release it names is for the record, but one naming another skill's scheme
    hands the task to that skill's runner."""
    attributes = (behaverse_extension(element) or {}).get("attributes") or {}
    return str(attributes.get("implementation") or (element.get("attributes") or {}).get("implementation") or "")


def claimed_tasks(plan: dict[str, Any], check_build: Callable[[], Any]) -> list[str]:
    """What this runner plays: the `behaverse:Task`s and the pools typed `behaverse:SimulatedActor`. The Unity build is
    checked here when a task is set to it, so a run fails before the walk starts rather than after another pool's robot
    has greeted; a study whose tasks are all on the simulated build needs none. A task set to the Godot build stops the
    run here too: no runner plays that build yet, and a task nothing runs would only be skipped. A task whose
    `implementation` names another scheme than `behaverse://` is that skill's to play."""
    elements = plan.get("elements") or {}
    tasks = {eid: element for eid, element in elements.items() if behaverse_extension(element) is not None
             and implementation_of(element).split("://")[0] in ("", "behaverse")}
    godot = sorted(eid for eid, element in tasks.items() if build_of(element) == "godot")
    if godot:
        raise ValueError(f"{', '.join(godot)} {'is' if len(godot) == 1 else 'are'} set to the Godot build (runtime: godot), "
                         "which no runner plays yet; set runtime: unity to play it on the Unity build")
    if any(build_of(element) == "unity" for element in tasks.values()):
        check_build()
    actors = [eid for eid, element in elements.items() if element.get("type") == "participant"
              and not (element.get("attributes") or {}).get("processRef") and any(
                  ext.get("namespace") == BEHAVERSE and str(ext.get("type", "")).lower() == "simulatedactor"
                  for ext in element.get("extensions") or [])]
    return [*tasks, *actors]


def task_payload(element: dict[str, Any], auto: bool = False, plan: dict[str, dict[str, Any]] | None = None,
                 resolved: dict[str, Any] | None = None) -> dict[str, Any]:
    """The `RunCognitiveTask` payload, built as the browser runner's parser.ts builds it; `plan` is every element
    of the digest, for what the diagram draws around this task, and `resolved` the attributes the walk hands over with
    their placeholders resolved (`timeline: "{nback_order}"` as the property the run wrote)."""
    element_id = str(element.get("id"))
    written = (behaverse_extension(element) or {}).get("attributes") or {}
    attrs = {key: (resolved or {}).get(key, value) for key, value in written.items()}
    instrument = str(attrs.get("instrument") or "")
    if not instrument:
        raise ValueError(f"behaverse:Task {element_id!r} has no instrument; set it to a task the Unity build ships")
    # The task's `timeline` is the one place that says what runs.
    timeline = str(attrs.get("timeline") or "")
    if not timeline:
        raise ValueError(f"behaverse:Task {element_id!r} names no timeline, so it has no trials to run; set its timeline to one "
                         "the build ships for the instrument, or to one the Parameters wired into it define under Timelines")
    # The task's GameConfig is what the Parameters wired into it say, merged, less the keys that set its attributes
    # (the plan's `parameters`).
    parameters = dict(element.get("parameters") or {})
    # `Bot:` is not GameConfig: how the build's bot plays the task, sent to Unity as the payload's own `bot`.
    bot_settings = parameters.pop("Bot", None)
    bot_settings = bot_settings if isinstance(bot_settings, dict) else {}
    authored = [key for key in WHO_ANSWERS_KEYS if key in bot_settings]
    if authored:
        raise ValueError(f"behaverse:Task {element_id!r}: `Bot:` sets how the build's bot plays, not who answers "
                         f"({', '.join(authored)}); draw who takes the task instead")
    source = answered_by(element, plan or {}, auto)
    # `scene` is the wire's name for the instrument (Unity's `Activity.Scene`).
    payload: dict[str, Any] = {"scene": instrument, "timeline": timeline, "agentType": "human" if source == "human" else "bot",
                               "configMode": "builtin", "metadata": {"studyflowNodeId": element_id}}
    # `Timelines` defines timelines; Unity null-merges `parameters` over the build's own, so an empty entry would erase one.
    timelines = parameters.get("Timelines")
    if isinstance(timelines, dict):
        empty = [name for name, definition in timelines.items() if definition is None]
        if empty:
            raise ValueError(f"behaverse:Task {element_id!r} defines no timeline called {', '.join(empty)}: Timelines defines "
                             "timelines; the one that runs is the task's timeline")
    if parameters:
        payload["configMode"] = "inline"
        payload["parameters"] = parameters
    # Along message flows, Unity waits for each answer from outside; the build's own bot answers by itself.
    bot = {**bot_settings, **({"ResponseSource": "external"} if source == "messages" else {})}
    if source != "human" and bot:
        payload["bot"] = bot
    return payload


def answered_by(element: dict[str, Any], plan: dict[str, dict[str, Any]], auto: bool) -> str:
    """How the task's trials get answered here: `messages` along its message flows, `internal` by the build's own
    random bot, or `human`. Any other actor answers only along message flows, so drawing none of them is an error."""
    if exchange_flows(element, plan, STRUCTURES):
        return "messages"
    actor = actor_of(element, plan)
    if actor["kind"] in ("", "human"):
        return "internal" if auto else "human"
    if actor["kind"] == "software" and actor["model"] == "behaverse://bot":
        return "internal"
    raise ValueError(f"{element.get('id')} is taken by a {actor['kind']} participant, which answers along message flows "
                     "in a local run: draw one carrying each trial out of the task and one bringing the answer back")


REACHY = "https://w3id.org/studyflow/reachy"
EMPTY_ACTOR: dict[str, Any] = {"kind": "", "model": ""}


def actor_of(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Who takes the task, from what the diagram draws, most explicit first: the task's receiving band; else the
    other end of a message flow touching it (a pool, or a step's pool); else the pool the task sits in. A
    `reachy:Robot` is a robot; a `studyflow:Actor` is what its `actorType` says, with its `implementation` as the
    model. `kind` is empty when no one is named any of those ways."""
    initiating = (element.get("attributes") or {}).get("initiatingParticipantRef")
    candidates = [p for p in element.get("participants") or [] if p != initiating]
    if not candidates:
        candidates = message_partners(element, plan, STRUCTURES)
    if not candidates:
        candidates = pool_participants(element_process(element, plan), plan)
    for participant_id in candidates:
        for ext in (plan.get(str(participant_id)) or {}).get("extensions") or []:
            attributes = ext.get("attributes") or {}
            if ext.get("namespace") == REACHY and str(ext.get("type", "")).lower() == "robot":
                return {"kind": "robot", "model": ""}
            if ext.get("namespace") == STUDYFLOW and str(ext.get("type", "")).lower() == "actor":
                return {"kind": str(attributes.get("actorType") or "human"), "model": str(attributes.get("implementation") or "")}
    return dict(EMPTY_ACTOR)


class Trials:
    """The task's trials as the build's own records describe them, which `block_counts` counts (`tally`)."""

    def __init__(self) -> None:
        self.shown: set[tuple] = set()         # the trials the build started
        self.answered: set[tuple] = set()      # those it recorded a response for
        self.unanswerable: set[tuple] = set()  # those that took none
        self.blocks: dict[tuple, str] = {}     # each trial's block, by name, when the build names it
        # each `<TASK>.TrialEnd` record's `isAnswered`, `condition` and `isCorrect` (None when it says nothing)
        self.ended: dict[tuple, tuple[bool, str, bool | None]] = {}


def block_counts(trials: Trials) -> list[dict[str, Any]]:
    """What the task's trials came to, block by block in the order the build played them: `{block, trials, answered,
    unanswered, correct}`, the block's name and how many of its trials the build presented, recorded a valid response
    for, recorded none for, and scored correct (None when its records say nothing of correctness). Data, not policy:
    which blocks count, and what a study does about them, it writes in FEEL over this list, reading the properties it
    keeps (`sum(result.blocks[block in scored_blocks].unanswered)`). A build that writes a `<TASK>.TrialEnd` record per
    trial (`result.isAnswered`, `result.isCorrect`, `trialContext.condition`) says which it presented and which were
    answered, and a `BurnIn` trial, which the N-back sends only so the responder sees every digit, is never counted.
    Without those records, the trials it started or took a response in, less those that took none (the N-back's
    burn-in, whose every stream it records as `BurnInDisabled`), answered by a `Click` or a `TrialEnd` with a
    `responseTime`. The build is the authority, not the reply: an answer this runner injected too late for the window
    is a trial the build recorded without a response."""
    if trials.ended:
        counted = {trial: (was, correct) for trial, (was, condition, correct) in trials.ended.items() if condition != "BurnIn"}
    else:
        counted = {trial: (trial in trials.answered, None)
                   for trial in sorted((trials.shown | trials.answered) - trials.unanswerable, key=str)}
    order = {name: place for place, name in enumerate(dict.fromkeys(trials.blocks.values()))}
    blocks: dict[str | None, dict[str, Any]] = {}
    for trial in sorted(counted, key=lambda trial: order.get(trials.blocks.get(trial), len(order))):
        was, correct = counted[trial]
        name = trials.blocks.get(trial)
        block = blocks.setdefault(name, {"block": name, "trials": 0, "answered": 0, "unanswered": 0, "correct": 0})
        block["trials"] += 1
        block["answered" if was else "unanswered"] += 1
        if block["correct"] is not None:
            block["correct"] = None if correct is None else block["correct"] + bool(correct)
    return list(blocks.values())


# The stage: the build in a frame, exactly as the browser runner embeds it, and the template's
# forwarded `studyflow:*` events relayed to the runner over plain HTTP.
STAGE_HTML = """<!doctype html>
<meta charset="utf-8">
<title>Behaverse — __TITLE__</title>
<style>
  html, body { margin: 0; height: 100%; background: #231F20; }
  iframe { border: 0; width: 100%; height: 100%; display: block; }
  #status { position: fixed; inset: 0; display: grid; place-items: center; background: #231F20;
            color: #ddd; font: 16px system-ui, sans-serif; }
  #status[hidden] { display: none; }
</style>
<div id="status">Loading the task…</div>
<iframe id="unity" src="__MOUNT__/index.html?skipDebugMenu=1" allow="autoplay; fullscreen"></iframe>
<script>
const PAYLOAD = __PAYLOAD__;
const STAGE = __STAGE__;
const frame = document.getElementById('unity');
const status = document.getElementById('status');
const post = (path, body) => fetch(path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}).catch(() => {});
const runtime = () => frame.contentWindow && frame.contentWindow.unityInstance;
function send(method, value) {
  for (const name of ['AssessmentRuntime', 'GameManager']) {
    try { runtime().SendMessage(name, method, value); } catch (e) { /* the other name carries the runtime */ }
  }
}

let started = false;
function start() {
  if (started || !runtime()) return;
  started = true;
  status.textContent = 'Starting the task… (click the page for full screen)';
  setTimeout(() => { status.hidden = true; }, 1000);
  send('RunCognitiveTask', JSON.stringify(PAYLOAD));
}
window.addEventListener('studyflow:Ready', start);

// The build's canvas is a fixed 960x600 in the top-left; scale it to fill the window (same origin, so we may).
function fit() {
  const doc = frame.contentDocument;
  const canvas = doc && doc.querySelector('#unity-canvas');
  if (!canvas) return;
  const scale = Math.min(innerWidth / 960, innerHeight / 600);
  Object.assign(canvas.style, { position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', margin: 'auto',
    width: Math.floor(960 * scale) + 'px', height: Math.floor(600 * scale) + 'px' });
  doc.body.style.overflow = 'hidden';
}
frame.addEventListener('load', () => { fit(); setInterval(fit, 1000); });
addEventListener('resize', fit);
// Full screen needs a gesture: one click or key anywhere on the page.
for (const type of ['click', 'keydown']) addEventListener(type, () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
}, { once: false });
const poll = setInterval(() => {
  if (window.studyflowReady || (frame.contentWindow && frame.contentWindow.studyflowReady)) { clearInterval(poll); start(); }
}, 100);

// Along the task's message flows: the runner sends the trial as the build describes it (its stimulus, the options it
// takes, its window) and waits for the answer that names it. No answer, no injection: the trial's own response window
// ends it, a miss.
async function answer(d) {
  const options = d.ResponseOptions;
  const reply = await fetch('/respond', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ RequestId: d.RequestId, TrialIndex: d.TrialIndex, Stimulus: d.Stimulus, ResponseOptions: options,
      MaxResponseTime: d.MaxResponseTime, Scene: STAGE.scene, Screenshot: d.Screenshot || undefined }),
  }).then((r) => r.json()).catch(() => ({}));
  if (!options.includes(reply.Response)) return;
  send('InjectResponse', JSON.stringify({ RequestId: d.RequestId, Response: reply.Response, ResponseOptionIndex: options.indexOf(reply.Response), Agent: { Id: reply.Agent } }));
  post('/trial', { TrialIndex: d.TrialIndex, Response: reply.Response, Agent: reply.Agent });
}

const seen = new Set();
window.addEventListener('studyflow:AwaitingResponse', (e) => {
  const d = e.detail;
  if (STAGE.source !== 'messages' || !d || !Array.isArray(d.ResponseOptions) || d.ResponseOptions.length === 0 || seen.has(d.RequestId)) return;
  seen.add(d.RequestId);
  answer(d);
});
window.addEventListener('studyflow:Event', (e) => post('/event', e.detail));
window.addEventListener('studyflow:TaskCompleted', (e) => {
  const d = e.detail;
  if (!d || d.TaskId !== STAGE.scene || (STAGE.timeline && d.TimelineId && d.TimelineId !== STAGE.timeline)) return;
  status.hidden = false;
  status.textContent = d.IsCompleted ? 'Task complete — you can close this tab.' : 'The task stopped before the end.';
  post('/completed', d);
});
</script>
"""


def along_messages(payload: dict[str, Any]) -> bool:
    """Whether the task's trials are answered along its message flows: only the runner sets `ResponseSource`."""
    return (payload.get("bot") or {}).get("ResponseSource") == "external"


def stage_page(payload: dict[str, Any]) -> bytes:
    title = f"{payload['scene']} / {payload['timeline']}"
    stage = {"scene": payload["scene"], "timeline": payload["timeline"],
             "source": "messages" if along_messages(payload) else "unity"}
    page = (STAGE_HTML.replace("__TITLE__", title).replace("__MOUNT__", BUILD_MOUNT)
            .replace("__PAYLOAD__", json.dumps(payload)).replace("__STAGE__", json.dumps(stage)))
    return page.encode()


class Stage(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, build: Path, page: bytes, events: Path, exchange: Exchange | None = None,
                 context: dict[str, Any] | None = None) -> None:
        super().__init__(("127.0.0.1", port), StageHandler)
        self.build = build.resolve()
        self.page = page
        self.events = events
        self.exchange = exchange
        self.context = context or {}
        self.recorded = Trials()
        self.trials = 0
        self.completion: dict[str, Any] = {}
        self.done = threading.Event()
        self.lock = threading.Lock()


def answer_of(exchange: Exchange, trial: dict[str, Any]) -> dict[str, Any]:
    """The trial's answer as the page injects it, `{Response, Agent}`, or {} when none names one of its options within
    its window. The message is the trial as the page relays it (its stimulus, options and window), less the build's
    request id, which is the message's own id."""
    request = str(trial.get("RequestId") or "")
    options = [str(option) for option in trial.get("ResponseOptions") or []]
    content = {key: value for key, value in trial.items() if key != "RequestId" and value is not None}
    choice = exchange.ask(content, request, options, float(trial.get("MaxResponseTime") or 0))
    return {"Response": choice, "Agent": exchange.partner} if choice else {}


def tally(trials: Trials, event: dict[str, Any]) -> None:
    """One event, as the build's own record of a trial: `TrialStart` shows one, and a `Click` or a `TrialEnd` with a
    `responseTime` answers it. Both markers are the BDM envelope's (`trialContext.types`, `result`), not an
    instrument's own event names. A `TrialEnd` whose every stream's response was `BurnInDisabled` took none: the
    N-back's first trials of a block, which show a stimulus before there is one to compare it with and never ask. A
    `<TASK>.TrialEnd` with `result.isAnswered` is the build's one record of the trial (the battery contract): whether
    it was answered, and its `condition`."""
    context = event.get("trialContext") or {}
    kinds = context.get("types") or []
    trial = ((context.get("block") or {}).get("id"), (context.get("trial") or {}).get("id"))
    if trial[1] is None:
        return
    result = event.get("result") or {}
    if (context.get("block") or {}).get("name"):
        trials.blocks[trial] = str(context["block"]["name"])
    if str((event.get("object") or {}).get("name") or "").endswith(".TrialEnd") and isinstance(result.get("isAnswered"), bool):
        correct = result.get("isCorrect")
        trials.ended[trial] = (result["isAnswered"], str(context.get("condition") or ""), correct if isinstance(correct, bool) else None)
    if "TrialStart" in kinds:
        trials.shown.add(trial)
    if "Click" in kinds or ("TrialEnd" in kinds and result.get("responseTime") is not None):
        trials.answered.add(trial)
    streams = result.get("streamResults") or []
    disabled = [isinstance(stream, dict) and stream.get("userResponseType") == "BurnInDisabled" for stream in streams]
    if "TrialEnd" in kinds and disabled and all(disabled):
        trials.unanswerable.add(trial)


class StageHandler(BaseHTTPRequestHandler):
    server: Stage

    def log_message(self, *_: Any) -> None:  # the terminal is for the run, not the access log
        pass

    def reply(self, status: int, body: bytes = b"", content_type: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - the http.server contract
        path = self.path.split("?", 1)[0]
        if path == "/":
            return self.reply(200, self.server.page, "text/html; charset=utf-8")
        if not path.startswith(BUILD_MOUNT + "/"):
            return self.reply(404, b"not found")
        target = (self.server.build / unquote(path[len(BUILD_MOUNT) + 1:])).resolve()
        if not target.is_relative_to(self.server.build) or not target.is_file():
            return self.reply(404, b"not found")
        # Unity's compression suffixes name the encoding; `.unityweb` is its decompression-fallback build, served raw.
        name = target.name
        encoding = {".gz": "gzip", ".br": "br"}.get(target.suffix)
        if encoding:
            name = name[: -len(target.suffix)]
        suffix = Path(name).suffix.lower()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(suffix) or mimetypes.guess_type(name)[0] or "application/octet-stream")
        if encoding:
            self.send_header("Content-Encoding", encoding)
        self.send_header("Content-Length", str(target.stat().st_size))
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        with target.open("rb") as file:
            shutil.copyfileobj(file, self.wfile)

    def do_POST(self) -> None:  # noqa: N802 - the http.server contract
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.reply(400, b"invalid JSON")
        server = self.server
        if self.path == "/respond":
            answer = answer_of(server.exchange, body) if server.exchange and isinstance(body, dict) else {}
            return self.reply(200, json.dumps(answer).encode(), "application/json")
        if self.path == "/event":
            # The run's own context rides on every event: the build records the trial, this says whose it is.
            line = {**body, "context": server.context} if isinstance(body, dict) else body
            with server.lock:
                if isinstance(body, dict):
                    tally(server.recorded, body)
                with server.events.open("a") as file:
                    file.write(json.dumps(line, separators=(",", ":")) + "\n")
        elif self.path == "/trial":
            with server.lock:
                server.trials += 1
            print(f"    trial {body.get('TrialIndex', '?')}: {body.get('Response')}  ({body.get('Agent', 'bot')})", flush=True)
        elif self.path == "/completed":
            server.completion = body if isinstance(body, dict) else {}
            server.done.set()
        else:
            return self.reply(404, b"not found")
        self.reply(204)


def open_stage(url: str) -> subprocess.Popen | None:
    """Open the stage in a browser of its own: a Chromium in app mode with a throwaway profile, full screen,
    that this runner can close when the task is done. Without one, the default browser opens a tab."""
    binary = chromium.find()
    if binary is None:
        webbrowser.open(url)
        return None
    profile = tempfile.mkdtemp(prefix="studyflow-stage-")
    return subprocess.Popen(  # noqa: S603 - a browser we picked, opening a page we serve
        stage_argv(binary, url, profile), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def stage_argv(binary: str, url: str, profile: str) -> list[str]:
    """The browser's command line. `chromium.UNTHROTTLED` keeps the task at full speed when its window is occluded or
    on another Space: Chrome throttles such a window to 1 fps while Unity keeps stepping, so every timed phase would
    stretch to a second of wall clock whatever `Bot.Speed` says."""
    return [binary, f"--app={url}", f"--user-data-dir={profile}", "--start-fullscreen", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", *chromium.UNTHROTTLED]


REPO = Path(__file__).resolve().parents[2]  # skills/behaverse/local.py
UNITY_BUILD_DEFAULTS = [REPO / "run" / "assessment-unity" / "Build" / "WebGL", REPO.parent / "assessment-unity" / "Build" / "WebGL"]


def build_dir(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    if os.environ.get("UNITY_BUILD_PATH"):
        return Path(os.environ["UNITY_BUILD_PATH"])
    return next((d for d in UNITY_BUILD_DEFAULTS if (d / "index.html").is_file()), UNITY_BUILD_DEFAULTS[0])


def checked_build(explicit: Path | None) -> Path:
    build = build_dir(explicit)
    if not (build / "index.html").is_file():
        raise FileNotFoundError(f"no Unity WebGL build at {build} — set UNITY_BUILD_PATH (or --build) to the Build/WebGL folder, or check out assessment-unity beside this repo")
    return build


def perform(step: Step, args: argparse.Namespace) -> dict[str, Any]:
    """One task: serve, open, wait for the completion, which is its result."""
    element, plan, state = step.element, step.elements, step.values
    payload = task_payload(element, auto=args.auto or bool(step.options.get("auto")), plan=plan, resolved=step.attributes)
    build = checked_build(args.build)
    # The run directory, not its `.cache`: the local runtime sweeps the cache when the run ends.
    step.run_dir.mkdir(parents=True, exist_ok=True)
    events = step.run_dir / records_uri(element, plan)
    events.parent.mkdir(parents=True, exist_ok=True)
    if not opened_this_run(step.cache, events):
        events.unlink(missing_ok=True)
    exchange = None
    if along_messages(payload):
        flow, _ = exchange_flows(element, plan, STRUCTURES) or ("", "")
        partner = ", ".join((plan.get(p) or {}).get("name") or p for p in message_partners(element, plan, STRUCTURES))
        exchange = Exchange(step, flow, partner, data_inputs(element, state, plan))
    stage = Stage(args.port, build, stage_page(payload), events, exchange, record_context(element, plan, state))
    threading.Thread(target=stage.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{stage.server_port}/"
    print(f"□ {element.get('name') or element['id']}: {payload['scene']} / {payload['timeline']} ({payload['agentType']}) — {url}", flush=True)
    if exchange:
        print(f"    each trial goes along {exchange.flow} to {exchange.partner}, and its answer comes back", flush=True)
    browser = None if args.no_browser else open_stage(url)
    deadline = time.monotonic() + args.timeout if args.timeout else None
    try:
        while not stage.done.wait(0.1):
            if step.cancelled:
                raise Cancelled(f"{step.id} was stopped")
            if deadline and time.monotonic() > deadline:
                raise TimeoutError(f"no completion from the task within {args.timeout}s")
    except BaseException:
        # Stopped or failed: the walk hears at once, and the window closes behind the answer, on a thread the process
        # does not exit before.
        threading.Thread(target=chromium.close, args=(stage, browser)).start()
        raise
    # The completion notice stays up for a moment before the window goes, unless the walk stops the step meanwhile.
    shown = time.monotonic() + 1.0
    while browser is not None and time.monotonic() < shown and not step.cancelled:
        time.sleep(0.1)
    chromium.close(stage, browser)
    completion = stage.completion
    if not completion.get("IsCompleted"):
        raise RuntimeError(f"the task stopped before the end: {completion or 'no detail'}")
    print(f"    completed {completion.get('TaskId')} / {completion.get('TimelineId')} after {stage.trials} answered trials", flush=True)
    result = {**completion, "trials": stage.trials, "blocks": block_counts(stage.recorded)}
    if events.exists():
        result["events"] = str(events)
    return result  # under the task's id, so a later step can cite it (`{Play.trials}`)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--build", type=Path, default=None, metavar="DIR", help="the Unity WebGL build (default: $UNITY_BUILD_PATH)")
    parser.add_argument("--port", type=int, default=0, help="serve the stage on this port (default: a free one)")
    parser.add_argument("--timeout", type=float, default=0, help="give up on a task after this many seconds (default: wait)")
    parser.add_argument("--no-browser", action="store_true", help="print the stage URL instead of opening it")
    parser.add_argument("--auto", action="store_true", help="every task is played by its bot, so nobody needs to be at the screen")
    args = parser.parse_args()

    def claims(plan: dict[str, Any]) -> list[str]:
        return claimed_tasks(plan, lambda: checked_build(args.build))

    def execute(step: Step) -> Any:
        """A task on the simulated build, and a simulated actor's message, go to simulated.py; any other task to the
        Unity build."""
        if step.element.get("type") == "participant" or build_of(step.element) == "simulated":
            import simulated  # beside this file
            return simulated.take(step) if step.element.get("type") == "participant" else simulated.play(step)
        return perform(step, args)

    # The person is at the screen and the terminal: what this prints is for them, not the run log.
    return serve(claims, execute, terminal=True)


if __name__ == "__main__":
    sys.exit(main())

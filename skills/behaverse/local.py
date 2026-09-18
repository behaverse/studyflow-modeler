#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Run the Behaverse (Unity WebGL) tasks of a studyflow in this machine's browser.

Usage:
    studyflow run <diagram> --runtime local [--auto]      # studyflow-run-local walks, this runner performs
    UNITY_BUILD_PATH=<dir> skills/behaverse/local.py plan.json --element <id> --cache <dir>

A partial runner: it claims every `behaverse:Task`, and per hand-off serves the
Unity WebGL build and a small stage page from a local port, opens the page in the default
browser, starts the task through the build's `RunCognitiveTask` entry point, and waits for
`studyflow:TaskCompleted`. The page relays what the build reports back to this process:
every `studyflow:Event` to `<cache>/<element>.events.jsonl`, each answered trial to the
terminal, and the completion, which becomes the element's `result`. Who answers is what the
diagram draws. A task with message flows sends each awaiting trial along the one out of it and
takes the answer back from the one into it (skills/local/SKILL.md, "Messages"); an answer that
names no option in time is no answer, and the trial's own window makes it a miss. Without flows,
a person plays the task, or the build's own random bot does for a `software` taker whose
`implementation` is `random`. `--auto` gives every person's task to that bot, so a run needs
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
from typing import Any
from urllib.parse import unquote

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
BEHAVERSE = "http://behaverse.org/schemas/studyflow/behaverse"
BUILD_MOUNT = "/assessment-unity"
# Who answers a task is the drawing's to say, never `Bot:`'s (the browser runner's types.ts `WHO_ANSWERS_KEYS`).
WHO_ANSWERS_KEYS = ("ResponseSource", "LLM", "Prompt")
MIME ={".wasm": "application/wasm", ".data": "application/octet-stream", ".unityweb": "application/octet-stream",
        ".js": "application/javascript", ".json": "application/json"}


def behaverse_extension(element: dict[str, Any]) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == BEHAVERSE and str(ext.get("type", "")).lower() == "task"), None)


def task_payload(element: dict[str, Any], auto: bool = False, plan: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """The `RunCognitiveTask` payload, built as the browser runner's parser.ts builds it; `plan` is every element
    of the digest, for what the diagram draws around this task."""
    element_id = str(element.get("id"))
    attrs = (behaverse_extension(element) or {}).get("attributes") or {}
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
    random bot, or `human`. Any other taker answers only along message flows, so drawing none of them is an error."""
    if trial_flows(element, plan):
        return "messages"
    actor = actor_of(element, plan)
    if actor["kind"] in ("", "human"):
        return "internal" if auto else "human"
    if actor["kind"] == "software" and actor["model"] == "random":
        return "internal"
    raise ValueError(f"{element.get('id')} is taken by a {actor['kind']} participant, which answers along message flows "
                     "in a local run: draw one carrying each trial out of the task and one bringing the answer back")


def trial_flows(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> tuple[str, str] | None:
    """The message flow the task sends its trials along and the one it takes the answers back from, when it has
    them; `message_partners` has checked the directions and that there is one partner."""
    if not message_partners(element, plan):
        return None
    element_id = element.get("id")
    ends = [(flow_id, (flow.get("attributes") or {}), message_structure(flow, plan)) for flow_id, flow in plan.items()
            if flow.get("type") == "messageFlow"]
    out = [flow_id for flow_id, attrs, structure in ends if attrs.get("sourceRef") == element_id and structure in ("", TRIAL)]
    back = [flow_id for flow_id, attrs, structure in ends if attrs.get("targetRef") == element_id and structure in ("", RESPONSE)]
    if len(out) != 1 or len(back) != 1:
        raise ValueError(f"{element_id} sends its trials along one message flow and takes the answers back along one; "
                         f"it has {len(out)} out and {len(back)} back")
    return out[0], back[0]


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
        candidates = message_partners(element, plan)
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


def element_process(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """The process the element belongs to: its `parent`, followed outward while the parent is itself an element."""
    current = str(element.get("parent") or "")
    while current in plan and plan[current].get("parent"):
        current = str(plan[current]["parent"])
    return current


def pool_participants(process_id: str, plan: dict[str, dict[str, Any]]) -> list[str]:
    """The participants whose pool holds the process."""
    return [pid for pid, p in plan.items()
            if p.get("type") == "participant" and (p.get("attributes") or {}).get("processRef") == process_id]


# The messages this runner's task exchanges, as a message flow's `messageRef` → `itemRef` → `structureRef` names them.
TRIAL, RESPONSE = "behaverse:Trial", "behaverse:Response"


def message_structure(flow: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """What a message flow carries: its message's item definition (`structureRef`), '' when it names none."""
    message = plan.get(str((flow.get("attributes") or {}).get("messageRef") or "")) or {}
    item = plan.get(str((message.get("attributes") or {}).get("itemRef") or "")) or {}
    return str((item.get("attributes") or {}).get("structureRef") or "")


def message_partners(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> list[str]:
    """The participants at the other end of the message flows touching the element: a pool itself, or the
    pool of the step the flow ends at. A flow that names its message outranks one that does not, and counts
    only when it carries a trial out of the task or a response back into it; more than one partner left is
    an ambiguity to fix in the diagram, not an order to guess."""
    typed: list[str] = []
    untyped: list[str] = []
    for flow_id, flow in plan.items():
        attrs = flow.get("attributes") or {}
        if flow.get("type") != "messageFlow" or element.get("id") not in (attrs.get("sourceRef"), attrs.get("targetRef")):
            continue
        outgoing = attrs.get("sourceRef") == element.get("id")
        structure = message_structure(flow, plan)
        if structure and structure not in (TRIAL, RESPONSE):
            continue  # another skill's exchange (a marker to an EEG pool, say)
        if structure and (structure == TRIAL) != outgoing:
            raise ValueError(f"message flow {flow_id!r} carries {structure} the wrong way: trials leave the task, responses come back")
        other = attrs["targetRef"] if outgoing else attrs.get("sourceRef")
        end = plan.get(str(other)) or {}
        found = [str(other)] if end.get("type") == "participant" else pool_participants(element_process(end, plan), plan)
        into = typed if structure else untyped
        into += [pid for pid in found if pid not in into]
    partners = typed or untyped
    if len(partners) > 1:
        raise ValueError(f"{element.get('id')} exchanges messages with {', '.join(partners)}: name the message each flow "
                         f"carries (messageRef, {TRIAL} or {RESPONSE}), or keep one partner")
    return partners


def events_uri(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """Where the task's events go: the `uri` of a data element its output edge targets, else `<id>.events.jsonl`."""
    for binding in element.get("outputs") or []:
        uri = ((plan.get(str(binding.get("target"))) or {}).get("attributes") or {}).get("uri")
        if uri and not str(uri).endswith("/"):
            return str(uri)
    return f"{element['id']}.events.jsonl"


def opened_this_run(cache: Path, events: Path) -> bool:
    """Whether this run has already written this events file. Several tasks may deposit their trials in one drawn
    dataset, and a task may play once per subject in a loop: the first to write it in a run starts it empty, the
    rest append. The run is the walk's pid (`STUDYFLOW_RUN_PID`, skills/local/SKILL.md), so a later run truncates
    again. ponytail: two pools writing one dataset at the same instant may both think they are first."""
    marker = cache / "events.written.json"
    run = os.environ.get("STUDYFLOW_RUN_PID", "")
    try:
        written = json.loads(marker.read_text())
    except (OSError, ValueError):
        written = {}
    if written.get(str(events)) == run:
        return True
    written[str(events)] = run
    cache.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps(written))
    return False


def failed_trial_rate(element: dict[str, Any], shown: set, answered: set) -> float:
    """The share of the trials the build showed that it recorded no valid response for, and the verdict its
    `maxFailedTrialRate` asks for: above that share the task fails, and its error boundary event takes the walk on.
    The build is the authority, not the reply: an answer this runner injected too late for the window is a trial the
    build recorded without a response. A build that reports no trial at all reports no failure."""
    trials = shown | answered
    rate = len(trials - answered) / len(trials) if trials else 0.0
    limit = ((behaverse_extension(element) or {}).get("attributes") or {}).get("maxFailedTrialRate")
    if limit is not None and rate > float(limit):
        raise RuntimeError(f"{element.get('id')}: {rate:.0%} of its {len(trials)} trials got no valid response, "
                           f"above the maxFailedTrialRate of {float(limit):.0%} — the task fails")
    return rate


def trial_context(element: dict[str, Any], plan: dict[str, dict[str, Any]], state: dict[str, Any]) -> dict[str, Any]:
    """What this run knows about the task's trials beside what the build records: which subject (the task's own visit
    count, which is study-lifetime, so a loop's iterations and a re-run number the subjects apart) and the properties
    in scope at the hand-off, innermost last. ponytail: one visit per subject; a study that plays the same task twice
    per subject needs a property of its own to tell them apart."""
    tree = state.get("state") or {}
    scopes: list[str] = []
    scope = str(element.get("id") or "")
    while scope:
        scopes.append(scope)
        scope = str((plan.get(scope) or {}).get("parent") or "")
    held: dict[str, Any] = {}
    for scope in reversed(scopes):  # outward in, so an inner scope shadows an outer one
        held.update(tree.get(scope) or {})
    return {"subject": ((tree.get("_meta") or {}).get("reached") or {}).get(element.get("id"), 1), "state": held}


def option_named(content: Any, options: list[str]) -> str | None:
    """The option an answer is: its text, or the one value of a mapping (a send task's one data input), matched
    whole and without case. An answer that only mentions an option names none ("NonMatch" holds "Match")."""
    if isinstance(content, dict) and len(content) == 1:
        content = next(iter(content.values()))
    text = str(content or "").strip().strip("`\"'.").strip().lower()
    return next((option for option in options if option.lower() == text), None)


def data_inputs(element: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    """What rides with every trial beside the trial itself: the task's data inputs by source id, each with the value
    this run bound for it, else null — as an unclaimed activity sends its own (skills/local/SKILL.md, "Messages").
    That is how the `agentic:Prompt` wired into the task reaches the pool that answers."""
    return {source: state.get(source) for binding in element.get("inputs") or [] if (source := binding.get("source"))}


class Exchange:
    """The task's end of its message flows (skills/local/SKILL.md, "Messages"): each awaiting trial goes out along
    the trial flow through the outbox, and the answer that names it (`inReplyTo`) comes back into the inbox."""

    def __init__(self, cache: Path, element_id: str, flow: str, agent: str, inputs: dict[str, Any] | None = None) -> None:
        self.outbox, self.inbox = cache / f"{element_id}.outbox.jsonl", cache / f"{element_id}.inbox.jsonl"
        self.flow, self.agent, self.lock = flow, agent, threading.Lock()
        self.inputs = inputs or {}

    def ask(self, trial: dict[str, Any]) -> dict[str, Any]:
        """The trial's answer as the page injects it, or {} when none names an option within the response window."""
        request = str(trial.get("RequestId") or "")
        options = [str(option) for option in trial.get("ResponseOptions") or []]
        with self.lock, self.outbox.open("a") as file:
            content = {**self.inputs, **{key: value for key, value in trial.items() if key != "RequestId" and value is not None}}
            file.write(json.dumps({"flow": self.flow, "id": request, "content": content}) + "\n")
        window = float(trial.get("MaxResponseTime") or 0)
        deadline = time.monotonic() + (max(1.0, window - 0.25) if window > 0 else 30.0)
        while time.monotonic() < deadline:
            for line in self.inbox.read_text().splitlines() if self.inbox.exists() else []:
                try:
                    message = json.loads(line)
                except ValueError:
                    continue  # the walk may be writing it
                if message.get("inReplyTo") == request:
                    choice = option_named(message.get("content"), options)
                    return {"Response": choice, "Agent": self.agent} if choice else {}
            time.sleep(0.05)
        return {}


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

// Along the task's message flows: the runner sends the trial and waits for the answer that names it. No answer, no
// injection: the trial's own response window ends it, a miss.
async function answer(d) {
  const options = d.ResponseOptions;
  const reply = await fetch('/respond', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ RequestId: d.RequestId, TrialIndex: d.TrialIndex, ResponseOptions: options,
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
        self.shown: set[tuple] = set()      # the trials the build started
        self.answered: set[tuple] = set()   # those it recorded a response for
        self.trials = 0
        self.completion: dict[str, Any] = {}
        self.done = threading.Event()
        self.lock = threading.Lock()


def tally(stage: Stage, event: dict[str, Any]) -> None:
    """One event, as the build's own record of a trial: `TrialStart` shows one, and a `Click` or a `TrialEnd` with a
    `responseTime` answers it. Both markers are the BDM envelope's (`trialContext.types`, `result`), not an
    instrument's own event names."""
    context = event.get("trialContext") or {}
    kinds = context.get("types") or []
    trial = ((context.get("block") or {}).get("id"), (context.get("trial") or {}).get("id"))
    if trial[1] is None:
        return
    if "TrialStart" in kinds:
        stage.shown.add(trial)
    if "Click" in kinds or ("TrialEnd" in kinds and (event.get("result") or {}).get("responseTime") is not None):
        stage.answered.add(trial)


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
            answer = server.exchange.ask(body) if server.exchange and isinstance(body, dict) else {}
            return self.reply(200, json.dumps(answer).encode(), "application/json")
        if self.path == "/event":
            # The run's own context rides on every event: the build records the trial, this says whose it is.
            line = {**body, "context": server.context} if isinstance(body, dict) else body
            with server.lock:
                if isinstance(body, dict):
                    tally(server, body)
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


CHROMIUM_APPS = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome", "chromium", "chromium-browser",
)


def open_stage(url: str) -> subprocess.Popen | None:
    """Open the stage in a browser of its own: a Chromium in app mode with a throwaway profile, full screen,
    that this runner can close when the task is done. Without one, the default browser opens a tab."""
    binary = next((app for app in CHROMIUM_APPS if Path(app).is_file() or shutil.which(app)), None)
    if binary is None:
        webbrowser.open(url)
        return None
    profile = tempfile.mkdtemp(prefix="studyflow-stage-")
    return subprocess.Popen(  # noqa: S603 - a browser we picked, opening a page we serve
        stage_argv(binary, url, profile), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def stage_argv(binary: str, url: str, profile: str) -> list[str]:
    """The browser's command line. The three `--disable-*` flags keep the task at full speed when its window is
    occluded or on another Space: Chrome throttles such a window to 1 fps while Unity keeps stepping, so every
    timed phase stretches to a second of wall clock whatever `Bot.Speed` says."""
    return [binary, f"--app={url}", f"--user-data-dir={profile}", "--start-fullscreen", "--no-first-run",
            "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required",
            "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling"]


def profile_of(browser: subprocess.Popen) -> str:
    return next(arg.split("=", 1)[1] for arg in browser.args if str(arg).startswith("--user-data-dir="))


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


def perform(element: dict[str, Any], args: argparse.Namespace, plan: dict[str, dict[str, Any]], state: dict[str, Any]) -> dict[str, Any]:
    """One task: serve, open, wait for the completion; the keys a hand-off merges into the state."""
    payload = task_payload(element, auto=args.auto, plan=plan)
    build = checked_build(args.build)
    cache = args.cache or Path(".")
    # The run directory, not its `.cache`: studyflow-run-local sweeps the cache when the run ends.
    run_dir = cache.parent if cache.name == ".cache" else cache
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / events_uri(element, plan)
    events.parent.mkdir(parents=True, exist_ok=True)
    if not opened_this_run(cache, events):
        events.unlink(missing_ok=True)
    exchange = None
    if along_messages(payload):
        trials, _ = trial_flows(element, plan) or ("", "")
        partner = ", ".join((plan.get(p) or {}).get("name") or p for p in message_partners(element, plan))
        exchange = Exchange(cache, str(element["id"]), trials, partner, data_inputs(element, state))
    stage = Stage(args.port, build, stage_page(payload), events, exchange, trial_context(element, plan, state))
    threading.Thread(target=stage.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{stage.server_port}/"
    print(f"□ {element.get('name') or element['id']}: {payload['scene']} / {payload['timeline']} "
          f"({payload['agentType']}) — {url}", flush=True)
    if exchange:
        print(f"    each trial goes along {exchange.flow} to {exchange.agent}, and its answer comes back", flush=True)
    browser = None if args.no_browser else open_stage(url)
    clock = time.perf_counter()
    try:
        if not stage.done.wait(args.timeout or None):
            raise TimeoutError(f"no completion from the task within {args.timeout}s")
    finally:
        stage.shutdown()
        if browser is not None:
            time.sleep(1.0)  # the completion notice stays up for a moment before the window goes
            browser.terminate()
            try:
                browser.wait(timeout=5)
            except subprocess.TimeoutExpired:
                browser.kill()
            shutil.rmtree(profile_of(browser), ignore_errors=True)
    completion = stage.completion
    if not completion.get("IsCompleted"):
        raise RuntimeError(f"the task stopped before the end: {completion or 'no detail'}")
    print(f"    completed {completion.get('TaskId')} / {completion.get('TimelineId')} after {stage.trials} answered trials", flush=True)
    result = {**completion, "trials": stage.trials}
    if exchange is not None:
        # Raises when too many trials went unanswered: the task fails, and its error boundary event takes over.
        result["failedTrialRate"] = failed_trial_rate(element, stage.shown, stage.answered)
    if events.exists():
        result["events"] = str(events)
    return {"result": result, "durationMs": round((time.perf_counter() - clock) * 1000, 1)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plan", type=Path, help="the plan digest studyflow-run-local hands over (plan.json)")
    parser.add_argument("--element", metavar="ID", default=None, help="hand-off mode: execute this one element, then exit")
    parser.add_argument("--claims", action="store_true", help="print the element ids this runner would execute, as a JSON array, and exit")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state: <element>.state.json in, result merged back")
    parser.add_argument("--build", type=Path, default=None, metavar="DIR", help="the Unity WebGL build (default: $UNITY_BUILD_PATH)")
    parser.add_argument("--port", type=int, default=0, help="serve the stage on this port (default: a free one)")
    parser.add_argument("--timeout", type=float, default=0, help="give up after this many seconds (default: wait)")
    parser.add_argument("--no-browser", action="store_true", help="print the stage URL instead of opening it")
    parser.add_argument("--auto", action="store_true", help="every task is played by its bot, so nobody needs to be at the screen")
    parser.add_argument("--sim", action="store_true", help=argparse.SUPPRESS)  # a flag other partial runners take
    args = parser.parse_args()

    elements: dict[str, dict[str, Any]] = json.loads(args.plan.read_text()).get("elements") or {}
    if args.claims:
        claimed = [eid for eid, element in elements.items() if behaverse_extension(element) is not None]
        if claimed:  # fail before the walk starts, not after another pool's robot has greeted
            try:
                checked_build(args.build)
            except FileNotFoundError as error:
                sys.exit(str(error))
        print(json.dumps(claimed))
        return 0
    if not args.element:
        parser.error("this runner performs one element at a time: pass --element or --claims")

    # The person is on stderr and the tty; stdout is captured into the run log.
    sys.stdout = sys.stderr
    cache = args.cache or Path(".")
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}
    try:
        element = elements.get(args.element)
        if element is None or behaverse_extension(element) is None:
            raise KeyError(f"no behaverse:Task {args.element!r} in the diagram")
        result = perform(element, args, elements, state)
    except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
        result = {"error": f"{type(error).__name__}: {error}"}
    cache.mkdir(parents=True, exist_ok=True)
    # Its own result under its id too, so a later step can cite it (`{Play.trials}`).
    captured = {args.element: result["result"]} if "result" in result else {}
    handoff.write_text(json.dumps({**state, **captured, **result}, default=str))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main())

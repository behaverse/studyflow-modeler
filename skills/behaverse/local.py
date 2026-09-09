#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Run the Behaverse (Unity WebGL) tasks of a studyflow in this machine's browser.

Usage:
    studyflow run <diagram> --runtime local [--auto]      # studyflow-run-local walks, this runner performs
    UNITY_BUILD_PATH=<dir> skills/behaverse/local.py plan.json --element <id> --cache <dir>

A partial runner: it claims every `cognitive:BehaverseTask`, and per hand-off serves the
Unity WebGL build and a small stage page from a local port, opens the page in the default
browser, starts the task through the build's `RunCognitiveTask` entry point, and waits for
`studyflow:TaskCompleted`. The page relays what the build reports back to this process:
every `studyflow:Event` to `<cache>/<element>.events.jsonl`, each answered trial to the
terminal, and the completion, which becomes the element's `result`. A human plays the task
as in the browser runner. A bot task that exchanges messages with another pool (a message flow
drawn to or from it), or whose bot says `ResponseSource: external`, has each awaiting trial
forwarded by the page to the response bridge (`BridgeUrl`, default ws://localhost:8765,
e.g. `skills/reachy/local.py --participant`), random when nothing answers; an `agentic:Prompt`
wired into the task is the player's instructions. `--auto` turns every task into a bot task so a
run needs nobody at the screen.

The build is looked for at `$UNITY_BUILD_PATH`, then `<repo>/run/assessment-unity/Build/WebGL`,
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

import yaml

COGNITIVE = "http://behaverse.org/schemas/studyflow/cognitive"
BUILD_MOUNT = "/assessment-unity"
DEFAULT_BRIDGE_URL = "ws://localhost:8765"
# Bot keys this side reads and Unity's `BotReflection.Apply` refuses (the browser runner's types.ts).
RUNNER_ONLY_BOT_KEYS = ("LLM", "Prompt", "BridgeUrl")
MIME = {".wasm": "application/wasm", ".data": "application/octet-stream", ".unityweb": "application/octet-stream",
        ".js": "application/javascript", ".json": "application/json"}


def behaverse_extension(element: dict[str, Any]) -> dict[str, Any] | None:
    return next((ext for ext in element.get("extensions") or []
                 if ext.get("namespace") == COGNITIVE and str(ext.get("type", "")).lower() == "behaversetask"), None)


def mapping_of(text: Any, what: str, element_id: str) -> dict[str, Any]:
    """A YAML mapping the diagram wrote as element text; empty when absent."""
    if not isinstance(text, str) or not text.strip():
        return {}
    try:
        parsed = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise ValueError(f"{what} on BehaverseTask {element_id!r} is not valid YAML: {error}") from None
    if not isinstance(parsed, dict):
        raise ValueError(f"{what} on BehaverseTask {element_id!r} must be a mapping of setting names to values")
    return parsed


def task_payload(element: dict[str, Any], auto: bool = False, plan: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """The `RunCognitiveTask` payload, built as the browser runner's parser.ts builds it; `plan` is every element
    of the digest, for what the diagram wires into this task."""
    element_id = str(element.get("id"))
    attrs = (behaverse_extension(element) or {}).get("attributes") or {}
    scene = str(attrs.get("behaverseScene") or "")
    if not scene:
        raise ValueError(f"BehaverseTask {element_id!r} has no behaverseScene; set it to a task the Unity build ships")
    # Who takes the task is its participant (band, message flow, or pool): a person, or a bot of some kind.
    actor = actor_of(element, plan or {})
    parameters = mapping_of(attrs.get("configurations"), "configurations", element_id)
    # `Bot:` is not GameConfig: how a bot plays the task, sent to Unity as the payload's own `bot`.
    bot_settings = parameters.pop("Bot", None)
    bot_settings = bot_settings if isinstance(bot_settings, dict) else {}
    agent = "bot" if auto or actor["kind"] not in ("", "human") or bot_settings.get("ResponseSource") else "human"
    payload: dict[str, Any] = {"scene": scene, "agentType": agent, "configMode": "builtin",
                               "metadata": {"studyflowNodeId": element_id}}
    timelines = parameters.get("Timelines")
    if isinstance(timelines, dict):
        if timelines:
            payload["timeline"] = next(iter(timelines))  # the first timeline names what Unity runs
        # Unity null-merges `parameters` over Resources/<scene>.json: a `{Name: null}` entry would erase that timeline.
        inline = {name: definition for name, definition in timelines.items() if definition is not None}
        if inline:
            parameters["Timelines"] = inline
        else:
            del parameters["Timelines"]
    if parameters:
        payload["configMode"] = "inline"
        payload["parameters"] = parameters
    if agent == "bot":
        bot = bot_settings
        if actor["kind"] == "robot" or (actor["kind"] == "agent" and actor["model"] != "random"):
            bot["ResponseSource"] = "external"  # answered over the response bridge by whoever sits there
            if actor["bridge"] and not bot.get("BridgeUrl"):
                bot["BridgeUrl"] = actor["bridge"]  # where that partner said it listens
        elif actor["kind"] == "agent":
            bot.pop("ResponseSource", None)  # the build's own random bot
        elif actor["kind"] == "llm":
            bot["ResponseSource"] = "llm"
            if actor["model"]:
                provider, model = split_model(actor["model"])
                bot["LLM"] = {"Provider": provider, "Model": model}
        prompt = prompt_of(element, plan or {})  # the one way to instruct whoever takes the task
        if prompt and not bot.get("Prompt"):
            bot["Prompt"] = prompt
        if bot:
            payload["bot"] = bot
    return payload


AGENTIC = "https://w3id.org/studyflow/agentic"
REACHY = "https://w3id.org/studyflow/reachy"
EMPTY_ACTOR: dict[str, Any] = {"kind": "", "model": "", "bridge": ""}


def actor_of(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Who takes the task, from what the diagram draws, most explicit first: the task's receiving band; else the
    other end of a message flow touching it (a pool, or a step's pool); else the pool the task sits in. A
    `reachy:Robot` is a robot; a `cognitive:Actor` is what its `actorType` says, with its `identifier` as the
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
                # `bridge` is where the robot takes trials; the schema's default is the bridge's own default.
                return {"kind": "robot", "model": "", "bridge": str(attributes.get("bridge") or "")}
            if ext.get("namespace") == COGNITIVE and str(ext.get("type", "")).lower() == "actor":
                return {"kind": str(attributes.get("actorType") or "human"), "model": str(attributes.get("identifier") or ""), "bridge": ""}
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


def split_model(identifier: str) -> tuple[str, str]:
    """`provider:model` as written, a bare `claude-*` name as Claude's, anything else as Ollama's."""
    if ":" in identifier:
        provider, model = identifier.split(":", 1)
        return provider, model
    return ("claude" if identifier.startswith("claude") else "ollama"), identifier


def prompt_of(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """The `agentic:Prompt` data object wired into the element, as its template text."""
    for binding in element.get("inputs") or []:
        for ext in (plan.get(str(binding.get("source"))) or {}).get("extensions") or []:
            if ext.get("namespace") == AGENTIC and str(ext.get("type", "")).lower() == "prompt":
                return str((ext.get("attributes") or {}).get("template") or "")
    return ""


def bot_for_unity(bot: dict[str, Any] | None) -> dict[str, Any] | None:
    if not bot:
        return None
    stripped = {key: ("external" if key == "ResponseSource" and value == "llm" else value)
                for key, value in bot.items() if key not in RUNNER_ONLY_BOT_KEYS}
    return stripped or None


def stage_config(payload: dict[str, Any]) -> dict[str, Any]:
    """What the stage page needs beyond Unity's payload: how trials get answered."""
    bot = payload.get("bot") or {}
    source = bot.get("ResponseSource")
    return {
        "scene": payload["scene"],
        "timeline": payload.get("timeline"),
        "source": source if source in ("external", "llm") else "internal",
        "bridge": bot.get("BridgeUrl") or DEFAULT_BRIDGE_URL,
        "prompt": bot.get("Prompt") or "",
        "llm": bot.get("LLM"),
    }


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

// The response bridge, as the browser runner's bridge.ts speaks it.
let socket = null;
function bridge(timeoutMs) {
  if (socket) return socket;
  socket = new Promise((resolve, reject) => {
    const ws = new WebSocket(STAGE.bridge);
    const timer = setTimeout(() => { ws.close(); reject(new Error('bridge connect timed out')); }, Math.min(timeoutMs, 2000));
    ws.onopen = () => { clearTimeout(timer); resolve(ws); };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('no response bridge at ' + STAGE.bridge)); };
    ws.onclose = () => { socket = null; };
  });
  socket.catch(() => { socket = null; });
  return socket;
}
async function askBridge(trial, timeoutMs) {
  let ws;
  try { ws = await bridge(timeoutMs); } catch (e) { return undefined; }
  return new Promise((resolve) => {
    const finish = (reply) => { clearTimeout(timer); ws.removeEventListener('message', onMessage); resolve(reply); };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    const onMessage = (m) => {
      try {
        const data = JSON.parse(m.data);
        if (data.type === 'response' && data.RequestId === trial.RequestId) finish(typeof data.Response === 'string' ? data : undefined);
      } catch (e) { /* not our message */ }
    };
    ws.addEventListener('message', onMessage);
    try { ws.send(JSON.stringify(trial)); } catch (e) { finish(undefined); }
  });
}
function notifyBridge(message) { bridge(2000).then((ws) => ws.send(JSON.stringify(message))).catch(() => {}); }

async function answer(d) {
  const options = d.ResponseOptions;
  let reply;
  if (STAGE.source !== 'internal') {
    const timeoutMs = d.MaxResponseTime > 0 ? Math.max(1000, d.MaxResponseTime * 1000 - 250) : 30000;
    reply = await askBridge({
      type: 'trial', RequestId: d.RequestId, TrialIndex: d.TrialIndex, ResponseOptions: options,
      MaxResponseTime: d.MaxResponseTime, Scene: STAGE.scene, Prompt: STAGE.prompt || undefined, LLM: STAGE.llm || undefined,
      Screenshot: d.Screenshot || undefined,
    }, timeoutMs);
  }
  const answered = reply && options.includes(reply.Response);
  const response = answered ? reply.Response : options[Math.floor(Math.random() * options.length)];
  const agent = answered ? ((reply.Agent && reply.Agent.Id) || 'external') : 'bot';
  send('InjectResponse', JSON.stringify({ RequestId: d.RequestId, Response: response, ResponseOptionIndex: options.indexOf(response), Agent: { Id: agent } }));
  post('/trial', { TrialIndex: d.TrialIndex, Response: response, Agent: agent });
}

const seen = new Set();
window.addEventListener('studyflow:AwaitingResponse', (e) => {
  const d = e.detail;
  if (!d || !Array.isArray(d.ResponseOptions) || d.ResponseOptions.length === 0 || seen.has(d.RequestId)) return;
  seen.add(d.RequestId);
  answer(d);
});
window.addEventListener('studyflow:Event', (e) => post('/event', e.detail));
window.addEventListener('studyflow:TaskCompleted', (e) => {
  const d = e.detail;
  if (!d || d.TaskId !== STAGE.scene || (STAGE.timeline && d.TimelineId && d.TimelineId !== STAGE.timeline)) return;
  if (STAGE.source !== 'internal') notifyBridge({ type: 'completed', TaskId: d.TaskId });
  status.hidden = false;
  status.textContent = d.IsCompleted ? 'Task complete — you can close this tab.' : 'The task stopped before the end.';
  post('/completed', d);
});
</script>
"""


def stage_page(payload: dict[str, Any]) -> bytes:
    unity_payload = {**payload, "bot": bot_for_unity(payload.get("bot"))}
    if unity_payload["bot"] is None:
        del unity_payload["bot"]
    title = f"{payload['scene']} / {payload.get('timeline') or 'default timeline'}"
    page = (STAGE_HTML.replace("__TITLE__", title).replace("__MOUNT__", BUILD_MOUNT)
            .replace("__PAYLOAD__", json.dumps(unity_payload)).replace("__STAGE__", json.dumps(stage_config(payload))))
    return page.encode()


class Stage(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, build: Path, page: bytes, events: Path) -> None:
        super().__init__(("127.0.0.1", port), StageHandler)
        self.build = build.resolve()
        self.page = page
        self.events = events
        self.trials = 0
        self.completion: dict[str, Any] = {}
        self.done = threading.Event()
        self.lock = threading.Lock()


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
        if self.path == "/event":
            with server.lock:
                with server.events.open("a") as file:
                    file.write(json.dumps(body, separators=(",", ":")) + "\n")
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
        [binary, f"--app={url}", f"--user-data-dir={profile}", "--start-fullscreen", "--no-first-run",
         "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def profile_of(browser: subprocess.Popen) -> str:
    return next(arg.split("=", 1)[1] for arg in browser.args if str(arg).startswith("--user-data-dir="))


def build_dir(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit
    if os.environ.get("UNITY_BUILD_PATH"):
        return Path(os.environ["UNITY_BUILD_PATH"])
    return Path(__file__).resolve().parents[1] / "run" / "assessment-unity" / "Build" / "WebGL"


def checked_build(explicit: Path | None) -> Path:
    build = build_dir(explicit)
    if not (build / "index.html").is_file():
        raise FileNotFoundError(f"no Unity WebGL build at {build} — set UNITY_BUILD_PATH (or --build) to the Build/WebGL folder")
    return build


def perform(element: dict[str, Any], args: argparse.Namespace, plan: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """One task: serve, open, wait for the completion; the keys a hand-off merges into the state."""
    payload = task_payload(element, auto=args.auto, plan=plan)
    build = checked_build(args.build)
    cache = args.cache or Path(".")
    # The run directory, not its `.cache`: studyflow-run-local sweeps the cache when the run ends.
    run_dir = cache.parent if cache.name == ".cache" else cache
    run_dir.mkdir(parents=True, exist_ok=True)
    events = run_dir / events_uri(element, plan)
    events.parent.mkdir(parents=True, exist_ok=True)
    events.unlink(missing_ok=True)
    stage = Stage(args.port, build, stage_page(payload), events)
    threading.Thread(target=stage.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{stage.server_port}/"
    config = stage_config(payload)
    print(f"□ {element.get('name') or element['id']}: {payload['scene']} / {payload.get('timeline') or 'default timeline'} "
          f"({payload['agentType']}) — {url}", flush=True)
    if config["source"] != "internal":
        note = " (no model proxy here: the bridge answers, else random)" if config["source"] == "llm" else ""
        print(f"    trials go to the response bridge at {config['bridge']}{note}", flush=True)
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
            raise KeyError(f"no BehaverseTask {args.element!r} in the diagram")
        result = perform(element, args, elements)
    except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
        result = {"error": f"{type(error).__name__}: {error}"}
    cache.mkdir(parents=True, exist_ok=True)
    # Its own result under its id too, so a later step can cite it (`{Play.trials}`).
    captured = {args.element: result["result"]} if "result" in result else {}
    handoff.write_text(json.dumps({**state, **captured, **result}, default=str))
    return 1 if "error" in result else 0


if __name__ == "__main__":
    sys.exit(main())

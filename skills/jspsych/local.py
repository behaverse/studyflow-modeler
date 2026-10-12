#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml>=6.0"]
# ///
"""Play the jsPsych steps of a studyflow in a local run, every trial answered by the study's actor.

Usage:
    studyflow run <diagram> --runtime local   # the local runtime walks, this runner plays each jspsych:// step

A partial runner (packages/runtime-local/CONTRACT.md): it claims every step whose `implementation` is
`jspsych://<plugin>@<version>`, and per hand-off serves a stage page (`stage.html`) and the jsPsych builds from a local
port and opens the page in a headless Chromium, where jsPsych plays the step's timeline in its data-only simulation
mode. The page asks this process for each trial's response: the trial goes along the task's message flow to the actor
and the answer comes back (CONTRACT.md, "Messages"), through the runner SDK's exchange (`exchange.py`, which also says
where the records go and stamps them), so a study's jsPsych and Behaverse tasks have one actor, one trial schema and
one shape of result. What a trial is to the actor and to the record is `trials.py`, beside this file.

The builds come from the `node_modules` folder `--modules` names (by default `$JSPSYCH_MODULES`, else this checkout's
own) when it holds them at the reference's versions, else from unpkg, as in the browser runtime.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import trials  # beside this file: a jsPsych trial as the actor is sent it and as the run records it

sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[2] / "packages" / "runtime-local" / "python"))
from runner import Cancelled, Step, serve  # noqa: E402 - the runner SDK, beside the local runtime
import chromium  # noqa: E402 - the SDK's Chromium, headless here
from exchange import Exchange, data_inputs, exchange_flows, message_partners, opened_this_run, record_context, records_uri  # noqa: E402 - the SDK's exchange and records

SCHEME = "jspsych://"
# The messages a trial goes out as and its response comes back as, a message flow's `structureRef`.
STRUCTURES = ("cognitive:Trial", "cognitive:Response")
REPO = Path(__file__).resolve().parents[2]  # skills/jspsych/local.py
PAGE = Path(__file__).with_name("stage.html")
# Seconds a browser has to fetch the stage once it is opened: past that, it never will.
LOAD_TIMEOUT = 60.0


def implementation_of(element: dict[str, Any]) -> str:
    """The step's `implementation`: its own, or its extension's, as a `cognitive:CognitiveTask` holds it."""
    held = [(element.get("attributes") or {}).get("implementation"),
            *((ext.get("attributes") or {}).get("implementation") for ext in element.get("extensions") or [])]
    return str(next((ref for ref in held if ref), ""))


def claimed_steps(plan: dict[str, Any]) -> list[str]:
    """The steps this runner plays: every one whose `implementation` is a `jspsych://` reference, each read here, so
    one it cannot play stops the run before the walk starts."""
    claimed = []
    for element_id, element in (plan.get("elements") or {}).items():
        reference = implementation_of(element)
        if element.get("type") == "participant" or not reference.startswith(SCHEME):
            continue
        try:
            trials.builds_of(reference)
        except ValueError as error:
            raise ValueError(f"{element_id}: {error}") from None
        claimed.append(element_id)
    return claimed


def modules_of(explicit: Path | None) -> Path:
    """The `node_modules` folder a build is looked for in: `--modules`, `$JSPSYCH_MODULES`, else this checkout's."""
    if explicit is not None:
        return explicit
    return Path(os.environ["JSPSYCH_MODULES"]) if os.environ.get("JSPSYCH_MODULES") else REPO / "node_modules"


def local_build(build: dict[str, str], modules: Path) -> Path | None:
    """The build's file in `modules`, when the package there is at the version the reference names (`8` takes any 8.x,
    `8.3` any 8.3.x); None, and unpkg serves it, otherwise."""
    folder = modules / build["package"]
    try:
        installed = str(json.loads((folder / "package.json").read_text(encoding="utf-8"))["version"])
    except (OSError, ValueError, KeyError):
        return None
    wanted = build["version"].split(".")
    file = folder / build["file"]
    return file if installed.split(".")[:len(wanted)] == wanted and file.is_file() else None


class Session:
    """One timeline played: each trial the page asks about goes to the actor, and the data jsPsych records for it become
    the trial's record, appended to the task's file. `external` is the seconds the task settings give the actor for
    every trial (`trials.external_deadline`), None when they give none."""

    def __init__(self, step: Step, exchange: Exchange, options: dict[str, str] | None, context: dict[str, Any], events: Path,
                 external: float | None = None) -> None:
        self.step, self.exchange, self.options, self.context, self.events = step, exchange, options, context, events
        self.external = external
        self.asked: dict[Any, dict[str, Any]] = {}  # the trials sent, by the page's index, until their data come
        self.records: list[dict[str, Any]] = []
        self.block: Any = None
        self.blocks = 0   # the blocks played, from 1: a block is a run of trials of one `block`
        self.index = -1   # the trial's place in its block, from 0
        self.trial = 0    # the trials sent, from 1

    def respond(self, body: dict[str, Any]) -> dict[str, Any]:
        """The response jsPsych is to record for the trial the page asks about: the actor's, when the trial offers it
        options (`trials.offered`), within the deadline it is sent (`trials.deadline_of`), else none. What the trial is
        (its block, condition, right answer, task) stays here, with the actor's latency, which the record keeps."""
        parameters = body.get("parameters") or {}
        variables = body.get("variables") or {}
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        options = trials.offered(parameters.get("choices"), bool(body.get("keys")), self.options)
        if not options:
            return {"response": None, "rt": None}
        block = trials.field("block", variables, data)
        if self.blocks == 0 or block != self.block:
            self.block, self.blocks, self.index = block, self.blocks + 1, -1
        self.index += 1
        self.trial += 1
        # The subject's own request id, as the simulated build counts one: a simulated participant draws by it.
        request = f"{self.step.id}.{self.context['subject']}.{self.blocks}.{self.index}"
        deadline = trials.deadline_of(parameters, self.external)
        sent = time.monotonic()
        label = self.exchange.ask(trials.message_of(self.index, parameters, options, deadline), request, list(options), deadline)
        latency = (time.monotonic() - sent) * 1000
        self.asked[body.get("index")] = {
            "task": trials.field("task", variables, data) or self.step.id, "block": block, "blockId": self.blocks,
            "trialId": self.trial, "index": self.index, "condition": trials.field("condition", variables, data),
            "correct": trials.field("correct_response", variables, data), "options": options, "latency": latency,
        }
        # With the settings' deadline, an answer later than the trial's window reaches jsPsych at the window's end.
        return trials.answer_of(label, options, latency, parameters.get("trial_duration") if self.external else None)

    def recorded(self, body: dict[str, Any]) -> None:
        """The data jsPsych recorded for a trial the actor was asked: the trial's record. A trial that offered nothing
        stays in jsPsych's data alone, and so does any after the walk stopped the step."""
        trial = self.asked.pop(body.get("index"), None)
        if trial is None or self.step.cancelled:
            return
        record = trials.record_of(trial, body.get("row") or {}, self.context)
        self.records.append(record)
        with self.events.open("a") as file:
            file.write(json.dumps(record, separators=(",", ":")) + "\n")


def counts(records: list[dict[str, Any]]) -> dict[str, Any]:
    """What the task's trials came to: `trials`, those answered, and `blocks`, block by block in the order played,
    `{block, trials, answered, unanswered, correct}`, the block's name and how many of its trials the actor was sent,
    answered, left unanswered and got right (null once a trial of it has no right answer). A Behaverse task's result
    has the same shape, so a study reads both alike. Data, not policy: which blocks count, and what a study does about
    them, it writes in FEEL over this list (`sum(result.blocks[block in scored_blocks].unanswered)`)."""
    blocks: dict[Any, dict[str, Any]] = {}
    for record in records:
        name, result = record["trialContext"]["block"]["name"], record["result"]
        block = blocks.setdefault(name, {"block": name, "trials": 0, "answered": 0, "unanswered": 0, "correct": 0})
        block["trials"] += 1
        block["answered" if result["isAnswered"] else "unanswered"] += 1
        if block["correct"] is not None:
            block["correct"] = None if result["isCorrect"] is None else block["correct"] + bool(result["isCorrect"])
    return {"trials": sum(record["result"]["isAnswered"] for record in records), "blocks": list(blocks.values())}


def stage_page(title: str, stage: dict[str, Any], sources: list[str]) -> bytes:
    """The stage, its STAGE and its two builds filled in; the JSON can hold no `</script>`."""
    script = json.dumps(stage).replace("</", "<\\/")
    return (PAGE.read_text(encoding="utf-8").replace("__TITLE__", html.escape(title))
            .replace("__CORE__", html.escape(sources[0])).replace("__PLUGIN__", html.escape(sources[1]))
            .replace("__STAGE__", script)).encode()


class Stage(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int, page: bytes, files: dict[str, Path], session: Session) -> None:
        super().__init__(("127.0.0.1", port), StageHandler)
        self.page, self.files, self.session = page, files, session
        self.loaded = threading.Event()  # a browser fetched the page
        self.done = threading.Event()    # the timeline ended, or the page stopped
        self.failure = ""
        self.versions: dict[str, Any] = {}
        self.lock = threading.Lock()


class StageHandler(BaseHTTPRequestHandler):
    server: Stage

    def log_message(self, *_: Any) -> None:  # the run log is for the run, not the access log
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
            self.server.loaded.set()
            return self.reply(200, self.server.page, "text/html; charset=utf-8")
        file = self.server.files.get(path)  # the two builds alone, from the folder the runner was given
        if file is None:
            return self.reply(404, b"not found")
        self.reply(200, file.read_bytes(), "text/javascript; charset=utf-8")

    def do_POST(self) -> None:  # noqa: N802 - the http.server contract
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.reply(400, b"invalid JSON")
        if not isinstance(body, dict):
            return self.reply(400, b"not an object")
        server = self.server
        if self.path == "/respond":
            with server.lock:  # one trial at a time
                answer = server.session.respond(body)
            return self.reply(200, json.dumps(answer).encode(), "application/json")
        if self.path == "/data":
            with server.lock:
                server.session.recorded(body)
        elif self.path == "/started":
            server.versions = body
        elif self.path in ("/finished", "/failed"):
            server.failure = str(body.get("message") or "the page stopped") if self.path == "/failed" else ""
            server.done.set()
        else:
            return self.reply(404, b"not found")
        self.reply(204)


def headless_argv(binary: str, url: str, profile: str) -> list[str]:
    """The browser's command line: no window, a throwaway profile, and none of the throttling a page nobody looks at
    would otherwise get."""
    return [binary, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
            *chromium.UNTHROTTLED, url]


def open_stage(url: str) -> subprocess.Popen | None:
    """The stage in a headless Chromium (`chromium.find`); without one, in a tab of the default browser, which any
    browser jsPsych runs in can play."""
    binary = chromium.find()
    if binary is None:
        webbrowser.open(url)
        return None
    profile = tempfile.mkdtemp(prefix="studyflow-jspsych-stage-")
    return subprocess.Popen(  # noqa: S603 - a browser we picked, opening a page we serve
        headless_argv(binary, url, profile), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def perform(step: Step, args: argparse.Namespace) -> dict[str, Any]:
    """One step: its timeline, every trial answered along its message flows; its result is what its trials came to."""
    element, plan, state = step.element, step.elements, step.values
    builds = trials.builds_of(implementation_of(element))
    parameters = dict(element.get("parameters") or {})
    options = trials.response_options(parameters, element["id"])
    external = trials.external_deadline(parameters, element["id"])
    flows = exchange_flows(element, plan, STRUCTURES)
    if flows is None:
        raise ValueError(f"{element['id']} plays jsPsych trials, which a local run sends along message flows: draw one "
                         "carrying each trial out of the task and one bringing the answer back (a person plays it in the "
                         "browser runtime)")
    partner = ", ".join((plan.get(p) or {}).get("name") or p for p in message_partners(element, plan, STRUCTURES))
    exchange = Exchange(step, flows[0], partner, data_inputs(element, state, plan))
    context = record_context(element, plan, state)

    played = trials.played(parameters)
    # jsPsych draws (an order, a sample) from the study's seed, the step and the subject: a re-run draws them again.
    seed = f"{step.seed}:{step.id}:{context['subject']}"
    stage = {"plugin": builds["plugin"], "global": builds["global"], "timeline": trials.timeline_of(builds["global"], played),
             "variables": trials.variable_names(played), "seed": seed}
    modules = modules_of(args.modules)
    files: dict[str, Path] = {}
    sources = []
    for build in (builds["core"], builds["script"]):
        local = local_build(build, modules)
        route = f"/modules/{build['package']}/{build['file']}"
        if local is not None:
            files[route] = local
        sources.append(route if local is not None else trials.unpkg(build))

    # The run directory, not its `.cache`: the local runtime sweeps the cache when the run ends.
    step.run_dir.mkdir(parents=True, exist_ok=True)
    events = step.run_dir / records_uri(element, plan)
    events.parent.mkdir(parents=True, exist_ok=True)
    if not opened_this_run(step.cache, events):
        events.unlink(missing_ok=True)
    session = Session(step, exchange, options, context, events, external)
    server = Stage(args.port, stage_page(element.get("name") or element["id"], stage, sources), files, session)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/"
    given = f", {external:g} s to answer it (the task settings)" if external else ""
    print(f"□ {element.get('name') or element['id']}: jsPsych {builds['version']}, {builds['plugin']}; each trial goes along "
          f"{exchange.flow} to {partner}{given} — {url}", flush=True)
    browser = None if args.no_browser else open_stage(url)
    opened = time.monotonic()
    try:
        while not server.done.wait(0.1):
            waited = time.monotonic() - opened
            if step.cancelled:
                raise Cancelled(f"{step.id} was stopped")
            if args.timeout and waited > args.timeout:
                raise TimeoutError(f"the timeline did not end within {args.timeout}s")
            if browser is not None and browser.poll() is not None:
                raise RuntimeError("the headless browser exited before the timeline ended")
            if not args.no_browser and not server.loaded.is_set() and waited > LOAD_TIMEOUT:
                raise RuntimeError(f"no browser opened the stage within {LOAD_TIMEOUT:.0f}s ({url})")
    except BaseException:
        # Stopped or failed: the walk hears at once, and the browser closes behind the answer.
        threading.Thread(target=chromium.close, args=(server, browser)).start()
        raise
    chromium.close(server, browser)
    if server.failure:
        raise RuntimeError(f"jsPsych stopped: {server.failure}")
    # What played: jsPsych's and the plugin's versions as the builds report them (unpkg serves the latest of a major), where
    # they came from, and the seed of jsPsych's draws.
    step.note(jspsych={"version": server.versions.get("jspsych"), "plugin": f"{builds['plugin']}@{server.versions.get('plugin')}",
                       "builds": sources, "seed": seed})
    result = {**counts(session.records), "events": str(events)}
    print(f"    {len(session.records)} trials, {result['trials']} answered", flush=True)
    return result  # under the step's id, which its data edges read as `result` (`result.blocks`)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--modules", type=Path, default=None, metavar="DIR",
                        help="a node_modules folder holding jspsych and its plugins (default: $JSPSYCH_MODULES, else this checkout's)")
    parser.add_argument("--port", type=int, default=0, help="serve the stage on this port (default: a free one)")
    parser.add_argument("--timeout", type=float, default=0, help="give up on a timeline after this many seconds (default: wait)")
    parser.add_argument("--no-browser", action="store_true", help="print the stage URL instead of opening it")
    args = parser.parse_args()
    return serve(claimed_steps, lambda step: perform(step, args))


if __name__ == "__main__":
    sys.exit(main())

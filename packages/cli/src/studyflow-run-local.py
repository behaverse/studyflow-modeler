#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""A reference runner for the studyflow execution contract.

It keeps one claim honest: a studyflow is executable as it stands, with no
companion script telling an engine what the boxes mean. See README.md for the
contract this implements and the terms it writes.

    uv run studyflow-run-local.py ../../assets/examples/sklearn_pipeline.studyflow.png

This is the core: the walk, the values, the records, and the
partial-runner hand-offs (`studyflow-<name>` siblings claim and execute their
elements — `python://` ones belong to `studyflow-python.py`).
`studyflow-prov.py` beside it adds the run repository, the records, and the
prov timeline; without it a run executes bare.

A run writes a run directory — `runs/<id>/` (YYMMDD plus a codename, e.g. `runs/260821heron/`), or the one the diagram handed
to it already lives in: the artifacts the `uri`s name, a copy of the studyflow
stamped `executed` (the copy carries its own run record), and `studyflow.log`;
the detailed step records live in the run repository's commit bodies. Expressions run in the evaluating engine's own
language (Python here, JavaScript in the browser runner) unless BPMN's per-expression
`language` attribute says otherwise. The walk is one token: no parallel
gateways, no multi-instance fan-out.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import random
import re
import shlex
import shutil
import struct
import subprocess
import sys
import time
import zlib
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"


def studyflow_attr(element: ET.Element, name: str) -> str | None:
    return element.get(f"{{{STUDYFLOW}}}{name}")


def studyflow_child(element: ET.Element, name: str) -> ET.Element | None:
    return element.find(f"{{{STUDYFLOW}}}{name}")


# `property` included: a property without a `uri` passes in memory; with one it persists like any artifact.
DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore", "property"}
END_TAGS = {"endEvent"}
GATEWAY_TAGS = {
    "exclusiveGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway",
}
CONTAINER_TAGS = {"subProcess", "adHocSubProcess", "transaction"}
PASSTHROUGH_TAGS = {"startEvent", "intermediateCatchEvent", "intermediateThrowEvent"}


def local(element: ET.Element) -> str:
    return element.tag.split("}")[-1]


def bpmn_type(element: ET.Element) -> str:
    tag = local(element)
    return f"bpmn:{tag[:1].upper()}{tag[1:]}"


LOG = logging.getLogger("studyflow")


class RunLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        moment = datetime.fromtimestamp(record.created, timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        event = getattr(record, "event", "message")
        message = f"{getattr(record, 'indent', '')}{record.getMessage()}"
        # 29 = len("conditionExpression.evaluated"), so every message starts in the same column.
        line = f"{moment} {record.levelname:<5} {event:<29} {message}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return f"{getattr(record, 'indent', '')}{record.getMessage()}"


QUIET = False


def start_logging(directory: Path, quiet: bool) -> Path:
    global QUIET
    QUIET = quiet
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "studyflow.log"

    LOG.setLevel(logging.DEBUG)
    LOG.propagate = False
    for handler in list(LOG.handlers):
        LOG.removeHandler(handler)
        handler.close()

    # mode="w": the log covers this run only, earlier ones are recovered from the repository's history.
    to_file = logging.FileHandler(path, mode="w", encoding="utf-8")
    to_file.setFormatter(RunLogFormatter())
    LOG.addHandler(to_file)

    if not quiet:
        to_console = logging.StreamHandler(sys.stdout)
        to_console.setFormatter(ConsoleFormatter())
        to_console.setLevel(logging.INFO)
        LOG.addHandler(to_console)

    return path


def log_event(
    event: str,
    message: str,
    *,
    level: int = logging.INFO,
    indent: str = "",
    exc_info: BaseException | None = None,
) -> None:
    LOG.log(level, message, exc_info=exc_info, extra={"event": event, "indent": indent})


class TeeStream:
    def __init__(self, original: Any, passthrough: bool) -> None:
        self.original = original
        self.passthrough = passthrough
        self.pieces: list[str] = []

    def write(self, text: str) -> int:
        if self.passthrough:
            self.original.write(text)
        self.pieces.append(text)
        return len(text)

    def flush(self) -> None:
        if self.passthrough:
            self.original.flush()


@contextmanager
def captured_output(indent: str = ""):
    """Captured lines land as DEBUG, so the INFO console handler never prints them a second time."""
    out = TeeStream(sys.stdout, passthrough=not QUIET)
    err = TeeStream(sys.stderr, passthrough=not QUIET)
    try:
        with redirect_stdout(out), redirect_stderr(err):
            yield
    finally:
        for event, stream in (("stdout", out), ("stderr", err)):
            for line in "".join(stream.pieces).splitlines():
                if line.strip():
                    log_event(event, f"    {line}", level=logging.DEBUG, indent=indent)


def human_bytes(count: int) -> str:
    size = float(count)
    for unit in ("B", "KB", "MB"):
        if size < 1024 or unit == "MB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"



def studyflow_from_png(path: Path) -> str:
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
                    # flag, method, then language and translated keyword, NUL-terminated.
                    rest = rest[2:].split(b"\x00", 2)[2]
                    return zlib.decompress(rest).decode() if compressed else rest.decode()
                return rest.decode()
        offset += 12 + length
    raise ValueError(f"{path} carries no studyflow payload")


def embed_studyflow_into_png(data: bytes, xml: str) -> bytes:
    """Mirrors the modeler's `pngEmbedding.ts`: drop text chunks keyed `studyflow`, splice before IEND."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("not a PNG")
    # iTXt: keyword NUL, flag+method (0 0 = uncompressed), empty language NUL, empty keyword NUL, text.
    payload = b"studyflow\x00\x00\x00\x00\x00" + xml.encode()
    chunk = (
        struct.pack(">I", len(payload)) + b"iTXt" + payload
        + struct.pack(">I", zlib.crc32(b"iTXt" + payload) & 0xFFFFFFFF)
    )
    out = bytearray(data[:8])
    offset = 8
    while offset + 8 <= len(data):
        (length,) = struct.unpack(">I", data[offset:offset + 4])
        kind = data[offset + 4:offset + 8]
        body = data[offset + 8:offset + 8 + length]
        keyword = body.partition(b"\x00")[0] if kind in (b"iTXt", b"tEXt", b"zTXt") else None
        if kind == b"IEND":
            out += chunk
        if keyword != b"studyflow":
            out += data[offset:offset + 12 + length]
        offset += 12 + length
    return bytes(out)


def timeline_timestamp(moment: datetime) -> str:
    """ISO 8601, millisecond precision, local numeric offset — fine enough that the timeline's order
    is the log's order. Older files carry coarser second-precision and `Z` stamps."""
    return moment.astimezone().isoformat(timespec="milliseconds")


# Short words for a run id's codename tail, drawn from the run's exact start moment.
ANIMALS = (
    "cat", "dog", "bee", "crab", "deer", "dove", "elk", "finch", "fox", 
    "ibis", "lark", "lynx", "mole", "moth", "otter", "owl", "seal", "sparrow", 
    "swan", "trout", "shark", "tiger", "toad", "tuna", "viper",
    "whale", "wolf", "zebra", "jellyfish", "kangaroo", "lemur", "monkey", "octopus"
)


def run_stamp(moment: datetime) -> str:
    """Sortable, human-trackable id — YYMMDD plus a codename the start moment draws
    (e.g. 260821heron): a default repo's name and a new branch read the same."""
    utc = moment.astimezone(timezone.utc)
    return f"{utc.strftime('%y%m%d')}{ANIMALS[int(utc.timestamp() * 1000) % 32]}"






def condition_text(flows: list[ET.Element]) -> str:
    return " ".join((c.text or "") for f in flows for c in f if local(c) == "conditionExpression")


def output_targets(element: ET.Element) -> list[str]:
    targets: list[str] = []
    for association in element:
        if local(association) != "dataOutputAssociation":
            continue
        target_ref = next((c for c in association if local(c) == "targetRef"), None)
        target_id = (target_ref.text or "").strip() if target_ref is not None else ""
        if target_id:
            targets.append(target_id)
    return targets


def read_studyflow(path: Path, stamp: dict[str, str] | None = None) -> Studyflow:
    xml = studyflow_from_png(path) if path.suffix.lower() == ".png" else path.read_text()
    if stamp and PROV is not None:
        probe = Studyflow(ET.fromstring(xml))
        xml = PROV.insert_element_entry(xml, probe.process.get("id") or "", **stamp)
    return Studyflow(ET.fromstring(xml), plan=xml)


class Studyflow:
    def __init__(self, definitions: ET.Element, plan: str = "") -> None:
        self.definitions = definitions
        self.plan = plan
        self.process = self._find_process()

        self.elements: dict[str, ET.Element] = {}
        self.outgoing: dict[str, list[ET.Element]] = {}

        def index(container: ET.Element) -> None:
            for element in container:
                if element.get("id"):
                    self.elements[element.get("id")] = element
                if local(element) == "sequenceFlow":
                    self.outgoing.setdefault(element.get("sourceRef"), []).append(element)
                if local(element) in CONTAINER_TAGS:
                    index(element)

        index(self.process)

        self.names: dict[str, str] = {}
        for element_id, element in self.elements.items():
            name = element.get("name")
            if name and re.fullmatch(r"[A-Za-z_]\w*", name):
                self.names[element_id] = name

        self._consumers: tuple[set[str], str] | None = None
        self._products: set[str] | None = None

    def _find_process(self) -> ET.Element:
        for element in self.definitions:
            if local(element) == "process" and any(local(c) == "sequenceFlow" for c in element):
                return element
        raise ValueError("no process with a sequence flow to walk")


    def activity_dependencies(self, element: ET.Element) -> tuple[set[str], str]:
        sources: set[str] = set()
        texts: list[str] = []
        for association in element:
            if local(association) != "dataInputAssociation":
                continue
            for child in association:
                if local(child) == "sourceRef" and child.text:
                    sources.add(child.text.strip())
                if local(child) == "transformation" and child.text:
                    texts.append(child.text)
        declared = studyflow_child(element, "additionalArguments")
        if declared is not None and declared.text:
            texts.append(declared.text)
            sources.update(re.findall(r"\$([A-Za-z_]\w*)", declared.text))
        return sources, " ".join(texts)

    def mentions(self, text: str, element_id: str) -> bool:
        """The one staleness rule: a text touches an element when it names its id or its bound name."""
        name = self.names.get(element_id)
        return element_id in text or bool(name and name in text)

    def is_product(self, element_id: str) -> bool:
        if self._products is None:
            products: set[str] = set()
            for node in self.definitions.iter():
                if local(node) == "dataOutputAssociation":
                    for child in node:
                        if local(child) == "targetRef" and child.text:
                            products.add(child.text.strip())
            self._products = products
        return element_id in self._products

    def consumes(self, element_id: str) -> bool:
        """Textual by id and name, deliberately over-broad: a false positive costs a load, never a wrong skip."""
        if self._consumers is None:
            sources: set[str] = set()
            texts: list[str] = []
            for node in self.definitions.iter():
                tag = local(node)
                if tag == "dataInputAssociation":
                    for child in node:
                        if local(child) == "sourceRef" and child.text:
                            sources.add(child.text.strip())
                elif tag in ("transformation", "conditionExpression", "additionalArguments"):
                    if node.text:
                        texts.append(node.text)
            self._consumers = (sources, " ".join(texts))
        sources, expressions = self._consumers
        if element_id in sources or element_id in expressions:
            return True
        name = self.names.get(element_id)
        return bool(name and name in expressions)

    def start_event(self, container: ET.Element | None = None) -> ET.Element:
        for element in container if container is not None else self.process:
            if local(element) == "startEvent":
                return element
        raise ValueError(f"no start event in {(container or self.process).get('id')}")

    def artifact(self, element_id: str) -> tuple[str | None, str | None]:
        element = self.elements.get(element_id)
        if element is None or local(element) not in DATA_ELEMENT_TAGS:
            return None, None
        fmt = next(
            (v for k, v in element.attrib.items() if k.split("}")[-1] == "format"),
            None,
        )
        return studyflow_attr(element, "uri"), fmt

    def name_of(self, element_id: str) -> str:
        element = self.elements.get(element_id)
        return (element.get("name") if element is not None else None) or element_id






class State:
    """Readable by expressions as `state`, so a drawn cycle can bound itself: `state.trace.count('Gate') < 8`."""

    def __init__(self) -> None:
        self.trace: list[str] = []


def plain(value: Any) -> Any:
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        return value.item()
    return value



def shown(path: Path) -> Path:
    """Paths are printed as the reader typed them: relative to where the run was started."""
    here = Path.cwd()
    return path.relative_to(here) if path.is_relative_to(here) else path


def write_plan_copy(source: Path, target: Path, xml: str) -> None:
    """A PNG diagram keeps its picture and carries `xml` in a text chunk; anything else is the text."""
    if source.suffix.lower() == ".png":
        target.write_bytes(embed_studyflow_into_png(source.read_bytes(), xml))
    else:
        target.write_text(xml)


def load_prov():
    """The provenance module: `studyflow-prov.py` beside this script, or `STUDYFLOW_PROV_PY`."""
    import importlib.util

    override = os.environ.get("STUDYFLOW_PROV_PY")
    candidate = Path(override) if override else Path(__file__).with_name("studyflow-prov.py")
    if not candidate.exists():
        return None
    spec = importlib.util.spec_from_file_location("studyflow_prov", candidate)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.log_event = log_event
    module.shown = shown
    return module


PROV = load_prov()


class NoRecord:
    """Stands in when studyflow-prov is absent: the walk runs, nothing is recorded."""

    def __init__(self) -> None:
        self.plan_digest = ""
        self.seed = None
        self.started = datetime.now(timezone.utc)
        self.status = "ok"
        self.entries: list[dict] = []

    def begin(self, element_id: str, name: str, element_type: str) -> dict:
        return {"node": element_id, "status": "ok", "_clock": time.perf_counter()}

    def end(self, entry: dict) -> None:
        entry["durationMs"] = round((time.perf_counter() - entry.pop("_clock", time.perf_counter())) * 1000, 1)

    def fail(self, entry: dict, error: BaseException) -> None:
        entry["status"] = "error"
        self.status = "error"
        entry.pop("_clock", None)

    def finish(self, status: str) -> None:
        self.status = status

    def header(self) -> dict:
        return {}

    def summary(self) -> dict:
        return {"status": self.status}

    def steps_since(self, index: int) -> list[dict]:
        return []


class NoRepo:
    """Stands in when studyflow-prov is absent: the run directory stays a plain folder."""

    active = False
    created = True

    def open(self) -> None: ...

    def dirty(self) -> bool:
        return False

    def commit(self, *args: Any, **kwargs: Any) -> None: ...

    def branch(self, *args: Any, **kwargs: Any) -> bool:
        return False

    def current_branch(self) -> str:
        return ""


def discover_runners(runner_flags: list[str]) -> dict[str, str]:
    """Partial runners in reach, each named <name> and claiming its own elements: a `studyflow-<name>.py`
    beside this script, a `studyflow-<name>` on PATH, then `STUDYFLOW_<NAME>_PY` overrides."""
    flags = "".join(f" {flag}" for flag in runner_flags)
    found: dict[str, str] = {}
    for script in sorted(Path(__file__).resolve().parent.glob("studyflow-*.py")):
        name = script.stem.removeprefix("studyflow-").lower()
        if name not in ("run", "run-local", "prov"):
            found[name] = f"uv run --script {shlex.quote(str(script))}{flags}"
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        try:
            entries = os.listdir(directory or ".")
        except OSError:
            continue
        for entry in entries:
            if not entry.startswith("studyflow-") or "." in entry:
                continue
            name = entry.removeprefix("studyflow-").lower()
            if name not in ("run", "run-local", "prov") and os.access(os.path.join(directory, entry), os.X_OK):
                found[name] = shlex.quote(os.path.join(directory, entry)) + flags
    for key, value in os.environ.items():
        matched = re.fullmatch(r"STUDYFLOW_([A-Z0-9_]+)_PY", key)
        if matched:
            name = matched.group(1).lower().replace("_", "-")
            if name not in ("run", "run-local", "prov"):
                found[name] = f"uv run --script {shlex.quote(value)}{flags}"
    return found



class PartialRunner:
    """A partial runner as a subprocess per element: `COMMAND <diagram> --element <id> --cache <dir>`.
    It runs the elements it claims (`COMMAND <diagram> --claims` answers with their ids), whatever
    they are — a runner is element-specific, not schema-specific. One file per hand-off,
    `<id>.state.json` in the cache dir: the state (the run's values) goes in, and the updated
    state comes back with `result`, `durationMs`, and on failure `error` merged in — only one
    side touches it at a time. The runner's stdout is captured into the run log; stdin and
    stderr stay on the terminal for the person."""

    def __init__(self, name: str, command: str, plan: Path, repo_dir: Path, debug: bool = False) -> None:
        self.name = name
        self.command = command
        self.plan = plan
        self.repo_dir = repo_dir
        self.debug = debug

    def claims(self) -> list[str]:
        argv = [*shlex.split(self.command), str(self.plan), "--claims"]
        done = subprocess.run(argv, capture_output=True, text=True)  # noqa: S603 - an authored runner command
        lines = [line for line in (done.stdout or "").splitlines() if line.strip()]
        if done.returncode != 0 or not lines:
            detail = (done.stderr or "").strip().splitlines()
            raise SystemExit(f"{self.name} --claims failed: {detail[-1] if detail else f'exit {done.returncode}'}")
        return json.loads(lines[-1])

    def element(self, element_id: str, values: dict) -> dict:
        cache = self.repo_dir / ".cache"
        cache.mkdir(parents=True, exist_ok=True)
        handoff = cache / f"{element_id}.state.json"
        handoff.write_text(json.dumps(values, default=str))
        argv = [*shlex.split(self.command), str(self.plan), "--element", element_id, "--cache", str(cache)]
        done = subprocess.run(argv, stdout=subprocess.PIPE, text=True)  # noqa: S603 - an authored runner command
        for line in (done.stdout or "").splitlines():
            if line.strip():
                log_event("runner.stdout", f"    {line}", level=logging.DEBUG)
        state = json.loads(handoff.read_text()) if handoff.exists() else {}
        # Only the read state file goes; the cache dir survives the run (spilled values live there)
        # and finish() sweeps it at the end.
        if not self.debug:
            handoff.unlink(missing_ok=True)
        if done.returncode != 0 or state.get("error"):
            raise RuntimeError(f"{self.name}: {state.get('error') or f'exited with code {done.returncode}'}")
        return state


class Runner:
    def __init__(
        self,
        studyflow: Studyflow,
        repo_dir: Path,
        input_sources: list[Path] | None = None,
        started: datetime | None = None,
        seed: str | None = None,
        fresh: bool = False,
        repo: RunRepo | None = None,
        branched: bool = False,
        runners: dict[str, str] | None = None,
        plan_path: Path | None = None,
        debug: bool = False,
    ) -> None:
        self.studyflow = studyflow
        self.debug = debug
        # Partial runners claim elements, not schemas: each is asked once which ids it will run.
        self.runners = {
            name: PartialRunner(name, command, plan_path, repo_dir, debug=debug)
            for name, command in (runners or {}).items()
        } if plan_path is not None else {}
        self.claimed: dict[str, PartialRunner] = {}
        # Live elements are interaction: they never skip or replay. A claims answer that is a plain
        # array is live; `{"elements": [...], "live": false}` marks replayable ones (studyflow-python).
        self.live: set[str] = set()
        for runner in self.runners.values():
            answer = runner.claims()
            ids = answer if isinstance(answer, list) else (answer.get("elements") or [])
            live = isinstance(answer, list) or bool(answer.get("live", True))
            for element_id in ids:
                other = self.claimed.get(element_id)
                if other is not None and other is not runner:
                    raise SystemExit(
                        f"{element_id} is claimed by both the {other.name} and {runner.name} runners — "
                        "one element, one runner (drop one, or scope their claims apart)",
                    )
                self.claimed[element_id] = runner
                if live:
                    self.live.add(element_id)
        # Everything this run writes belongs to the repo; boundary inputs are looked up in `input_sources`.
        self.repo_dir = repo_dir
        self.input_sources = input_sources or [Path.cwd()]
        self.repo = repo
        self.branched = branched
        self.values: dict[str, Any] = {}
        self.state = State()
        self.depth = 0
        self._deferred: list[tuple[str, str, int, str]] | None = None
        self.prior_records = {} if fresh or PROV is None else PROV.element_records(studyflow)
        self.completed: dict[str, str] = {}
        self.reached: dict[str, str] = {}
        self.decisions: dict[str, tuple[str, str]] = {}
        self.produced: dict[str, str] = {}
        self.staged: dict[str, str] = {}
        self.reused: dict[str, tuple[str, str]] = {}
        self.tainted: set[str] = set()
        self.demanded: set[str] | None = None
        self.recorded = 0
        self.record = PROV.RunRecord(
            studyflow.plan,
            seed if seed is not None else studyflow_attr(studyflow.process, "seed"),
            started or datetime.now(timezone.utc),
            run=self.repo_dir.name,
            who=PROV.current_user(),
        ) if PROV is not None else NoRecord()

    @property
    def indent(self) -> str:
        return "  " * (self.depth + 1)

    def event(self, event: str, message: str, *, level: int = logging.INFO) -> None:
        if self._deferred is not None:
            self._deferred.append((event, message, level, self.indent))
            return
        log_event(event, message, level=level, indent=self.indent)

    @contextmanager
    def deferred_events(self):
        buffered: list[tuple[str, str, int, str]] = []
        self._deferred = buffered
        try:
            yield lambda: [
                log_event(event, message, level=level, indent=indent)
                for event, message, level, indent in buffered
            ]
        finally:
            self._deferred = None

    def moment(self) -> str:
        return timeline_timestamp(datetime.now(timezone.utc))

    def note_reuse(self, element_id: str, prior: dict, subject: str) -> None:
        """One skip: remember the record it trusted (for the `reused` line) and checkpoint it."""
        when = self.moment()
        self.reused[element_id] = (when, prior.get("when") or "")
        self.checkpoint(subject, when, {"Prov-Node": element_id})

    def checkpoint(self, subject: str, when: str, extra_trailers: dict[str, str] | None = None) -> None:
        """Record entries since the last checkpoint ride in the commit body — git is their only home."""
        if self.repo is None:
            return
        steps = self.record.steps_since(self.recorded)
        trailers = {"Prov-Run": self.repo_dir.name, "Prov-When": when, **(extra_trailers or {})}
        self.repo.commit(subject, trailers, when=when, body=json.dumps(steps, default=str) if steps else None)
        self.recorded = len(self.record.entries)

    def store(self, element_id: str, value: Any) -> None:
        self.values[element_id] = value

    def namespace(self) -> dict[str, Any]:
        space: dict[str, Any] = {"state": self.state}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.studyflow.names.get(element_id)
            if name:
                space[name] = value
        return space

    def evaluate(
        self,
        expression: str,
        extra: dict[str, Any] | None = None,
        language: str | None = None,
    ) -> Any:
        """`language` is BPMN's per-expression attribute; unset means Python here, anything else is refused."""
        if language and language.lower() not in ("py", "python"):
            raise ValueError(
                f"a {language} expression — this runner evaluates Python "
                "(the browser runner evaluates JavaScript)",
            )
        space = self.namespace()
        space.update(extra or {})
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - see module docstring

    def stage_input(self, element_id: str, uri: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        for directory in self.input_sources:
            source = directory / uri
            # A resumed plan lives in the repo, so the first source can name the very file being staged.
            if source == path or not source.exists():
                continue
            shutil.copyfile(source, path)
            if not self.studyflow.is_product(element_id):
                self.staged[element_id] = self.moment()
            self.event(
                "artifact.staged",
                f"    ▤ stage {uri}  {human_bytes(path.stat().st_size)}, from {shown(source)}",
            )
            return
        looked_in = ", ".join(str(directory) for directory in self.input_sources)
        raise FileNotFoundError(
            f"{uri} is in none of {looked_in}. {self.studyflow.name_of(element_id)} is a boundary "
            "input: no step of this studyflow produces it, so something outside has to "
            "put it there.",
        )

    def runner_for(self, element: ET.Element) -> PartialRunner | None:
        """The runner that claimed this element, if any."""
        return self.claimed.get(element.get("id") or "")

    def json_values(self) -> dict:
        """The JSON-able shadow of the run's values, for a partial runner's placeholders and intents."""
        shadow: dict[str, Any] = {}
        for element_id, value in self.values.items():
            try:
                json.dumps(plain(value))
            except (TypeError, ValueError):
                continue
            shadow[element_id] = plain(value)
        return shadow

    def stale_inputs(self, element: ET.Element) -> bool:
        if not self.tainted:
            return False
        sources, expressions = self.studyflow.activity_dependencies(element)
        if sources & self.tainted:
            return True
        for tainted_id in self.tainted:
            name = self.studyflow.names.get(tainted_id)
            if self.studyflow.mentions(expressions, tainted_id) or (name and name in sources):
                return True
        return False

    def plan_demand(self) -> set[str] | None:
        """Who has to run: taint spreads forward from what is gone; memory-only bindings pull backward."""
        if not self.prior_records:
            return None
        flow = self.studyflow
        produced: dict[str, str] = {}
        depends: dict[str, tuple[set[str], str]] = {}
        for element_id, element in flow.elements.items():
            for target in output_targets(element):
                produced[target] = element_id
            sources, expressions = flow.activity_dependencies(element)
            if sources or expressions:
                depends[element_id] = (sources, expressions)

        def eats(consumer: str, data_id: str) -> bool:
            sources, expressions = depends.get(consumer) or (set(), "")
            return data_id in sources or flow.mentions(expressions, data_id)

        # Roots re-run and taint: no surviving record, or a recorded artifact the worktree no longer has.
        tainting: set[str] = set()
        for element_id in depends.keys() | set(produced.values()):
            if element_id not in self.prior_records:
                tainting.add(element_id)
                continue
            for target in output_targets(flow.elements[element_id]):
                uri, _ = flow.artifact(target)
                if uri and not (self.repo_dir / uri).exists():
                    tainting.add(element_id)
                    break
        # Forward: a re-made output makes every recorded consumer stale, and stale re-runs taint on.
        queue = list(tainting)
        while queue:
            for target in output_targets(flow.elements[queue.pop()]):
                for consumer in depends:
                    if consumer not in tainting and eats(consumer, target):
                        tainting.add(consumer)
                        queue.append(consumer)
        # Only a gateway that will actually evaluate (no replayable decision, or a tainted condition)
        # needs the memory-only values its conditions read; a replayed gateway needs nothing bound.
        gateway_pull: set[str] = set()
        for element_id, element in flow.elements.items():
            if local(element) not in GATEWAY_TAGS:
                continue
            flows = flow.outgoing.get(element_id, [])
            conditions = condition_text(flows)
            if not conditions.strip():
                continue
            prior = self.prior_records.get(element_id)
            if prior and prior.get("what") and not self.stale_expressions(flows, tainting):
                continue
            gateway_pull.update(
                maker for data_id, maker in produced.items()
                if flow.artifact(data_id)[0] is None and flow.mentions(conditions, data_id)
            )
        # Backward: whoever binds a memory-only (or missing) input of a running element must run as well.
        demanded: set[str] = set()
        queue = list(tainting | gateway_pull)
        while queue:
            element_id = queue.pop()
            if element_id in demanded:
                continue
            demanded.add(element_id)
            for data_id, maker in produced.items():
                if maker in demanded or not eats(element_id, data_id):
                    continue
                uri, _ = flow.artifact(data_id)
                if uri is None or not (self.repo_dir / uri).exists():
                    queue.append(maker)
        return demanded

    def stale_expressions(self, flows: list[ET.Element], tainted: set[str] | None = None) -> bool:
        """A gateway is stale when a condition on any of its flows reads something re-made this run."""
        tainted = self.tainted if tainted is None else tainted
        text = condition_text(flows)
        return any(self.studyflow.mentions(text, tainted_id) for tainted_id in tainted)

    def skip_activity(self, element: ET.Element, element_id: str) -> str:
        """Verdicts: `skipped`, `volatile` (a memory-only output someone needs), `invalid` (artifact gone)."""
        targets: list[str] = []
        memory = False
        for target_id in output_targets(element):
            uri, _ = self.studyflow.artifact(target_id)
            if not uri:
                memory = True
            else:
                targets.append(target_id)
        # A memory-only output forces a re-run only when this run was analyzed to need the value.
        if memory and (self.demanded is None or element_id in self.demanded):
            return "volatile"
        # Consumers load values themselves (partial runners, per hand-off): existence is enough here.
        try:
            for target_id in targets:
                self.ensure_artifact(target_id)
        except BaseException:  # noqa: BLE001 - a failed staging means a real run
            return "invalid"
        return "skipped"

    def ensure_artifact(self, element_id: str) -> None:
        uri, _ = self.studyflow.artifact(element_id)
        path = self.repo_dir / uri
        if not path.exists():
            self.stage_input(element_id, uri, path)

    def end_entry(self, entry: dict) -> None:
        """Close the entry; a runner-reported duration replaces ours, which includes the subprocess spawn."""
        self.record.end(entry)
        runner_ms = entry.pop("_runnerMs", None)
        if runner_ms is not None:
            entry["durationMs"] = runner_ms

    def run_activity(self, element: ET.Element) -> None:
        element_id = element.get("id")
        prior = self.prior_records.get(element_id)
        prior_run = prior["run"] if prior else None
        stale = self.stale_inputs(element)
        replay = None
        verdict = None
        # A live element (an interactive runner's) never skips from a prior record.
        if prior and not stale and element_id not in self.live:
            with self.deferred_events() as replay:
                verdict = self.skip_activity(element, element_id)
            if verdict == "skipped":
                self.event("activity.skipped", f"↻ {element_id}  (outputs from run {prior_run})")
                replay()
                self.note_reuse(element_id, prior, f"skipped {element_id} (run {prior_run})")
                return
        name = self.studyflow.name_of(element_id)
        self.event("activity.started", f"□ {element_id}")
        if replay:
            replay()
        if stale and prior:
            self.event(
                "activity.invalidated",
                f"    run {prior_run}'s record superseded — an input was re-made this run",
            )
        entry = self.record.begin(element_id, name, bpmn_type(element))
        try:
            with captured_output(indent=self.indent):
                self.execute_activity(element, entry)
        except BaseException as error:
            self.record.fail(entry, error)
            entry.pop("_runnerMs", None)
            self.event(
                "activity.failed", f"    {element_id}: {type(error).__name__}: {error}",
                level=logging.ERROR,
            )
            self.checkpoint(f"failed {element_id}", self.moment(), {"Prov-Node": element_id})
            raise
        self.end_entry(entry)
        when = self.moment()
        self.completed[element_id] = when
        # Taint what was re-made, so recorded consumers re-run too; a `volatile` re-run taints nothing.
        if stale or verdict == "invalid" or (prior is None and bool(self.prior_records)):
            self.tainted.add(element_id)
            self.tainted.update(output_targets(element))
        self.event(
            "activity.finished", f"    {element_id} done in {entry['durationMs']}ms",
            level=logging.DEBUG,
        )
        self.checkpoint(
            f"executed {element_id}", when,
            {"Prov-Action": "executed", "Prov-Node": element_id},
        )

    def execute_activity(self, element: ET.Element, entry: dict) -> None:
        implementation = element.get("implementation")
        if implementation:
            entry["implementation"] = implementation

        # A claimed element is its runner's whole job: this walk executes nothing itself.
        runner = self.runner_for(element)
        if runner is not None:
            return self.execute_via_runner(element, entry, runner)
        if implementation:
            raise RuntimeError(
                f"no partial runner claims {element.get('id')} ({implementation}) — "
                "python:// needs studyflow-python beside this script or on PATH",
            )
        self.event(
            "implementation.missing", "    (no implementation — nothing to call)",
            level=logging.WARNING,
        )

    def execute_via_runner(self, element: ET.Element, entry: dict, runner: PartialRunner) -> None:
        """One hand-off: state in, updated state out — what the runner bound or changed is adopted here."""
        element_id = element.get("id")
        entry["implementation"] = element.get("implementation") or f"runner://{runner.name}"
        self.event("runner.called", f"    → the {runner.name} runner takes this element")
        sent = self.json_values()
        reported = runner.element(element_id, sent)
        entry["_runnerMs"] = reported.get("durationMs")
        for key, value in reported.items():
            if key not in ("result", "durationMs", "error") and sent.get(key, ...) != value:
                self.store(key, value)
        targets = output_targets(element)
        if targets:
            entry["generated"] = targets
        for target_id in targets:
            uri, _ = self.studyflow.artifact(target_id)
            path = self.repo_dir / uri if uri else None
            if path is not None and path.exists():
                self.produced[target_id] = self.moment()
                self.event("artifact.saved", f"    ▤ save {uri}  {human_bytes(path.stat().st_size)}")

    def next_element(self, element: ET.Element) -> ET.Element | None:
        element_id = element.get("id")
        flows = self.studyflow.outgoing.get(element_id, [])
        if not flows:
            return None

        if local(element) in GATEWAY_TAGS:
            # A clean gateway replays its recorded decision — same inputs, same seed, same verdict.
            # A condition edit is invisible to staleness: ✕ the gateway or `--fresh` forces re-evaluation.
            # A gateway a live runner samples decides live, so its decision never replays.
            prior = None if element_id in self.live else self.prior_records.get(element_id)
            if prior and prior.get("what") and not self.stale_expressions(flows):
                flow = next((f for f in flows if f.get("id") == prior["what"]), None)
                if flow is not None:
                    self.event(
                        "gateway.replayed",
                        f"↻ {element_id} → {prior['what']}  (decision from run {prior['run']})",
                    )
                    self.note_reuse(element_id, prior, f"skipped {element_id} ({prior['what']}, run {prior['run']})")
                    return self.studyflow.elements.get(flow.get("targetRef"))
            entry = self.record.begin(element_id, self.studyflow.name_of(element_id), bpmn_type(element))
            default_id = element.get("default")
            bindings: dict[str, Any] = {}
            runner = self.runner_for(element)
            if runner is not None:
                # The partial runner samples what the conditions read (e.g. `face_count`).
                self.event("runner.called", f"    {runner.name} samples for {element_id}")
                sampled = runner.element(element_id, self.json_values())
                entry["_runnerMs"] = sampled.get("durationMs")
                bindings = sampled.get("result") or {}
                if bindings:
                    entry["bindings"] = bindings
            try:
                for flow in flows:
                    condition = next((c for c in flow if local(c) == "conditionExpression"), None)
                    if condition is None or not (condition.text or "").strip():
                        continue
                    expression = condition.text.strip()
                    language = condition.get("language")
                    verdict = self.evaluate(expression, bindings, language=language)
                    entry.setdefault("conditionExpressions", []).append({
                        "sequenceFlow": flow.get("id"),
                        "conditionExpression": expression,
                        "held": bool(verdict),
                    })
                    self.event(
                        "conditionExpression.evaluated",
                        f"    {expression} → {bool(verdict)}  [{flow.get('id')}]",
                        level=logging.DEBUG,
                    )
                    if verdict:
                        entry["taken"] = {"sequenceFlow": flow.get("id"), "name": flow.get("name")}
                        self.end_entry(entry)
                        when = self.moment()
                        self.decisions[element_id] = (flow.get("id"), when)
                        self.event(
                            "sequenceFlow.taken",
                            f"    {expression} → {flow.get('id')}",
                        )
                        self.checkpoint(
                            f"executed {element_id}: {flow.get('id')}", when,
                            {"Prov-Action": "executed", "Prov-Node": element_id, "Prov-What": flow.get("id")},
                        )
                        return self.studyflow.elements.get(flow.get("targetRef"))
            except BaseException as error:
                self.record.fail(entry, error)
                entry.pop("_runnerMs", None)
                raise

            chosen = next((f for f in flows if f.get("id") == default_id), None)
            if chosen is None:
                entry["status"] = "stuck"
                self.end_entry(entry)
                self.record.status = "error"
                self.event(
                    "gateway.stuck",
                    f"    {element_id}: no conditionExpression held and no default flow",
                    level=logging.ERROR,
                )
                return None
            entry["taken"] = {
                "sequenceFlow": chosen.get("id"), "name": chosen.get("name"), "default": True,
            }
            self.end_entry(entry)
            when = self.moment()
            self.decisions[element_id] = (chosen.get("id"), when)
            self.event(
                "sequenceFlow.taken",
                f"    default → {chosen.get('id')}",
            )
            self.checkpoint(
                f"executed {element_id}: {chosen.get('id')}", when,
                {"Prov-Action": "executed", "Prov-Node": element_id, "Prov-What": chosen.get("id")},
            )
            return self.studyflow.elements.get(chosen.get("targetRef"))

        return self.studyflow.elements.get(flows[0].get("targetRef"))

    def debug_state(self, element_id: str) -> None:
        """--debug: every element leaves `<id>.state.json` in `.cache/`, the updated state with its
        `result` and `durationMs` merged in — the same shape a partial runner's hand-off file has."""
        if not self.debug:
            return
        state = self.json_values()
        entry = next((e for e in reversed(self.record.entries) if e.get("node") == element_id), None)
        if entry is not None:
            generated = entry.get("generated") or []
            taken = (entry.get("taken") or {}).get("sequenceFlow")
            result = self.values.get(element_id, self.values.get(generated[0]) if generated else taken)
            try:
                json.dumps(result, default=str)
                state["result"] = result
            except (TypeError, ValueError):
                pass
            if entry.get("durationMs") is not None:
                state["durationMs"] = entry["durationMs"]
        cache = self.repo_dir / ".cache"
        cache.mkdir(parents=True, exist_ok=True)
        (cache / f"{element_id}.state.json").write_text(json.dumps(state, default=str))

    def run(self, max_steps: int = 1000) -> None:
        self.demanded = self.plan_demand()
        process = self.studyflow.process
        name = process.get("name") or process.get("id")
        log_event("run.started", name)
        log_event(
            "run.started",
            f"  [{process.get('id')}]  studyflow {self.record.plan_digest}"
            f"  rootSeed {self.record.seed}  repo {self.repo_dir}",
            level=logging.DEBUG,
        )
        self.walk(self.studyflow.start_event(), max_steps=max_steps)

    def walk(self, element, depth: int = 0, max_steps: int = 1000) -> None:
        """A sub-process is walked one level in, but values are not scoped with it (BPMN §10.4.7)."""
        outer, self.depth = self.depth, depth
        try:
            steps = 0
            while element is not None:
                steps += 1
                if steps > max_steps:
                    raise RuntimeError("step budget exhausted — is the flow cycling without an exit?")
                self.depth = depth
                element_id = element.get("id")
                self.state.trace.append(element_id)
                tag = local(element)
                name = self.studyflow.name_of(element_id)

                if tag in END_TAGS:
                    self.record.end(self.record.begin(element_id, name, bpmn_type(element)))
                    self.reached[element_id] = self.moment()
                    self.event("event.reached", f"● {element_id}")
                    self.debug_state(element_id)
                    return
                if tag in GATEWAY_TAGS:
                    self.event("gateway.reached", f"◇ {element_id}")
                elif tag in CONTAINER_TAGS:
                    entry = self.record.begin(element_id, name, bpmn_type(element))
                    self.event("activity.started", f"⊞ {element_id}")
                    try:
                        self.walk(self.studyflow.start_event(element), depth + 1, max_steps)
                    except BaseException as error:
                        self.record.fail(entry, error)
                        raise
                    finally:
                        self.depth = depth
                    self.record.end(entry)
                    when = self.moment()
                    self.completed[element_id] = when
                    self.event(
                        "activity.finished", f"  {element_id} done in {entry['durationMs']}ms",
                        level=logging.DEBUG,
                    )
                    self.checkpoint(
                        f"executed {element_id}", when,
                        {"Prov-Action": "executed", "Prov-Node": element_id},
                    )
                elif tag in PASSTHROUGH_TAGS:
                    entry = self.record.begin(element_id, name, bpmn_type(element))
                    runner = self.runner_for(element) if tag == "intermediateCatchEvent" else None
                    if runner is not None:
                        # A catch event a partial runner executes blocks in its subprocess until sensed.
                        self.event("event.waiting", f"◐ {element_id}  (waiting via {runner.name})")
                        try:
                            sensed = runner.element(element_id, self.json_values())
                            entry["_runnerMs"] = sensed.get("durationMs")
                            self.store(element_id, sensed.get("result"))
                        except BaseException as error:
                            self.record.fail(entry, error)
                            entry.pop("_runnerMs", None)
                            raise
                    self.end_entry(entry)
                    self.reached[element_id] = self.moment()
                    self.event("event.reached", f"○ {element_id}")
                else:
                    self.run_activity(element)

                # After next_element, so a gateway's decision is in its record entry too.
                following = self.next_element(element)
                self.debug_state(element_id)
                element = following
        finally:
            self.depth = outer

    def archive_plan(self, source: Path) -> Path:
        self.repo_dir.mkdir(parents=True, exist_ok=True)
        # Skipped steps keep the record of the run that did the work. A branching run *supersedes*
        # work records instead of replacing them — the first branch's stay, so the trail shows both
        # branches — and start/end events supersede too, so a replay walks every run end to end.
        # Only containers always replace in place.
        # `reused` lines are always replaced too: the trail carries each element's latest reuse only.
        STRUCTURAL = CONTAINER_TAGS

        def replaced(action: str, element_id: str) -> str | None:
            if not self.branched or action == "reused":
                return action
            return action if local(self.studyflow.elements[element_id]) in STRUCTURAL else None

        entries = [
            *((eid, "executed", {}) for eid in sorted(self.completed | self.reached)),
            *((eid, "executed", {"what": flow_id}) for eid, (flow_id, _) in sorted(self.decisions.items())),
            *((eid, "created", {}) for eid in sorted(self.produced)),
            *((eid, "imported", {}) for eid in sorted(self.staged) if eid not in self.produced),
            *((eid, "reused", {"what": trusted}) for eid, (_, trusted) in sorted(self.reused.items())),
        ]
        # `produced` after `staged`: an input re-made this run stamps with the moment it was produced.
        moments = {
            **self.staged, **self.completed, **self.reached, **self.produced,
            **{eid: when for eid, (_, when) in self.decisions.items()},
            **{eid: when for eid, (when, _) in self.reused.items()},
        }
        stamped = self.studyflow.plan
        run = self.repo_dir.name
        if PROV is not None:
            for element_id, action, extra in entries:
                stamped = PROV.insert_element_entry(
                    stamped, element_id, replace_action=replaced(action, element_id),
                    action=action, when=moments[element_id], run=run, **extra,
                )
        plan = self.repo_dir / source.name
        write_plan_copy(source, plan, stamped)
        self.event("diagram.archived", f"  → {shown(plan)}", level=logging.DEBUG)
        return plan

    def finish(self) -> None:
        if not self.debug:
            shutil.rmtree(self.repo_dir / ".cache", ignore_errors=True)
        elapsed = (datetime.now(timezone.utc) - self.record.started).total_seconds() * 1000
        log_event(
            "run.finished",
            f"  → {shown(self.repo_dir)}/ ({self.record.status}) in {elapsed:.1f}ms",
            level=logging.INFO if self.record.status == "ok" else logging.ERROR,
        )


def resolve_repo_dir(explicit: Path | None, plan: Path, started: datetime) -> Path:
    """An explicit --repo, else the diagram's own directory when it is a run repository, else a fresh one."""
    if explicit is not None:
        # `studyflow.log` is what marks a directory as ours; without it a run would sweep a stranger's files.
        occupied = explicit.exists() and (not explicit.is_dir() or any(explicit.iterdir()))
        if occupied and not (explicit / "studyflow.log").exists():
            raise SystemExit(
                f"{explicit} is not a studyflow run repository (no studyflow.log in it). "
                "Point --repo at an earlier run's directory, or at a new one.",
            )
        return explicit.resolve()
    if (plan.parent / "studyflow.log").exists():
        return plan.parent.resolve()
    stamp = run_stamp(started)
    runs = Path.cwd() / "runs"
    candidate = runs / stamp
    attempt = 2
    while candidate.exists():
        candidate = runs / f"{stamp}{attempt}"
        attempt += 1
    return candidate




def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "studyflow", type=Path,
        help="a .studyflow.png with an embedded studyflow, or a .bpmn/.xml",
    )
    parser.add_argument(
        "--repo", type=Path, default=None, metavar="DIR",
        help="the run repository to write into, its name being the run id (default: the diagram's own "
             "directory when the diagram already lives in one, else a fresh runs/<YYMMDD+codename>)",
    )
    parser.add_argument(
        "--from", dest="from_ref", default=None, metavar="REF",
        help="re-run from this point in the repository's history (a commit-ish), branching there",
    )
    parser.add_argument(
        "--fresh", action="store_true",
        help="ignore the input's per-element run records and re-run every step",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="no console output; the log file is written either way",
    )
    parser.add_argument(
        "--runner", action="append", default=[], metavar="NAME=COMMAND",
        help="override a discovered partial runner, or add one: COMMAND <diagram> --element <id> --cache <dir>; repeatable",
    )
    parser.add_argument(
        "--debug", action="store_true",
        help="keep the .cache folder and its hand-off state files instead of cleaning them",
    )
    parser.add_argument("--sim", action="store_true", help="partial runners drive a simulated robot")
    parser.add_argument("--auto", action="store_true", help="partial runners answer their prompts with canned values")
    args = parser.parse_args()

    runner_flags = [flag for flag, wanted in (("--sim", args.sim), ("--auto", args.auto)) if wanted]
    runners = discover_runners(runner_flags)
    for spec in args.runner:
        name, separator, command = spec.partition("=")
        if not separator or not name or not command:
            parser.error(f"--runner wants NAME=COMMAND, got {spec!r}")
        runners[name] = command

    started = datetime.now(timezone.utc).astimezone()
    stamp = run_stamp(started)
    repo_dir = resolve_repo_dir(args.repo, args.studyflow, started)
    run_id = repo_dir.name
    start_logging(repo_dir, args.quiet)
    if PROV is None:
        log_event(
            "prov.missing",
            "  no studyflow-prov beside this runner — executing without a repository, records, or reuse",
            level=logging.WARNING,
        )

    who = PROV.current_user() if PROV is not None else ""
    repo = PROV.RunRepo(repo_dir) if PROV is not None else NoRepo()
    repo.open()
    # A repository created just now has nothing to attribute to anyone: its baseline is the `started` commit.
    if not repo.created and repo.dirty():
        repo.commit(
            "changed outside a run",
            {"Prov-Action": "modified", "Prov-When": timeline_timestamp(started)},
            when=timeline_timestamp(started),
        )

    # Root seed: read from the diagram, never drawn here — partial runners read the same file,
    # so every process seeds identically. A diagram without a seed runs unseeded.
    probe = read_studyflow(args.studyflow)
    seed = studyflow_attr(probe.process, "seed")
    try:
        random.seed(int(seed))
    except (TypeError, ValueError):
        pass  # no seed, or a non-numeric one, seeds nothing

    # The input file is never touched — the stamp lands on the archived copy.
    studyflow = read_studyflow(args.studyflow, stamp={
        "action": "executed",
        "when": timeline_timestamp(started),
        "who": who,
        "with": "studyflow-run-local.py",
        "run": run_id,
        "seed": seed,
    })
    # The diagram is read before the fork below, because forking reverts the copy this may be reading from.
    # Branching has first claim on the run's branch name — a detached HEAD only attaches without one.
    invalidated = PROV.invalidated_elements(probe) if PROV is not None else []
    branched = False
    if repo.active and (args.from_ref or invalidated):
        point = PROV.branch_point(repo, invalidated, args.from_ref)
        # Branches are the only refs — runs live as `started`/`finished` boundary commits.
        branch = f"run/{stamp}"
        if point and repo.branch(branch, f"{point}^"):
            branched = True
            # The checkout replaced the file the log handler had open; this run's log starts here.
            start_logging(repo_dir, args.quiet)
            log_event("git.branched", f"  {branch} at the parent of {point} — re-running from there")
        elif not point:
            log_event(
                "git.branchpoint.missing",
                f"  {args.from_ref or ', '.join(invalidated)} has no commit this history can branch at — "
                "re-running in place instead of branching",
                level=logging.WARNING,
            )
    if repo.active and not branched and not repo.current_branch():
        # A commit checked out by hand: this run gets a branch, not commits nothing points at.
        if repo.branch(f"run/{stamp}"):
            log_event("git.branched", f"  run/{stamp} at the detached HEAD this run started from")

    # Archived before the first step, so a killed run still leaves a readable diagram behind.
    archived = repo_dir / args.studyflow.name
    write_plan_copy(args.studyflow, archived, studyflow.plan)
    log_event("diagram.archived", f"  → {shown(archived)}", level=logging.DEBUG)
    runner = Runner(
        studyflow, repo_dir,
        input_sources=list(dict.fromkeys([args.studyflow.parent.resolve(), Path.cwd()])),
        started=started,
        seed=seed, fresh=args.fresh,
        repo=repo, branched=branched,
        runners=runners, plan_path=args.studyflow, debug=args.debug,
    )
    # The trailers of a commit that stamps no element are the document stamp's own attributes.
    document_stamp = {
        "Prov-Action": "executed",
        "Prov-When": timeline_timestamp(started),
        "Prov-Who": who,
        "Prov-With": "studyflow-run-local.py",
        "Prov-Run": run_id,
        "Prov-Seed": seed,
    }
    process_id = studyflow.process.get("id") or ""
    repo.commit(
        f"started {process_id} ({stamp})", document_stamp,
        when=timeline_timestamp(started), body=json.dumps(runner.record.header()),
    )
    try:
        runner.run()
    except BaseException as error:  # noqa: BLE001 - recorded and reported, not swallowed
        log_event(
            "run.failed", f"  {type(error).__name__}: {error}",
            level=logging.ERROR, exc_info=error,
        )
        runner.record.status = "error"
    finally:
        runner.archive_plan(args.studyflow)
        runner.record.finish(runner.record.status)
        runner.finish()
        # Entries no element commit claimed (end events, a failed parse) close out in the summary body.
        closing = {**runner.record.summary(), "tail": runner.record.steps_since(runner.recorded)}
        repo.commit(
            f"finished {process_id} ({runner.record.status})", document_stamp,
            when=timeline_timestamp(datetime.now(timezone.utc)),
            body=json.dumps(closing, default=str),
        )
        logging.shutdown()
    return 0 if runner.record.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

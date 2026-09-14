#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
"""A reference runner for the studyflow execution contract.

It keeps one claim honest: a studyflow is executable as it stands, with no
companion script telling an engine what the boxes mean. SKILL.md, beside this
file, specifies the hand-off contract it implements.

    uv run --script run.py study.bpmn   # BPMN XML; `studyflow run` also takes a .studyflow.yaml or image, and keeps its format

This is the core: the walk, the values, the records, and the
partial-runner hand-offs. A skill is a folder beside this one whose `SKILL.md`
declares what it contributes: a schema saying what its elements are, and as
`runtimes.local` the command that claims and executes them here, run in the
skill's folder (`python://` elements belong to the python skill). The prov
skill's module keeps the run repository, the records, and the prov timeline;
a run refuses to start without it.

A run writes a run directory, `--repo DIR` or else `~/.studyflow/runs/<id>/` (YYMMDD plus a codename, e.g. `260821heron/`), or the one the diagram handed
to it already lives in: the artifacts the `uri`s name, a copy of the studyflow
stamped `executed` (the copy carries its own run record), and `studyflow.log`;
the detailed step records live in the run repository's commit bodies. Expressions run in the evaluating engine's own
language (Python here, JavaScript in the browser runner) unless BPMN's per-expression
`language` attribute says otherwise. Each pool is walked on its own thread, one
path per pool: no parallel split inside a pool, no multi-instance fan-out. The
pools talk only along message flows, and the walk carries every message
(SKILL.md, "Messages").
"""

from __future__ import annotations

import argparse
import copy
import functools
import itertools
import json
import logging
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time

import yaml
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


def study_of(element: ET.Element) -> ET.Element | None:
    """The `studyflow:Study` extension `element` holds, if any."""
    return next(
        (ext for holder in element if local(holder) == "extensionElements"
         for ext in holder if ext.tag == f"{{{STUDYFLOW}}}study"),
        None,
    )


# `property` included: a property without a `uri` passes in memory; with one it persists like any artifact.
DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore", "property"}
END_TAGS = {"endEvent"}
GATEWAY_TAGS = {
    "exclusiveGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway",
}
CONTAINER_TAGS = {"subProcess", "adHocSubProcess", "transaction"}
PASSTHROUGH_TAGS = {"startEvent", "intermediateCatchEvent", "intermediateThrowEvent"}


class Interrupted(Exception):
    """A message reached a boundary event of a running activity: the walk leaves the activity for the event."""

    def __init__(self, activity: str, boundary: ET.Element) -> None:
        super().__init__(f"{activity} ended by {boundary.get('id')}")
        self.activity = activity
        self.boundary = boundary


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
    """Captured lines land as DEBUG, so the INFO console handler never prints them a second time.
    Only the main thread captures: another pool's thread would fight it over `sys.stdout`, and a
    hand-off's output is relayed line by line by `PartialRunner.element` either way."""
    if threading.current_thread() is not threading.main_thread():
        yield
        return
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


def timeline_timestamp(moment: datetime) -> str:
    """ISO 8601, millisecond precision, local numeric offset, fine enough that the timeline's order
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
    """Sortable, human-trackable id: YYMMDD plus a codename the start moment draws
    (e.g. 260821otter). A default repo's name and a new branch read the same."""
    utc = moment.astimezone(timezone.utc)
    return f"{utc.strftime('%y%m%d')}{ANIMALS[int(utc.timestamp() * 1000) % len(ANIMALS)]}"


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


def literal(text: str | None) -> Any:
    """A `value` or `seed` attribute: JSON when it parses, else the text as written."""
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text


def read_studyflow(path: Path, stamp: dict[str, str] | None = None) -> Studyflow:
    """`stamp` is this run's record, appended to `state._meta.prov` in the plan text (the copy runs from it)."""
    xml = path.read_text()
    if stamp:
        process_id = Studyflow(ET.fromstring(xml)).process.get("id") or ""
        record = {name: stamp[name] for name in PROV.TIMELINE_FIELDS if stamp.get(name)}
        seed = literal(record.get("seed"))
        if isinstance(seed, (int, float)) and not isinstance(seed, bool):
            record["seed"] = seed
        tree = PROV.read_state(xml)
        tree.setdefault("_meta", {}).setdefault("prov", []).append(record)
        xml = PROV.write_state(xml, tree, process_id)
    return Studyflow(ET.fromstring(xml), plan=xml)


class Studyflow:
    def __init__(self, definitions: ET.Element, plan: str = "") -> None:
        self.definitions = definitions
        self.plan = plan
        # Every pool with a flow is walked, all at once; the study's own process is the one carrying
        # `studyflow:Study` (its id, name, and properties are the run's), else the first (a pool
        # diagram's collaboration carries the study).
        self.processes = [
            element for element in definitions
            if local(element) == "process" and any(local(c) == "sequenceFlow" for c in element)
        ]
        if not self.processes:
            raise ValueError("no process with a sequence flow to walk")
        self.process = next((p for p in self.processes if study_of(p) is not None), self.processes[0])
        # The diagram's root carries the study (a pool diagram's collaboration, else the process), the first
        # to hold one, as the prov module finds it for the state: its id, name, `seed` and `dependencies` are
        # the run's. A diagram with none has its process stand in.
        self.root = next((root for root in definitions if study_of(root) is not None), self.process)
        self.study = study_of(self.root)
        self.seed = self.study.get("seed") if self.study is not None else None

        self.elements: dict[str, ET.Element] = {}
        self.outgoing: dict[str, list[ET.Element]] = {}
        # Lexical scopes: each element's container (up to the process), and the `bpmn:property`
        # declarations per scope, name -> initial `studyflow:value` text (None when undeclared).
        self.parents: dict[str, str] = {}
        self.properties: dict[str, dict[str, str | None]] = {}

        def declare(scope: ET.Element) -> None:
            declared = {
                (child.get("name") or child.get("id")): studyflow_attr(child, "value")
                for child in scope if local(child) == "property" and (child.get("name") or child.get("id"))
            }
            if declared:
                self.properties[scope.get("id")] = declared

        def index(container: ET.Element) -> None:
            declare(container)
            for element in container:
                if element.get("id"):
                    self.elements[element.get("id")] = element
                    self.parents[element.get("id")] = container.get("id")
                if local(element) == "sequenceFlow":
                    self.outgoing.setdefault(element.get("sourceRef"), []).append(element)
                if local(element) in CONTAINER_TAGS:
                    index(element)
                else:
                    declare(element)

        for process in self.processes:
            index(process)

        # The Parameters wired into a sub-process are read-only properties of it, beside the ones it declares.
        self.readonly: dict[str, set[str]] = {}
        for container_id, container in self.elements.items():
            read = self.reads(container) if local(container) in CONTAINER_TAGS else None
            for name, value in (read[1] if read else {}).items():
                declared = self.properties.setdefault(container_id, {})
                if name in declared:
                    raise SystemExit(f"{container_id} declares '{name}' as a property and in the Parameters wired into it: keep one.")
                declared[name] = json.dumps(value)
                self.readonly.setdefault(container_id, set()).add(name)

        # Message flows by the element or participant at each end, the participants they may end at, and the
        # boundary events by the activity each sits on.
        self.participants: dict[str, ET.Element] = {}
        self.flows_out: dict[str, list[ET.Element]] = {}
        self.flows_in: dict[str, list[ET.Element]] = {}
        for collaboration in definitions:
            if local(collaboration) != "collaboration":
                continue
            for child in collaboration:
                if local(child) == "participant" and child.get("id"):
                    self.participants[child.get("id")] = child
                elif local(child) == "messageFlow":
                    self.flows_out.setdefault(child.get("sourceRef"), []).append(child)
                    self.flows_in.setdefault(child.get("targetRef"), []).append(child)
        self.boundaries: dict[str, list[ET.Element]] = {}
        for element in self.elements.values():
            if local(element) == "boundaryEvent" and element.get("attachedToRef"):
                self.boundaries.setdefault(element.get("attachedToRef"), []).append(element)

        # Identifier-shaped names, every one of them, for the staleness rules (over-broad by design); an
        # ambiguous name, one two elements share or one that is also an element's id, binds no value.
        self.names: dict[str, str] = {}
        for element_id, element in self.elements.items():
            name = element.get("name")
            if name and re.fullmatch(r"[A-Za-z_]\w*", name):
                self.names[element_id] = name
        taken = list(self.names.values())
        self.ambiguous: set[str] = {
            name for eid, name in self.names.items() if taken.count(name) > 1 or (name in self.elements and name != eid)
        }
        self.bound_names: dict[str, str] = {eid: name for eid, name in self.names.items() if name not in self.ambiguous}

        self._products: set[str] | None = None


    def reads(self, element: ET.Element) -> tuple[dict[str, str], dict] | None:
        """The Parameters wired into an element, merged, split into the attributes they set (by the schema of its
        extension) and the rest: a task's settings, a sub-process's read-only properties. None when none is wired."""
        element_id = element.get("id") or ""
        sources = dict.fromkeys(text_of(c) for association in element if local(association) == "dataInputAssociation"
                                for c in association if local(c) == "sourceRef" and text_of(c))
        wired = [(source, carried) for source in sources if (carried := parameters_of(self.elements.get(source))) is not None]
        if not wired:
            return None
        ext = next((e for holder in element if local(holder) == "extensionElements" for e in holder
                    if not e.tag.startswith(f"{{{PROV.PROV_TIMELINE}}}")), None)
        names = schema_attributes().get(ext.tag, frozenset()) if ext is not None else frozenset()
        return split_attributes(names, wired_parameters(element_id, wired), element_id)

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
            sources.update(re.findall(r"\{\s*([^\W\d][\w-]*)", declared.text))  # what each `{name.field}` cites
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

    def pool_of(self, end: str) -> str:
        """The process an element belongs to, or that a participant depicts; a participant with none is its own pool."""
        if end in self.participants:
            return self.participants[end].get("processRef") or end
        while end in self.parents:
            end = self.parents[end]
        return end






class State:
    """Readable by expressions as `state`, so a drawn cycle can bound itself: `state.trace.count('Gate') < 8`.
    `tree` is the document's `state` (docs/reference.qmd, "Run state"), reachable as `state.<element id>.<name>`;
    the runner counts every visit in `state._meta.reached.<element id>`, study-lifetime."""

    def __init__(self, tree: dict | None = None) -> None:
        self.trace: list[str] = []
        self.tree: dict = tree if tree is not None else {}

    def __getattr__(self, name: str) -> Any:
        return getattr(_Node(self.__dict__["tree"]), name)


class _Node:
    def __init__(self, entries: dict) -> None:
        self._entries = entries

    def __getattr__(self, name: str) -> Any:
        try:
            value = self._entries[name]
        except KeyError:
            raise AttributeError(name) from None
        return _Node(value) if isinstance(value, dict) else value


def plain(value: Any) -> Any:
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        return value.item()
    return value



def shown(path: Path) -> Path:
    """Paths are printed as the reader typed them: relative to where the run was started, `~` for home."""
    here, home = Path.cwd(), Path.home()
    if path.is_relative_to(here):
        return path.relative_to(here)
    return Path("~") / path.relative_to(home) if path.is_relative_to(home) else path


def skill_dirs() -> list[Path]:
    """Every skill folder (one with a `SKILL.md`) under the nearest `skills/` above this script (the repo
    checkout, or `libexec/skills` as installed), then under each `STUDYFLOW_SKILLS` directory."""
    nearest = next((p / "skills" for p in Path(__file__).resolve().parents if (p / "skills").is_dir()), None)
    roots = [*([nearest] if nearest else []), *(Path(d) for d in os.environ.get("STUDYFLOW_SKILLS", "").split(os.pathsep) if d)]
    return sorted(manifest.parent for root in roots for manifest in root.glob("*/SKILL.md"))


def branching_modes() -> dict[str, str]:
    """`meta.branching` from every skill's schema, by the XML tag of the type (`{uri}randomGateway`): how a gateway
    of that type picks its branch (`random`). The browser runner reads the same key."""
    modes: dict[str, str] = {}
    for folder in skill_dirs():
        schema = read_manifest(folder).get("schema")
        if not schema or not (folder / schema).is_file():
            continue
        model = yaml.safe_load((folder / schema).read_text()) or {}
        lower = (model.get("xml") or {}).get("tagAlias") == "lowerCase"
        for declared in model.get("types") or []:
            mode = (declared.get("meta") or {}).get("branching")
            if mode:
                name = declared["name"]
                modes[f"{{{model['uri']}}}{name[:1].lower() + name[1:] if lower else name}"] = mode
    return modes


@functools.cache
def schema_attributes() -> dict[str, frozenset[str]]:
    """The XML attributes each skill type declares, inherited ones included, by the XML tag of the type
    (`{uri}task`): the names a `studyflow:Parameters` key may set on an element of that type (core's
    `overridableAttributes`). A property spelled `bpmn:<name>` is BPMN's own, and not among them."""
    types: dict[str, tuple[str, list[str], set[str]]] = {}
    for folder in skill_dirs():
        schema = read_manifest(folder).get("schema")
        if not schema or not (folder / schema).is_file():
            continue
        model = yaml.safe_load((folder / schema).read_text()) or {}
        lower = (model.get("xml") or {}).get("tagAlias") == "lowerCase"
        for declared in model.get("types") or []:
            name = declared["name"]
            tag = f"{{{model['uri']}}}{name[:1].lower() + name[1:] if lower else name}"
            supers = [s if ":" in s else f"{model['prefix']}:{s}" for s in declared.get("superClass") or []]
            own = {p["name"] for p in declared.get("properties") or [] if p.get("isAttr") and ":" not in p["name"]}
            types[f"{model['prefix']}:{name}"] = (tag, supers, own)

    def inherited(qualified: str) -> set[str]:
        tag, supers, own = types[qualified]
        return own.union(*(inherited(s) for s in supers if s in types))

    return {tag: frozenset(inherited(qualified)) for qualified, (tag, _, _) in types.items()}


def split_attributes(names: frozenset[str], values: dict, reader_id: str) -> tuple[dict[str, str], dict]:
    """What an element reads, split into the attributes it sets (as XML attribute text) and the rest, its
    configuration; core's `splitAttributes`. An attribute takes one value: a mapping, a list or nothing is an error."""
    attributes: dict[str, str] = {}
    rest: dict = {}
    for key, value in values.items():
        if key not in names:
            rest[key] = value
        elif value is None or isinstance(value, (dict, list)):
            got = "nothing" if value is None else "a list" if isinstance(value, list) else "a mapping"
            raise SystemExit(f"{reader_id} reads {key}, one of its attributes, which takes one value, not {got}.")
        else:
            attributes[key] = ("true" if value else "false") if isinstance(value, bool) else str(value)
    return attributes, rest


def draw(seed: int, gateway_id: str, visit: int) -> float:
    """A random gateway's draw on one visit, in [0, 1): mulberry32 seeded with the FNV-1a hash of
    `seed:gateway:visit`, bit for bit the browser runner's `draw` (skills/browser/src/branching.ts), so a seed
    picks the same branches in both runtimes, in any order of the walk."""
    mask = 0xFFFFFFFF
    hashed = 0x811C9DC5
    for byte in f"{seed}:{gateway_id}:{visit}".encode():
        hashed = ((hashed ^ byte) * 0x01000193) & mask
    a = (hashed + 0x6D2B79F5) & mask
    t = ((a ^ (a >> 15)) * (a | 1)) & mask
    t ^= (t + ((t ^ (t >> 7)) * (t | 61))) & mask
    return ((t ^ (t >> 14)) & mask) / 4294967296


def read_manifest(folder: Path) -> dict[str, Any]:
    """A skill's `metadata` (https://agentskills.io/specification), from the YAML front matter of its
    `SKILL.md`: what the skill contributes to studyflow (`schema`, `runtimes.<runtime>`)."""
    matched = re.match(r"---\r?\n(.*?)\r?\n---", (folder / "SKILL.md").read_text(), re.S)
    data = (yaml.safe_load(matched.group(1)) if matched else None) or {}
    return data.get("metadata") or {}


def load_prov():
    """The prov skill's module (`runtimes.local` in `skills/prov/SKILL.md`), or `STUDYFLOW_PROV_PY`."""
    import importlib.util

    override = os.environ.get("STUDYFLOW_PROV_PY")
    if override:
        candidate = Path(override)
    else:
        folder = next((d for d in skill_dirs() if d.name == "prov"), None)
        module = (read_manifest(folder).get("runtimes") or {}).get("local") if folder else None
        candidate = folder / module if module else None
    if candidate is None or not candidate.exists():
        raise SystemExit(
            "no prov skill in reach: the local runtime needs skills/prov beside skills/local, "
            "or STUDYFLOW_PROV_PY naming prov.py",
        )
    spec = importlib.util.spec_from_file_location("studyflow_prov", candidate)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.log_event = log_event
    module.shown = shown
    return module


PROV = load_prov()


def discover_runners(runner_flags: list[str], dependencies: list[str] = ()) -> dict[str, tuple[str, Path | None]]:
    """Partial runners in reach, each named <name> and claiming its own elements, as (command, folder to run it in):
    every skill whose `SKILL.md` declares a `runtimes.local` command (run in the skill's folder), a `studyflow-<name>`
    on PATH, then `STUDYFLOW_<NAME>_PY` overrides. The study's `dependencies` join every uv script's environment
    (`uv run --with`); anything else brings its own."""
    flags = "".join(f" {flag}" for flag in runner_flags)
    withs = "".join(f" --with {shlex.quote(dependency)}" for dependency in dependencies)
    found: dict[str, tuple[str, Path | None]] = {}
    for folder in skill_dirs():
        if folder.name == "prov":
            continue  # its `local` entry is the records module this runtime loads itself (load_prov)
        command = (read_manifest(folder).get("runtimes") or {}).get("local")
        if not isinstance(command, str) or not command:
            continue  # a vocabulary alone, or nothing for this runtime
        if withs and command.startswith("uv run"):  # ponytail: only uv scripts get the study's dependencies
            command = f"uv run{withs}{command[len('uv run'):]}"
        found[folder.name.lower()] = (f"{command}{flags}", folder)
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
                found[name] = (shlex.quote(os.path.join(directory, entry)) + flags, None)
    for key, value in os.environ.items():
        matched = re.fullmatch(r"STUDYFLOW_([A-Z0-9_]+)_PY", key)
        if matched:
            name = matched.group(1).lower().replace("_", "-")
            if name not in ("run", "run-local", "prov"):
                found[name] = (f"uv run{withs} --script {shlex.quote(value)}{flags}", None)
    return found



def text_of(node: ET.Element | None) -> str | None:
    text = (node.text or "").strip() if node is not None else ""
    return text or None


def extension_digest(ext: ET.Element) -> dict[str, Any]:
    """An extension element under local names: its attributes, then its child elements' text (a list when a name repeats)."""
    fields: dict[str, Any] = {key.split("}")[-1]: value for key, value in ext.attrib.items()}
    for child in ext:
        name, text = local(child), (child.text or "").strip()
        if name in fields:
            fields[name] = [*fields[name], text] if isinstance(fields[name], list) else [fields[name], text]
        else:
            fields[name] = text
    namespace = ext.tag[1:].split("}")[0] if ext.tag.startswith("{") else ""
    return {"namespace": namespace, "type": local(ext), "attributes": fields}


def element_digest(element: ET.Element) -> dict[str, Any]:
    """One element as a partial runner sees it: what the XML says, under local names, nothing inferred."""
    inputs: list[dict[str, Any]] = []
    outputs: list[dict[str, Any]] = []
    io_slots: dict[str, str] = {}
    extensions: list[dict[str, Any]] = []
    for child in element:
        tag = local(child)
        if tag == "extensionElements":
            extensions.extend(extension_digest(ext) for ext in child)
        elif tag == "ioSpecification":
            io_slots.update({d.get("id"): d.get("name") or "" for d in child if local(d) == "dataInput" and d.get("id")})
        elif tag in ("dataInputAssociation", "dataOutputAssociation"):
            parts = {local(c): c for c in child}
            narrow = parts.get("transformation")
            binding = {
                "target": text_of(parts.get("targetRef")),
                "transformation": text_of(narrow),
                "language": narrow.get("language") if narrow is not None else None,
            }
            if tag == "dataOutputAssociation":
                outputs.append(binding)
            else:
                inputs.extend({"source": text_of(c), **binding} for c in child if local(c) == "sourceRef" and text_of(c))
    return {
        "id": element.get("id"),
        "type": local(element),
        "name": element.get("name"),
        "attributes": {k.split("}")[-1]: v for k, v in element.attrib.items() if k.split("}")[-1] not in ("id", "name")},
        "extensions": extensions,
        "additionalArguments": text_of(studyflow_child(element, "additionalArguments")),
        "ioSlots": io_slots,
        "inputs": inputs,
        "outputs": outputs,
        # A choreography task's bands, in order; `initiatingParticipantRef` is among the attributes.
        "participants": [text_of(child) for child in element if local(child) == "participantRef" and text_of(child)],
    }


def parameters_of(element: ET.Element | None) -> dict | None:
    """The mapping a `studyflow:Parameters` data object carries; None for any other element, or an empty one."""
    ext = next((ext for holder in (element if element is not None else []) if local(holder) == "extensionElements"
                for ext in holder if ext.tag == f"{{{STUDYFLOW}}}parameters"), None)
    values = studyflow_child(ext, "values") if ext is not None else None
    parsed = yaml.safe_load(values.text or "") if values is not None else None
    return parsed if isinstance(parsed, dict) and parsed else None


def wired_parameters(step_id: str, sources: list[tuple[str, dict]]) -> dict:
    """What a step reads: the `studyflow:Parameters` wired into it, merged. Mappings merge key by key; a value two of
    them set is an error, since nothing drawn orders the wires. The browser runner's `mergeWired` merges the same way."""

    def has(node: Any, path: list) -> bool:
        for key in path:
            if not isinstance(node, dict) or key not in node:
                return False
            node = node[key]
        return True

    def into(target: dict, source: dict, source_id: str, path: list) -> None:
        for key, value in source.items():
            at = [*path, key]
            if key not in target:
                target[key] = copy.deepcopy(value)
            elif isinstance(target[key], dict) and isinstance(value, dict):
                into(target[key], value, source_id, at)
            else:
                other = next(sid for sid, carried in sources if has(carried, at))
                raise SystemExit(f"{step_id} reads {'.'.join(map(str, at))} from both {other} and {source_id}: set it in one of them.")

    merged: dict = {}
    for source_id, carried in sources:
        into(merged, carried, source_id, [])
    return merged


def study_dependencies(studyflow: Studyflow) -> list[str]:
    """`studyflow:dependencies` entries on the study, one package spec each, in the order written."""
    study = studyflow.study
    return [] if study is None else [
        text for child in study if local(child) == "dependencies" and (text := (child.text or "").strip())
    ]


def plan_digest(studyflow: Studyflow, sources: list[Path]) -> dict[str, Any]:
    """The plan as one JSON document for partial runners: the study, every element by id (pool participants and
    message flows included), and the directories a boundary input may be staged from. A runner reads this, never the diagram."""
    elements = {element_id: element_digest(element) for element_id, element in studyflow.elements.items()}
    for element_id, digest in elements.items():
        digest["parent"] = studyflow.parents.get(element_id)  # the container, for lexical `{name}` lookups outward
        read = studyflow.reads(studyflow.elements[element_id])
        if read is not None:
            # A key naming one of the element's attributes sets it (`scene: WO`); the rest is its `parameters`.
            attributes, digest["parameters"] = read
            ext = next((e for e in digest["extensions"] if e["namespace"] != PROV.PROV_TIMELINE), None)
            if attributes and ext:
                ext["attributes"].update(attributes)
    process = studyflow.process
    title = studyflow.root.get("name") or process.get("name")
    for root in studyflow.definitions:
        # A message (`messageRef` on a flow) and its item definition say what a message flow carries.
        if local(root) in ("message", "itemDefinition") and root.get("id"):
            elements[root.get("id")] = element_digest(root)
        if local(root) != "collaboration":
            continue
        for child in root:
            # A message flow to another pool is how a runner learns that a step exchanges messages with it.
            if local(child) not in ("participant", "messageFlow") or not child.get("id"):
                continue
            elements[child.get("id")] = element_digest(child)
            if not title and local(child) == "participant" and child.get("processRef") == process.get("id"):
                title = child.get("name")
    return {
        "study": {
            "id": studyflow.root.get("id"), "name": title or studyflow.root.get("id"), "seed": studyflow.seed,
            "dependencies": study_dependencies(studyflow),
        },
        "sources": [str(path) for path in sources],
        "elements": elements,
        # The names a placeholder may cite (`{Play.trials}`): one element each, never an id's twin.
        "names": studyflow.bound_names,
    }


class PartialRunner:
    """A partial runner as a subprocess per element: `COMMAND <plan.json> --element <id> --cache <dir>`.
    It runs the elements it claims (`COMMAND <plan.json> --claims` answers with their ids), whatever
    they are; a runner is element-specific, not schema-specific. One file per hand-off,
    `<id>.state.json` in the cache dir: the state (the run's values) goes in, and the updated
    state comes back with `result`, `durationMs`, and on failure `error` merged in. Only one
    side touches it at a time. The runner's stdout is captured into the run log; stdin and
    stderr stay on the terminal for the person."""

    def __init__(self, name: str, command: str, plan: Path, repo_dir: Path, debug: bool = False, cwd: Path | None = None) -> None:
        self.name = name
        self.command = command
        self.plan = plan
        self.repo_dir = repo_dir
        self.debug = debug
        self.cwd = cwd  # a skill's runner runs in its folder; plan and cache paths are absolute

    def claims(self) -> list[str]:
        argv = [*shlex.split(self.command), str(self.plan), "--claims"]
        done = subprocess.run(argv, capture_output=True, text=True, cwd=self.cwd)  # noqa: S603 - an authored runner command
        lines = [line for line in (done.stdout or "").splitlines() if line.strip()]
        if done.returncode != 0 or not lines:
            detail = (done.stderr or "").strip().splitlines()
            raise SystemExit(f"{self.name} --claims failed: {detail[-1] if detail else f'exit {done.returncode}'}")
        return json.loads(lines[-1])

    def element(self, element_id: str, values: dict, pump: Any = None) -> dict:
        """`pump(cache, stop)`, when given, runs beside the runner and carries its messages until `stop` is set."""
        cache = self.repo_dir / ".cache"
        cache.mkdir(parents=True, exist_ok=True)
        handoff = cache / f"{element_id}.state.json"
        handoff.write_text(json.dumps(values, default=str))
        argv = [*shlex.split(self.command), str(self.plan), "--element", element_id, "--cache", str(cache)]
        # The walk's own pid, so whatever a runner leaves running for the study can follow the walk;
        # unbuffered, so a Python runner's progress shows while it works, not when it is done.
        env = {**os.environ, "STUDYFLOW_RUN_PID": str(os.getpid()), "PYTHONUNBUFFERED": "1"}
        stop = threading.Event()
        pumping = threading.Thread(target=pump, args=(cache, stop), daemon=True) if pump else None
        if pumping:
            pumping.start()
        process = subprocess.Popen(argv, stdout=subprocess.PIPE, text=True, env=env, cwd=self.cwd)  # noqa: S603 - an authored runner command
        assert process.stdout is not None
        for line in process.stdout:  # an element can take minutes (a robot seating itself): relay as it comes
            if line.strip():
                log_event("runner.stdout", f"    {line.rstrip()}")
        returncode = process.wait()
        if pumping:
            stop.set()
            pumping.join()
        state = json.loads(handoff.read_text()) if handoff.exists() else {}
        # Only the read state file goes; the cache dir survives the run (spilled values live there)
        # and finish() sweeps it at the end.
        if not self.debug:
            handoff.unlink(missing_ok=True)
        if returncode != 0 or state.get("error"):
            raise RuntimeError(f"{self.name}: {state.get('error') or f'exited with code {returncode}'}")
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
        repo: Any = None,  # prov's RunRepo, loaded at run time (`load_prov`)
        branched: bool = False,
        runners: dict[str, tuple[str, Path | None]] | None = None,
        debug: bool = False,
    ) -> None:
        self.studyflow = studyflow
        self.debug = debug
        self.seed = seed if seed is not None else studyflow.seed
        self.branching = branching_modes()
        # Partial runners claim elements, not schemas: each is asked once which ids it will run.
        # Partial runners never open the diagram: they read `.cache/plan.json`, the plan as one JSON digest.
        handoff_plan = repo_dir / ".cache" / "plan.json"
        if runners:
            handoff_plan.parent.mkdir(parents=True, exist_ok=True)
            handoff_plan.write_text(json.dumps(plan_digest(studyflow, input_sources or [Path.cwd()]), indent=1))
        self.runners = {
            name: PartialRunner(name, command, handoff_plan, repo_dir, debug=debug, cwd=cwd)
            for name, (command, cwd) in (runners or {}).items()
        }
        self.claimed: dict[str, PartialRunner] = {}
        # Live elements are interaction: they never skip or replay. A claims answer that is a plain
        # array is live; `{"elements": [...], "live": false}` marks replayable ones (the python skill).
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
        # Messages are interaction too: an element that sends or takes them never skips or replays, nor does a
        # gateway the first message decides.
        self.live.update(eid for eid, element in studyflow.elements.items()
                         if eid in studyflow.flows_in or eid in studyflow.flows_out or local(element) == "eventBasedGateway")
        # Everything this run writes belongs to the repo; boundary inputs are looked up in `input_sources`.
        self.repo_dir = repo_dir
        self.input_sources = input_sources or [Path.cwd()]
        self.repo = repo
        self.branched = branched
        self.values: dict[str, Any] = {}
        self.state = State(PROV.read_state(studyflow.plan))
        self._thread = threading.local()  # each pool walks on its own thread, at its own depth
        self.lock = threading.RLock()  # the values, the state tree, and the repository are shared by the pools
        self.arrived = threading.Condition(self.lock)  # where a receive waits for its message
        self.mail: dict[str, list[dict]] = {}  # message flow id → the messages sent along it and not taken yet
        self.pools_done: set[str] = set()  # processes whose walk has ended: they send nothing more
        self.serving: dict[str, threading.Lock] = {}  # one request at a time to each pool a runner plays
        self.sent = itertools.count(1)
        self.failed: BaseException | None = None
        self._deferred: list[tuple[str, str, int, str]] | None = None
        self.prior_records = {} if fresh else PROV.element_records(studyflow)
        if branched:
            # The checkout took out of the worktree what was made after the branch point, files or not: the
            # records of that work go with it, so those steps re-run.
            history = repo.executed()
            self.prior_records = {eid: prior for eid, prior in self.prior_records.items() if (eid, prior["when"]) in history}
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
            self.seed,
            started or datetime.now(timezone.utc),
            run=self.repo_dir.name,
            who=PROV.current_user(),
        )

    @property
    def depth(self) -> int:
        return getattr(self._thread, "depth", 0)

    @depth.setter
    def depth(self, value: int) -> None:
        self._thread.depth = value

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
        """Record entries since the last checkpoint ride in the commit body; git is their only home."""
        if self.repo is None:
            return
        with self.lock:  # one commit at a time: the pools share the repository
            steps = self.record.steps_since(self.recorded)
            trailers = {"Prov-Run": self.repo_dir.name, "Prov-When": when, **(extra_trailers or {})}
            self.repo.commit(subject, trailers, when=when, body=json.dumps(steps, default=str) if steps else None)
            self.recorded = len(self.record.entries)

    def store(self, element_id: str, value: Any) -> None:
        with self.lock:
            self.values[element_id] = value

    def namespace(self) -> dict[str, Any]:
        space: dict[str, Any] = {"state": self.state}
        for element_id, value in list(self.values.items()):
            space[element_id] = value
            name = self.studyflow.bound_names.get(element_id)
            if name:
                space[name] = value
        return space

    def evaluate(
        self,
        expression: str,
        extra: dict[str, Any] | None = None,
        language: str | None = None,
        scope: str | None = None,
    ) -> Any:
        """`language` is BPMN's per-expression attribute; unset means Python here, anything else is refused.
        `scope` is the evaluating element: the properties declared on it and its containers are bound by name."""
        if language and language.lower() not in ("py", "python"):
            raise ValueError(
                f"a {language} expression — this runner evaluates Python "
                "(the browser runner evaluates JavaScript)",
            )
        space = self.namespace()
        if scope:
            space.update(self.scope_values(scope))
        space.update(extra or {})
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - see module docstring

    def scope_chain(self, element_id: str) -> list[str]:
        """The element, then its containers outward to the process."""
        chain = [element_id]
        while chain[-1] in self.studyflow.parents:
            chain.append(self.studyflow.parents[chain[-1]])
        return chain

    def scope_values(self, element_id: str) -> dict[str, Any]:
        space: dict[str, Any] = {}
        for scope in reversed(self.scope_chain(element_id)):
            held = self.state.tree.get(scope) or {}
            space.update({name: held[name] for name in self.studyflow.properties.get(scope, ()) if name in held})
        return space

    def start_scope(self, element_id: str, reset: bool) -> None:
        """Initialise the scope's properties from `value`; `reset` re-initialises ones the tree already holds."""
        for name, value in self.studyflow.properties.get(element_id, {}).items():
            if value is None:
                continue
            if name.startswith("_"):
                self.event("state.reserved", f"    {element_id}.{name}: names starting with _ are reserved", level=logging.WARNING)
                continue
            held = self.state.tree.setdefault(element_id, {})
            if reset or name not in held:
                held[name] = literal(value)

    def stage_input(self, uri: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        for directory in self.input_sources:
            source = directory / uri
            # A resumed plan lives in the repo, so the first source can name the very file being staged.
            if source == path or not source.exists():
                continue
            shutil.copyfile(source, path)
            self.event(
                "artifact.staged",
                f"    ▤ stage {uri}  {human_bytes(path.stat().st_size)}, from {shown(source)}",
            )
            return
        looked_in = ", ".join(str(directory) for directory in self.input_sources)
        raise FileNotFoundError(f"{uri} is in none of {looked_in}")

    def runner_for(self, element: ET.Element) -> PartialRunner | None:
        """The runner that claimed this element, if any."""
        return self.claimed.get(element.get("id") or "")

    def json_values(self) -> dict:
        """The JSON-able shadow of the run's values, for a partial runner's placeholders and intents."""
        shadow: dict[str, Any] = {}
        with self.lock:  # another pool may be adopting a hand-off into the same values and tree
            for element_id, value in list(self.values.items()):
                try:
                    json.dumps(plain(value))
                except (TypeError, ValueError):
                    continue
                shadow[element_id] = plain(value)
            # The state tree itself, under the one key no element may take: `state.<scope>.<property>` and `state._meta`.
            shadow["state"] = json.loads(json.dumps(self.state.tree, default=str))
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
            self.stage_input(uri, path)

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
        except Interrupted as interrupt:
            entry["interruptedBy"] = interrupt.boundary.get("id")
            self.end_entry(entry)
            raise
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
        element_id = element.get("id") or ""
        outgoing, incoming = self.studyflow.flows_out.get(element_id, []), self.studyflow.flows_in.get(element_id, [])
        if outgoing or incoming:
            # Unclaimed, an activity exchanges messages itself: it sends its data inputs along each flow out of it,
            # then takes the next message along a flow into it as its result. A send, a receive, or both: a request.
            for flow in outgoing:
                self.send(flow, self.inputs_of(element), in_reply_to=self.answering(flow))
            if incoming:
                self.bind_result(element, self.receive(element_id)["content"])
            return
        if implementation:
            scheme = implementation.split("://", 1)[0] if "://" in implementation else implementation
            raise RuntimeError(
                f"no partial runner claims {element.get('id')} ({implementation}): "
                f"no skill in reach declares {scheme}:// elements (or a studyflow-{scheme} on PATH)",
            )
        self.event(
            "implementation.missing", "    (no implementation — nothing to call)",
            level=logging.WARNING,
        )

    def execute_via_runner(self, element: ET.Element, entry: dict, runner: PartialRunner) -> None:
        """One hand-off: state in, updated state out; what the runner bound or changed is adopted here."""
        element_id = element.get("id")
        entry["implementation"] = element.get("implementation") or f"runner://{runner.name}"
        self.event("runner.called", f"    → the {runner.name} runner takes this element")
        sent = self.json_values()
        # A runner stages the boundary inputs it reads, by data edge or by `{name}` in its arguments: one the repo
        # lacks before the hand-off and holds after it was imported by this run. Only the element's own are checked,
        # so one that another pool's hand-off stages meanwhile is recorded there, not here.
        flow = self.studyflow
        cited, _ = flow.activity_dependencies(element)
        reads = cited | {data_id for data_id, name in flow.bound_names.items() if name in cited}
        absent = {
            data_id: uri for data_id in flow.elements
            if data_id in reads and (uri := flow.artifact(data_id)[0]) and not flow.is_product(data_id)
            and not (self.repo_dir / uri).exists()
        }
        talks = element_id in flow.flows_in or element_id in flow.flows_out
        reported = runner.element(element_id, sent, pump=self.pump(element_id) if talks else None)
        entry["_runnerMs"] = reported.get("durationMs")
        with self.lock:
            for key, value in reported.items():
                if key == "state" and isinstance(value, dict):
                    # Properties the runner wrote (a data edge into a `bpmn:Property`): scope by scope, `_meta` stays ours.
                    for scope, held in value.items():
                        before = (sent.get("state") or {}).get(scope) or {}
                        if scope != "_meta" and isinstance(held, dict) and held != before:
                            written = sorted(name for name in self.studyflow.readonly.get(scope, ())
                                             if name in held and held[name] != before.get(name))
                            if written:
                                raise ValueError(f"{element_id} writes {', '.join(written)}, which the Parameters wired "
                                                 f"into {scope} set, so nothing inside it writes them")
                            self.state.tree.setdefault(scope, {}).update(held)
                elif key not in ("result", "durationMs", "error") and sent.get(key, ...) != value:
                    self.store(key, value)
        for data_id, uri in absent.items():
            path = self.repo_dir / uri
            if path.exists():
                self.staged[data_id] = self.moment()
                self.event("artifact.staged", f"    ▤ stage {uri}  {human_bytes(path.stat().st_size)}")
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
            branching = next((self.branching[ext.tag] for holder in element if local(holder) == "extensionElements"
                              for ext in holder if ext.tag in self.branching), None)
            # A clean gateway replays its recorded decision: same inputs, same seed, same verdict.
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

            def take(flow: ET.Element, how: str, **marks: bool) -> ET.Element | None:
                """Record the decision and how it was made, then follow `flow`."""
                entry["taken"] = {"sequenceFlow": flow.get("id"), "name": flow.get("name"), **marks}
                self.end_entry(entry)
                when = self.moment()
                self.decisions[element_id] = (flow.get("id"), when)
                self.event("sequenceFlow.taken", f"    {how} → {flow.get('id')}")
                self.checkpoint(
                    f"executed {element_id}: {flow.get('id')}", when,
                    {"Prov-Action": "executed", "Prov-Node": element_id, "Prov-What": flow.get("id")},
                )
                return self.studyflow.elements.get(flow.get("targetRef"))

            if local(element) == "eventBasedGateway":
                self.event("event.waiting", f"    (waiting for the first message along {len(flows)} branches)")
                try:
                    return take(self.race(element_id, flows), "first message", message=True)
                except Interrupted:
                    self.end_entry(entry)
                    raise
                except BaseException as error:
                    self.record.fail(entry, error)
                    raise

            if branching == "random":
                # Seeded, each visit draws from the seed, the gateway and the visit number, as the browser runner does.
                try:
                    u = draw(int(self.seed), element_id, self.state.trace.count(element_id))
                except (TypeError, ValueError):
                    u = random.random()  # unseeded: a re-run replays the recorded decision instead
                return take(flows[int(u * len(flows))], "drawn", random=True)

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
                    verdict = self.evaluate(expression, bindings, language=language, scope=element_id)
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
                        return take(flow, expression)
            except BaseException as error:
                self.record.fail(entry, error)
                entry.pop("_runnerMs", None)
                raise

            # No condition held: the default flow, else the one flow without a condition, as the browser runner decides.
            chosen = next((f for f in flows if f.get("id") == element.get("default")), None)
            if chosen is not None:
                return take(chosen, "default", default=True)
            bare = [f for f in flows if not any(local(c) == "conditionExpression" and (c.text or "").strip() for c in f)]
            if len(bare) == 1:
                return take(bare[0], "otherwise", otherwise=True)
            entry["status"] = "stuck"
            self.end_entry(entry)
            self.record.status = "error"
            self.event(
                "gateway.stuck",
                f"    {element_id}: no condition held, and there is no default flow or single flow without a condition",
                level=logging.ERROR,
            )
            return None

        return self.studyflow.elements.get(flows[0].get("targetRef"))

    def debug_state(self, element_id: str) -> None:
        """--debug: every element leaves `<id>.state.json` in `.cache/`, the updated state with its
        `result` and `durationMs` merged in, the same shape a partial runner's hand-off file has."""
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
        process, study = self.studyflow.process, self.studyflow.root
        name = study.get("name") or study.get("id")
        log_event("run.started", name)
        log_event(
            "run.started",
            f"  [{study.get('id')}]  studyflow {self.record.plan_digest}"
            f"  rootSeed {self.record.seed}  repo {self.repo_dir}",
            level=logging.DEBUG,
        )
        for name in sorted(self.studyflow.ambiguous):
            log_event(
                "name.ambiguous",
                f"  {name} names more than one element, or is also an id: `{{{name}.…}}` cites nothing until it is unique",
                level=logging.WARNING,
            )
        # Study-scoped properties persist across runs, so only ones the tree lacks take their `value`;
        # a plain element's properties live with the study (`Excluded (n={count})` counts across runs).
        for scope in self.studyflow.properties:
            if local(self.studyflow.elements.get(scope, process)) not in CONTAINER_TAGS:
                self.start_scope(scope, reset=False)
        pools = self.studyflow.processes
        if len(pools) == 1:
            self.walk(self.studyflow.start_event(), max_steps=max_steps)
            return
        # Every pool runs at once, each on its own token; the message flows are where they wait for each other.
        threads = [
            threading.Thread(target=self.walk_pool, args=(pool, max_steps), name=pool.get("id") or "pool")
            for pool in pools
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        if self.failed is not None:
            raise self.failed

    def walk_pool(self, pool: ET.Element, max_steps: int) -> None:
        try:
            self.walk(self.studyflow.start_event(pool), max_steps=max_steps)
        except BaseException as error:  # noqa: BLE001 - the first pool to fail ends the run; the others notice while waiting
            with self.arrived:
                self.failed = self.failed or error
        finally:
            with self.arrived:
                self.pools_done.add(pool.get("id"))
                self.arrived.notify_all()

    # --- messages (SKILL.md, "Messages"): the walk carries every one, along the flow it names ---

    def send(self, flow: ET.Element, content: Any, message_id: str | None = None, in_reply_to: str | None = None) -> None:
        """A message along a flow: into the flow's mailbox, or, when a runner plays the pool it ends at, to that
        runner, whose answer goes back along the pool's flow to the sender."""
        target = flow.get("targetRef") or ""
        message = {"id": message_id or f"{flow.get('id')}.{next(self.sent)}", "flow": flow.get("id"), "content": content}
        if in_reply_to:
            message["inReplyTo"] = in_reply_to
        self.event("message.sent", f"    ✉ {flow.get('sourceRef')} → {target}  [{message['id']}]", level=logging.DEBUG)
        runner = self.claimed.get(target)
        if target in self.studyflow.participants and runner is not None:
            self.serve(target, runner, flow, message)
            return
        if target in self.studyflow.participants:
            self.event("message.unplayed", f"    ✉ no runner plays {self.studyflow.participants[target].get('name') or target}, "
                       f"so {message['id']} goes unanswered", level=logging.WARNING)
        with self.arrived:
            self.mail.setdefault(flow.get("id"), []).append(message)
            self.arrived.notify_all()

    def serve(self, pool: str, runner: PartialRunner, flow: ET.Element, message: dict) -> None:
        """One message to a pool a runner plays, recorded as a step of its own. A pool that fails answers null, so the
        sender goes on (a task it answers for counts a miss) and the record keeps the error."""
        name = self.studyflow.participants[pool].get("name") or pool
        entry = self.record.begin(pool, name, "bpmn:Participant")
        entry["message"] = message["id"]
        with self.serving.setdefault(pool, threading.Lock()):
            try:
                answered = runner.element(pool, {**self.json_values(), "message": message})
                entry["_runnerMs"] = answered.get("durationMs")
                reply = answered.get("result")
                if isinstance(reply, str):
                    entry["reply"] = reply[:2000]  # what the pool said, kept with the run's records
                self.event("message.answered", f"    ✉ {name} answered {message['id']}")
            except Exception as error:  # noqa: BLE001 - recorded, and the sender hears null
                reply = None
                entry["status"] = "error"
                entry["error"] = {"type": type(error).__name__, "message": str(error)[:400]}
                self.event("message.unanswered", f"    ✉ {name} could not answer {message['id']}: {error}", level=logging.ERROR)
        self.end_entry(entry)
        flows, sender = self.studyflow.flows_out.get(pool, []), flow.get("sourceRef") or ""
        # `is None`, never `or`: an element with no children is falsy, and a message flow has none.
        back = next((f for f in flows if f.get("targetRef") == sender), None)
        if back is None:
            back = next((f for f in flows if self.studyflow.pool_of(f.get("targetRef") or "") == self.studyflow.pool_of(sender)), None)
        if back is not None:
            self.send(back, reply, in_reply_to=message["id"])

    def receive(self, element_id: str) -> dict:
        """The next message along a flow into the element, waited for. A message at a boundary event of an activity
        around it ends the wait, and so does a failed pool, or senders that have nothing left to send."""
        flows = self.studyflow.flows_in.get(element_id, [])
        with self.arrived:
            while True:
                self.check_interrupt()
                for flow in flows:
                    if self.mail.get(flow.get("id")):
                        message = self.mail[flow.get("id")].pop(0)
                        self.heard(flow, message)
                        return message
                self.expect_more(element_id, flows)
                self.arrived.wait()

    def race(self, gateway_id: str, flows: list[ET.Element]) -> ET.Element:
        """An event-based gateway's branch: the one whose event happens first. Each branch starts at a catch event or a
        receive task a message flow reaches; the first message along one picks that branch, and stays in its mailbox
        for the step to take."""
        branches = []
        for flow in flows:
            target = flow.get("targetRef") or ""
            into = self.studyflow.flows_in.get(target, [])
            if not into:
                raise RuntimeError(f"{gateway_id}: an event-based gateway waits for messages, and {target} takes none. "
                                   "Start each branch with a catch event or a receive task a message flow reaches.")
            branches.append((flow, into))
        # ponytail: messages already waiting when the gateway is reached go by the branches' order, not by arrival; keep
        # arrival order in the mailbox if a study queues rival messages ahead of its gateway.
        with self.arrived:
            while True:
                self.check_interrupt()
                for flow, into in branches:
                    if any(self.mail.get(f.get("id")) for f in into):
                        return flow
                self.expect_more(gateway_id, [f for _, into in branches for f in into])
                self.arrived.wait()

    def expect_more(self, element_id: str, flows: list[ET.Element]) -> None:
        """Raise when no message will come along `flows`: a pool failed, or every sender has nothing left to send."""
        if self.failed is not None:
            raise RuntimeError(f"{element_id}: no message will come, another pool failed")
        # A pool no process depicts only answers what is sent to it, and that answer is already here.
        if all(f.get("sourceRef") in self.studyflow.participants
               or self.studyflow.pool_of(f.get("sourceRef") or "") in self.pools_done for f in flows):
            raise RuntimeError(f"{element_id} waits along {', '.join(f.get('id') for f in flows)}, and nothing is left to send")

    def heard(self, flow: ET.Element, message: dict) -> None:
        """Remember the message this pool last took from the sender's pool: what it sends back answers it."""
        self._thread.__dict__.setdefault("heard", {})[self.studyflow.pool_of(flow.get("sourceRef") or "")] = message["id"]

    def answering(self, flow: ET.Element) -> str | None:
        return self._thread.__dict__.get("heard", {}).get(self.studyflow.pool_of(flow.get("targetRef") or ""))

    def check_interrupt(self) -> None:
        """Raise when a message waits at a boundary event of an activity this pool is inside, innermost first."""
        for activity, flows in reversed(self._thread.__dict__.get("watching", [])):
            for flow_id, boundary in flows.items():
                if self.mail.get(flow_id):
                    self.mail[flow_id].pop(0)
                    raise Interrupted(activity, boundary)

    def throw(self, element: ET.Element) -> None:
        """A throw or end event sends a message along each flow out of it, carrying nothing but its arrival."""
        for flow in self.studyflow.flows_out.get(element.get("id") or "", []):
            self.send(flow, None, in_reply_to=self.answering(flow))

    def inputs_of(self, element: ET.Element) -> dict[str, Any] | None:
        """What an activity sends: its data inputs by source id; one without a value this run gives its `uri`, else
        null (the receiver reads such an element from the plan)."""
        sources = [text_of(c) for association in element if local(association) == "dataInputAssociation"
                   for c in association if local(c) == "sourceRef" and text_of(c)]
        with self.lock:
            return {source: self.values.get(source, self.studyflow.artifact(source)[0]) for source in sources} or None

    def bind_result(self, element: ET.Element, value: Any) -> None:
        """A result the walk took itself (a message's content): under the element's id, and into each data output,
        narrowed by that edge's `transformation` (`result.upper()`); a null result stays null."""
        self.store(element.get("id"), value)
        for association in element:
            if local(association) != "dataOutputAssociation":
                continue
            parts = {local(c): c for c in association}
            target, narrow = text_of(parts.get("targetRef")), parts.get("transformation")
            if not target:
                continue
            if value is not None and narrow is not None and (narrow.text or "").strip():
                self.store(target, self.evaluate(narrow.text.strip(), {"result": value}, language=narrow.get("language"), scope=element.get("id")))
            else:
                self.store(target, value)

    def pump(self, element_id: str) -> Any:
        """While a claimed element runs: each line its runner appends to `<id>.outbox.jsonl` goes along the flow it
        names, and each message along a flow into the element is appended to `<id>.inbox.jsonl` for the runner."""
        flows_out = {f.get("id"): f for f in self.studyflow.flows_out.get(element_id, [])}
        flows_in = [f.get("id") for f in self.studyflow.flows_in.get(element_id, [])]
        cache = self.repo_dir / ".cache"
        for box in ("outbox", "inbox"):
            (cache / f"{element_id}.{box}.jsonl").unlink(missing_ok=True)

        def run(cache: Path, stop: threading.Event) -> None:
            outbox, inbox, done = cache / f"{element_id}.outbox.jsonl", cache / f"{element_id}.inbox.jsonl", 0
            while True:
                last = stop.is_set()  # one more pass after the runner exits, for what it wrote last
                data = outbox.read_bytes() if outbox.exists() else b""
                end = data.rfind(b"\n") + 1  # whole lines only: the runner may be writing the next one
                for line in data[done:end].splitlines():
                    try:
                        message = json.loads(line)
                        flow = flows_out[message["flow"]]
                    except (ValueError, KeyError, TypeError):
                        self.event("message.misrouted", f"    ✉ {element_id} sent {line[:80]!r} along none of its flows", level=logging.WARNING)
                        continue
                    self.send(flow, message.get("content"), message.get("id"), message.get("inReplyTo"))
                done = end
                with self.arrived:
                    due = [message for flow_id in flows_in for message in self.mail.pop(flow_id, [])]
                if due:
                    with inbox.open("a") as file:
                        file.writelines(json.dumps(message, default=str) + "\n" for message in due)
                if last:
                    return
                stop.wait(0.05)

        return run

    def perform(self, element: ET.Element, depth: int, max_steps: int) -> ET.Element | None:
        """An activity, pass after pass while its loop marker asks for another. A message at one of its boundary
        events ends it at the next step, and that event is returned for the walk to go on from."""
        element_id = element.get("id") or ""
        watching = self._thread.__dict__.setdefault("watching", [])
        watching.append((element_id, {
            flow.get("id"): boundary
            for boundary in self.studyflow.boundaries.get(element_id, [])
            for flow in self.studyflow.flows_in.get(boundary.get("id") or "", [])
        }))
        try:
            passes = 0
            while self.loops_again(element, passes):
                passes += 1
                if passes > max_steps:
                    raise RuntimeError(f"{element_id}: loop budget exhausted — does its loop ever end?")
                if local(element) in CONTAINER_TAGS:
                    self.walk_container(element, depth, max_steps)
                else:
                    self.run_activity(element)
        except Interrupted as interrupt:
            if interrupt.activity != element_id:
                raise
            return interrupt.boundary
        finally:
            watching.pop()
        return None

    def loops_again(self, element: ET.Element, passes: int) -> bool:
        """Whether an activity takes another pass after `passes`: once without a loop marker; with one, while its
        `loopCondition` holds (tested first when `testBefore`), up to `loopMaximum`, and with no condition until
        a boundary event ends it."""
        marker = next((c for c in element if local(c) == "standardLoopCharacteristics"), None)
        if marker is None:
            return passes == 0
        if passes == 0 and marker.get("testBefore") != "true":
            return True
        if marker.get("loopMaximum") and passes >= int(marker.get("loopMaximum")):
            return False
        condition = next((c for c in marker if local(c) == "loopCondition"), None)
        if condition is None or not (condition.text or "").strip():
            return True
        return bool(self.evaluate(condition.text.strip(), language=condition.get("language"), scope=element.get("id")))

    def walk_container(self, element: ET.Element, depth: int, max_steps: int) -> None:
        element_id = element.get("id") or ""
        entry = self.record.begin(element_id, self.studyflow.name_of(element_id), bpmn_type(element))
        self.event("activity.started", f"⊞ {element_id}")
        self.start_scope(element_id, reset=True)
        try:
            self.walk(self.studyflow.start_event(element), depth + 1, max_steps)
        except Interrupted as interrupt:
            entry["interruptedBy"] = interrupt.boundary.get("id")
            self.record.end(entry)
            raise
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
                reached = self.state.tree.setdefault("_meta", {}).setdefault("reached", {})
                reached[element_id] = reached.get(element_id, 0) + 1
                with self.arrived:
                    self.check_interrupt()
                tag = local(element)
                name = self.studyflow.name_of(element_id)

                if tag in END_TAGS:
                    entry = self.record.begin(element_id, name, bpmn_type(element))
                    # A runner may claim the end too: its chance to fold what it started for the study.
                    runner = self.runner_for(element)
                    if runner is not None:
                        self.execute_via_runner(element, entry, runner)
                    self.throw(element)
                    self.record.end(entry)
                    self.reached[element_id] = self.moment()
                    self.event("event.reached", f"● {element_id}")
                    self.debug_state(element_id)
                    return
                if tag == "parallelGateway" and len(self.studyflow.outgoing.get(element_id, [])) > 1:
                    # Each pool is one path, as in the browser runtime; walking on would run the first branch only.
                    raise RuntimeError(
                        f"{element_id}: a parallel split, and a pool walks one path. "
                        "Put the steps in sequence, or give each branch a pool of its own."
                    )
                if tag in GATEWAY_TAGS:
                    self.event("gateway.reached", f"◇ {element_id}")
                elif tag in PASSTHROUGH_TAGS:
                    entry = self.record.begin(element_id, name, bpmn_type(element))
                    runner = self.runner_for(element) if tag == "intermediateCatchEvent" else None
                    try:
                        if runner is not None:
                            # A catch event a partial runner executes blocks in its subprocess until sensed.
                            self.event("event.waiting", f"◐ {element_id}  (waiting via {runner.name})")
                            sensed = runner.element(element_id, self.json_values())
                            entry["_runnerMs"] = sensed.get("durationMs")
                            self.store(element_id, sensed.get("result"))
                        elif self.studyflow.flows_in.get(element_id):
                            # A catch event a message flow reaches waits for that message; its content is the result.
                            self.event("event.waiting", f"◐ {element_id}  (waiting for a message)")
                            self.store(element_id, self.receive(element_id)["content"])
                    except Interrupted:
                        self.end_entry(entry)
                        raise
                    except BaseException as error:
                        self.record.fail(entry, error)
                        entry.pop("_runnerMs", None)
                        raise
                    self.throw(element)
                    self.end_entry(entry)
                    self.reached[element_id] = self.moment()
                    self.event("event.reached", f"○ {element_id}")
                else:
                    boundary = self.perform(element, depth, max_steps)
                    if boundary is not None:
                        # The activity ended at one of its boundary events: the walk goes on from there.
                        boundary_id = boundary.get("id")
                        self.state.trace.append(boundary_id)
                        reached[boundary_id] = reached.get(boundary_id, 0) + 1
                        self.reached[boundary_id] = self.moment()
                        self.event("event.reached", f"○ {boundary_id}  (ended {element_id})")
                        element = self.next_element(boundary)
                        continue

                # After next_element, so a gateway's decision is in its record entry too.
                following = self.next_element(element)
                self.debug_state(element_id)
                element = following
        finally:
            self.depth = outer

    def archive_plan(self, name: str, convert: str | None) -> Path:
        self.repo_dir.mkdir(parents=True, exist_ok=True)
        # Skipped steps keep the record of the run that did the work. A branching run *supersedes*
        # work records instead of replacing them (the first branch's stay, so the trail shows both
        # branches), and start/end events supersede too, so a replay walks every run end to end.
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
            *((eid, "imported", {}) for eid in sorted(self.staged)),
            *((eid, "reused", {"what": trusted}) for eid, (_, trusted) in sorted(self.reused.items())),
        ]
        moments = {
            **self.staged, **self.completed, **self.reached, **self.produced,
            **{eid: when for eid, (_, when) in self.decisions.items()},
            **{eid: when for eid, (when, _) in self.reused.items()},
        }
        stamped = self.studyflow.plan
        run = self.repo_dir.name
        stamped = PROV.write_state(stamped, self.state.tree, self.studyflow.process.get("id") or "")
        for element_id, action, extra in entries:
            stamped = PROV.insert_element_entry(
                stamped, element_id, replace_action=replaced(action, element_id),
                action=action, when=moments[element_id], run=run, **extra,
            )
        plan = archive(self.repo_dir, name, stamped, convert)
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


def archive(repo_dir: Path, name: str, xml: str, convert: str | None) -> Path:
    """The diagram, kept as `name` in the run repository: this BPMN itself, or what `convert <diagram.bpmn> <name>`
    makes of it (`studyflow run` hands its own `convert`, so the copy keeps the format of the study it ran)."""
    target = repo_dir / name
    if convert:
        bpmn = repo_dir / ".cache" / "archive.bpmn"
        bpmn.parent.mkdir(parents=True, exist_ok=True)
        bpmn.write_text(xml)
        try:
            done = subprocess.run([*shlex.split(convert), str(bpmn), str(target)], capture_output=True, text=True, check=False)
            failure = (done.stderr.strip() or f"exited {done.returncode}") if done.returncode else None
        except OSError as error:
            failure = str(error)
        if not failure:
            return target
        # The stamps are the run's record: kept as BPMN rather than lost with a copy that could not be made.
        target = repo_dir / (re.sub(r"(\.studyflow)?\.[^.]*$", "", name) + ".bpmn")
        log_event("diagram.unconverted", f"  {name}: {failure} — archived as {target.name}", level=logging.WARNING)
    target.write_text(xml)
    return target


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
    runs = Path.home() / ".studyflow" / "runs"
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
        help="a .bpmn/.xml (`studyflow run` converts a .studyflow.yaml or .studyflow.png into one)",
    )
    parser.add_argument(
        "--repo", type=Path, default=None, metavar="DIR",
        help="the run repository to write into, its name being the run id (default: the diagram's own "
             "directory when the diagram already lives in one, else a fresh ~/.studyflow/runs/<YYMMDD+codename>)",
    )
    parser.add_argument(
        "--inputs", action="append", default=[], type=Path, metavar="DIR",
        help="also stage boundary inputs from DIR, after the diagram's own directory and before the working directory; "
             "repeatable (`studyflow run` passes the folder of the .studyflow.yaml or .studyflow.png it converted)",
    )
    parser.add_argument(
        "--archive", default=None, metavar="NAME=COMMAND",
        help="keep the diagram in the run repository as NAME, written by `COMMAND <diagram.bpmn> <NAME>` "
             "(`studyflow run` passes the name of the .studyflow.yaml or image it converted, and its own `convert`)",
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

    started = datetime.now(timezone.utc).astimezone()
    stamp = run_stamp(started)
    repo_dir = resolve_repo_dir(args.repo, args.studyflow, started)
    run_id = repo_dir.name
    start_logging(repo_dir, args.quiet)
    who = PROV.current_user()
    repo = PROV.RunRepo(repo_dir)
    # A run interrupted mid-commit leaves git's lock behind; nothing else commits into a run repository.
    (repo_dir / ".git" / "index.lock").unlink(missing_ok=True)
    repo.open()
    # A repository created just now has nothing to attribute to anyone: its baseline is the `started` commit.
    if not repo.created and repo.dirty():
        repo.commit(
            "changed outside a run",
            {"Prov-Action": "modified", "Prov-When": timeline_timestamp(started)},
            when=timeline_timestamp(started),
        )

    # Root seed: read from the diagram, never drawn here. Partial runners read the same file,
    # so every process seeds identically. A diagram without a seed runs unseeded.
    probe = read_studyflow(args.studyflow)
    seed = probe.seed
    try:
        random.seed(int(seed))
    except (TypeError, ValueError):
        pass  # no seed, or a non-numeric one, seeds nothing

    # The runners, once the study is read: its `dependencies` go into every script runner's environment.
    runner_flags = [flag for flag, wanted in (("--sim", args.sim), ("--auto", args.auto)) if wanted]
    runners = discover_runners(runner_flags, study_dependencies(probe))
    for spec in args.runner:
        name, separator, command = spec.partition("=")
        if not separator or not name or not command:
            parser.error(f"--runner wants NAME=COMMAND, got {spec!r}")
        runners[name] = (command, None)

    # The input file is never touched; the stamp lands on the archived copy.
    studyflow = read_studyflow(args.studyflow, stamp={
        "action": "executed",
        "when": timeline_timestamp(started),
        "who": who,
        "with": "studyflow-run-local.py",
        "run": run_id,
        "seed": seed,
    })
    # The diagram is read before the fork below, because forking reverts the copy this may be reading from.
    # Branching has first claim on the run's branch name; a detached HEAD only attaches without one.
    invalidated = PROV.invalidated_elements(probe)
    branched = False
    if repo.active and (args.from_ref or invalidated):
        point = PROV.branch_point(repo, invalidated, args.from_ref)
        # Branches are the only refs; runs live as `started`/`finished` boundary commits.
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
    archive_name, convert = args.studyflow.name, None
    if args.archive:
        archive_name, _, convert = args.archive.partition("=")
    archived = archive(repo_dir, archive_name, studyflow.plan, convert)
    log_event("diagram.archived", f"  → {shown(archived)}", level=logging.DEBUG)
    runner = Runner(
        studyflow, repo_dir,
        input_sources=list(dict.fromkeys([args.studyflow.parent.resolve(), *(d.resolve() for d in args.inputs), Path.cwd()])),
        started=started,
        seed=seed, fresh=args.fresh,
        repo=repo, branched=branched,
        runners=runners, debug=args.debug,
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
    study_id = studyflow.root.get("id") or ""
    repo.commit(
        f"started {study_id} ({stamp})", document_stamp,
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
        runner.archive_plan(archive_name, convert)
        runner.record.finish(runner.record.status)
        runner.finish()
        # Entries no element commit claimed (end events, a failed parse) close out in the summary body.
        closing = {**runner.record.summary(), "tail": runner.record.steps_since(runner.recorded)}
        repo.commit(
            f"finished {study_id} ({runner.record.status})", document_stamp,
            when=timeline_timestamp(datetime.now(timezone.utc)),
            body=json.dumps(closing, default=str),
        )
        logging.shutdown()
    return 0 if runner.record.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6.0",
#   # Below here belongs to the shipped sklearn_pipeline example, not the runner.
#   "pandas>=2.0",
#   "scikit-learn>=1.4",
#   "joblib>=1.3",
#   "matplotlib>=3.8",
#   # `format="parquet"` also needs pandas' parquet engine: `--with pyarrow`.
# ]
# ///
"""A reference runner for the studyflow execution contract.

It keeps one claim honest: a studyflow is executable as it stands, with no
companion script telling an engine what the boxes mean. See README.md for the
contract this implements and the terms it writes.

    uv run studyflow_run.py ../../assets/examples/sklearn_pipeline.studyflow.png

Each run writes `runs/<timestamp>/`: the artifacts the `uri`s name, a copy of
the studyflow stamped `executed` (the copy carries its own run record), and
`studyflow.log`. Expressions run in the evaluating engine's own language
(Python here, JavaScript in the browser runner) unless BPMN's per-expression
`language` attribute says otherwise. The walk is one token: no parallel
gateways, no multi-instance fan-out.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import importlib
import json
import logging
import random
import re
import shutil
import struct
import sys
import time
import traceback
import zlib
from collections.abc import Callable
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from xml.sax.saxutils import quoteattr

import yaml

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"
PROV_TRAIL = "https://w3id.org/studyflow/prov"


def studyflow_attr(element: ET.Element, name: str) -> str | None:
    return element.get(f"{{{STUDYFLOW}}}{name}")


def studyflow_child(element: ET.Element, name: str) -> ET.Element | None:
    return element.find(f"{{{STUDYFLOW}}}{name}")


DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore"}
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


def split_binding(text: str | None) -> tuple[str | None, str | None]:
    """Grammar: `slot = selection`, either half optional; `==` belongs to the selection, not the split."""
    value = (text or "").strip()
    if not value:
        return None, None
    if re.fullmatch(r"self|\*|[A-Za-z_]\w*", value):
        return value, None
    both = re.fullmatch(r"(self|\*|[A-Za-z_]\w*)\s*=(?!=)\s*(\S.*)", value)
    if both:
        return both.group(1), both.group(2).strip()
    return None, value


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

    to_file = logging.FileHandler(path, encoding="utf-8")
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


def summarize(value: Any) -> str:
    described = describe(value)
    if "shape" in described:
        return f"{described['type']} {'×'.join(str(n) for n in described['shape'])}"
    if "size" in described:
        return f"{described['type']}[{described['size']}]"
    if "value" in described:
        return f"{described['type']} {described['value']!r}"
    return described["type"]


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


def trail_timestamp(moment: datetime) -> str:
    """ISO 8601, second precision, local numeric offset. Older files carry `Z` stamps."""
    return moment.astimezone().replace(microsecond=0).isoformat()


TRAIL_FIELDS = ("action", "when", "who", "with", "what", "run", "seed", "note")


def insert_element_entry(xml: str, element_id: str, replace_action: str | None = None, **fields: str) -> str:
    """Text, not tree: ElementTree rewrites every namespace prefix, so a stamped copy would diff everywhere."""
    definitions = re.search(r"<(?:[\w.-]+:)?definitions\b[^>]*>", xml)
    if definitions is None:
        return xml

    bound = re.search(rf'xmlns:([\w.-]+)\s*=\s*"{re.escape(PROV_TRAIL)}"', xml)
    if bound:
        prefix = bound.group(1)
    else:
        prefix = "prov" if not re.search(r'xmlns:prov\s*=\s*"', xml) else "sfprov"
        opening = definitions.group(0)
        declared = opening[:-1].rstrip("/") + f' xmlns:{prefix}="{PROV_TRAIL}">'
        xml = xml[:definitions.start()] + declared + xml[definitions.end():]

    ordered = [(name, fields[name]) for name in TRAIL_FIELDS if fields.get(name)]
    entry = f"<{prefix}:activity " + " ".join(f"{k}={quoteattr(v)}" for k, v in ordered) + " />"

    element = re.search(rf'<((?:[\w.-]+:)?)[\w.-]+\b[^>]*\bid="{re.escape(element_id)}"[^>]*>', xml)
    if element is None or element.group(0).endswith("/>"):
        return xml

    line_start = xml.rfind("\n", 0, element.start()) + 1
    lead = xml[line_start:element.start()]
    indent = lead if lead.isspace() or lead == "" else ""

    cursor = element.end()
    while True:
        doc = re.match(r"\s*<((?:[\w.-]+:)?)documentation\b[^>]*>", xml[cursor:])
        if doc is None:
            break
        if doc.group(0).endswith("/>"):
            cursor += doc.end()
        else:
            close = f"</{doc.group(1)}documentation>"
            cursor = xml.index(close, cursor + doc.end()) + len(close)

    existing = re.match(r"\s*<((?:[\w.-]+:)?)extensionElements>", xml[cursor:])
    if existing:
        block_open_end = cursor + existing.end()
        close_tag = f"</{existing.group(1)}extensionElements>"
        close_at = xml.index(close_tag, block_open_end)
        block = xml[block_open_end:close_at]
        if replace_action:
            block = re.sub(
                rf"\n[ \t]*<{re.escape(prefix)}:activity\b[^>]*\baction={re.escape(quoteattr(replace_action))}[^>]*/>",
                "", block,
            )
        block = block.rstrip() + "\n" + indent + "    " + entry + "\n" + indent + "  "
        return xml[:block_open_end] + block + xml[close_at:]

    wrapper_prefix = element.group(1)
    block = (
        f"\n{indent}  <{wrapper_prefix}extensionElements>"
        f"\n{indent}    {entry}"
        f"\n{indent}  </{wrapper_prefix}extensionElements>"
    )
    return xml[:cursor] + block + xml[cursor:]


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
    if stamp:
        probe = Studyflow(ET.fromstring(xml))
        xml = insert_element_entry(xml, probe.process.get("id") or "", **stamp)
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

    def element_records(self) -> dict[str, str]:
        """Element id -> the run that executed it. An `invalidated` entry voids the matching `executed`."""
        records: dict[str, str] = {}
        process_id = self.process.get("id")
        for element_id, element in self.elements.items():
            if element_id == process_id:
                continue
            executed: str | None = None
            invalidated: set[str] = set()
            invalidates_all = False
            for ext in element:
                if local(ext) != "extensionElements":
                    continue
                for child in ext:
                    if child.tag != f"{{{PROV_TRAIL}}}activity":
                        continue
                    action = child.get("action")
                    run = child.get("run")
                    if action == "executed" and run:
                        executed = run
                    elif action == "invalidated":
                        if run:
                            invalidated.add(run)
                        else:
                            invalidates_all = True
            if executed and not invalidates_all and executed not in invalidated:
                records[element_id] = executed
        return records

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



def format_for(uri: str, declared: str | None) -> str:
    if declared:
        return declared
    return Path(uri).suffix.lstrip(".").lower()


def load_artifact(path: Path, fmt: str) -> Any:
    if fmt == "parquet":
        import pandas
        return pandas.read_parquet(path)
    if fmt == "csv":
        import pandas
        return pandas.read_csv(path)
    if fmt == "json":
        return json.loads(path.read_text())
    if fmt == "joblib":
        import joblib
        return joblib.load(path)
    raise ValueError(f"no handler for format {fmt!r} ({path})")


def save_artifact(value: Any, path: Path, fmt: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fmt == "parquet":
        value.to_parquet(path)
    elif fmt == "csv":
        import pandas
        positional = isinstance(value.index, pandas.RangeIndex)
        value.to_csv(path, index=not positional)
    elif fmt == "json":
        path.write_text(json.dumps(value, indent=2, default=str))
    elif fmt == "joblib":
        import joblib
        joblib.dump(value, path)
    elif fmt in ("png", "svg", "pdf"):
        value.savefig(path, dpi=150, bbox_inches="tight")
    else:
        raise ValueError(f"no handler for format {fmt!r} ({path})")


def write_digits_table(path: Path) -> None:
    from sklearn.datasets import load_digits

    frame = load_digits(as_frame=True).frame
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)


# Not part of the contract: a shipped example's boundary inputs, keyed by `uri`. `--no-prepare-inputs` skips them.
BOUNDARY_INPUTS: dict[str, Callable[[Path], None]] = {
    "digits.csv": write_digits_table,
}


class State:
    """Readable by expressions as `state`, so a drawn cycle can bound itself: `state.trace.count('Gate') < 8`."""

    def __init__(self) -> None:
        self.trace: list[str] = []


def plain(value: Any) -> Any:
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        return value.item()
    return value


def describe(value: Any) -> dict:
    """What a value *is*, never what it contains — no participant data reaches the record."""
    value = plain(value)
    kind = type(value)
    name = kind.__name__ if kind.__module__ == "builtins" else f"{kind.__module__}.{kind.__qualname__}"
    if value is None or isinstance(value, (str, int, float, bool)):
        return {"type": name, "value": value}
    shape = getattr(value, "shape", None)
    if shape is not None:
        return {"type": name, "shape": [int(n) for n in shape]}
    try:
        return {"type": name, "size": len(value)}
    except TypeError:
        return {"type": name, "repr": repr(value)[:160]}


def digest_of(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


class RunRecord:
    def __init__(self, plan: str, seed: str | None, started: datetime) -> None:
        self.plan_digest = digest_of(plan.encode())
        self.seed = seed
        self.started = started
        self.status = "ok"

    def begin(self, element_id: str, name: str, element_type: str) -> dict:
        entry: dict[str, Any] = {
            "node": element_id,
            "name": name,
            "type": element_type,
            "startedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "status": "ok",
        }
        entry["_clock"] = time.perf_counter()
        return entry

    def end(self, entry: dict) -> None:
        entry["durationMs"] = round((time.perf_counter() - entry.pop("_clock")) * 1000, 1)

    def fail(self, entry: dict, error: BaseException) -> None:
        entry["status"] = "error"
        entry["error"] = {
            "type": type(error).__name__,
            "message": str(error)[:400],
            "traceback": traceback.format_exc().splitlines()[-6:],
        }
        self.status = "error"
        if "_clock" in entry:
            self.end(entry)




def resolve_implementation(implementation: str) -> Any:
    if not implementation.startswith("python://"):
        raise ValueError(f"this runner only implements python://, not {implementation!r}")
    path = implementation[len("python://"):].split("@")[0]
    parts = path.split(".")
    for cut in range(len(parts), 0, -1):
        try:
            module = importlib.import_module(".".join(parts[:cut]))
        except ImportError:
            continue
        target = module
        for attribute in parts[cut:]:
            target = getattr(target, attribute)
        return target
    raise ImportError(f"cannot import {path!r}")


class Runner:
    def __init__(
        self,
        studyflow: Studyflow,
        workdir: Path,
        rundir: Path | None = None,
        started: datetime | None = None,
        prepare_inputs: bool = True,
        seed: str | None = None,
        fresh: bool = False,
    ) -> None:
        self.studyflow = studyflow
        # Inputs resolve against the shared workdir; everything written belongs to this run's dir.
        self.workdir = workdir
        self.rundir = rundir or workdir
        self.prepare_inputs = prepare_inputs
        self.values: dict[str, Any] = {}
        self.state = State()
        self.depth = 0
        self._deferred: list[tuple[str, str, int, str]] | None = None
        self.prior_records = {} if fresh else studyflow.element_records()
        self.completed: dict[str, str] = {}
        self.reached: dict[str, str] = {}
        self.decisions: dict[str, tuple[str, str]] = {}
        self.produced: dict[str, str] = {}
        self.staged: dict[str, str] = {}
        self.tainted: set[str] = set()
        self.record = RunRecord(
            studyflow.plan,
            seed if seed is not None else studyflow_attr(studyflow.process, "seed"),
            started or datetime.now(timezone.utc),
        )

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
        return trail_timestamp(datetime.now(timezone.utc))

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

    def value_of(self, element_id: str) -> Any:
        if element_id in self.values:
            return self.values[element_id]
        uri, declared = self.studyflow.artifact(element_id)
        if uri:
            path = self.rundir / uri
            fmt = format_for(uri, declared)
            if not path.exists():
                self.stage_input(element_id, uri, path)
            value = load_artifact(path, fmt)
            self.values[element_id] = value
            self.event(
                "artifact.loaded",
                f"    ▤ load {uri}  {fmt}, {human_bytes(path.stat().st_size)} → {summarize(value)}",
            )
            return value
        raise KeyError(f"nothing has bound {element_id!r} and it declares no uri")

    def stage_input(self, element_id: str, uri: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        source = self.workdir / uri
        if source.exists() and not source.samefile(path.parent):
            shutil.copyfile(source, path)
            if not self.studyflow.is_product(element_id):
                self.staged[element_id] = self.moment()
            self.event(
                "artifact.staged",
                f"    ▤ stage {uri}  {human_bytes(path.stat().st_size)}, from {self.shown(source)}",
            )
            return
        build = BOUNDARY_INPUTS.get(uri) if self.prepare_inputs else None
        if build is None:
            raise FileNotFoundError(
                f"{source} does not exist. {self.studyflow.name_of(element_id)} is a boundary "
                "input: no step of this studyflow produces it, so something outside has to "
                "put it there.",
            )
        build(path)
        self.staged[element_id] = self.moment()
        self.event(
            "artifact.prepared",
            f"    ▤ prepare {uri}  {human_bytes(path.stat().st_size)}, a boundary input this studyflow ships",
        )

    def resolve_argument(self, value: Any) -> Any:
        """`$Name` reads a bound value; a mapping with `implementation` is a call first."""
        if isinstance(value, str) and value.startswith("$"):
            reference = value[1:]
            head, _, tail = reference.partition(".")
            resolved = self.value_of(head)
            for field in filter(None, tail.split(".")):
                resolved = resolved[field] if isinstance(resolved, dict) else getattr(resolved, field)
            return resolved
        if isinstance(value, dict) and "implementation" in value:
            nested = self.resolve_arguments(value.get("arguments") or {})
            return resolve_implementation(value["implementation"])(*nested.pop("__args__", []), **nested)
        if isinstance(value, dict):
            return {k: self.resolve_argument(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.resolve_argument(v) for v in value]
        return value

    def resolve_arguments(self, arguments: dict) -> dict:
        resolved: dict[str, Any] = {}
        for key, value in (arguments or {}).items():
            if key == "args":
                resolved["__args__"] = [self.resolve_argument(v) for v in value]
            else:
                resolved[key] = self.resolve_argument(value)
        return resolved

    def stale_inputs(self, element: ET.Element) -> bool:
        if not self.tainted:
            return False
        sources, expressions = self.studyflow.activity_dependencies(element)
        if sources & self.tainted:
            return True
        for tainted_id in self.tainted:
            name = self.studyflow.names.get(tainted_id)
            if tainted_id in expressions:
                return True
            if name and (name in sources or name in expressions):
                return True
        return False

    def skip_activity(self, element: ET.Element, element_id: str) -> str:
        """Verdicts: `skipped`, `volatile` (a memory-only output), `invalid` (artifact gone or unreadable)."""
        targets: list[str] = []
        for target_id in output_targets(element):
            uri, _ = self.studyflow.artifact(target_id)
            if not uri:
                return "volatile"
            targets.append(target_id)
        try:
            for target_id in targets:
                if self.studyflow.consumes(target_id):
                    self.value_of(target_id)
                else:
                    self.ensure_artifact(target_id)
        except BaseException:  # noqa: BLE001 - a failed load means a real run
            return "invalid"
        return "skipped"

    def ensure_artifact(self, element_id: str) -> None:
        uri, _ = self.studyflow.artifact(element_id)
        path = self.rundir / uri
        if not path.exists():
            self.stage_input(element_id, uri, path)

    def run_activity(self, element: ET.Element) -> None:
        element_id = element.get("id")
        prior_run = self.prior_records.get(element_id)
        stale = self.stale_inputs(element)
        replay = None
        verdict = None
        if prior_run and not stale:
            with self.deferred_events() as replay:
                verdict = self.skip_activity(element, element_id)
            if verdict == "skipped":
                self.event("activity.skipped", f"↻ {element_id}  (outputs from run {prior_run})")
                replay()
                return
        name = self.studyflow.name_of(element_id)
        self.event("activity.started", f"□ {element_id}")
        if replay:
            replay()
        if stale and prior_run:
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
            self.event(
                "activity.failed", f"    {element_id}: {type(error).__name__}: {error}",
                level=logging.ERROR,
            )
            raise
        self.record.end(entry)
        self.completed[element_id] = self.moment()
        # Taint what was re-made, so recorded consumers re-run too; a `volatile` re-run taints nothing.
        if stale or verdict == "invalid" or (prior_run is None and bool(self.prior_records)):
            self.tainted.add(element_id)
            self.tainted.update(output_targets(element))
        self.event(
            "activity.finished", f"    {element_id} done in {entry['durationMs']}ms",
            level=logging.DEBUG,
        )

    def execute_activity(self, element: ET.Element, entry: dict) -> None:
        implementation = element.get("implementation")
        if implementation:
            entry["implementation"] = implementation

        keywords: dict[str, Any] = {}
        receiver: list[Any] = []
        used: list[str] = []
        # Standard form names slots structurally: an association targets a `bpmn:DataInput` whose `name` is the slot.
        io_slots: dict[str, str] = {}
        io = next((c for c in element if local(c) == "ioSpecification"), None)
        if io is not None:
            for declared_input in io:
                if local(declared_input) == "dataInput" and declared_input.get("id"):
                    io_slots[declared_input.get("id")] = declared_input.get("name") or ""
        for association in element:
            if local(association) != "dataInputAssociation":
                continue
            narrow = next((c for c in association if local(c) == "transformation"), None)
            slot, lens = split_binding((narrow.text or "").strip() if narrow is not None else "")
            lens_language = narrow.get("language") if narrow is not None else None
            if not slot:
                target = next((c for c in association if local(c) == "targetRef"), None)
                slot = io_slots.get((target.text or "").strip()) if target is not None else None
            for source in association:
                if local(source) != "sourceRef":
                    continue
                source_id = (source.text or "").strip()
                value = self.value_of(source_id)
                if lens:
                    value = self.evaluate(lens, language=lens_language)
                name = slot or self.studyflow.names.get(source_id) or source_id
                if name in ("self", "*"):
                    # Positional, not keyword: `self` is an unbound method's receiver, `*` feeds a `*args` callable.
                    receiver.append(value)
                else:
                    keywords[name] = value
                if source_id not in used:
                    used.append(source_id)
                bound = {"parameter": name, "sourceRef": source_id}
                if slot or lens:
                    bound["transformation"] = f"{slot} = {lens}" if slot and lens else (slot or lens)
                entry.setdefault("inputs", []).append({**bound, **describe(value)})
                self.event(
                    "dataInputAssociation.bound",
                    f"    {name} ← {lens or self.studyflow.name_of(source_id)}  {summarize(value)}",
                )

        declared = studyflow_child(element, "additionalArguments")
        arguments = yaml.safe_load(declared.text) if declared is not None and declared.text else {}
        resolved = self.resolve_arguments(arguments or {})
        positional = receiver + resolved.get("__args__", [])

        clashes = sorted(set(resolved) & set(keywords))
        if clashes:
            raise ValueError(
                f"{element.get('id')}: {', '.join(clashes)} bound by both a data association and `additionalArguments`. "
                "Associations fill the signature; `additionalArguments` adds to it — remove one.",
            )
        if resolved:
            recorded = {k: describe(v) for k, v in resolved.items() if k != "__args__"}
            if resolved.get("__args__"):
                recorded["args"] = [describe(v) for v in resolved["__args__"]]
            entry["additionalArguments"] = recorded
        keywords.update({k: v for k, v in resolved.items() if k != "__args__"})

        if used:
            entry["used"] = used

        if not implementation:
            self.event(
                "implementation.missing", "    (no implementation — nothing to call)",
                level=logging.WARNING,
            )
            return
        target = resolve_implementation(implementation)
        self.event("implementation.resolved", f"    implementation {implementation}")
        result = target(*positional, **keywords)

        for association in element:
            if local(association) != "dataOutputAssociation":
                continue
            target_ref = next((c for c in association if local(c) == "targetRef"), None)
            if target_ref is None:
                continue
            target_id = (target_ref.text or "").strip()
            narrow = next((c for c in association if local(c) == "transformation"), None)
            expression = (narrow.text or "").strip() if narrow is not None else ""
            language = narrow.get("language") if narrow is not None else None
            bound_value = (
                self.evaluate(expression, {"result": result}, language=language)
                if expression else result
            )
            self.store(target_id, bound_value)
            entry.setdefault("generated", []).append(target_id)
            entry.setdefault("outputs", []).append({
                "targetRef": target_id,
                "binding": expression or "result",
                **describe(bound_value),
            })
            self.event(
                "dataOutputAssociation.bound",
                f"    {self.studyflow.name_of(target_id)} ← {expression or 'result'}"
                f"  {summarize(bound_value)}",
            )

            uri, declared_format = self.studyflow.artifact(target_id)
            if uri:
                path = self.rundir / uri
                fmt = format_for(uri, declared_format)
                save_artifact(bound_value, path, fmt)
                self.produced[target_id] = self.moment()
                self.event(
                    "artifact.saved",
                    f"    ▤ save {uri}  {fmt}, {human_bytes(path.stat().st_size)}",
                )

    def next_element(self, element: ET.Element) -> ET.Element | None:
        element_id = element.get("id")
        flows = self.studyflow.outgoing.get(element_id, [])
        if not flows:
            return None

        if local(element) in GATEWAY_TAGS:
            entry = self.record.begin(element_id, self.studyflow.name_of(element_id), bpmn_type(element))
            default_id = element.get("default")
            try:
                for flow in flows:
                    condition = next((c for c in flow if local(c) == "conditionExpression"), None)
                    if condition is None or not (condition.text or "").strip():
                        continue
                    expression = condition.text.strip()
                    language = condition.get("language")
                    verdict = self.evaluate(expression, language=language)
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
                        self.record.end(entry)
                        self.decisions[element_id] = (flow.get("id"), self.moment())
                        self.event(
                            "sequenceFlow.taken",
                            f"    {expression} → {flow.get('id')}",
                        )
                        return self.studyflow.elements.get(flow.get("targetRef"))
            except BaseException as error:
                self.record.fail(entry, error)
                raise

            chosen = next((f for f in flows if f.get("id") == default_id), None)
            if chosen is None:
                entry["status"] = "stuck"
                self.record.end(entry)
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
            self.record.end(entry)
            self.decisions[element_id] = (chosen.get("id"), self.moment())
            self.event(
                "sequenceFlow.taken",
                f"    default → {chosen.get('id')}",
            )
            return self.studyflow.elements.get(chosen.get("targetRef"))

        return self.studyflow.elements.get(flows[0].get("targetRef"))

    def run(self, max_steps: int = 1000) -> None:
        process = self.studyflow.process
        name = process.get("name") or process.get("id")
        log_event("run.started", name)
        log_event(
            "run.started",
            f"  [{process.get('id')}]  studyflow {self.record.plan_digest}"
            f"  rootSeed {self.record.seed}  workdir {self.workdir}",
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
                    self.completed[element_id] = self.moment()
                    self.event(
                        "activity.finished", f"  {element_id} done in {entry['durationMs']}ms",
                        level=logging.DEBUG,
                    )
                elif tag in PASSTHROUGH_TAGS:
                    self.record.end(self.record.begin(element_id, name, bpmn_type(element)))
                    self.reached[element_id] = self.moment()
                    self.event("event.reached", f"○ {element_id}")
                else:
                    self.run_activity(element)

                element = self.next_element(element)
        finally:
            self.depth = outer

    def shown(self, path: Path) -> Path:
        return path.relative_to(self.workdir) if path.is_relative_to(self.workdir) else path

    def archive_plan(self, source: Path) -> Path:
        self.rundir.mkdir(parents=True, exist_ok=True)
        # Skipped steps keep the record of the run that did the work.
        stamped = self.studyflow.plan
        run = self.rundir.name
        for element_id, when in sorted((self.completed | self.reached).items()):
            stamped = insert_element_entry(
                stamped, element_id, replace_action="executed",
                action="executed", when=when, run=run,
            )
        for element_id, (flow_id, when) in sorted(self.decisions.items()):
            stamped = insert_element_entry(
                stamped, element_id, replace_action="executed",
                action="executed", when=when, what=flow_id, run=run,
            )
        for element_id, when in sorted(self.produced.items()):
            stamped = insert_element_entry(
                stamped, element_id, replace_action="created",
                action="created", when=when, run=run,
            )
        for element_id, when in sorted(self.staged.items()):
            if element_id in self.produced:
                continue
            stamped = insert_element_entry(
                stamped, element_id, replace_action="imported",
                action="imported", when=when, run=run,
            )
        plan = self.rundir / source.name
        if not plan.exists():
            if source.suffix.lower() == ".png":
                plan.write_bytes(embed_studyflow_into_png(source.read_bytes(), stamped))
            else:
                plan.write_text(stamped)
        self.event("plan.archived", f"  → {self.shown(plan)}", level=logging.DEBUG)
        return plan

    def finish(self) -> None:
        elapsed = (datetime.now(timezone.utc) - self.record.started).total_seconds() * 1000
        log_event(
            "run.finished",
            f"  → {self.shown(self.rundir)}/ ({self.record.status}) in {elapsed:.1f}ms",
            level=logging.INFO if self.record.status == "ok" else logging.ERROR,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "studyflow", type=Path,
        help="a .studyflow.png with an embedded studyflow, or a .bpmn/.xml",
    )
    parser.add_argument(
        "--workdir", type=Path, default=Path.cwd(),
        help="directory the input artifact uris are relative to (default: the current one)",
    )
    parser.add_argument(
        "--runs-dir", type=Path, default=Path("runs"),
        help="where run directories go, relative to --workdir (default: runs)",
    )
    parser.add_argument(
        "--run-id", default=None,
        help="name of this run's directory under --runs-dir (default: the start time, "
             "compact ISO 8601 with the machine's UTC offset)",
    )
    parser.add_argument(
        "--fresh", action="store_true",
        help="ignore the input's per-element run records and re-run every step",
    )
    parser.add_argument(
        "--no-prepare-inputs", action="store_true",
        help="fail on a missing boundary input rather than materialize a shipped example's own",
    )
    parser.add_argument(
        "--quiet", action="store_true",
        help="no console output; the log file is written either way",
    )
    args = parser.parse_args()

    started = datetime.now(timezone.utc).astimezone()
    run_id = args.run_id or started.strftime("%Y%m%dT%H%M%S%z")
    rundir = args.workdir / args.runs_dir / run_id
    log = start_logging(rundir, args.quiet)

    # Root seed: the plan's pinned value, else drawn once — recorded either way, so an unpinned run replays.
    probe = read_studyflow(args.studyflow)
    seed = studyflow_attr(probe.process, "seed") or str(random.SystemRandom().randrange(10**9))
    try:
        random.seed(int(seed))
        import numpy  # noqa: PLC0415 - optional, only if the steps use it
        numpy.random.seed(int(seed) % 2**32)
    except Exception:  # noqa: BLE001, S110 - a non-numeric seed seeds nothing
        pass

    # The input file is never touched — the stamp lands on the archived copy.
    try:
        user = getpass.getuser()
    except OSError:
        user = ""
    studyflow = read_studyflow(args.studyflow, stamp={
        "action": "executed",
        "when": trail_timestamp(started),
        "who": user,
        "with": "studyflow_run.py",
        "run": run_id,
        "seed": seed,
    })
    runner = Runner(
        studyflow, args.workdir, rundir=rundir, started=started,
        prepare_inputs=not args.no_prepare_inputs,
        seed=seed, fresh=args.fresh,
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
        runner.finish()
        logging.shutdown()
    return 0 if runner.record.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

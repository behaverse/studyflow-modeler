#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6.0",
#   "prov[xml]>=2.0",   # W3C PROV's reference implementation, for provenance.jsonld
#   "rdflib>=6.0",      # PROV-O in RDF, and the shortcut properties prov omits
#   "rocrate>=0.13",    # RO-Crate's own library, for ro-crate-metadata.json
#   # Below here is not the runner's: it is what the shipped sklearn_pipeline
#   # example's steps import when called, declared so the example needs no setup.
#   # Another studyflow brings its own: `uv run --with <pkg> studyflow_run.py …`.
#   "pandas>=2.0",
#   "scikit-learn>=1.4",
#   "joblib>=1.3",
#   "matplotlib>=3.8",
#   # `codec="parquet"` also needs pandas' parquet engine: `--with pyarrow`.
# ]
# ///
"""A reference runner for the studyflow execution contract.

It keeps one claim honest: a studyflow is executable as it stands, with no
companion script telling an engine what the boxes mean.

    uv run studyflow_run.py ../../assets/examples/sklearn_pipeline.png

Each run writes `results/<timestamp>/`: the artifacts the studyflow's `uri`s
name, a copy of the studyflow itself, `studyflow.log` (plain text, one line per
event, for eyes and `grep`), `provenance.jsonld` (W3C PROV, for programs), and
`ro-crate-metadata.json` (Workflow Run Crate, for handing the directory on).

See README.md for the contract this implements and the terms it writes. Two
limitations: conditions are declared as CEL but evaluated with Python's `eval`,
which agrees with CEL on the expressions studyflows use and is not CEL; and it
walks one token, so there are no parallel gateways and no multi-instance fan-out.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.metadata
import json
import logging
import re
import shutil
import struct
import sys
import time
import traceback
import zlib
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, ClassVar
from xml.etree import ElementTree as ET

import yaml
from prov.model import (
    PROV_LABEL,
    PROV_ROLE,
    PROV_TYPE,
    PROV_VALUE,
    ProvDocument,
)
from rocrate.model.computationalworkflow import ComputationalWorkflow
from rocrate.model.computerlanguage import ComputerLanguage
from rocrate.model.contextentity import ContextEntity
from rocrate.model.metadata import SUPPORTED_VERSIONS
from rocrate.rocrate import ROCrate

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
EXEC = "https://w3id.org/studyflow/exec"
STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"

DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore"}
END_TAGS = {"endEvent"}
GATEWAY_TAGS = {
    "exclusiveGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway",
}
# Containers whose children are a flow of their own.
CONTAINER_TAGS = {"subProcess", "adHocSubProcess", "transaction"}
# Elements the walk passes through without calling anything.
PASSTHROUGH_TAGS = {"startEvent", "intermediateCatchEvent", "intermediateThrowEvent"}


def local(element: ET.Element) -> str:
    """Tag name without its namespace."""
    return element.tag.split("}")[-1]


def bpmn_type(element: ET.Element) -> str:
    """The type as the modeler spells it (`bpmn:ServiceTask`), not as XML does."""
    tag = local(element)
    return f"bpmn:{tag[:1].upper()}{tag[1:]}"


# ---------------------------------------------------------------------------
# The log
# ---------------------------------------------------------------------------

LOG = logging.getLogger("studyflow")


class RunLogFormatter(logging.Formatter):
    """`time level event message`, the layout log4j and `.nextflow.log` settled on."""

    def format(self, record: logging.LogRecord) -> str:
        moment = datetime.fromtimestamp(record.created, timezone.utc).strftime("%H:%M:%S.%f")[:-3]
        event = getattr(record, "event", "message")
        message = f"{getattr(record, 'indent', '')}{record.getMessage()}"
        # 29 = `conditionExpression.evaluated`, so every message starts in the
        # same column and only the walk's indentation moves.
        line = f"{moment} {record.levelname:<5} {event:<29} {message}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


class ConsoleFormatter(logging.Formatter):
    """The same events at a terminal: message alone, indented as the walk nests."""

    def format(self, record: logging.LogRecord) -> str:
        return f"{getattr(record, 'indent', '')}{record.getMessage()}"


def start_logging(directory: Path, quiet: bool) -> Path:
    """Open `studyflow.log` in the run directory — which is already named for the run."""
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
        # `--quiet` silences the terminal, never the file.
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
    """Log one studyflow event under the studyflow noun it belongs to."""
    LOG.log(level, message, exc_info=exc_info, extra={"event": event, "indent": indent})


def human_bytes(count: int) -> str:
    """A byte count as a person would say it."""
    size = float(count)
    for unit in ("B", "KB", "MB"):
        if size < 1024 or unit == "MB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def summarize(value: Any) -> str:
    """`describe()` in one phrase — `pandas.DataFrame 1347×64`."""
    described = describe(value)
    if "shape" in described:
        return f"{described['type']} {'×'.join(str(n) for n in described['shape'])}"
    if "size" in described:
        return f"{described['type']}[{described['size']}]"
    if "value" in described:
        return f"{described['type']} {described['value']!r}"
    return described["type"]


# ---------------------------------------------------------------------------
# Reading the studyflow
# ---------------------------------------------------------------------------

def studyflow_from_png(path: Path) -> str:
    """The studyflow inside a PNG: the picture and the source are one file."""
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


def read_studyflow(path: Path) -> Studyflow:
    xml = studyflow_from_png(path) if path.suffix.lower() == ".png" else path.read_text()
    return Studyflow(ET.fromstring(xml), plan=xml)


class Studyflow:
    """The parts of a `bpmn:Definitions` this runner walks."""

    def __init__(self, definitions: ET.Element, plan: str = "") -> None:
        self.definitions = definitions
        # The plan's own bytes, so the provenance can pin the exact document.
        self.plan = plan
        self.process = self._find_process()

        # Indexed to any depth: BPMN ids are unique per document, and a nested
        # step reads the same properties as its parent's (§10.4.7).
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

        # The identifier-like names an expression or a `$ref` may use.
        self.names: dict[str, str] = {}
        for element_id, element in self.elements.items():
            name = element.get("name")
            if name and re.fullmatch(r"[A-Za-z_]\w*", name):
                self.names[element_id] = name

    def _find_process(self) -> ET.Element:
        for element in self.definitions:
            if local(element) == "process" and any(local(c) == "sequenceFlow" for c in element):
                return element
        raise ValueError("no process with a sequence flow to walk")

    def start_event(self, container: ET.Element | None = None) -> ET.Element:
        for element in container if container is not None else self.process:
            if local(element) == "startEvent":
                return element
        raise ValueError(f"no start event in {(container or self.process).get('id')}")

    def artifact(self, element_id: str) -> tuple[str | None, str | None]:
        """`uri` and `codec` of a data element, or (None, None)."""
        element = self.elements.get(element_id)
        if element is None or local(element) not in DATA_ELEMENT_TAGS:
            return None, None
        return element.get(f"{{{EXEC}}}uri"), element.get(f"{{{EXEC}}}codec")

    def name_of(self, element_id: str) -> str:
        """The element's `bpmn:name`, or its id when it has none."""
        element = self.elements.get(element_id)
        return (element.get("name") if element is not None else None) or element_id


# ---------------------------------------------------------------------------
# Artifacts
# ---------------------------------------------------------------------------

def codec_for(uri: str, declared: str | None) -> str:
    if declared:
        return declared
    return Path(uri).suffix.lstrip(".").lower()


def load_artifact(path: Path, codec: str) -> Any:
    if codec == "parquet":
        import pandas
        return pandas.read_parquet(path)
    if codec == "csv":
        import pandas
        return pandas.read_csv(path)  # see save_artifact on the index
    if codec == "json":
        return json.loads(path.read_text())
    if codec == "joblib":
        import joblib
        return joblib.load(path)
    raise ValueError(f"no codec for {codec!r} ({path})")


def save_artifact(value: Any, path: Path, codec: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if codec == "parquet":
        value.to_parquet(path)
    elif codec == "csv":
        # A CSV has no schema, so the index is a decision: row numbers are not
        # data and go, a meaningful index is what the rows are called and stays.
        import pandas
        positional = isinstance(value.index, pandas.RangeIndex)
        value.to_csv(path, index=not positional)
    elif codec == "json":
        path.write_text(json.dumps(value, indent=2, default=str))
    elif codec == "joblib":
        import joblib
        joblib.dump(value, path)
    elif codec in ("png", "svg", "pdf"):
        # A figure is an artifact like any other; `savefig` reads the suffix.
        value.savefig(path, dpi=150, bbox_inches="tight")
    else:
        raise ValueError(f"no codec for {codec!r} ({path})")


# ---------------------------------------------------------------------------
# Boundary inputs
# ---------------------------------------------------------------------------

def write_digits_table(path: Path) -> None:
    """scikit-learn's digits set as the CSV `sklearn_pipeline` declares."""
    from sklearn.datasets import load_digits

    frame = load_digits(as_frame=True).frame
    path.parent.mkdir(parents=True, exist_ok=True)
    # Row numbers are not data: the 64 pixel columns and `target` are.
    frame.to_csv(path, index=False)


# A boundary input is an artifact a run reads and no step produces, so the
# notation cannot say how to make one. This is not part of the contract: it is
# one shipped example's own input, keyed by its `uri`, so the example costs one
# command rather than two. `--no-prepare-inputs` turns even this off.
BOUNDARY_INPUTS: dict[str, Callable[[Path], None]] = {
    "digits.csv": write_digits_table,
}


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

class Visits(dict):
    """`state.visits.<id>`, attribute-readable so a drawn cycle can bound itself."""

    def __getattr__(self, name: str) -> int:
        return self.get(name, 0)


class State:
    def __init__(self) -> None:
        self.visits = Visits()


# ---------------------------------------------------------------------------
# The as-run record
# ---------------------------------------------------------------------------

def plain(value: Any) -> Any:
    """A numpy scalar as the Python number it stands for."""
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        return value.item()
    return value


def describe(value: Any) -> dict:
    """What a value *is*, never what it contains — type and size, not contents."""
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


EXEC_TERMS = "https://w3id.org/studyflow/exec#"
STUDYFLOW_TERMS = "http://behaverse.org/schemas/studyflow/v1#"
SCHEMA_TERMS = "http://schema.org/"


def qname(text: str) -> str:
    """`text` as a QName local part: no leading digit, only `A-Za-z0-9_.-`."""
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", text)
    return safe if re.match(r"[A-Za-z_]", safe) else f"_{safe}"


# PROV-O in JSON-LD is the default: both are W3C Recommendations and it is still
# JSON. PROV-JSON is a Note; PROV-N is the one to read rather than parse.
PROV_FORMATS: dict[str, tuple[str, str | None]] = {
    "jsonld": ("provenance.jsonld", "json-ld"),
    "turtle": ("provenance.ttl", "turtle"),
    "xml": ("provenance.provx", None),
    "json": ("provenance.json", None),
    "provn": ("provenance.provn", None),
}

# PROV-O states each relation twice — a shortcut and a qualified form that can
# carry a role — and means them to coexist. `prov` writes only the qualified
# form once a relation has attributes, and all of ours do, so `?a prov:used ?e`
# would return nothing. These restore the shortcut, as
# (qualified property, the property naming its target, shortcut to add).
PROV_SHORTCUTS = [
    ("qualifiedUsage", "entity", "used"),
    ("qualifiedGeneration", "activity", "wasGeneratedBy"),
    ("qualifiedDerivation", "entity", "wasDerivedFrom"),
    ("qualifiedAssociation", "agent", "wasAssociatedWith"),
]

# Stacked: Process covers runs of tools, Workflow the one that orchestrated
# them, Provenance each internal step. A studyflow run is all three.
WRROC_PROFILES = [
    ("https://w3id.org/ro/wfrun/process/0.5", "Process Run Crate", "0.5"),
    ("https://w3id.org/ro/wfrun/workflow/0.5", "Workflow Run Crate", "0.5"),
    ("https://w3id.org/ro/wfrun/provenance/0.5", "Provenance Run Crate", "0.5"),
]

SCHEMA = "http://schema.org/"
RO_TERMS = "https://w3id.org/ro/terms/workflow-run#"
BIOSCHEMAS_WORKFLOW = "https://bioschemas.org/profiles/ComputationalWorkflow/1.0-RELEASE"
# Not ro-crate-py's own 1.2: the Workflow Run profiles are written against 1.1
# and the validator holds them to it, so a 1.2 crate fails all three of them.
# `--crate-version` takes 1.2, and 1.3 once ro-crate-py supports it.
CRATE_VERSION = "1.1"


class StudyflowWorkflow(ComputationalWorkflow):
    """A workflow that is also a `HowTo`, so its flow nodes can be `HowToStep`s."""

    TYPES: ClassVar[list[str]] = [
        "File", "SoftwareSourceCode", "ComputationalWorkflow", "HowTo",
    ]


def action_status(status: str) -> dict:
    kind = "CompletedActionStatus" if status == "ok" else "FailedActionStatus"
    return {"@id": f"{SCHEMA}{kind}"}


def software_version(implementation: str) -> str:
    """The installed version of what a `python://` reference names."""
    root = implementation.removeprefix("python://").split("@")[0].split(".")[0]
    try:
        return importlib.metadata.version(root)
    except Exception:  # noqa: BLE001 - not installed as a distribution
        return str(getattr(sys.modules.get(root), "__version__", "unknown"))


def rdf_with_shortcuts(document: ProvDocument, rdf_form: str) -> str:
    """`document` as RDF, with PROV-O's shortcut properties asserted too."""
    from rdflib import Graph, Namespace

    prov = Namespace("http://www.w3.org/ns/prov#")
    graph = Graph().parse(
        data=document.serialize(format="rdf", rdf_format="turtle"), format="turtle",
    )
    for qualified, target, shortcut in PROV_SHORTCUTS:
        for subject, node in list(graph.subject_objects(prov[qualified])):
            for value in graph.objects(node, prov[target]):
                graph.add((subject, prov[shortcut], value))
    return graph.serialize(format=rdf_form)


class RunRecord:
    """What a run of the plan did, written as W3C PROV and as an RO-Crate."""

    def __init__(self, plan: str, seed: str | None, started: datetime) -> None:
        self.plan_digest = digest_of(plan.encode())
        self.seed = seed
        self.started = started
        self.executions: list[dict] = []
        self.artifacts: dict[str, dict] = {}
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
        self.executions.append(entry)
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

    def artifact(self, element_id: str, uri: str, codec: str, path: Path, produced_by: str | None) -> None:
        entry: dict[str, Any] = {"uri": uri, "codec": codec}
        if path.exists():
            data = path.read_bytes()
            entry["bytes"] = len(data)
            entry["digest"] = digest_of(data)
        if produced_by:
            entry["producedBy"] = produced_by
        self.artifacts[element_id] = entry

    def ended_at(self, entry: dict) -> datetime | None:
        """When an execution stopped — a failed step ended too; status says which."""
        if "durationMs" not in entry:
            return None
        started = datetime.fromisoformat(entry["startedAt"])
        return started + timedelta(milliseconds=entry["durationMs"])

    # -- PROV ---------------------------------------------------------------
    def prov(
        self,
        values: dict[str, Any],
        visits: dict[str, int],
        label_of: Callable[[str], str],
        run_id: str,
        plan: str,
        log: str | None = None,
    ) -> ProvDocument:
        """The run as a W3C PROV document, built with PROV's own library."""
        finished = datetime.now(timezone.utc)
        doc = ProvDocument()
        doc.add_namespace("prov", "http://www.w3.org/ns/prov#")
        doc.add_namespace("exec", EXEC_TERMS)
        doc.add_namespace("studyflow", STUDYFLOW_TERMS)
        doc.add_namespace("schema", SCHEMA_TERMS)
        # One URN per run, so two runs of the same studyflow never collide.
        doc.add_namespace("run", f"urn:studyflow:run:{qname(run_id)}:")

        agent = doc.agent("run:runner", {
            PROV_TYPE: "prov:SoftwareAgent",
            PROV_LABEL: "studyflow_run.py — the studyflow reference runner",
            "schema:runtimePlatform": f"python {sys.version.split()[0]}",
        })
        plan_entity = doc.entity("run:studyflow", {
            PROV_TYPE: "prov:Plan",
            PROV_LABEL: "the studyflow this run executed",
            "prov:atLocation": plan,
            "schema:sha256": self.plan_digest.removeprefix("sha256:"),
        })

        attributes: dict[Any, Any] = {
            PROV_LABEL: "one run of the studyflow",
            "studyflow:status": self.status,
        }
        if self.seed is not None:
            attributes["studyflow:seed"] = self.seed
        if log:
            attributes["studyflow:log"] = log
        run = doc.activity("run:run", self.started, finished, attributes)
        # A qualified Association: "this activity followed that plan" — the whole
        # prospective/retrospective claim in one triple.
        doc.wasAssociatedWith(run, agent, plan=plan_entity)

        entities: dict[str, Any] = {}
        for element_id, artifact in self.artifacts.items():
            attributes = {
                PROV_LABEL: label_of(element_id),
                "prov:atLocation": artifact["uri"],
                "exec:uri": artifact["uri"],
                "exec:codec": artifact["codec"],
            }
            if "digest" in artifact:
                attributes["schema:sha256"] = artifact["digest"].removeprefix("sha256:")
                attributes["schema:contentSize"] = artifact["bytes"]
            entities[element_id] = doc.entity(f"run:{qname(element_id)}", attributes)

        # A value with no `uri` is an entity too; omitting it would break the
        # chain between the artifacts on either side of it.
        for element_id, value in values.items():
            if element_id in entities:
                continue
            described = describe(value)
            attributes = {
                PROV_LABEL: label_of(element_id),
                "studyflow:type": described["type"],
            }
            if "shape" in described:
                attributes["studyflow:shape"] = "×".join(str(n) for n in described["shape"])
            if "size" in described:
                attributes["studyflow:size"] = described["size"]
            if "value" in described:
                attributes[PROV_VALUE] = described["value"]
            entities[element_id] = doc.entity(f"run:{qname(element_id)}", attributes)

        previous = None
        for index, entry in enumerate(self.executions):
            attributes = {
                PROV_LABEL: entry["name"],
                "studyflow:node": entry["node"],
                "studyflow:type": entry["type"],
                "studyflow:status": entry["status"],
            }
            if entry.get("implementation"):
                attributes["exec:implementation"] = entry["implementation"]
            if entry.get("arguments"):
                attributes["studyflow:arguments"] = json.dumps(
                    entry["arguments"], default=str, ensure_ascii=False,
                )
            # PROV has no notion of a choice, so a branch is an extension —
            # where PROV is silent, not a core term bent to mean something else.
            for evaluated in entry.get("conditionExpressions", []):
                attributes["studyflow:conditionExpression"] = evaluated["conditionExpression"]
                attributes["studyflow:held"] = evaluated["held"]
            if entry.get("taken"):
                attributes["studyflow:sequenceFlow"] = entry["taken"]["sequenceFlow"]
            if entry.get("error"):
                attributes["studyflow:error"] = (
                    f"{entry['error']['type']}: {entry['error']['message']}"
                )

            activity = doc.activity(
                f"run:{qname(entry['node'])}-{index}",
                datetime.fromisoformat(entry["startedAt"]), self.ended_at(entry), attributes,
            )
            doc.wasAssociatedWith(activity, agent, plan=plan_entity)
            if previous is not None:
                # One token, so each activity was informed by the one before it.
                doc.wasInformedBy(activity, previous)
            previous = activity

            # A `prov:Usage`'s `prov:role` *is* the `exec:parameter` it filled:
            # PROV already had the place for a named input.
            for bound in entry.get("inputs", []):
                source = entities.get(bound["sourceRef"])
                if source is None:
                    continue
                usage = {
                    PROV_ROLE: bound["parameter"],
                    "exec:parameter": bound["parameter"],
                }
                if bound.get("transformation"):
                    usage["exec:transformation"] = bound["transformation"]
                doc.used(activity, source, other_attributes=usage)

            for produced in entry.get("outputs", []):
                target = entities.get(produced["targetRef"])
                if target is None:
                    continue
                doc.wasGeneratedBy(target, activity, other_attributes={
                    "exec:transformation": produced["transformation"],
                })
                for source_id in entry.get("used", []):
                    source = entities.get(source_id)
                    if source is not None:
                        doc.wasDerivedFrom(target, source, activity=activity)

        # `state.visits.<id>` is engine run state: a property of the run.
        doc.entity("run:visits", {
            PROV_LABEL: "how often the walk reached each element",
            PROV_VALUE: json.dumps(dict(visits)),
        })
        doc.wasGeneratedBy("run:visits", run)

        return doc

    # -- RO-Crate -----------------------------------------------------------
    def crate(
        self,
        values: dict[str, Any],
        label_of: Callable[[str], str],
        workflow: str,
        workflow_name: str,
        parts: dict[str, str],
        version: str,
        licence: str | None = None,
    ) -> dict:
        """The run directory as a Workflow Run RO-Crate, built with ro-crate-py.

        Where PROV answers "what came from what", this answers "what is this
        directory and how do I hand it on". A gateway is schema.org's own
        `ChooseAction`, so unlike PROV it needs no extension here.
        """
        crate = ROCrate(gen_preview=False, version=version)
        # `sha256` is a registered ro-terms property, not one of RO-Crate's own.
        crate.metadata.extra_terms["sha256"] = f"{RO_TERMS}sha256"
        crate.name = workflow_name
        crate.description = (
            f"One run of {workflow_name}, executed by the studyflow reference runner. "
            f"Holds the studyflow that ran, the artifacts it produced, a log of the "
            f"walk, and the run's W3C PROV provenance."
        )
        crate.datePublished = self.started
        root = crate.dereference("./")

        if licence:
            crate.license = licence
        else:
            # RO-Crate requires a licence and the runner does not know one.
            # Saying so is truthful; inventing one would be a lie.
            crate.license = crate.add(ContextEntity(crate, "#licence-not-asserted", {
                "@type": "CreativeWork",
                "name": "Not asserted",
                "description": (
                    "These outputs carry whatever licence the studyflow and its input "
                    "data carry. The runner does not know it; pass --license to state it."
                ),
            }))

        # Both types: 1.2 wants `Profile`, the run profiles (written against
        # 1.1, which had no `Profile`) want `CreativeWork`.
        root["conformsTo"] = [
            crate.add(ContextEntity(crate, uri, {
                "@type": ["CreativeWork", "Profile"],
                "name": name,
                "version": profile_version,
            }))
            for uri, name, profile_version in WRROC_PROFILES
        ]

        language = crate.add(ComputerLanguage(crate, "#studyflow", {
            "name": "Studyflow",
            "alternateName": "BPMN 2.0 + studyflow schemas",
            "identifier": {"@id": STUDYFLOW},
            "url": {"@id": "https://github.com/behaverse/studyflow-modeler"},
            "version": STUDYFLOW,
        }))
        main = crate.add_workflow(
            dest_path=workflow, main=True, lang=language, cls=StudyflowWorkflow,
            properties={
                "name": workflow_name,
                "description": "The studyflow this run executed — the picture is the program.",
                "sha256": self.plan_digest.removeprefix("sha256:"),
                "conformsTo": {"@id": BIOSCHEMAS_WORKFLOW},
            },
        )

        # Every artifact is a part, boundary inputs included: `write_crate`
        # copies those in, since a crate pointing outside itself is not one.
        entities: dict[str, Any] = {}
        for element_id, artifact in self.artifacts.items():
            properties: dict[str, Any] = {
                "name": label_of(element_id),
                "encodingFormat": artifact["codec"],
            }
            if "digest" in artifact:
                properties["sha256"] = artifact["digest"].removeprefix("sha256:")
                properties["contentSize"] = artifact["bytes"]
            entities[element_id] = crate.add_file(
                dest_path=artifact["uri"], properties=properties,
            )

        for path, description in parts.items():
            crate.add_file(dest_path=path, properties={"description": description})

        # A value that never became a file is a PropertyValue.
        for element_id, value in values.items():
            if element_id in entities:
                continue
            entities[element_id] = crate.add(ContextEntity(
                crate, f"#{qname(element_id)}", {
                    "@type": "PropertyValue",
                    "name": label_of(element_id),
                    "value": summarize(value),
                },
            ))

        tools: dict[str, Any] = {}
        steps: list[Any] = []
        actions: list[Any] = []
        for index, entry in enumerate(self.executions):
            used = [entities[e] for e in entry.get("used", []) if e in entities]
            made = [
                entities[o["targetRef"]] for o in entry.get("outputs", [])
                if o["targetRef"] in entities
            ]
            properties = {
                "name": entry["name"],
                "startTime": entry["startedAt"],
                "actionStatus": action_status(entry["status"]),
                "description": f"{entry['type']} {entry['node']}",
            }
            ended = self.ended_at(entry)
            if ended:
                properties["endTime"] = ended.isoformat(timespec="milliseconds")
            if entry.get("error"):
                properties["error"] = (
                    f"{entry['error']['type']}: {entry['error']['message']}"
                )

            if entry.get("taken"):
                # A gateway chose, and schema.org has the verb for it.
                options = [
                    crate.add(ContextEntity(crate, f"#flow-{qname(c['sequenceFlow'])}", {
                        "@type": "PropertyValue",
                        "name": c["sequenceFlow"],
                        "value": c["conditionExpression"],
                    }))
                    for c in entry.get("conditionExpressions", [])
                ]
                taken = crate.add(ContextEntity(
                    crate, f"#flow-{qname(entry['taken']['sequenceFlow'])}", {
                        "@type": "PropertyValue",
                        "name": entry["taken"]["sequenceFlow"],
                        "value": entry["taken"].get("name") or "taken",
                    },
                ))
                action = crate.add(ContextEntity(
                    crate, f"#{qname(entry['node'])}-{index}",
                    {"@type": "ChooseAction", **properties},
                ))
                if options:
                    action["actionOption"] = options
                action["result"] = taken
                actions.append(action)
                continue

            implementation = entry.get("implementation")
            if implementation:
                tool = tools.get(implementation)
                if tool is None:
                    tool = crate.add(ContextEntity(crate, implementation, {
                        "@type": "SoftwareApplication",
                        "name": implementation.removeprefix("python://").split("@")[0],
                        "url": implementation,
                        # Which version actually ran — knowable only now.
                        "version": software_version(implementation),
                    }))
                    tools[implementation] = tool
            else:
                # An element that calls nothing still happened.
                tool = tools.setdefault("#engine", crate.add(ContextEntity(
                    crate, "#engine", {
                        "@type": "SoftwareApplication",
                        "name": "studyflow_run.py",
                        "description": "The runner itself, for elements that call nothing.",
                        "url": "https://github.com/behaverse/studyflow-modeler",
                        "version": f"python {sys.version.split()[0]}",
                    },
                )))

            action = crate.add_action(
                tool, identifier=f"#{qname(entry['node'])}-{index}",
                object=used, result=made, properties=properties,
            )
            actions.append(action)

            step = crate.add(ContextEntity(crate, f"#step-{qname(entry['node'])}-{index}", {
                "@type": "HowToStep",
                "position": index,
                "name": entry["name"],
                "workExample": tool,
            }))
            steps.append(step)
            # The join Provenance Run Crate asks for: the engine took this step
            # of the plan, and *that* execution is it.
            crate.add(ContextEntity(crate, f"#control-{qname(entry['node'])}-{index}", {
                "@type": "ControlAction",
                "name": f"orchestrate {entry['name']}",
                "instrument": step,
                "object": action,
            }))

        if steps:
            main["step"] = steps
        if tools:
            # Provenance Run Crate: the workflow must name the tools it ran.
            main["hasPart"] = list(tools.values())

        run = crate.add_action(
            main, identifier="#run",
            object=[e for e in entities.values()],
            result=[entities[e] for e in self.artifacts if e in entities],
            properties={
                "name": f"Run of {workflow_name}",
                "startTime": self.started.isoformat(timespec="milliseconds"),
                "endTime": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
                "actionStatus": action_status(self.status),
            },
        )
        root["mentions"] = [run, *actions]
        return crate.metadata.generate()


def resolve_implementation(implementation: str) -> Any:
    """Import what a step's `implementation` names, reaching into a class if it does."""
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
    ) -> None:
        self.studyflow = studyflow
        # Which root a `uri` resolves against says what kind of thing it names:
        # inputs are shared across runs, everything written belongs to this one.
        self.workdir = workdir
        self.rundir = rundir or workdir
        self.prepare_inputs = prepare_inputs
        self.values: dict[str, Any] = {}
        self.state = State()
        self.depth = 0
        # An extension attribute serializes unprefixed, so `seed` is read
        # plainly; the namespaced spelling is accepted too.
        seed = studyflow.process.get("seed") or studyflow.process.get(f"{{{STUDYFLOW}}}seed")
        self.record = RunRecord(studyflow.plan, seed, started or datetime.now(timezone.utc))

    # -- the log ----------------------------------------------------------
    @property
    def indent(self) -> str:
        """Console indentation for the container the walk is inside."""
        return "  " * (self.depth + 1)

    def event(self, event: str, message: str, *, level: int = logging.INFO) -> None:
        log_event(event, message, level=level, indent=self.indent)

    # -- values -----------------------------------------------------------
    def store(self, element_id: str, value: Any) -> None:
        self.values[element_id] = value

    def namespace(self) -> dict[str, Any]:
        """What an expression sees: every bound value, by id and by name, plus `state`."""
        space: dict[str, Any] = {"state": self.state}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.studyflow.names.get(element_id)
            if name:
                space[name] = value
        return space

    def evaluate(self, expression: str, extra: dict[str, Any] | None = None) -> Any:
        space = self.namespace()
        space.update(extra or {})
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - see module docstring

    def value_of(self, element_id: str) -> Any:
        """What a step already produced, or the artifact at the element's `uri`."""
        if element_id in self.values:
            return self.values[element_id]
        uri, declared = self.studyflow.artifact(element_id)
        if uri:
            # Read from the run directory, always — the one root every `uri` in
            # this run resolves against. An input that lives elsewhere is staged
            # in first, so the paths the provenance records are valid there by
            # construction rather than by a copy made afterwards.
            path = self.rundir / uri
            codec = codec_for(uri, declared)
            if not path.exists():
                self.stage_input(element_id, uri, path)
            value = load_artifact(path, codec)
            self.values[element_id] = value
            # A boundary input: used but not produced, and its digest is what
            # makes the run reproducible.
            self.record.artifact(element_id, uri, codec, path, None)
            self.event(
                "artifact.loaded",
                f"    load {uri}  {codec}, {human_bytes(path.stat().st_size)} → {summarize(value)}",
            )
            return value
        raise KeyError(f"nothing has bound {element_id!r} and it declares no uri")

    def stage_input(self, element_id: str, uri: str, path: Path) -> None:
        """Bring a boundary input into the run directory, by copy or by making it."""
        path.parent.mkdir(parents=True, exist_ok=True)
        source = self.workdir / uri
        if source.exists() and not source.samefile(path.parent):
            shutil.copyfile(source, path)
            self.event(
                "artifact.staged",
                f"    stage {uri}  {human_bytes(path.stat().st_size)}, from {self.shown(source)}",
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
        self.event(
            "artifact.prepared",
            f"    prepare {uri}  {human_bytes(path.stat().st_size)}, a boundary input this studyflow ships",
        )

    # -- arguments --------------------------------------------------------
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

    # -- one step ---------------------------------------------------------
    def run_activity(self, element: ET.Element) -> None:
        element_id = element.get("id")
        name = self.studyflow.name_of(element_id)
        self.event("activity.started", f"▸ {name}  [{element_id}]")
        entry = self.record.begin(element_id, name, bpmn_type(element))
        try:
            self.execute_activity(element, entry)
        except BaseException as error:
            self.record.fail(entry, error)
            self.event(
                "activity.failed", f"    {element_id}: {type(error).__name__}: {error}",
                level=logging.ERROR,
            )
            raise
        self.record.end(entry)
        self.event(
            "activity.finished", f"    {element_id} done in {entry['durationMs']}ms",
            level=logging.DEBUG,
        )

    def execute_activity(self, element: ET.Element, entry: dict) -> None:
        """Fill the step's signature from its associations and `arguments`, call it, bind back.

        Not `call_activity`: BPMN spells that `bpmn:CallActivity` and means a
        step that invokes a reusable process by `calledElement`.
        """
        # Read first, recorded first: what a step *is* is the software it names.
        implementation = element.get("implementation")
        if implementation:
            entry["implementation"] = implementation

        keywords: dict[str, Any] = {}
        receiver: list[Any] = []
        used: list[str] = []
        for association in element:
            if local(association) != "dataInputAssociation":
                continue
            parameter = association.get(f"{{{EXEC}}}parameter")
            # `transformation` and `parameter` are different axes: one is which
            # value arrives, the other which parameter it fills. The expression
            # reads the run's namespace, where the source is already bound.
            narrow = next((c for c in association if local(c) == "transformation"), None)
            lens = (narrow.text or "").strip() if narrow is not None else ""
            for source in association:
                if local(source) != "sourceRef":
                    continue
                source_id = (source.text or "").strip()
                value = self.value_of(source_id)
                if lens:
                    value = self.evaluate(lens)
                name = parameter or self.studyflow.names.get(source_id) or source_id
                if name in ("self", "*"):
                    # Two parameter names are positions, not keywords. `self` is
                    # an unbound method's receiver — naming it would tie the
                    # studyflow to what a library calls its first parameter,
                    # which is not always `self`. `*` appends positionally, the
                    # only way into a `*args` callable like `train_test_split`.
                    receiver.append(value)
                else:
                    keywords[name] = value
                if source_id not in used:
                    # `used` is prov:used, a set of entities: an element
                    # associated twice is two bindings but one thing used.
                    used.append(source_id)
                bound = {"parameter": name, "sourceRef": source_id}
                if lens:
                    bound["transformation"] = lens
                entry.setdefault("inputs", []).append({**bound, **describe(value)})
                self.event(
                    "dataInputAssociation.bound",
                    f"    {name} ← {lens or self.studyflow.name_of(source_id)}  {summarize(value)}",
                )

        declared = element.find(f"{{{STUDYFLOW}}}arguments")
        arguments = yaml.safe_load(declared.text) if declared is not None and declared.text else {}
        resolved = self.resolve_arguments(arguments or {})
        positional = receiver + resolved.get("__args__", [])

        # `arguments` are *additional*: associations fill the signature and these
        # supply what is left, so a name in both is two answers for one
        # parameter — one drawn, one buried. Say so instead of picking.
        clashes = sorted(set(resolved) & set(keywords))
        if clashes:
            raise ValueError(
                f"{element.get('id')}: {', '.join(clashes)} bound by both a data association and `arguments`. "
                "Associations fill the signature; `arguments` adds to it — remove one.",
            )
        if resolved:
            # `args` is the reserved key `studyflow:arguments` uses.
            recorded = {k: describe(v) for k, v in resolved.items() if k != "__args__"}
            if resolved.get("__args__"):
                recorded["args"] = [describe(v) for v in resolved["__args__"]]
            entry["arguments"] = recorded
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
            transformation = next((c for c in association if local(c) == "transformation"), None)
            expression = (transformation.text or "").strip() if transformation is not None else ""
            bound_value = self.evaluate(expression, {"result": result}) if expression else result
            self.store(target_id, bound_value)
            entry.setdefault("generated", []).append(target_id)
            entry.setdefault("outputs", []).append({
                "targetRef": target_id,
                "transformation": expression or "result",
                **describe(bound_value),
            })
            self.event(
                "dataOutputAssociation.bound",
                f"    {self.studyflow.name_of(target_id)} ← {expression or 'result'}"
                f"  {summarize(bound_value)}",
            )

            uri, declared_codec = self.studyflow.artifact(target_id)
            if uri:
                path = self.rundir / uri
                codec = codec_for(uri, declared_codec)
                save_artifact(bound_value, path, codec)
                self.record.artifact(target_id, uri, codec, path, entry["node"])
                self.event(
                    "artifact.saved",
                    f"    save {uri}  {codec}, {human_bytes(path.stat().st_size)}",
                )

    def next_element(self, element: ET.Element) -> ET.Element | None:
        element_id = element.get("id")
        flows = self.studyflow.outgoing.get(element_id, [])
        if not flows:
            return None

        if local(element) in GATEWAY_TAGS:
            # Which way the run went, and on what, is what a reader most wants.
            entry = self.record.begin(element_id, self.studyflow.name_of(element_id), bpmn_type(element))
            default_id = element.get("default")
            try:
                for flow in flows:
                    condition = next((c for c in flow if local(c) == "conditionExpression"), None)
                    if condition is None or not (condition.text or "").strip():
                        continue
                    expression = condition.text.strip()
                    verdict = self.evaluate(expression)
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
                        self.event(
                            "sequenceFlow.taken",
                            f"    {expression} → {flow.get('name') or flow.get('id')}"
                            f"  [{flow.get('id')}]",
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
            self.event(
                "sequenceFlow.taken",
                f"    default → {chosen.get('name') or chosen.get('id')}  [{chosen.get('id')}]",
            )
            return self.studyflow.elements.get(chosen.get("targetRef"))

        return self.studyflow.elements.get(flows[0].get("targetRef"))

    def run(self, max_steps: int = 1000) -> None:
        process = self.studyflow.process
        name = process.get("name") or process.get("id")
        log_event("run.started", name)
        # What pins the run, at DEBUG: the terminal keeps its clean header while
        # the log stays self-describing.
        log_event(
            "run.started",
            f"  [{process.get('id')}]  studyflow {self.record.plan_digest}"
            f"  rootSeed {self.record.seed}  workdir {self.workdir}",
            level=logging.DEBUG,
        )
        self.walk(self.studyflow.start_event(), max_steps=max_steps)

    def walk(self, element, depth: int = 0, max_steps: int = 1000) -> None:
        """One token through one container, from `element` to its end event.

        A sub-process is walked the same way, one level in. Values are not
        scoped with it — BPMN's own rule (§10.4.7), and what lets a pipeline's
        phases be sub-processes without threading data through their boundaries.
        """
        outer, self.depth = self.depth, depth
        try:
            steps = 0
            while element is not None:
                steps += 1
                if steps > max_steps:
                    raise RuntimeError("step budget exhausted — is the flow cycling without an exit?")
                self.depth = depth
                element_id = element.get("id")
                self.state.visits[element_id] = self.state.visits.get(element_id, 0) + 1
                tag = local(element)
                name = self.studyflow.name_of(element_id)

                if tag in END_TAGS:
                    # Which end a run reached is the outcome, so it is recorded
                    # like anything else.
                    self.record.end(self.record.begin(element_id, name, bpmn_type(element)))
                    self.event("event.reached", f"■ {name}  [{element_id}]")
                    return
                if tag in GATEWAY_TAGS:
                    self.event("gateway.reached", f"◆ {name}  [{element_id}]")
                elif tag in CONTAINER_TAGS:
                    # A phase: one activity spanning its children, so the record
                    # reads the way the studyflow does at both levels.
                    entry = self.record.begin(element_id, name, bpmn_type(element))
                    self.event("activity.started", f"▣ {name}  [{element_id}]")
                    try:
                        self.walk(self.studyflow.start_event(element), depth + 1, max_steps)
                    except BaseException as error:
                        self.record.fail(entry, error)
                        raise
                    finally:
                        self.depth = depth
                    self.record.end(entry)
                    self.event(
                        "activity.finished", f"  {element_id} done in {entry['durationMs']}ms",
                        level=logging.DEBUG,
                    )
                elif tag in PASSTHROUGH_TAGS:
                    self.record.end(self.record.begin(element_id, name, bpmn_type(element)))
                    self.event("event.reached", f"○ {name}  [{element_id}]")
                else:
                    self.run_activity(element)

                element = self.next_element(element)
        finally:
            self.depth = outer

    # -- what the run leaves behind ---------------------------------------
    def shown(self, path: Path) -> Path:
        """A path relative to the workdir the `uri`s resolve against."""
        return path.relative_to(self.workdir) if path.is_relative_to(self.workdir) else path

    def write_provenance(self, source: Path, log: Path | None = None, form: str = "jsonld") -> Path:
        """Write the run's PROV document, with a copy of the plan beside it."""
        self.rundir.mkdir(parents=True, exist_ok=True)
        # Copying the studyflow in makes the `prov:Plan` a file you can reopen,
        # not a digest of something that may since have been edited.
        plan = self.rundir / source.name
        if not plan.exists():
            shutil.copyfile(source, plan)

        document = self.record.prov(
            self.values, self.state.visits, self.studyflow.name_of,
            run_id=self.rundir.name, plan=plan.name, log=log.name if log else None,
        )
        filename, rdf_form = PROV_FORMATS[form]
        path = self.rundir / filename
        if form == "provn":
            path.write_text(document.get_provn() + "\n")
        elif rdf_form:
            path.write_text(rdf_with_shortcuts(document, rdf_form))
        else:
            document.serialize(str(path), format=form, indent=2)

        self.event("provenance.written", f"  → {self.shown(path)}", level=logging.DEBUG)
        return path

    def write_crate(
        self,
        plan: Path,
        parts: dict[str, str],
        version: str,
        licence: str | None = None,
    ) -> Path:
        """Make the run directory a Workflow Run RO-Crate.

        Every part is already in place: inputs were staged in before they were
        read, so nothing has to be gathered here to make the crate whole.
        """
        process = self.studyflow.process
        document = self.record.crate(
            self.values, self.studyflow.name_of,
            workflow=plan.name,
            workflow_name=process.get("name") or process.get("id"),
            parts=parts, version=version, licence=licence,
        )
        path = self.rundir / "ro-crate-metadata.json"
        path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
        self.event("crate.written", f"  → {self.shown(path)}", level=logging.DEBUG)
        return path

    def finish(self) -> None:
        elapsed = (datetime.now(timezone.utc) - self.record.started).total_seconds() * 1000
        log_event(
            "run.finished",
            f"  → {self.shown(self.rundir)}/ ({self.record.status}) in {elapsed:.1f}ms",
            level=logging.INFO if self.record.status == "ok" else logging.ERROR,
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("studyflow", type=Path, help="a .png with an embedded studyflow, or a .bpmn/.xml")
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
             "as a sortable UTC stamp)",
    )
    parser.add_argument(
        "--prov-format", choices=sorted(PROV_FORMATS), default="jsonld",
        help="serialization of the run's PROV document (default: jsonld, i.e. PROV-O as JSON-LD)",
    )
    parser.add_argument(
        "--no-crate", action="store_true",
        help="skip ro-crate-metadata.json; without it the run directory is not an RO-Crate",
    )
    parser.add_argument(
        # Choices come from ro-crate-py's own list, so this gains 1.3 when it does.
        "--crate-version", choices=sorted(SUPPORTED_VERSIONS), default=CRATE_VERSION,
        help=f"RO-Crate specification version to write (default: {CRATE_VERSION}, "
             "which is what the Workflow Run Crate profiles require)",
    )
    parser.add_argument(
        "--license", default=None,
        help="licence URL for the run's outputs, stated on the RO-Crate root "
             "(default: a CreativeWork saying it is not asserted)",
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

    started = datetime.now(timezone.utc)
    # One directory per run, named for when it started, so the files inside it
    # need no timestamp and a second run cannot overwrite the first.
    run_id = args.run_id or started.strftime("%Y%m%dT%H%M%SZ")
    rundir = args.workdir / args.runs_dir / run_id
    log = start_logging(rundir, args.quiet)

    studyflow = read_studyflow(args.studyflow)
    runner = Runner(
        studyflow, args.workdir, rundir=rundir, started=started,
        prepare_inputs=not args.no_prepare_inputs,
    )
    try:
        runner.run()
    except BaseException as error:  # noqa: BLE001 - recorded and reported, not swallowed
        # A studyflow that fails is not this program crashing: the failing step
        # is already an execution with an error, and the traceback is already in
        # the log. The terminal gets the sentence a person needs.
        log_event(
            "run.failed", f"  {type(error).__name__}: {error}",
            level=logging.ERROR, exc_info=error,
        )
        runner.record.status = "error"
    finally:
        # Written on the way out either way: a run that failed halfway is
        # exactly when the order of what happened is worth having on disk.
        provenance = runner.write_provenance(args.studyflow, log, args.prov_format)
        if not args.no_crate:
            # Last, so the crate can list the provenance file beside it.
            runner.write_crate(
                runner.rundir / args.studyflow.name,
                parts={
                    log.name: "What the run did, in order — one line per event.",
                    provenance.name: "What the run was — its W3C PROV provenance.",
                },
                version=args.crate_version,
                licence=args.license,
            )
        runner.finish()
        logging.shutdown()
    return 0 if runner.record.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

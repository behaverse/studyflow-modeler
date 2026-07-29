#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6.0",
#   # Only the line above is the runner's. The rest is what the shipped
#   # sklearn_pipeline example's own steps import when this calls them, declared
#   # here so `uv run studyflow_run.py <diagram>` needs no setup. A different
#   # diagram names different software: add it per run with
#   # `uv run --with <package> studyflow_run.py …`.
#   "pandas>=2.0",
#   "scikit-learn>=1.4",
#   "joblib>=1.3",
#   "matplotlib>=3.8",
#   # A diagram whose artifacts declare `codec="parquet"` also needs pandas'
#   # parquet engine: `uv run --with pyarrow studyflow_run.py …`.
# ]
# ///
"""A reference runner for the studyflow execution contract.

It exists to keep one claim honest: that a studyflow diagram is executable as
it stands, with no companion script telling an engine what the boxes mean. Point
it at `sklearn_pipeline.png` — the shipped example, the picture itself — and it
runs the pipeline the picture shows:

    uv run studyflow_run.py ../src/assets/examples/sklearn_pipeline.png

Dependencies are declared in the script header above (PEP 723), so there is no
environment to make first.

Everything it needs is in the file. The contract it implements is the one the
example's own documentation states, and nothing here is specific to that
example:

  * A step is one call. `implementation` names it as `python://<import path>`;
    the import path may reach into a class (`pandas.DataFrame.drop`), which is
    how an unbound method becomes a step.
  * Inputs are the step's data associations, not a list on the step. Each wired
    input binds to the callable parameter named by the association's
    `exec:parameter`, defaulting to the wired element's own name.
  * `studyflow:arguments` is a YAML mapping of the remaining keyword arguments,
    with three rules on top of plain literals: the reserved key `args` holds
    positional arguments, a `$Name` / `$Name.field` string reads a wired value,
    and a nested mapping carrying its own `implementation` is a call to make
    first (which is how a pipeline gets its estimators).
  * The return value binds to the wired outputs. An output association may
    narrow it through BPMN's own `transformation`, an expression over `result`.
  * A data element with a `uri` is an artifact: it is loaded before its first
    consumer and written after its producer, through the `codec` it declares
    (or the one its file extension implies). Without a `uri`, a value only
    passes between steps in memory — which is what `bpmn:Property` is for.
  * A gateway takes the first outgoing flow whose `conditionExpression` holds,
    and its `default` flow when none does. `state.visits.<id>` counts how often
    the walk has reached an element, so a drawn cycle can bound itself.

Two honest limitations. Conditions and transformations are declared as CEL
(`expressionLanguage` on `bpmn:Definitions`); this runner evaluates them with
Python's own `eval` over a namespace holding just the run's values, which
agrees with CEL on the expressions studyflow diagrams actually use (comparison,
field access, indexing) and is not a CEL implementation. And it walks one token
through a single process: no parallel gateways, no sub-processes, no
multi-instance fan-out. Both are the runner's limits, not the notation's.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import re
import struct
import sys
import time
import traceback
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

import yaml

BPMN = "http://www.omg.org/spec/BPMN/20100524/MODEL"
EXEC = "https://w3id.org/studyflow/exec"
STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"

DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore"}
END_TAGS = {"endEvent"}
GATEWAY_TAGS = {
    "exclusiveGateway", "inclusiveGateway", "complexGateway", "eventBasedGateway",
}
# Elements the walk passes through without calling anything.
PASSTHROUGH_TAGS = {"startEvent", "intermediateCatchEvent", "intermediateThrowEvent"}


def local(element: ET.Element) -> str:
    """Tag name without its namespace."""
    return element.tag.split("}")[-1]


# ---------------------------------------------------------------------------
# Reading the diagram
# ---------------------------------------------------------------------------

def studyflow_from_png(path: Path) -> str:
    """The diagram inside a PNG, from the `studyflow` text chunk the modeler
    writes on export. The picture and the source are one file."""
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
                    # compression flag, method, then language and translated
                    # keyword, each NUL-terminated.
                    rest = rest[2:].split(b"\x00", 2)[2]
                    return zlib.decompress(rest).decode() if compressed else rest.decode()
                return rest.decode()
        offset += 12 + length
    raise ValueError(f"{path} carries no studyflow payload")


def read_diagram(path: Path) -> Diagram:
    xml = studyflow_from_png(path) if path.suffix.lower() == ".png" else path.read_text()
    return Diagram(ET.fromstring(xml), plan=xml)


class Diagram:
    """The parts of a `bpmn:Definitions` this runner walks."""

    def __init__(self, definitions: ET.Element, plan: str = "") -> None:
        self.definitions = definitions
        # The plan's own bytes, so the run record can pin the exact document.
        self.plan = plan
        self.process = self._find_process()
        self.elements: dict[str, ET.Element] = {}
        for element in self.process:
            if element.get("id"):
                self.elements[element.get("id")] = element

        self.flows = [e for e in self.process if local(e) == "sequenceFlow"]
        self.outgoing: dict[str, list[ET.Element]] = {}
        for flow in self.flows:
            self.outgoing.setdefault(flow.get("sourceRef"), []).append(flow)

        # A value is addressable by element id and, when it has one, by name —
        # the two spellings a condition or a `$ref` may use.
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

    def start_event(self) -> ET.Element:
        for element in self.process:
            if local(element) == "startEvent":
                return element
        raise ValueError("no start event")

    def artifact(self, element_id: str) -> tuple[str | None, str | None]:
        """`uri` and `codec` of a data element, or (None, None)."""
        element = self.elements.get(element_id)
        if element is None or local(element) not in DATA_ELEMENT_TAGS:
            return None, None
        return element.get(f"{{{EXEC}}}uri"), element.get(f"{{{EXEC}}}codec")

    def label(self, element_id: str) -> str:
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
        # A CSV carries no schema, so the frame's index has to be a decision
        # rather than a default. Row numbers are not data and are dropped; any
        # other index is what the rows are *called* and is kept as a leading
        # column — the cross-validation summary is indexed by statistic name, and
        # without this its file would say `mean` nowhere. Reading a CSV back
        # therefore gives columns, not that index: that fidelity is what parquet
        # buys, and why the codec is declared per artifact rather than globally.
        import pandas
        positional = isinstance(value.index, pandas.RangeIndex)
        value.to_csv(path, index=not positional)
    elif codec == "json":
        path.write_text(json.dumps(value, indent=2, default=str))
    elif codec == "joblib":
        import joblib
        joblib.dump(value, path)
    elif codec in ("png", "svg", "pdf"):
        # A figure is an artifact like any other: the step returns one and the
        # codec writes it. `savefig` picks the format from the suffix.
        value.savefig(path, dpi=150, bbox_inches="tight")
    else:
        raise ValueError(f"no codec for {codec!r} ({path})")


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

class Visits(dict):
    """`state.visits.<element-id>`, readable with attribute syntax so a drawn
    cycle can bound itself the way the contract documents."""

    def __getattr__(self, name: str) -> int:
        return self.get(name, 0)


# ---------------------------------------------------------------------------
# The as-run record
# ---------------------------------------------------------------------------

def plain(value: Any) -> Any:
    """A numpy scalar as the Python number it stands for, so YAML can hold it."""
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        return value.item()
    return value


def describe(value: Any) -> dict:
    """What a value *is*, never what it contains.

    A run passes whole tables and fitted models between steps; a record that
    inlined them would be unreadable and enormous, and would also be a second
    copy of data the artifacts already hold. So each bound value is recorded by
    type and size — enough to see that a step received a 1347x64 frame rather
    than an empty one, which is what a reader of the log is checking.
    """
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
    """The retrospective half of a studyflow: what a run of the plan did.

    The plan is a `prov:Plan` and this is its execution — an ordered
    `executions` list of `prov:Activity`, each naming what it `used` and
    `generated`, plus the `artifacts` those refer to as `prov:Entity`. Written
    as a `.studyrun` beside the results (see `docs/wip/exec_docs.qmd`, which
    specifies this record and lists it as not yet implemented anywhere).

    It is written whether the run succeeds or fails, because a failed run is
    when the order of what happened matters most. One deviation from the sketch
    in that document: artifacts are keyed by element id with their digest as a
    field, rather than keyed by digest. A single run's record is something a
    person reads, and `Fitted_Model:` says more at a glance than `sha256:77de…`.
    """

    def __init__(self, plan: str, seed: str | None) -> None:
        self.plan_digest = digest_of(plan.encode())
        self.seed = seed
        self.started = datetime.now(timezone.utc)
        self.executions: list[dict] = []
        self.artifacts: dict[str, dict] = {}
        self.status = "ok"

    def begin(self, element_id: str, name: str, kind: str) -> dict:
        entry: dict[str, Any] = {
            "node": element_id,
            "name": name,
            "kind": kind,
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

    def document(self, values: dict[str, Any], visits: dict[str, int], names: dict[str, str]) -> dict:
        finished = datetime.now(timezone.utc)
        return {
            "studyflow": self.plan_digest,
            "run": f"{self.started.isoformat(timespec='seconds')}/{self.plan_digest[7:11]}",
            "rootSeed": self.seed,
            "status": self.status,
            "startedAt": self.started.isoformat(timespec="milliseconds"),
            "finishedAt": finished.isoformat(timespec="milliseconds"),
            "durationMs": round((finished - self.started).total_seconds() * 1000, 1),
            "executions": self.executions,
            "artifacts": self.artifacts,
            # Every value the run ended holding, by the name an expression reads
            # it under — the state a `conditionExpression` was evaluated against.
            "state": {
                names.get(element_id, element_id): describe(value)
                for element_id, value in values.items()
            },
            "visits": dict(visits),
        }


class State:
    def __init__(self) -> None:
        self.visits = Visits()


def resolve_callable(reference: str) -> Any:
    """Import what `python://<path>[@version]` names, reaching into a class
    when the path does (`pandas.DataFrame.drop`)."""
    if not reference.startswith("python://"):
        raise ValueError(f"this runner only implements python://, not {reference!r}")
    path = reference[len("python://"):].split("@")[0]
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
    def __init__(self, diagram: Diagram, workdir: Path, verbose: bool = True) -> None:
        self.diagram = diagram
        self.workdir = workdir
        self.verbose = verbose
        self.values: dict[str, Any] = {}
        self.state = State()
        # An extension attribute on a BPMN element serializes unprefixed, so
        # `seed` is read plainly; the namespaced spelling is accepted too.
        seed = diagram.process.get("seed") or diagram.process.get(f"{{{STUDYFLOW}}}seed")
        self.record = RunRecord(diagram.plan, seed)

    # -- values -----------------------------------------------------------
    def store(self, element_id: str, value: Any) -> None:
        self.values[element_id] = value

    def namespace(self) -> dict[str, Any]:
        """What an expression sees: every bound value under its element id and
        under its name, plus the engine's run state."""
        space: dict[str, Any] = {"state": self.state}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.diagram.names.get(element_id)
            if name:
                space[name] = value
        return space

    def evaluate(self, expression: str, extra: dict[str, Any] | None = None) -> Any:
        space = self.namespace()
        space.update(extra or {})
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - see module docstring

    def value_of(self, element_id: str) -> Any:
        """The current value of a wired element: what a step already produced,
        or the artifact at its `uri`."""
        if element_id in self.values:
            return self.values[element_id]
        uri, declared = self.diagram.artifact(element_id)
        if uri:
            path = self.workdir / uri
            codec = codec_for(uri, declared)
            value = load_artifact(path, codec)
            self.values[element_id] = value
            # A boundary input is an artifact the run used but did not produce;
            # its digest is what makes the record reproducible.
            self.record.artifact(element_id, uri, codec, path, None)
            self.say(f"      load {uri}")
            return value
        raise KeyError(f"nothing has bound {element_id!r} and it declares no uri")

    def say(self, message: str) -> None:
        if self.verbose:
            print(message, flush=True)

    # -- arguments --------------------------------------------------------
    def resolve_argument(self, value: Any) -> Any:
        """`$Name` / `$Name.field` reads a wired value; a mapping with its own
        `implementation` is a call to make first; anything else is a literal."""
        if isinstance(value, str) and value.startswith("$"):
            reference = value[1:]
            head, _, tail = reference.partition(".")
            resolved = self.value_of(head)
            for field in filter(None, tail.split(".")):
                resolved = resolved[field] if isinstance(resolved, dict) else getattr(resolved, field)
            return resolved
        if isinstance(value, dict) and "implementation" in value:
            nested = self.resolve_arguments(value.get("arguments") or {})
            return resolve_callable(value["implementation"])(*nested.pop("__args__", []), **nested)
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
        self.say(f"  ▸ {self.diagram.label(element_id)}  [{element_id}]")
        entry = self.record.begin(element_id, self.diagram.label(element_id), local(element))
        try:
            self.call_activity(element, entry)
        except BaseException as error:
            self.record.fail(entry, error)
            raise
        self.record.end(entry)

    def call_activity(self, element: ET.Element, entry: dict) -> None:
        keywords: dict[str, Any] = {}
        receiver: list[Any] = []
        used: list[str] = []
        for association in element:
            if local(association) != "dataInputAssociation":
                continue
            parameter = association.get(f"{{{EXEC}}}parameter")
            for source in association:
                if local(source) != "sourceRef":
                    continue
                source_id = (source.text or "").strip()
                value = self.value_of(source_id)
                name = parameter or self.diagram.names.get(source_id) or source_id
                if name in ("self", "*"):
                    # Two parameter names are positions rather than keywords.
                    # `self` is the receiver of an unbound method: passing it by
                    # name would tie the diagram to what a library calls its
                    # first parameter, which is not always `self` —
                    # scikit-learn's `@_fit_context` decorator, for one, renames
                    # `Pipeline.fit`'s to `estimator`. `*` appends to the
                    # positional arguments in wire order, which is the only way
                    # to wire data into a `*args` callable such as
                    # `train_test_split(*arrays)`, where the arguments have no
                    # names at all.
                    receiver.append(value)
                else:
                    keywords[name] = value
                used.append(source_id)
                entry.setdefault("bindings", {})[name] = {
                    "from": source_id,
                    **describe(value),
                }
                self.say(f"      {name} ← {self.diagram.label(source_id)}")

        body = element.find(f"{{{STUDYFLOW}}}arguments")
        arguments = yaml.safe_load(body.text) if body is not None and body.text else {}
        resolved = self.resolve_arguments(arguments or {})
        positional = receiver + resolved.pop("__args__", [])
        keywords.update(resolved)

        if used:
            entry["used"] = used

        reference = element.get("implementation")
        if not reference:
            self.say("      (no implementation — nothing to call)")
            return
        target = resolve_callable(reference)
        entry["call"] = reference
        self.say(f"      call {reference}")
        result = target(*positional, **keywords)

        for association in element:
            if local(association) != "dataOutputAssociation":
                continue
            target_ref = next((c for c in association if local(c) == "targetRef"), None)
            if target_ref is None:
                continue
            target_id = (target_ref.text or "").strip()
            transformation = next((c for c in association if local(c) == "transformation"), None)
            bound = result
            if transformation is not None and (transformation.text or "").strip():
                expression = transformation.text.strip()
                bound = self.evaluate(expression, {"result": result})
                self.say(f"      {self.diagram.label(target_id)} ← {expression}")
            else:
                self.say(f"      {self.diagram.label(target_id)} ← result")
            self.store(target_id, bound)
            entry.setdefault("generated", []).append(target_id)
            entry.setdefault("bindings", {})[target_id] = describe(bound)

            uri, declared = self.diagram.artifact(target_id)
            if uri:
                path = self.workdir / uri
                codec = codec_for(uri, declared)
                save_artifact(bound, path, codec)
                self.record.artifact(target_id, uri, codec, path, entry["node"])
                self.say(f"      save {uri}")

    def next_element(self, element: ET.Element) -> ET.Element | None:
        element_id = element.get("id")
        flows = self.diagram.outgoing.get(element_id, [])
        if not flows:
            return None

        if local(element) in GATEWAY_TAGS:
            # A branch is the one thing a reader of the record most wants to
            # know about after the fact: which way the run went, and on what.
            entry = self.record.begin(element_id, self.diagram.label(element_id), local(element))
            default_id = element.get("default")
            try:
                for flow in flows:
                    condition = next((c for c in flow if local(c) == "conditionExpression"), None)
                    if condition is None or not (condition.text or "").strip():
                        continue
                    expression = condition.text.strip()
                    verdict = self.evaluate(expression)
                    entry.setdefault("conditions", []).append(
                        {"flow": flow.get("id"), "expression": expression, "held": bool(verdict)},
                    )
                    if verdict:
                        entry["took"] = {"flow": flow.get("id"), "name": flow.get("name")}
                        self.record.end(entry)
                        self.say(f"      {expression} → {flow.get('name') or flow.get('id')}")
                        return self.diagram.elements.get(flow.get("targetRef"))
            except BaseException as error:
                self.record.fail(entry, error)
                raise

            chosen = next((f for f in flows if f.get("id") == default_id), None)
            if chosen is None:
                entry["status"] = "stuck"
                self.record.end(entry)
                self.record.status = "error"
                self.say("      no condition held and no default flow")
                return None
            entry["took"] = {"flow": chosen.get("id"), "name": chosen.get("name"), "default": True}
            self.record.end(entry)
            self.say(f"      default → {chosen.get('name') or chosen.get('id')}")
            return self.diagram.elements.get(chosen.get("targetRef"))

        return self.diagram.elements.get(flows[0].get("targetRef"))

    def run(self, max_steps: int = 1000) -> None:
        element: ET.Element | None = self.diagram.start_event()
        steps = 0
        while element is not None:
            steps += 1
            if steps > max_steps:
                raise RuntimeError("step budget exhausted — is the flow cycling without an exit?")
            element_id = element.get("id")
            self.state.visits[element_id] = self.state.visits.get(element_id, 0) + 1
            tag = local(element)

            if tag in END_TAGS:
                # Recorded like anything else: which end a run reached is the
                # outcome, and this diagram has two that mean different things.
                self.record.end(self.record.begin(element_id, self.diagram.label(element_id), tag))
                self.say(f"  ■ {self.diagram.label(element_id)}")
                return
            if tag in GATEWAY_TAGS:
                self.say(f"  ◆ {self.diagram.label(element_id)}")
            elif tag in PASSTHROUGH_TAGS:
                self.record.end(self.record.begin(element_id, self.diagram.label(element_id), tag))
                self.say(f"  ○ {self.diagram.label(element_id)}")
            else:
                self.run_activity(element)

            element = self.next_element(element)


    def write_record(self, path: Path) -> None:
        document = self.record.document(self.values, self.state.visits, self.diagram.names)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(yaml.safe_dump(document, sort_keys=False, allow_unicode=True))
        self.say(f"  → {path} ({self.record.status})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("diagram", type=Path, help="a .png with an embedded studyflow, or a .bpmn/.xml")
    parser.add_argument(
        "--workdir", type=Path, default=Path.cwd(),
        help="directory the artifact uris are relative to (default: the current one)",
    )
    parser.add_argument(
        "--run-record", type=Path, default=Path("results/run.studyrun"),
        help="where to write the as-run record, relative to --workdir (default: results/run.studyrun)",
    )
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    diagram = read_diagram(args.diagram)
    print(f"{diagram.process.get('name') or diagram.process.get('id')}")
    runner = Runner(diagram, args.workdir, verbose=not args.quiet)
    try:
        runner.run()
    finally:
        # Written on the way out either way. A run that failed halfway is
        # exactly when the order of what happened, and the state it happened
        # against, is worth having on disk.
        runner.write_record(args.workdir / args.run_record)
    return 0 if runner.record.status == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "pyyaml>=6.0",
#   "pandas>=2.0",
#   "scikit-learn>=1.4",
#   "joblib>=1.3",
#   "matplotlib>=3.8",
#   # `format="parquet"` also needs pandas' parquet engine: `--with pyarrow`.
# ]
# ///
"""Run the `python://` elements of a studyflow.

The partial runner for plain computation: it claims every element whose
`implementation` is a `python://` path, and executes one per hand-off —
binding the element's inputs from the state and the run repository's
artifacts, calling the implementation, and binding its outputs back
(artifacts saved into the repository, JSON-able values merged into the
state). Claims answer `{"elements": [...], "live": false}`: these elements
are replayable, so studyflow-run-local's reuse and branching apply to them.
"""

from __future__ import annotations

import argparse
import importlib
import json
import random
import re
import shutil
import struct
import sys
import time
import zlib
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Callable

import yaml

STUDYFLOW = "http://behaverse.org/schemas/studyflow/v1"


def local(element: ET.Element) -> str:
    return element.tag.split("}")[-1]


def studyflow_attr(element: ET.Element, name: str) -> str | None:
    return element.get(f"{{{STUDYFLOW}}}{name}")


def studyflow_from_png(path: Path) -> str:
    """Mirrors `studyflow-run-local.py`'s reader: the diagram travels in a PNG text chunk."""
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
                    rest = rest[2:].split(b"\x00", 2)[2]
                    return zlib.decompress(rest).decode() if compressed else rest.decode()
                return rest.decode()
        offset += 12 + length
    raise ValueError(f"{path} carries no studyflow payload")


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


CONTAINER_TAGS = {"subProcess", "adHocSubProcess", "transaction"}
DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore", "property"}


class Studyflow:
    def __init__(self, xml: str) -> None:
        self.definitions = ET.fromstring(xml)
        self.elements: dict[str, ET.Element] = {}

        def index(container: ET.Element) -> None:
            for element in container:
                if element.get("id"):
                    self.elements[element.get("id")] = element
                if local(element) in CONTAINER_TAGS or local(element) == "process":
                    index(element)

        for child in self.definitions:
            if local(child) == "process":
                index(child)

        self.names = {
            eid: el.get("name") for eid, el in self.elements.items()
            if el.get("name") and re.fullmatch(r"[A-Za-z_]\w*", el.get("name"))
        }

    def seed(self) -> str | None:
        for child in self.definitions:
            if local(child) == "process":
                pinned = studyflow_attr(child, "seed")
                if pinned:
                    return pinned
        return None

    def artifact(self, element_id: str) -> tuple[str | None, str | None]:
        element = self.elements.get(element_id)
        if element is None or local(element) not in DATA_ELEMENT_TAGS:
            return None, None
        fmt = next((v for k, v in element.attrib.items() if k.split("}")[-1] == "format"), None)
        return studyflow_attr(element, "uri"), fmt


def format_for(uri: str, declared: str | None) -> str:
    return declared or Path(uri).suffix.lstrip(".").lower()


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


# Not part of the contract: a shipped example's boundary inputs, keyed by `uri`.
BOUNDARY_INPUTS: dict[str, Callable[[Path], None]] = {
    "digits.csv": write_digits_table,
}


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


def jsonable(value: Any) -> bool:
    try:
        json.dumps(value)
        return True
    except (TypeError, ValueError):
        return False


class Run:
    def __init__(self, studyflow: Studyflow, repo: Path, cache: Path, sources: list[Path]) -> None:
        self.studyflow = studyflow
        self.repo = repo
        # Values that fit neither JSON nor a declared artifact spill here, for the next hand-off.
        self.spill = cache / "values"
        self.sources = sources
        self.values: dict[str, Any] = {}

    def namespace(self) -> dict[str, Any]:
        space: dict[str, Any] = {}
        for element_id, value in self.values.items():
            space[element_id] = value
            name = self.studyflow.names.get(element_id)
            if name:
                space[name] = value
        return space

    def evaluate(self, expression: str, extra: dict[str, Any] | None = None, language: str | None = None) -> Any:
        if language and language.lower() not in ("py", "python"):
            raise ValueError(f"a {language} expression — this runner evaluates Python")
        space = self.namespace()
        space.update(extra or {})
        return eval(expression, {"__builtins__": {}}, space)  # noqa: S307 - an authored diagram

    def value_of(self, element_id: str) -> Any:
        if element_id in self.values:
            return self.values[element_id]
        uri, declared = self.studyflow.artifact(element_id)
        if uri:
            path = self.repo / uri
            if not path.exists():
                self.stage_input(uri, path)
            value = load_artifact(path, format_for(uri, declared))
            self.values[element_id] = value
            return value
        spilled = self.spill / f"{element_id}.joblib"
        if spilled.exists():
            import joblib
            value = joblib.load(spilled)
            self.values[element_id] = value
            return value
        raise KeyError(f"nothing has bound {element_id!r} and it declares no uri")

    def stage_input(self, uri: str, path: Path) -> None:
        for directory in self.sources:
            source = directory / uri
            if source != path and source.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, path)
                print(f"staged {uri} from {source}")
                return
        build = BOUNDARY_INPUTS.get(uri)
        if build is None:
            raise FileNotFoundError(f"{uri} is a boundary input nothing here can produce")
        build(path)
        print(f"prepared {uri}, a boundary input this studyflow ships")

    def resolve_argument(self, value: Any) -> Any:
        """`$Name` reads a bound value; a mapping with `implementation` is a call first."""
        if isinstance(value, str) and value.startswith("$"):
            head, _, tail = value[1:].partition(".")
            resolved = self.value_of(self.by_name(head))
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

    def by_name(self, reference: str) -> str:
        for element_id, name in self.studyflow.names.items():
            if name == reference:
                return element_id
        return reference

    def resolve_arguments(self, arguments: dict) -> dict:
        resolved: dict[str, Any] = {}
        for key, value in (arguments or {}).items():
            if key == "args":
                resolved["__args__"] = [self.resolve_argument(v) for v in value]
            else:
                resolved[key] = self.resolve_argument(value)
        return resolved

    def execute(self, element: ET.Element) -> Any:
        implementation = element.get("implementation") or ""
        keywords: dict[str, Any] = {}
        receiver: list[Any] = []
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

        declared = next((c for c in element if c.tag == f"{{{STUDYFLOW}}}additionalArguments"), None)
        arguments = yaml.safe_load(declared.text) if declared is not None and declared.text else {}
        resolved = self.resolve_arguments(arguments or {})
        positional = receiver + resolved.get("__args__", [])
        keywords.update({k: v for k, v in resolved.items() if k != "__args__"})

        target = resolve_implementation(implementation)
        print(f"implementation {implementation}")
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
            bound = self.evaluate(expression, {"result": result}, language=language) if expression else result
            self.values[target_id] = bound
            uri, declared_format = self.studyflow.artifact(target_id)
            if uri:
                path = self.repo / uri
                save_artifact(bound, path, format_for(uri, declared_format))
                print(f"saved {uri} ({path.stat().st_size} bytes)")
            elif not jsonable(bound):
                import joblib
                self.spill.mkdir(parents=True, exist_ok=True)
                joblib.dump(bound, self.spill / f"{target_id}.joblib")
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("diagram", type=Path, help="a .studyflow.png (or .bpmn/.xml)")
    parser.add_argument("--element", metavar="ID", default=None, help="hand-off mode: execute this one element")
    parser.add_argument("--claims", action="store_true", help="print the claimed element ids and exit")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state dir")
    # Accepted so studyflow-run-local can pass its shared runner flags; this runner has no use for them.
    parser.add_argument("--sim", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--auto", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    xml = studyflow_from_png(args.diagram) if args.diagram.suffix.lower() == ".png" else args.diagram.read_text()
    studyflow = Studyflow(xml)

    if args.claims:
        # Replayable, not live: studyflow-run-local's skip/reuse and branching apply to these elements.
        print(json.dumps({
            "live": False,
            "elements": [
                element_id for element_id, element in studyflow.elements.items()
                if (element.get("implementation") or "").startswith("python://")
            ],
        }))
        return 0

    if not args.element:
        parser.error("standalone walking is not implemented here — use studyflow-run-local, or pass --element")

    cache = args.cache or Path(".")
    repo = cache.resolve().parent if args.cache else Path.cwd()
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}

    # The root seed comes from the diagram itself — the same file every process reads.
    seed = studyflow.seed()
    if seed:
        try:
            random.seed(int(seed))
            import numpy
            numpy.random.seed(int(seed) % 2**32)
        except Exception:  # noqa: BLE001, S110 - a non-numeric seed seeds nothing
            pass

    run = Run(studyflow, repo, cache, sources=[args.diagram.resolve().parent, Path.cwd()])
    run.values.update(state)
    clock = time.perf_counter()
    try:
        element = studyflow.elements.get(args.element)
        if element is None:
            raise KeyError(f"no element {args.element!r} in the diagram")
        result = run.execute(element)
    except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
        state["error"] = f"{type(error).__name__}: {error}"
    else:
        # The updated state: every JSON-able value this element bound, the result, and the timing.
        state.update({k: v for k, v in run.values.items() if jsonable(v)})
        state["result"] = result if jsonable(result) else str(type(result).__name__)
        state["durationMs"] = round((time.perf_counter() - clock) * 1000, 1)
    cache.mkdir(parents=True, exist_ok=True)
    handoff.write_text(json.dumps(state, default=str))
    return 1 if "error" in state else 0


if __name__ == "__main__":
    sys.exit(main())

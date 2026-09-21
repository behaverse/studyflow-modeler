#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml>=6.0"]
# ///
# What the implementations need (pandas, scikit-learn, joblib, matplotlib, pyarrow for parquet) is the
# study's business: its `dependencies` entries, which studyflow-run-local installs here with `uv run --with`.
"""Run the `python://` elements of a studyflow.

The partial runner for plain computation: it claims every element whose
`implementation` is a `python://` path, and executes one per hand-off:
binding the element's inputs from the state and the run repository's
artifacts, calling the implementation, and binding its outputs back
(artifacts saved into the repository, JSON-able values merged into the
state). Claims answer `{"elements": [...], "live": false}`: these elements
are replayable, so studyflow-run-local's reuse and branching apply to them.
"""

from __future__ import annotations

import argparse
import difflib
import functools
import importlib
import importlib.metadata
import json
import platform
import random
import re
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterator

import yaml

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


PLACEHOLDER = re.compile(r"\{\s*([^\W\d][\w.-]*)\s*\}")  # the modeler's PLACEHOLDER (packages/core/src/document/state.ts)


def dig(value: Any, fields: list[str]) -> Any:
    for field in fields:
        value = value.get(field) if isinstance(value, dict) else getattr(value, field, None)
        if value is None:
            break
    return value


def placeholder_of(value: Any) -> str | None:
    """What a value that is one placeholder and nothing else cites: `"{model}"`, or an unquoted `{model}`, which
    YAML reads as a one-key mapping."""
    if isinstance(value, dict) and len(value) == 1 and None in value.values():
        value = f"{{{next(iter(value))}}}"
    match = PLACEHOLDER.fullmatch(value.strip()) if isinstance(value, str) else None
    return match.group(1) if match else None


DATA_ELEMENT_TAGS = {"dataObjectReference", "dataStoreReference", "dataObject", "dataStore", "property"}


class Plan:
    """The digest studyflow-run-local hands over (`plan.json`): the study, and every element by id."""

    def __init__(self, digest: dict[str, Any]) -> None:
        self.study: dict[str, Any] = digest.get("study") or {}
        self.sources: list[Path] = [Path(p) for p in digest.get("sources") or []]
        self.elements: dict[str, dict[str, Any]] = digest.get("elements") or {}
        # The digest's `names` cite one element each; a digest without them (a hand-written one) binds every identifier-shaped name.
        self.names: dict[str, str] = digest["names"] if "names" in digest else {
            eid: el["name"] for eid, el in self.elements.items()
            if el.get("name") and re.fullmatch(r"[A-Za-z_]\w*", el["name"])
        }

    def seed(self) -> str | None:
        return self.study.get("seed")

    def artifact(self, element_id: str) -> tuple[str | None, str | None]:
        element = self.elements.get(element_id)
        if element is None or element.get("type") not in DATA_ELEMENT_TAGS:
            return None, None
        attributes = element.get("attributes") or {}
        return attributes.get("uri"), attributes.get("format")


def format_for(uri: str, declared: str | None) -> str:
    return declared or Path(uri).suffix.lstrip(".").lower()


def load_artifact(path: Path, fmt: str) -> Any:
    if fmt == "parquet":
        import pandas
        return pandas.read_parquet(path)
    if fmt == "csv":
        import pandas
        return pandas.read_csv(path)
    if fmt == "jsonl":
        # One JSON record per line (the behaverse runner's trial events): a flat table, nested keys as `a.b`
        # columns, so an analysis groups by what the records nest.
        import pandas
        return pandas.json_normalize([json.loads(line) for line in path.read_text().splitlines() if line.strip()])
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
    elif fmt == "jsonl":
        value.to_json(path, orient="records", lines=True)
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


@functools.cache
def distribution(top: str) -> str | None:
    """`<distribution> <version>` of what provides a top-level package, the standard library being Python's own;
    None when no installed metadata names one."""
    if top in sys.stdlib_module_names:
        return f"python {platform.python_version()}"
    names = importlib.metadata.packages_distributions().get(top)
    # ponytail: the first distribution naming the package; a namespace package several share wants the one holding the module.
    return f"{names[0]} {importlib.metadata.version(names[0])}" if names else None


def resolve_implementation(implementation: str) -> Any:
    """The callable a `python://pkg.mod.fn` path names. A pin, `@1.2`, holds when the installed version starts with
    its components (1.2.3, not 1.20); a mismatch, or no metadata to compare, is an error naming both."""
    if not implementation.startswith("python://"):
        raise ValueError(f"this runner only implements python://, not {implementation!r}")
    path, _, pin = implementation[len("python://"):].partition("@")
    if pin:
        found = distribution(path.split(".")[0])
        wanted = re.split(r"[.+]", pin)
        if not found or re.split(r"[.+]", found.split()[-1])[:len(wanted)] != wanted:
            raise ImportError(f"{implementation} pins {pin}, and "
                              + (f"{found} is installed" if found else f"no installed distribution provides {path.split('.')[0]}"))
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


def strings(value: Any) -> Iterator[str]:
    """Every string an argument holds, down its lists and mappings, keys included: what a step can name a column by."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, (list, tuple, dict)):
        for item in value.items() if isinstance(value, dict) else value:
            yield from strings(item)


def missing_column(error: KeyError, arguments: list[Any]) -> str | None:
    """What a KeyError means when its key, a column the step names, is not a column of a pandas DataFrame the step
    received: `reads column 'X', which the table does not have (closest: 'Y')`. None for any other KeyError."""
    pandas = sys.modules.get("pandas")
    named = set(strings(arguments))  # only these read as column names: pandas words other KeyErrors as sentences
    tables = [value for value in arguments if pandas and isinstance(value, pandas.DataFrame)]
    key = error.args[0] if error.args else None
    for column in key if isinstance(key, list) else [key]:  # `dropna(subset=...)` raises the missing ones as a list
        table = next((t for t in tables if column not in t.columns), None) if isinstance(column, str) and column in named else None
        if table is not None:
            closest = difflib.get_close_matches(column, [str(c) for c in table.columns], n=1)
            return f"reads column {column!r}, which the table does not have" + (f" (closest: {closest[0]!r})" if closest else "")
    return None


def jsonable(value: Any) -> bool:
    try:
        json.dumps(value)
        return True
    except (TypeError, ValueError):
        return False


class Run:
    def __init__(self, studyflow: Plan, repo: Path, cache: Path, sources: list[Path]) -> None:
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

    def resolve(self, path: str, element_id: str) -> Any:
        """The placeholder rule (docs/reference.qmd, "Placeholders"): `state` from its root; then, from the element
        outward, what each scope holds under the name; then an element's value, by id or unique name, loaded from
        its artifact when it has one; then, for a lone `{reached}`, the element's own counter, 0 when no run reached
        it. `None` when nothing holds the name."""
        head, *fields = path.split(".")
        tree = self.values.get("state") or {}
        if head == "state":
            return dig(tree, fields)
        scope = element_id
        while scope:
            found = dig(tree.get(scope), [head, *fields])
            if found is not None:
                return found
            scope = (self.studyflow.elements.get(scope) or {}).get("parent")
        # The element's own counter, never a container's: one no run reached counts 0.
        counter = dig(tree.get("_meta"), ["reached", element_id]) or 0 if head == "reached" and not fields else None
        source = self.by_name(head)
        if source not in self.values and source not in self.studyflow.elements:
            return counter
        try:
            return dig(self.value_of(source), fields)
        except KeyError:
            return None  # an element with nothing bound yet, no value and no `uri`: the placeholder stays as written

    def resolve_argument(self, value: Any, element_id: str) -> Any:
        """An argument that is one placeholder is the value it cites, a table or a model, not its text; inside a
        longer string a placeholder is text. A mapping with `implementation` is a call first."""
        path = placeholder_of(value)
        if path is not None:
            found = self.resolve(path, element_id)
            if found is None:
                return value if isinstance(value, str) else f"{{{path}}}"  # as written, quoted or not
            return found
        if isinstance(value, str):
            return PLACEHOLDER.sub(lambda m: m.group(0) if (v := self.resolve(m.group(1), element_id)) is None else str(v), value)
        if isinstance(value, dict) and "implementation" in value:
            nested = self.resolve_arguments(value.get("arguments") or {}, element_id)
            return resolve_implementation(value["implementation"])(*nested.pop("__args__", []), **nested)
        if isinstance(value, dict):
            return {k: self.resolve_argument(v, element_id) for k, v in value.items()}
        if isinstance(value, list):
            return [self.resolve_argument(v, element_id) for v in value]
        return value

    def by_name(self, reference: str) -> str:
        for element_id, name in self.studyflow.names.items():
            if name == reference:
                return element_id
        return reference

    def resolve_arguments(self, arguments: dict, element_id: str) -> dict:
        resolved: dict[str, Any] = {}
        for key, value in (arguments or {}).items():
            if key == "args":
                resolved["__args__"] = [self.resolve_argument(v, element_id) for v in value]
            else:
                resolved[key] = self.resolve_argument(value, element_id)
        return resolved

    def execute(self, element: dict[str, Any]) -> Any:
        implementation = element["attributes"].get("implementation") or ""
        keywords: dict[str, Any] = {}
        receiver: list[Any] = []
        # Standard form names slots structurally: an association targets a `bpmn:DataInput` whose `name` is the slot.
        io_slots: dict[str, str] = element.get("ioSlots") or {}
        for binding in element.get("inputs") or []:
            slot, lens = split_binding(binding.get("transformation"))
            if not slot:
                slot = io_slots.get(binding.get("target") or "")
            source_id = binding["source"]
            value = self.value_of(source_id)
            if lens:
                value = self.evaluate(lens, language=binding.get("language"))
            name = slot or self.studyflow.names.get(source_id) or source_id
            if name in ("self", "*"):
                # Positional, not keyword: `self` is an unbound method's receiver, `*` feeds a `*args` callable.
                receiver.append(value)
            elif name in keywords:
                raise ValueError(f"two data edges into {element['id']} fill the slot {name!r}; name the slot on one of them (`slot = selection`)")
            else:
                keywords[name] = value

        arguments = yaml.safe_load(element["additionalArguments"]) if element.get("additionalArguments") else {}
        resolved = self.resolve_arguments(arguments or {}, element["id"])
        positional = receiver + resolved.get("__args__", [])
        keywords.update({k: v for k, v in resolved.items() if k != "__args__"})

        target = resolve_implementation(implementation)
        print(f"implementation {implementation}")
        try:
            result = target(*positional, **keywords)
        except KeyError as error:
            missing = missing_column(error, [*positional, *keywords.values()])
            if missing is None:
                raise
            raise LookupError(missing) from None

        for binding in element.get("outputs") or []:
            target_id = binding.get("target")
            if not target_id:
                continue
            expression = binding.get("transformation") or ""
            bound = self.evaluate(expression, {"result": result}, language=binding.get("language")) if expression else result
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
    parser.add_argument("plan", type=Path, help="the plan digest studyflow-run-local hands over (plan.json)")
    parser.add_argument("--element", metavar="ID", default=None, help="hand-off mode: execute this one element")
    parser.add_argument("--claims", action="store_true", help="print the claimed element ids and exit")
    parser.add_argument("--cache", type=Path, default=None, metavar="DIR", help="hand-off state dir")
    # Accepted so studyflow-run-local can pass its shared runner flags; this runner has no use for them.
    parser.add_argument("--sim", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--auto", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    studyflow = Plan(json.loads(args.plan.read_text()))

    if args.claims:
        # Replayable, not live: studyflow-run-local's skip/reuse and branching apply to these elements.
        print(json.dumps({
            "live": False,
            "elements": [
                element_id for element_id, element in studyflow.elements.items()
                if (element["attributes"].get("implementation") or "").startswith("python://")
            ],
        }))
        return 0

    if not args.element:
        parser.error("standalone walking is not implemented here — use studyflow-run-local, or pass --element")

    cache = args.cache or Path(".")
    repo = cache.resolve().parent if args.cache else Path.cwd()
    handoff = cache / f"{args.element}.state.json"
    state = json.loads(handoff.read_text()) if handoff.exists() else {}

    # The root seed comes from the diagram itself, the same file every process reads.
    seed = studyflow.seed()
    if seed:
        try:
            random.seed(int(seed))
            import numpy
            numpy.random.seed(int(seed) % 2**32)
        except Exception:  # noqa: BLE001, S110 - a non-numeric seed seeds nothing
            pass

    run = Run(studyflow, repo, cache, sources=[*studyflow.sources, Path.cwd()])
    run.values.update(state)
    clock = time.perf_counter()
    try:
        element = studyflow.elements.get(args.element)
        if element is None:
            raise KeyError(f"no element {args.element!r} in the diagram")
        result = run.execute(element)
        version = distribution(element["attributes"]["implementation"][len("python://"):].split(".")[0])
    except BaseException as error:  # noqa: BLE001 - reported to the leading runner, which records it
        state["error"] = f"{type(error).__name__}: {error}"
    else:
        # The updated state: every JSON-able value this element bound, the result, and the timing; and, for the
        # record only, what provided the implementation.
        state.update({k: v for k, v in run.values.items() if jsonable(v)})
        state["result"] = result if jsonable(result) else str(type(result).__name__)
        state["durationMs"] = round((time.perf_counter() - clock) * 1000, 1)
        state["record"] = {"version": version}
    cache.mkdir(parents=True, exist_ok=True)
    handoff.write_text(json.dumps(state, default=str))
    return 1 if "error" in state else 0


if __name__ == "__main__":
    sys.exit(main())

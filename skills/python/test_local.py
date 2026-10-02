"""One check for the python runner's arguments, pins, records, outputs, seed and codecs; run it with
`python3 skills/python/test_local.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local as python  # noqa: E402

plan = python.Plan({
    "elements": {"Fit": {"id": "Fit", "parent": "Study"}, "Split_1": {"id": "Split_1", "name": "split", "parent": "Study"}},
    "names": {"Split_1": "split"},
})
run = python.Run(plan, Path("."), Path("."), [])
table = [[1, 2], [3, 4]]
run.values.update({"Split_1": {"train": table}, "state": {"Study": {"folds": 5}}})
resolve = lambda value: run.resolve_argument(value, "Fit")  # noqa: E731

# One placeholder is the value itself, quoted or as the one-key mapping YAML makes of an unquoted one.
assert resolve("{split.train}") is table
assert resolve({"split.train": None}) is table
# The nearest scope's value, a study property here; inside a longer string, text; nothing holds it, as written.
assert resolve("{folds}") == 5
assert resolve("cv={folds}, {nothing}") == "cv=5, {nothing}"
assert resolve("{nothing}") == "{nothing}"
# Unresolved, the unquoted form is the same text as the quoted one; an element with nothing bound yet stays as written.
assert resolve({"nothing": None}) == "{nothing}"
plan.elements["Report"] = {"id": "Report", "parent": "Study"}
assert resolve("Scores before {Report}") == "Scores before {Report}"
# Letters of any script and hyphenated ids are names too, as in the modeler.
run.values["state"]["Study"].update({"durée": 3, "sid-12": 4})
assert resolve("{durée} {sid-12}") == "3 4"
assert python.placeholder_of("{a} and {b}") is None

# Two levels of nesting: a step in a collapsed sub-process inside another reads what an outer scope holds, and the
# elements it cites by name, which are the study's wherever they are drawn.
plan.elements["Analysis"] = {"id": "Analysis", "parent": "Study"}
plan.elements["Typed"] = {"id": "Typed", "parent": "Analysis"}
plan.elements["Drop"] = {"id": "Drop", "parent": "Typed"}
run.values["state"]["Analysis"] = {"folds": 9}
nested = lambda value: run.resolve_argument(value, "Drop")  # noqa: E731
assert nested("{folds}") == 9          # the nearest scope outward, two levels up
assert nested("{split.train}") is table  # an element by name, wherever it sits
assert nested("{state.Study.folds}") == 5

import importlib.metadata  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import platform  # noqa: E402
import tempfile  # noqa: E402

# What provides an implementation: an installed distribution by its metadata, the standard library by Python's version.
assert python.distribution("yaml") == f"PyYAML {importlib.metadata.version('PyYAML')}"
assert python.distribution("json") == f"python {platform.python_version()}"
assert python.distribution("no_such_package") is None
# A pin holds for the installed version it starts, component by component: 1.2 is 1.2.3, not 1.20; and without
# metadata there is nothing to hold it against. Either failure names what was wanted and what was found.
installed = python.distribution
for found, error in (("fake 1.2.3", None), ("fake 1.2", None), ("fake 1.20", "pins 1.2, and fake 1.20 is installed"),
                     (None, "pins 1.2, and no installed distribution provides json")):
    python.distribution = lambda top, found=found: found
    try:
        assert python.resolve_implementation("python://json.dumps@1.2") is json.dumps and error is None, found
    except ImportError as failed:
        assert str(failed) == f"python://json.dumps@1.2 {error}", failed
python.distribution = installed

# A hand-off hands back what provided the step's implementation, as `record`, beside its result.
from runner import Step  # noqa: E402 - the SDK, on the path since `local` was imported

dump = {"id": "Dump", "type": "serviceTask", "attributes": {"implementation": "python://json.dumps"}, "additionalArguments": "obj: [1]"}
step = Step("Dump", {"elements": {"Dump": dump}}, {})
assert python.claims(step.plan) == {"live": False, "elements": ["Dump"]}
assert python.execute(step) == "[1]" and step.record == {"version": f"python {platform.python_version()}"}, step.record

# What a step makes goes where its data outputs say, each narrowed by its edge's `transformation`: into the file its
# `uri` names, by its format; a JSON-able value back to the walk too; any other spilled to the cache, where the next
# hand-off reads it.
from fractions import Fraction  # noqa: E402

with tempfile.TemporaryDirectory() as folder:
    made = python.Plan({"elements": {data: {"id": data, "type": "dataObjectReference", "attributes": attributes}
                                     for data, attributes in (("Saved", {"uri": "out/a.json"}), ("Kept", {}), ("Third", {}))}})
    out = python.Run(made, Path(folder), Path(folder) / ".cache", [])
    pair = {"id": "Pair", "attributes": {"implementation": "python://builtins.dict"}, "additionalArguments": "a: [1, 2]",
            "outputs": [{"target": "Saved", "transformation": "result.a"}, {"target": "Kept"}]}
    assert out.execute(pair) == {"a": [1, 2]}
    assert json.loads((Path(folder) / "out" / "a.json").read_text()) == [1, 2]
    assert out.bound == {"Saved": [1, 2], "Kept": {"a": [1, 2]}}, out.bound
    if importlib.util.find_spec("joblib") is not None:
        divide = {"id": "Divide", "attributes": {"implementation": "python://fractions.Fraction"}, "additionalArguments": "args: [1, 3]",
                  "outputs": [{"target": "Third"}]}
        assert out.execute(divide) == Fraction(1, 3) and "Third" not in out.bound
        assert python.Run(made, Path(folder), Path(folder) / ".cache", []).value_of("Third") == Fraction(1, 3)

# One record, a mapping, into a `.jsonl` data store is a line more of it: a step that runs once per subject leaves a line
# per subject. The store's value stays the file, so the record is not bound in its place.
with tempfile.TemporaryDirectory() as folder:
    logged = python.Plan({"elements": {"Completers": {"id": "Completers", "type": "dataStoreReference",
                                                      "attributes": {"uri": "data/completers.jsonl"}}}})
    out = python.Run(logged, Path(folder), Path(folder) / ".cache", [])
    for subject in (1, 2):
        line = {"id": "Line", "attributes": {"implementation": "python://builtins.dict"},
                "additionalArguments": f"context: {{subject: {subject}}}", "outputs": [{"target": "Completers"}]}
        assert out.execute(line) == {"context": {"subject": subject}}
    assert (Path(folder) / "data" / "completers.jsonl").read_text() == '{"context":{"subject":1}}\n{"context":{"subject":2}}\n'
    assert "Completers" not in out.bound and "Completers" not in out.values, out.bound

# Every hand-off starts from the study's seed: `random`, and numpy's global generator when numpy is here. A seed that
# is no number seeds nothing, and fails nothing.
import random  # noqa: E402

firsts = {"python://random.random": random.Random(7).random()}
if importlib.util.find_spec("numpy") is not None:
    import numpy  # noqa: E402
    firsts["python://numpy.random.random_sample"] = numpy.random.RandomState(7).random_sample()
for implementation, first in firsts.items():
    draw = {"id": "Draw", "type": "serviceTask", "attributes": {"implementation": implementation}}
    assert python.execute(Step("Draw", {"study": {"seed": "7"}, "elements": {"Draw": draw}}, {})) == first, implementation
    python.execute(Step("Draw", {"study": {"seed": "seven"}, "elements": {"Draw": draw}}, {}))

# A `.jsonl` artifact (the behaverse runner's trial events) round-trips as a table, its nested keys as `a.b` columns.
if importlib.util.find_spec("pandas") is None:
    print("ok (no pandas here, so the artifact codecs go unchecked)")
    raise SystemExit

with tempfile.TemporaryDirectory() as folder:
    events = Path(folder) / "trials.jsonl"
    events.write_text('{"object": {"name": "TrialEnd"}, "context": {"subject": 1}}\n'
                      '{"object": {"name": "TrialEnd"}, "context": {"subject": 2}}\n')
    assert python.format_for("data/trials.jsonl", None) == "jsonl"
    table = python.load_artifact(events, "jsonl")
    assert list(table["context.subject"]) == [1, 2], table
    python.save_artifact(table, Path(folder) / "again.jsonl", "jsonl")
    assert list(python.load_artifact(Path(folder) / "again.jsonl", "jsonl")["context.subject"]) == [1, 2]

# A `.jsonl` data store a step of the study writes holds nothing before its first line: a table with no row and the
# columns its schema declares, so a match on them finds nothing rather than failing. One no step writes is a boundary
# input, and missing it still fails.
with tempfile.TemporaryDirectory() as folder:
    body = "tableSchema:\n  columns:\n    - name: context.subject\n    - name: context.state.arm\n"
    logs = python.Plan({"elements": {
        "Completers": {"id": "Completers", "type": "dataStoreReference", "attributes": {"uri": "data/completers.jsonl"},
                       "extensions": [{"type": "dataset", "attributes": {"schema": "Completer_Schema"}}]},
        "Completer_Schema": {"id": "Completer_Schema", "type": "dataObjectReference", "attributes": {},
                             "extensions": [{"type": "schema", "attributes": {"body": body}}]},
        "Record": {"id": "Record", "outputs": [{"target": "Completers"}]},
        "Imported": {"id": "Imported", "type": "dataStoreReference", "attributes": {"uri": "data/imported.jsonl"}},
    }})
    empty = python.Run(logs, Path(folder), Path(folder) / ".cache", []).value_of("Completers")
    assert empty.empty and list(empty.columns) == ["context.subject", "context.state.arm"], empty
    try:
        python.Run(logs, Path(folder), Path(folder) / ".cache", []).value_of("Imported")
        raise AssertionError("a missing boundary input reads as nothing")
    except FileNotFoundError:
        pass

# An output edge's path on a table reads its column before its attribute: `result.T` of a test's one-row table is its
# `T` column, not the table transposed, so the edge hands the walk the numbers a decision reads.
with tempfile.TemporaryDirectory() as folder:
    tested = python.Run(python.Plan({"elements": {"Test": {"id": "Test", "type": "property", "attributes": {}}}}),
                        Path(folder), Path(folder) / ".cache", [])
    table = {"id": "Table", "attributes": {"implementation": "python://pandas.DataFrame"},
             "additionalArguments": "data: {T: [4.08], dof: [7.0], p_unc: [0.002]}",
             "outputs": [{"target": "Test", "transformation": "{statistic: result.T[1], pvalue: result.p_unc[1], subjects: result.dof[1] + 1}"}]}
    tested.execute(table)
    assert tested.bound == {"Test": {"statistic": 4.08, "pvalue": 0.002, "subjects": 8}}, tested.bound

# A column the step names and its table lacks is said so, with the nearest column the table has; a KeyError pandas
# words as a sentence is left as it is.
import pandas  # noqa: E402

run.values["Trials"] = pandas.DataFrame({"subject": [1, 2], "rt": [0.4, 0.5]})
for implementation, arguments, said in (
    ("pandas.DataFrame.groupby", "by: subjct", "reads column 'subjct', which the table does not have (closest: 'subject')"),
    ("pandas.DataFrame.dropna", "subset: [latency]", "reads column 'latency', which the table does not have"),
    ("pandas.DataFrame.drop", "columns: [subjct]", None),
):
    step = {"id": "Step", "attributes": {"implementation": f"python://{implementation}"}, "additionalArguments": arguments,
            "inputs": [{"source": "Trials", "transformation": "self"}]}
    try:
        run.execute(step)
        raise AssertionError(implementation)
    except LookupError as failed:
        assert str(failed) == said if said else type(failed) is KeyError, failed
print("ok")

"""One check for the python runner's arguments, pins, records and codecs; run it with
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
with tempfile.TemporaryDirectory() as folder:
    cache = Path(folder) / ".cache"
    cache.mkdir()
    (cache / "plan.json").write_text(json.dumps({"elements": {"Dump": {
        "id": "Dump", "type": "serviceTask", "attributes": {"implementation": "python://json.dumps"}, "additionalArguments": "obj: [1]"}}}))
    (cache / "Dump.state.json").write_text("{}")
    sys.argv = ["local.py", str(cache / "plan.json"), "--element", "Dump", "--cache", str(cache)]
    assert python.main() == 0
    handed = json.loads((cache / "Dump.state.json").read_text())
    assert handed["result"] == "[1]" and handed["record"] == {"version": f"python {platform.python_version()}"}, handed

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

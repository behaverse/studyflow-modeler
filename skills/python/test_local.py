"""One check for the python runner's arguments; run it with `python3 skills/python/test_local.py`."""

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
print("ok")

"""The runner SDK's placeholder rule; run it with `python3 skills/local/test_runner.py`. The protocol it speaks is
pinned by tests/cli-run.unit.spec.ts, whose runners are written with it."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import runner  # noqa: E402

# `state` from its root; the nearest scope outward (Thanks sits in Study); an element's result by id or name.
plan = {"elements": {"Thanks": {"parent": "Study"}}, "names": {"Greet_1": "Greet"}}
values = {"Answer": {"trials": 5}, "Greet_1": "hello", "state": {"Study": {"count": 7, "voice": "Alex"}}}
assert runner.fill("{voice}: {Answer.trials} trials, {Greet}, {state.Study.count} in all. {nothing}", "Thanks", values, plan) \
    == "Alex: 5 trials, hello, 7 in all. {nothing}"
assert runner.fill({"voice": None}, "Thanks", values, plan) == "Alex"  # YAML's reading of an unquoted `{voice}`
# A text that is one placeholder is the value as held; nothing is None.
assert runner.read("{count}", "Thanks", values, plan) == 7 and runner.read("{nothing}", "Thanks", values, plan) is None
assert runner.read("n={count}", "Thanks", values, plan) == "n=7" and runner.read(3, "Thanks", values, plan) == 3
# A scope's own value shadows an outer one; a lone `{reached}` is the element's own counter, never a container's.
nested = {"state": {"Study": {"count": 7}, "Round": {"count": 2}, "_meta": {"reached": {"Round": 3}}}}
inner = {"elements": {"Step": {"parent": "Round"}, "Round": {"parent": "Study"}}}
assert runner.resolve("count", "Step", nested, inner) == 2
assert runner.resolve("reached", "Round", nested, inner) == 3
assert runner.resolve("reached", "Step", nested, inner) == 0  # inside Round, but no run reached Step itself
assert runner.resolve("reached", "Step", {}, inner) == 0  # and 0 in a file no run has touched
# What a step hands back: its result, what it bound, wrote and ran with; nothing it did not say.
step = runner.Step("Step", inner, nested)
step.bind("Out", [1]); step.write("Round", "count", 3); step.note(version="1.0")
back = step.handback("done", 0.0)
assert {k: back[k] for k in ("result", "values", "state", "record")} == \
    {"result": "done", "values": {"Out": [1]}, "state": {"Round": {"count": 3}}, "record": {"version": "1.0"}}
assert set(runner.Step("Step", inner, nested).handback(None, 0.0)) == {"durationMs"}
print("ok")

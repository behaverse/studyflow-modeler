"""The runner SDK's placeholder rule; run it with `python3 packages/runtime-local/python/test_runner.py`. The protocol it speaks is
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
# A result goes into each data output, narrowed by that edge's transformation.
made = runner.Step("Make", {"elements": {"Make": {"outputs": [{"target": "Shown", "transformation": "result.trials"}, {"target": "All"}]}}}, {})
made.outputs({"trials": [1, 2], "key": [3, 4]})
assert made.bound == {"Shown": [1, 2], "All": {"trials": [1, 2], "key": [3, 4]}}

# Work that cannot be stopped midway hands back its value or its error; when the walk stops the step, the hand-off
# answers at once and the work finishes behind it. A step already stopped starts none.
import threading  # noqa: E402
import time  # noqa: E402

move = runner.Step("Move", {}, {})
assert move.unless_cancelled(lambda: 7) == 7
try:
    move.unless_cancelled(lambda: 1 / 0)
    raise AssertionError("the work's error is the hand-off's")
except ZeroDivisionError:
    pass
finished, started = threading.Event(), []
threading.Timer(0.1, move._cancelled.set).start()
try:
    move.unless_cancelled(lambda: started.append(time.monotonic()) or time.sleep(0.6) or finished.set())
    raise AssertionError("a stopped step waited for its work")
except runner.Cancelled:
    answered = time.monotonic() - started[0]
assert answered < 0.4 and finished.wait(2), answered
try:
    move.unless_cancelled(lambda: started.append(time.monotonic()))
    raise AssertionError("a stopped step started work")
except runner.Cancelled:
    assert len(started) == 1

# `shutdown` stops a hand-off still running, so the runner answers and exits at once rather than when it ends.
import json  # noqa: E402
import subprocess  # noqa: E402

served = subprocess.Popen(
    [sys.executable, "-c", "import runner; runner.serve(lambda plan: [], lambda step: print('waiting') or step.receive())"],
    cwd=Path(__file__).parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
served.stdin.write('{"jsonrpc":"2.0","id":1,"method":"execute","params":{"element":"Wait"}}\n')
served.stdin.flush()
assert json.loads(served.stdout.readline())["method"] == "log"  # the hand-off runs
try:
    out, _ = served.communicate('{"jsonrpc":"2.0","id":2,"method":"shutdown"}\n', timeout=1)
except subprocess.TimeoutExpired:
    served.kill()
    raise AssertionError("shutdown waited for the hand-off") from None
answers = [json.loads(line) for line in out.splitlines()]
assert served.returncode == 0 and [a["id"] for a in answers] == [1, 2] and answers[0]["error"]["code"] == 2, answers

# JSON has no NaN or Infinity, and the walk's parser refuses a line that holds one, which would lose the hand-back: a
# non-finite number a step hands back (the p-value of a test that could not run) travels as null.
served = subprocess.Popen(
    [sys.executable, "-c", "import runner; runner.serve(lambda plan: [], lambda step: {'p': float('nan'), 't': [float('inf'), -float('inf'), 1.5]})"],
    cwd=Path(__file__).parent, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
out, _ = served.communicate('{"jsonrpc":"2.0","id":1,"method":"execute","params":{"element":"Test"}}\n'
                            '{"jsonrpc":"2.0","id":2,"method":"shutdown"}\n', timeout=5)


def refuse(constant: str) -> None:
    raise ValueError(f"{constant} is not JSON")  # as JavaScript's JSON.parse, which the walk reads the line with


strict = json.loads(out.splitlines()[0], parse_constant=refuse)
assert strict["result"]["result"] == {"p": None, "t": [None, None, 1.5]}, strict
print("ok")

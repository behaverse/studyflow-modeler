"""One check for the shell runner's argument building and hand-off; run it with `python3 skills/shell/test_local.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local as shell  # noqa: E402

say = {"id": "Thanks", "attributes": {"implementation": "shell://say"},
       "additionalArguments": "v: {voice}\nargs:\n  - I answered {Answer.trials} trials, {Greet}, {state.Study.count} in all. {nothing}\n"}
plan = {"elements": {"Thanks": {"parent": "Study"}}, "names": {"Greet_1": "Greet"}}
values = {"Answer": {"trials": 5}, "Greet_1": "hello", "state": {"Study": {"count": 7, "voice": "Alex"}}}
assert shell.command_of(say) == "say"
assert shell.command_of({"attributes": {"implementation": "python://os.getcwd"}}) is None
assert shell.argv_of(say, values, plan) == ["say", "-v", "Alex", "I answered 5 trials, hello, 7 in all. {nothing}"]
assert shell.argv_of({"id": "e", "attributes": {"implementation": "shell://echo@1"}}, {}, {}) == ["echo"]
# A vocabulary step with a shell:// implementation (a reachy:Interact rendering its line) is its own runner's.
assert shell.claimed({"elements": {"plain": say, "robot": {**say, "extensions": [{"namespace": "x", "type": "say"}]}, "py": {"attributes": {"implementation": "python://f"}}}}) == ["plain"]

# A hand-off runs the command in the run directory, and what it prints is the step's result; a command that exits
# with an error fails the step.
import tempfile  # noqa: E402

from runner import Step  # noqa: E402 - the SDK, on the path since `local` was imported

with tempfile.TemporaryDirectory() as folder:
    (Path(folder) / "made.txt").write_text("")
    hand = lambda command: Step("Run", {"elements": {"Run": {"id": "Run", "attributes": {"implementation": f"shell://{command}"}}}}, {}, run_dir=Path(folder))  # noqa: E731
    assert shell.execute(hand("ls")) == "made.txt"
    try:
        shell.execute(hand("false"))
        raise AssertionError("false")
    except RuntimeError as failed:
        assert str(failed) == "false exited with code 1", failed
print("ok")

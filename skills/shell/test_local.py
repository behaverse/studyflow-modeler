"""One check for the shell runner's argument building; run it with `python3 skills/shell/test_local.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local as shell  # noqa: E402

say = {"id": "Thanks", "attributes": {"implementation": "shell://say"},
       "additionalArguments": "v: Alex\nargs:\n  - I answered {Answer.trials} trials, {Greet}. {nothing}\n"}
values = {"Answer": {"trials": 5}, "Greet_1": "hello"}
names = {"Greet_1": "Greet"}
assert shell.command_of(say) == "say"
assert shell.command_of({"attributes": {"implementation": "python://os.getcwd"}}) is None
assert shell.argv_of(say, values, names) == ["say", "-v", "Alex", "I answered 5 trials, hello. {nothing}"]
assert shell.argv_of({"id": "e", "attributes": {"implementation": "shell://echo@1"}}, {}, {}) == ["echo"]
# A vocabulary step with a shell:// implementation (a reachy:Say rendering its line) is its own runner's.
assert shell.claimed({"plain": say, "robot": {**say, "extensions": [{"namespace": "x", "type": "say"}]}, "py": {"attributes": {"implementation": "python://f"}}}) == ["plain"]
print("ok")

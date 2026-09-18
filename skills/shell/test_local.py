"""One check for the shell runner's argument building; run it with `python3 skills/shell/test_local.py`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import local as shell  # noqa: E402

say = {"id": "Thanks", "attributes": {"implementation": "shell://say"},
       "additionalArguments": "v: {voice}\nargs:\n  - I answered {Answer.trials} trials, {Greet}, {state.Study.count} in all. {nothing}\n"}
# The placeholder rule: `state` from its root; the nearest scope outward (Thanks sits in Study); an element's result by id or name.
digest = {"elements": {"Thanks": {"parent": "Study"}}, "names": {"Greet_1": "Greet"}}
values = {"Answer": {"trials": 5}, "Greet_1": "hello", "state": {"Study": {"count": 7, "voice": "Alex"}}}
assert shell.command_of(say) == "say"
assert shell.command_of({"attributes": {"implementation": "python://os.getcwd"}}) is None
assert shell.argv_of(say, values, digest) == ["say", "-v", "Alex", "I answered 5 trials, hello, 7 in all. {nothing}"]
assert shell.argv_of({"id": "e", "attributes": {"implementation": "shell://echo@1"}}, {}, {}) == ["echo"]
# A scope's own value shadows an outer one; a lone `{reached}` is the element's own counter, never a container's.
nested = {"state": {"Study": {"count": 7}, "Round": {"count": 2}, "_meta": {"reached": {"Round": 3}}}}
inner = {"elements": {"Step": {"parent": "Round"}, "Round": {"parent": "Study"}}}
assert shell.resolve("count", "Step", nested, inner) == 2
assert shell.resolve("reached", "Round", nested, inner) == 3
assert shell.resolve("reached", "Step", nested, inner) == 0  # inside Round, but no run reached Step itself
assert shell.resolve("reached", "Step", {}, inner) == 0  # and 0 in a file no run has touched
# A vocabulary step with a shell:// implementation (a reachy:Interact rendering its line) is its own runner's.
assert shell.claimed({"plain": say, "robot": {**say, "extensions": [{"namespace": "x", "type": "say"}]}, "py": {"attributes": {"implementation": "python://f"}}}) == ["plain"]
print("ok")

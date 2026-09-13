"""One check that run.py draws what the browser runner draws; run it with `python3 skills/local/test_run.py`."""

import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("run", Path(__file__).with_name("run.py"))
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

# [seed, gateway id, visit, draw] as skills/browser/src/branching.ts `draw` computes them; exact binary fractions,
# so JSON carries them exactly and the two runners must agree to the bit.
rows = json.loads((Path(__file__).parents[2] / "tests" / "fixtures" / "draws.json").read_text(encoding="utf-8"))
for seed, gateway, visit, value in rows:
    assert run.draw(seed, gateway, visit) == value, (seed, gateway, visit, run.draw(seed, gateway, visit), value)
print("ok")

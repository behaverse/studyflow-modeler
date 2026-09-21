"""One check that run.py draws what the browser runner draws, and allocates as its gateway says; run it with
`python3 skills/local/test_run.py`."""

import importlib.util
import json
from pathlib import Path
from xml.etree import ElementTree as ET

spec = importlib.util.spec_from_file_location("run", Path(__file__).with_name("run.py"))
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)

# [seed, gateway id, visit, draw] as skills/browser/src/branching.ts `draw` computes them; exact binary fractions,
# so JSON carries them exactly and the two runners must agree to the bit.
rows = json.loads((Path(__file__).parents[2] / "tests" / "fixtures" / "draws.json").read_text(encoding="utf-8"))
for seed, gateway, visit, value in rows:
    assert run.draw(seed, gateway, visit) == value, (seed, gateway, visit, run.draw(seed, gateway, visit), value)

# Equal weights pick what every seed has always picked, `int(u * n)`; a 2:1 ratio gives the first arm two thirds.
for u in (0.0, 0.25, 0.49, 0.5, 0.74, 0.999):
    assert run.pick(u, [1, 1]) == int(u * 2) and run.pick(u, [1, 1, 1]) == int(u * 3)
assert [run.pick(u, [2, 1]) for u in (0.0, 0.66, 2 / 3, 0.99)] == [0, 0, 1, 1]

# Each block holds the arms in the ratio, its order is the seed's alone, and the blocks are not all alike.
for seed in (1, 6, 15, 42):
    for weights, size, arms in (([1, 1], 4, [0, 0, 1, 1]), ([2, 1], 6, [0, 0, 0, 0, 1, 1])):
        blocks = [run.permuted_block(seed, "Draw", b, weights, size) for b in range(8)]
        assert all(sorted(block) == arms for block in blocks), blocks
        assert blocks == [run.permuted_block(seed, "Draw", b, weights, size) for b in range(8)]
        assert len({tuple(block) for block in blocks}) > 1, blocks
assert sorted(run.permuted_block(None, "Draw", 0, [1, 1], 4)) == [0, 0, 1, 1]  # unseeded, still balanced


def gateway(**attributes: str) -> tuple[ET.Element, ET.Element]:
    return ET.Element("exclusiveGateway", id="Draw", name="Allocation"), ET.Element("randomGateway", attributes)


assert run.allocation(*gateway(), 2) == ("simple", [1, 1], 4, None)
assert run.allocation(*gateway(algorithm="block", allocationRatio="2:1", blockSize="6"), 2) == ("block", [2, 1], 6, None)
# What it cannot apply stops the run before the walk: a block the ratio cannot fill, a ratio that misses a branch.
for attributes, arms in (({"algorithm": "block", "allocationRatio": "2:1"}, 2), ({"algorithm": "block"}, 3),
                         ({"allocationRatio": "1:1"}, 3), ({"allocationRatio": "1:x"}, 2)):
    try:
        run.allocation(*gateway(**attributes), arms)
        raise AssertionError(attributes)
    except SystemExit as stop:
        assert "'Allocation'" in str(stop), stop
# What it does not apply is warned about, saying what it does instead.
_, _, _, warning = run.allocation(*gateway(algorithm="minimization", stratifyBy="age_band"), 2)
assert warning.startswith("'Allocation' specifies minimization assignment and stratification by 'age_band', which "
                          "this runner does not apply: it draws one of the 2 outgoing branches"), warning
_, _, _, warning = run.allocation(*gateway(algorithm="block", stratifyBy="age_band"), 2)
assert "in permuted blocks of 4" in warning, warning
print("ok")

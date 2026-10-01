"""packages/runtime-local/python/feel.py against tests/fixtures/feel.json, the rows packages/core/tests/feel.unit.spec.ts pins feelin to."""

import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("feel", Path(__file__).with_name("feel.py"))
feel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feel)

rows = json.loads((Path(__file__).parents[3] / "tests" / "fixtures" / "feel.json").read_text(encoding="utf-8"))
for expression, context, expected in rows:
    if isinstance(expected, dict) and "error" in expected:
        try:
            feel.evaluate(expression, context)
        except feel.FeelError:
            continue
        raise AssertionError(f"{expression!r} should be refused")
    value = feel.evaluate(expression, context)
    assert value == expected and type(value) is type(expected) or (isinstance(value, (int, float)) and value == expected), \
        (expression, value, expected)
print(f"feel: {len(rows)} rows agree")

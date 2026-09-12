---
name: python
description: "Executes elements whose implementation is a python:// entry point, with the study's dependencies installed. Use when a diagram calls Python functions for its data or analysis steps."
license: MIT
compatibility: "Local runtime with uv."
metadata:
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill for the core vocabulary: any element with `implementation: python://<module>.<callable>`
is claimed and called with its inputs, in an environment holding the study's `dependencies`. Its
`additionalArguments` mapping holds the call's keyword arguments (`args` the positional ones). An argument that is one
[placeholder](../../docs/reference.qmd#placeholders), `{split.train}`, passes the value it cites rather than its text.
`test_local.py` is its self-check.

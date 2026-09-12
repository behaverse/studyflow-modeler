---
name: shell
description: "Executes elements whose implementation is a shell://<command> entry point: that executable on this machine, with the step's arguments. Use when a diagram calls a command-line tool, such as macOS `say`."
license: MIT
compatibility: "Local runtime with uv."
metadata:
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill for the core vocabulary: any plain element with `implementation: shell://<command>` is
claimed and run as that command, in the run directory (a vocabulary step naming one, such as a `reachy:Say`
rendering its line, is its own skill's to run). Its `additionalArguments` mapping is the argument list: `args`
are positional, every other key is a flag (`v: Alex` → `-v Alex`, `rate: 180` → `--rate 180`). An argument may
cite a value with a [placeholder](../../docs/reference.qmd#placeholders), `{Answer.trials}` for an earlier element's result. The command's
stdout is the step's result; a non-zero exit fails the step. `test_local.py` is its self-check.

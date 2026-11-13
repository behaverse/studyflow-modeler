---
name: shell
description: "Executes elements whose implementation is a shell://<command> entry point: that executable on this machine, with the step's arguments. Use when a diagram calls a command-line tool, such as macOS `say`."
license: MIT
compatibility: "Local runtime with uv."
metadata:
  schemes: "shell"  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill for the core vocabulary. It claims any plain element whose `implementation` is
`shell://<command>` and runs that command in the run directory. A vocabulary step that names one, such as a
`reachy:Interact` rendering its line, is its own skill's to run.

```yaml
Render:
  type: ServiceTask
  name: Render the instructions
  additionalArguments:
    args:
      - "{line}"
    o: instructions-{Today}.aiff
    rate: 180
  implementation: shell://say

Say_Failed:
  type: BoundaryEvent
  name: say failed
  error: true
  attachedTo: $Render
```

[`spoken_instructions`](examples/spoken_instructions.studyflow.yaml) is the whole study: a date stamp, a line
rendered to an audio file with macOS's `say`, and a step that prints the line where `say` fails.

## Arguments

The element's `additionalArguments` mapping is the argument list.

| Key | Becomes |
| --- | --- |
| `args` | The positional arguments, in order. |
| any other key | A flag: `o: file.aiff` is `-o file.aiff`, and `rate: 180` is `--rate 180`. |

An argument may cite a value with a [placeholder](../../docs/reference.qmd#placeholders): `{Today}` is an earlier
element's result, and `{line}` a property of the study.

## Result and failure

The command's stdout is the step's result. A command that exits with an error, or is not on the machine, fails its
step. An error boundary event on the step catches the failure, and the study goes on from there.

`test_local.py` is the runner's self-check.

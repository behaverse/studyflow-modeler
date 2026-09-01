# @behaverse/studyflow-cli

`studyflow` is the command-line tool to work with studyflow diagrams. It can convert between `.studyflow.yaml`, XML, and PNG, validate diagrams, inspect metadata, and execute them.

## Install

Using Homebrew (macOS or Linux):

```bash
brew tap morteza/studyflow https://github.com/morteza/studyflow-modeler
brew install studyflow
```

Or from the source code (needs `uv` on PATH for `run`):

```bash
npm run build -w @behaverse/studyflow-cli      # writes packages/cli/dist/studyflow.mjs
node packages/cli/dist/studyflow.mjs --help
```

## CLI

Use `--help` to see the commands and options:

```bash
studyflow --help
studyflow <command> --help
```

## Examples

```bash
studyflow run 'assets/schemas/examples/AI & ML/sklearn_pipeline.studyflow.png'
studyflow run runs/*/sklearn_pipeline.studyflow.png                # re-run
studyflow run runs/*/sklearn_pipeline.studyflow.png --from <ref>   # branch
studyflow run runs/*/sklearn_pipeline.studyflow.png --fresh        # re-run all

# Reachy Mini example, auto-answered
studyflow run assets/schemas/examples/Robotics/reachy_session.studyflow.png --auto

# Reachy Mini as the participant: the robot serves the browser task's response
# bridge (ResponseSource: external) and answers each trial from its camera, or
# the screenshot the task attaches. Then run the study in the browser.
./src/studyflow-reachy.py assets/schemas/examples/Robotics/reachy_participant.studyflow.png --participant --sim
```

## Extending CLI

*Partial runners* extend the CLI to execute specific elements in a diagram. A partial runner is a script that claims certain elements and executes them.

Name an executable `studyflow-<name>` and `studyflow` discovers it as a partial runner. It first asks your runner `<diagram> --claims`; print the element ids you will run as one JSON array on stdout. It then invokes the runner once per claimed element with `<diagram> --element <id> --cache <dir>`. The cache directory holds one file per call, named `<element_id>.state.json`. The file starts as `{state}`, and the runner updates it with the result, so it becomes the same state plus `result` (what the element produced), `durationMs`, and on failure `error` with a non-zero exit. The run log captures stdout; stdin and stderr stay on the terminal. [`studyflow-reachy.py`](src/studyflow-reachy.py) is a working example. It also works standalone on `reachy:` namespace elements.

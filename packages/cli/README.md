# @behaverse/studyflow-cli

`studyflow` is the command-line tool to work with studyflow diagrams. It can convert between `.studyflow.yaml`, XML, and PNG, validate diagrams, inspect metadata, and execute them.

## Install

Using Homebrew (macOS or Linux):

```bash
brew tap behaverse/studyflow https://github.com/behaverse/studyflow-modeler
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

# Reachy Mini as the participant: a study whose task's bot says `ResponseSource:
# external` seats the robot by itself. The walk starts the participant bridge in the
# background (its log and what the robot saw land in the run directory), the robot
# turns until its camera finds the screen and answers each trial from what it sees
# (the sim has no camera and uses the screenshot the task attaches), the study's own
# reachy elements (say, gesture, look at the screen…) are performed through it, and
# the end event dismisses it. The Robot pool's `vision` names the model. A `screen`
# look's result is the gaze: a data edge into a declared property (`screenGaze` on the
# process) keeps it in the study state, and a later look can take `target: "{screenGaze}"`. To seat it by hand instead, e.g. for the browser runner
# or another vision model (default ollama:gemma4:12b-it-qat):
../../runners/studyflow-reachy.py --participant --frames runs/frames --vlm ollama:gemma4:26b

# Behaverse (Unity WebGL) tasks from the CLI: each task opens full screen in a
# Chromium window of its own (app mode, throwaway profile; the default browser
# without one), closed when the task completes, served from the build at
# UNITY_BUILD_PATH; trials of a bot with `ResponseSource: external` go to the
# response bridge above.
UNITY_BUILD_PATH=path/to/Build/WebGL studyflow run --runtime local assets/schemas/examples/Robotics/reachy_participant.studyflow.png
```

## Extending CLI

*Partial runners* extend the CLI to execute specific elements in a diagram. A partial runner is a script that claims certain elements and executes them.

Name an executable `studyflow-<name>` and `studyflow` discovers it as a partial runner. It first asks your runner `<plan.json> --claims`; print the element ids you will run as one JSON array on stdout. It then invokes the runner once per claimed element with `<plan.json> --element <id> --cache <dir>`; end events can be claimed too, and are handed over as the walk reaches them, so a runner can fold what it started for the study; `STUDYFLOW_RUN_PID` in the environment is the walk's own pid, for anything a runner leaves running to follow. Each element digest names its `parent` container, and the state file carries the study's state tree under `state` (`state.<scope>.<property>`, `state._meta`); a runner resolves `{name}` placeholders as the modeler does, from the element outward, writes a data edge's value into its target property under `state`, and the walk adopts the scopes that changed. A runner never opens the diagram: `plan.json` is a digest of the plan, written once per run, with `study` (`id`, `name`, `seed`, `dependencies`), `sources` (directories a boundary input may be staged from), and `elements` by id, each with its BPMN `type`, `name`, `attributes` (local names, as written), `extensions` (namespace, type, attributes, child text), `additionalArguments`, `ioSlots`, `inputs` and `outputs` (data associations with their `transformation`). Pool participants are in `elements` too. Nothing is inferred: an attribute the diagram omits is absent, and its default is the runner's to know. A runner launched as a `uv` script gets the study's `dependencies` installed (`uv run --with <each>`), so its own inline metadata lists only what the runner itself imports. The cache directory holds one file per call, named `<element_id>.state.json`. The file starts as `{state}`, and the runner updates it with the result, so it becomes the same state plus `result` (what the element produced), `durationMs`, and on failure `error` with a non-zero exit. The run log captures stdout; stdin and stderr stay on the terminal. [`studyflow-reachy.py`](../../runners/studyflow-reachy.py) is a working example. It also works standalone on `reachy:` namespace elements. The partial runners live in [`runners/`](../../runners/) at the repo root; only the reference runner (`studyflow-run-local.py`, with `studyflow-prov.py`) belongs to this package.

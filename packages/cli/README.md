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
studyflow run assets/examples/sklearn_pipeline.studyflow.png
studyflow run runs/*/sklearn_pipeline.studyflow.png                # re-run
studyflow run runs/*/sklearn_pipeline.studyflow.png --from <ref>   # branch
studyflow run runs/*/sklearn_pipeline.studyflow.png --fresh        # re-run all

# Reachy Mini example, auto-answered
studyflow run assets/examples/reachy_session.studyflow.png --auto
```

## Extending CLI

The CLI can be extended with *partial runners* to execute specific elements in a diagram. A partial runner is a script that claims certain elements of the diagram and executes them.

Name an executable `studyflow-<name>` and it is discovered as a partial runner. The studyflow asks it `<diagram> --claims` (expecting it to print the element ids you will run, as one JSON array on stdout), then invokes it once per claimed element using `<diagram> --element <id> --cache <dir>`. The cache directory holds one file per call in a file called `<element_id>.state.json`. The json file initially contains `{state}` and the runner updates it with the result, so it becomes the same state plus `result` (what the element produced), `durationMs`, and on failure `error` with a non-zero exit. stdout is captured into the run log and stdin and stderr stay on the terminal. [`studyflow-reachy.py`](src/studyflow-reachy.py) is a working example. It also works standalone on `reachy:` namespace elements.

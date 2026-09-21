# @behaverse/studyflow-cli

`studyflow` is the command-line tool for studyflow diagrams: convert between `.studyflow.yaml`, BPMN XML, PNG and SVG; validate; inspect; execute; and open the offline modeler app.

## Install

```bash
brew trust https://github.com/behaverse/studyflow-modeler   # Homebrew 6 loads a third-party tap only once trusted
brew tap behaverse/studyflow https://github.com/behaverse/studyflow-modeler
brew install studyflow
```

From a checkout (`run` needs `uv` on PATH):

```bash
npm run build
node packages/cli/dist/studyflow.mjs --help
```

## Use

```bash
studyflow validate study.studyflow.yaml --strict
studyflow convert study.studyflow.yaml study.studyflow.png   # into that picture; --modeler draws a new one (in a checkout)
studyflow info study.studyflow.yaml --json
studyflow edit study.studyflow.png              # the desktop app on that file; `studyflow ui` for a blank canvas
studyflow run skills/python/examples/sklearn_pipeline.studyflow.yaml   # the run folder keeps the study as YAML, stamped
studyflow run ~/.studyflow/runs/*/sklearn_pipeline.studyflow.yaml --from <ref>   # re-run from an earlier step; --fresh for all
studyflow run skills/reachy/examples/reachy_session.studyflow.yaml --auto        # every task answered by a bot
```

`validate` checks the plan: it is sound (each step on a path from a start event to an end event), it splits only where the reference runners can follow (one path per pool), and a step reading data bound to a schema names only that schema's columns. In a file a run has stamped, it also checks that the counts balance at every node and that the protocol is still the one the run recorded: the digest `studyflow info` shows. `run` does not start a study that fails a plan check, and hands the local runtime the digest (`--plan-digest`) and itself (`--tool studyflow-cli/<version>`) for the run record.

`studyflow <command> --help` lists the options. Behaverse (Unity) tasks need the WebGL build at `UNITY_BUILD_PATH`; in a checkout, the `assessment-unity` repo beside this one is found by itself. How a skill executes elements is in [skills/local/SKILL.md](../../skills/local/SKILL.md).

## Release

```bash
npm run release                 # the next version; `-- 26.10.1` for a given one, `-- --local` for a local brew install
```

Needs a clean `main` on macOS and `gh` logged in (`bun` comes with the dev dependencies). Versions are `YY.M.N`. The release checks, builds, cross-compiles, writes the tarballs and `Formula/studyflow.rb`, then commits, tags, pushes, and creates the GitHub release; a failure before the commit puts the tree back. The deploy workflow publishes the webapp from the tag.

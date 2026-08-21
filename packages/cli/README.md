# @behaverse/studyflow-cli

`studyflow` — the command-line tool for studyflow files: convert between the formats, validate, report what is inside, dispatch a run, and re-render the shipped example images.

```bash
brew tap morteza/studyflow https://github.com/morteza/studyflow-modeler
brew install studyflow
```

Or, in a checkout of this repository:

```bash
npm run build -w @behaverse/studyflow-cli      # writes packages/cli/dist/studyflow.mjs
node packages/cli/dist/studyflow.mjs --help
```

| Command | What it does |
| --- | --- |
| `convert <in> <out>` | rewrite between `.studyflow.yaml`, BPMN XML, and `.studyflow.png`; the output extension picks the target — a PNG is embedded into (`--into`) or drawn by the modeler (`--modeler`) |
| `validate <in>` | parse and report reader warnings and errors (exit 1 on error, `--strict` on warnings too) |
| `info <in>` | the study's metadata and element counts (`--json` for machines) |
| `run <in> [args...]` | execute where the document says: `studyflow:runtime` — `browser`, `cloud`, `local`, `hpc` |

Every command answers `--help`; `studyflow --version` prints the version. Anything else is a **companion**, found the way git finds `git-lfs`: `studyflow <name>` runs `studyflow-<name>` from your PATH, handing over the rest of the command line and adopting its exit code. `studyflow --help` lists the ones you have installed — and every companion doubles as a schema runner for `run` (see below).

### Where `run` sends a study

`run` reads the `runtime` the study declares, which is `cloud` unless set; `--runtime` overrides it for one invocation.

| Declared runtime | What happens |
| --- | --- |
| `local` | dispatched to the runners: studyflow-run walks and executes, studyflow-prov records, schema runners serve their own elements |
| `browser` | stops with instructions: a study participants sit through belongs in the browser runner, at `<site>/run/` |
| `cloud`, `hpc` | stops with an error — nothing is wired up for either; `--runtime local` runs it on this machine instead |
| anything else | refused, with the four listed |

### How `run` executes a study

This CLI executes nothing itself — it resolves the runtime, converts a YAML plan to the XML the runners read, and hands everything to `studyflow-run`, found as `STUDYFLOW_RUN_PY`, a `studyflow-run` companion on PATH, or the `studyflow-run.py` beside this CLI (the repo checkout, or `libexec/` in a Homebrew keg) through `uv`.

[`studyflow-run.py`](src/studyflow-run.py) leads a `local` run — the walk, the values, `python://` implementations — and does its own discovering: `studyflow-prov.py` beside it adds the git run repository, per-element records, reuse across runs, and the prov timeline (without it, a run executes bare); every other `studyflow-<name>` is a **schema runner** serving its own namespace's elements — `reachy:` elements go to `studyflow-reachy` — held open as one session per run (the serve protocol below). Dropping a new `studyflow-eeg.py` next to the others is the whole integration. An element a schema runner serves is live interaction, so it never skips or replays from a prior run's record.

Everything after the input file goes to studyflow-run untouched — `--repo`, `--from`, `--fresh`, `--sim`, `--auto`, `--runner NAME=COMMAND`, … A schema runner also stands alone as a rehearsal: `studyflow reachy <plan>` when installed as a companion, or its script directly.

### What `convert --modeler` needs

`--modeler` draws the PNG by opening the modeler in a browser, loading the studyflow, and exporting it, so it works only inside a checkout. `--origin` names the dev server (default `http://127.0.0.1:4175`, started if nothing is listening). It needs `npx playwright install chromium` once per machine, and a connection — offline, the image is written without its element icons, and the warning says so inside the browser it drives rather than in your terminal. The shipped examples are just files: `npm run examples:render` re-renders each one onto itself.

## The runners

The Python half of `run` — three scripts, flat in `src/` beside the TypeScript, one job each:

| Script | Holds |
| --- | --- |
| [`studyflow-run.py`](src/studyflow-run.py) | the core: the walk, the values, expressions (Python here, JavaScript in the browser runner), `python://` implementations called with values held live in-process, and the schema-runner sessions |
| [`studyflow-prov.py`](src/studyflow-prov.py) | the provenance, loaded by studyflow-run from beside itself: the git run repository, one commit per executed element with its record as the body, skip and reuse across runs, and the prov timeline stamped into the archived plan |
| [`studyflow-reachy.py`](src/studyflow-reachy.py) | every `reachy:` element — speech, gestures, senses, perception; a terminal dry run, or a MuJoCo simulation over the `reachy_mini` SDK with `--sim` |

`studyflow-run.py` is the entry and keeps one claim honest: **a studyflow is executable as it stands.**

```bash
uv run src/studyflow-run.py ../../assets/examples/sklearn_pipeline.studyflow.png
```

One command, no setup: dependencies are declared in each script's header (PEP 723) and `uv` resolves them per run; the shipped example's input table is materialized on first read. A studyflow naming other software brings its own (`uv run --with torch --with transformers …`). Everything below the marker line in `studyflow-run.py`'s header — pandas, scikit-learn, joblib, matplotlib — belongs to the shipped sklearn example, not the runner. Without `studyflow-prov.py` beside it, a run still executes — bare: no repository, no records, no reuse.

Schema runners are discovered, not registered: anything answering to `studyflow-<name>` — beside the script, on PATH, or a `STUDYFLOW_<NAME>_PY` override — serves the schema called `<name>`. Dropping a new `studyflow-eeg.py` into `src/` is the whole integration; `--runner NAME=COMMAND` overrides one by hand. A schema runner also stands alone as a rehearsal without a run repository:

```bash
uv run src/studyflow-reachy.py ../../assets/examples/reachy_session.studyflow.png --sim --auto
```

### The serve protocol

studyflow-run holds each schema runner open as one session per run: `<script> <plan> --serve`. Requests are JSON lines on stdin, one JSON line back per response on stdout; narrative and prompts stay on stderr and the terminal, so an interactive runner still talks to the person while the leading runner holds the pipes.

| Op | Means |
| --- | --- |
| `hello` `{repo, seed}` | the run directory and root seed; seed your RNGs here |
| `element` `{id, values}` | perform one element; reply `{ok, value}`, a gateway replies `{ok, bindings}` |
| `shutdown` | end of the run |

`values` is the JSON-able shadow of the run's values, for placeholders and intents; whatever the runner returns joins the run's values, where conditions and later steps read it.

## Contract

- Everything it knows comes from [`@behaverse/studyflow-core`](../core/) and the shared schemas in [`assets/schemas/`](../../assets/schemas/), **compiled in at build time**: the binary has no run-time dependency on this repo.
- It is the headless surface, so it never renders. A `.studyflow.png` can be read from and re-embedded into here, but *making* a new image needs the modeler — which is what `render` drives, and the only command that is repo-workspace-only.
- It **executes nothing itself**. `run` dispatches to the discovered runners, and the non-`local` runtimes stop with an explanation rather than a silent fallback.
- Reader warnings go to stderr; stdout carries only the command's output.

## Where things are

| File | What it holds |
| --- | --- |
| `src/cli.ts` | argument parsing, the command table, and the companion dispatch |
| `src/plugin.ts` | finding and running `studyflow-*` companions on PATH |
| `src/studyfile.ts` | reading an input in any of its spellings, and writing it back out |
| `src/` | flat: `cli.ts` (the command table), one `.ts` per command, and the Python runners beside them |
| `vite.config.ts` | the SSR-mode build: core bundled from source, `*.moddle.yaml` inlined via `import.meta.glob(?raw)` |
| `scripts/package.mjs` | the release build: one standalone binary per platform, plus the Homebrew formula |

## Releasing

```bash
npm run cli:package                  # from the repo root; needs `bun` (build-time only)
```

Vite bundles the CLI to one ESM file, then `bun build --compile` welds that file to a Bun runtime once per platform — macOS and Linux, arm64 and x64. The output has no Node.js, no npm install, and nothing from this repo behind it. Bun is a build tool here, not a dependency of what ships.

The script writes `dist/release/`: a tarball and checksum per platform, and `Formula/studyflow.rb` at the repo root, which is where `brew tap` looks (Homebrew only reads a tap's root `Formula/`, never a nested one). Pushing a `v<version>` tag runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which does all of that, uploads the assets, and commits the refreshed formula to the default branch.

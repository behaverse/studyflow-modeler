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
| `convert <in> <out>` | rewrite between `.studyflow.yaml`, BPMN XML, and `.studyflow.png`; the output extension picks the target |
| `validate <in>` | parse and report reader warnings and errors (exit 1 on error, `--strict` on warnings too) |
| `info <in>` | the study's metadata and element counts (`--json` for machines) |
| `run <in> [args...]` | execute where the document says: `studyflow:runtime` — `browser`, `cloud`, `local`, `hpc` |
| `render [names...]` | re-render example `.studyflow.png` images by driving the modeler headlessly |

Every command answers `--help`; `studyflow --version` prints the version. Anything else is a **companion**, found the way git finds `git-lfs`: `studyflow <name>` runs `studyflow-<name>` from your PATH, handing over the rest of the command line and adopting its exit code. `studyflow --help` lists the ones you have installed — the [Python runner](../runner-py/) is the first of them (`uv tool install studyflow-runner`).

### Where `run` sends a study

`run` reads the `runtime` the study declares, which is `cloud` unless set; `--runtime` overrides it for one invocation. A YAML input is converted to a temporary `.bpmn` first — BPMN XML, on its own or inside a PNG, is what the Python runner reads.

| Declared runtime | What happens |
| --- | --- |
| `local` | hands the study to the Python runner, passing your trailing arguments through untouched (`--repo`, `--from`, `--fresh`, …) |
| `browser` | stops with instructions: a study participants sit through belongs in the browser runner, at `<site>/run/` |
| `cloud`, `hpc` | stops with an error — nothing is wired up for either; `--runtime local` runs it on this machine instead |
| anything else | refused, with the four listed |

### What `render` needs

`render` re-draws each image by opening the modeler in a browser, loading the example, and exporting it, so it works only inside a checkout. It defaults to `--dir assets/examples` and `--origin http://127.0.0.1:4175`, and starts the modeler's dev server itself if nothing is listening there. It needs `npx playwright install chromium` once per machine, and a connection — offline, every image is written without its element icons, and the warning says so inside the browser it drives rather than in your terminal.

## Contract

- Everything it knows comes from [`@behaverse/studyflow-core`](../core/) and the shared schemas in [`assets/schemas/`](../../assets/schemas/), **compiled in at build time**: the binary has no run-time dependency on this repo.
- It is the headless surface, so it never renders. A `.studyflow.png` can be read from and re-embedded into here, but *making* a new image needs the modeler — which is what `render` drives, and the only command that is repo-workspace-only.
- It **executes nothing itself**. `run` dispatches: `local` spawns the [Python runner](../runner-py/), and the other three runtimes stop with an explanation rather than a silent fallback.
- Everything after the input file goes to the runner untouched (`--repo`, `--from`, `--fresh`, …), so a re-run needs no flags of its own here.
- Reader warnings go to stderr; stdout carries only the command's output.

## Where things are

| File | What it holds |
| --- | --- |
| `src/index.ts` | argument parsing, the command table, and the companion dispatch |
| `src/plugin.ts` | finding and running `studyflow-*` companions on PATH |
| `src/studyfile.ts` | reading an input in any of its spellings, and writing it back out |
| `src/commands/` | one file per command: `convert` `validate` `info` `run` `render` |
| `vite.config.ts` | the SSR-mode build: core bundled from source, `*.moddle.yaml` inlined via `import.meta.glob(?raw)` |
| `scripts/package.mjs` | the release build: one standalone binary per platform, plus the Homebrew formula |

`run --runtime local` finds the Python runner in this order: `STUDYFLOW_RUN_PY` (a `studyflow_run.py` to run through `uv`), an installed `studyflow-run` companion on PATH, then the `studyflow_run.py` shipped beside this CLI — the repo checkout, or `libexec/` in a Homebrew keg — through `uv`.

## Releasing

```bash
npm run cli:package                  # from the repo root; needs `bun` (build-time only)
```

Vite bundles the CLI to one ESM file, then `bun build --compile` welds that file to a Bun runtime once per platform — macOS and Linux, arm64 and x64. The output has no Node.js, no npm install, and nothing from this repo behind it. Bun is a build tool here, not a dependency of what ships.

The script writes `dist/release/`: a tarball and checksum per platform, and `Formula/studyflow.rb` at the repo root, which is where `brew tap` looks (Homebrew only reads a tap's root `Formula/`, never a nested one). Pushing a `v<version>` tag runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml), which does all of that, uploads the assets, and commits the refreshed formula to the default branch.

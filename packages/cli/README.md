# @behaverse/studyflow-cli

`studyflow` — a self-contained command-line tool for studyflow files.
Everything it knows comes from [`@behaverse/studyflow-core`](../core/) and the
shared schemas in [`assets/schemas/`](../../assets/schemas/), compiled in at
build time: the binary has no runtime dependency on the repo.

```bash
npm run build -w @behaverse/studyflow-cli
node packages/cli/dist/studyflow.mjs --help
```

## Commands

```bash
# convert between formats — the output extension picks the target
studyflow convert study.studyflow.png study.studyflow   # extract YAML from a PNG
studyflow convert study.studyflow study.bpmn            # YAML -> BPMN XML
studyflow convert study.studyflow study.studyflow.png   # re-embed into an existing image
studyflow convert edited.studyflow old.png --into base.png

# parse and report reader warnings/errors (exit 1 on error; --strict: also on warnings)
studyflow validate study.studyflow.png

# what's inside: study metadata + element counts (--json for machines)
studyflow info study.studyflow.png

# execute in the runtime the document declares (studyflow:Study's `runtime`
# attribute — browser | cloud | local | hpc); `local` delegates to the Python
# runner, which writes each run to ./runs/<timestamp>/ by default
studyflow run study.studyflow.png
studyflow run --runtime local study.studyflow    # override the document
studyflow run study.studyflow.png --fresh        # flags after the file go to the runner

# re-render example .studyflow.png images by driving the real modeler
studyflow render [names...] [--dir assets/examples]
```

A `.studyflow.png` is an ordinary PNG with the BPMN XML embedded in an `iTXt`
chunk (see `@core/document/png`) — `convert` can extract from and re-embed into
those images, but *rendering* a new image needs the modeler
(`npm run examples:render`).

## Notes

- Built with Vite in SSR mode (`vite.config.ts`): core is bundled from source
  and the `*.moddle.yaml` schemas are inlined via `import.meta.glob(?raw)`.
- Reader warnings go to stderr; stdout carries only the command's output.
- `run --runtime local` finds the Python runner in this order:
  `STUDYFLOW_RUN_PY` (a `studyflow_run.py` to run via uv), the repo checkout
  next to this CLI (needs `uv`), then a `studyflow-run` binary on PATH.
- When the document's provenance records prior runs (`prov:Activity#run` names
  the run directory), `run` reuses their workdir: if those directories aren't
  under the cwd but are found next to the input file — or the input *is* an
  archived copy inside `<workdir>/runs/<id>/` — it passes that `--workdir` for
  you, so partial re-runs find their artifacts. An explicit `--workdir` always
  wins.

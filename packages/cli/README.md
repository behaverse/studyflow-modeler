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
```

A `.studyflow.png` is an ordinary PNG with the BPMN XML embedded in an `iTXt`
chunk (see `@core/document/png`) — `convert` can extract from and re-embed into
those images, but *rendering* a new image needs the modeler
(`npm run examples:render`).

## Notes

- Built with Vite in SSR mode (`vite.config.ts`): core is bundled from source
  and the `*.moddle.yaml` schemas are inlined via `import.meta.glob(?raw)`.
- Reader warnings go to stderr; stdout carries only the command's output.

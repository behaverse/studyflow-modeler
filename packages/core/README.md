# @behaverse/studyflow-core

The studyflow core model: the schema catalog, the `.studyflow.yaml` <-> BPMN XML round trip, PNG embedding, and attribute access on one element. No React, no bpmn-js, no DOM. The modeler, the browser runner, and the CLI consume it as TypeScript source (`@core/*`).

```bash
npm run typecheck -w @behaverse/studyflow-core
npm run test:unit -- schema catalog
```

The schemas it compiles are the skills' `*.moddle.yaml` files: [skills/SCHEMAS.md](../../skills/SCHEMAS.md). The file formats: [docs/reference.qmd](../../docs/reference.qmd#the-file).

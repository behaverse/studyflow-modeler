# Skills

A skill is one folder here, `skills/<name>/`, declared by its `SKILL.md`, an [Agent Skill](https://agentskills.io/specification) file. What it contributes to studyflow is under `metadata`; any part can be missing.

```yaml
---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them. Use when a study involves a Reachy Mini."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --sim."
metadata:
  schema: "reachy.moddle.yaml"        # the vocabulary: a BPMN extension, relative to the folder
  runtimes:                           # what executes its elements, per runtime
    local: "uv run --script local.py" #   a command run in this folder (the contract: local/SKILL.md)
    browser: "browser/index.tsx"      #   a node module the browser runner imports (browser/src/nodes/README.md)
  modeler: "modeler.ts"               # projections it exports, foreign formats it opens
---
What the vocabulary means and how to author with it.
```

A skill can be vocabulary only (`eeg`), a runner only (`python`), both (`behaverse`), or only something the modeler exports or opens (`drawio`, `jspsych`). The runtimes are skills too: [`browser`](browser/SKILL.md) and [`local`](local/SKILL.md). `examples/` holds its example diagrams, `tests/` its tests. The core skills (`studyflow`, `prov`, `cognitive`) cannot be disabled.

[SCHEMAS.md](SCHEMAS.md) is the schema authoring reference.

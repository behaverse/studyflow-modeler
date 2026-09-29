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

A skill can be vocabulary only (`eeg`), a runner only (`python`), both (`behaverse`), or only something the modeler exports or opens (`drawio`, `jspsych`). The runtimes are skills too: [`browser`](browser/SKILL.md) and [`local`](local/SKILL.md). `examples/` holds its example diagrams, `tests/` its tests. A skill whose schema says `required: true` always loads and cannot be disabled: `studyflow`, `prov`, `cognitive`, and the `local` runtime, the study's default.

A skill is the boundary between Studyflow and a domain (in domain-driven design, an anti-corruption layer): its vocabulary gives authors the domain's elements in the domain's words, and its runners translate between Studyflow's contract and each tool's own protocol. The apps find what it declares and learn nothing else, so how a tool behind a skill works changes that skill at most.

[SCHEMAS.md](SCHEMAS.md) is the schema authoring reference.

A skill need not live in this repository. `studyflow skill add <git-url | folder>` installs one in `~/.studyflow/skills/<name>` (`$STUDYFLOW_HOME/skills`), where the CLI reads its schema beside the shipped ones (`validate`, `convert`, `mcp`) and the local runtime finds its runner; `studyflow skill list` and `studyflow skill remove <name>` manage them. The modeler web app still bundles the shipped skills only.

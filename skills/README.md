# Skills

A skill is one folder here, `skills/<name>/`, declared by its `SKILL.md`, an [Agent Skill](https://agentskills.io/specification) file. Its contribution to studyflow is under `metadata`, and any part can be missing.

```yaml
---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them. Use when a study involves a Reachy Mini."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --option sim."
metadata:
  schema: "reachy.moddle.yaml"        # the vocabulary: a BPMN extension, relative to the folder
  schemes: "reachy"                   # the <scheme>:// references its runners execute
  runtimes:                           # what executes its elements, per runtime
    local: "uv run --script local.py" #   a command run in this folder (the contract: packages/runtime-local/CONTRACT.md)
    browser: "browser/index.tsx"      #   a node module the browser runner imports (packages/runtime-browser/src/nodes/README.md)
  modeler: "modeler.ts"               # projections it exports, foreign formats it opens, inspector sections, Settings pages, Save destinations, reporting documents it draws
---
What the skill is, a snippet of a study that uses it, then a section per topic: how it is authored, how it runs,
what comes back.
```

A skill can be vocabulary only (`eeg`), a runner only (`python`), both (`behaverse`), or something the modeler exports, opens or draws (`jspsych`, `reporting-guidelines`). The runtimes are not skills: [`packages/runtime-local`](../packages/runtime-local/CONTRACT.md) and [`packages/runtime-browser`](../packages/runtime-browser/README.md) host the walk, and a skill hands them its runners. `examples/` holds its example diagrams, `tests/` its tests. A skill whose schema says `required: true` always loads and cannot be disabled: `studyflow`, with its `prov` schema.

A skill is the boundary between Studyflow and a domain (in domain-driven design, an anti-corruption layer): its vocabulary gives authors the domain's elements in the domain's words, and its runners translate between Studyflow's contract and each tool's own protocol. The apps find what it declares and learn nothing else, so how a tool behind a skill works changes that skill at most.

[SCHEMAS.md](SCHEMAS.md) is the schema authoring reference.

A skill need not live in this repository. `studyflow skill add <git-url | folder>` installs one in `~/.studyflow/skills/<name>` (`$STUDYFLOW_HOME/skills`), where the CLI reads its schema beside the shipped ones (`validate`, `convert`, `mcp`) and the local runtime finds its runner; `studyflow skill list` and `studyflow skill remove <name>` manage them. The modeler web app still bundles the shipped skills only.

---
name: local
description: "The reference runner behind `studyflow run --runtime local`: walks the diagram, evaluates values, records, and hands each element to the skill that claims it. Use when running the data-facing half of a study on a machine."
license: MIT
compatibility: "Python 3.10+ through uv."
metadata:
  schema: "local.moddle.yaml"
---

`run.py` is the walk. It never executes an element itself: each skill's `runtimes.local`
command is asked for its claims and then handed one element at a time (`<plan.json> --element <id> --cache <dir>`),
run in that skill's folder. The contract is in the [CLI README](../../packages/cli/README.md#extending-cli).
The [prov](../prov/SKILL.md) skill's module is loaded in-process for the run repository and records.

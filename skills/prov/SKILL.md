---
name: prov
description: "What a run leaves behind: the run repository, the records, and the prov timeline written back into the diagram. Use when reading or reasoning about what a study run recorded."
license: MIT
compatibility: "The module runs inside the local runtime (Python 3.10+, git for the run repository)."
metadata:
  schema: "prov.moddle.yaml"
  runtimes:
    local: "prov.py"
---

`prov.moddle.yaml` is the vocabulary a run writes back into the diagram (records, the state tree's
`_meta`). `prov.py` is the module the [local runtime](../local/SKILL.md) loads in-process to keep the
run repository and its records; the runtime refuses to run without it. The modeler's provenance panel
reads the same records.

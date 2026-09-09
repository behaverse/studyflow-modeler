---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them on the robot or its simulator. Use when a study involves a Reachy Mini, as an actor or as the participant."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --sim."
metadata:
  schema: "reachy.moddle.yaml"
  runtimes:
    local: "uv run --script local.py"
---

`reachy.moddle.yaml` maps one-to-one onto the robot daemon's REST API. `local.py` is the partial
runner performing them (`--sim` for the simulator), and doubles as the participant bridge that seats
the robot in front of a Behaverse task (`local.py --participant`). `test_local.py` is its self-check.

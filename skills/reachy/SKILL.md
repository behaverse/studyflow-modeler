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
the robot in front of a Behaverse task (`local.py --participant`). A local run seats it by itself when a
cognitive task is the robot's to take, drawn any of three ways: the Robot pool on the task's receiving band
(`examples/reachy_participant`), the task in the screen's pool with message flows to the robot's
`reachy:Participate` step and back (`examples/reachy_pools`, whose flows name what they carry: `behaverse:Trial`
in, `behaverse:Response` out), or the task inside the Robot pool. The trials reach the seat at the Robot's `bridge`
(`ws://localhost:8765` unless the pool says otherwise); the task's runner reads the same setting from the diagram. Wire an `agentic:Prompt` into the task, or into
the `Participate` step, for the robot's instructions, and give the `Participate` step a data output whose `uri` is
where the seated robot leaves what it judged from (`frames/`) and `reasoning.jsonl`; `reachy/` when it has none.
`test_local.py` is its self-check.

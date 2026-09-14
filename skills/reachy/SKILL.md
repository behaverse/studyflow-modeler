---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them on the robot or its simulator. Use when a study involves a Reachy Mini, whoever decides for it."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --sim."
metadata:
  schema: "reachy.moddle.yaml"
  runtimes:
    local: "uv run --script local.py"
---

`reachy.moddle.yaml` maps one-to-one onto the robot daemon's REST API, and `local.py` is the partial runner
performing it (`--sim` for the simulator). The robot is a pool of its own steps: it speaks, moves, looks, and takes
pictures. Whatever decides for it is another pool, a model the steps ask along message flows (`../agentic/SKILL.md`),
so no attribute here names a model. `examples/reachy_pools` draws the three: Behaverse sends each trial to the robot's
loop, the robot takes a picture, asks the model with the instructions wired in, answers the task, and shows the answer
with its antennas, until the task's end ends the loop. The palette's "Take a task, trial by trial" drops that loop, and
"Conversation with a model" a spoken one.

A `screen` look with a message flow to a model's pool searches: it asks the model about each view with a question of
its own, turns by the answer, and remembers where it found the screen (`~/.studyflow/reachy/gaze.json`, per robot
host), so the next look, and the next run, start there; without one it turns to where the screen was found. A
`Snapshot` saves a picture in the folder its data output's `uri` names (`reachy/frames/` when none), and its path is
the step's result. When a step needs the camera, the walk seats the robot at the first robot step: one process holds
it and its camera (`local.py --participant`, logging to `participant.log` in the run), every later hand-off acts
through it, and the robot pool's end event dismisses it. An `Interact` step renders its line on this machine and plays it on
the unit; it may name the renderer, `implementation: shell://say` with the sentence in `additionalArguments` `args`
and flags as keys (`v: Alex`), a step the shell skill leaves to this runner. `test_local.py` is its self-check.

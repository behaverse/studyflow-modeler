---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them on the robot or its simulator. Use when a study involves a Reachy Mini, whoever decides for it."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --option sim."
metadata:
  schema: "reachy.moddle.yaml"
  runtimes:
    local: "uv run --script local.py"
---

`reachy.moddle.yaml` maps one-to-one onto the robot daemon's REST API, and `local.py` is the partial runner that
performs it (`studyflow run ... --option sim` for the simulator). The robot is a pool of its own steps: it speaks,
moves, looks, and takes pictures. Whatever decides for it is another pool, a model the steps ask along message flows
([agentic](../agentic/SKILL.md)), so no attribute here names a model.

```yaml
Look:
  type: ServiceTask
  name: Find the screen
  extensions:
    reachy:LookAt:
      target: screen

Greet:
  type: ServiceTask
  name: Greet
  additionalArguments:
    args:
      - Hello! I am Reachy. I will be your participant today.
  implementation: shell://say
  extensions:
    reachy:Interact: {}

Take:
  type: ServiceTask
  name: Take a camera frame
  extensions:
    reachy:Snapshot: {}
  outputs:
    Out_Frame:
      target: $Frame
```

`examples/reachy_pools` draws the three pools. Behaverse sends each trial to the robot's loop. The robot takes a
picture, asks the model with the instructions wired in, answers the task, and shows the answer with its antennas,
until the task's end ends the loop. The palette's "Each trial" drops that loop, and "Conversation" a spoken one.

## Steps

- An `Interact` step renders its line on this machine and plays it on the unit. It may name the renderer:
  `implementation: shell://say`, with the sentence in `additionalArguments` `args` and flags as keys (`v: Alex`).
  The shell skill leaves such a step to this runner.
- A `screen` look with a message flow to a model's pool searches. It asks the model about each view with a question
  of its own, turns by the answer, and remembers where it found the screen (`~/.studyflow/reachy/gaze.json`, per
  robot host), so the next look, and the next run, start there. Without such a flow, it turns to where the screen
  was found.
- A `Snapshot` saves a picture in the folder its data output's `uri` names (`reachy/frames/` when none). The
  picture's path is the step's result.

## The camera

When a step needs the camera, the walk seats the robot at the first robot step. One process holds the robot and its
camera (`local.py --participant`, logging to `participant.log` in the run), every later hand-off acts through it, and
the robot pool's end event dismisses it.

## Failures

A robot action that fails fails its step: a move, a line, a sound, a pose, a look, or a picture when the camera
gives no frame. A study that goes on anyway catches the error with an error boundary event, and both examples
draw theirs.

- `reachy_session` keeps the robot's steps in a sub-process, its wake-word event and its perception gateway among
  them, and the error boundary event on it ends the session with the robot.
- `reachy_pools` goes on from each failure, so the task is never left waiting. A picture the camera does not give, or
  a question the model does not answer, passes on that trial, which the task counts as unanswered. A line or a move
  that fails on arriving still tells the task the robot is ready, one that fails after an answer waits for the next
  trial, and one that fails while wrapping up ends the robot's part.

What counts as a failure:

- A `screen` look fails when the model it asks fails, or does not answer in time.
- A line needs its renderer on this machine. `say` is macOS's, so a step run from another system names its own
  (`implementation: shell://<command>`).
- A robot with no camera (a simulated one, a dry run) is no failure: it takes no picture, so a `Snapshot`'s result
  is null, and a `screen` look turns to where the screen was found, else straight ahead.
- When no robot answers at the first robot step, the run carries on as a dry run on the terminal.

`test_local.py` is the runner's self-check.

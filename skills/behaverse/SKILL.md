---
name: behaverse
description: "Runs cognitive:BehaverseTask elements on the Behaverse Unity WebGL build, in the browser runner's page or in a window of its own, played by a human, an LLM bot, or an external bridge. Use when a study includes Behaverse assessment tasks."
license: MIT
compatibility: "Browser runtime, or the local runtime with uv; both need a Behaverse WebGL build (UNITY_BUILD_PATH)."
metadata:
  runtimes:
    browser: "browser/index.tsx"
    local: "uv run --script local.py"
---

A runner-only skill: no vocabulary of its own, `cognitive:BehaverseTask` is what it executes.

- `browser/` is the browser runtime's node module: the Unity build in a frame, the bot players
  (an LLM, or an external bridge such as a robot), and its dev-server plugins (`vite.ts`).
- `local.py` serves the same build from a local port and opens it in a browser window per task;
  the build is looked for at `UNITY_BUILD_PATH`, then `run/assessment-unity/Build/WebGL`.
- `examples/` are bot-played studies; `tests/` cover the payload, the bots, the bridge, and the local runner.

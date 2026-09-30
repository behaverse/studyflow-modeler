---
name: browser
description: "The participant-facing runtime: runs a studyflow in the browser one screen at a time (consent, instructions, questionnaires, tasks) and hosts every skill's browser module. Use when running or debugging a study in the browser."
license: MIT
compatibility: "A Vite + React app: Node to build and serve, any modern browser to run."
metadata:
  schema: "browser.moddle.yaml"
---

The browser runner, served at `<site>/run/`. It is a Vite + React app (`npm run dev -w @behaverse/studyflow-browser-skill`)
that hosts the walk (`packages/core/src/engine`, the engine the local runtime hosts too) for one participant: a
step one of its node modules has a screen for is handed to that screen, and the walk goes on when the screen is
done. Its own node modules under `src/nodes/` execute the core vocabulary (start, end, instruction,
questionnaire, task, choreography); every other skill's `runtimes.browser` module is imported
at startup and registers itself the same way. See [README.md](README.md).

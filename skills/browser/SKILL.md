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

Pools talk as they do in a local run. A pool with no process whose actor is human (a pool that says no
`actorType` is human) is the person at the page: each message the study sends it is a screen (`src/nodes/message/`)
showing what it carries, the options it offers as buttons, and what the person answers is the reply. A step with no
screen of its own that exchanges messages is left to the walk, which sends and receives for it and fills its data
edges. A flow to a pool no one in the page plays (a model, a device) is refused before the first screen: the local
runtime carries it. The session keeps the run's record, the events a local run keeps in `events.jsonl`, and the page
offers it for download when the run ends.

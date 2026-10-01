# The browser runtime

The browser runner executes a studyflow with a participant in front of it, one screen at a time: consent, instructions, questionnaires, cognitive and Behaverse (Unity) tasks. Served at `/run/`.

It hosts the walk (`packages/core/src/engine`, the engine the local runtime hosts too) for one participant: a
step one of its node modules has a screen for is handed to that screen, and the walk goes on when the screen is
done. Its own node modules under `src/nodes/` execute the core vocabulary (start, end, instruction,
questionnaire, task, choreography); every other skill's `runtimes.browser` module is imported
at startup and registers itself the same way.

Pools talk as they do in a local run. A pool with no process whose actor is human (a pool that says no
`actorType` is human) is the person at the page: each message the study sends it is a screen (`src/nodes/message/`)
showing what it carries, the options it offers as buttons, and what the person answers is the reply. A step with no
screen of its own that exchanges messages is left to the walk, which sends and receives for it and fills its data
edges. A flow to a pool no one in the page plays (a model, a device) is refused before the first screen: the local
runtime carries it. The session keeps the run's record, the events a local run keeps in `events.jsonl`, and the page
offers it for download when the run ends.

```bash
npm run dev     # from the repo root: http://localhost:5173/run/
```

`?diagram=` names what to run: a shipped demo (`behaverse`), a URL, or the id the modeler hands over. Every other query parameter binds a value into the study; `seed` fixes the gateway draws.

```text
run?diagram=behaverse&task=NB&timeline=XCIT_NB_01
run?diagram=https://example.org/study.studyflow&seed=42
```

`participant` says which participant, 1-based, the session is: a random gateway draws for participant
k what the k-th instance of the pool draws in a local run with the same seed, and a session without
it draws as participant 1. `subject_id` (or `subjectId`, `participant_id`) names the run in the
record. `?debug=1` walks the study without mounting the long screens: each Behaverse task and
questionnaire shows its name, instrument and timeline behind a Continue button, while everything
cheap -- start, instructions, gateways, the allocation draw -- still runs for real, so the path
through the study is the one a participant would take.

```text
run?diagram=https://example.org/p500.studyflow&participant=42&subject_id=P042&debug=1
```

Each screen is a node kind, one folder under `src/nodes/`; a skill's own kind sits beside its schema (`skills/behaverse/browser/`). Adding one: [src/nodes/README.md](src/nodes/README.md).

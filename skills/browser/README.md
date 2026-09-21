# @behaverse/studyflow-browser-skill

The browser runner executes a studyflow with a participant in front of it, one screen at a time: consent, instructions, questionnaires, cognitive and Behaverse (Unity) tasks. Served at `/run/`.

```bash
npm run dev     # from the repo root: http://localhost:5173/run/
```

`?diagram=` names what to run: a shipped demo (`behaverse`), a URL, or the id the modeler hands over. Every other query parameter binds a value into the study; `seed` fixes the gateway draws.

```text
run?diagram=behaverse&task=NB&timeline=XCIT_NB_01
run?diagram=https://example.org/study.studyflow&seed=42
```

`subject_id` (or `subjectId`, `participant_id`) names the participant: it supplies the seed when no
`seed` is given, so the same id always draws the same arm at every gateway, and it names the run in
the record. `?debug=1` walks the study without mounting the long screens: each Behaverse task and
questionnaire shows its name, instrument and timeline behind a Continue button, while everything
cheap -- start, instructions, gateways, the allocation draw -- still runs for real, so the path
through the study is the one a participant would take.

```text
run?diagram=https://example.org/p500.studyflow&subject_id=P042&debug=1
```

Each screen is a node kind, one folder under `src/nodes/`; a skill's own kind sits beside its schema (`skills/behaverse/browser/`). Adding one: [src/nodes/README.md](src/nodes/README.md).

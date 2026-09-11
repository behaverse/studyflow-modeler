# @behaverse/studyflow-browser-skill

The browser runner executes a studyflow with a participant in front of it, one screen at a time: consent, instructions, questionnaires, cognitive and Behaverse (Unity) tasks. Served at `/run/`.

```bash
npm run dev     # from the repo root: http://localhost:5173/run/
```

`?diagram=` names what to run: a shipped demo (`behaverse`), a URL, or the id the modeler hands over. Every other query parameter binds a value into the study; `seed` fixes the gateway draws.

```text
run?diagram=behaverse&task=BCS
run?diagram=https://example.org/study.studyflow&seed=42
```

Each screen is a node kind, one folder under `src/nodes/`; a skill's own kind sits beside its schema (`skills/behaverse/browser/`). Adding one: [src/nodes/README.md](src/nodes/README.md).

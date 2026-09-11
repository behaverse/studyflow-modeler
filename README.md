# Behaverse Studyflow

[Studyflow](https://behaverse.org/studyflow-modeler) is a visual notation for experiments, for machines and humans, based on BPMN. One diagram is the protocol, the runnable experiment, the analysis specification, and the publication figure. The canonical file is `.studyflow.yaml`; the same diagram embeds in a PNG, so the figure you publish is the file that runs.

## Use

- **Webapp**: [behaverse.org/studyflow-modeler](https://behaverse.org/studyflow-modeler). Draw, validate, simulate, and export; `/run/` executes the participant-facing side in the browser.
- **CLI**: `studyflow` converts, validates, inspects, and executes diagrams locally.
- **Desktop app**: `studyflow ui`, or `studyflow edit <file>`, serves the modeler from your machine in a window of its own.

```bash
brew trust https://github.com/behaverse/studyflow-modeler   # Homebrew 6 loads a third-party tap only once trusted
brew tap behaverse/studyflow https://github.com/behaverse/studyflow-modeler
brew install studyflow
studyflow run skills/python/examples/sklearn_pipeline.studyflow.png
```

Example diagrams are in `skills/<name>/examples/` and in the modeler's Examples gallery.

## Develop

```bash
npm install
npm run dev            # modeler + browser runner at http://localhost:5173 (`-- --host` for the LAN)
npm run dev:desktop    # the same, opened as the desktop app
npm run test           # unit + e2e (Playwright)
npm run build          # dist/: the webapp, and what the desktop app serves
```

| Where | What |
| --- | --- |
| [packages/core](packages/core/) | the document model |
| [packages/canvas](packages/canvas/) | the SVG canvas |
| [packages/modeler](packages/modeler/) | the editor, `/app.html` |
| [skills/browser](skills/browser/) | the browser runner, `/run/` |
| [packages/cli](packages/cli/) | the `studyflow` CLI |
| [packages/desktop](packages/desktop/) | the desktop app |
| [skills/](skills/) | the vocabularies and runners |
| [docs/](docs/) | the site |

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT. AI tools assisted with refactoring and improvements; the author reviewed and maintains all changes.

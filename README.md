# Behaverse Studyflow

[Studyflow](https://behaverse.org/studyflow-modeler) is a visual notation to describe experiments for machines and humans, based on BPMN (Business Process Model and Notation). It is the canonical representation of a scientific experiment, from which every other representation derives. One file is at once the protocol, the runnable experiment, the analysis specification, and the publication figure, with no second copy to drift.

The canonical format is `.studyflow.yaml`; a diagram can also be embedded in a PNG image, so the figure you publish is the file that runs.

## Use

- **Modeler**: the visual editor, at [behaverse.org/studyflow-modeler](https://behaverse.org/studyflow-modeler). Draw, validate, simulate, and export diagrams; `/run/` executes the participant-facing side in the browser.
- **CLI**: `studyflow` converts, validates, inspects, and executes diagrams locally:

  ```bash
  brew trust https://github.com/behaverse/studyflow-modeler   # Homebrew 6 loads a third-party tap only once trusted (by URL for a custom remote)
  brew tap behaverse/studyflow https://github.com/behaverse/studyflow-modeler
  brew install studyflow
  studyflow run skills/python/examples/sklearn_pipeline.studyflow.png
  ```

## Examples

Example diagrams ship with the skill they exercise, in [skills/](skills/) (`skills/<name>/examples/`), and in the modeler's Examples gallery, one shelf per skill.

## Develop

```bash
npm install
npm run dev        # modeler + browser runner
npm run test       # unit + e2e (Playwright)
npm run build
```

The workspace: [packages/core](packages/core/) is the shared model, [packages/modeler](packages/modeler/) the editor, [skills/browser](sackages/runner/) the browser runner, and [packages/cli](packages/cli/) the CLI with the local runners.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT

AI tools (Claude, Codex, Gemini) assisted with refactoring and improvements. The author reviewed and maintains all changes.

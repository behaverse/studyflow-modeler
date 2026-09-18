# Behaverse Studyflow

[Studyflow](https://behaverse.org/studyflow-modeler) is a BPMN-based visual notation for coordinating experiments, for machines and humans. One diagram is the protocol, the runnable experiment, the analysis specification, and the publication figure.

## Use

- **Webapp**: [behaverse.org/studyflow-modeler](https://behaverse.org/studyflow-modeler). Author, validate, simulate, export, and run diagrams in the browser.
- **CLI**: `studyflow` manage and run diagrams locally. `studyflow ui`, or `studyflow edit <file>`, serves the modeler from your machine.

```bash
brew trust https://github.com/behaverse/studyflow-modeler   # Homebrew 6 loads a third-party tap only once trusted
brew tap behaverse/studyflow https://github.com/behaverse/studyflow-modeler
brew install studyflow
studyflow run study.studyflow.png
```

## Develop

```bash
npm install
npm run dev            # modeler
npm run dev:desktop    # the same, opened as the desktop app
npm run test
npm run build          # produces dist/
```

## license

MIT. See [LICENSE](LICENSE).

See also [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for third-party licenses.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). [AGENTS.md](AGENTS.md) has the commands, the map in more detail, and the rules the code follows.

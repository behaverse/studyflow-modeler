# Behaverse Studyflow

[Studyflow](https://behaverse.org/projects/studyflow.html) is a BPMN-based visual notation for coordinating experiments, for machines and humans. One diagram is the protocol, the runnable experiment, the analysis specification, and the publication figure.

## Use

- **Webapp**: [behaverse.org/studyflow-modeler/app](https://behaverse.org/studyflow-modeler/app). Author, validate, simulate, export, and run diagrams in the browser.
- **CLI**: `studyflow` manages and runs diagrams locally. `studyflow ui <file>` serves the modeler from your machine.

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

## License

MIT. See [LICENSE](LICENSE).

See also [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party licenses.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). [AGENTS.md](AGENTS.md) has the commands, the map in more detail, and the rules the code follows.

# Partial runners

Each `studyflow-<name>.py` here executes the elements it claims, one hand-off at a time, reading `plan.json` (a digest the reference runner writes) and never the diagram; the contract is in the [CLI README](../packages/cli/README.md#extending-cli). They are experiments, kept apart from the reference runner in `packages/cli/src` so that one can be added or removed without touching the CLI. `studyflow run` finds them here in a checkout, and the Homebrew package installs them beside the reference runner.

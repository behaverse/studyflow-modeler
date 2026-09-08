# Runners

Everything `studyflow run --runtime local` executes with lives here. The release tarball carries them beside the `studyflow` binary and Homebrew installs them in `libexec/`, where `studyflow` looks for them:

- `studyflow-run-local.py` — the reference runner: walks the diagram, evaluates values, hands elements off.
- `studyflow-prov.py` — loaded by the reference runner from beside itself: the run repository, records, and prov timeline.
- `studyflow-<name>.py` — partial runners (`python`, `reachy`, `behaverse`), each executing the elements it claims, one hand-off at a time, from `plan.json` and never the diagram. The contract is in the [CLI README](../README.md#extending-cli); add or remove one without touching the CLI.

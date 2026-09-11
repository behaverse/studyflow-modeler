# Behaverse task configs

Reference copies from the Unity project, beside the `behaverse` skill that runs its tasks:

- [`config-format.md`](config-format.md): the shape of a task config, the JSON that drives a cognitive task's run (trials, parameter sampling, adaptive logic, block exits).
- [`game-config.schema.json`](game-config.schema.json): that shape as a JSON Schema, with its discriminator-typed children (`ValueSpace`, `Distribution`, `Sequence`, `AdaptiveAlgorithm`, `ExitRule`). One schema covers one self-contained config file per task.

Wire the schema into an editor for auto-complete on `Type` strings and errors on missing or unknown properties, with a `json.schemas` entry (VS Code) or a `$schema` key at the top of a config file, pointing at it.

Limits: the schema is deliberately permissive (inner objects allow extra properties, so task-specific `Parameters` do not trip it), it cannot catch broken cross-references (a timeline naming a block that does not exist; Unity's **Behaverse › Validate All Configs** does), and obsolete `Type` values are accepted but flagged in their description.

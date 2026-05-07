# JSON Schema for task configs

`game-config.schema.json` describes the shape of a Behaverse task config and
its discriminator-typed children (`ValueSpace`, `Distribution`, `Sequence`,
`AdaptiveAlgorithm`, `ExitRule`). One schema covers one self-contained
config file per task (`Resources/Configs/<TaskId>/<TaskId>.json`). Wiring it
into your editor gives you auto-complete on `Type` strings and inline
errors on missing required fields or unknown property names.

## VS Code

Add to `.vscode/settings.json`:

```jsonc
{
  "json.schemas": [
    {
      "fileMatch": [
        "Assets/Scenes/*/Resources/*.json"
      ],
      "url": "./schema/game-config.schema.json"
    }
  ]
}
```

## JetBrains (Rider / IntelliJ)

Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings
→ "+" → name "Behaverse Game Config", schema file
`schema/game-config.schema.json`, schema version 7. File path pattern:
`Assets/Scenes/*/Resources/*.json`.

## Per-file `$schema:` reference (alternative)

If you prefer per-file wiring, add this as the first key of any config file:

```jsonc
{
  "$schema": "../../../../../schema/game-config.schema.json",
  ...
}
```

(Path is relative to the config file. Adjust depth as needed.)

## Limits of this schema

- The schema is **deliberately permissive**: the polymorphic shapes are loose
  (`additionalProperties` not set on inner objects) so that task-specific extensions
  in `Parameters` blocks don't trip false-positives.
- It cannot catch broken cross-references (e.g. a timeline naming a block
  that doesn't exist). Use **Behaverse > Validate All Configs** in Unity Editor
  for that - it runs the same merge + deserialize pipeline as runtime and
  reports broken refs.
- Obsolete `Type` values (`exponential`, `markov`, `deltaruleupdate`, `nullonly`)
  are accepted but the schema description flags them as obsolete; see
  `docs/cleanup-removed-types.md`.

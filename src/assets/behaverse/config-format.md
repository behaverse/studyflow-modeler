# Behaverse task config format

A Behaverse task config is the JSON that drives every aspect of a cognitive
task's run: which trials get presented, how parameters are sampled, what
adaptive logic shapes difficulty, when blocks end. This page documents the
shape of that JSON.

## Where configs live

Every task ships **one self-contained JSON file** at:

```
Assets/Scenes/<SceneName>/Resources/<TaskId>.json
```

Everything for one task - parameter info, blocks, timelines, rules,
mappings - lives under one roof. `GameConfigRepository.TryLoadTaskConfig`
loads it and hands it to `GameConfig.Deserialize`. No merge step.

A project-level defaults file at `Assets/Resources/DefaultConfig.json`
provides values that every task config inherits unless overridden.

> **Migration notes for older branches:**
> 1. `Resources/Configs/<TaskId>/<TaskId>.json` was flattened to `Resources/<TaskId>.json` by `tools/flatten-config-paths.py`.
> 2. Older split-config layouts (sibling `Blocks/` + `Timelines/` subfolders, merged at runtime) were inlined into a single file by `tools/merge-split-configs.py`. Run that first if your branch predates the merge.

## Validation

Before play-mode, run **Behaverse > Validate All Configs** in the Unity
Editor menu. It runs the merge + deserialize pipeline against every task and
reports broken refs (missing block name, unknown enum, undefined parameter,
etc.) plus malformed JSON. Use it before committing config edits.

To run from CI:
```
Unity -batchmode -projectPath . -executeMethod Behaverse.Editor.ValidateConfigs.RunFromCli
```
Exits 0 on success, 1 on any failure.

## Top-level shape

```jsonc
{
  "Id": "DS",                     // required: short task ID, must match the folder name
  "Scene": "DigitSpan",           // Unity scene to load (defaults to task folder name)

  "ParameterInfos": { ... },      // required: parameter type/range definitions
  "EnumDefinitions": { ... },     // optional: named string-enum lists referenced by ParameterInfos
  "Presets": { ... },             // optional: named complex-object presets for Object parameters
  "MappingRules": [ ... ],        // optional: cross-parameter value translations
  "Rules": { ... },               // optional: ruleset name -> Instruction[] (often built from inline `rules:` in Timelines)
  "Blocks": { ... },              // required: block name -> BlockDefinition
  "Timelines": { ... }            // required: timeline name -> Timeline
}
```

Required top-level fields: `Id`, `ParameterInfos`, `Blocks`, `Timelines`.

## ParameterInfos

Each entry describes one parameter - its type, optional range, allowed
values. Used by every `BlockDefinition` to validate parameter assignments.

```jsonc
"ParameterInfos": {
  "SequenceLength":   { "Type": "int",    "Min": 1, "Max": 12 },
  "ColorSaturation":  { "Type": "float",  "Min": 0, "Max": 1 },
  "RevealStimuli":    { "Type": "bool" },
  "StimulusType":     { "Type": "enum",   "Values": ["Digits", "Symbols", "UpperCaseLetters"] },
  "ColorTheme":       { "Type": "color" },
  "Note":             { "Type": "string" },
  "ProblemConfig":    { "Type": "object" }
}
```

Valid `Type` values (case-insensitive at parse time): `int`, `float`, `bool`,
`enum`, `color`, `string`, `object`. Plus `nullonly` (obsolete - see
`docs/cleanup-removed-types.md`).

Enum types take either inline `Values: [...]` or a reference to a named
`EnumDefinitions` entry via `Values: "EnumName"`.

## EnumDefinitions

```jsonc
"EnumDefinitions": {
  "FeedbackType": ["Always", "OnError", "Never"]
}
```

## Blocks (entries under top-level `Blocks`)

```jsonc
"Blocks": {
  "Tutorial": {
    "MinAccuracyRequired": 0.8,                 // 0..1, advances only when met
    "MaxRepeats": 2,                            // failures before forced advance
    "Parameters": {
      "SequenceLength": 3,
      "ColorSaturation": 0.75,
      "ItemSequence": {                         // ValueGenerator (see below)
        "Distribution": { "Type": "Uniform", "Min": 1, "Max": 9 },
        "Replacement": "WithoutInBlock"
      }
    },
    "Trials": [                                 // optional explicit trials
      { "MinAccuracyRequired": 1, "Parameters": { "SequenceLength": 2 } }
    ],
    "ExitRules": [ ... ],                       // see ExitRule below
    "AdaptiveAlgorithms": [ ... ]               // see AdaptiveAlgorithm below
  }
}
```

The block's outer key (here `"Tutorial"`) is the canonical name. Inside the
object, an explicit `"Name"` field is allowed but redundant.

## Timelines (entries under top-level `Timelines`)

A timeline is an ordered list of blocks. Each block entry references a
`BlockDefinition` from `Blocks` by name, or inlines an instruction page or
break page.

```jsonc
"Timelines": {
  "Test": {
    "Blocks": [
      { "Name": "Tutorial" },                           // GameBlock by name
      { "Instructions": [ { "Type": "..." } ] },        // InstructionBlock (inline)
      { "Type": "Timeline", "Name": "OtherTimeline" },  // TimelineBlock (expand another timeline here)
      { "Name": "MainBlock", "rules": [ ... ] }         // inline rules - auto-deduped into top-level Rules at load time
    ],
    "ExitRules": [ ... ],                               // Timeline-level exit rules
    "AutoStartBlocks": true,
    "AutoStartTrials": true,
    "Seed": 42                                          // optional fixed RNG seed
  }
}
```

## Polymorphic discriminators

The deserializer dispatches several abstract types by a string key. **Every
discriminator is matched case-insensitively** but for consistency, configs
should pick one casing convention per task and stick to it.

### `Distribution.Type`

Used inside `ValueGenerator` (`Distribution`) blocks.

| Value | Class | Notes |
|---|---|---|
| `bernoulli` | `BernoulliDistribution` | Active |
| `uniform` | `UniformDistribution` | Active |
| `normal` | `NormalDistribution` | Active |
| `poisson` | `PoissonDistribution` | Active |
| `weighted` | `WeightedDistribution` | Active |
| `exponential` | `ExponentialDistribution` | **Obsolete** (still works) |

### `Sequence.Type`

```jsonc
"ItemSequence": { "Type": "Int", "Min": 1, "Max": 5 }
```

| Value | Class | Notes |
|---|---|---|
| `ordered` | `OrderedSequence` | Active |
| `int` | `IntSequence` | Active |
| `repeat` | `RepeatSequence` | Active |
| `markov` | `MarkovSequence` | **Obsolete** (still works) |

Tasks can register additional sequence types via
`SequenceConverter.RegisterSequenceConverter`.

### `AdaptiveAlgorithm.Type`

| Value | Class | Notes |
|---|---|---|
| `singlestaircase` | `SingleStaircase` | Active |
| `sampledupdaterule` | `SampledUpdateRule` | Active |
| `deltaruleupdate` | `DeltaRuleUpdate` | **Obsolete** (still works) |

### Exit rules

`ExitRule` is dispatched by the *presence* of a key, not by `Type`:

| Key | Class | Example |
|---|---|---|
| `Trials` | `TrialCountExitRule` | `{ "Trials": 20 }` |
| `Blocks` | `BlockCountExitRule` | `{ "Blocks": 3 }` |
| `Time`   | `TimerExitRule`      | `{ "Time": 60 }` |

### `ValueSpace.Type` (in `ParameterInfos`)

| Value | Class | Notes |
|---|---|---|
| `float` | `FloatSpace` | Active |
| `int` | `IntSpace` | Active |
| `bool` | `BoolSpace` | Active |
| `enum` | `EnumSpace` | Active |
| `color` | `ColorSpace` | Hex string `#RRGGBB` |
| `string` | `StringSpace` | Active |
| `object` | `ObjectSpace` | Used with `Presets` |
| `nullonly` | `NullOnlySpace` | **Obsolete** (still works) |

### Arithmetic operations (obsolete)

A `ValueGenerator` block of the form `{ "Operation": { "Type": "Add", ... } }`
still deserializes but the entire arithmetic family is `[Obsolete]`. See
`docs/cleanup-removed-types.md`.

## ValueGenerator shapes

A `Parameter` value can be:

| Shape | Meaning |
|---|---|
| Scalar (`42`, `"Digits"`, `true`) | `FixedValue` |
| Array (`[1, 2, 3]`) | `OrderedSequence` of literals |
| `{ "Distribution": { "Type": "..." } }` | sample from a distribution every trial |
| `{ "Sequence": { "Type": "..." } }` | next item from a sequence each trial |
| `{ "Reference": "OtherParameter" }` | resolve another parameter's current value |
| `{ "Operation": { "Type": "Add", "Operands": [...] } }` | obsolete arithmetic op |
| Anything else (object literal) | passed through as a `FixedValue` JSON blob |

## MappingRules

Translates one parameter's value to another's. Used heavily in DigitSpan, for
example, to set `IntSequence.Max` based on `StimulusType`.

```jsonc
"MappingRules": [
  {
    "From": "StimulusType",
    "To": "IntSequence.Max",
    "Mapping": [
      { "OriginalValue": "Digits",     "NewValue": 9 },
      { "OriginalValue": "Symbols",    "NewValue": 25 }
    ]
  }
]
```

## Tips for editing configs

1. **Run validation before each commit**: Behaverse > Validate All Configs.
2. **Keep `ParameterInfos` at the top of the file** - it's the contract every block
   under `Blocks` is checked against.
3. **The block/timeline key is the canonical name** (e.g. `"Blocks": { "Tutorial": {...} }`).
   An interior `"Name": "..."` field is redundant.
4. **Pick a casing convention per task** (`"Type": "Bernoulli"` vs `"bernoulli"`) and
   stick to it - the deserializer accepts both, but mixed-casing inside one task
   fights diff readability.
5. **Comments are not allowed** in the deserialized JSON (Newtonsoft's default mode).
   Use a sibling `<TaskId>.notes.md` for design notes.
6. **`nullonly` / `markov` / `exponential` / `deltaruleupdate` / `Operation` are obsolete** -
   they still deserialize, but new configs should avoid them. See
   `docs/cleanup-removed-types.md`.

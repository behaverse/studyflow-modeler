# Skills

A skill is one folder here, `skills/<name>/`, and its `SKILL.md` says what it contributes. The file
is an [Agent Skill](https://agentskills.io/specification): `name` (the folder's name), `description`
(what it does and when to use it, for people and agents), `license`, and `compatibility` for the
runtime environment a runner needs. What the skill contributes to studyflow is declared under
`metadata`; nothing is found by file name, and any part can be missing. What can be inferred is
not declared: `examples/` is always the examples folder, the skill is listed by its name, and the
core skills (`studyflow`, `prov`, `cognitive`: the modeler and the local runtime cannot run BPMN
without them, so they cannot be disabled) are known to the loaders.

```yaml
---
name: reachy
description: "Motion, media, and sensing elements of the Reachy Mini robot, and the runner that performs them. Use when a study involves a Reachy Mini."
license: MIT
compatibility: "Local runtime with uv; a Reachy Mini daemon on the network, or --sim."
metadata:
  schema: "reachy.moddle.yaml"                # the BPMN extension it contributes, relative to the folder
  runtimes:                                   # what it gives each runtime to execute its elements, in any language
    local: "uv run --script local.py"         #   the local runtime: a command run in this folder
    browser: "browser/index.tsx"              #   the browser runtime: a module it imports, which registers its node
---
What the vocabulary means and how to author with it.
```

- **Vocabulary-only** skills declare a `schema` and nothing else (`eeg`, `agentic`).
- **Runner-only** skills execute someone else's vocabulary (`python` runs `python://` implementations,
  `behaverse` runs `cognitive:BehaverseTask`).
- **Runtimes** are skills too: [`browser`](browser/SKILL.md) is the participant-facing app,
  [`local`](local/SKILL.md) the walk behind `studyflow run --runtime local`. A `runtimes.local`
  entry is a partial runner for the latter (the contract is in the
  [CLI README](../packages/cli/README.md#extending-cli)); a `runtimes.browser` entry is a node module
  for the former (see [its README](browser/src/nodes/README.md)). The one exception is `prov`, whose
  `runtimes.local` names the records module the local runtime loads in-process.
- Tests live in the skill (`tests/*.unit.spec.ts` for the Node lane, `test_*.py` beside a Python runner).

The loaders are `packages/core/src/notation/loader.ts` (the apps and the CLI, through Vite),
`tests/schemas.ts` (Node), and `skill_dirs()` in `local/run.py`. The release tarball ships the whole
`skills/` tree minus the browser runtime, browser modules, examples, and tests.

Everything below is the schema authoring reference.

## Schemas

Every `<name>/<name>.moddle.yaml` is auto-loaded (no registration) and
compiled into the catalog that drives the palette, inspector, rendering,
templates, connection rules, and round-tripping. This file is the vocabulary
reference: every key the app actually reads, and where. If a key is not listed
here, nothing consumes it. The compiler warns on the ones it can check.

**Copying a file to start?** `eeg/eeg.moddle.yaml` is the domain pack to copy
from: inheritance from core types, wrapper + trait styles, enums, roles, and
implementation-bound templates. `studyflow.moddle.yaml` is the *core* schema.
It declares app-wide powers (inspector tab set, `bpmn:*` redefines,
expression traits) a domain pack must not copy.

## Conventions

- A `description` is one sentence the inspector shows in a 256px tooltip; keep it under about 90 characters. Rationale, engine notes, and endpoint details go in YAML comments beside the key, never in the description.
- A plain YAML scalar cannot contain `: `; quote a description that does.
- Attribute names are camelCase nouns. Put a unit in the in the meta (`samplingRate.meta.unit = 'Hz'`). Do not put units in the attribute name (`samplingRateHz` is wrong).
- An enum attribute that allows values outside its list is `meta.editable: true`.
- Icons come from the iconify (Bootstrap Icons, Fluent UI, `mdi` or `tabler`) sets unless an icon exists only elsewhere. Verify a glyph exists in `node_modules/@iconify/json/json/<set>.json` before using it; an unknown name falls back to the BPMN ancestor's icon.
- Reuse core types by inheritance rather than restating fields: a biosignal recording is a `studyflow:Timeseries`, a battery task a `cognitive:CognitiveTask`.

## Schema-level keys

| Key | Meaning |
| --- | --- |
| `name`, `prefix`, `uri` | Identity. `prefix` must be unique; a duplicate is a load diagnostic (first wins). |
| `description` | First sentence becomes the Settings row blurb. |
| `icon` | Iconify class (or URL) for the palette flyout header. |
| `order` | Load/display order; unordered schemas sort after ordered ones, then by prefix. |
| `version` | `YY.MMDD` string (lint-enforced). |
| `xml.tagAlias` | moddle pass-through (`lowerCase`). |
| `categories` | Inspector tab declarations, **core schema only** (the tab set is app-wide and pinned by `catalog.unit.spec.ts`). |
| `types`, `enumerations`, `templates` | The content; below. |
| `examples` | Complete studyflows offered in the New Diagram gallery; below. |

## Type-level `meta.*`

| Key | Consumer |
| --- | --- |
| `bpmnType` | Which BPMN element the type is created as (shape, palette, templates). Validated against the known BPMN table; a typo is a diagnostic and the type becomes non-creatable. |
| `icon` | Canvas + palette + append-menu glyph (Iconify class). The top-level `icon:` on a type is a legacy fallback. |
| `editor` (on a value type) | Default editor for every attribute *of that type* (see editor names below). |
| `roles` | Adds to the shape-inferred roles (`data-element`, `instrument`, …). Declare only what inference misses; the lint rejects restatements. |
| `branching` | Runner gateway semantics (`random`, `condition`, `model`); the allowed set is pinned by tests. |
| `categories` | Palette-group override (rarely needed: groups derive from the BPMN ancestor). Distinct from *property-level* `categories`, which are inspector tabs. |
| `connectsTo` | Connection-rule allow-list; wired but currently exercised only by tests. |

Style is inferred, not declared: `extends`-only = **trait** (attributes mix
onto the BPMN element), `superClass` = **wrapper** (its own element inside
`extensionElements`).

## Property-level `meta.*`

| Key | Consumer |
| --- | --- |
| `categories` | Inspector tab (default `General`; omit rather than restate it). |
| `order` | Sort within the tab. |
| `pinned` | Fixed value, never rendered; also wins read precedence on double-stored values. |
| `optional` | Renders the opt-in checkbox editor (String attributes; declarative intent elsewhere). |
| `editable` | Enum that also accepts free text. |
| `readonly` | Run-record field: shown, never edited. |
| `condition.body` | Visibility predicate over sibling attributes (`{attr: value}`, `$set`, arrays). |
| `editor` | Named editor override. Known names (checked at compile): `csvw-table`, `code`, `markdown`, `checklist`; the list lives in `core/notation/types.ts` (`EDITOR_NAMES`) and the inspector registry is typed off it. |
| `expression` | Stored as a BPMN expression element; renders the expression row with a per-expression language picker. |
| `languageAttr` | Sibling attribute holding the code editor's language (e.g. `bpmn:scriptFormat`). |
| `icon` | Event overlay glyph drawn when the attribute has a value (a *different* meaning than type-level `icon`). |
| `unit` | Unit of a numeric attribute (`Hz`, `s`, `rad`); shown after the field label. Never part of the name. |

## Attribute precedence

One attribute can be declared twice — on the element's own type (or a trait
that `extends` it) and on the wrapper under `extensionElements`. `resolveAttribute`
in `packages/core/src/element/handle.ts` picks one, first match wins.

| # | The attribute is | Resolved on | Under which name |
| --- | --- | --- | --- |
| 1 | declared by the wrapper with `redefines`/`replaces`, *and* declared on the element's own type or the element carries traits | the element | the local name after the `#` |
| 2 | declared by the element's own type, traits included | the element | the declared name (`bpmn:id`/`bpmn:name` collapse to `id`/`name`) |
| 3 | declared by the wrapper | the wrapper | the declared name |
| 4 | declared by neither | the wrapper if there is one and the element carries no traits, else the element | the local name |

With the shipped schemas every element carries traits (`studyflow:BaseElement`
redefines `bpmn:documentation` onto `bpmn:BaseElement`), so rule 1 needs only the
wrapper's redefine, and rule 4 always lands on the element. A write that resolves
to no target is dropped with a console warning.

A *read* landing on the element while a wrapper exists still returns the wrapper's
value when the wrapper's property is `meta.pinned`, or stores the value explicitly,
or when the element does not store it explicitly either. So a stored element value
beats a wrapper *default*, loses to a wrapper value actually written, and loses to a
pinned wrapper property carrying only its default. `tests/element.unit.spec.ts` pins
each case by name.

Adding `redefines` to a wrapper property does not merely rename it. It moves where
the value lands. Pair it with `meta.pinned` and the write goes somewhere the read
never looks, so an edit appears to do nothing. Redefine only where the BPMN side
genuinely declares the attribute, as `studyflow:Implementation` redefines
`bpmn:ServiceTask#implementation`.

## Enum literals

`name`, `value`, `description`, and optional `icon` (rendered in the enum
input; may name a raw-SVG key from `modeler/draw/icons.ts`'s `SVG_ICON_PATHS`).
A property `default` on an enum-typed attribute must be one of the literal
values — checked at compile.

## Templates

A template stamps a pre-configured element (or a small flow) into the canvas:
`object.type` plus any declared property of that type, and optionally `icon`,
`keywords`, `bpmn:name`, `bpmn:documentation`, `flowElements` (nodes with
`id/x/y`, connections with `sourceRef/targetRef`), `loopCharacteristics`,
`eventDefinitions`, and `mixins` (pull in a named type's `defaults`).
Undeclared properties fail the schema lint. Prefer templates over new classes:
a verb ("fit a model", "5-fold CV") is a template over a generic type, not a
class; see the `eeg` template sections.

## Examples

A schema may ship whole diagrams, not just elements. Each entry under
`examples:` takes `title`, `description` (first sentence is the card blurb),
optional `icon`, and `studyflow`: a complete document in the
`.studyflow.yaml` format, either as a mapping or as raw YAML text. Its gallery
shelf is the skill's name — an example declares no category of its own.
`eeg.moddle.yaml` has a worked one.

The gallery's other cards are the PNGs in each skill's `examples/` folder, each a picture of a diagram with the diagram embedded
in it. The skill is the shelf, so an example lands with the vocabulary or runner
it exercises. `npm run examples:render` redraws every PNG from its own embedded
diagram.

## Icons

Iconify classes must use a prefix enabled in `src/assets/css/app.css`
(`@plugin "@iconify/tailwind4"` block); an unlisted prefix renders an empty
box. PNG/SVG export fetches glyphs from `api.iconify.design` at export time
and degrades (with a notice) when offline.

## Reserved local names

`studyflow:Study`, `studyflow:StartEvent`, `studyflow:EndEvent`, and
`studyflow:SequenceFlow` are backed by the static palette groups instead of
schema tiles. The exclusion is namespace-qualified: your schema's own
`StartEvent` is unaffected.

## Failure surfacing

A file that fails to parse is quarantined (the app boots without it) and shown
in Settings → Extensions with its error. Compile diagnostics (all of the
checks above) print to the console at load and badge the schema's Settings
row. `npm run lint:schemas` runs the CI-grade suite locally in about a second.

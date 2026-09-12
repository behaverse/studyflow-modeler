# Schema reference

Every key a `<name>/<name>.linkml.yaml` can carry, and what reads it. [README.md](README.md) says what a skill is.

## Schemas

A skill's vocabulary is a [LinkML](https://linkml.io) schema, named by the `schema` key of its `SKILL.md` and
loaded with no registration. `packages/core/src/notation/linkml.ts` reads it into the moddle package that
reads and writes the BPMN XML, and the catalog compiles that package into the palette, inspector,
rendering, templates, connection rules, and round-tripping. This file lists every key the app reads, and
where; a key not listed here is LinkML's alone and nothing in the app consumes it. The compiler warns on the
ones it can check, and `npm run schemas:lint` runs the LinkML linter (`linkml-lint`, pinned in `package.json`;
its rules are in `.linkmllint.yaml`) over every schema.

**Copying a file to start?** `eeg/eeg.linkml.yaml` is the domain pack to copy
from: inheritance from core types, wrapper + trait styles, enums, roles, and
templates beside it. `studyflow.linkml.yaml` is the *core* schema.
It declares app-wide powers (inspector tab set, `bpmn:*` redefines,
expression traits) a domain pack must not copy.

## Conventions

- A `description` is one sentence the inspector shows in a 256px tooltip; keep it under about 90 characters. Rationale, engine notes, and endpoint details go in YAML comments beside the key, never in the description.
- A plain YAML scalar cannot contain a colon followed by a space; quote a description that does.
- Attribute names are camelCase nouns. Put a unit in an annotation (`samplingRate` → `unit: Hz`). Do not put units in the attribute name (`samplingRateHz` is wrong).
- An enum attribute that allows values outside its list is annotated `editable: true`.
- A placeholder in a value is `{name}` (dotted paths allowed: `{Play.trials}`). Every reader resolves it by one rule, [Placeholders](../docs/reference.qmd#placeholders), and nothing reads `$name`, `${name}` or `{{name}}`.
- A reference to software, a model, or a device is `<scheme>://<ref>` (`python://`, `claude://claude-haiku-4-5`, `ollama://gemma4`), whatever attribute holds it.
- Element icons are iconify's Phosphor set (`iconify ph--<name>`): its 1.5px line matches the element outline, where `mdi`/`tabler` read twice as bold. Verify a glyph exists in `node_modules/@iconify/json/json/<set>.json` before using it; an unknown name falls back to the BPMN ancestor's icon.
- Reuse core types by inheritance rather than restating fields: a biosignal recording `is_a: Timeseries`, a battery task `is_a: CognitiveTask`.
- Name another schema's element by its plain name (`range: MarkdownString`) and `imports` that schema (`../studyflow/studyflow.linkml`). LinkML names are global across imports, so no two schemas declare the same name.

## Schema-level keys

| Key | Meaning |
| --- | --- |
| `id` | The schema's URI, which is also the XML namespace of its elements. Unique. |
| `name` | The prefix its elements are named under (`eeg:Session`), and `default_prefix`. Unique; a duplicate is a load diagnostic (first wins). |
| `title` | The name the app shows. |
| `description` | First sentence becomes the Settings row blurb. |
| `version` | `'YY.M.N'`, quoted (lint-enforced). |
| `rank` | Load/display order; unranked schemas sort after ranked ones, then by prefix. |
| `annotations.icon` | Iconify class (or URL) for the palette flyout header. |
| `annotations.core` | `true`: the schema always loads, and the modeler's settings cannot switch it off. |
| `subsets` | Inspector tabs, **core schema only** (the tab set is app-wide and pinned by `catalog.unit.spec.ts`): `rank` orders them, `annotations.synthetic: true` marks a tab drawn by its own section. Every other schema gets a tab of its own `title`, right after General, where its attributes file by default. |
| `classes`, `types`, `enums` | The content; below. |
| `license`, `prefixes`, `default_prefix`, `default_range: string`, `imports` | LinkML's own: the linker and the linter read them, the app does not. |

Two files beside the schema hold what a LinkML schema cannot: `templates.yaml` and `examples.yaml` (below).

## Classes

| Key | Meaning |
| --- | --- |
| `implements: [bpmn:X]` | A **wrapper**: created as that BPMN element, with its own element inside `extensionElements`. |
| `mixin: true` with `implements: [bpmn:X, …]` | A **trait**: its attributes mix onto those BPMN types and their subtypes; never created itself. |
| `is_a: Name` | Inherits another schema type, which decides the BPMN element (`Recording` `is_a: Timeseries`). |
| `abstract: true` | Not creatable. |
| `description` | Palette and inspector tooltip. |
| `attributes` | Its properties; below. |
| `annotations` | Below. |

A class with none of `implements`, `mixin`, `is_a` is a value holder other types point at (`prov:Activity`, `cognitive:Configurations`).
A `types` entry (`typeof: string`) is a value type: text an attribute holds, with an editor of its own (`MarkdownString`, `YAMLString`).

### Class annotations

| Key | Consumer |
| --- | --- |
| `icon` | Canvas + palette + append-menu glyph (Iconify class). |
| `editor` (on a value type) | Default editor for every attribute *of that type* (see editor names below). |
| `roles` | What the type stands for to exporters and the data-operation marker (`instrument`, `signal`, `acquisition`, …). `data-element` alone follows from the BPMN attach point; the lint rejects restating it. |
| `presenter` | The upper band of a typed choreography task: a template over the extension's attributes (`"Behaverse · {scene}"`), read raw. Empty or absent, the band reads "Task software". |
| `glyph` | The attribute whose value is drawn as text over the type icon (`scene`); the value `undefined` draws nothing. |
| `participantKind` (on a `bpmn:Participant` type) | What a band-only actor can be: the name of one of the type's enum attributes, one kind per literal (`actorType`), or the label of the one kind the type itself is (`Reachy Mini`). |
| `branching` | Runner gateway semantics (`random`, `condition`, `model`); the allowed set is pinned by tests. |
| `categories` | Palette-group override (rarely needed: groups derive from the BPMN ancestor). Distinct from an attribute's `in_subset`, which is its inspector tab. |
| `connectsTo` | Connection-rule allow-list; wired but currently exercised only by tests. |

An annotation value is a scalar, or, in LinkML's expanded form, any YAML: `roles: {value: [signal]}`.

## Attributes

| Key | Meaning |
| --- | --- |
| `range` | The value's type: `string` (the default, left out), `integer`, `float`, `boolean`, an enum, a value type, or a class. |
| `multivalued: true` | A list. |
| `ifabsent` | The default, as LinkML spells it: `string(csv)`, `int(3)`, `float(0.5)`, `'true'`. On an enum attribute it must be one of the enum's values (checked at compile). |
| `rank` | Sort within the inspector tab. |
| `in_subset: [Tab]` | The inspector tab. Omitted, an attribute files under its schema's own tab (`Cognitive`, `EEG`), and a core one under `General`, so General stays identity plus core fields. |
| `slot_uri: bpmn:x` | Keeps a BPMN attribute in the BPMN namespace (`implementation` redefining `bpmn:implementation`). |
| `implements: [bpmn:X]` | The value is written as that BPMN element (`bpmn:Documentation`, `bpmn:Expression`); the attribute declares no `range`, and the inspector edits the element's text as a string. `bpmn:Expression` also gets the expression row with a per-expression language picker, and is written with its `xsi:type`. |

An attribute is an XML attribute, which holds one line. A list, an `implements` value, and an attribute annotated `element: true` are child elements instead: use `element` for multi-line text (`MarkdownString`, `YAMLString`, code).

### Attribute annotations

| Key | Consumer |
| --- | --- |
| `redefines: Type#property`, `replaces: Type#property` | Overrides an inherited property; see precedence below. Must spell `Type#property`, or nothing is overridden (a diagnostic). |
| `element` | Written as a child element, above. |
| `body` | The element's text body: the one attribute of a value holder (`cognitive:Configurations.value`). |
| `pinned` | Fixed value, never rendered; also wins read precedence on double-stored values. |
| `optional` | Renders the opt-in checkbox editor (string attributes; declarative intent elsewhere). |
| `editable` | Enum that also accepts free text. |
| `readonly` | Run-record field: shown, never edited. |
| `condition` | Visibility predicate over sibling attributes, in the expanded form: `condition: {value: {attr: value}}`, with `$set` for a non-empty value, a list for any of several, `{$not: value}`. |
| `editor` | Named editor override. Known names (checked at compile): `csvw-table`, `code`, `markdown`, `checklist`; the list lives in `packages/core/src/notation/types.ts` (`EDITOR_NAMES`) and the inspector registry is typed off it. |
| `languageAttr` | Sibling attribute holding the code editor's language (e.g. `bpmn:scriptFormat`). |
| `icon` | Event overlay glyph drawn when the attribute has a value (a *different* meaning than a class's `icon`). |
| `unit` | Unit of a numeric attribute (`Hz`, `s`, `rad`); shown after the field label. Never part of the name. |

## Attribute precedence

One attribute can be declared twice — on the element's own type (or a trait
that mixes onto it) and on the wrapper under `extensionElements`. `resolveAttribute`
in `packages/core/src/element/handle.ts` picks one, first match wins.

| # | The attribute is | Resolved on | Under which name |
| --- | --- | --- | --- |
| 1 | declared by the wrapper with `redefines`/`replaces` | the element | the local name after the `#` |
| 2 | declared by the element's own type, traits included | the element | the declared name (`bpmn:id`/`bpmn:name` collapse to `id`/`name`) |
| 3 | declared by the wrapper | the wrapper | the declared name |
| 4 | declared by neither | the element | the local name |

A write that resolves to no target is dropped with a console warning.

A *read* landing on the element while a wrapper exists still returns the wrapper's
value when the wrapper's attribute is `pinned`, or stores the value explicitly,
or when the element does not store it explicitly either. So a stored element value
beats a wrapper *default*, loses to a wrapper value actually written, and loses to a
pinned wrapper attribute carrying only its default. `tests/element.unit.spec.ts` pins
each case by name.

Adding `redefines` to a wrapper attribute does not merely rename it. It moves where
the value lands. Pair it with `pinned` and the write goes somewhere the read
never looks, so an edit appears to do nothing. Redefine only where the BPMN side
genuinely declares the attribute, as `studyflow:Implementation` redefines
`bpmn:ServiceTask#implementation`.

## Enums

`permissible_values` is keyed by the value; each takes a `title` (the name shown, the value when absent),
a `description`, and an optional `icon` annotation (rendered in the enum input; may name a raw-SVG key from
`packages/canvas/src/render/icons.ts`'s `SVG_ICON_PATHS`). Quote a value YAML would not read as a string
(`'50'`, `'behaverse:Trial'`).

An enum is open: another schema adds values to it with an enum of its own that `apply_to` names it, so a
small skill grows a shared list rather than redeclaring it. A value the target already has is dropped with
a diagnostic, as is an `apply_to` that resolves to no enum.

```yaml
enums:
  AgenticActorTypes:
    apply_to:
      - ActorTypeEnum
    permissible_values:
      llm:
        title: Large language model
```

## Templates

`templates.yaml`, beside the schema, is a list of palette flyout entries. Each has a `description` and
`elements`: the elements a drop adds, id-keyed and spelled as in a `.studyflow.yaml` file. The first is the
element dropped and what the palette shows (its `name`, and its own `studyflow:icon` or its type's); a
pool's `processRef` names the process holding its flow. Prefer templates over new classes: a verb ("fit a
model", "5-fold CV") is a template over a generic type, not a class; see `eeg/templates.yaml`.

## Examples

A skill may ship whole diagrams, not just elements. `examples.yaml`, beside the schema, lists them: each
takes `title`, `description` (first sentence is the card blurb), optional `icon`, and `studyflow`: a
complete document in the `.studyflow.yaml` format, either as a mapping or as raw YAML text. Its gallery
shelf is the skill's name — an example declares no category of its own. `eeg/examples.yaml` has a worked one.

The gallery's other cards are the PNGs in each skill's `examples/` folder, each a picture of a diagram with the diagram embedded
in it. The skill is the shelf, so an example lands with the vocabulary or runner
it exercises. `npm run examples:render` redraws every PNG from its own embedded
diagram.

## Icons

Iconify classes must use a prefix enabled in `assets/css/app.css`
(`@plugin "@iconify/tailwind4"` block); an unlisted prefix renders an empty
box, and is left out of PNG/SVG exports; every listed icon is inlined from the
stylesheet, so exports need no network.

## Reserved local names

`studyflow:Study`, `studyflow:StartEvent`, `studyflow:EndEvent`, and
`studyflow:SequenceFlow` are backed by the static palette groups instead of
schema tiles. The exclusion is namespace-qualified: your schema's own
`StartEvent` is unaffected.

## Failure surfacing

A file that fails to parse is quarantined (the app boots without it) and shown
in Settings → Extensions with its error. Compile diagnostics (all of the
checks above) print to the console at load and badge the schema's Settings
row. `npm run test:unit -- schema catalog` runs that suite locally in about a second.

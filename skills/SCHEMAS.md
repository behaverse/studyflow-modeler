# Schema reference

Every key a `<name>/<name>.moddle.yaml` can carry, and what reads it. [README.md](README.md) says what a skill is.

## Schemas

A skill's vocabulary is a moddle package written in YAML, named by the `schema` key of its `SKILL.md` and
loaded with no registration. It has the shape of bpmn-moddle's own BPMN package
(`node_modules/bpmn-moddle/resources/bpmn/json/bpmn.json`), plus keys only the app reads, most of them under
`meta`; `SchemaModel` in `packages/core/src/notation/moddlePackage.ts` describes it. bpmn-moddle reads and
writes the BPMN XML with it, and the catalog (`packages/core/src/notation/compile.ts`) compiles it into the palette,
inspector, rendering, templates, connection rules, and round-tripping. This file lists every key the app reads,
and where; a key not listed here is moddle's alone. The compiler warns on the ones it can check.

The first line, `# yaml-language-server: $schema=https://unpkg.com/moddle/resources/schema/moddle.json`, lets an
editor check moddle's own keys as you type. That schema requires `name`, `prefix`, `uri` and `types` (`types: []`
when there are none) and allows any other key, so the app's keys pass.

**Copying a file to start?** `eeg/eeg.moddle.yaml` is the domain pack to copy
from: inheritance from core types, wrappers, enums, roles, and templates.
`studyflow/studyflow.moddle.yaml` is the vocabulary every diagram uses. It alone
declares app-wide powers (the inspector tab set, `bpmn:*` redefines, expression
traits), which a domain pack must not copy; its `Scheduling` is the plainest trait.

## Conventions

- A `description` is one sentence the inspector shows in a 256px tooltip; keep it under about 90 characters. Rationale, engine notes, and endpoint details go in YAML comments beside the key, never in the description.
- A plain YAML scalar cannot contain a colon followed by a space; quote a description that does.
- Attribute names are camelCase nouns. Put a unit in the attribute's meta (`samplingRate` → `meta.unit: Hz`). Do not put units in the attribute name (`samplingRateHz` is wrong).
- An enum attribute that allows values outside its list is `meta.editable: true`.
- A placeholder in a value is `{name}` (dotted paths allowed: `{Play.trials}`). Every reader resolves it by one rule, [Placeholders](../docs/reference.qmd#placeholders), and nothing reads `$name`, `${name}` or `{{name}}`.
- A reference to software, a model, or a device is `<scheme>://<ref>` (`python://`, `claude://claude-haiku-4-5`, `ollama://gemma4`), whatever attribute holds it.
- Element icons are iconify's Phosphor set (`iconify ph--<name>`): its 1.5px line matches the element outline, where `mdi`/`tabler` read twice as bold. Verify a glyph exists in `node_modules/@iconify/json/json/<set>.json` before using it; an unknown name falls back to the BPMN ancestor's icon.
- Reuse core types by inheritance rather than restating fields: a biosignal recording is a `studyflow:Timeseries`, a battery task a `cognitive:CognitiveTask`.
- Name the schema's own types bare (`type: DeviceEnum`) and another schema's with its prefix (`superClass: [studyflow:Timeseries]`, `type: studyflow:YAMLString`); moddle reads a bare name as the schema's own. The catalog also looks a bare name up in every schema and takes the first it finds, so no two schemas declare the same name.

## Schema-level keys

| Key | Meaning |
| --- | --- |
| `name` | The name the app shows: the Settings row, the palette flyout, and the schema's own inspector tab. |
| `prefix` | The prefix its elements are named under (`eeg:Session`), in lowercase. Unique; a duplicate is a load diagnostic (first wins). |
| `description` | First sentence becomes the Settings row blurb. |
| `uri` | The XML namespace of its elements: an http(s) URI no other schema uses. |
| `icon` | Iconify class (or URL) for the palette flyout header. |
| `order` | Load/display order; unordered schemas sort after ordered ones, then by prefix. |
| `required` | `true`: the schema always loads, and the modeler's settings mark it with a lock and cannot switch it off. Left out, it is `false`: a skill the user can switch off. |
| `xml.tagAlias` | `lowerCase`, in every schema: moddle writes each element's tag in lowerCamelCase (`<eeg:session>`). |
| `version` | `'YY.M.N'`, quoted, like the app's own version. |
| `categories` | Inspector tabs, **studyflow schema only** (the tab set is app-wide and pinned by `tests/schemas.unit.spec.ts`): each a `name`, an `order`, a `description`, and `synthetic: true` for a tab drawn by its own section. An attribute joins one in its `meta.categories`. Every other schema gets a tab of its own `name`, right after General, where its attributes file by default. |
| `enumerations`, `types`, `templates` | The content; below. |

`templates` come last in the file: what the schema is, then what it declares, then what the palette offers.
`tests/schemas.unit.spec.ts` checks the forms: a lowercase `prefix`, an http(s) `uri` no other schema shares, a
quoted `YY.M.N` `version`, a `lowerCase` `xml.tagAlias`, a blurb that fits a Settings row, and PascalCase type
and enumeration names that no other schema declares.

## Types

| Key | Meaning |
| --- | --- |
| `name` | The type's name; the schema's prefix qualifies it (`eeg:Session`). |
| `description` | Palette and inspector tooltip. |
| `superClass: [bpmn:X]` | A **wrapper**: created as that BPMN element, with its own element inside `extensionElements`. |
| `superClass: [Type]` | Inherits another type, which decides the BPMN element (`eeg:Recording` is a `studyflow:Timeseries`). |
| `extends: [bpmn:X, …]` with `isAbstract: true` | A **trait**: its attributes mix onto those BPMN types and their subtypes. It has no `superClass` and is never created itself. |
| `isAbstract: true` | Not creatable. |
| `meta` | The app's own keys; below. |
| `properties` | Its attributes; below. |

A type whose `superClass` is a moddle built-in (`String`) is a value type: text an attribute holds, with an
editor of its own (`MarkdownString`, `YAMLString`). Any other type with no BPMN ancestor is a value holder other
types point at (`prov:Activity`), and writes `superClass: [Element]`, moddle's root;
`superClass: [bpmn:BaseElement]` gives one BPMN's `id` and documentation but no place on the canvas
(`studyflow:DataCatalog`).

### Type `meta`

| Key | Consumer |
| --- | --- |
| `icon` | Canvas + palette + append-menu glyph (Iconify class). |
| `editor` (on a value type or any other type) | Default editor for every attribute *of that type* (see editor names below). |
| `roles` | What the type stands for to exporters and the data-operation marker (`instrument`, `signal`, `acquisition`, …). `data-element` alone follows from the BPMN attach point; don't restate it. |
| `presenter` | The upper band of a typed choreography task: a template over the extension's attributes (`"Behaverse · {instrument}"`), read raw. Empty or absent, the band reads "Task software". |
| `glyph` | The attribute whose value is drawn as text over the type icon (`instrument`). |
| `participantKind` (on a `bpmn:Participant` type) | What a band-only actor can be: the name of one of the type's enum attributes, one kind per literal (`actorType`), or the label of the one kind the type itself is (`Reachy Mini`). |
| `branching` | Gateway semantics for both runners (`random`, `condition`, `model`); the allowed set is pinned by `tests/schemas.unit.spec.ts`. `skills/local/run.py` reads it from the schema file itself. |
| `categories` | Palette-group override (rarely needed: groups derive from the BPMN ancestor). Distinct from an attribute's `meta.categories`, which is its inspector tab. |
| `connectsTo` | Connection-rule allow-list; wired but currently exercised only by tests. |

A `meta` value is any YAML: a scalar, a list (`roles: [signal]`), or a mapping (an attribute's `condition`).

## Properties

Each entry of a type's `properties` is one attribute.

| Key | Meaning |
| --- | --- |
| `name` | The attribute's name. Spelled `bpmn:<property>`, it is BPMN's own and stays in the BPMN namespace (`bpmn:implementation`). |
| `description` | Inspector tooltip. |
| `type` | The value's type: moddle's `String`, `Boolean`, `Integer` or `Real`, an enumeration, a value type, a type, or a BPMN element (below). Written on every attribute, `String` included. |
| `isAttr: true` | An XML attribute; below. |
| `isMany: true` | A list, one child element per entry. |
| `isBody: true` | The element's text body: the one attribute of a value holder. |
| `default` | The value a new element starts with, as plain YAML of the attribute's type (`csv`, `3`, `0.5`, `true`); `tests/schemas.unit.spec.ts` checks the type. Quote a value YAML would read as another type (`default: '50'`). On an enum attribute it must be one of the literal values (checked at compile). |
| `redefines: Type#property`, `replaces: Type#property` | Overrides an inherited property; see precedence below. The type is named like any other (`cognitive:CognitiveTask#platform`, `bpmn:ServiceTask#implementation`); anything not spelled `Type#property` overrides nothing (a diagnostic). Overriding a BPMN property also names it `bpmn:<property>`, or the value is written in the schema's own namespace. |
| `xml.serialize: xsi:type` | On a `bpmn:Expression` attribute: moddle writes the element with its `xsi:type`, as BPMN writes an expression. |
| `meta` | The app's own keys; below. |

An attribute with `isAttr: true` is an XML attribute, which holds one line. Without it, the attribute is a child
element. Use a child element for multi-line text (`MarkdownString`, `YAMLString`, code), and to nest a value holder.
When `type` names a BPMN element, moddle writes the value as that element. `bpmn:Documentation` and `bpmn:Expression` are text the inspector edits as a string; other BPMN
elements (`bpmn:DataInputAssociation`) are structure the canvas draws, never an inspector field. An expression
takes `type: bpmn:Expression`, `xml.serialize: xsi:type` and `meta.expression: true` together, as studyflow's
`SequenceFlow` trait shows, redefining a BPMN property:

```yaml
types:
  - name: SequenceFlow
    description: Lets a flow carry the condition it is taken on.
    extends:
      - bpmn:SequenceFlow
    isAbstract: true
    properties:
      - name: bpmn:conditionExpression
        description: Take this flow when the expression holds (`accuracy >= 0.9`).
        type: bpmn:Expression
        xml:
          serialize: xsi:type
        redefines: bpmn:SequenceFlow#conditionExpression
        meta:
          expression: true
```

### Attribute `meta`

| Key | Consumer |
| --- | --- |
| `order` | Sort within the inspector tab. |
| `categories: [Tab]` | The inspector tab. Omitted, an attribute files under its schema's own tab (`Cognitive`, `EEG & Biosignals`), and a studyflow one under `General`, so General stays identity plus core fields. |
| `pinned` | Fixed value, never rendered; also wins read precedence on double-stored values. |
| `optional` | Renders the opt-in checkbox editor (`String` attributes; declarative intent elsewhere). |
| `editable` | Enum that also accepts free text. |
| `readonly` | Run-record field: shown, never edited. |
| `condition` | Visibility predicate over sibling attributes: `{attr: value}`, with `$set` for a non-empty value, a list for any of several, `{$not: value}`. |
| `editor` | Named editor override. Known names (checked at compile): `csvw-table`, `code`, `markdown`, `checklist`; the list lives in `packages/core/src/notation/types.ts` (`EDITOR_NAMES`) and the inspector registry is typed off it. |
| `expression` | With `type: bpmn:Expression`: the inspector edits it as a string, with a per-expression language picker. |
| `languageAttr` | Sibling attribute holding the code editor's language (e.g. `bpmn:scriptFormat`). |
| `icon` | Event overlay glyph drawn when the attribute has a value (a *different* meaning than a type's `icon`). |
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
value when the wrapper's attribute is `meta.pinned`, or stores the value explicitly,
or when the element does not store it explicitly either. So a stored element value
beats a wrapper *default*, loses to a wrapper value actually written, and loses to a
pinned wrapper attribute carrying only its default. `packages/core/tests/element.unit.spec.ts` pins
each case by name.

Adding `redefines` to a wrapper attribute does not merely rename it. It moves where
the value lands. Pair it with `meta.pinned` and the write goes somewhere the read
never looks, so an edit appears to do nothing. Redefine only where the BPMN side
genuinely declares the attribute, as `studyflow:Implementation` redefines
`bpmn:ServiceTask#implementation`.

## Enumerations

An enumeration has a `name`, a `description`, and `literalValues`, each with a `name` (the label shown), a
`value` (what the file stores), an optional `description`, and an optional `icon` (rendered in the enum input; may
name a raw-SVG key from `packages/canvas/src/render/icons.ts`'s `SVG_ICON_PATHS`). Quote a value YAML would read
as a number or a boolean (`value: '50'`).

An enumeration is open: another schema adds literals to it with an entry that `extends` it instead of declaring a
`name`, so a small skill grows a shared list rather than redeclaring it. A literal whose value the target already
has is dropped with a diagnostic, as is an `extends` that names no enumeration.

```yaml
enumerations:
  - extends: studyflow:ActorTypeEnum
    description: What an actor pool can be, beyond cognitive's human, software, and hardware.
    literalValues:
      - name: Large language model
        value: llm
```

## Templates

`templates` lists the schema's palette flyout entries. Each has a `description` and `elements`: the elements a
drop adds, id-keyed and spelled as in a `.studyflow.yaml` file. The first is the element dropped and what the
palette shows (its `name`, and its own `icon` or its type's); a pool's `processRef` names the process holding its
flow. `tests/schemas.unit.spec.ts` reads each template as a studyflow and fails on any warning, such as an
undeclared attribute. Prefer templates over new types: a verb ("fit a model", "5-fold CV") is a template over a
generic type, not a type; see the end of `eeg.moddle.yaml`.

```yaml
templates:
  - description: Filter EEG data and remove artifacts in one step.
    elements:
      EEGPrep:
        type: ServiceTask
        name: EEGPrep
        icon: iconify ph--wave-sine
        …
```

## Examples

A skill ships whole diagrams in its `examples/` folder, not in its schema, each a `.studyflow.yaml`, never a
picture; the gallery shows them, and the skill is the shelf, so an example lands with the vocabulary or runner it
exercises. The gallery draws an example's card when it opens: the main canvas, without glyphs.

## Icons

Iconify classes must use a prefix enabled in `assets/css/app.css`
(`@plugin "@iconify/tailwind4"` block); an unlisted prefix renders an empty
box, and is left out of PNG/SVG exports; every listed icon is inlined from the
stylesheet, so exports need no network.

## Reserved local names

`studyflow:Study`, `studyflow:StartEvent`, `studyflow:EndEvent`, and
`studyflow:SequenceFlow` are backed by the static palette groups instead of
schema tiles.

## Failure surfacing

A file that fails to parse is quarantined (the app boots without it) and shown
in Settings → Extensions with its error. Compile diagnostics (all of the
checks above) print to the console at load and badge the schema's Settings
row. `npm run test:unit -- schemas catalog diagnostics moddle-package` runs those specs locally in about a second.

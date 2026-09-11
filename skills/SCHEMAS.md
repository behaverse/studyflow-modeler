# Schema reference

Every key a `<name>/<name>.moddle.yaml` can carry, and what reads it. [README.md](README.md) says what a skill is.

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
- A plain YAML scalar cannot contain a colon followed by a space; quote a description that does.
- Attribute names are camelCase nouns. Put a unit in the meta (`samplingRate.meta.unit = 'Hz'`). Do not put units in the attribute name (`samplingRateHz` is wrong).
- An enum attribute that allows values outside its list is `meta.editable: true`.
- A placeholder in a value is `{name}` (dotted paths allowed: `{Play.trials}`); every runner reads that form and nothing reads `${name}` or `{{name}}`.
- A reference to software, a model, or a device is `<scheme>://<ref>` (`python://`, `claude://claude-haiku-4-5`, `ollama://gemma4`), whatever attribute holds it.
- Element icons are iconify's Phosphor set (`iconify ph--<name>`): its 1.5px line matches the element outline, where `mdi`/`tabler` read twice as bold. Verify a glyph exists in `node_modules/@iconify/json/json/<set>.json` before using it; an unknown name falls back to the BPMN ancestor's icon.
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
| `categories` | Inspector tab declarations, **core schema only** (the tab set is app-wide and pinned by `catalog.unit.spec.ts`). Every other schema gets a tab of its own `name`, right after General, where its attributes file by default. |
| `types`, `enumerations`, `templates` | The content; below. |
| `examples` | Complete studyflows offered in the New Diagram gallery; below. |

## Type-level `meta.*`

| Key | Consumer |
| --- | --- |
| `bpmnType` | Which BPMN element the type is created as (shape, palette, templates). Validated against the known BPMN table; a typo is a diagnostic and the type becomes non-creatable. |
| `icon` | Canvas + palette + append-menu glyph (Iconify class). |
| `editor` (on a value type) | Default editor for every attribute *of that type* (see editor names below). |
| `roles` | What the type stands for to exporters and the data-operation marker (`instrument`, `signal`, `acquisition`, …). `data-element` alone follows from the BPMN attach point; the lint rejects restating it. |
| `presenter` | The upper band of a typed choreography task: a template over the extension's attributes (`"Behaverse · {scene}"`), read raw. Empty or absent, the band reads "Task software". |
| `glyph` | The attribute whose value is drawn as text over the type icon (`scene`); the value `undefined` draws nothing. |
| `participantKind` (on a `bpmn:Participant` type) | What a band-only actor can be: the name of one of the type's enum attributes, one kind per literal (`actorType`), or the label of the one kind the type itself is (`Reachy Mini`). |
| `branching` | Runner gateway semantics (`random`, `condition`, `model`); the allowed set is pinned by tests. |
| `categories` | Palette-group override (rarely needed: groups derive from the BPMN ancestor). Distinct from *property-level* `categories`, which are inspector tabs. |
| `connectsTo` | Connection-rule allow-list; wired but currently exercised only by tests. |

Style is inferred, not declared: `extends`-only = **trait** (attributes mix
onto the BPMN element), `superClass` = **wrapper** (its own element inside
`extensionElements`).

## Property-level `meta.*`

| Key | Consumer |
| --- | --- |
| `categories` | Inspector tab. Omitted, an attribute files under its schema's own tab (`Cognitive`, `EEG`), and a core one under `General`, so General stays identity plus core fields. |
| `order` | Sort within the tab. |
| `pinned` | Fixed value, never rendered; also wins read precedence on double-stored values. |
| `optional` | Renders the opt-in checkbox editor (String attributes; declarative intent elsewhere). |
| `editable` | Enum that also accepts free text. |
| `readonly` | Run-record field: shown, never edited. |
| `condition.body` | Visibility predicate over sibling attributes (`{attr: value}`, `$set` for a non-empty value, arrays, `{$not: value}`). |
| `editor` | Named editor override. Known names (checked at compile): `csvw-table`, `code`, `markdown`, `checklist`; the list lives in `packages/core/src/notation/types.ts` (`EDITOR_NAMES`) and the inspector registry is typed off it. |
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
| 1 | declared by the wrapper with `redefines`/`replaces` | the element | the local name after the `#` |
| 2 | declared by the element's own type, traits included | the element | the declared name (`bpmn:id`/`bpmn:name` collapse to `id`/`name`) |
| 3 | declared by the wrapper | the wrapper | the declared name |
| 4 | declared by neither | the element | the local name |

A write that resolves to no target is dropped with a console warning.

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
input; may name a raw-SVG key from `packages/canvas/src/render/icons.ts`'s `SVG_ICON_PATHS`).
A property `default` on an enum-typed attribute must be one of the literal
values — checked at compile.

An enum is open: another schema adds literals to it with an entry that
`extends` it instead of declaring a `name`, so a small skill grows a shared
list rather than redeclaring it. A literal whose value the target already has
is dropped with a diagnostic, as is an `extends` that resolves to no enum.

```yaml
enumerations:
  - extends: cognitive:ActorTypeEnum
    literalValues:
      - name: Large language model
        value: llm
```

## Templates

A template stamps a pre-configured element (or a small flow) into the canvas:
`object.type` plus any declared property of that type, and optionally `icon`,
`bpmn:name`, `bpmn:documentation`, `flowElements` (nodes with
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

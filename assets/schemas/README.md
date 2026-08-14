# Schema authoring reference

Every `*.moddle.yaml` in this directory is auto-loaded (no registration) and
compiled into the catalog that drives the palette, inspector, rendering,
templates, connection rules, and round-tripping. This file is the vocabulary
reference: every key the app actually reads, and where. If a key is not listed
here, nothing consumes it — the compiler warns on the ones it can check.

**Copying a file to start?** `eeg.moddle.yaml` is the exemplar domain
pack: inheritance from core types, wrapper + trait styles, enums, roles, and
implementation-bound templates. `studyflow.moddle.yaml` is the *core* schema — it declares app-wide
powers (inspector tab set, `bpmn:*` redefines, expression traits) a domain
pack must not copy.

## Schema-level keys

| Key | Meaning |
| --- | --- |
| `name`, `prefix`, `uri` | Identity. `prefix` must be unique — a duplicate is a load diagnostic (first wins). |
| `description` | First sentence becomes the Settings row blurb. |
| `icon` | Iconify class (or URL) for the palette flyout header. |
| `core` | `true` = always loaded, cannot be disabled (studyflow, prov, functional, cognitive). |
| `order` | Load/display order; unordered schemas sort after ordered ones, then by prefix. |
| `version` | `YY.MMDD` string (lint-enforced). |
| `xml.tagAlias` | moddle pass-through (`lowerCase`). |
| `categories` | Inspector tab declarations — **core schema only** (the tab set is app-wide and pinned by `catalog.unit.spec.ts`). |
| `types`, `enumerations`, `templates` | The content; below. |

## Type-level `meta.*`

| Key | Consumer |
| --- | --- |
| `bpmnType` | Which BPMN element the type is created as (shape, palette, templates). Validated against the known BPMN table — a typo is a diagnostic and the type becomes non-creatable. |
| `icon` | Canvas + palette + append-menu glyph (Iconify class). The top-level `icon:` on a type is a legacy fallback. |
| `editor` (on a value type) | Default editor for every attribute *of that type* (see editor names below). |
| `roles` | Adds to the shape-inferred roles (`data-element`, `instrument`, …) — declare only what inference misses; the lint rejects restatements. |
| `branching` | Runner gateway semantics (`random`, `condition`, `model`); the allowed set is pinned by tests. |
| `categories` | Palette-group override (rarely needed: groups derive from the BPMN ancestor). Distinct from *property-level* `categories`, which are inspector tabs. |
| `connectsTo` | Connection-rule allow-list; wired but currently exercised only by tests. |

Style is inferred, not declared: `extends`-only = **trait** (attributes mix
onto the BPMN element), `superClass` = **wrapper** (its own element inside
`extensionElements`).

## Property-level `meta.*`

| Key | Consumer |
| --- | --- |
| `categories` | Inspector tab (default `General` — omit rather than restate it). |
| `order` | Sort within the tab. |
| `pinned` | Fixed value, never rendered; also wins read precedence on double-stored values. |
| `optional` | Renders the opt-in checkbox editor (String attributes; declarative intent elsewhere). |
| `editable` | Enum that also accepts free text. |
| `readonly` | Run-record field: shown, never edited. |
| `condition.body` | Visibility predicate over sibling attributes (`{attr: value}`, `$set`, arrays). |
| `editor` | Named editor override. Known names (checked at compile): `csvw-table`, `code`, `markdown`, `checklist` — the list lives in `core/notation/types.ts` (`EDITOR_NAMES`) and the inspector registry is typed off it. |
| `expression` | Stored as a BPMN expression element; renders the expression row with a per-expression language picker. |
| `languageAttr` | Sibling attribute holding the code editor's language (e.g. `bpmn:scriptFormat`). |
| `icon` | Event overlay glyph drawn when the attribute has a value (a *different* meaning than type-level `icon`). |

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
class — see the `ml` file and the `eeg`/`functional` template sections.

## Icons

Iconify classes must use a prefix enabled in `src/assets/css/app.css`
(`@plugin "@iconify/tailwind4"` block) — an unlisted prefix renders an empty
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

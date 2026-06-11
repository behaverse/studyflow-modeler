# Architecture

This document describes the layering of the studyflow-modeler codebase, the
role of the **type catalog**, and the deliberate boundary around bpmn-js and
moddle. Read this before adding element types, schema attributes, or new
modeler features.

## Layers

```
src/assets/schemas/*            schema sources (moddle YAML today; LinkML-ready)
        │
        ▼  schema front-ends  (src/lib/core/schema: fromModdleYaml | fromLinkml)
   SchemaModel (IR) ───────────► toModdlePackages() ──► generated moddle packages
        │                                               (BPMN XML codec config —
        ▼  buildCatalog()                                moddle is an OUTPUT here)
┌──────────────────────────────────────────────────────────────────────┐
│ src/lib/core — pure TypeScript, NO bpmn-js / diagram-js imports      │
│   schema/     the IR + front-ends/back-end described above           │
│   catalog/    compiled, plain-data view of the schemas (see below)   │
│   extensions/ attribute get/set on live elements (wrapper vs trait)  │
│   codec/      `.studyflow` YAML <-> BPMN XML (lossless, see below)   │
│   parsers/    studyflow text -> flow graph (XML or YAML)             │
└──────────────────────────────────────────────────────────────────────┘
        │ catalog + getAttribute/setAttribute
        ├──────────────────────────────┐
        ▼                              ▼
┌──────────────────────────┐   ┌──────────────────────────┐
│ src/modeler              │   │ src/runner               │
│ bpmn-js adapter layer:   │   │ executes a parsed flow   │
│  - commands/ (the only   │   │ with React Flow; no      │
│    API the React UI uses)│   │ bpmn-js, no diagram-js,  │
│  - DI modules (renderer, │   │ no moddle reflection     │
│    palette, context pad, │   └──────────────────────────┘
│    rules, templates,     │
│    simulation)           │
│  - React UI (inspector,  │
│    navbar, dialogs)      │
└──────────────────────────┘
```

Rules that keep this clean:

- **`src/lib/core` never imports bpmn-js or diagram-js.** It may import
  `bpmn-moddle` only inside `parsers/`, strictly as an XML codec.
- **Nothing outside the catalog reads moddle's type registry.** No
  `moddle.registry`, `getTypeDescriptor`, `getEffectiveDescriptor`,
  `propertiesByName`, or `typeMap` anywhere else — schema metadata comes from
  the catalog. The only remaining uses of the `moddle` service are factories:
  `moddle.create(...)` for new elements and `moddle.ids` for ID generation.
- **React UI talks to bpmn-js through `executeCommand`**
  (`src/modeler/commands`), a typed command union with one handler per
  operation. UI components do not call `modeler.get(...)` for editing
  operations.

## The type catalog (`src/lib/core/catalog`)

Historically the app interrogated moddle's reflective metamodel at runtime —
walking `superClass`/`extends` chains, probing descriptors with try/catch,
re-deriving the same facts in six different places (type-to-BPMN resolution,
palette setup, append/replace menus, attribute resolution, defaults,
templates). That made "how does a type behave?" unanswerable without tracing
moddle internals.

The catalog replaces all of it. `loadSchemas()` compiles the YAML schemas
**once** into plain data:

- `TypeEntry` — per type: qualified name, the BPMN element it attaches to
  (`bpmnType`), serialization style (`wrapper` = lives inside
  `<bpmn:extensionElements>`, `trait` = `extends:`-style attributes mixed onto
  the BPMN business object), effective attributes with `redefines` applied,
  defaults, palette label/categories/visibility.
- `AttributeSpec` — per attribute: names (local + qualified), declared type,
  precompiled body-wrapper drilling (`bodyProp`/`bodyType`), enum membership,
  `meta` (categories, pinned, condition, …).
- Compiled element **templates** (from each schema's `templates:` section and
  from types with `meta.flowElements`).
- Enumerations with their literals.
- A static table of BPMN 2.0 ancestor chains (`catalog/bpmn.ts`) — the spec
  has been frozen since 2011, so a table beats runtime reflection.

The compiled catalog is installed via `setActiveCatalog()` before the modeler
or runner construct anything; every consumer (palette, append menu, renderer,
inspector, runner nodes, exporters) reads `getActiveCatalog()`.

**Correctness is enforced, not assumed:** `tests/catalog.unit.spec.ts`
cross-validates the catalog against a real bpmn-moddle instance built from
the same schemas — attribute sets, types, defaults, body-property resolution,
trait application, the BPMN ancestor table, and BPMN-type resolution (against
a frozen port of the legacy walker). If the catalog's static view ever
diverges from what moddle serializes, the suite fails.

## The schema IR (`src/lib/core/schema`)

`SchemaModel` is the format-neutral contract between schema *front-ends* and
the rest of the system:

- `fromModdleYaml(text)` — today's authoring format.
- `fromLinkml(text)` — maps LinkML (classes/`is_a`/mixins/`class_uri`/
  `slot_usage`/enums/`annotations`) to the same IR; one LinkML file can feed
  several Studyflow schemas via `class_uri` prefixes. The mapping table is
  documented in `fromLinkml.ts`.
- `toModdlePackages(model)` — the only code that knows moddle's package
  conventions; generates the XML-codec configuration. **The moddle format is
  an output of the IR, not the source.**

Guard rails:

- `tests/schema-ir.unit.spec.ts` pins the generated packages byte-for-byte
  against the pre-IR transform, so `.studyflow` XML serialization cannot
  change by accident.
- `tests/linkml.unit.spec.ts` compiles `studyflow.linkml.yaml` (the declared
  source of truth) and diffs its catalog against the moddle mirrors. All
  current differences are pinned in `KNOWN_DIVERGENCES` — the checked-in
  migration TODO list. New drift in either file fails CI.

Migrating authoring to LinkML therefore means: burn down
`KNOWN_DIVERGENCES` (mostly `annotations: {bpmnType: ...}` pins and
trait-vs-wrapper style decisions), then switch `loadSchemas()` to call
`fromLinkml` — nothing downstream of the IR changes.

## The `.studyflow` file format

`.studyflow` files are **YAML**, semantically equivalent to the BPMN 2.0 XML
serialization. The codec (`src/lib/core/codec`) maps the BPMN object tree to
a YAML document generically over the metamodel — containment becomes
nesting, references become id strings, raw XML attributes are kept verbatim,
schema defaults are omitted — so extension wrappers, traits, nested
sub-process flows, pools, colors, and diagram geometry all survive both
directions by construction.

```yaml
studyflow: "1"
definitions: { id: ... }
elements:    [ { type: studyflow:Study, ... } ]   # bpmn rootElements
diagram:     [ ... ]                              # bpmndi tree (geometry)
```

Boundaries:

- **Save As** writes YAML; **Export As > BPMN 2.0 XML** writes raw XML for
  interop with other BPMN tooling.
- **Open** sniffs the content, so legacy XML `.studyflow` files, `.bpmn`,
  and `.xml` keep working; the runner accepts both serializations too.
- Internal XML stays XML: autosave (localStorage), the publish API body,
  and the XML embedded in exported SVGs.

Guarantees (`tests/codec.unit.spec.ts`): for every bundled example,
XML -> YAML -> XML -> YAML reaches a byte-identical fixed point, and the
runner's parsed flow graph is identical through both serializations.

Writing the YAML round-trip suite also uncovered a long-standing data-loss
bug in the XML path itself: moddle only stores element text for the built-in
`String` type, so `isMany` properties typed with value types
(`inclusionCriteria`, `exclusionCriteria`, `strata`, `Checklist.items`,
`Document.metadata`) silently lost their text on every load.
`toModdlePackages` now rewrites such properties to plain `String` on the
wire while the catalog keeps the authored type as the UI hint; a regression
test pins the fix.

## Connection rules

Canvas connectability is decided by `rules` providers:

1. `StudyflowRules` (`src/modeler/StudyflowRules.ts`) — consults the catalog:
   a schema type may declare `meta.connectsTo` (moddle YAML `meta:` /
   LinkML `annotations:`) with an allow-list of targets — qualified type
   names, `bpmn:*` (matched against the target's BPMN type and ancestors),
   or `'*'`. Declared rules win, both to allow and to veto.
2. When a type declares nothing (all current schemas), the rule defers and
   bpmn-js's built-in `BpmnRules` decide using standard BPMN semantics.

This is the seam for schema-driven business rules: they live in the schema
and the catalog, not in bpmn-js. The evaluator
(`TypeCatalog.connectionVerdict`) is pure and unit-tested in
`tests/schema-ir.unit.spec.ts`.

## Adding a new element type

Edit the relevant `*.moddle.yaml` — nothing else. The palette entry, append
menu entry, inspector fields (with category tabs, enum dropdowns, YAML
editors), renderer icon, defaults, templates, connection rules, and runner
attribute access all derive from the catalog. See `docs/` for the schema
authoring guide.

## The bpmn-js / moddle boundary

We keep bpmn-js and bpmn-moddle for exactly two jobs:

1. **moddle** (inside bpmn-js, and standalone in the runner's parser):
   BPMN 2.0 XML serialization or deserialization. It is good at round-tripping
   `.studyflow` files, including diagram interchange (element positions,
   waypoints) and unknown attributes from other tools.
2. **diagram-js/bpmn-js**: the interactive canvas — selection, dragging,
   resizing, snapping, connection routing, label editing, undo/redo command
   stack, popup menus, auto-placement, copy/paste.

Everything else (business rules, metadata, attribute semantics, palette
content, templates) is ours and lives above the boundary.

### Should bpmn-js/moddle be replaced outright?

Assessed June 2026, after the catalog refactor:

- **moddle as a metamodel: replaced.** The catalog now owns type semantics;
  moddle's reflection API is no longer part of our programming model. What
  remains of moddle is its XML codec, which is its most reliable part and
  the part that guarantees `.studyflow` files stay standard BPMN 2.0 that
  other tools can open.
- **diagram-js as a canvas: keep, for now.** The behaviors we actually use
  (Manhattan connection routing, undo/redo across every edit, label editing,
  snapping, BPMN DI round-trip) are on the order of 10k+ LOC of battle-tested
  interaction code. A "minimal" replacement is realistically a multi-month
  project that this codebase would then own, including its bugs. The total
  bpmn-js-facing glue in this repo after the refactor (~25 files under
  `src/modeler`) is cheaper than that, indefinitely.
- **If a replacement is ever attempted**, the seams are ready: the catalog
  carries all metadata, `executeCommand` is the single editing API the UI
  uses, and `src/lib/core` + `src/runner` are already engine-agnostic. The
  natural candidate is React Flow (`@xyflow/react`, already used by the
  runner), plus a DOM-based BPMN XML reader/writer to preserve file
  compatibility. Budget the undo/redo system and DI (diagram geometry)
  round-trip first — they are the hidden majority of the work.

## Known warts (intentional, contained)

- `src/modeler/contextpad/silenceDeprecationWarning.ts` mutes a diagram-js
  deprecation warning we cannot avoid; revisit on bpmn-js major upgrades.
- bpmn-js services are stringly-typed (`modeler.get('canvas')`); typed
  facades exist in `src/modeler/bpmn-js.d.ts` for the services we use.
- moddle mutates schema objects it registers (qualifies property names in
  place). `toModdlePackages` therefore emits a fresh object per call and
  `buildCatalog` compiles from a `structuredClone` of its input; generated
  packages and catalog never share objects.

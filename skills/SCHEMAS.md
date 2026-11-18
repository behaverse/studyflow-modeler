# Writing a schema

A skill's vocabulary is a schema: a `*.moddle.yaml` file its `SKILL.md` names under `schema`. It declares element
types, their attributes, lists of values, and templates. [README.md](README.md) says what a skill is.

The format is a [moddle](https://github.com/bpmn-io/moddle) package, the one bpmn-moddle reads BPMN itself from,
written in YAML. Moddle's own keys describe the XML. What only the app reads sits under `meta`.

To start, copy `eeg/eeg.moddle.yaml`. The vocabulary every study uses is `studyflow/studyflow.moddle.yaml`.

## A schema

```yaml
# yaml-language-server: $schema=https://unpkg.com/moddle/resources/schema/moddle.json
name: My lab                            # shown in Settings, the Add panel and its inspector tab
prefix: mylab                           # its elements are mylab:Calibration
uri: http://example.org/schemas/mylab   # its XML namespace
version: '26.11.0'
description: Eye-tracking steps for my lab.
icon: iconify tabler--eye
xml:
  tagAlias: lowerCase
enumerations: []
types: []
templates: []
```

| Key | Says |
| --- | --- |
| `name`, `prefix`, `uri` | Required. The prefix is lowercase, and no other schema shares it or the `uri`. |
| `description` | Its first sentence is the blurb in Settings. |
| `icon` | The skill's glyph, an Iconify class. |
| `version` | `'YY.M.N'`, quoted. |
| `required: true` | The schema always loads and cannot be switched off. |
| `order` | Where it loads and lists, among the others. |
| `xml.tagAlias: lowerCase` | In every schema: tags are written `<mylab:calibration>`. |
| `categories` | The inspector's tabs, each a `name`, an `order` and a `description`. The core schema's alone; any other schema gets one tab, under its `name`. |
| `synthetic: true` | On a tab: it shows even when no attribute files under it, because the app draws sections of its own there (Execution: data in and out, state). |

## Types

A type is one of three kinds:

| Kind | Written | For | Example |
| --- | --- | --- | --- |
| wrapper | `superClass: [bpmn:Task]` | a new element, drawn as that BPMN element | `cognitive:Instruction` |
| subtype | `superClass: [studyflow:Dataset]` | a narrower version of another type | `eeg:BIDSDataset` |
| trait | `extends: [bpmn:Activity]` and `isAbstract: true` | attributes added to existing BPMN elements | `studyflow:Scheduling` |

```yaml
types:
  - name: Calibration
    description: Calibrates the eye tracker before a block.
    superClass:
      - bpmn:Task
    meta:
      icon: iconify tabler--focus-2
    properties:
      - name: points
        description: How many points the calibration shows.
        isAttr: true
        type: Integer
        default: 9
        meta:
          showInline: true
```

Two more kinds hold values rather than draw elements. A type whose `superClass` is `String` is text with a widget
of its own (`MarkdownString`). A type whose `superClass` is `Element` is a record other types point at
(`prov:Activity`).

### A type's `meta`

| Key | Says |
| --- | --- |
| `icon` | Its glyph on the canvas and in the tools. |
| `glyph` | The attribute whose value is written over the icon (`instrument`). |
| `choreographyBandLabel` | The upper band's text on a task drawn as a choreography task: `"Behaverse - <instrument>"`. |
| `paletteGroup` | Its group in the tools (Events, Activities, Gateways, Data, Containers), when its BPMN ancestor does not say. |
| `tags` | Labels other parts of the app look types up by, inherited by subtypes: see [Tags](#tags). |
| `strategy` | How a gateway of this type decides: `random` or `condition`. |
| `eventDefinition` | What a new event of this type waits for: `{ type: bpmn:TimerEventDefinition, timeDuration: PT1M }`. |
| `actorKind` | On a pool type: the kinds of actor it offers, as the name of an enumeration attribute (`actorType`), or the one kind it is (`Reachy Mini`). |
| `returns` | The type that describes what a step of this type hands back, so a study reading `result.<field>` is checked. |
| `widget` | The widget every attribute of this type opens in. |

### Tags

| Tag | Read by |
| --- | --- |
| `instrument` | SPIRIT lists the step under assessments, and the ARTEM-IS export under tasks. It is never a data operation, though it names an `implementation`. |
| `screening` | CONSORT's participant flow reads the gateway as the eligibility screen. |
| `acquisition`, `signal` | The ARTEM-IS export includes the element, an `acquisition` step under acquisition. |
| `data-element` | Never written: a type attached to a BPMN data element has it. The exports read it. |

## Attributes

Each entry of a type's `properties` is one attribute.

| Key | Says |
| --- | --- |
| `name` | Its name, a camelCase noun. `bpmn:<property>` names BPMN's own. |
| `description` | One sentence, the inspector's tooltip. |
| `type` | `String`, `Boolean`, `Integer`, `Real`, an enumeration, or a type. Always written. |
| `isAttr: true` | One line of text, stored as an XML attribute. Leave it out for multi-line text, which becomes a child element. |
| `isMany: true` | A list. |
| `default` | The value a new element starts with. |
| `redefines: Type#property` | Replaces an attribute the type inherits. |

### An attribute's `meta`

Where it shows:

| Key | Says |
| --- | --- |
| `categories: [Tab]` | Its inspector tab. Left out, the schema's own tab. |
| `order` | Its place in the tab. |
| `showInline: true` | Also in the inline inspector on the canvas: the few fields set on most steps of the type. |
| `hidden: true` | Never shown: files, templates or runners set it. |
| `condition` | Shown only when sibling attributes match: `{attr: value}`, `$set` for any value, a list for any of several, `{$not: value}`. The app's own key, not a BPMN condition. |
| `label` | Its label, where the name says too little. |
| `unit` | Its unit (`Hz`), shown after the label. |

How it is edited:

| Key | Says |
| --- | --- |
| `widget` | A named input: `csvw-table`, `code`, `markdown`, `checklist`. |
| `nullable: true` | A checkbox opens the field. |
| `allowCustom: true` | An enumeration that also takes free text. |
| `expression: true` | FEEL. Goes with `type: bpmn:Expression` and `xml: {serialize: xsi:type}`. |
| `codeEditorLanguage` | The sibling attribute that holds the language of the `code` widget. |
| `icon` | On an event's attribute: a glyph drawn on the event when the attribute has a value. |

## Attribute precedence

An attribute lives in one place:

1. on the element, when the element's own type or a trait declares it;
2. else on the wrapper, when the wrapper declares it;
3. else on the element, under its local name.

A wrapper is not the BPMN element it attaches to, so no trait on that element reaches it. `redefines` of a BPMN
property therefore belongs on a trait, never on a wrapper.

## Enumerations

```yaml
enumerations:
  - name: RestEyesEnum
    description: Eye condition during a rest period.
    literalValues:
      - name: Eyes open       # the label shown
        value: open           # what the file stores
      - name: Eyes closed
        value: closed
```

Another schema adds values to an enumeration by extending it:

```yaml
enumerations:
  - extends: studyflow:ActorTypeEnum
    literalValues:
      - name: Large language model
        value: llm
```

## Templates

A template is a ready-made piece of a study the Add panel offers, drawn as what it drops. Prefer one over a new
type: "fit a model" is a template over a service task, not a type.

```yaml
templates:
  - description: Filter EEG data and remove artifacts in one step.
    elements:
      EEGPrep:
        type: ServiceTask
        name: EEGPrep
        icon: iconify tabler--wave-sine
```

`elements` is spelled as in a `.studyflow.yaml` file. The first element is the one dropped, and names the template.

## Conventions

- A description is one sentence of 90 characters at most. Notes for maintainers go in YAML comments.
- Quote a description that holds a colon followed by a space.
- A unit goes in `meta.unit`, never in the name: `samplingRate`, not `samplingRateHz`.
- Name the schema's own types bare (`type: DeviceEnum`) and another schema's with its prefix (`studyflow:Dataset`).
- Reuse a core type by inheritance rather than restating its fields.
- A reference to software, a model or a device is `<scheme>://<ref>`.
- A placeholder in a value is `{name}` ([Placeholders](../docs/reference.qmd#placeholders)); an expression is FEEL ([Expressions](../docs/reference.qmd#expressions)).
- An icon is an Iconify class from a set `assets/css/app.css` loads: `tabler`, `lucide` or `mdi`, else `ph` at its regular weight.

## Checking a schema

- The first line of the file lets an editor check moddle's keys as you type.
- A schema that fails to load is listed in Settings, Extensions with its error, and the app starts without it.
- `npm run test:unit -- schemas` checks the shipped schemas: their names, versions, descriptions, defaults and templates.

`AttributeMeta` and `TypeMeta` in `packages/core/src/notation/types.ts` list every `meta` key the app reads.

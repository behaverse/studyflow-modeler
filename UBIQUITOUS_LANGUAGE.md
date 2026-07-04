# Ubiquitous Language

The shared domain vocabulary for the Studyflow Modeler — a tool to design (`app.html`) and run (`run.html`) cognitive-experiment workflows expressed as Studyflows. Use these terms exactly; the tables list the canonical word and the aliases to avoid. Keep the definitions free of implementation detail.

## Workflow & schema

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Studyflow** | An experimental research workflow notation; its serialized form is a `.studyflow` YAML file, folded to/from BPMN 2.0 XML on the wire. | study, flow, workflow, process, diagram |
| **Schema** | A moddle YAML file that extends the BPMN 2.0 metamodel with the domain-specific types, attributes, and enumerations available to a Studyflow. | metamodel, model definition, ontology |
| **Catalog** | The compiled, queryable form of the loaded schemas — the single source of what the app knows about types and attributes. | registry, type system |
| **Attribute** | A named, catalog-declared property of an element, independent of where its value is stored. | property, field, prop |
| **Extension** | Schema-defined data attached to an element, in one of two storage styles below. | plugin, addon |
| **Wrapper** | An extension stored as its own element inside `<bpmn:extensionElements>`. | container |
| **Trait** | An extension whose attributes mix straight onto the business object. | mixin |

## Element representations

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Business object** | The raw, untyped moddle object underneath a diagram element — the thing that serializes to BPMN XML. | BO (in prose), moddle element, node |
| **Element** | A bpmn-js canvas shape in the modeler, holding a business object on `.businessObject`; exists only in the modeler. | shape, node, widget |
| **StudyflowElement** | A catalog-aware handle to one element's attributes that resolves reads and writes across business-object, wrapper, and trait storage. | element wrapper, attribute accessor, facade |
| **Flow node** | The runner's runtime view of a traversable element (start, task, gateway, end), holding a business object plus its edges. | step, stage, node |

## Bot execution

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Bot** | The agent that answers on the participant's behalf during a Behaverse task — an LLM or a uniform-random chooser. | agent, simulator, responder |
| **Provider** | An LLM backend a bot can call: `claude` (local proxy to the Claude CLI) or `ollama` (local server). | backend, model host, vendor |
| **Response source** | How a bot decides a trial: `internal`, `external`, or `llm`. | mode, strategy |

## Apps

| Term | Definition | Aliases to avoid |
| --- | --- | --- |
| **Modeler** | The visual editor app (`app.html`); the only place bpmn-js elements exist. | editor, canvas app |
| **Runner** | The execution app (`run.html`) that parses a Studyflow into flow nodes and walks it; has no bpmn-js elements. | player, executor |

## Relationships

- A **StudyflowElement** wraps exactly one **Business object**; both the **Modeler** (via an **Element**) and the **Runner** (via a **Flow node**) obtain one through their own entry point.
- An **Element** exists only in the **Modeler**; the **Runner** never holds one.
- The **Catalog** is compiled from one or more **Schemas**.
- An **Attribute** is declared by a **Schema** and stored either on the **Business object**, in a **Wrapper**, or as a **Trait**.
- A **Bot** uses at most one **Provider**, chosen per its **Response source**.

## Example dialogue

> **Dev:** "In the exporter I've got a **business object** — can I just read `samplingRate` off it?"

> **Domain expert:** "Not directly — that value might live in a **wrapper**, so reading the raw **business object** misses it. Wrap it in a **StudyflowElement** first; that resolves **wrapper** and **trait** storage for you."

> **Dev:** "Same handle the inspector uses?"

> **Domain expert:** "Same type, different door. The **modeler** builds one from an **element** with `fromElement`, so it can write through bpmn-js. The exporter and the **runner** only have a bare **business object**, so they use `fromBusinessObject`."

> **Dev:** "And the **runner** never touches an **element**?"

> **Domain expert:** "Right — the **runner** has no bpmn-js at all. It parses the Studyflow into **flow nodes**, each holding a **business object**. No canvas, no **elements**."

## Flagged ambiguities

- **"element" was overloaded four ways** — the bpmn-js canvas shape, the raw moddle **business object**, the runner's **flow node**, and the new **StudyflowElement** handle. Resolution: reserve bare **Element** for the bpmn-js shape only; use **Business object** for the raw moddle object, **Flow node** for the runner's view, and **StudyflowElement** for the catalog-aware handle.
- **"bpmn-js element" as the canonical input was wrong** — the **Runner** has no bpmn-js **elements**, so they can't be the shared currency. Resolution: the **Business object** is the single canonical currency; the **Modeler** unwraps its **Element** at the seam.
- **"read-only" mischaracterized the runner-side handle** — default stamping at element creation writes to a fresh **business object** with no bpmn-js. Resolution: the split is not read-vs-write but *which writer* the handle carries (a bpmn-js-backed writer vs a direct one).
- **Provider config carried both endpoints at once** — the type couldn't say which **Provider** was live. Resolution: a discriminated union keyed on **Provider**, carrying only the active provider's endpoint.

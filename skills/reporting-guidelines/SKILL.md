---
name: reporting-guidelines
description: "Reporting guidelines for a study: the documents they ask for, drawn from the diagram (CONSORT 2025's participant flow, SPIRIT 2025's schedule of enrollment, interventions and assessments). Use when a study is reported under a guideline, or when adding a guideline."
license: MIT
metadata:
  schema: "reporting.moddle.yaml"
  modeler: "modeler.ts"
---

A reporting guideline asks a study for documents its diagram already holds. This skill draws them from the diagram,
each in the form its guideline gives it, and the modeler lists them in its Reporting Diagram view ("View as Reporting
Diagram..."), where one is shown and saved as an SVG. A document reads the study and writes nothing to it, so it
cannot drift from the diagram, and its counts are the last run's (`state._meta.reached`, 0 before any run).

| Guideline | Document | Read off |
| --- | --- | --- |
| CONSORT 2025 | Participant flow | the allocation gateway, the paths out of it, the exits drawn on them, and the counts |
| SPIRIT 2025 | Schedule of enrollment, interventions and assessments | the onsets and durations the Schedule view charts, and the lanes |

The skill is optional, like every skill but `studyflow`: switched off in Settings, Extensions, its documents leave the
view (and the command with the last of them) and its one attribute leaves the inspector.

## The participant flow

`modeler/participantFlow.ts` reads who entered, who left and where, and who came to the end. It is no guideline's
own: CONSORT words and draws it (`modeler/consort.ts`), and another guideline's flow can word the same reading.

- The allocation gateway is the one whose schema type draws its branch (`meta.branching: random`,
  `cognitive:RandomGateway`), and each flow out of it is an arm, named as the flow is. A study with none has no
  participant flow.
- Before it, whoever takes a way out that cannot come to the gateway was excluded. The reason is the name of the flow
  taken, else of the event, else of the end it leads to; at a gateway with the `screening` role
  (`cognitive:EligibilityGateway`) it is CONSORT's "Not meeting inclusion criteria", with the criterion when the
  gateway lists exactly one.
- After it, a participant leaves through a boundary event whose path never comes to a plain end event, or along a flow
  into an error end event. Such an exit counts as what its `attrition` says; unsaid, a timer is a loss to follow-up
  and anything else a discontinuation.
- An arm's exits are those on the path it alone takes. Past where the arms' paths join, exits are counted for all
  arms together, as the diagram counts them.
- Who received an arm's intervention is who started the arm's first activity, less those turned away from it
  (`not-received`); who was analyzed is who followed a flow into a plain end event.

## The schedule

`modeler/spirit.ts` reads the rows the Schedule view charts (`collectScheduleRows`), so the table and the chart agree.

- A column is a visit: the onset of an element that sits directly in its process, or of the sub-process holding it, so
  the tasks of a session are marked at the session. Allocation takes a column of its own, where what is scheduled
  before the gateway ends.
- A study period is a lane, over the columns of the elements in it, named as the diagram names it.
- A row is a scheduled element, under enrollment when it comes before the allocation gateway, under interventions when
  only one arm does it, under assessments when it is a task or a questionnaire (the `instrument` role), and otherwise
  under the lane it sits in.
- A wait (a timer event) is no visit. It is drawn as a bar from the visit before it to where it ends, and an
  intervention that lasts over later visits as a bar across them.

## The vocabulary

`reporting.moddle.yaml` adds one attribute, for what a drawing cannot say. A boundary event or an end event takes
`attrition`: `not-received`, `lost-to-follow-up`, `discontinued` or `excluded-from-analysis`, CONSORT's four ways out
after allocation.

```yaml
    Refused:
      type: BoundaryEvent
      attachedTo: $Training
      error: true
      attrition: not-received
```

## Adding a guideline

A guideline is one module, and nothing outside this folder names it.

1. Write `modeler/<guideline>.ts`, exporting a `Guideline` (`modeler/guideline.ts`): its name and edition, and one
   entry per document, whose `draw` returns the SVG or the sentence saying why the open study has none. Read the study
   through what is here (`participantFlowOf`, the Schedule view's rows) before reading it anew, and draw with
   `modeler/svg.ts`, so every document wears one ink and measures text the same.
2. List it in `modeler/guidelines.ts`. The view shows its documents in that order.
3. Where it needs something only the author knows, add it to `reporting.moddle.yaml`: a literal on `AttritionEnum`, or
   an attribute on a trait. A guideline gets no element type of its own.
4. Give it an example in `examples/` and a row in `tests/reporting-documents.unit.spec.ts`, whose sweep already draws
   every document on every shipped example.

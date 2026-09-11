---
name: drawio
description: "Exports the diagram as a draw.io file (.drawio), drawn with draw.io's own BPMN shapes. Use when a study's diagram has to be edited or shown in draw.io."
license: MIT
metadata:
  modeler: "modeler.ts"
---

Export only. The modeler's Save dialog offers `.drawio`: the shapes and flows on screen, where the
canvas has them, styled from draw.io's BPMN palette (`mxgraph.bpmn.*`). Drilled into a container,
the export is that container's contents; a collapsed container's contents stay out. Nothing reads
a `.drawio` back, so the studyflow itself stays the source.

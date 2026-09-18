---
name: drawio
description: "Exports the diagram as a draw.io file (.drawio) and as an editable SVG carrying it, drawn with draw.io's own BPMN shapes. Use when a study's diagram has to be edited or shown in draw.io, or made into a manuscript figure."
license: MIT
metadata:
  modeler: "modeler.ts"
---

Export only. The modeler's Manuscript view offers two: `.drawio`, and an editable `.svg` carrying
that same draw.io file in its `content` attribute (and the BPMN in its metadata), which is the
figure a manuscript takes. Both are the shapes and flows on screen, where the canvas has them,
styled from draw.io's BPMN palette (`mxgraph.bpmn.*`). Drilled into a container, the export is that
container's contents; a collapsed container's contents stay out. Nothing reads a `.drawio` back, so
the studyflow itself stays the source.

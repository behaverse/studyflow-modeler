---
name: nidm
description: "Exports a studyflow's data operations and data elements as NIDM-Results provenance in Turtle (.nidm.ttl). Use when a study's analysis provenance has to be shared as NIDM or PROV."
license: MIT
metadata:
  modeler: "modeler.ts"
---

Export only. Each data element becomes a `prov:Entity` and each data operation a `prov:Activity`
that `prov:used` its inputs; its outputs were `prov:wasGeneratedBy` it. Nothing reads the Turtle
back.

---
name: eeg
description: "Biosignal recording, preprocessing, and analysis steps as a BPMN extension (recordings, montages, epochs, fits). Use when a study records or analyses EEG or similar timeseries."
license: MIT
metadata:
  schema: "eeg.moddle.yaml"
  modeler: "modeler.ts"
---

Vocabulary, and the one to copy when starting a new skill: inheritance from core types,
wrappers, enums, roles, and implementation-bound templates. Its `modeler.ts` adds the ARTEM-IS
export (`.artemis.json`), an EEG methods report drawn from the diagram's acquisition, signal, and
instrument elements. Nothing executes these elements yet.

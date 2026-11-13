---
name: eeg
description: "Biosignal recording, preprocessing, and analysis steps as a BPMN extension (time series, event tables, BIDS datasets, recordings, montages, epochs, fits). Use when a study records or analyses EEG or similar timeseries."
license: MIT
metadata:
  schema: "eeg.moddle.yaml"
  modeler: "modeler.ts"
---

A vocabulary-only skill: nothing executes its elements yet. `eeg.moddle.yaml` is also the schema to copy when
starting a new skill, since it shows inheritance from core types, wrappers, enums, roles, and implementation-bound
templates.

## In a study

A session is a pool that names its device, montage and reference:

```yaml
Pool_Session:
  name: EEG session
  process: $Session
  extensions:
    eeg:Session:
      device: brainproducts_actichamp
      modalities:
        - eeg
      montage: 10-20
      reference: cz
      lineFrequency: "50"
```

The palette's "EEG session" drops such a pool with its flow: fit the cap, record a baseline, run a task, export.

## Exports

`modeler.ts` adds two exports to the modeler.

| Export | File | Drawn from |
| --- | --- | --- |
| ARTEM-IS, an EEG methods report | `.artemis.json` | the diagram's acquisition, signal, and instrument elements |
| NIDM-Results, the neuroimaging data model's provenance | `.nidm.ttl` | the diagram's data operations |

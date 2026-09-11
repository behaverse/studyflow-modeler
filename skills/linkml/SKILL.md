---
name: linkml
description: "Exports a LinkML schema (.linkml.yaml) for a studyflow's data elements, one class each, their schema attributes as LinkML attributes. Use when a study's data needs a LinkML description."
license: MIT
metadata:
  modeler: "modeler.ts"
---

Export only. Each data element (a schema, dataset, table, timeseries or event) becomes a class
whose `class_uri` is its studyflow type and whose attributes are the type's declared properties,
ranged by their schema types. Nothing reads the schema back.

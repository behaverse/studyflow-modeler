---
name: python
description: "Executes elements whose implementation is a python:// entry point, with the study's dependencies installed. Use when a diagram calls Python functions for its data or analysis steps."
license: MIT
compatibility: "Local runtime with uv."
metadata:
  schemes: "python"                  # the <scheme>:// references its runners execute
  runtimes:
    local: "uv run --script local.py"
---

A runner-only skill for the core vocabulary: any element with `implementation: python://<module>.<callable>`
is claimed and called with its inputs, in an environment holding the study's `dependencies`. Its
`additionalArguments` mapping holds the call's keyword arguments (`args` the positional ones). An argument that is one
[placeholder](../../docs/reference.qmd#placeholders), `{split.train}`, passes the value it cites rather than its text.
A data element's `uri` says how its value is loaded and saved, by the `format` it declares or its suffix:
`parquet`, `csv`, `json`, `joblib`, and `jsonl`, one JSON record per line, which loads as a flat table (a nested
key becomes an `a.b` column, so `context.subject` groups) and saves with `orient="records"`. A `csv` whose bound
`studyflow:Schema` gives a CSVW column a `separator` reads that column's cells as lists (`left right` with
`separator: " "` is `["left", "right"]`), as CSVW reads a list-valued cell. One record, a mapping,
written to a `jsonl` data store (a `Dataset`) is appended to it as a line, as a trial log grows: a step that runs once
per subject, in a pool of several instances or a loop, leaves one line per subject, and the store's value stays the
file, every line of it, rather than that record. Before its first line such a store, one a step of the study writes,
reads as a table with no row and the columns of the `studyflow:Schema` bound to it (CSVW `tableSchema.columns`), so
a step that matches or groups on them finds nothing rather than failing; a missing store no step writes is a boundary
input, and fails as one.
A version after `@` pins the implementation, `python://sklearn.svm.SVC@1.7`: the distribution that provides its
top-level module (for the standard library, Python itself) must be installed at a version whose components start
with the pin's, so `1.7` holds for 1.7.2 and not for 1.70. A mismatch, or no metadata to compare, fails the step
with a message naming both. A step that runs hands back what provided its implementation, for the record only
([the contract](../../packages/runtime-local/CONTRACT.md)): `record: {"version": "scikit-learn 1.7.2"}`, null when no metadata names one. A call that
raises `KeyError` for a column the step names and a DataFrame it received lacks fails with
`reads column 'X', which the table does not have (closest: 'Y')`.
An output edge's `transformation` reads a table's column by name before an attribute, so
`{statistic: result.T[1], pvalue: result.p_unc[1]}` takes the numbers a decision reads from the one-row table a test
returns; `examples/within_subject_tests.studyflow.yaml` decides one question by p and one by a Bayes factor this way.
`test_local.py` is its self-check.

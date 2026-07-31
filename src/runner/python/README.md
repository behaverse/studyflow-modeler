# Python runner

A small Python program that executes a studyflow, here to keep one claim
honest: **a studyflow is executable as it stands.** No companion script tells
the engine what the boxes mean — the picture is the program, and this reads it.

It sits beside the browser runner in `src/runner/`, which drives the
participant-facing half of the notation (cognitive tasks, questionnaires, human
suspension). This one runs the analysis half: steps bound to software. They read
the same files.

It runs the shipped `sklearn_pipeline` example straight out of its
`.studyflow.png`, because that file *is* the studyflow (the modeler embeds the
source in the image on export; the double extension marks the image as a
source file, the `.drawio.png` convention):

```bash
uv run studyflow_run.py ../../assets/examples/sklearn_pipeline.studyflow.png
```

One command, no setup. Dependencies are declared in the script header (PEP 723)
and `uv` resolves them per run; the example's input table is materialized on
first read (see [Boundary inputs](#boundary-inputs)). The script is executable
too — `./studyflow_run.py <studyflow>` works, through a
`#!/usr/bin/env -S uv run --script` shebang.

The runner's own dependency is `pyyaml`. The others — pandas, scikit-learn,
joblib, matplotlib — are what *this example's steps* import when the runner
calls them, declared in the header so the command above needs no arguments. A
studyflow naming other software brings its own:

```bash
uv run --with torch --with transformers studyflow_run.py my_pipeline.studyflow.png
```

Every run gets its own directory, named for when it started, and everything it
writes lands in there:

```
runs/20260730T075532Z/
  sklearn_pipeline.studyflow.png    the studyflow that ran, copied in, its trail stamped `executed`
  digits.csv                   the boundary input it read, copied in
  cv_fold_metrics.csv          ┐
  cv_metric_summary.csv        │
  digits_pca_svc.joblib        ├ the five artifacts its `uri`s name
  holdout_metrics.csv          │
  confusion_matrix.png         ┘
  studyflow.log                what the run did, in order
```

The directory is named for the run, so the files in it are not — `studyflow.log`
is a name you can hardcode in a pipeline. A second run is a second directory
rather than five overwritten files. `--runs-dir` moves the parent, `--run-id`
names the directory something other than the timestamp.

Everything the run touched is in there, the plan and the inputs included, so the
directory answers for itself: it is a complete, self-contained record of one run
that you can archive, deposit, or hand to a reviewer.

The run prints the walk as it goes:

```
sklearn pipeline
  ○ Start
  ▣ Prepare
    ○ Prepare_Start
    ▸ Select_Features
        prepare digits.csv  483.8 KB, a boundary input this studyflow ships
        load digits.csv  csv, 483.8 KB → pandas.DataFrame 1797×65
        self ← digits.csv  pandas.DataFrame 1797×65
        implementation python://pandas.DataFrame.drop
        features ← result  pandas.DataFrame 1797×64
    ▸ Select_Target
        self ← digits.csv  pandas.DataFrame 1797×65
        implementation python://pandas.DataFrame.get
        target ← result  pandas.Series 1797
    ▸ Split
        * ← features  pandas.DataFrame 1797×64
        * ← target  pandas.Series 1797
        stratify ← target  pandas.Series 1797
        implementation python://sklearn.model_selection.train_test_split
        x_train ← result[0]  pandas.DataFrame 1347×64
        x_test ← result[1]  pandas.DataFrame 450×64
        y_train ← result[2]  pandas.Series 1347
        y_test ← result[3]  pandas.Series 450
    ■ Prepare_End
  ▣ Select
    ○ Select_Start
    ▸ Build_Pipeline
        implementation python://sklearn.pipeline.make_pipeline
        estimator ← result  sklearn.pipeline.Pipeline[2]
    ▸ Cross_Validate
        estimator ← estimator  sklearn.pipeline.Pipeline[2]
        X ← x_train  pandas.DataFrame 1347×64
        y ← y_train  pandas.Series 1347
        implementation python://sklearn.model_selection.cross_validate
        cv_scores ← result  dict[6]
    ▸ Build_Fold_Report
        data ← cv_scores  dict[6]
        implementation python://pandas.DataFrame
        CV fold metrics ← result  pandas.DataFrame 5×6
        save cv_fold_metrics.csv  csv, 675 B
    ▸ Summarize_CV
        self ← CV fold metrics  pandas.DataFrame 5×6
        implementation python://pandas.DataFrame.describe
        CV summary report ← result  pandas.DataFrame 8×6
        save cv_metric_summary.csv  csv, 982 B
        mean_cv_accuracy ← result.test_accuracy['mean']  float 0.9888668594244804
    ■ Select_End
  ◆ Good_Enough
      mean_cv_accuracy >= 0.90 → Flow_Gate_Report
  ▣ Report
    ○ Report_Start
    ▸ Fit_Model
        self ← estimator  sklearn.pipeline.Pipeline[2]
        X ← x_train  pandas.DataFrame 1347×64
        y ← y_train  pandas.Series 1347
        implementation python://sklearn.pipeline.Pipeline.fit
        Fitted pipeline ← result  sklearn.pipeline.Pipeline[2]
        save digits_pca_svc.joblib  joblib, 161.4 KB
    ▸ Predict_Test
        self ← Fitted pipeline  sklearn.pipeline.Pipeline[2]
        X ← x_test  pandas.DataFrame 450×64
        implementation python://sklearn.pipeline.Pipeline.predict
        predictions ← result  numpy.ndarray 450
    ▸ Score_Test
        y_true ← y_test  pandas.Series 450
        y_pred ← predictions  numpy.ndarray 450
        implementation python://sklearn.metrics.classification_report
        test_metrics ← result  dict[13]
    ▸ Write_Test_Report
        data ← test_metrics  dict[13]
        implementation python://pandas.DataFrame
        Held-out metrics report ← result  pandas.DataFrame 4×13
        save holdout_metrics.csv  csv, 680 B
    ▸ Plot_Confusion
        y_true ← y_test  pandas.Series 450
        y_pred ← predictions  numpy.ndarray 450
        implementation python://sklearn.metrics.ConfusionMatrixDisplay.from_predictions
        Confusion matrix (figure) ← result.figure_  matplotlib.figure.Figure
        save confusion_matrix.png  png, 51.0 KB
    ■ Report_End
  ■ Done_Promoted
  → runs/20260730T230224Z/ (ok) in 1081.2ms
```

Each binding says what it carried, by type and shape, so the data narrows in
front of you: 1797×65 in, 64 feature columns after the drop, 1347 rows to train
on and 450 held back.

The order is the point. `train_test_split` runs before anything looks at the
data, cross-validation sees the training half only, and every number in
`holdout_metrics.csv` and `confusion_matrix.png` comes from predicting the test
quarter once — nothing is scored on data it was fitted on.

The run directory's `digits_pca_svc.joblib` is a real fitted
`Pipeline(PCA(n_components=16), SVC(C=1))` — load it with joblib and it
predicts. On the digits data the five training folds mean about 0.989 accuracy,
so the gate promotes, and the held-out quarter comes out at 0.989 too (445 of
450 correct, which is what the confusion matrix shows). Raise the threshold
above the CV mean and the run ends at "CV reports stored; test set untouched"
instead — with the held-out data unread, which is the state you want to be able
to go back from.

That the two numbers agree is worth a note, because an earlier version of this
example scored 0.963 in cross-validation. It cross-validated the *whole*
dataset, and `load_digits` returns its rows in a near-sorted order that
`StratifiedKFold` does not shuffle, so the folds were unrepresentative. The
split now shuffles before anything is fitted, which is both the correct
methodology and why the training-fold estimate finally agrees with the held-out
result.

## The words

Everything the runner writes is named the way the modeler names it. A field is
the BPMN or studyflow attribute the runner actually read, never a word invented
here for the same thing — so a record or a log line is checkable against the
inspector panel that authored it:

| The runner writes | Because the studyflow says |
|---|---|
| `implementation python://…` | `implementation` is BPMN's own attribute, redefined by the studyflow schema with the `scheme://ref[@version]` grammar |
| `transformation`, its body `slot = selection` | the association's one expression (BPMN's own element), verbatim — the slot names where the value goes, the selection what value arrives |
| `additionalArguments` | that attribute verbatim, whose reserved `args` key holds the positional ones |
| `conditionExpression`, `sequenceFlow.taken` | the `conditionExpression`s on a gateway's outgoing `bpmn:sequenceFlow`s, and the one it took |
| `uri`, and the format beside it | the `Artifact` trait's one field; `format` is the element's own (or the uri's extension), resolved at run time |
| `state.trace` | the engine's own run state — the ordered walk, the thing a condition reads (`state.trace.count('Gate') < 8`) |
| `action` / `when` / `who` / `with` / `run` / `seed` on a `prov:activity` | the provenance trail's own attributes (the modeler's `prov` schema), stamped as read |

## The log

`studyflow.log` is plain text through Python's own `logging`: one line per
event, `time level event message` — the layout `logging`'s own defaults produce
and that log4j, logback, and Nextflow's `.nextflow.log` all settled on. The date
is in the directory name rather than on every line, so the columns stay narrow
enough for the message to carry the walk's indentation and still fit:

```
23:02:24.574 INFO  dataInputAssociation.bound            stratify ← target  pandas.Series 1797
23:02:24.610 INFO  implementation.resolved               implementation python://sklearn.model_selection.train_test_split
23:02:24.616 INFO  dataOutputAssociation.bound           x_train ← result[0]  pandas.DataFrame 1347×64
23:02:24.616 DEBUG activity.finished                     Split done in 41.7ms
23:02:24.986 INFO  gateway.reached                 ◆ Good_Enough
23:02:24.986 DEBUG conditionExpression.evaluated       mean_cv_accuracy >= 0.90 → True  [Flow_Gate_Report]
23:02:24.986 INFO  sequenceFlow.taken                  mean_cv_accuracy >= 0.90 → Flow_Gate_Report
```

It is one log, meant for eyes and `grep`: what each step bound, by type and
shape, is in the message because a person reading the file wants it — and so
is whatever the step printed: a called function's own stdout/stderr passes
through to the terminal live and lands in the file as `stdout`/`stderr`
events, so a run in a terminal and the log afterwards tell the same story. The
*whole* record of a run is the directory itself — the log for what happened in
order, the artifacts for what came out, and the stamped studyflow copy for who
ran what, when.

The `event` column is the grep handle, and its names are the notation's nouns:

| Event | Emitted when |
|---|---|
| `run.started`, `run.finished`, `run.failed` | the walk begins, the run directory is complete, the run dies |
| `activity.started`, `activity.finished`, `activity.failed` | a task or sub-process is entered, leaves, or raises |
| `implementation.resolved`, `implementation.missing` | the step's software is imported, or the step names none |
| `dataInputAssociation.bound`, `dataOutputAssociation.bound` | one argument is filled, one return value lands |
| `activity.skipped` | a recorded step's artifacts were loaded instead of re-computed (see partial re-runs) |
| `artifact.prepared`, `artifact.loaded`, `artifact.saved` | a boundary input is materialized, read, or a result written |
| `gateway.reached`, `conditionExpression.evaluated`, `sequenceFlow.taken`, `gateway.stuck` | the branch, and what decided it |
| `event.reached` | a start, intermediate, or end event |
| `stdout`, `stderr` | what the step itself printed, captured line by line (file only; the terminal already showed it live) |

So the questions you actually ask are one `grep` each:

```bash
grep artifact.saved      runs/*/studyflow.log     # what was written, and how big
grep sequenceFlow.taken  runs/*/studyflow.log     # which way every branch went
grep -E 'ERROR|WARNING'  runs/*/studyflow.log     # what went wrong, with the traceback under it
grep ' 0×'               runs/*/studyflow.log     # any step that bound an empty frame
```

The run directories are named with a sortable UTC stamp (ISO 8601 basic), so
`runs/*/studyflow.log` walks every run in the order they happened. `--quiet`
silences the terminal and never the file — a log you have to remember to ask for
is not a log. The console gets the tree above; the file additionally gets the
`DEBUG` events (per-step durations, conditions that did not hold, the plan digest
and seed on its second line).

If you ever need these lines in a collector rather than a file, add a handler
rather than change the format — `logging.handlers.SysLogHandler` and the OTLP
exporters both take the same records. Routing everything through `logging` is
what makes that a few lines instead of a rewrite.

## The trail

The run's provenance is the studyflow's own: a **provenance trail** of flat
`<prov:activity>` elements on the primary root (the modeler's `prov` schema —
`action`, `when`, `who`, `with`), one line per event in the file's life,
carried inside the document wherever it goes. A run is such an event, so this
runner stamps the trail like any other tool — one `executed` line naming who
ran it and which run directory holds the artifacts and the log:

```xml
<bpmn:extensionElements>
  <prov:activity action="created" when="2026-07-30T22:24:02Z" with="studyflow-modeler/26.0615" />
  <prov:activity action="executed" when="2026-07-30T22:18:41Z" who="morteza"
                 with="studyflow_run.py" run="20260730T221841Z" seed="42" />
</bpmn:extensionElements>
```

The stamp lands on the in-memory plan and therefore on the copy archived in
the run directory — never on the input file. So the copy answers the reviewer's
first questions by itself: open it and the diagram is the plan that ran; read
its trail and the last line is the run it came from, `run` naming the directory
around it. The log's second line pins the plan's sha256, computed *after* the
stamp, so the digest it states is true of the copy sitting beside it.

`seed` is the run's root seed — the plan's pinned `studyflow:seed` when it has
one, drawn once when it does not, and injected into `random` (and numpy) either
way. Recording it on the stamp is what makes an unpinned run replayable.

Everything the run touched is in the directory — the stamped plan, the inputs,
the artifacts, the log — so it is a complete, self-contained record of one run
that you can archive, deposit, or hand on.

### Partial re-runs

A run also records itself *per element*: every activity it completed gets its
own `executed` entry (`when`, `run`) in that element's `extensionElements` on
the archived copy. Re-running the copy is therefore incremental:

```bash
uv run studyflow_run.py runs/<id>/sklearn_pipeline.studyflow.png --workdir runs/<id>
```

A step is **skipped** — its artifacts loaded instead of re-computed — when its
record is present and every one of its outputs is an artifact (`uri`) still on
disk; a step with a memory-only output always re-runs. So the invalidation
gestures are exactly the ones you'd guess: delete an artifact and its producer
re-runs; delete an element's `executed` entry and that step re-runs; edit the
plan and re-run only what the edit touches downstream of. Skipped elements keep
the record of the run that really produced their artifacts, so the copy stays a
truthful patchwork of which run made what. `--fresh` ignores every record and
re-runs the whole flow.

## Boundary inputs

A *boundary input* is an artifact a run reads and no step of it produces — by
definition, something outside the studyflow put it there. The notation does not
say how, and should not: an engine that could invent a study's input data would
be guessing at the science.

`sklearn_pipeline` has one, `digits.csv`, and takes it as an external table
rather than a call to a bundled sample-data loader on purpose: the same
studyflow runs on a real study dataset by changing one `uri`. So that the
one-command claim above holds anyway, the runner ships a maker for that one
file — `BOUNDARY_INPUTS`, keyed by the `uri` the example's own data element
declares — and calls it the first time the artifact is read and missing,
logging `artifact.prepared` when it does. It writes scikit-learn's copy of the
UCI hand-written digits set: 1797 rows, 64 pixel columns and a `target`.

Inputs are **staged into the run directory before they are read**, so the run
directory is the single root every `uri` resolves against — the paths the
provenance records are valid there by construction, not because something copied
them in afterwards. `--workdir` names only where an input is *looked up* from
(the run directory is fresh, so a boundary input cannot already be in it); once
staged, the run reads it from inside its own directory like everything else.

Any *other* missing boundary input is a plain error naming the file and the
element that wanted it, which is the honest answer. `--no-prepare-inputs` makes
even the shipped one behave that way.

## The contract it implements

Read `studyflow_run.py` — it is one file and the docstring states the contract
before implementing it. In short:

| In the studyflow | At run time |
|---|---|
| `implementation="python://pkg.mod.fn"` | the callable to import; the path may reach into a class, which is how an unbound method becomes a step |
| a data input association | one argument, its slot named by the association's `transformation` body (defaulting to the element's own name) — or, in the standard form the modeler saves, by the `ioSpecification` DataInput it targets |
| the transformation's *selection* | narrows the value: `transformation` body `"X = folds['train']"` on an input, `"result[0]"` on an output. in saved standard form the slot moves into the DataInput's name and the body keeps the pure selection |
| slot `self` | the receiver of an unbound method — bound first and positionally |
| slot `*` | appended to the positional arguments in declaration order, for a callable whose arguments have no names (`train_test_split(*arrays)`) |
| `additionalArguments` | the literal arguments, additional by name and contract — what the call needs beyond the associations that already filled its signature: `args` for positional, a nested mapping with its own `implementation` for a call to make first. A name bound by both a data association and `additionalArguments` is refused rather than silently resolved |
| a data output association | where the return value lands, narrowed by the transformation's selection over `result` |
| `uri` on a data element | an artifact: loaded before its first consumer, written after its producer, in the element's declared `format` or the one its extension implies |
| a `.png` uri | a figure artifact: the plotting step returns scikit-learn's display object, the output transformation narrows it to a matplotlib figure with `result.figure_`, and the format handler calls `savefig`. Nothing about plotting is a notation concept |
| a `.csv` uri | the example's tabular artifacts. A CSV has no schema, so the handler decides what happens to a frame's index: row numbers are dropped, a meaningful index is kept as a leading column (which is why the metric summary names `mean` in its first column), and a CSV read back gives columns rather than that index. Declaring `format: parquet` on the element instead keeps the distinction — and needs `--with pyarrow` |
| no `uri` (i.e. a `bpmn:Property`) | a value that only passes between steps in memory |
| `conditionExpression` on a flow out of a gateway | the branch rule; the gateway's `default` when none holds |
| `state.trace` | the ordered walk so far, so a drawn cycle can bound itself: `state.trace.count('Gate') < 8` |

## What it is not

- **Not a polyglot evaluator.** Expressions are Python or JavaScript, named
  per expression by BPMN's own `language` field on the expression element; one
  without it runs in the evaluating engine's own language. This engine speaks
  Python (a sandboxed `eval` over the run's values) and refuses a `javascript`
  expression at evaluation time — the browser runner is the mirror image.
- **Not a workflow engine.** One token, one process: no parallel gateways, no
  multi-instance fan-out, no retries, no persistence of run state. Those are the
  runner's limits, not the notation's — the notation says what they mean already.
- **Not sandboxed.** It imports and calls what the studyflow names. Run
  studyflows you trust.

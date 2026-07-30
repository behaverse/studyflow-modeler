# Python runner

A small Python program that executes a studyflow, here to keep one claim
honest: **a studyflow is executable as it stands.** No companion script tells
the engine what the boxes mean — the picture is the program, and this reads it.

It sits beside the browser runner in `src/runner/`, which drives the
participant-facing half of the notation (cognitive tasks, questionnaires, human
suspension). This one runs the analysis half: steps bound to software. They read
the same files.

It runs the shipped `sklearn_pipeline` example straight out of its `.png`,
because that file *is* the studyflow (the modeler embeds the source in the image
on export):

```bash
uv run studyflow_run.py ../../assets/examples/sklearn_pipeline.png
```

One command, no setup. Dependencies are declared in the script header (PEP 723)
and `uv` resolves them per run; the example's input table is materialized on
first read (see [Boundary inputs](#boundary-inputs)). The script is executable
too — `./studyflow_run.py <studyflow>` works, through a
`#!/usr/bin/env -S uv run --script` shebang.

The runner's own dependencies are `pyyaml`, plus `prov`/`rdflib` and `rocrate`
— the reference libraries for the two standards it writes, so that "this is
W3C PROV" and "this is an RO-Crate" are checkable rather than claimed. The
others — pandas, scikit-learn, joblib, matplotlib — are what *this example's
steps* import when the runner calls them, declared in the header so the command
above needs no arguments. A studyflow naming other software brings its own:

```bash
uv run --with torch --with transformers studyflow_run.py my_pipeline.png
```

Every run gets its own directory, named for when it started, and everything it
writes lands in there:

```
runs/20260730T075532Z/
  sklearn_pipeline.png         the studyflow that ran, copied in
  digits.csv                   the boundary input it read, copied in
  cv_fold_metrics.csv          ┐
  cv_metric_summary.csv        │
  digits_pca_svc.joblib        ├ the five artifacts its `uri`s name
  holdout_metrics.csv          │
  confusion_matrix.png         ┘
  studyflow.log                what the run did, in order
  provenance.jsonld            what the run was, as W3C PROV
  ro-crate-metadata.json       what the directory is, as a Workflow Run RO-Crate
```

The directory is named for the run, so the files in it are not — `studyflow.log`
is a name you can hardcode in a pipeline. A second run is a second directory
rather than five overwritten files, which is also what keeps the checksums a run
recorded true of the files sitting beside them. `--runs-dir` moves the parent,
`--run-id` names the directory something other than the timestamp.

Everything the run touched is in there, the plan and the inputs included, so the
directory answers for itself: it is a complete, self-contained record of one run
that you can archive, deposit, or hand to a reviewer.

The run prints the walk as it goes:

```
sklearn pipeline (held-out evaluation, PCA, cross-validation)
  ○ Run analysis  [Start]
  ▣ Prepare the data  [Prepare]
    ▸ Select feature columns  [Select_Features]
        prepare digits.csv  483.8 KB, a boundary input this studyflow ships
        load digits.csv  csv, 483.8 KB → pandas.DataFrame 1797×65
        self ← Input dataset (features + target)  pandas.DataFrame 1797×65
        implementation python://pandas.DataFrame.drop
        features ← result  pandas.DataFrame 1797×64
    ▸ Split train / held-out test  [Split]
        * ← features  pandas.DataFrame 1797×64
        * ← target  pandas.Series 1797
        stratify ← target  pandas.Series 1797
        implementation python://sklearn.model_selection.train_test_split
        x_train ← result[0]  pandas.DataFrame 1347×64
        x_test ← result[1]  pandas.DataFrame 450×64
        y_train ← result[2]  pandas.Series 1347
        y_test ← result[3]  pandas.Series 450
  ▣ Select the model  [Select]
    ▸ Cross-validate on training set  [Cross_Validate]
        estimator ← estimator  sklearn.pipeline.Pipeline[2]
        X ← x_train  pandas.DataFrame 1347×64
        y ← y_train  pandas.Series 1347
        implementation python://sklearn.model_selection.cross_validate
        cv_scores ← result  dict[6]
    ▸ Summarize CV metrics  [Summarize_CV]
        save cv_metric_summary.csv  csv, 979 B
        mean_cv_accuracy ← result.test_accuracy['mean']  float 0.9888668594244804
  ◆ Accurate enough?  [Good_Enough]
      mean_cv_accuracy >= 0.90 → promote  [Flow_Gate_Report]
  ▸ Fit on training set  [Fit_Model]
      save digits_pca_svc.joblib  joblib, 161.4 KB
  ▸ Predict held-out set  [Predict_Test]
      implementation python://sklearn.pipeline.Pipeline.predict
      predictions ← result  numpy.ndarray 450
  ▸ Score held-out set  [Score_Test]
      implementation python://sklearn.metrics.classification_report
  ▸ Write held-out metrics report  [Write_Test_Report]
      save holdout_metrics.csv  csv, 680 B
  ▸ Plot confusion matrix  [Plot_Confusion]
      implementation python://sklearn.metrics.ConfusionMatrixDisplay.from_predictions
      Confusion matrix (figure) ← result.figure_  matplotlib.figure.Figure
      save confusion_matrix.png  png, 51.0 KB
  ■ Model promoted and reported  [Done_Promoted]
  → runs/20260730T075532Z/ (ok) in 1150.9ms
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
| `exec:implementation` | `implementation` is BPMN's own attribute, redefined by the `exec` schema with the `scheme://ref[@version]` grammar |
| `studyflow:type "bpmn:ServiceTask"` | the metamodel's spelling, which is what the catalog, the schemas (`extends: bpmn:DataInputAssociation`) and the templates (`type: bpmn:SubProcess`) all use; `serviceTask` is only how the XML tag is written |
| `prov:hadRole` on a `prov:Usage` | the binding's slot — a role on a usage is what PROV already means by a named input, so the slot needed no extension |
| `exec:binding` beside it on the same `prov:Usage` | the association's one binding, verbatim (`slot = selection`) — the role is its resolved slot, the selection is what value filled it |
| `exec:transformation` on a `prov:Generation` | a `bpmn:dataOutputAssociation`'s own `transformation` expression, on the event that produced the value |
| `exec:additionalArguments` | that attribute verbatim, whose reserved `args` key holds the positional ones |
| `studyflow:conditionExpression`, `studyflow:sequenceFlow` | the `conditionExpression`s on a gateway's outgoing `bpmn:sequenceFlow`s, and the one it took — an extension because PROV has no notion of a choice |
| `exec:uri` | the one `exec:Artifact` field; `exec:format` is the element's own `format` (or the uri's extension), resolved at run time |
| `studyflow:visits` | the engine's own run state, the thing a condition reads as `state.visits.<id>` |

## The log

`studyflow.log` is plain text through Python's own `logging`: one line per
event, `time level event message` — the layout `logging`'s own defaults produce
and that log4j, logback, and Nextflow's `.nextflow.log` all settled on. The date
is in the directory name rather than on every line, so the columns stay narrow
enough for the message to carry the walk's indentation and still fit:

```
06:58:17.463 INFO  activity.started                  ▸ Split train / held-out test  [Split]
06:58:17.463 INFO  dataInputAssociation.bound            * ← features  pandas.DataFrame 1797×64
06:58:17.463 INFO  dataInputAssociation.bound            stratify ← target  pandas.Series 1797
06:58:17.501 INFO  implementation.resolved               implementation python://sklearn.model_selection.train_test_split
06:58:17.507 INFO  dataOutputAssociation.bound           x_train ← result[0]  pandas.DataFrame 1347×64
06:58:17.507 DEBUG activity.finished                     Split done in 43.7ms
06:58:18.007 INFO  gateway.reached                 ◆ Accurate enough?  [Good_Enough]
06:58:18.007 DEBUG conditionExpression.evaluated       mean_cv_accuracy >= 0.90 → True  [Flow_Gate_Report]
06:58:18.007 INFO  sequenceFlow.taken                  mean_cv_accuracy >= 0.90 → promote  [Flow_Gate_Report]
```

It is one log, meant for eyes and `grep`. It is deliberately *not* a second
machine-readable copy of the run: what each step bound, by type and shape, is
in the message because a person reading the file wants it, and a program that
wants the same facts as fields reads `provenance.jsonld` beside it, which
carries every one of them structurally. Two files, each good at one thing.

The `event` column is the grep handle, and its names are the notation's nouns:

| Event | Emitted when |
|---|---|
| `run.started`, `run.finished`, `run.failed` | the walk begins, the provenance is written, the run dies |
| `activity.started`, `activity.finished`, `activity.failed` | a task or sub-process is entered, leaves, or raises |
| `implementation.resolved`, `implementation.missing` | the step's software is imported, or the step names none |
| `dataInputAssociation.bound`, `dataOutputAssociation.bound` | one argument is filled, one return value lands |
| `artifact.prepared`, `artifact.loaded`, `artifact.saved` | a boundary input is materialized, read, or a result written |
| `gateway.reached`, `conditionExpression.evaluated`, `sequenceFlow.taken`, `gateway.stuck` | the branch, and what decided it |
| `event.reached` | a start, intermediate, or end event |

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

## The provenance

`provenance.jsonld` is the retrospective half of the studyflow: a `.studyflow`
is a plan, and this is what one run of it did. It is a
[W3C PROV](https://www.w3.org/TR/prov-o/) document — built with
[`prov`](https://pypi.org/project/prov/), PROV's own reference implementation,
so "this is PROV" is checkable rather than claimed. `docs/wip/exec_docs.qmd`
already stated the mapping; this is that mapping made literal:

| In the studyflow | In PROV |
|---|---|
| the `.studyflow` itself | a `prov:Entity` that is also a `prov:Plan`, copied into the run directory so it can be reopened |
| a step execution | a `prov:Activity`, tied to the plan by `prov:wasAssociatedWith` / `prov:qualifiedAssociation` |
| a data element | a `prov:Entity`, whether it is an artifact on disk or a value that only passed between steps |
| a data input association | `prov:used`, qualified as a `prov:Usage` whose `prov:hadRole` is the binding's slot |
| a data output association | `prov:wasGeneratedBy`, qualified as a `prov:Generation` carrying `exec:binding` (the selection over `result`) |
| the flow between two steps | `prov:wasInformedBy` — the walk is one token, so the order is provenance |
| the runner | a `prov:SoftwareAgent` |

Lineage is stated directly as well as derivable, so the ordinary question has
the ordinary answer. Here is the fitted model, in Turtle
(`--prov-format turtle`):

```turtle
run:Fitted_Model a prov:Entity ;
    rdfs:label "Fitted pipeline" ;
    schema:sha256 "a012babe629bad3d5c421975435e8f2448cb8dd73a4f50498c5d131ba3ba032b" ;
    schema:contentSize "165309"^^xsd:int ;
    prov:atLocation "digits_pca_svc.joblib" ;
    exec:uri "digits_pca_svc.joblib" ;
    exec:format "joblib" ;
    prov:wasGeneratedBy run:Fit_Model-17 ;
    prov:wasDerivedFrom run:Estimator, run:X_Train, run:Y_Train ;
    prov:qualifiedGeneration [ a prov:Generation ;
            prov:activity run:Fit_Model-17 ;
            exec:transformation "result" ] .
```

Note `prov:wasDerivedFrom` alongside `prov:qualifiedDerivation`. PROV-O states
every relation two ways — a shortcut and a qualified form that can carry
detail — and means them to coexist, but `prov` writes only the qualified form
once a relation has attributes, and here they all do. So the runner asserts the
shortcuts back; without them, `?e prov:wasDerivedFrom ?f` — the query anyone
would actually write — returns nothing.

Five serializations, all from the same document: `jsonld` (the default: PROV-O
as JSON-LD, both W3C Recommendations, and still JSON), `turtle`, `provn` (the
one to read), `json` (PROV-JSON), `xml` (PROV-XML).

<details>
<summary>The same run in PROV-N, which reads as sentences</summary>

```
entity(run:studyflow, [prov:type="prov:Plan", prov:atLocation="sklearn_pipeline.png",
                       schema:sha256="c304249db417…"])
activity(run:run, 2026-07-30T07:27:41.003+00:00, 2026-07-30T07:27:42.022+00:00,
         [prov:label="one run of the studyflow", studyflow:status="ok", exec:seed="42"])
wasAssociatedWith(run:run, run:runner, run:studyflow)
entity(run:Fitted_Model, [prov:label="Fitted pipeline", exec:uri="digits_pca_svc.joblib",
                          exec:format="joblib", schema:sha256="a012babe…", schema:contentSize=165309])
used(run:Fit_Model-17, run:X_Train, -, [prov:role="X"])
wasGeneratedBy(run:Fitted_Model, run:Fit_Model-17, -, [exec:transformation="result"])
```

</details>

Three things it is careful about:

- **Values are described, never inlined.** A run passes whole tables and fitted
  models between steps, and every one of them is a `prov:Entity` — but recording
  their contents would make the file enormous and duplicate the artifacts. An
  entity carries its type and shape (`studyflow:type`, `studyflow:shape`)
  instead: enough to see that a step received a 1347×64 frame rather than an
  empty one. Artifacts additionally carry `schema:sha256` and
  `schema:contentSize`, which is what makes the run reproducible.
- **It is written when the run fails.** That is when the order of what happened
  matters most: the failing activity carries `studyflow:status "error"` and
  `studyflow:error`, and the entities generated before it are all there. The
  exit code is non-zero, and the traceback goes to the log rather than the
  terminal. A failed step still gets a `prov:endedAtTime` — PROV's end time says
  when an activity stopped, not that it succeeded.
- **Branches are recorded with their reasons.** PROV has no notion of a choice,
  so this is the one place the runner extends rather than maps: a gateway
  activity carries the `studyflow:conditionExpression` it evaluated, whether it
  `studyflow:held`, and the `studyflow:sequenceFlow` it took. An extension where
  PROV is silent, rather than a core term bent to mean something else.

Where the studyflow has a word, it survives into the document under an `exec:`
or `studyflow:` term beside the core PROV ones — so an `exec:uri` in the
provenance is checkable against the inspector panel that authored it.

## The package

`ro-crate-metadata.json` makes the run directory an
[RO-Crate](https://www.researchobject.org/ro-crate/) — specifically a
[Workflow Run Crate](https://www.researchobject.org/workflow-run-crate/), the
profile suite the workflow community built for exactly this, and the one Galaxy,
Nextflow's nf-prov, WfExS and StreamFlow all emit. It is written with
`ro-crate-py`, the RO-Crate community's own library.

Where PROV answers *what came from what*, the crate answers *what is this
directory and how do I hand it on*. They are complementary, and the crate says
so: the PROV document is one of its own listed parts. Because everything a run
touched is inside the directory — the plan, the inputs, the artifacts — the
crate is self-contained and directly depositable to WorkflowHub or Zenodo.

The mapping:

| In the studyflow | In the crate |
|---|---|
| the `.studyflow` | a `ComputationalWorkflow` that is also a `HowTo`, with a `ComputerLanguage` for Studyflow |
| each flow node of the plan | a `HowToStep` with its `position`, whose `workExample` is the tool it runs |
| a step execution | a `CreateAction` whose `instrument` is the `SoftwareApplication` its `implementation` named, with `object` / `result` for what it read and wrote |
| the engine taking that step | a `ControlAction` joining the `HowToStep` to the `CreateAction` — the join Provenance Run Crate asks for |
| a gateway | schema.org's own `ChooseAction`, candidate flows as `actionOption`, the one taken as `result` |
| an artifact | a `File` part with `sha256` and `contentSize` |
| a value with no `uri` | a `PropertyValue` — what it was, never what it held |
| the whole run | one `CreateAction` whose `instrument` is the workflow |

A gateway is the interesting one: schema.org has a verb for choosing, so unlike
PROV — which has no notion of a choice — the crate needs no extension for it.

Each `SoftwareApplication` carries the **version that actually ran**, read from
the installed distribution at run time. RO-Crate requires a version on every one
of them, and here that requirement earns its keep: "which scikit-learn produced
this model" is a question a reader genuinely has, and only the run can answer it.

Conformance is validated, not asserted. With
[`roc-validator`](https://pypi.org/project/roc-validator/):

```bash
uvx --from roc-validator rocrate-validator validate --profile-identifier provenance-run-crate runs/<timestamp>/
```

The shipped example passes `ro-crate-1.1`, `process-run-crate`,
`workflow-run-crate` and `provenance-run-crate` out of the box.

Two notes on versions. The crate is written as **RO-Crate 1.1**, not
`ro-crate-py`'s own default of 1.2, because the Workflow Run Crate profiles are
written against 1.1 and the validator holds them to it — the same crate emitted
as 1.2 passes `ro-crate-1.2` and fails all three run profiles, which are the
reason for writing a crate at all. RO-Crate **1.3** is released, but
`ro-crate-py` does not yet accept it; `--crate-version` takes its choices from
that library's own list, so it will offer 1.3 the day the library does.

RO-Crate also requires the root to state a licence, and the runner does not know
one — a run's outputs carry whatever the studyflow and its input data carry. It
therefore says exactly that, as a `CreativeWork` named "Not asserted"; pass
`--license <url>` to state a real one. `--no-crate` skips the manifest entirely.

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
| a data input association | one argument, its slot named by the association's `binding` (defaulting to the element's own name) — or, in the standard form the modeler saves, by the `ioSpecification` DataInput it targets |
| the binding's *selection* | narrows the value: `binding="X = folds['train']"` on an input, `binding="result[0]"` on an output. The standard form spells the same selection as BPMN's own `transformation`, which the runner reads too |
| slot `self` | the receiver of an unbound method — bound first and positionally |
| slot `*` | appended to the positional arguments in declaration order, for a callable whose arguments have no names (`train_test_split(*arrays)`) |
| `exec:additionalArguments` | the literal arguments, additional by name and contract — what the call needs beyond the associations that already filled its signature: `args` for positional, a nested mapping with its own `implementation` for a call to make first. A name bound by both a data association and `additionalArguments` is refused rather than silently resolved |
| a data output association | where the return value lands, narrowed by the binding's selection over `result` |
| `exec:uri` on a data element | an artifact: loaded before its first consumer, written after its producer, in the element's declared `format` or the one its extension implies |
| a `.png` uri | a figure artifact: the plotting step returns scikit-learn's display object, the output binding narrows it to a matplotlib figure with `result.figure_`, and the format handler calls `savefig`. Nothing about plotting is a notation concept |
| a `.csv` uri | the example's tabular artifacts. A CSV has no schema, so the handler decides what happens to a frame's index: row numbers are dropped, a meaningful index is kept as a leading column (which is why the metric summary names `mean` in its first column), and a CSV read back gives columns rather than that index. Declaring `format: parquet` on the element instead keeps the distinction — and needs `--with pyarrow` |
| no `uri` (i.e. a `bpmn:Property`) | a value that only passes between steps in memory |
| `conditionExpression` on a flow out of a gateway | the branch rule; the gateway's `default` when none holds |
| `state.visits.<id>` | how often the walk reached an element, so a drawn cycle can bound itself |

## What it is not

- **Not a CEL implementation.** Conditions and transformations are declared as
  CEL (`expressionLanguage` on `bpmn:Definitions`). This evaluates them with
  Python's `eval` over a namespace holding only the run's values. That agrees
  with CEL on the expressions studyflows use — comparison, field access,
  indexing — and diverges outside them.
- **Not a workflow engine.** One token, one process: no parallel gateways, no
  multi-instance fan-out, no retries, no persistence of run state. Those are the
  runner's limits, not the notation's — the notation says what they mean already.
- **Not sandboxed.** It imports and calls what the studyflow names. Run
  studyflows you trust.

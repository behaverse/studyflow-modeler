# Python runner

A small Python program that executes a studyflow diagram, here to keep one
claim honest: **a studyflow is executable as it stands.** No companion script
tells the engine what the boxes mean — the diagram is the program, and this
reads it.

It sits beside the browser runner in `src/runner/`, which drives the
participant-facing half of the notation (cognitive tasks, questionnaires, human
suspension). This one runs the analysis half: steps bound to software. They read
the same files.

It runs the shipped `sklearn_pipeline` example straight out of its `.png`,
because that file *is* the diagram (the modeler embeds the source in the image
on export).

```bash
uv run make_inputs.py                                   # writes inputs/digits.csv
uv run studyflow_run.py ../../src/assets/examples/sklearn_pipeline.png
```

There is no environment to set up first: each script declares its own
dependencies in its header (PEP 723), and `uv` resolves them per run. Both are
executable too — `./studyflow_run.py <diagram>` works, through a
`#!/usr/bin/env -S uv run --script` shebang.

Only `pyyaml` is the runner's own dependency. The others — pandas,
scikit-learn, joblib — are what *this example's steps* import when the runner
calls them, declared in the header so the command above needs no arguments. A
diagram naming other software brings its own:

```bash
uv run --with torch --with transformers studyflow_run.py my_pipeline.png
```

which prints the walk and leaves five artifacts plus a run record behind:

```
sklearn pipeline (held-out evaluation, PCA, cross-validation)
  ○ Run analysis
  ▣ Prepare the data
    ▸ Select feature columns  [Select_Features]
        load inputs/digits.csv
        self ← Input dataset (features + target)
        call python://pandas.DataFrame.drop
        features ← result
    ▸ Split train / held-out test  [Split]
        * ← features
        * ← target
        call python://sklearn.model_selection.train_test_split
        x_train ← result[0]
        x_test ← result[1]
        y_train ← result[2]
        y_test ← result[3]
  ▣ Select the model
    ▸ Cross-validate on training set  [Cross_Validate]
      estimator ← estimator
      X ← x_train
      y ← y_train
      call python://sklearn.model_selection.cross_validate
  ▸ Summarize CV metrics  [Summarize_CV]
      save results/cv_metric_summary.csv
      mean_cv_accuracy ← result.test_accuracy['mean']
  ◆ Accurate enough?
      mean_cv_accuracy >= 0.90 → promote
  ▸ Fit on training set  [Fit_Model]
      save results/digits_pca_svc.joblib
  ▸ Predict held-out set  [Predict_Test]
      call python://sklearn.pipeline.Pipeline.predict
  ▸ Score held-out set  [Score_Test]
      call python://sklearn.metrics.classification_report
  ▸ Write held-out metrics report  [Write_Test_Report]
      save results/holdout_metrics.csv
  ▸ Plot confusion matrix  [Plot_Confusion]
      call python://sklearn.metrics.ConfusionMatrixDisplay.from_predictions
      Confusion matrix (figure) ← result.figure_
      save results/confusion_matrix.png
  ■ Model promoted and reported
  → results/run.studyrun (ok)
```

The order is the point. `train_test_split` runs before anything looks at the
data, cross-validation sees the training half only, and every number in
`holdout_metrics.csv` and `confusion_matrix.png` comes from predicting the test
quarter once — nothing is scored on data it was fitted on.

`results/digits_pca_svc.joblib` is a real fitted
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

## The run record

`results/run.studyrun` is the retrospective half of the diagram: a `.studyflow`
is a plan, and this is what one run of it did. The shape is the one specified in
`docs/wip/exec_docs.qmd`, which maps onto [W3C PROV](https://www.w3.org/TR/prov-o/)
— an execution is a `prov:Activity`, an artifact a `prov:Entity`, the plan a
`prov:Plan`:

```yaml
studyflow: sha256:81b7403c…        # pins the exact plan that ran
run: 2026-07-29T21:29:53+00:00/81b7
rootSeed: '42'
status: ok
durationMs: 24649.0
executions:                        # in the order the walk reached them
  - node: Split
    kind: serviceTask
    call: python://sklearn.model_selection.train_test_split
    bindings:                      # what each argument received, by type and size
      '*': {from: Features, type: pandas.DataFrame, shape: [1797, 64]}
      X_Train: {type: pandas.DataFrame, shape: [1347, 64]}
    used: [Features, Target]       # prov:used
    generated: [X_Train, X_Test, Y_Train, Y_Test]
    durationMs: 21.4
  - node: Prepare                    # a phase spans its children
    kind: subProcess
    durationMs: 7100.4
  - node: Good_Enough
    kind: exclusiveGateway
    conditions:
      - {flow: Flow_Gate_Report, expression: mean_cv_accuracy >= 0.90, held: true}
    took: {flow: Flow_Gate_Report, name: promote}
artifacts:
  Fitted_Model:
    uri: results/digits_pca_svc.joblib
    codec: joblib
    bytes: 165309
    digest: sha256:a012babe…
    producedBy: Fit_Model
state: {mean_cv_accuracy: {type: float, value: 0.988…}}
visits: {Good_Enough: 1}
```

Three things it is careful about:

- **Values are described, never inlined.** A run passes whole tables and fitted
  models between steps; recording them would make the file enormous and
  duplicate the artifacts. Each binding is its type and shape instead — enough
  to see that a step received a 1347x64 frame rather than an empty one.
- **It is written when the run fails.** That is when the order of what happened,
  and the state it happened against, is most worth having: the failing step
  carries its `error` with a trimmed traceback, and the artifacts written before
  it are listed. The exit code is non-zero.
- **Branches are recorded with their reasons** — each condition, whether it
  held, and which flow was taken (marked `default: true` when nothing held).

One deviation from the document's sketch: artifacts are keyed by element id with
their digest as a field, rather than keyed by digest. A single run's record is
something a person reads, and `Fitted_Model:` says more at a glance than
`sha256:a012babe…`.

Write it elsewhere with `--run-record <path>` (relative to `--workdir`).

## The contract it implements

Read `studyflow_run.py` — it is one file and the docstring states the contract
before implementing it. In short:

| In the diagram | At run time |
|---|---|
| `implementation="python://pkg.mod.fn"` | the callable to import; the path may reach into a class, which is how an unbound method becomes a step |
| a data input association | one argument, named by `exec:parameter`, defaulting to the associated element's name |
| `exec:parameter="self"` | the receiver of an unbound method — bound first and positionally |
| `exec:parameter="*"` | appended to the positional arguments in declaration order, for a callable whose arguments have no names (`train_test_split(*arrays)`) |
| `studyflow:arguments` | the *additional* arguments, as YAML — what the call needs beyond the associations that already filled its signature: `args` for positional, a nested mapping with its own `implementation` for a call to make first. A name bound by both a data association and `arguments` is refused rather than silently resolved |
| a data output association | where the return value lands; `bpmn:transformation` narrows it as an expression over `result` |
| `exec:uri` on a data element | an artifact: loaded before its first consumer, written after its producer, through `exec:codec` or the extension |
| `exec:codec="png"` | a figure artifact: the plotting step returns scikit-learn's display object, the output association narrows it to a matplotlib figure with `result.figure_`, and the codec calls `savefig`. Nothing about plotting is a notation concept |
| `exec:codec="csv"` | the example's tabular artifacts. A CSV has no schema, so the codec decides what happens to a frame's index: row numbers are dropped, a meaningful index is kept as a leading column (which is why the metric summary names `mean` in its first column), and a CSV read back gives columns rather than that index. Declaring `parquet` instead keeps the distinction — and needs `--with pyarrow` |
| no `uri` (i.e. a `bpmn:Property`) | a value that only passes between steps in memory |
| `conditionExpression` on a flow out of a gateway | the branch rule; the gateway's `default` when none holds |
| `state.visits.<id>` | how often the walk reached an element, so a drawn cycle can bound itself |

## What it is not

- **Not a CEL implementation.** Conditions and transformations are declared as
  CEL (`expressionLanguage` on `bpmn:Definitions`). This evaluates them with
  Python's `eval` over a namespace holding only the run's values. That agrees
  with CEL on the expressions studyflow diagrams use — comparison, field
  access, indexing — and diverges outside them.
- **Not a workflow engine.** One token, one process: no parallel gateways, no
  sub-processes, no multi-instance fan-out, no retries, no persistence of run
  state. Those are the runner's limits, not the notation's — the notation says
  what they mean already.
- **Not sandboxed.** It imports and calls what the diagram names. Run diagrams
  you trust.

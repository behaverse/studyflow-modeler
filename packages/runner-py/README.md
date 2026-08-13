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
writes lands in there — the directory is itself a git repository, and a later
invocation of the same run doesn't get a second directory: it commits onto
the first one's history instead.

```
runs/20260801T093253Z/
  .git/                              one commit per checkpoint, one run/<stamp> tag per invocation
  .gitattributes                     git-lfs patterns for the binary artifacts, written on first init
  sklearn_pipeline.studyflow.png     the studyflow that ran, copied in, its trail stamped `executed`
  digits.csv                         the boundary input it read, copied in
  cv_fold_metrics.csv                ┐
  cv_metric_summary.csv              │
  digits_pca_svc.joblib              ├ the five artifacts its `uri`s name
  holdout_metrics.csv                │
  confusion_matrix.png               ┘
  studyflow.log                      what this invocation did, in order
```

The directory is named for the run, so the files in it are not — `studyflow.log`
is a name you can hardcode in a pipeline. It is truncated fresh each
invocation; what a prior invocation logged is still recovered from its
commits, at its own `run/<stamp>` tag. A second run is a
second commit in the same repo, not five overwritten files. `--repo` names
the directory explicitly — an existing one to resume, or a new one to start
elsewhere; left off, the runner resumes the repo the plan file already lives
in, or else creates one named for the start time under `runs/`. See
[The run repository](#the-run-repository) for what the git history holds.

Everything the run touched is in there, the plan and the inputs included, so the
directory answers for itself: it is a complete, self-contained record — this
invocation at its tag, the whole lineage in its history — that you can
archive, deposit, or hand to a reviewer.

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
| `activity.skipped` | a recorded step's artifacts were reused instead of re-computed (see partial re-runs) |
| `activity.invalidated` | a recorded step re-ran because an input was re-made this run (the cascade in partial re-runs) |
| `artifact.prepared`, `artifact.staged`, `artifact.loaded`, `artifact.saved` | a boundary input is materialized by the shipped maker, copied in from outside, read, or a result written |
| `plan.archived` | the stamped copy of the studyflow is (re)written into the repo |
| `gateway.reached`, `conditionExpression.evaluated`, `sequenceFlow.taken`, `gateway.stuck` | the branch, and what decided it |
| `event.reached` | a start, intermediate, or end event |
| `stdout`, `stderr` | what the step itself printed, captured line by line (file only; the terminal already showed it live) |
| `git.init`, `git.branched` | the directory became a git repository, and this invocation started a branch of its own — see [Branching](#branching) |
| `git.unavailable`, `git.failed`, `git.lfs.unavailable`, `git.branchpoint.missing`, `git.fork.failed` | the repo's git replication degraded — see [The run repository](#the-run-repository) |

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

## The run repository

A run directory is not just a folder the runner writes into — it is a git
repository, and the trail above is replicated as its commit history. Every
checkpoint (a step finishing, a gateway deciding, the invocation starting or
ending) is one commit.

### Commit protocol

The rule: **a commit's trailers are exactly the attributes of the
corresponding `prov:activity` entry.** A commit that stamps no trail entry
(the dirty-tree cleanup below) carries only `Prov-Run` and `Prov-When`.

| When | Subject | Trailers |
|---|---|---|
| invocation start | `started <pid> (<UTC start stamp>)` | `Prov-Action: executed`, `Prov-When`, `Prov-Who`, `Prov-With: studyflow_run.py`, `Prov-Run`, `Prov-Seed` |
| dirty tree before start | `changed outside a run` | `Prov-Action: modified`, `Prov-When` |
| activity completed | `executed <name>` | `Prov-Action: executed`, `Prov-When`, `Prov-Run`, `Prov-Node: <element id>` |
| container completed | `executed <name>` | same |
| gateway decided | `executed <name>: <flow id>` | same, plus `Prov-What: <flow id>` |
| activity skipped | `skipped <name> (run <prior-run>)` | `Prov-Run`, `Prov-When`, `Prov-Node` (the trail stamps nothing for a skip) |
| activity raised | `failed <name>` | `Prov-Run`, `Prov-When`, `Prov-Node` |
| invocation end | `finished <pid> (ok\|error)` | the full document-stamp set |

`Prov-Node` has no attribute counterpart in the trail itself — element
entries are stamped *on* their element, so the id is never a `prov:activity`
attribute — but every element commit carries it anyway, because it is the
commit↔element mapping the branch-point search in [Branching](#branching)
depends on. Pure pass-through events (a start/end event reached, a gateway
that only decided nothing new) commit nothing — they change no files, and
their trail entry rides along in the next checkpoint. Every checkpoint is a
`git add -A` and a commit, so a step's artifacts, staged inputs, and log
lines land together — and its record entry is the commit's own body (see
[Step records](#step-records)).

### LFS

First init, with git-lfs on PATH, writes `.gitattributes` with `filter=lfs`
patterns for `*.joblib`, `*.parquet`, `*.png`, `*.svg`, `*.pdf` — the
binary formats this runner's examples produce (plain-text formats like `.csv`
stay ordinary blobs). The archived studyflow copy is itself often a `.png`,
so it becomes an LFS object too — accepted; LFS objects live under
`.git/lfs/objects`, so the run directory stays self-contained either way.

### Degrading without git

Replicating provenance into git must never be why a run fails. No `git` on
PATH: one `git.unavailable` warning, and the repo machinery no-ops for the
rest of the invocation — the directory still gets its artifacts,
`studyflow.log`, and stamped plan, just no `.git` (and so no step records:
those live only in commits). A git call
that fails or times out: one `git.failed` warning, then the same no-op
fallback for the rest of the invocation. `git` present but `git-lfs` missing:
one `git.lfs.unavailable` warning, and `.gitattributes` is never written — a
`filter=lfs` pattern declared without the filter installed fails every later
`git add`, so the runner writes plain blobs instead of risking that.

A repo that started git-less and is resumed once git is back on PATH is
*adopted*: the runner `git init`s in place and the resuming invocation's
first commit baselines whatever is already on disk.

### Step records

The per-step payload the runner builds while it runs — durations, typed
inputs and outputs, tracebacks — lives in one place: the commit bodies.
Each checkpoint commit's body is a JSON array of the record entries since
the previous checkpoint (`[{node, name, type, startedAt, durationMs,
implementation, inputs, outputs, used, generated, additionalArguments,
error?}]`); pass-through events ride in the checkpoint that follows them.
The `started` commit's body is the invocation header (`{studyflow, run,
seed, who, with, startedAt}`), the `finished` commit's the closing summary
(`{status, finishedAt, steps, tail}` — `tail` holds entries no element
commit claimed, such as end events). There is no separate record file — the
trail in the stamped plan and the git history are the two views, one
interchange and one archive, with nothing duplicated between them:

```bash
git show -s --format='%b' <commit> | head -1 | jq  # one commit's records (%b ends with the trailers)
git log --format='%b' | grep '^[[{]' | jq -s       # every record in the history, newest first
```

### Branching

Provenance is a DAG in principle; in a run repository it is the commit graph,
literally.

- **Continue.** An ordinary resume with nothing invalidated commits onto the
  current branch — the first invocation creates `main`, and whatever branch
  HEAD points at is the one the runner extends. `git switch <branch>` before
  running picks a different one to continue.
- **Fork from the middle.** A plan carrying `invalidated` entries (the
  modeler's ✕ gesture) or an explicit `--from <commit-ish>` locates the
  newest commit that **executed** the affected activity — by its `Prov-Node`
  and `Prov-Action` trailers; a later `skipped` commit is not where the work
  entered history — and branches `fork/<UTC start stamp>` **at that commit's
  parent**, the last state without the invalidated work (branches are
  `fork/…`, tags `run/…` — a shared name would make the refs ambiguous). The checkout alone reverts the
  worktree to that point in history: artifacts upstream of the invalidated
  step are still there (their steps skip), the invalidated step's and
  everything downstream of it are gone (their steps re-run, because their
  artifacts are gone). `git log --graph` then shows the fork exactly where
  the invalidation happened.
- **Fallback.** If the invalidated element's commit can't be found on the
  current branch (records from before this repo had git, a foreign lineage):
  one `git.branchpoint.missing` warning, and the runner falls back to an
  in-place re-run on the current branch instead of forking.
- A detached HEAD — a tag or commit checked out directly, not a branch —
  makes the runner start `fork/<stamp>` there rather than commit detached.

Two recipes follow from a run directory being a real repo:

```bash
git -C runs/<id> log --graph --oneline --all      # the provenance DAG, forks and all
git -C runs/<id> diff run/<a> run/<b>              # what changed between two invocations
```

One invocation runs against a repo at a time — a second one started against
the same directory contends on git's own `index.lock`, which degrades
replication (the same fail-soft ladder as above) but never corrupts an
artifact already written. And `runs/` is git-ignored in the outer checkout;
un-ignore it and each run repository shows up there as a gitlink — a commit
pointer, not its tracked files — worth knowing before `git add runs/`
doesn't do what you expect.

Run directories are no longer immutable snapshots the way a single flat
directory was — the history is the record now, and any prior invocation is
recovered from its tag: `git archive run/<id>` reconstitutes that invocation's
directory on its own. The modeler's Provenance view is unaffected either way;
it renders `run` as text, and a shared value across resumes was already
nothing new to it.

### Partial re-runs

A run also records itself *per element*: every activity and event it completed
gets its own `executed` entry (`when`, `run`), a gateway's entry adds the flow
it took as `what`, and a data element records `created` (this run saved its
artifact) or `imported` (a boundary input staged from outside) — each in that
element's `extensionElements` on the archived copy. Re-running the copy is
therefore incremental, and flag-free: pointing the runner at its own archived
plan resumes the repo it already lives in.

```bash
uv run studyflow_run.py runs/<id>/sklearn_pipeline.studyflow.png
```

A step is **skipped** — its artifacts reused instead of re-computed — when its
record is present, nothing it reads was re-made this run, and every one of its
outputs is an artifact (`uri`) still on disk: an output some later step reads
must load back into memory, while an output nothing reads (a terminal figure,
say) only has to exist. A step with a memory-only output re-runs only when
the run's demand analysis says someone needs the value: taint spreads forward
from whatever is gone or invalidated, memory-only bindings pull their
producers in backward, and gateway conditions keep the values they read
bound. Everything outside that closure skips — invalidating one activity
re-executes its own chain, not the whole diagram. (A demanded re-run of
unchanged inputs recomputes the same value and invalidates nothing.)

Two gestures invalidate a step, and they are not equivalent:

- **Delete the artifact.** The lightweight, in-place gesture: the run starts
  with a dirty tree — an artifact missing that the last commit says should be
  there — commits that as `changed outside a run`, and the producing step
  re-runs on the *same* branch. No fork; the history stays linear.
- **Invalidate the element**, or pass `--from <commit-ish>` directly. The
  modeler's ✕ gesture appends an `invalidated` line naming the run it voids;
  either it or `--from` **forks** a new branch at the point in history just
  before that step ran — see [Branching](#branching) above for what that does
  to the worktree and the commit graph.

**Invalidation cascades** either way: a step re-made by either gesture taints
its outputs, so every recorded step that reads them re-runs too (logged as
`activity.invalidated`) — refitting the model re-plots the confusion matrix.
Skipped elements keep the record of the run that really produced their
artifacts, so the copy stays a truthful patchwork of which run made what.
`--fresh` ignores every record and re-runs the whole flow, in the same repo.

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
declares. It writes scikit-learn's copy of the UCI hand-written digits set:
1797 rows, 64 pixel columns and a `target`.

A missing boundary input is looked up in order — **the plan file's own
directory, then the current directory, then the shipped `BOUNDARY_INPUTS`
maker** — and the first place it turns up wins. There is no `--workdir` to
name a fourth place: the run directory is itself in the search (a resume
finds its own artifacts before looking anywhere else), so the old
one-directory model doesn't need a stand-in.

Inputs are **staged into the run directory before they are read**, so the run
directory is the single root every `uri` resolves against from then on — the
paths the provenance records are valid there by construction, not because
something copied them in afterwards. Found outside the repo, an input is
copied in and logged as `artifact.staged`; materialized by the shipped maker,
it's logged as `artifact.prepared` — either way once, because on a resume the
artifact is already sitting in the worktree and this whole lookup is skipped,
which is also why a resume doesn't re-copy a multi-hundred-KB input on every
invocation.

Any *other* missing boundary input is a plain error naming the file and the
element that wanted it, which is the honest answer. `--no-prepare-inputs` makes
even the shipped one behave that way.

**Migrating from `--workdir`:** run the command from that directory, or put
the input file beside the plan — either is now in the lookup order.
**Migrating from `--runs-dir Y --run-id N`:** `--repo Y/N` names the same
directory directly.

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

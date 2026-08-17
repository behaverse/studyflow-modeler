# Python runner

A small Python program that executes a studyflow, here to keep one claim honest: **a studyflow is executable as it stands.** No companion script tells the engine what the boxes mean; the picture is the program, and this reads it.


```bash
uv run studyflow_run.py sklearn_pipeline.studyflow.png
```

One command, no setup. Dependencies are declared in the script header (PEP 723) and `uv` resolves them per run; the example's input table is materialized on first read. The script is executable too — `./studyflow_run.py <studyflow>` works, through a `#!/usr/bin/env -S uv run --script` shebang. A studyflow naming other software brings its own:

```bash
uv run --with torch --with transformers studyflow_run.py my_pipeline.studyflow.png
```

The runner's own dependency is `pyyaml`. The others in the header — pandas, scikit-learn, joblib, matplotlib — are what *the shipped example's steps* import when the runner calls them.

The run prints the walk as it goes, each binding saying what it carried, by type and shape, so the data narrows in front of you:

```
sklearn_pipeline
  ⊞ prepare_data
    □ split_train_test
        * ← features  pandas.DataFrame 1797×64
        stratify ← target  pandas.Series 1797
        implementation python://sklearn.model_selection.train_test_split
        x_train ← result[0]  pandas.DataFrame 1347×64
        x_test ← result[1]  pandas.DataFrame 450×64
        ▤ save x_test.joblib  joblib, 235.2 KB
  ◇ is_good_enough
      mean_cv_accuracy >= 0.90 → report
  ● done
  → runs/readme-demo/ (ok) in 3599.4ms
```

The order is the point: the split runs before anything looks at the data, cross-validation sees the training half only, and every number in `holdout_metrics.csv` comes from predicting the held-out quarter once. (That the cross-validated mean and the held-out score agree — both about 0.989 — is itself a result of the split shuffling: an earlier version of the example cross-validated the whole dataset, whose rows `load_digits` returns in a near-sorted order that `StratifiedKFold` does not shuffle, and scored 0.963 on unrepresentative folds.)

## Contract

- It owns **executing the contract below** and recording what it did. It decides nothing the notation leaves unstated: no default for a branch that has none, no invented input data.
- It reads BPMN XML itself — bare, or embedded in a `.studyflow.png` — and shares no code with the TypeScript packages. It never reads applied types: it dispatches on the BPMN tag and calls whatever `implementation` the element names.
- **The input file is never modified.** The `executed` stamp lands on the in-memory plan, and therefore on the copy archived in the run repository.
- **Every run writes into a run repository** — a directory that is itself a git repository. Everything the run touched is in there, the plan and the inputs included, so it answers for itself.
- **Replicating provenance must never fail a run.** Every git degradation is one warning and a no-op fallback for the rest of the run.
- **One token, one process.** No parallel gateways, no multi-instance fan-out, no retries, no persistence of run state. Those are this runner's limits, not the notation's — the notation already says what they mean.
- **Not sandboxed.** It imports and calls what the studyflow names. Run studyflows you trust.

## Flags

| Flag | Effect |
| --- | --- |
| `--repo <DIR>` | the run repository to write into, its name being the run id. Default: the plan's own directory when the plan already lives in one, else a fresh `runs/<UTC start stamp>` |
| `--from <REF>` | re-run from this point in the repository's history (a commit-ish), branching there |
| `--fresh` | ignore every per-element record and re-run the whole flow, in the same repository |
| `--no-prepare-inputs` | fail on a missing boundary input rather than materialize a shipped example's own |
| `--quiet` | no console output; the log file is written either way — a log you have to remember to ask for is not a log |

Migrating an old command line: `--workdir X` → run the command from `X`, or put the input beside the plan (both are in the lookup order below). `--runs-dir Y --run-id N` → `--repo Y/N`.

## The run repository

```
runs/20260801T093253Z/
  .git/                              one commit per checkpoint; runs are started/finished commit pairs
  .gitattributes                     git-lfs patterns for the binary artifacts, written on first init
  sklearn_pipeline.studyflow.png     the studyflow that ran, copied in, its trail stamped `executed`
  digits.csv                         the boundary input it read, copied in
  cv_fold_metrics.csv  …  confusion_matrix.png     the artifacts its `uri`s name
  studyflow.log                      what this run did, in order
```

The directory is named for the run, so the files in it are not: `studyflow.log` is a name you can hardcode in a pipeline. It is truncated fresh each run, because what a prior run logged is recovered from its commits, between its `started`/`finished` pair.

**Commits.** Every checkpoint — a step finishing, a gateway deciding, the run opening or closing — is one `git add -A` and one commit, so a step's artifacts, staged inputs, and log lines land together. The rule: *a commit's trailers are exactly the attributes of the corresponding `prov:activity` entry*, plus `Prov-Node` on every element commit (the commit ↔ element mapping the branch-point search depends on). A commit that stamps no trail entry — the `changed outside a run` cleanup of a dirty tree — carries only `Prov-Run` and `Prov-When`. Pure pass-through events commit nothing and ride along in the next checkpoint. The subjects are the grep handles: `started <pid> (<stamp>)`, `executed <name>` (a gateway's adds `: <flow id>`), `skipped <name> (run <prior-run>)`, `failed <name>`, `changed outside a run`, `finished <pid> (ok|error)`.

**Step records** — durations, typed inputs and outputs, tracebacks — live in the commit bodies and nowhere else: a JSON array of the entries since the previous checkpoint (`[{node, name, type, startedAt, durationMs, implementation, inputs, outputs, used, generated, additionalArguments, error?}]`), with the run header in the `started` commit's body and the closing summary in the `finished` one. There is no separate record file.

```bash
git -C runs/<id> log --graph --oneline --all       # the provenance DAG, branches and all
git -C runs/<id> diff <finished-a> <finished-b>    # what changed between two runs
git show -s --format='%b' <commit> | head -1 | jq  # one commit's step records
```

**Branching.** An ordinary resume commits onto whatever branch HEAD points at. A plan carrying `invalidated` entries (the modeler's ✕) or an explicit `--from` instead branches `run/<UTC start stamp>` **at the parent of the commit that executed the affected activity** — the checkout alone reverts the worktree to that point, so upstream artifacts survive and skip while the invalidated step and everything downstream re-run. A detached HEAD branches rather than commits detached. Marker precision decides whether a branch happens at all: the ✕ writes the `when` of the exact record it voids, and only such a precise marker branches, and only while that record stands; a hand-written marker without a `what` is a standing re-run pin that re-executes the step in place every run.

**Degrading.** No `git` on `PATH`: one `git.unavailable` warning, then the artifacts, log, and stamped plan are still written — but no step records, since those live only in commits. A git call that fails or times out: one `git.failed` warning and the same fallback. `git` present but `git-lfs` missing: one `git.lfs.unavailable` warning and `.gitattributes` is never written, since a `filter=lfs` pattern declared without the filter installed fails every later `git add`. First init with git-lfs present writes LFS patterns for `*.joblib`, `*.parquet`, `*.png`, `*.svg`, `*.pdf`; plain-text formats stay ordinary blobs. A repo that started git-less and is resumed once git is back is adopted in place.

One run at a time per repository — a second contends on git's own `index.lock`, which degrades replication but never corrupts an artifact already written. `runs/` is git-ignored in the outer checkout; un-ignore it and each run repository shows up as a gitlink, not as tracked files.

**Partial re-runs** need no flag: pointing the runner at an archived plan resumes the repository it already lives in. A step is skipped when its record stands, nothing it reads was re-made this run, and its `uri` artifacts are still on disk; a clean gateway replays its recorded decision instead of evaluating. Taint spreads forward from whatever is gone or invalidated, and memory-only bindings pull their producers in backward, so invalidating one activity re-executes its own chain rather than the diagram. Staleness tracks data, not text: after hand-editing a condition expression, ✕ the gateway or pass `--fresh`. See [Provenance](../../docs/run/provenance.qmd) for the two invalidation gestures and what each does to the history.

## Boundary inputs

A *boundary input* is an artifact a run reads and no step of it produces — by definition, something outside the studyflow put it there. The notation does not say how, and should not: an engine that could invent a study's input data would be guessing at the science.

A missing one is looked up in order — **the plan file's own directory, then the current directory, then the shipped `BOUNDARY_INPUTS` maker** — and the first place it turns up wins. There is no `--workdir`: the run repository is itself in the search, so a resume finds its own artifacts first. Inputs are **staged into the repository before they are read** (`artifact.staged`, or `artifact.prepared` when a maker made one), so the repository is the single root every `uri` resolves against and the recorded paths are valid there by construction. Any other missing boundary input is a plain error naming the file and the element that wanted it.

`sklearn_pipeline` has one, `digits.csv`, taken as an external table rather than a call to a bundled sample-data loader on purpose: the same studyflow runs on a real study dataset by changing one `uri`. The shipped maker for it — scikit-learn's copy of the UCI hand-written digits set — is what makes the one-command claim above hold.

## The contract it implements

`studyflow_run.py` is one file and its docstring states the contract before implementing it. In short:

| In the studyflow | At run time |
| --- | --- |
| `implementation="python://pkg.mod.fn"` | the callable to import; the path may reach into a class, which is how an unbound method becomes a step |
| a data input association | one argument, its slot named by the association's `transformation` body (defaulting to the element's own name) — or, in the standard form the modeler saves, by the `ioSpecification` DataInput it targets |
| the transformation's *selection* | narrows the value: `"X = folds['train']"` on an input, `"result[0]"` on an output |
| slot `self` | the receiver of an unbound method — bound first and positionally |
| slot `*` | appended to the positional arguments in declaration order, for a callable whose arguments have no names (`train_test_split(*arrays)`) |
| `additionalArguments` | the literal arguments the associations did not supply: `args` for positional, a nested mapping with its own `implementation` for a call to make first. A name bound by both is refused rather than silently resolved |
| a data output association | where the return value lands, narrowed by the transformation's selection over `result` |
| `uri` on a data element | an artifact: loaded before its first consumer, written after its producer, in the element's declared `format` or the one its extension implies. A `.png` is written with `savefig`, a `.csv` through pandas — nothing about plotting or CSV is a notation concept |
| no `uri` | a value that only passes between steps in memory |
| `uri` on a `bpmn:Property` | the property persists like any artifact — later runs load it instead of re-running its producer |
| `conditionExpression` on a flow out of a gateway | the branch rule; the gateway's `default` when none holds. Expressions are Python here and JavaScript in the browser runner, named per expression by BPMN's own `language` field; this runner refuses a `javascript` expression rather than guess |
| `state.trace` | the ordered walk so far, so a drawn cycle can bound itself: `state.trace.count('Gate') < 8` |
| `studyflow:seed` on the study | the run's root seed — pinned here, or drawn once when it is not, and injected into `random` (and numpy) either way. Recording it on the `executed` stamp is what makes an unpinned run replayable |

Everything the runner writes is named the way the modeler names it: a field is the BPMN or studyflow attribute the runner actually read, never a word invented here for the same thing — so a record or a log line is checkable against the inspector panel that authored it.

## The log

`studyflow.log` is plain text through Python's own `logging`: one line per event, `time level event message`. The date is in the directory name rather than on every line, so the columns stay narrow enough for the message to carry the walk's indentation.

```
23:02:24.616 INFO  dataOutputAssociation.bound           x_train ← result[0]  pandas.DataFrame 1347×64
23:02:24.986 INFO  sequenceFlow.taken                  mean_cv_accuracy >= 0.90 → report
```

The `event` column is the grep handle, and its names are the notation's nouns: `run.*`, `activity.*` (including `skipped` and `invalidated`), `implementation.resolved|missing`, `dataInputAssociation.bound`, `dataOutputAssociation.bound`, `artifact.prepared|staged|loaded|saved`, `plan.archived`, `gateway.reached|replayed|stuck`, `conditionExpression.evaluated`, `sequenceFlow.taken`, `event.reached`, `stdout`, `stderr`, and `git.*` for the degradations above.

```bash
grep artifact.saved      runs/*/studyflow.log     # what was written, and how big
grep sequenceFlow.taken  runs/*/studyflow.log     # which way every branch went
grep -E 'ERROR|WARNING'  runs/*/studyflow.log     # what went wrong, with the traceback under it
```

Run directories are named with a sortable UTC stamp, so `runs/*/studyflow.log` walks every run in the order they happened. The console gets the walk as a tree; the file additionally gets the `DEBUG` events (per-step durations, conditions that did not hold, the plan digest and seed on its second line) and whatever the steps themselves printed, which also passes through to the terminal live. If you ever need these lines in a collector rather than a file, add a `logging` handler rather than change the format.

## More

- [Analysis pipelines](../../docs/design/analysis.qmd) — the `sklearn_pipeline` example this runner is checked against, read as a studyflow.
- [Provenance](../../docs/run/provenance.qmd) — the trail, the per-element records, and how re-runs and branches accumulate.
- [Execution](../../docs/run/execution.qmd) — which elements each of the four executors actually runs.
- [Command line and URLs](../../docs/reference/cli.qmd) — invoking this runner through `studyflow run`.

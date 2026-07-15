# Executable Studyflow: plan

How Studyflow becomes a language you can *run* — at scale, as human-in-the-loop, on HPC, agentic, or as a plain ML pipeline — without becoming a different language.

The semantics are specified in [`exec_docs.qmd`](./exec_docs.qmd).

---

## The thesis

> A participant walking through a study, a fold in cross-validation, a point in a hyperparameter sweep, a shard of an HPC array job, and a turn of an agent loop are the same thing: **a token in a scope**.

Studyflow already walks a participant through a graph. Give every activity a **contract** and every token a **scope**, and one engine runs all five. Everything below follows from that.

Two consequences shaped the schema:

**Nothing new is drawn.** BPMN already has the primitives; they were never given executable meaning.

| BPMN construct | Executable meaning |
| --- | --- |
| multi-instance marker | scope expansion — sweeps, folds, shards, participants |
| standard-loop marker | agent turns, evaluator-optimizer, retrain-on-drift |
| **ad-hoc sub-process** | *"order determined at run time, not predefined"* — **this is an agent**, in BPMN's own words, since 2011 |
| boundary event | retry, timeout, drift trigger |
| call activity | reusable component |
| data association | typed port binding |

**Parameterize, don't proliferate.** This repo already contains both the wrong answer and the right one. `docs/assets/mlops.moddle.yaml` is 946 lines with one type per dplyr verb (`LeftJoinTables`, `SpreadColumns`, …) — abandoned. `datatrove.moddle.yaml` replaced it with six generic operations plus templates that bind a function via BPMN's own `implementation` attribute. The AI/ML schemas follow the second pattern: the only new *nouns* are artifacts (`Model`, `Metric`, `Prompt`) and the two elements whose control flow a model steers (`Agent`, `Router`); every *verb* — split, fit, evaluate, deploy, retrieve, judge, guardrail — is a **template** binding a function onto a generic step, not a class. "5-fold stratified CV" is a template, not a class; so is "Fit random forest," so is "LLM-as-judge," and so is "Optimize prompt" — fitting a prompt is the same operation shape as fitting a forest.

> An earlier draft of `ml`/`agentic` relapsed into the abandoned one-class-per-verb pattern (34 types, 24 enums, 2,725 lines — larger than the rest of the language). The collapse back onto `exec` + templates is recorded in [`exec_schema_review.md`](./exec_schema_review.md), which is the review that produced the schemas described below.

---

## What is already done

Three schemas, registered in `src/core/constants.ts`, passing the schema-lint + moddle-registration suite. `exec` is the general view; `ml` and `agentic` are thin packs of the few irreducible types plus a set of `implementation`-bound templates.

| Schema | Types (classes) | Everything else is a template |
| --- | --- | --- |
| **`exec`** (core) | `Step` / `Iteration` / `Artifact` traits; `ForEach` `Sweep` `Component` `Gate` `Parameters` `Blob` | shard-across-cluster, sweep, repeat-until (a plain `bpmn:SubProcess` presetting BPMN's own `loopCharacteristics` — there is no `Repeat`, `Block`, or `Repetition` in the schema) |
| **`ml`** | `Model` `Metric` (artifacts) + one generic `Operation` step | split, fit, fit-formula, fine-tune, preference-tune, optimize-prompt, predict, evaluate, validate, embed-corpus, register, deploy, monitor, CV, grid-search, promotion-gate |
| **`agentic`** | `Agent` (ad-hoc sub-process) `Router` (`branching: model`) `LLMCall` `Tool` `HumanApproval` + `Prompt` `Memory` (artifacts) | retriever, judge, guardrail, human-feedback, pairwise-preference, evaluator-optimizer, prompt-chain |

Plus two worked examples (`ml_pipeline.studyflow`, `agent_eval.studyflow`) that **round-trip losslessly through the existing codec with zero codec changes** — each is its own fixed point under YAML → XML → YAML, and the runner parses the same flow graph through both. Every ML/agent step in them is one generic `ml:Operation`/`agentic:Tool` bound via the native `implementation` attribute, not a bespoke class. The inspector, palette, templates, and auto-layout pick the types up from the catalog with no app changes.

**Fitting is one notation across the whole surface** — a trainable artifact, data, and an objective in; the improved artifact and its `Metric`s out — realized entirely as templates over `ml:Operation`, so the trainable can be a classical estimator, a formula-specified statistical model, a LoRA adapter, or an `agentic:Prompt` (a DSPy-style compile). The step contract's sixth question ("may it be skipped?") is now `exec:Step#when`, which the fitting loop uses to skip the optimizer on the baseline turn. `agent_eval.studyflow` closes the loop on the diagram: the eval is wrapped in a repeat-until sub-process that refits the agent's instructions until the judge's score clears the bar. Semantics in [`exec_docs.qmd`](./exec_docs.qmd) §Fitting.

One runner change was needed and made: `agentic:Router` declares `meta.branching: model`, which the `Session` does not implement. It now **refuses** rather than falling through to the condition arm and silently taking the default branch (`src/runner/controllers/session.ts`).

### Known cosmetic gaps

~~ForEach/Sweep draw no ∥∥∥ marker~~ — closed: the templates and examples now carry BPMN's own `loopCharacteristics` child, which is exactly what the renderer keys markers on. A sub-process someone builds by hand still needs the child added for the marker; the inspector cannot edit it yet.

Data associations authored in a DI-less `.studyflow` round-trip and parse, but the auto-layout does not yet give the association *edges* waypoints, so they are not drawn until a user wires them interactively. Same Stage 2 bucket: extend the missing-DI auto-layout to data-association edges.

---

## Stage 1 — Free the engine from React

*The one seam everything else hangs off.*

Today the walk is React-bound: `NodeDefinition` (`src/runner/models/nodes/types.ts`) **requires** a `Component`, so a node can only be "run" by rendering it. That is why there is no headless runner.

```ts
// src/runner/models/nodes/types.ts
export type Outcome =
  | { status: 'ok'; outputs?: Record<string, unknown> }
  | { status: 'suspend'; handle: string }        // human, HPC job, long tool call
  | { status: 'error'; error: Error };

export interface NodeDefinition<J> {
  type: J['type'];
  match: NodeMatcher;
  toJob: (node: FlowNode) => J | null;
  Component?: ComponentType<NodeProps<J>>;       // was required — now optional
  execute?: (job: J, ctx: ExecContext) => Promise<Outcome>;   // new
  validateNode?: …;
  validate?: …;
}
```

- Move `Session` → `src/core/engine/` (framework-free), introducing `Token`, `Scope`, `ExecutionLog`.
- The React runner becomes **one executor** (`runsOn: browser`), not the engine.
- Add derived seeds: `seed(σ) = H(rootSeed ‖ σ)`, replacing the `Math.random()` fallback in `Session`.

**Done when** a `.studyflow` runs to completion in Node with no DOM, and the browser runner still passes its current tests unchanged.

---

## Stage 2 — Scopes, expansion, and the graph the parser drops

`src/runner/models/parseStudyflow.ts` has a hard-coded `FLOW_NODE_TYPES` set that **omits `bpmn:SubProcess`, `bpmn:AdHocSubProcess`, `bpmn:CallActivity`, and `bpmn:BoundaryEvent`**. Every sub-process in a diagram is silently skipped today. Nothing that follows works until the parser recurses.

- Parse nested `flowElements`; resolve boundary events to their `attachedToRef`.
- Implement **[Fork]/[Join]** (the `ParallelGateway` that currently throws), **[Expand]/[Collect]**, **[Loop]**.
- ~~Mirror custom loop fields onto native constructs~~ — superseded: loops, fan-out markers, agent exit tests, and gate rules are now *stored* natively (`loopCharacteristics`, `completionCondition`, the pass flow's `conditionExpression`); there is nothing to mirror. Remaining modeler work here: an inspector editor for the native `loopCharacteristics` child.
- Static check: type-check the wiring, in the existing `NodeDefinition.validate` hook — every data association connects a typed data element to a step, so "does a `Model` flow into the evaluate step?" is checkable from the drawn graph alone. **This is the highest-value single feature** — it turns "training data → fitted model → metric" into something the modeler can verify before anything runs.

**Done when** `ml_pipeline.studyflow` expands its sweep into one instance per grid point, each with its own derived seed, and the fold/sweep/participant scopes are visible in the log.

---

## Stage 3 — Executors, the artifact store, and scale

- **Content-addressed artifact store.** Digests, not values, travel in token bindings.
- **Cache keys** per the [Fire] rule. Re-running a pipeline after editing one step re-runs one step.
- **Executors**: `local` (in-process Python via a worker service), `container` (OCI, `docker://`), `hpc` (Slurm submit → **suspend** → poll → resume; the `compute.array` shard count becomes the array size).
- **CLI**: `studyflow run flow.studyflow --seed 42 --resume <run>`.

The HPC story needs no new semantics: an array job is `iterate: shards`, and waiting six hours for a scheduler is the same `suspend` a human approval uses.

**Done when** the sweep in `ml_pipeline.studyflow` runs 8 grid points as a Slurm array, and re-running with one hyperparameter changed re-executes only the affected points.

---

## Stage 4 — Agents

- **Agent executor**: the tool-calling loop over an ad-hoc sub-process's contained activities. Each model call and tool call is one `Execution` in the log, so an agentic run is *replayable* even though it is not deterministic.
- **`Router`**: replace the refusal from Stage 0 with a real classifier; record the branch and its stated reason.
- `Guardrail`, `Judge`, `HumanApproval` — the last is just `suspend`, which Stage 1 already built.

**Done when** `agent_eval.studyflow` runs an eval set through a tool-using agent, and the run can be replayed from its log without calling a model.

---

## Stage 5 — Provenance and interop

- **`.studyrun`**: the plan plus its executions. Generalizes what `EndEvent#attritionCount` already does — the diff between the registered file and the as-run file *is* the result.
- **PROV-O export**, alongside the existing NIDM/LinkML/ARTEM-IS exporters in `src/modeler/models/exporters/`.
- **Emit bridges** (optional, and deliberately last): CWL for batch/HPC, LangGraph for agentic. Useful for adoption; not the point. No target system expresses study semantics *and* ML semantics *and* agent semantics, which is the whole reason to have the engine.

---

## Decisions worth challenging

**`exec` is loaded as a core schema.** Executability is the semantics of the language, not an add-on — a cognitive task is a step whose implementation is a person. The cost: every activity's inspector gains Execution/Compute tabs. Flip `core: true` in `src/core/constants.ts` to make it opt-in.

**The interface is the diagram, not a declaration.** An earlier draft carried a `signature` YAML block per step; it was cut once it proved redundant three times over — BPMN's data associations already draw the wiring (and round-trip through the codec unchanged, proven in both examples), the artifact elements already carry the types, and the callable named by `implementation` already declares its parameters. The cost: a port that deserves a type must earn a data element on the canvas. That is a feature — an interface a reviewer cannot see is an interface nobody reviewed.

**Build the engine; treat emitters as an afterthought.** The alternative — compile studyflows to Airflow/CWL/LangGraph and run nothing ourselves — is cheaper and would work for any *one* of the three workloads. It cannot work for the union, which is exactly Studyflow's claim. The engine is small: the whole semantics is eleven rules.

**`loopMaximum` (and an Agent's `maxTurns`) is mandatory in spirit.** It is the only guaranteed termination bound in a language that now has cycles. Consider making the modeler refuse to save a loop without one.

---

## Order, and why

Stage 1 before everything, because nothing is testable headlessly until the engine is free of React. Stage 2 before 3, because a parser that drops every sub-process cannot run a pipeline that has one. Stage 3 before 4, because an agent is a step that calls steps — build the step. Stage 5 last, because provenance records what the other four do.

The two examples in `src/assets/examples/` are the acceptance tests: when `ml_pipeline.studyflow` and `agent_eval.studyflow` both *run*, this is done.

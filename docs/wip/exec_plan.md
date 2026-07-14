# Executable Studyflow: plan

How Studyflow becomes a language you can *run* — at scale, as human-in-the-loop, on HPC, agentically, or as a plain sklearn pipeline — without becoming a different language.

The semantics are specified in [`docs/reference/execution.qmd`](docs/reference/execution.qmd). This document is the build order.

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

**Parameterize, don't proliferate.** This repo already contains both the wrong answer and the right one. `docs/assets/mlops.moddle.yaml` is 946 lines with one type per dplyr verb (`LeftJoinTables`, `SpreadColumns`, …) — abandoned. `datatrove.moddle.yaml` replaced it with six generic operations plus templates that bind a function via `uses`. The new schemas follow the second pattern: `ml` has ten types, and "5-fold stratified CV" is a *template*, not a class.

---

## What is already done

Three schemas, registered in `src/core/constants.ts`, passing the full lint + moddle-registration suite (302 tests green):

| Schema | Contents |
| --- | --- |
| **`exec`** (core) | `Step` / `Iteration` / `Repetition` / `Artifact` traits; `ForEach` `Sweep` `Repeat` `Block` `Component` `Gate` `Parameters` `Blob` |
| **`ml`** | `Split` `Fit` `Predict` `Evaluate` `Validate` `Register` `Deploy` `Monitor` + `Model` `Metric` `Report` |
| **`agentic`** | `Agent` (ad-hoc sub-process) `LLMCall` `Tool` `Retriever` `Router` `Judge` `Guardrail` `HumanApproval` `HumanFeedback` + `Prompt` `Memory` |

Plus two worked examples (`ml_pipeline.studyflow`, `agent_eval.studyflow`) that **round-trip losslessly through the existing codec with zero codec changes** — including a nested `bpmn:AdHocSubProcess`. The inspector, palette, templates, and auto-layout all pick the new types up from the catalog with no app changes.

One runner change was needed and made: `agentic:Router` declares `meta.branching: model`, which the `Session` does not implement. It now **refuses** rather than falling through to the condition arm and silently taking the default branch (`src/runner/controllers/session.ts`).

### Known cosmetic gap

`exec:ForEach` and `exec:Sweep` carry iteration *parameters* but do not yet set BPMN's native `loopCharacteristics`, so bpmn-js draws no ∥∥∥ marker. Fixed in Stage 2 by mirroring the trait onto the native marker — the marker is BPMN's (rendering, interop), the parameters are ours (semantics).

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
- Modeler: mirror `iterate`/`until` onto `bpmn:multiInstanceLoopCharacteristics` / `bpmn:standardLoopCharacteristics` so the markers render and other BPMN tools read them.
- Static check: validate every `signature` against its wiring, in the existing `NodeDefinition.validate` hook. **This is the highest-value single feature** — it turns "training data → fitted model → metric" into something the modeler can verify before anything runs.

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

**Ports are a YAML block (`signature`), not `Port` elements with data associations.** This needed zero codec changes and round-trips today — proven, not assumed. The cost: ports have no canvas wires yet. Promoting them later is additive.

**Build the engine; treat emitters as an afterthought.** The alternative — compile studyflows to Airflow/CWL/LangGraph and run nothing ourselves — is cheaper and would work for any *one* of the three workloads. It cannot work for the union, which is exactly Studyflow's claim. The engine is small: the whole semantics is eleven rules.

**`maxTurns` is mandatory in spirit.** It is the only guaranteed termination bound in a language that now has cycles. Consider making the modeler refuse to save a loop without one.

---

## Order, and why

Stage 1 before everything, because nothing is testable headlessly until the engine is free of React. Stage 2 before 3, because a parser that drops every sub-process cannot run a pipeline that has one. Stage 3 before 4, because an agent is a step that calls steps — build the step. Stage 5 last, because provenance records what the other four do.

The two examples in `src/assets/examples/` are the acceptance tests: when `ml_pipeline.studyflow` and `agent_eval.studyflow` both *run*, this is done.

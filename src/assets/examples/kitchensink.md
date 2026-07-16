# Studyflow element cheatsheet

A complete reference to every element type across the studyflow moddle schemas,
meant to be read next to **`kitchensink.studyflow`** — the companion diagram that
places one live instance of each palette element in a labelled band per schema.
Open that file in the modeler to see the shapes and icons; use this file for the
attributes, enum values, and snippets a diagram can't show.

## How elements are encoded

A `.studyflow` file is BPMN 2.0 serialized as YAML. Every studyflow/extension
element is a **native BPMN element carrying an extension wrapper** — the BPMN
type gives it a shape and diagram behaviour, and the wrapper (in
`extensionElements`) gives it its studyflow meaning and attributes. For example a
questionnaire is a `bpmn:Task` wrapping `cognitive:Questionnaire`:

```yaml
Survey:
  type: bpmn:Task                 # BPMN base type → shape + flow behaviour
  name: Post-battery survey
  extensionElements:
    - type: cognitive:Questionnaire   # wrapper → studyflow meaning + attributes
      instrument: nasa-tlx
```

So each row below lists the **wrapper type**, the **BPMN base** it attaches to
(what you actually place on the canvas), and the wrapper's own attributes. Native
BPMN elements (Task, gateways, events, data references…) carry no wrapper.

### Minimal file skeleton

```yaml
id: my_study
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
  xmlns:studyflow: http://behaverse.org/schemas/studyflow/v1
  xmlns:cognitive: http://behaverse.org/schemas/studyflow/cognitive
My_Study:
  type: bpmn:Process
  name: My study
  extensionElements:
    - type: studyflow:Study
  flowElements:
    Start: { type: bpmn:StartEvent, outgoing: [F1] }
    Task1: { type: bpmn:Task, incoming: [F1], outgoing: [F2] }
    End:   { type: bpmn:EndEvent, incoming: [F2] }
    F1: { type: bpmn:SequenceFlow, sourceRef: Start, targetRef: Task1 }
    F2: { type: bpmn:SequenceFlow, sourceRef: Task1, targetRef: End }
```

`incoming`/`outgoing` may be omitted — they are derived from each flow's
`sourceRef`/`targetRef` on load. Diagram geometry (`bounds`, `waypoint`) is
optional; the modeler auto-lays-out files that ship without it.

### The schema stack

| Prefix | Namespace | What it adds |
|---|---|---|
| `bpmn` | `.../BPMN/20100524/MODEL` | The BPMN 2.0 base: events, gateways, activities, data, artifacts, pools. |
| `studyflow` | `http://behaverse.org/schemas/studyflow/v1` | The study container + core data infrastructure (Dataset, Table, Timeseries…). **core** |
| `exec` | `https://w3id.org/studyflow/exec` | The executable layer: the step contract, scopes (fan-out/sweep), artifacts. **core** |
| `cognitive` | `http://behaverse.org/schemas/studyflow/cognitive` | Cognitive tasks, Behaverse assessment tasks, questionnaires, instructions, assignment gateways, actors. **core** |
| `ml` | `https://w3id.org/studyflow/ml` | Statistical/ML pipelines: Model & Metric artifacts + a generic Operation. |
| `agentic` | `https://w3id.org/studyflow/agentic` | LLM/agent workflows: Agent, Router, LLM/Tool calls, human approval, Prompt/Memory. |
| `datatrove` | `https://w3id.org/studyflow/datatrove` | Function composition over data streams + read/write blocks. |
| `omniprocess` | `https://w3id.org/omniprocess` | Neuroimaging preprocessing presets (fMRIPrep, EEGPrep) — templates only. |
| `openbci` | `http://behaverse.org/schemas/studyflow/openbci` | Biosignal acquisition with OpenBCI boards (Cyton, Ganglion, Galea VR headset). |

A recurring design rule across `exec`/`ml`/`agentic`/`datatrove`/`omniprocess`/`openbci`:
**parameterize, don't proliferate**. A verb that is just a generic step bound to
a function (extract, tokenize, fit, deploy, fMRIPrep…) is shipped as a *template*
preset, not a distinct element type. Templates are listed per schema below.

---

## Native BPMN elements

Placed directly, with no wrapper. These are the shapes in the default palette
groups (Events, Activities, Gateways, Data, Containers).

### Events
| Element | Notes |
|---|---|
| `bpmn:StartEvent` | Entry point. Core adds `consentFormUri` (see studyflow:Study section). |
| `bpmn:EndEvent` | Exit. Core adds `redirectTo`, `completionCode*`, `attritionCount`. |
| `bpmn:IntermediateThrowEvent` | Emits a signal/message mid-flow. |
| `bpmn:IntermediateCatchEvent` | Waits for a timer/message/signal. |
| `bpmn:BoundaryEvent` | Attached to an activity's border (`attachedToRef`); catches errors/timers/signals. Drives CONSORT attrition and ML drift-retrain loops. |

### Gateways
| Element | Meaning |
|---|---|
| `bpmn:ExclusiveGateway` | One branch, by `conditionExpression` on outgoing flows (+ a `default`). |
| `bpmn:ParallelGateway` | Fork/join all branches. |
| `bpmn:InclusiveGateway` | Any subset of branches whose conditions hold. |
| `bpmn:EventBasedGateway` | Branch on whichever catch event fires first. |
| `bpmn:ComplexGateway` | Custom join/merge condition. |

### Activities
| Element | Meaning |
|---|---|
| `bpmn:Task` | Generic abstract task. |
| `bpmn:UserTask` | Performed by a human. |
| `bpmn:ServiceTask` | Performed by software (the base for ml/agentic/datatrove steps). |
| `bpmn:ScriptTask` | Runs an inline script. |
| `bpmn:ManualTask` | Done outside the system (e.g. fit a headset). |
| `bpmn:SendTask` / `bpmn:ReceiveTask` | Send / wait-for a message. |
| `bpmn:BusinessRuleTask` | Evaluates a decision/rule. |
| `bpmn:CallActivity` | Calls another process (base for `exec:Component`). |
| `bpmn:SubProcess` | Named group of steps; collapses/expands; carries loop markers. |
| `bpmn:Transaction` | Sub-process with transactional (compensating) semantics. |
| `bpmn:AdHocSubProcess` | Steps run in a **runtime-decided** order (base for `agentic:Agent`). |

### Data & artifacts
| Element | Meaning |
|---|---|
| `bpmn:DataObjectReference` | A piece of data flowing between steps (base for Schema/Table/Model/Prompt…). |
| `bpmn:DataStoreReference` | Persistent store (base for Dataset/Memory/OpenBCIRecording). |
| `bpmn:Group` + `bpmn:Category` | A labelled region (the bands in the companion diagram are Groups). |
| `bpmn:TextAnnotation` | A free-form note, optionally associated to an element. |
| `bpmn:SequenceFlow` / `bpmn:Association` / `bpmn:MessageFlow` | Connections. |

Containers that need a **Collaboration/Choreography** root (not a plain Process)
are covered in [Pools, lanes & choreography](#pools-lanes--choreography).

---

## studyflow — core

The study container and the data-infrastructure types shared by every use case.
Icon set: schema badge **S**.

### studyflow:Study — the process itself
`type: bpmn:Process` + `extensionElements: [{ type: studyflow:Study }]`.

| Attribute | Type | Default | Notes |
|---|---|---|---|
| `runtime` | RuntimeEnum | `cloud` | `browser` / `cloud` / `local` / `hpc`. |
| `authors` | String[] | — | |
| `isExecutable` | Boolean | `true` | |

The **StartEvent** and **EndEvent** carry core attributes:

| On | Attribute | Type | Notes |
|---|---|---|---|
| StartEvent | `consentFormUri` | String | Link to consent form; untick to skip consent. |
| EndEvent | `redirectTo` | String | Completion URL; `{COMPLETION_CODE}` placeholder. |
| EndEvent | `completionCodeType` | CompletionCodeTypeEnum | `none` / `static` / `dynamic`. |
| EndEvent | `completionCode` | String | Fixed code (when `static`). |
| EndEvent | `attritionCount` | String | Run-time count of participants exiting here (CONSORT). |

Every element also inherits two documentation attributes from the core
`BaseElement` trait: **`documentation`** (Markdown description) and
**`checklist`** (Markdown checklist). Activities/Events also carry Gantt fields
**`onset`**, **`duration`**, **`progress`**.

Steps that run external software name it with an **`implementation`**
attribute — BPMN's own attribute (and versioned-reference grammar,
`scheme://ref@version`) on service-style tasks, which `ml:Operation` and the
datatrove operations redefine, and which `cognitive:CognitiveTask` mirrors on
its wrapper for plain tasks (e.g. a versioned jsPsych plugin URL).

### Core data infrastructure

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `studyflow:Dataset` | `bpmn:DataStoreReference` | `bi--database` | `format` (DatasetFormatEnum), `catalog` (→DataCatalog), `storage` (→DataStoreReference), `schema` (→Schema), `bdmDataLevel` (BDMDataLevelEnum, if `format: bdm`), `bidsDataType` (BIDSDataTypeEnum, if `format: bids`). |
| `studyflow:Schema` | `bpmn:DataObjectReference` | — | `format` (e.g. `csvw`, `linkml`, `jsonschema`), `body` (YAML/JSON or URL). |
| `studyflow:Table` | `bpmn:DataObjectReference` | `bi--table` | `format` (TableFormatEnum, default `csv`), `schema` (→Schema), `rowCount` (Integer). |
| `studyflow:Timeseries` | `bpmn:DataObjectReference` | `mdi--chart-line` | `samplingRate` (Hz), `channelCount`, `units`, `recordingDuration` (s), `format` (TimeseriesFormatEnum). |
| `studyflow:EventMarker` | `bpmn:DataObjectReference` | `mdi--lightning-bolt-outline` | `eventType`, `eventOnset` (s), `eventOffset` (s), `eventCount`. |
| `studyflow:DataCatalog` | *(reference target — no shape)* | — | `url`. Registered by `Dataset#catalog`; not placed on the canvas. |
| `studyflow:ChoreographyTask` | `bpmn:ChoreographyTask` | `fluent--people-team-24-regular` | Dyadic interaction; needs a Choreography root (see below). |

```yaml
Trials:
  type: bpmn:DataStoreReference
  name: Trial data
  extensionElements:
    - type: studyflow:Dataset
      format: bdm
      bdmDataLevel: trials
```

---

## exec — the executable layer

Turns any activity into a runnable step, and carries the scope constructs behind
BPMN's multi-instance/loop markers. Icon set: schema badge **E**.

### Traits (mixed onto many elements — not placed on their own)
- **`exec:Step`** (on every activity): `runsOn` (RuntimeTargetEnum), `scheduler`
  (SchedulerEnum, if `hpc`), `compute` (YAML), `cache` (CachePolicyEnum),
  `deterministic` (Boolean), `seed`, `retry` (YAML), `timeout`, `when` (guard expr).
- **`exec:Iteration`** (behind the multi-instance marker): `iterate`
  (IterationKindEnum), `over`, `itemVar`, `folds` (YAML), `grid` (YAML),
  `maxConcurrency`, `collect` (CollectPolicyEnum), `collectAs`, `reducer`, `failFast`.
- **`exec:Artifact`** (on every data element): `uri`, `digest`, `version`,
  `persist` (PersistPolicyEnum), `producedBy`.
- **`exec:CompletionCondition`** / **`exec:LoopCondition`**: flatten the ad-hoc
  sub-process exit test / standard-loop condition to a string attribute
  (`completionCondition`, `loopCondition`).

### Concrete elements

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `exec:ForEach` | `bpmn:SubProcess` | `mdi--arrow-split-vertical` | Fan out one body instance per item; `iterate` (`items`→`shards`). |
| `exec:Sweep` | `bpmn:SubProcess` | `mdi--tune-variant` | One body instance per config point; `iterate` pinned `grid`; space in `grid`. |
| `exec:Component` | `bpmn:CallActivity` | `mdi--package-variant-closed` | Call a published sub-flow; `source` (ref grammar), `digest`. |
| `exec:Gate` | `bpmn:ExclusiveGateway` | `mdi--gate-arrow-right` | Continue only if the pass flow's `conditionExpression` holds; `rationale` (Markdown). |
| `exec:Parameters` | `bpmn:DataObjectReference` | `mdi--tune` | `values` (YAML), `basedOn` (defaults chain). |
| `exec:Blob` | `bpmn:DataObjectReference` | `mdi--file-outline` | `contentType`. A typed artifact with no more specific type. |

### Templates
**Shard across cluster** (ForEach, `iterate: shards`, `runsOn: hpc`) ·
**Hyperparameter Optimization** (Sweep) ·
**Repeat until** (SubProcess + standard loop, `loopCondition` + `loopMaximum`).

Cycles use BPMN's own standard-loop child (`loopCharacteristics` with
`loopCondition`, `loopMaximum`) — there is no `Repeat` element.

---

## cognitive — cognitive & behavioral

Cognitive tasks, video-game paradigms, rest, questionnaires, instructions, and
participant-assignment gateways. Icon set: schema badge **C**.

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `cognitive:CognitiveTask` | `bpmn:Task` | `bi--puzzle` | `instrument` (InstrumentEnum, editable), `implementation` (versioned external reference, `scheme://ref@version`), `configurations` (YAML body). |
| `cognitive:Rest` | `bpmn:Task` | `solar--armchair-2-linear` | `configurations` (e.g. duration, eyes-open/closed). |
| `cognitive:Questionnaire` | `bpmn:Task` | `fluent--clipboard-text-edit-32-regular` | `instrument` (QuestionnaireInstrumentEnum, editable). |
| `cognitive:Instruction` | `bpmn:Task` | `material-symbols--info-outline-rounded` | `content` (Markdown). |
| `cognitive:BehaverseTask` | `bpmn:Task` | `bi--hexagon` | Behaverse assessment; `instrument` pinned `behaverse`. `scene` (BehaverseSceneEnum, editable), `configurations` (GameConfig YAML: `Blocks`, `Timelines`), `agentType` (AgentTypeEnum), `botConfigurations` (YAML, if `agentType: bot`). |
| `cognitive:RandomGateway` | `bpmn:ExclusiveGateway` | `streamline-flex--dice-5` | `algorithm` (AssignmentAlgorithmEnum), `probabilityFunction` (ProbabilityDistributionEnum, editable). |
| `cognitive:StratifiedAllocationGateway` | `bpmn:ExclusiveGateway` | `mdi--layers-outline` | `stratificationVariable`, `strata` (Markdown[]), `algorithm`, `probabilityFunction`. |
| `cognitive:EligibilityGateway` | `bpmn:ExclusiveGateway` | `mdi--filter-check-outline` | `inclusionCriteria` (Markdown[]), `exclusionCriteria` (Markdown[]). |
| `cognitive:Actor` | `bpmn:Participant` *(pool)* | `mdi--account-group` | `actorType` (ActorTypeEnum), `spec`, `promptTemplate` (if `llm`). Needs a Collaboration root. |

**Templates:** *Video Game* — a `CognitiveTask` whose `instrument` is a game
engine · *N-Back (XCIT_NB_01)* (a `BehaverseTask` running a built-in timeline) ·
*N-Back (inline)* (a `BehaverseTask` with inline block overrides).

```yaml
NBack:
  type: bpmn:Task
  name: Working memory (N-Back)
  extensionElements:
    - type: cognitive:CognitiveTask
      instrument: psychopy
      configurations: |
        n: 2
        trials: 60
        stimulus_duration: 0.5
```

### Behaverse tasks

`cognitive:BehaverseTask` is a `CognitiveTask` with `instrument` pinned to
`behaverse` — a task delivered by the Behaverse Unity runtime, formerly the
separate `behaverse` schema and now merged into cognitive. `configurations` runs
a built-in timeline by name, or an inline one with its own `Blocks`. Bots
(`agentType: bot`) drive the task via `botConfigurations`, whose `ResponseSource`
is `internal` (Unity bot), `external` (random), or `llm`.

```yaml
Task_NBack:
  type: bpmn:Task
  extensionElements:
    - type: cognitive:BehaverseTask
      scene: NB
      configurations: |
        Timelines:
          XCIT_NB_01:
```

See `bot_claude.studyflow`, `bot_ollama.studyflow`, `bot_external.studyflow`,
`agent_eval_pool.studyflow`, `cognitive_battery.studyflow`.

---

## ml — statistical & ML pipelines

Two artifact nouns plus one generic `Operation` step; every verb (split, fit,
evaluate, deploy…) is a template that binds a function to `Operation`. Icon
set: schema badge **M**.

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `ml:Operation` | `bpmn:ServiceTask` | `mdi--function-variant` | `implementation` (ref grammar); `isDataOperation` pinned true. Interface = wired data elements; args in `with`. |
| `ml:Model` | `bpmn:DataObjectReference` | `mdi--cube-outline` | `framework`, `format`, `taskType`, `target`, `hyperparameters` (YAML). |
| `ml:Metric` | `bpmn:DataObjectReference` | `mdi--gauge` | `value` (written at run time), `split` (DataSplitEnum), `goal` (MetricGoalEnum). |

**Templates** (all `ml:Operation` unless noted): Train/test split · Fit model ·
Fit formula (Wilkinson/mixed-effects) · Fine-tune (SFT/LoRA) · Preference-tune
(DPO) · Optimize prompt (DSPy) · Predict · Evaluate (sliced) · Validate data ·
Embed corpus · Register model · Deploy (`cache: never`) · Monitor drift ·
Cross-validate 5-fold (`exec:ForEach`) · Grid search (`exec:Sweep`) ·
Beats production? (`exec:Gate`).

```yaml
Fit:
  type: bpmn:ServiceTask
  name: Fit model
  extensionElements:
    - type: ml:Operation
  implementation: python://sklearn.ensemble.RandomForestClassifier
  with:
    n_estimators: 500
    class_weight: balanced
```

See `ml_pipeline.studyflow`.

---

## agentic — LLM & agent workflows

The only genuinely new elements are **Agent** (an ad-hoc sub-process with a
model) and **Router** (a model-decided branch); retrieval/judging/guardrails are
templates over `Tool`. Icon set: schema badge **A**.

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `agentic:Agent` | `bpmn:AdHocSubProcess` | `mdi--robot-outline` | `model`, `systemPrompt` (Markdown), `toolChoice` (ToolChoiceEnum), `temperature`, `maxTurns`, `completionCondition`; `deterministic` pinned false. Tools = activities drawn inside. |
| `agentic:Router` | `bpmn:ExclusiveGateway` | `mdi--sign-direction` | `model`, `instructions` (Markdown). Branch labels = outgoing flow names; falls back to `default`. |
| `agentic:LLMCall` | `bpmn:ServiceTask` | `mdi--message-processing-outline` | `model`, `prompt` (Markdown), `temperature`, `maxTokens`. |
| `agentic:Tool` | `bpmn:ServiceTask` | `mdi--tools` | `implementation`, `kind` (ToolKindEnum), `purpose` (Markdown), `sideEffects` (Boolean). |
| `agentic:HumanApproval` | `bpmn:UserTask` | `mdi--account-check-outline` | `question` (Markdown), `approvers` (String[]), `onTimeout`; `runsOn` pinned `human`. |
| `agentic:Prompt` | `bpmn:DataObjectReference` | `mdi--text-box-outline` | `template` (Markdown, `{{name}}` placeholders), `variables` (YAML). |
| `agentic:Memory` | `bpmn:DataStoreReference` | `mdi--memory` | `scope` (MemoryScopeEnum). |

**Templates:** Agent (tool loop) · Evaluator-optimizer · Route by intent ·
Retrieve context (RAG) · Judge (LLM-as-judge) · Guardrail · Human approval ·
Human feedback · Pairwise preference · Prompt chain.

```yaml
Research_Agent:
  type: bpmn:AdHocSubProcess
  name: Research agent
  extensionElements:
    - type: agentic:Agent
      model: claude-opus-4-8
      maxTurns: 8
  completionCondition: answer is not null
  flowElements:
    Search:
      type: bpmn:ServiceTask
      extensionElements: [{ type: agentic:Tool, kind: retrieval }]
      implementation: python://lab.rag.retrieve
```

See `agent_eval.studyflow`, `agent_eval_pool.studyflow`.

---

## datatrove — data-stream operations

A generic functional core (transform/map/…), read/write blocks, and a Document
reference. Corpus ops (extract, stats, tokenize, dedup) are templates. Icon set:
schema badge **D**.

| Wrapper | BPMN base | Icon | Notes |
|---|---|---|---|
| `datatrove:Transform` | `bpmn:ServiceTask` | — | Apply a function per element; `implementation`; `isDataOperation` pinned true. |
| `datatrove:Map` | `bpmn:ServiceTask` | — | Map → new stream (`operationType: map`). |
| `datatrove:FlatMap` | `bpmn:ServiceTask` | `mdi--arrow-expand-all` | One-to-many + flatten. |
| `datatrove:Reduce` | `bpmn:ServiceTask` | `mdi--sigma` | Reduce a stream to a value. |
| `datatrove:Filter` | `bpmn:ServiceTask` | `mdi--filter-variant` | Keep elements matching a predicate. |
| `datatrove:Compose` | `bpmn:ServiceTask` | `mdi--function-variant` | Compose several transforms into one step. |
| `datatrove:Reader` | `bpmn:ServiceTask` | `mdi--input` | `className` (ReaderClassEnum), `path`. |
| `datatrove:Writer` | `bpmn:ServiceTask` | `mdi--output` | `className` (WriterClassEnum), `path`. |
| `datatrove:Document` | `bpmn:DataObjectReference` | `fluent--document-text-24-regular` | `text`, `media` (String[]), `metadata` (YAML). |

A collection of Documents is a native `bpmn:DataObjectReference` with
`isCollection: true` — not a distinct type.

**Templates:** Group · Split Data (`sklearn.train_test_split`) · Anonymize Data ·
Extract text · Collect stats · Tokenize · Deduplicate.

See `function_call_demo.studyflow`, `lablink_demo2.studyflow`.

---

## omniprocess — neuroimaging preprocessing

No element types of its own — only templates over `datatrove` operations. Icon
set: schema badge **O**.

**Templates:** *fMRIPrep* (`datatrove:Map` bound to `docker://nipreps/fmriprep`)
· *EEGPrep* (`bpmn:SubProcess`: filter → remove artifacts).

---

## openbci — OpenBCI biosignals

Biosignal acquisition with OpenBCI hardware. The `device` attribute picks the
board — **Cyton** (8-ch), **Cyton + Daisy** (16-ch), **Ganglion** (4-ch), or
**Galea** (the VR headset) — so Galea is one supported device, not the whole
schema. VR-only fields (`vrDevice`) appear only when `device` is `galea`.
Session phases are ordinary BPMN tasks preset by a template. Icon set: chip.

| Wrapper | BPMN base | Icon | Key attributes |
|---|---|---|---|
| `openbci:OpenBCISession` | `bpmn:Participant` *(pool)* | `mdi--chip` | `device` (OpenBCIDeviceEnum, editable), `streamProtocol` (OpenBCIStreamProtocolEnum, editable), `modalities` (OpenBCIModalityEnum[]), `electrodeType` (OpenBCIElectrodeTypeEnum), `vrDevice` (VRDeviceEnum, editable — only when `device: galea`). Needs a Collaboration root. |
| `openbci:OpenBCIRecording` | `bpmn:DataStoreReference` | `mdi--database` | Specializes `studyflow:Dataset`; adds `modalities` (OpenBCIModalityEnum[]), `eegChannels` (4/8/16/~10 by board), `eegSamplingRateHz`. |

**Templates:** *Cyton EEG session* (non-VR: mount → impedance → baseline → task →
export) · *Galea VR session* (mount → impedance → calibration → baseline → VR
task → unmount → export).

> Note: `modalities` is an `isMany` enum. The moddle XML writer can serialize a
> **single** enum value but not a repeated one, so the companion diagram's
> OpenBCIRecording sets `format`/`eegChannels` only. In a real study, list
> modalities on the wired `studyflow:Timeseries` elements (which carry
> `samplingRate`/`channelCount`/`units`) or in `documentation`.

---

## Pools, lanes & choreography

These need a **`bpmn:Collaboration`** or **`bpmn:Choreography`** root rather than
a plain Process, so they aren't in the single-Process companion diagram:

| Element | Root needed | Example file |
|---|---|---|
| `bpmn:Participant` (Pool), `cognitive:Actor`, `openbci:OpenBCISession` | Collaboration | `spirit2025.studyflow` (pool + lanes) |
| `bpmn:Lane` / `laneSet` | Collaboration (pool with lanes) | `spirit2025.studyflow` |
| `bpmn:ChoreographyTask`, `studyflow:ChoreographyTask`, `participants`, `messageFlows` | Choreography | `choreography_demo.studyflow` |

`cognitive:Actor` tags a pool as `human` / `llm` / `agent` / `instrument` so
multi-agent studies can mix human and artificial participants under the same BPMN
choreography primitive.

---

## Enumerations reference

**studyflow** — `DatasetFormat`: bdm, bids, psych-ds, kedro · `BDMDataLevel`:
events, trials, models · `BIDSDataType`: anat, beh, dwi, eeg, func, ieeg, meg,
micr, motion, mrs, nirs, perf, pet · `TableFormat`: csv, tsv, parquet, arrow,
jsonl · `TimeseriesFormat`: edf, bdf, fif, set, parquet, zarr ·
`CompletionCodeType`: none, static, dynamic · `Runtime`: browser, cloud, local,
hpc · `AssignmentAlgorithm`: probabilistic, round-robin · `ProbabilityDistribution`:
uniform, normal, exponential, poisson.

**exec** — `RuntimeTarget`: inherit, browser, local, container, hpc, cloud, human
· `Scheduler`: slurm, pbs, sge, kubernetes · `CachePolicy`: reuse, refresh, never
· `IterationKind`: none, items, folds, grid, participants, shards · `CollectPolicy`:
list, concat, reduce, none · `PersistPolicy`: store, memory.

**cognitive** — `Instrument` *(editable)*: psychopy, jspsych, labjs, opensesame ·
`QuestionnaireInstrument` *(editable)*: phq-9, gad-7, bdi-ii, stai, pss, who-5,
bfi, dass-21, panas · `ActorType`: human, llm, agent, instrument ·
`BehaverseScene` *(editable)*: BCS, BM, BSAC, DS, ML, MOT, NB, OC, OOO, PC, RE,
RSAC, SART, SMC, SOS, SRM, SRT, SS, TH, TOVA, UFOV, WO · `AgentType`: human, bot.

**ml** — `DataSplit`: train, validation, test, holdout, live · `MetricGoal`: max, min.

**agentic** — `ToolChoice`: auto, required, none · `ToolKind`: function, retrieval,
code, search, mcp, human, subflow · `MemoryScope`: turn, run, participant, global.

**datatrove** — `ReaderClass`: CSVReader, HuggingFaceDatasetReader, IpcReader,
JsonlReader, ParquetReader, WarcReader · `WriterClass`: HuggingFaceDatasetWriter,
JsonlWriter, ParquetWriter.

**openbci** — `OpenBCIDevice` *(editable)*: cyton, cyton_daisy, ganglion, galea ·
`OpenBCIModality`: eeg, emg, ecg, eog, eda, ppg, eye_tracking, head_imu, audio ·
`OpenBCIElectrodeType`: dry, wet, hybrid · `VRDevice` *(editable)*: quest_pro,
quest_3, valve_index, varjo_xr3 · `OpenBCIStreamProtocol` *(editable)*: lsl,
brainflow, openbci_gui.

*(editable = the inspector lets you type a custom value in addition to the listed ones.)*

---

## Bundled examples by feature

| File | Shows |
|---|---|
| `kitchensink.studyflow` | **This cheatsheet as a diagram** — one of every element, grouped by schema. |
| `cognitive_battery.studyflow` | Behaverse tasks, questionnaire, timer break, dataset association. |
| `ml_pipeline.studyflow` | ml Operations, exec Sweep/Gate, agentic HumanApproval, boundary drift-retrain loop. |
| `agent_eval.studyflow` | agentic Agent/Tool, exec ForEach, ml Optimize-prompt loop, RandomGateway sampling. |
| `agent_eval_pool.studyflow` | Parallel gateway dispatching bot actors (random/Claude/Ollama). |
| `choreography_demo.studyflow` | Choreography root, participants, message flows, ChoreographyTasks. |
| `consort2025.studyflow` | Groups + Categories, boundary error events (attrition), colors. |
| `spirit2025.studyflow` | Collaboration + pool + lanes, checklists, Gantt fields. |
| `function_call_demo.studyflow` | datatrove Map bound to a python callable; script-by-URL. |
| `lablink_demo0/1/2.studyflow` | Skeleton → orchestration → modeling pipeline (BIDS, fMRIPrep/EEGPrep). |
| `bot_claude / bot_ollama / bot_external.studyflow` | Behaverse bot `agentType`/`botConfigurations` variants. |

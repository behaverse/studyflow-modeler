---
title: Data
description: Elements for data-centric workflows
---

## Data in BPMN

BPMN is primarily designed for modeling business processes, but it also includes generic constructs for representing data within workflows. Mainly, it uses *Data Object* and *Data Store* to represent elements that contain or manage data. These elements can be connected to other processes as inputs or outputs using data association edges.

- `DataStore`: Persistent storage of data that can be accessed across multiple process instances. For example, a database or file system. `DataStoreReference` can be used as a pointer to a `DataStore`.
- `DataObject`: Available for the duration of a process instance. Multiple data objects can be used within a single process instance to simplify associations. BPMN data state annotations can be used to show the condition of a data object at a specific point in a process; for example, "trial data [raw]", "trial data [processed]".
- `DataAssociation`: Defines a link between data and other workflow elements, such as tasks or events. Note that it is not part of the process flow itself.

## Data in Studyflow

Studyflow refines BPMN to better match common practices in data-centric workflows. This includes specific data structures and operations commonly used in data processing.

### Elements

- `DataCatalog`: A persistent repository of datasets that can be referenced across multiple process instances. For example, `openneuro` or `behaverse` catalogs.
- `Dataset`: A named logical collection (possibly multi-table, multi-modal). Dataset attributes may include a schema (column names, types, units) and optional ontology to connect elements to standard vocabularies.
  - `Table` (or `DataFrame`): A named tabular structure within a `Dataset`. Tables are explicitly linked to a schema via the `Dataset` or individually via a CSVW schema. Extends `DataObject`.
  - `Tensor`: special data structure for multi-dimensional arrays (e.g., images, videos, fMRI data). Extends `DataObject` and expects a schema.
- `Snapshot`: An immutable version of a dataset, a table, or a tensor. Snapshots are typically associated with a specific point in the workflow or a version control commit.

In summary, `DataStore` is a physical/persistent store (database, filesystem, S3 bucket, etc.), `DataCatalog` is a registry of datasets (potentially across multiple stores), `Dataset` is a logical collection, and `Table`/`Tensor` are concrete components of a dataset.

While experimental data is generally assumed to be in a tabular format, `Dataset` also support other data types (i.e., `DataObject`), including images, videos, brain imaging, and raw sensor recordings.

### Operators

Data operators define how data is manipulated as it flows through the process. They are designed to facilitate data processing within workflows and inspired by [higher-order functions](https://en.wikipedia.org/wiki/Higher-order_function) in functional programming.


![Data operators are rendered as small markers/icons on standard tasks. The task remains a normal BPMN task and the operator marker specifies that its logic is a pure data transformation. This keeps Studyflow diagrams close to BPMN while making data-centric behavior explicit through operators.](../../assets/img/elements/data_operator.png)



Here are the core data operators currently supported:

- `transform`: Applies a specified transformation to the input data, producing a new dataset as output. This is the generic form of data operations and can be specialized into more specific operators (see below). A transform represents a pure function that takes one or more data as input and produces a data output.
- `map`: Applies a element-wise function to each item in the input. used for element-wise operations.
- `filter`: Selects a subset of data based on specified criteria. Used for conditional selection (1 -> subset(1)). The different between filtering and data-driven gateways in BPMN is that filtering changes the dataset, but gateways change the control flow. They are complementary.
- `reduce`: Aggregates data by applying a function that combines multiple input values into a single output value. Used for summarization or joining operations (N -> 1 per group or for the entire dataset).
- `flatMap`: Similar to map, but flattens the resulting data array into a single output array. Used for one-to-many mappings (1 -> N). Relevant to unnesting in data wrangling libraries.
- `group`: Organizes data into groups based on specified attributes. Used for categorization and clustering (1 -> G groups). It changes the data structure to a grouped format.
- `compose`: Combines multiple data operations into a single complex pipeline. Used for modularity and reusability.


## Batch vs. Streaming
Some operators are stateless (map, filter) and works best for batch processing, while others are inherently stateful (reduce, group) and may require special handling for streaming data.


## Example

The following example illustrates the use of data elements and operators within a research workflow to collect and analyze response times from a 2AFC cognitive task. The data analysis pipeline is encapsulated within a subprocess for clarity.

```{.ini}
Study RTAnalysis

  StartEvent s
  EndEvent e

  DataCatalog behaverse
    url "https://behaverse.org/catalog"

  DataStore ducklake
    kind "duckdb+parquet"
    url "s3://behaverse/rt/ducklake"

  Dataset study_dataset
    catalog behaverse
    store ducklake

  Table trials_raw
    dataset study_dataset
    schema "schema/trials_raw.csvw"

  Table trials_summary
    dataset study_dataset
    schema "schema/trials_summary.csvw"

  Activity CollectTrials
    @type CognitiveTest
    description "Run 2AFC task"

  SubProcess RTAnalysisPipeline
    StartEvent sub_s
    EndEvent sub_e

    # internal data objects (scoped to subprocess)
    DataObject trials_in
    DataObject trials_out

    # outer data associations: connect external tables to internal nodes
    dataInputAssociation
      sourceRef trials_raw          # external
      targetRef trials_in           # internal name
    dataOutputAssociation
      sourceRef trials_out          # internal name
      targetRef trials_summary      # external

    Task t1
      @in trials_in
      @out trials_out
      @op compose
        transformTables
        filter
        map
        group
        reduce

    SequenceFlow sf1 sub_s → t1
    SequenceFlow sf2 t1    → sub_e

  SequenceFlow f1 s                    → CollectTrials
  SequenceFlow f2 CollectTrials        → RTAnalysisPipeline
  SequenceFlow f3 RTAnalysisPipeline   → e
```

This is roughly equivalent to:

```{.r}
trials_summary <- trials_raw |>
  filter(correct == 1) |>
  mutate(
    log_rt = log(rt),
    rt_z   = (rt - mean(rt)) / sd(rt)
  ) |>
  group_by(agent_id, condition) |>
  summarize(
    rt_mean = mean(rt),
    rt_sd   = sd(rt),
    .groups = "drop"
  )
```


### Planned updates

- `Tensor`, `Timeseries`, `Event` data structures for multi-dimensional physiological and behavioral data.
- `transformTables`: Special case of `transform` that applies a series of transformations to tabular data, such as adding, removing, or modifying columns. The result is one or more new tables based on the specified transformations (1+ tables -> 1+ tables).
- `loadData`, `saveData`, `exportData`: storage operations (loading from and saving to catalogs, stores, and files). Note that, data operations are pure and side-effect free. I/O and external systems are handled by dedicated elements.

- `anonymizeData`, `validateData`, `controlAccess`: data governance and regulatory compliance operations (de-identification, validation, data cleaning, and access control).
- Stochastic operations (e.g., sampling, bootstrapping).
- Canonical data-wrangling operations (mirroring tidyverse functionality but expressed at workflow level):
  - `splitData` (e.g., train/validation/test splits).
  - `cleanData` (e.g., handling missing values, outliers).
  - Join/merge operators for relational integration.
  - `sort`, `arrange`, `selectColumns`, `renameColumns`, `pivot`, `select`, `mutate`, `summarize` as specialized `transformTables` variants.

---
title: Getting Started
sidebar_position: 2
---

Studyflow is a visual language for defining research workflows and scientific experiments. It builds on <abbr title="Business Process Model and Notation" class="initialism">BPMN</abbr>[**BPMN**: Business Process Model and Notation] and adds research-focused components to make it accessible to scientists.

Here is a quick, streamlined path to creating your first studyflow diagram. Once you've completed this, you can explore more advanced features in the [reference](./category/reference/) section.

## Requirements

- [Studyflow Modeler](https://behaverse.org/studyflow-modeler/) (web-based, no installation required)
- [List of Studyflow elements](reference/2-elements.md)
- A BPMN cheat sheet (optional, but helpful)

## Basic elements

A studyflow diagram is composed of a set of elements that define the structure and flow of the study. To get started, it's important to understand the core elements of the studyflow language:
[For a detailed overview of the studyflow language, please refer to the [reference](./category/reference/).]


**<i class="bi bi-circle"></i>&nbsp; Event**: circles represent the start and end of a study, as well as intermediate events that can trigger actions.

**<i class="bi bi-square"></i>&nbsp; Activity**: rectangles represent activities or steps in the study, such as cognitive tests, questionnaires, or instructions.

**<i class="bi bi-diamond"></i>&nbsp; Gateway**: diamonds represent decision points that can alter the flow of the study based on conditions or randomization.

**<i class="bi bi-file-earmark"></i>&nbsp; Data Object**: file-like shapes represent transient data produced or consumed by other elements.

**<i class="bi bi-database"></i>&nbsp; Data Store**: cylinders represent persistent data storage, such as databases. Unlike data objects, data stores retain information beyond the scope of a single study instance.

**<i class="bi bi-arrow-return-right"></i>&nbsp; Sequence Flow**: arrows connect events, activities, and gateways to define the order of elements.


Here is an example diagram:

![A simple studyflow diagram showing the experimental design of a study as a series of activities, events, and gateways.](../assets/img/studyflow_example_2.svg)


## Graphical notation

Studyflow uses a specific graphical notation to convey the semantics of each element. Different types of activities, for example, can have different icons to indicate their type:


![Icons representing different types of activities](../assets/img/core_activity_types.svg)

These icons extends the standard BPMN icons. For a complete list, see [*Reference &rsaquo; Elements*](reference/2-elements.md).

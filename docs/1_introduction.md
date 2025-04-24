---
title: "Studyflow Modeler: A tool to define and run scientific workflows"
---


# problem statement

> two problems with current scientific workflows:
> - either informal (textual description of methods in manuscripts) or 
> - custom-built (complex MLOps codes)


Current methods to describe scientific workflows are often informal (as in textual description of methods in manuscripts) or custom-built (as in complex MLOps codes), making them difficult to interpret, reproduce, or execute.


Exact description of scientific experiments is crucial for reproducibility and replicability. Current situation in cognitive science is that experiments are usually described as texts in scientific papers; sometimes, basic flowchart diagrams accompany those methods sections for improved communications. However, these diagrams are minimal, informal, and due their implicit nature cannot be readily executed. Sometimes, and most often not, they are supplemented by ad-hoc, custom codes to run the experiments, modeling, and analysis. The result is that the methods sections of scientific papers are often difficult to interpret and reproduce by other researchers. The situation is even worse when the methods are described in a language that is not the native language of the reader or a programming language that is proprietary or outdated.

Interpreting those texts and diagrams also require specialized knowledge that is not always available to all researchers, making them inaccessible to non-experts and hindering the reproducibility and replicability of the experiments.


# solution

Here we address two problems: (1) a formal way to describe scientific studies that can be interpreted and executed by both humans and machines, and (2) a proof-of-concept interface to model and run their experiments without the need for specialized knowledge.

To this end we propose Studyflow, a formal language to describe cognitive experiments, and Studyflow Modeler, a tool to model and run cognitive experiments using the Studyflow language.

Studyflow is based on BPMN (Business Process Model and Notation), a standard for business process modeling that is widely used in industry. BPMN is a graphical language that allows to formally describe processes, making them easy to understand and execute. Studyflow extends BPMN with additional elements to describe cognitive experiments, such as elements for data collection, data transformation, and other MLOps steps.


# PRD: Studyflow Modeler React Flow Reimplementation

## 1. Product overview

### 1.1 Document title and version

- PRD: Studyflow Modeler React Flow Reimplementation
- Version: 1.0

### 1.2 Product summary

This feature reimplements the modeler user interface on React Flow while preserving equivalent BPMN authoring behavior currently provided by bpmn-js. The project goal is to modernize UI architecture and editing extensibility without breaking existing user workflows or existing Studyflow BPMN XML diagrams.

The migration is explicitly phased. During migration, BPMN XML remains the source of truth for persistence and interchange. React Flow is used as the primary editing surface, and an internal graph model is introduced to bridge XML and UI state. Functional equivalence is required, not strict byte-for-byte XML identity.

Day-one parity in the first deliverable scope must include palette drag/drop, custom schema-based elements, property inspector editing, import/export flows, and SVG export with embedded Studyflow XML.

## 2. Goals

### 2.1 Business goals

- Reduce dependency on bpmn-js rendering and interaction stack for core authoring UX.
- Enable faster iteration on modeler UX through React-native state management patterns.
- Preserve user trust by maintaining equivalent diagram functionality and file interoperability.
- Deliver a controlled migration in three incremental phases executed primarily via AI agents.

### 2.2 User goals

- Continue creating and editing Studyflow diagrams with no meaningful workflow disruption.
- Use palette tools and schema-driven element creation exactly as before.
- Edit element properties through the inspector and see updates immediately on canvas.
- Open existing diagrams and export diagrams in Studyflow and SVG formats reliably.

### 2.3 Non-goals

- Full BPMN engine parity for every niche bpmn-js plugin in Phase 1.
- Replacing BPMN XML with a new persistence format.
- A complete redesign of information architecture for menus and inspector categories.
- Multi-user real-time collaboration in this migration effort.

## 3. User personas

### 3.1 Key user types

- Study designers creating cognitive experiment workflows.
- Data and MLOps practitioners using schema-backed data operation elements.
- Research engineers validating interoperability and export pipelines.
- Maintainers extending schemas and modeler behavior.

### 3.2 Basic persona details

- **Study designer**: Builds end-to-end experiment flows, relies on quick drag/drop authoring and readable labels.
- **Data workflow author**: Uses custom schema element libraries (for example omniflow operations) and expects defaults to be applied.
- **Research engineer**: Imports prior diagrams, verifies exports, and checks consistency across file formats.
- **Platform maintainer**: Maintains schema integration and verifies backward compatibility.

### 3.3 Role-based access

- **Guest user**: Can create, edit, import, and export diagrams after guest login flow initializes API key.
- **Authenticated contributor**: Same editing capabilities plus publish-related flows where enabled.
- **Maintainer/developer**: Can configure schema providers, migration flags, and compatibility tooling.

## 4. Functional requirements

- **React Flow-based modeler shell** (Priority: P0)
  - Replace bpmn-js visual canvas interactions with React Flow interactions for node/edge rendering and editing.
  - Introduce an internal graph model that maps to and from BPMN XML.
  - Keep BPMN XML as canonical source of truth for save/open/export operations.
  - Support viewport fit/reset behavior equivalent to current user expectations.

- **Palette drag/drop and creation** (Priority: P0)
  - Support click-to-create and drag-to-create flows for core BPMN entries (Start, End, Task, Group).
  - Preserve lasso/select capability with equivalent user outcomes.
  - Keep schema-specific popup creation entry points for non-core elements.

- **Schema-based custom element support** (Priority: P0)
  - Load extension schemas and expose schema prefixes in palette tools.
  - Create schema-backed elements with default property values and expected extension element payloads.
  - Preserve deterministic schema ordering behavior in UI.

- **Property inspector editing** (Priority: P0)
  - Render inspector tabs and property groups for selected element or root element.
  - Support editing string, enum, boolean, and moddle/extension-backed properties.
  - Keep property visibility logic and extension override behavior functionally equivalent.

- **Import/export and file workflows** (Priority: P0)
  - Open .studyflow files and import their XML into the graph/UI state.
  - Open .svg files that embed Studyflow XML metadata and extract/import embedded XML.
  - Save current diagram as .studyflow XML.
  - Export SVG with embedded Studyflow XML metadata and icon-safe rendering behavior.

- **Command compatibility layer** (Priority: P1)
  - Preserve high-level command interface so existing UI components can migrate incrementally.
  - Provide adapters for existing actions: create, update property, import, export, reset zoom, and schema menu flows.

- **Migration controls and observability** (Priority: P1)
  - Add feature flagging to switch editor backend by environment or runtime config.
  - Instrument critical flows (open/save/export/inspector updates) for migration confidence.

## 5. User experience

### 5.1 Entry points and first-time user flow

- User opens modeler app and guest login initializes API key.
- Modeler loads schemas and initializes React Flow editor state from default BPMN template.
- Palette and inspector are visible once editor is ready.
- User can immediately create nodes, edit properties, and export outputs.

### 5.2 Core experience

- **Create diagram elements**: User drags from palette or clicks to create nodes.
  - This preserves rapid authoring behavior expected by existing users.
- **Edit element properties**: User selects a node and edits properties in inspector tabs.
  - This preserves fine-grained metadata editing for Studyflow and extension schemas.
- **Save and export diagrams**: User saves Studyflow XML and exports SVG.
  - This ensures portability across downstream workflows and documentation.

### 5.3 Advanced features and edge cases

- Importing SVG without embedded Studyflow metadata surfaces a clear validation error.
- Custom schema element defaults must be materialized on creation.
- Inspector must fall back to root element when selection is empty or ambiguous.
- Functional equivalence allows non-semantic XML formatting differences while preserving behavior.

### 5.4 UI/UX highlights

- Keep familiar palette and inspector placement to minimize relearning.
- Maintain readable labels and immediate visual feedback after property edits.
- Preserve existing icon-based affordances and tooltip cues for creation actions.
- Maintain responsive performance on medium-sized diagrams.

## 6. Narrative

A user opens the modeler, starts a new study flow, and uses palette drag/drop to add BPMN and schema-specific elements. They select each element to configure metadata in the inspector, then save and export their work as Studyflow XML and SVG with embedded XML metadata. Behind the scenes, React Flow drives the editing UI while BPMN XML remains canonical, providing a modern front end without losing compatibility.

## 7. Success metrics

### 7.1 User-centric metrics

- At least 95% of core editing tasks completed successfully in migration UAT.
- No more than 5% increase in median time-to-first-diagram-edit versus baseline.
- At least 90% positive parity feedback from internal power users.

### 7.2 Business metrics

- Migration delivered in three planned phases within agreed scope.
- Reduction in bpmn-js-specific UI code footprint by at least 70% for modeler surface.
- No critical interoperability regressions reported in first release cycle.

### 7.3 Technical metrics

- At least 99% pass rate for existing and updated modeler E2E tests in CI.
- XML round-trip behavioral parity for all P0 scenarios.
- SVG export contains valid embedded Studyflow XML in 100% of tested exports.
- Median editor interaction latency under 50 ms for common operations on reference diagrams.

## 8. Technical considerations

### 8.1 Integration points

- Existing command bus and command types used by navbar, palette, and inspector actions.
- Schema download and moddle-extension loading pipeline.
- File open/save/export flows and existing download behavior.
- Existing authentication bootstrap for guest session setup.

### 8.2 Data storage and privacy

- BPMN XML remains canonical persisted artifact.
- SVG exports continue embedding Studyflow XML metadata.
- No new PII storage introduced by migration.

### 8.3 Scalability and performance

- Internal graph model must efficiently reconcile XML-to-graph and graph-to-XML updates.
- React Flow rendering should support medium diagrams without degraded interaction quality.
- Export pipeline should avoid blocking main interactions for large diagrams where feasible.

### 8.4 Potential challenges

- Achieving behavior parity for advanced bpmn-js interaction semantics.
- Ensuring schema-driven extension behavior remains accurate through translation layer.
- Preventing subtle XML compatibility regressions during incremental rollout.
- Coordinating AI agent output quality with human review and release guardrails.

## 9. Milestones and sequencing

### 9.1 Project estimate

- Large: 10-14 weeks total across three incremental phases

### 9.2 Team size and composition

- 4-6 equivalent contributors: AI implementation agents, AI test agents, one technical reviewer, one product/release reviewer

### 9.3 Suggested phases

- **Phase 1**: Foundation and P0 parity skeleton (3-4 weeks)
  - Key deliverables.
  - React Flow modeler shell with internal graph model.
  - BPMN XML import/save baseline working.
  - Core palette drag/drop and click-create flows.
  - Inspector scaffold with core property editing.

- **Phase 2**: Day-one parity completion (3-5 weeks)
  - Key deliverables.
  - Full schema-based element creation and default value materialization.
  - Inspector parity for extension/moddle properties and visibility rules.
  - SVG export parity with embedded Studyflow XML and icon handling.
  - Updated E2E coverage for all P0 scenarios.

- **Phase 3**: Hardening, rollout, and bpmn-js decoupling (3-5 weeks)
  - Key deliverables.
  - Feature-flagged rollout and fallback strategy.
  - Performance tuning and compatibility defect closure.
  - Documentation updates and removal of obsolete bpmn-js UI dependencies.
  - Final release readiness review and observability dashboard checks.

## 10. User stories

### 10.1 Create BPMN elements from palette

- **ID**: GH-001
- **Description**: As a study designer, I want to create Start, End, Task, and Group elements via palette click or drag so that I can rapidly author a diagram.
- **Acceptance criteria**:
  - User can click a palette item and place one element on canvas.
  - User can drag from a palette item and place one element on canvas.
  - Created elements are represented in canonical BPMN XML after save.
  - Lasso/select flow remains available and usable.

### 10.2 Create schema-backed custom elements

- **ID**: GH-002
- **Description**: As a data workflow author, I want schema-specific palette options so that I can insert domain elements with expected defaults.
- **Acceptance criteria**:
  - Schema prefixes are shown in palette tooling based on loaded schemas.
  - Selecting a schema element creates the expected extension element in XML.
  - Required default attributes are applied at creation time.
  - Schema ordering is deterministic and consistent across sessions.

### 10.3 Edit properties in inspector

- **ID**: GH-003
- **Description**: As a study designer, I want to edit element properties in inspector tabs so that I can configure behavior and metadata.
- **Acceptance criteria**:
  - Inspector updates when selection changes.
  - User can edit string, enum, and boolean values.
  - Moddle and extension properties persist correctly to XML.
  - Hidden/inapplicable properties are not shown.

### 10.4 Open existing diagram files

- **ID**: GH-004
- **Description**: As a research engineer, I want to open .studyflow and embedded .svg files so that I can continue work on existing diagrams.
- **Acceptance criteria**:
  - Opening .studyflow imports diagram and renders equivalent structure.
  - Opening compatible .svg extracts embedded Studyflow XML and imports it.
  - Invalid SVG without embedded Studyflow shows clear actionable error.
  - Diagram title updates from filename after successful open.

### 10.5 Save and export diagrams

- **ID**: GH-005
- **Description**: As a research engineer, I want to save .studyflow and export SVG so that I can share editable and presentation outputs.
- **Acceptance criteria**:
  - Save action downloads valid .studyflow XML.
  - SVG export contains embedded Studyflow XML metadata.
  - Exported SVG includes expected labels and schema-created elements.
  - Functional equivalence holds between saved XML and embedded XML semantics.

### 10.6 Maintain command-level compatibility during migration

- **ID**: GH-006
- **Description**: As a maintainer, I want an adapter-based command layer so that existing UI modules can migrate incrementally without full rewrite at once.
- **Acceptance criteria**:
  - Existing command entry points remain callable by UI components.
  - React Flow-backed implementations satisfy command outcomes for P0 actions.
  - Command errors are explicit and diagnosable.
  - Feature flag can route between legacy and new editor backends during rollout.

### 10.7 Authentication and authorization continuity

- **ID**: GH-007
- **Description**: As a user, I want guest login and API-key-gated actions to keep working so that migration does not block modeler access.
- **Acceptance criteria**:
  - Guest login flow initializes API key before editor interactions.
  - Unauthorized states do not expose protected publish actions.
  - Migration does not introduce weaker client-side handling of auth state.
  - Authentication regressions are covered by smoke tests.

### 10.8 AI-agent delivery governance

- **ID**: GH-008
- **Description**: As a product and engineering lead, I want AI-agent-generated changes to pass clear quality gates so that phased delivery remains predictable.
- **Acceptance criteria**:
  - Each phase has explicit Definition of Done and test gate.
  - Human reviewer signs off architecture and release-risk checkpoints.
  - Regression test suite runs for all P0 workflows before phase completion.
  - Rollback strategy exists for each phase release candidate.
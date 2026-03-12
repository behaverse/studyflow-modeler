---
title: "Playwright UI Testing Strategy for Studyflow Modeler"
category: "Architecture & Design"
status: "🟢 Complete"
priority: "High"
timebox: "1 week"
created: 2026-03-12
updated: 2026-03-12
owner: "Morteza"
tags: ["technical-spike", "architecture-and-design", "research", "playwright", "ui-testing"]
---

# Playwright UI Testing Strategy for Studyflow Modeler

## Summary

**Spike Objective:** Determine the right Playwright-based UI testing strategy for the Studyflow Modeler, including environment setup, stable selectors, test data, and the first high-value end-to-end scenarios.

**Why This Matters:** The app currently has no browser automation setup, and core user flows depend on asynchronous modeler bootstrapping, a guest-auth startup path, BPMN canvas interactions, and file-oriented actions. Those constraints affect whether UI tests will be reliable and maintainable.

**Timebox:** 1 week

**Decision Deadline:** 2026-03-19

## Research Question(s)

**Primary Question:** What Playwright architecture and conventions should this repository adopt to implement reliable UI tests for the Studyflow Modeler?

**Secondary Questions:**

- How should tests wait for the app to move from startup state into a ready modeler state without flakiness?
- Which user journeys should be covered first, and which ones should remain out of scope until better selectors or fixtures exist?
- What minimal app changes, if any, are needed to make BPMN canvas interactions and file/export flows testable?

## Investigation Plan

### Research Tasks

- [x] Audit the current app startup and modeler initialization flow for Playwright readiness.
- [x] Evaluate Playwright project structure, config, and CI/dev-server integration for this Vite app.
- [x] Identify reliable selectors and note where dedicated `data-testid` hooks may be required.
- [x] Create a proof of concept covering guest entry and modeler-ready smoke validation.
- [x] Document recommended first-wave UI scenarios and implementation guidance.

### Success Criteria

**This spike is complete when:**

- [x] A recommended Playwright setup is documented for local development and CI.
- [x] The app's main sources of UI-test flakiness are identified with mitigations.
- [x] Clear recommendation documented.
- [x] Proof of concept completed for at least one core smoke flow.

## Technical Context

**Related Components:** App shell in `src/app.tsx`, startup/auth flow in `src/v1/StartUpModal.tsx`, modeler initialization in `src/v1/Modeler.tsx`, navigation/menu actions in `src/v1/navbar/`, palette and inspector panels in `src/v1/palette/` and `src/v1/inspector/`.

**Dependencies:** This decision should be resolved before adding a permanent Playwright config, CI job, or broad UI test suite.

**Constraints:**

- The app starts behind a startup flow, but currently auto-authenticates as guest through `startup-auto-guest`.
- The BPMN modeler is created asynchronously after schema download and XML import.
- Core interactions include canvas-driven behavior that may be harder to automate than form-driven UI.
- The UI currently exposes few explicit test hooks such as `data-testid` attributes.
- Some user actions involve file download or export behavior that may require Playwright download assertions or mocking.

## Research Findings

### Investigation Results

Research started on 2026-03-12.

Initial observations from repository review:

- The project is a Vite + React application with no Playwright dependency or test scripts in `package.json`.
- The app transitions into the main modeler UI once the API key context is populated.
- Startup currently attempts automatic guest entry, which may simplify smoke-test bootstrapping.
- The modeler view depends on async schema download and BPMN XML import before the navbar, palette, and inspector become available.
- Documentation-focused MCP discovery completed before research. Relevant candidates found in the GitHub MCP Gallery were `Context7` for up-to-date code documentation and `Playwright MCP` for browser automation, but neither is available in this session.
- Decision: proceed without MCP installation and use built-in repository, web fetch, and GitHub research tools for this spike.

Validated Playwright documentation findings:

- Playwright's `webServer` config is the correct way to start and reuse a local dev server for tests. Official guidance recommends pairing it with a `baseURL` and `reuseExistingServer: !process.env.CI`.
- Playwright locators should prefer user-facing contracts such as `getByRole`, `getByLabel`, `getByText`, `getByTitle`, and `getByTestId`. CSS and XPath should be avoided except as a last resort.
- Playwright auto-waits for actionability and retries web-first assertions, which reduces the need for manual sleeps if the app exposes a reliable ready condition.
- Download flows should be tested with Playwright download events and `acceptDownloads: true` rather than ad hoc filesystem assumptions.
- Upload flows are supported through `setInputFiles`, which aligns with the app's hidden file input in the open-file action.
- External or non-deterministic network behavior should be isolated with `page.route`, `context.routeFromHAR`, or targeted request mocking.

Repository-specific findings:

- The Vite app uses `root: './src'` and exposes multiple HTML entries. The modeler entry is `src/app.html`, and the public landing page links to it as `app`, so Playwright should target the modeler route directly rather than the marketing page.
- The startup flow is currently favorable for smoke tests because `startup-auto-guest` immediately resolves with `apiKey: 'guest'`, allowing the app to move past the modal without third-party auth dependencies.
- Modeler readiness is asynchronous but locally deterministic: `download-schemas` fetches bundled schema files from app assets, then `create-modeler` imports the bundled starter BPMN XML. This means the default boot path does not depend on a remote API.
- Existing UI affordances already provide some stable selectors: startup form labels and placeholders, top-level menu button text (`File`, `View`, `Help`), action button text (`Simulate`), and several `title` attributes on palette and toolbar actions.
- The app still lacks a dedicated test contract for the most brittle areas, especially the modeler canvas root, palette root, and any explicit "ready" marker after modeler initialization.
- The file-open flow is a strong early candidate for automation because it is backed by a real file input and local XML import logic.
- Save and export behaviors are mostly local browser flows, but SVG and PNG export can trigger remote icon fetches to Iconify during export, which introduces external-network risk unless mocked.
- Publish is not a good first-wave scenario because it posts the generated XML to `https://api.behaverse.org/v1/studies/...`, which would require controlled credentials or network mocking.
- Canvas-heavy interactions are possible with Playwright mouse primitives, but they are the highest-flake area and should not be the first automation slice unless the app adds explicit hooks or helper abstractions.

### Prototype/Testing Notes

Validated on 2026-03-12 with a local Playwright smoke test.

Prototype summary:

- Playwright was added to the repository along with a root-level `playwright.config.ts`.
- The proof of concept test lives in `tests/modeler.smoke.spec.ts` and uses `tests/utils.ts` to navigate directly to `/app` and wait for the modeler ready contract.
- A second Playwright spec in `tests/modeler.file.spec.ts` validates local file open and `Save As...` download flows.
- Minimal app hooks were added for `modeler-app`, `modeler-ready`, `modeler-canvas`, `palette-root`, `inspector-shell`, `inspector-root`, and `modeler-loading`.
- The current Playwright suite passed locally via `npm run test:e2e`.

### External Resources

- https://playwright.dev/docs/intro
- https://playwright.dev/docs/test-webserver
- https://playwright.dev/docs/locators
- https://playwright.dev/docs/actionability
- https://playwright.dev/docs/best-practices
- https://playwright.dev/docs/mock
- https://playwright.dev/docs/input
- https://playwright.dev/docs/api/class-page
- https://playwright.dev/docs/downloads
- https://github.com/mcp
- https://github.com/mcp/upstash/context7
- https://github.com/mcp/microsoft/playwright-mcp
- https://github.com/microsoft/playwright/tree/main/docs/src/test-webserver-js.md

## Decision

### Recommendation

Adopt Playwright for end-to-end UI testing with a staged architecture:

1. Start with a single `chromium` project and a dedicated `tests/` test directory.
2. Use Playwright `webServer` to run the Vite dev server with a fixed host and port, and configure `baseURL` to the modeler route.
3. Build a small fixture layer around "modeler ready" navigation instead of repeating raw waits in every test.
4. Standardize selectors around accessible names first, then add a minimal set of `data-testid` attributes only for the canvas-driven and async-ready surfaces that are currently hard to target safely.
5. Limit first-wave coverage to deterministic smoke flows: modeler boot, top-level navigation visibility, file open, save/download, and simulation toggle.
6. Defer publish, SVG/PNG export, and precise drag-drop canvas creation until mocks or explicit test hooks are in place.

### Rationale

This architecture fits both Playwright guidance and the current codebase.

- It aligns with Playwright's recommended use of `webServer`, `baseURL`, user-facing locators, web-first assertions, and explicit download handling.
- It matches the app's deterministic boot path: guest startup is local, schemas are bundled, and the starter diagram is fetched from app assets.
- It avoids the flakiest surfaces initially. The palette, popup menus, and BPMN canvas are not impossible to automate, but they do not yet expose a clean testing contract.
- It keeps network-sensitive flows out of the first wave. Publish depends on the Behaverse API, and export can reach Iconify, so both should be isolated behind mocks or HARs before they become required CI coverage.
- It creates a path to scale later. Once a small fixture layer and a few `data-testid` contracts exist, the suite can expand into richer diagram-editing scenarios.

### Implementation Notes

Recommended Playwright test architecture:

- Test location: `tests/` with small shared helpers and optional `hars/` for later network replay.
- Config: `playwright.config.ts` at the repo root using `testDir: './tests'`, `reporter: 'html'`, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, and `acceptDownloads: true`.
- Browser strategy: start with `chromium` only. Add Firefox and WebKit after the smoke suite is stable.
- CI strategy: `retries: 2` on CI, `workers: 1` on CI initially, and `reuseExistingServer: !process.env.CI` for local iteration.
- Dev server strategy: run `npm run dev -- --host 127.0.0.1 --port 4173` through Playwright `webServer` and use `baseURL: 'http://127.0.0.1:4173'`.
- Navigation strategy: tests should open `/app` directly and use a helper such as `gotoModeler(page)` that waits for the loading state to disappear and asserts the modeler shell is visible.

Recommended readiness contract:

- Short term, use existing visible UI markers such as the disappearance of the loading spinner plus visibility of `File`, `View`, and `Help` menu buttons.
- Better medium-term option: add explicit `data-testid` markers for `modeler-ready`, `modeler-canvas`, `palette-root`, and `inspector-root`.

Recommended locator strategy for this repo:

- Use `getByLabel` for startup and publish form fields.
- Use `getByRole` for menu buttons and interactive dialog buttons.
- Use `getByText` for visible labels like `Simulate`, `Open File...`, and success/error messages.
- Use `getByTitle` temporarily for palette buttons that already expose `title` text.
- Add `data-testid` only where the UI is otherwise canvas- or icon-driven.

Recommended first-wave scenarios:

- Smoke: open `/app`, wait for ready state, assert top navigation and palette are visible.
- File open: open the file menu, upload a known `.studyflow` or `.svg` test fixture via `setInputFiles`, assert the diagram name or imported state changes.
- Save: trigger `Save As...` and assert a `.studyflow` download occurs.
- Simulation: toggle `Simulate` and assert the button label changes to `Stop Simulation`, then back again.
- Help/docs: verify the docs link is exposed and correctly targets the docs path.

Implemented so far:

- Smoke scenario in `tests/modeler.smoke.spec.ts`.
- File open and save/download scenarios in `tests/modeler.file.spec.ts`.

Recommended deferred scenarios:

- Publish, until request mocking or a test environment for the Behaverse API exists.
- SVG/PNG export, until Iconify fetches are stubbed or made deterministic.
- Drag-create and detailed canvas authoring, until the canvas root and created elements have reliable hooks.

Recommended minimal app changes to support stable tests:

- Add `data-testid` attributes to the modeler shell, palette root, canvas root, file menu trigger, and publish dialog.
- Add one explicit DOM marker for "modeler initialized" after `setModeler` succeeds.
- Consider adding one helper attribute or visible label to newly selected canvas elements so inspector-driven assertions are easier.

Recommended mocking approach for later phases:

- Use `page.route` for the Behaverse publish endpoint in isolated tests.
- Use `page.route` or `routeFromHAR` for Iconify requests during export-related tests.
- Keep default smoke tests free of external network requirements.

### Follow-up Actions

- [x] Create a minimal Playwright proof of concept with one modeler smoke test.
- [x] Confirm recommended Playwright config and folder layout.
- [x] Add the minimum required `data-testid` hooks for modeler readiness and canvas targeting.
- [x] Define the first 3 to 5 UI scenarios to automate.
- [ ] Create implementation tasks.

## Status History

| Date       | Status         | Notes                    |
| ---------- | -------------- | ------------------------ |
| 2026-03-12 | 🔴 Not Started | Spike created and scoped |
| 2026-03-12 | 🟡 In Progress | MCP options reviewed, repository analysis and Playwright research underway |
| 2026-03-12 | 🟢 Complete    | Playwright setup implemented and smoke test validated locally |

---

_Last updated: 2026-03-12 by Morteza_
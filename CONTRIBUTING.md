# Contributing

## Questions, requests and reviews

You don't need to know the code. Open an [issue](https://github.com/behaverse/studyflow-modeler/issues/new/choose), one topic per issue, and say in plain words what you want your study to do, what you tried, and where you got stuck. Attach your study file (`.studyflow.yaml`) if you have one. [The documentation](https://behaverse.org/studyflow-modeler/docs/) explains how Studyflow works.

- A long review can be one issue. We answer it point by point in a comment, and open a separate issue for each change it leads to.
- Keep the conversation in the issue: edit your text or add a comment, rather than changing a file in a repository. GitHub keeps every version.
- A closed issue is either done or declined, and its last comment says which, and why.
- Agents follow the same rules: read [AGENTS.md](AGENTS.md) and the documentation first, cite files at a commit, and reply in comments.

## Changes to the code

The initial version of the studyflow modeler was fully developed by human, but most of the code is now generated at a different level of abstraction by artificial agents under the human direction. We read every diff and then merge.

The most useful contributions may carry knowledge that AI agents do not already have. Examples: a skill that generates studyflow diagrams, a domain-specific extension schema for a particular use case (a schema is roughly a structured skill), example diagrams, partial runners, or a bug report that includes the diagram reproducing it.

Hand-written PRs are still welcome and go through the same review as the automated ones. No AI tool is required to contribute.

To set up, `npm install`. Before you send a change, `npm run typecheck && npm run lint && npm run test:unit` must pass, which is what CI runs, and `npm run test:e2e` too when it touches the modeler or the canvas. [AGENTS.md](AGENTS.md) maps the repo and lists its rules.

---
name: storyboard
description: "Shows a study as the session one participant goes through: its steps as cards in order, with when each begins and how long it lasts. Use to read or build a linear session without the flow."
license: MIT
---

**Off for now.** This file names no `modeler` module, so the modeler does not load the skill. To turn it on, add this
to the front matter, and take the `.skip` off `tests/storyboard.spec.ts`:

```yaml
metadata:
  modeler: "modeler.ts"
```

The storyboard shows a study in the modeler as the session one participant goes through, in the canvas's place: a
card per step in order, with when it begins and how long it lasts, and the session's total. A + between two cards
puts a step on the flow that joins them, and a selected card shows its fields. The nav bar then offers it beside Flow.

It follows one path: at a choice it takes the default flow, else the first. It shows no data, no messages, and in a
study with pools only the pool a person plays.

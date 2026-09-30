# The walk, as the local runtime hosts it

What the walk (`packages/core/src/engine`) does with a study on this machine: what a re-run skips, how messages
travel between pools, how an activity repeats or is ended, and where the state lives. What a partial runner is told
and hands back is the contract in [SKILL.md](SKILL.md).

## Re-runs

A step is skipped when its record still stands: nothing it reads was re-made earlier in this run, its
outputs are where it left them, and the commit its record names still holds what it ran with — every artifact it reads
or makes, compared by git itself, and its own drawing (at a gateway, the flows it weighs too), read back out of the
study that commit carries. Each run leaves the study it walks in its repository before its first step, named and
spelled as the original is. So editing a step, a condition or a file it reads re-runs that step and whatever reads
what it re-makes, and nothing else. An output the worktree has lost comes
back from the commit that made it. A record naming no commit cannot be checked, so its step runs once more and leaves
one.

A run in a repository whose history holds an earlier run redoes that run: it walks the study from its start again,
reusing what still stands. So it starts from the state that run started from, as the study archived at that run's
`started` commit holds it (after `--from`, the run the branch point is in), and what it walks again counts, and
draws, as it did then: a random gateway deals its subjects the arms it dealt them. The timeline of runs,
`_meta.prov`, is history, and keeps growing.

## Messages

Pools talk only along message flows, and the walk carries every message: `{"id", "flow", "content", "inReplyTo"?}`.

- An element no runner claims does its own. An activity sends its data inputs along each flow out of it, as a mapping of source id to value; a data element with no value this run gives its `uri`, else null, and the receiver reads it from the plan. Then, if a flow comes into it, it waits for the next message along one and takes its content as its result, into its data outputs through their `transformation`s. So a send task sends, a receive task receives, and a task with flows both ways to one pool asks it. A catch or start event with a flow into it waits for a message. A throw or end event sends one carrying null.
- A step with no message flow of its own exchanges along the nearest enclosing sub-process's, else along its pool's, so a collapsed sub-process or a pool carries the exchange its steps make, lanes and all; a step with flows of its own inherits none. An unclaimed step inherits only when it has data inputs to send, and then only the flows to and from other pools, never a pool's once-only message to a step in another pool; like any step that talks, it never skips or replays.
- A claimed element's runner does its own while it runs, and a participant with no process is a pool a runner may claim: each message sent to it is one hand-off, and the runner's result is the answer ([SKILL.md](SKILL.md), "Messages").
- A pool whose actor's `memory` is `conversation` keeps one conversation with each instance of the pool asking it, for the run: the walk counts its exchanges, and its runner keeps what was said ([SKILL.md](SKILL.md), "Messages").
- What an element sends answers the message its pool last took from the target's pool, by `inReplyTo`.
- An event-based gateway takes the branch whose message comes first: each branch starts at a catch event or a receive task a message flow reaches, and that step takes the message. Its decision is never replayed.
- An element with message flows never replays. A wait with nothing left to send it, because every sender's pool has ended, fails the run.

## Repeats

- A standard loop marker repeats its activity while `loopCondition` holds, up to `loopMaximum`, and with no condition until a boundary event ends it.
- A multi-instance marker runs its activity `loopCardinality` times, whichever way `isSequential` reads: the instances run one after another, re-entering the activity's scope each time, so the parallel marker is honoured in order of completion only. When its `loopDataInputRef` names a list this run holds (a property, its declared `value` until a data edge writes one, or a data object's value), it runs once per item instead, and `loopCardinality` is ignored: each pass binds its item under the `inputDataItem`'s name in the activity's own scope (`state.<activity id>.<name>`, `{name}` to the steps inside, a name to its expressions), takes what that scope holds under the `outputDataItem`'s name once the pass is done, and after the last pass the list of them is stored into the `loopDataOutputRef` element. While a repeating activity runs, `state._meta.instance.<id>` is the pass it is on, 1-based, so a step inside knows which instance it is serving.
- A pool whose participant carries a `participantMultiplicity` runs its process `maximum` times the same way: the instances run one after another, the pool's scope is re-entered for each, `state._meta.instance.<pool id>` is the instance it is on, and a pool it talks to along message flows answers each instance in turn; a flow from that participant to a step in another pool is the whole pool's message, sent once, carrying null, after the last instance has ended, and a wait on it holds while the instances run.
- A lane set on a process or a sub-process is a partition of the drawing: the walk reads through it.
- What repeats never skips or replays on a re-run, whether it sits in an activity with a loop or a multi-instance marker or in a pool of several instances: a record keeps an element's last pass only, so replaying it would give every pass the last one's outcome (every subject the last subject's arm).

## Boundary events and timers

- A message at a boundary event ends the activity it sits on at that pool's next step, and the walk goes on from the event.
- A timer event (`timeDuration`, `timeDate`, ISO 8601) waits for its time. At a boundary event the timer runs from the moment its activity is entered; when it runs out the activity ends there, the walk goes on from the event, and a hand-off in progress is stopped (its runner is told `cancel`), whatever it had done.
- A step that fails ends the same way when it carries an error boundary event (one with an `errorEventDefinition`): the record keeps the error, the run is not failed, and the walk goes on from the event; without one the failure ends the run. An error end event inside a sub-process ends that sub-process at its own error boundary event.
- A step that finishes takes that path too when it carries a conditional boundary event (one with a `conditionalEventDefinition`) whose `condition` holds. It is read once the step's result and bindings are adopted, by the evaluator and `language` rule a sequence flow's `conditionExpression` gets, with `{placeholders}` resolved as everywhere else, so `{Play.failedTrialRate} > 0.2` reads the step's own result.

## State

The run's values carry the study's state tree under `state` (`state.<scope>.<property>`, `state._meta`). `state._meta.reached.<id>` counts, over the study's runs, the tokens that reached each element and that took each sequence flow, so a flow's label may cite `{reached}` as a node's does. A data edge into a declared property writes it (`state.<scope>.<name>`), and so does a value a runner binds under the property's own id; re-entering a scope re-initialises both.

## Where the walk departs from BPMN 2.0

The walk is a profile of BPMN 2.0's execution semantics, one token per pool. Where it reads a construct otherwise
than the specification does, it says so here, and `studyflow validate` refuses or warns about the construct:

- **One path per pool.** A parallel split, an inclusive or complex gateway with several outgoing flows, and an
  activity or event with several outgoing flows are refused. A parallel, inclusive or complex join, which BPMN waits
  at for each path it joins, is passed as the one token arrives (a warning). A scope with several start events starts
  at the first only (a warning).
- **A gateway's fallback.** When no condition holds, an exclusive gateway takes its default flow, else its one flow
  without a condition; BPMN would take every unconditioned flow.
- **Repeats run in order.** A multi-instance marker's instances, parallel or not, run one after another, and so do
  the instances of a pool with a `participantMultiplicity`, which share the study's counts and meet the pools they
  talk to in turn. A random gateway draws for each instance on its own (its participant number and its visit), so the
  order does not change what it draws.
- **A pool's messages.** A step with no message flow of its own exchanges along its enclosing sub-process's or its
  pool's (see [Messages](#messages)). A flow out of a pool of several instances to a step in another pool is sent once,
  after the last instance, where BPMN would send one per instance, each starting an instance of the receiver.
- **A conditional boundary event** is read once, when its activity's step has finished and its result is adopted; BPMN
  fires it whenever its condition becomes true while the activity runs. A step that is last in its sub-process reads
  the same either way.
- **A timer cycle** waits for its first firing only (a warning).
- **Choreography tasks in a process.** A skill's task drawn as a choreography task with bands (a cognitive task)
  sits in a process's flow, where BPMN defines choreography tasks only in a choreography. The BPMN XML the study is
  written as is checked against the OMG's schema by `validate`, which says where it departs.
- **Data elements are the study's.** A step in one pool may read or write a data object or data store reference drawn
  in another; BPMN scopes a data object to its process, and shares a store through a `dataStore` root element that
  each process references.

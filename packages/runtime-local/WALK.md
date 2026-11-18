# The walk, as the local runtime hosts it

What the walk (`packages/core/src/engine`) does with a study on this machine: what a re-run skips, how messages
travel between pools, how an activity repeats or is ended, and where the state lives. What a partial runner is told
and hands back is the contract in [CONTRACT.md](CONTRACT.md).

## What executes each element

| Element | Browser | Local |
|:--|:--|:--|
| start and end events | the consent screen; the completion screen, its code, the redirect | reached and recorded |
| an activity a skill plays | its screen | a hand-off to the runner that claims it |
| an activity with an `implementation` | a screen showing the call it names | its scheme's runner calls it, with the drawn data edges bound |
| any other activity | a generic screen | passed over |
| a sub-process | walked one level in, its properties a scope of their own | the same |
| a data store | the study's one value, which a link may set | the same, kept in the executed copy for the next run |
| a data element with a `uri` | held for the session; nothing is loaded or saved | loaded and saved there |
| a timer | waits, showing the time left; at a boundary event it ends the step | the same, and the step's runner is stopped |
| a loop or multi-instance marker | one pass after another | the same |
| a boundary event | error, conditional | error, conditional, message |
| a message flow | carried between the pools the page walks; a person's pool is the person at the page | carried pool to pool; a pool with no process is played by the runner that claims it |

A browser session is one participant. It refuses a study it cannot run faithfully: a concealed or stratified allocation, or a message flow to a pool no one in the page plays.

| Reader | Fills placeholders |
|:--|:--|
| the canvas and exported figures | from the last run's state, else from the values the file declares; the file keeps the placeholder |
| a local run | in a step's attributes, as it hands the step to its runner |
| a browser run | once, before the walk, with the link's values over the file's |

## Re-runs

A step is skipped when its record still stands: nothing it reads was re-made earlier in this run, its
outputs are where it left them, and the commit its record names still holds what it ran with — every artifact it reads
or makes, compared by git itself, and its own drawing (at a gateway, the flows it weighs too), read back out of the
study that commit carries. Each run leaves the study it walks in its repository before its first step, named and
spelled as the original is. So editing a step, a condition or a file it reads re-runs that step and whatever reads
what it re-makes, and nothing else. An output the worktree has lost comes
back from the commit that made it. A record naming no commit cannot be checked, so its step runs once more and leaves
one.

A repository that keeps its data out of its history (`--data-outside-history`) holds each file's SHA-256 in
`data.sha256` instead of the file, and a re-run compares a step's artifacts with the digests its record's commit holds.
An output the run directory has lost, or holds otherwise, cannot come back from there: a re-run that needs it stops and
names it rather than make another. A branch point's checkout leaves the files where they are, and the steps the
re-run redoes write theirs again.

A run in a repository whose history holds an earlier run redoes that run: it walks the study from its start again,
reusing what still stands. So it starts from the state that run started from, as the study archived at that run's
`started` commit holds it (after `--from`, the run the branch point is in), and what it walks again counts, and
draws, as it did then: a random gateway deals its subjects the arms it dealt them. The runs' own records, on the
study's root, are history, and keep growing.

## Messages

Pools talk only along message flows, and the walk carries every message: `{"id", "flow", "content", "inReplyTo"?}`.

- An element no runner claims does its own. An activity sends its data inputs along each flow out of it, as a mapping of source id to value; a data element with no value this run gives its `uri`, else null, and the receiver reads it from the plan. Then, if a flow comes into it, it waits for the next message along one and takes its content as its result, into its data outputs through their `transformation`s. So a send task sends, a receive task receives, and a task with flows both ways to one pool asks it. A catch or start event with a flow into it waits for a message. A throw or end event sends one carrying null.
- A choreography task a skill types whose band names a pool a program answers (a model, a simulated actor), and that has no message flow of its own, exchanges with that pool as a pair of message flows of its own would carry it: its band is its exchange, and needs no flow drawn ([CONTRACT.md](CONTRACT.md), "The plan"). Those flows outrank the ones it would inherit. Unclaimed, it asks only when it has data inputs to send, as a step asks along the flows it inherits. `studyflow validate` refuses a typed choreography task with something to send that names no one on its band and has no message flow to exchange along, in a study with a pool a program answers.
- A step with no message flow of its own exchanges along the nearest enclosing sub-process's, else along its pool's, so a collapsed sub-process or a pool carries the exchange its steps make, lanes and all; a step with flows of its own inherits none. A step at the top of a process a call activity calls exchanges as one inside that call activity would. An unclaimed step inherits only when it has data inputs to send, and then only the flows to and from other pools, never a pool's once-only message to a step in another pool; like any step that talks, it never skips or replays.
- A claimed element's runner does its own while it runs, and a participant with no process is a pool a runner may claim: each message sent to it is one hand-off, and the runner's result is the answer ([CONTRACT.md](CONTRACT.md), "Messages").
- A pool whose runner fails a message answers nothing, and the step that asked fails with the pool's failure, as it would with its own: an error boundary event on it, or on an activity around it, catches the failure, by the `errorCode` the pool's runner gave when the event names an error, and with nothing to catch it the run fails. A step a runner is running is stopped first, and what it had handed back is kept.
- A pool whose actor's `memory` is `conversation` or `window` keeps one conversation with each instance of the pool asking it, for the run: the walk counts its exchanges, and its runner keeps what was said ([CONTRACT.md](CONTRACT.md), "Messages").
- What an element sends answers the message its pool last took from the target's pool, by `inReplyTo`.
- An event-based gateway takes the branch whose event comes first: a message at a catch event or a receive task a message flow reaches, which that step then takes; a timer catch event's time; or a conditional catch event's condition holding. Messages already waiting go first, in the order of the branches, then a timer that has run out, then a condition that holds, and a timer or conditional event the gateway saw happen is passed at once. Its decision is never replayed.
- An element with message flows never replays. A wait with nothing left to send it, because every sender's pool has ended, fails the run.
- A pool's runner may leave a message unanswered (`noReply`, a participant who never replies): nothing goes back, and the step that asked waits on, until a boundary event of an activity around it ends the wait, a timer for a subject who never came back. When every pool still walking waits so, or for each other, and no timer runs that could end a wait, the run fails as stuck rather than wait for ever.

## Repeats

- A standard loop marker repeats its activity while `loopCondition` holds, up to `loopMaximum`, and with no condition until an interrupting boundary event ends it.
- A multi-instance marker runs its activity `loopCardinality` times, whichever way `isSequential` reads: the instances run one after another, re-entering the activity's scope each time, so the parallel marker is honoured in order of completion only. When its `loopDataInputRef` names a list this run holds (a property or a data store, its declared `value` until a data edge writes one, or a data object's value), it runs once per item instead, and `loopCardinality` is ignored: each pass binds its item under the `inputDataItem`'s name in the activity's own scope (`state.<activity id>.<name>`, `{name}` to the steps inside, a name to its expressions), takes what that scope holds under the `outputDataItem`'s name once the pass is done, and after the last pass the list of them is stored into the `loopDataOutputRef` element. Its `completionCondition` is read after each pass, with the output item and BPMN's `loopCounter`, `numberOfInstances` and `numberOfCompletedInstances` bound: once it holds, no further pass runs, and the list holds the passes that ran. While a repeating activity runs, `state._meta.instance.<id>` is the pass it is on, 1-based, so a step inside knows which instance it is serving.
- A pool whose participant carries a `participantMultiplicity` runs its process `maximum` times: the instances start in order, one after another unless the run is given a concurrency (`studyflow run --concurrency N`, at most N walking at once), each on a token and with values of its own (the properties of its process and of every element inside it, what its steps produced, and `state._meta.instance.<pool id>`, the instance it is on) over the study's, which every instance shares (the counts, the data stores and data objects, the other pools), and the run ends with the last instance's, and a pool it talks to along message flows answers each instance in turn, the answer going to the instance that asked alone; a flow from that participant to a step in another pool is the whole pool's message, sent once, carrying null, after the last instance has ended, and a wait on it holds while the instances run. Each event an instance's steps, messages and answers add to the run's record names the participant, `participant: "<pool id>#<instance>"`, so the events of instances walking at once stay apart; the whole pool's message names none.
- An ad-hoc sub-process runs round after round every activity nothing flows into inside it, all at once, or one after another in the order drawn when its `ordering` is `Sequential`, each going on along its flows. Its `completionCondition` is read after each activity inside it ends: once it holds, the sub-process ends, stopping what still runs inside it, or, with `cancelRemainingInstances` false, letting that finish while no activity starts. A round after which it does not hold starts the next; with no condition, one round ends it.
- An activity's thousand-and-first pass stops the run, and so does an ad-hoc sub-process's thousand-and-first round and a path's thousand-and-first step in one process or sub-process: what would not end is stopped rather than left running. `studyflow validate` refuses a standard loop marker with neither a `loopCondition` nor a `loopMaximum` and no interrupting boundary event but a conditional one, which is read only once the loop is done.
- A lane set on a process or a sub-process is a partition of the drawing: the walk reads through it.
- What repeats never skips or replays on a re-run, whether it sits in an activity with a loop or a multi-instance marker or in a pool of several instances: a record keeps an element's last pass only, so replaying it would give every pass the last one's outcome (every subject the last subject's arm).

## Sub-processes and calls

- A process or sub-process starts at its start event, the first when it has several, or, with none, at every flow node nothing flows into, each a path of its own; one with nothing inside it ends at once.
- A call activity walks the process its `calledElement` names in its place, as it would a sub-process, and that process's properties start afresh for each call. Such a process is no pool of its own: the walk walks it only where it is called, its steps belonging to the pool of the first activity calling it. One that names no process of the study passes as an activity a runner may claim, and one that calls a process the path is already inside fails the run.

## Boundary events and timers

- A message at a boundary event ends the activity it sits on as it comes, and the walk goes on from the event, which holds the message's content; a hand-off in progress inside the activity is stopped (its runner is told `cancel`), whatever it had done.
- A timer event (`timeDuration`, `timeDate`, ISO 8601) waits for its time. At a boundary event the timer runs from the moment its activity is entered; when it runs out the activity ends there, the walk goes on from the event, and a hand-off in progress is stopped (its runner is told `cancel`), whatever it had done.
- A boundary event with `cancelActivity: false` does not end its activity: each message that comes to it, and each firing of its timer (every repetition of an ISO 8601 cycle, `R3/PT10M`), starts a path from the event beside the activity, which goes on and ends as it would have.
- A conditional catch or start event waits until its `condition` holds, read again each time the run's values change; when nothing left can change them, the run fails as stuck. Exploring, and in a dry run, it passes.
- The timers wait on the machine's clock, so a rest of three weeks (`P21D`) takes three weeks. `studyflow run --clock virtual` runs them on a virtual clock instead: it starts at the run's start and passes as the machine's does, and whenever the walk is idle (no hand-off in progress, and every path waiting at a timer, for a message from another pool, or for an answer a pool's runner left unanswered) it jumps ahead to the earliest timer still waiting, which runs out. A hand-off in progress keeps it from jumping, so a timer at a boundary event never runs out ahead of an answer on its way; timers due at one moment run out in the order they were set. The run says it used it (`clock: virtual` in its own record, on the study's root, a `Prov-Clock` trailer on its commits, and its log), and what it records is timed by it: when each step began, how long a rest or a wait lasted, when each event happened. What a runner measures itself, such as a trial's latency, stays real.
- A step that fails ends the same way when an error boundary event (one with an `errorEventDefinition`) catches the failure, on the step or else on the innermost sub-process or call activity around it that carries one: the record keeps the error, the run is not failed, every scope between is ended, and the walk goes on from the event; when nothing catches it, the failure ends the run. An event or a gateway that fails is such a step, caught by the error boundary event of an activity around it: a catch or start event its runner fails, a throw or end event whose message a pool could not answer, a gateway its runner cannot sample for, one whose condition cannot be read, and one none of whose conditions holds with no default flow to take. Once the run is ending because a pool failed, a wait that fails for it is caught by nothing. An error end event throws its error out the same way, to the innermost activity around it whose error boundary event catches it; one that nothing catches ends its own path as a plain end event does. An error boundary event that names no `errorRef` catches every error, and one that names an `Error` catches that error and any other of its `errorCode`; a failure carries the code its runner hands back with it ([CONTRACT.md](CONTRACT.md)), else none, which only an event naming no error catches.
- A step that finishes takes that path too when it carries a conditional boundary event (one with a `conditionalEventDefinition`) whose `condition` holds, or, when the event has `cancelActivity: false`, a path starts from the event beside the step's own flow. It is read once the step's result and bindings are adopted, by the evaluator and `language` rule a sequence flow's `conditionExpression` gets, with `{placeholders}` resolved as everywhere else, so `unanswered > max_unanswered` reads the property the step's data edge has just written.

## State

The run's values carry the study's state tree under `state` (`state.<scope>.<property>`, `state.<data store>`, `state._meta`). `state._meta.reached.<id>` counts, over the study's runs, the tokens that reached each element and that took each sequence flow, so a flow's label may cite `{reached}` as a node's does. A data edge into a declared property writes it (`state.<scope>.<name>`), and so does a value a runner binds under the property's own id; a run starts a process's properties from their `value`, and re-entering a scope re-initialises its own. A data edge into a data store reference writes its store (`state.<store id>`), and so does a value a runner binds under the reference's id or the store's; a store keeps its value across instances and runs, and takes its `value` only when the state has none.

Paths that run at once share their scopes' state. A step's outputs are taken when it finishes, so when steps on two
such paths write one property or data element, the step that finishes last sets it, and which that is depends on how
long each takes. `studyflow validate` warns about such a pair; pools also run at once, ordered only by their messages,
and are not compared.

## Where the walk departs from BPMN 2.0

The walk is a profile of BPMN 2.0's execution semantics. A split starts a path for each flow it takes (a parallel
gateway, every flow; an inclusive gateway, or an activity or event with several flows out, each whose condition holds
and each without one, and its default flow when no condition holds), and the paths walk at once; a parallel join waits
for a token along each flow into it, an inclusive join for the tokens that can still come. A path that fails, or leaves
a sub-process at a boundary event, stops the paths beside it, and so does a terminate end event; a scope is done when
its last path ends. Where the walk reads a construct otherwise than the specification does, the table below lists it,
with what `studyflow validate` reports of it and why. A dash
means `validate` reports nothing.

| BPMN construct | How a run reads it | `studyflow validate` | Why |
|:--|:--|:--|:--|
| A process or sub-process with several start events | starts at the first, where BPMN starts at whichever is triggered | a warning | a run has one beginning |
| A process or sub-process with sequence flows and no start event, or no end event | refused, where BPMN starts every node nothing flows into and ends each path where its flows end; one with no sequence flow starts at each node it holds, as BPMN does, and so does an ad-hoc sub-process, which BPMN gives neither | an error | a well-formed study says where each path begins and ends (well-formedness condition 3) |
| A message or timer start event | the run starts each pool's instances itself, as many as the `maximum` of its `participantMultiplicity` (one without it), and the event makes each instance wait for its message or its time; BPMN starts a new instance each time the event is triggered | - | how many participants take part is the protocol's, drawn on the pool |
| A multi-instance marker, parallel or not, and a pool with a `participantMultiplicity` | the instances run one after another, each re-entering the scope; a pool's instances walk at once only when the run is given a concurrency (`studyflow run --concurrency N`), which is the run's and not the protocol's, and the record then keeps the order they reached each random gateway in | - | the instances share the study's counts and data, which then do not depend on how they interleave |
| A step with no message flow of its own | exchanges along the message flows of the nearest sub-process around it, else of its pool; a step no runner takes does so only when it has data inputs to send | - | the exchange is drawn once, on the container, and reaches no further than its border |
| A message flow from a pool's border to a step in another pool | sent once, carrying null, when the pool's last instance has ended; BPMN sends one per instance, each starting an instance of the receiver | - | a step for the whole cohort, such as the analysis, starts once, after the last participant |
| A data object, and a data store reference that names no data store | the study's: one value, shared by every pool and every instance of a pool, and kept from one pass of a sub-process to the next; BPMN gives each instance of the process or sub-process that holds a data object its own | - | the analysis reads the datasets that the participants' process writes; a value the study keeps on purpose is a data store, which BPMN shares the same way |
| An exclusive gateway none of whose conditions holds | takes its default flow, else its one flow without a condition; BPMN takes the default flow, else throws an exception | a warning where conditions on one number overlap, and an error where they leave a value no flow takes and there is no default flow | a flow drawn without a condition reads as the remaining case; overlapping conditions would be settled by the order of the flows in the file, which the drawing does not show |
| A complex gateway | stops the run where it splits, and passes each token on where it joins | an error where it splits, a warning where it joins | its activation rule is an expression the drawing does not show |
| A parallel join one of whose tokens can never come | stops the run, where BPMN waits for ever | a warning, from exploring every way the study can go | a run that cannot end is reported rather than left waiting |
| A conditional boundary event | read once, when its activity has finished (on a loop, after the last pass) and its data edges have written, one that does not interrupt then starting a path beside the activity's own flow; BPMN fires it whenever its condition becomes true while the activity runs | - | BPMN does not say when the condition is checked; one fixed point makes a run repeatable |
| A timer cycle | waits for its first firing, but at a boundary event that does not interrupt, where each firing starts a path up to the cycle's repetitions; a cron schedule passes at once | a warning, but for a repeating interval on a boundary event that does not interrupt | a run's timers are waits it can count in time, which a schedule of calendar times is not |
| An error that no error boundary event around it catches | an error end event ends its own path as a plain end event does, the paths beside it walking on, and a step's failure fails the run | - | BPMN leaves an uncaught error to the engine; an exclusion drawn as an error end event at the top of a process ends that participant's path |
| An ad-hoc sub-process | runs round after round every activity nothing flows into, all at once or, with its `ordering` Sequential, one after another, each going on along its flows; it reads its `completionCondition` after each activity, and ends after one round when it has none; BPMN leaves which activities run, and how often, to their performers | - | a run decides nothing a performer would: a choice between activities, such as the tool an agent's model names, is a gateway after the step that makes it |
| A call activity that names no process of the study, or one that calls a process it is inside | the first passes as an activity a runner may claim; the second is refused, where BPMN would call the process again | a warning; an error | the process the first names is not in the file to walk; a process calling itself repeats a number of times the drawing does not show, which a loop marker does |
| A signal, escalation, compensation, link, or cancel event | not read | an error | each acts on steps away from where it is drawn: a signal on every catcher, a link at its target, a compensation on steps already done, an escalation or a cancel on a scope around it |
| An activity that repeats more than a thousand times, under a loop or a multi-instance marker, an ad-hoc sub-process that goes round more than a thousand times, and a path that takes more than a thousand steps in one process or sub-process | stops the run, where BPMN sets no bound | an error for a standard loop marker with neither a `loopCondition` nor a `loopMaximum`, and no interrupting message, timer or error boundary event to end it; - otherwise | a run that would not end is stopped rather than left running |
| A choreography task in a process | written in BPMN XML as the `bpmn:task` it is, marked `studyflow:exchange`, its bands as `studyflow:participants` and `studyflow:initiator`; reading the XML draws it back | the XML is checked against the OMG's BPMN 2.0 schema (a warning when the machine has no `xmllint`) | the exchange with the actor is drawn where it happens, in the process that runs it |

Everything else a run reads as BPMN 2.0 says. A boundary event that does not interrupt (`cancelActivity: false`) starts a path beside its activity each time it happens, and one that interrupts ends the activity at once, stopping a runner's hand-off in progress, whether a timer ran out or a message came. An event-based gateway takes the branch whose event comes first: a message, a timer that runs out, or a condition that holds. A conditional catch or start event waits until its condition holds, read again each time a value changes. An error goes out to the innermost activity whose error boundary event catches it, by the error the event names or that error's `errorCode`, and a step's failure goes the same way, its runner able to name the code. A pool whose runner fails a message fails the step that asked, which throws the pool's failure the same way, and an event or a gateway that fails is such a step too. A multi-instance marker stops once its `completionCondition` holds, and a call activity walks the process it calls in its place, that process no pool of its own.

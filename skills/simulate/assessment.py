"""The simulated Behaverse build: a `behaverse:Task` whose `implementation` is `simulate://assessment-unity`, played
without Unity (SKILL.md beside this file).

It plays the timeline the Parameters wired into the task define, block by block, sends each trial along the task's
message flows as the Unity build's runner relays the build's, scores the answer as the build does, and writes the
battery contract's records: one `<TASK>.TrialEnd` per trial presented, its block and trial ids counted as the build
counts them, between a `<TASK>.TaskStart` and a `<TASK>.TaskEnd`. What it shares with that runner (the payload checks,
the exchange, the records' file and stamp, the failed-trial rate) it takes from it, `skills/behaverse/local.py`, so
both builds are run and scored by one rule.
Three instruments are played: the AX-CPT (`RE`), the Simon task (`WO`) and the N-back (`NB`).
"""

from __future__ import annotations

import importlib.util
import json
import random
import time
from pathlib import Path
from typing import Any, Callable

_spec = importlib.util.spec_from_file_location("behaverse_local", Path(__file__).resolve().parents[1] / "behaverse" / "local.py")
behaverse = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(behaverse)

# What a block may say beside its `Parameters`; anything else would change the trials in a way this build does not.
BLOCK_KEYS = {"Name", "Parameters", "Trials", "TrialOrder", "ExitRules", "MinAccuracyRequired", "MaxRepeats", "Adapt",
              "Description", "RulesName"}
# How often a failed block is played again, unless it says (the build's `BlockMaxRepeats`).
MAX_REPEATS = 2
ENUMS = {"Congruency": ["Congruent", "Incongruent", "Neutral"], "CorrectButton": ["Left", "Right"]}

# A trial: its `Stimulus` and `ResponseOptions` as sent, `window` (the protocol's seconds to answer, read when sent),
# its `condition` and `correct` answer as the build scores it, and `load` for the N-back.
Trial = dict[str, Any]


class Block:
    """One block of the timeline: its name, its parameters, and what the build would read from them."""

    def __init__(self, name: str, definition: dict[str, Any]) -> None:
        unknown = sorted(set(definition) - BLOCK_KEYS)
        if unknown:
            raise ValueError(f"block {name}: the simulated build does not play {', '.join(unknown)}")
        if definition.get("Adapt"):
            raise ValueError(f"block {name}: the simulated build does not adapt a block (Adapt)")
        self.name, self.definition = name, definition
        self.parameters: dict[str, Any] = definition.get("Parameters") or {}
        self.index = 0  # its place among the timeline's blocks of trials, from 1 (the build's `gameBlockIndex`)

    def need(self, key: str, parameters: dict[str, Any] | None = None) -> Any:
        """A parameter the build cannot play the block without, written inline in the study's Parameters."""
        value = (parameters if parameters is not None else self.parameters).get(key)
        if value is None:
            raise ValueError(f"block {self.name}: the simulated build needs {key} in the block's Parameters, written "
                             "inline: it has no copy of the build's own")
        return referred(value, self.parameters)

    def options(self) -> list[str]:
        """Match and NonMatch: every trial takes an answer, which is how an external responder is asked."""
        if self.need("UseNonMatchButton") is not True:
            raise ValueError(f"block {self.name}: UseNonMatchButton false: the simulated build plays with the NonMatch "
                             "button, so that every trial takes an answer")
        return ["Match", "NonMatch"]


def referred(value: Any, parameters: dict[str, Any]) -> Any:
    """A `{Reference: Name}` value is the block's parameter of that name, as the build reads it."""
    if isinstance(value, dict) and set(value) == {"Reference"}:
        return parameters.get(value["Reference"])
    return value


def merged(base: dict[str, Any], over: dict[str, Any]) -> dict[str, Any]:
    """`over` merged into `base`, mapping by mapping, as the build merges a timeline's entry over the block it names."""
    out = dict(base)
    for key, value in over.items():
        out[key] = merged(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


class Page:
    """An entry of the timeline with nothing to answer: a page of instructions (`Instructions`) or a break
    (`WaitMessage`). The build counts it among the blocks it plays, so it takes a block id in the records; a page of
    instructions with `ShowAgainOnNextBlockFailure` is shown again, and takes another, before a failed block after it is
    played again."""

    def __init__(self, entry: dict[str, Any]) -> None:
        self.again = "Instructions" in entry and bool(entry.get("ShowAgainOnNextBlockFailure"))


# What a timeline's entry is, by the first of these keys it has, as the build reads it.
ENTRY_KEYS = ("Instructions", "Blocks", "Name", "WaitMessage", "Timeline")


def timeline_of(parameters: dict[str, Any], timeline: str, within: tuple[str, ...] = ()) -> list[Block | Page]:
    """The entries the timeline plays, in order, each read by its first key in `ENTRY_KEYS`: a page of instructions; a
    group, whose `Blocks` are played in its place; a block (`Name`), merged over its definition under `Blocks`; a break;
    another timeline, whose entries are played in its place. Each block gets its place among the blocks, from 1."""
    definition = (parameters.get("Timelines") or {}).get(timeline)
    if not isinstance(definition, dict):
        raise ValueError(f"the simulated build plays a timeline the Parameters wired into the task define under Timelines, "
                         f"and {timeline} is not one: it has no copy of the build's own")
    if timeline in within:
        raise ValueError(f"timeline {timeline} plays itself, through {' > '.join(within)}")
    named, entries = parameters.get("Blocks") or {}, []

    def read(items: list[Any]) -> None:
        for entry in items:
            kind = next((key for key in ENTRY_KEYS if isinstance(entry, dict) and key in entry), None)
            if kind == "Blocks":
                read(entry["Blocks"] or [])
            elif kind == "Timeline":
                entries.extend(timeline_of(parameters, str(entry["Timeline"]), (*within, timeline)))
            elif kind == "Name":
                entries.append(Block(str(entry["Name"]), merged(named.get(entry["Name"]) or {}, entry)))
            elif kind:
                entries.append(Page(entry))
            else:
                raise ValueError(f"timeline {timeline}: {entry!r} is none of the entries the build plays "
                                 f"({', '.join(ENTRY_KEYS)})")

    read(definition.get("Blocks") or [])
    for index, block in enumerate((entry for entry in entries if isinstance(entry, Block)), 1):
        block.index = index
    return entries


def ordered(value: Any, key: str) -> list[Any]:
    """The values of a sequence the build plays in order: `{Sequence: {Type: Ordered, Values: [...]}}`, a list, or one
    value repeated."""
    if isinstance(value, dict) and "Sequence" in value:
        sequence = value["Sequence"]
        if sequence.get("Type") != "Ordered":
            raise ValueError(f"{key}: the simulated build plays Ordered sequences here, not {sequence.get('Type')}")
        return list(sequence.get("Values") or [])
    return value if isinstance(value, list) else [value]


def window(block: Block, index: int, *keys: str) -> float:
    """The protocol's window to answer trial `index`: the sum of `keys`, each a number or an ordered sequence of them."""
    total = 0.0
    for key in keys:
        values = ordered(block.need(key), f"block {block.name}: {key}")
        total += float(values[index % len(values)])
    return total


# --- the trials of a block, per instrument ---

def regex(block: Block, _draw: random.Random) -> list[Trial]:
    """The AX-CPT (`RE`): one trial per letter of `ItemSequence` (a letter's index, 0 for A; a negative value is a
    distractor, letter `-v - 1`). A letter is Match when the letters so far, distractors aside, end with the response
    pattern (`AX`), NonMatch otherwise. Its condition is its place in the cue/probe alternation of that stream: a cue,
    or a probe of class AX, AY, BX or BY (an A or another cue, an X or another probe)."""
    if block.need("StimulusType") != "UpperCaseLetters":
        raise ValueError(f"block {block.name}: StimulusType {block.parameters['StimulusType']}: the simulated build shows UpperCaseLetters")
    patterns = ordered(block.need("ResponsePatterns"), f"block {block.name}: ResponsePatterns")
    if len(patterns) != 1 or not (isinstance(patterns[0], str) and len(patterns[0]) == 2 and patterns[0].isalpha()):
        raise ValueError(f"block {block.name}: ResponsePatterns {patterns}: the simulated build plays one pattern of two letters, as [AX]")
    cue, probe = patterns[0].upper()
    items = ordered(block.need("ItemSequence"), f"block {block.name}: ItemSequence")
    options, stream, trials = block.options(), [], []
    for index in range(int(block.parameters.get("SequenceLength") or len(items))):
        value = int(items[index % len(items)])
        distractor = value < 0
        letter = chr(ord("A") + (-value - 1 if distractor else value))
        if not distractor:
            stream.append(letter)
        match = not distractor and stream[-2:] == [cue, probe]
        condition = "Distractor" if distractor else "Cue" if len(stream) % 2 else \
            ("A" if stream[-2] == cue else "B") + ("X" if stream[-1] == probe else "Y")
        colour = block.need("DistractorColor" if distractor else "StimulusColor")
        trials.append({"Stimulus": {"Letter": letter, "Color": str(colour).upper(), "IsDistractor": distractor},
                       "ResponseOptions": options, "condition": condition, "correct": "Match" if match else "NonMatch",
                       "window": lambda i=index: window(block, i, "StimulusDisplayDuration", "InterStimulusInterval")})
    return trials


def which_one(block: Block, draw: random.Random) -> list[Trial]:
    """The Simon task (`WO`, PrimaryFeature Color, SecondaryFeature Position): a disk of one button's colour over that
    button (Congruent), over the other (Incongruent) or centred (Neutral), answered by the button of its colour. The
    trials are the block's `Trials` cells, each `ItemOccurrences` times in a seeded order (`TrialOrder`, Replacement
    WithoutInBlock), or as many as a `Trials` exit rule says, each drawn from the parameters' Uniform distributions."""
    for key, wanted in (("PrimaryFeature", "Color"), ("SecondaryFeature", "Position")):
        if block.need(key) != wanted:
            raise ValueError(f"block {block.name}: {key} {block.parameters[key]}: the simulated build plays the Simon task, {key} {wanted}")
    colours = block.need("ButtonColors")
    if not (isinstance(colours, list) and len(colours) == 2):
        raise ValueError(f"block {block.name}: ButtonColors {colours}: the Simon task has two buttons of two colours")
    symbols = block.parameters.get("ButtonSymbols") or "Disk"
    symbols = symbols if isinstance(symbols, list) else [symbols, symbols]
    buttons = [{"position": side, "symbol": str(symbols[i]), "color": str(colours[i]).upper()} for i, side in enumerate(("Left", "Right"))]
    cells = [dict(cell.get("Parameters") or {}) for cell in block.definition.get("Trials") or []]
    if cells:
        order = block.definition.get("TrialOrder") or {}
        if not isinstance(order, dict) or order.get("Replacement", "WithoutInBlock") != "WithoutInBlock":
            raise ValueError(f"block {block.name}: TrialOrder {order}: the simulated build deals cells WithoutInBlock")
        cells = cells * int(order.get("ItemOccurrences") or 1)
        draw.shuffle(cells)
    else:
        cells = [{} for _ in range(trial_limit(block) or 0)]
        if not cells:
            raise ValueError(f"block {block.name}: no Trials cells and no Trials exit rule, so the simulated build has no trial count")
    trials = []
    for cell in cells:
        parameters = {**block.parameters, **cell}
        congruency, correct = (drawn(block, parameters, key, draw) for key in ("Congruency", "CorrectButton"))
        other = "Right" if correct == "Left" else "Left"
        position = {"Congruent": correct, "Incongruent": other, "Neutral": "Center"}[congruency]
        target = {**buttons[correct == "Right"], "position": position}  # the correct button's disk, where it shows
        trials.append({"Stimulus": {"Target": target, "Buttons": buttons,
                                    "NeutralSymbol": str(parameters.get("NeutralSymbol") or symbols[0]),
                                    "NeutralColor": str(parameters.get("NeutralColor") or "#FFFFFF").upper()},
                       "ResponseOptions": ["Left", "Right"], "condition": congruency, "correct": correct,
                       "window": lambda p=parameters: float(block.need("MaxResponseTime", p))})
    return trials


def drawn(block: Block, parameters: dict[str, Any], key: str, draw: random.Random) -> str:
    """A cell's value of `key`, or one drawn from `{Distribution: {Type: Uniform}}` over the values it can take."""
    value = block.need(key, parameters)
    if isinstance(value, dict):
        if value != {"Distribution": {"Type": "Uniform"}}:
            raise ValueError(f"block {block.name}: {key} {value}: the simulated build draws from a Uniform distribution only")
        return draw.choice(ENUMS[key])
    if value not in ENUMS[key]:
        raise ValueError(f"block {block.name}: {key} {value}: one of {', '.join(ENUMS[key])}")
    return str(value)


def nback(block: Block, draw: random.Random) -> list[Trial]:
    """The N-back (`NB`): one stream of digits, at `NValue` back. Its values are an Ordered sequence, or one the build
    generates (`Type: NBack`, `StreamSize` digits from 1 to `FeatureValuesCount`, `MatchCount` of them matches), here
    from the run's seed. The first `NValue` digits are the burn-in: sent, so the responder sees every digit, never
    scored. A digit is Match when it is the one `NValue` before it."""
    n = int(block.need("NValue"))
    streams = block.need("Streams")
    if not (isinstance(streams, list) and len(streams) == 1):
        raise ValueError(f"block {block.name}: Streams: the simulated build plays one stream")
    value = (streams[0] or {}).get("StimulusValue") or {}
    sequence = {key: referred(item, block.parameters) for key, item in (value.get("Sequence") or {}).items()}
    if sequence.get("Type") == "NBack":
        size = int(referred(sequence.get("StreamSize"), block.parameters) or block.need("StreamSize"))
        digits = generated(n, size, int(sequence.get("FeatureValuesCount") or 9), int(sequence.get("MatchCount") or 0), draw)
    else:
        digits = ordered({"Sequence": sequence}, f"block {block.name}: Streams StimulusValue")
        digits = [digits[i % len(digits)] for i in range(int(block.parameters.get("StreamSize") or len(digits)))]
    paced = bool(block.parameters.get("PlayerPaced"))
    options, trials = block.options(), []
    for index, digit in enumerate(digits):
        match = index >= n and digit == digits[index - n]
        trials.append({"Stimulus": {"Value": str(digit), "Load": n}, "ResponseOptions": options, "load": n,
                       "condition": "BurnIn" if index < n else "Match" if match else "NonMatch",
                       "correct": "Match" if match else "NonMatch",  # a burn-in digit has none before it to match
                       "window": (lambda: window(block, 0, "MaxResponseTime")) if paced else
                                 (lambda i=index: window(block, i, "StimulusDisplayDuration", "InterStimulusInterval"))})
    return trials


def generated(n: int, size: int, values: int, matches: int, draw: random.Random) -> list[int]:
    """`size` digits from 1 to `values`, exactly `matches` of them the digit `n` before them, at seeded places."""
    if matches > size - n:
        raise ValueError(f"an N-back stream of {size} digits at {n} back holds at most {size - n} matches, not {matches}")
    places = set(draw.sample(range(n, size), matches))
    digits: list[int] = []
    for index in range(size):
        before = digits[index - n] if index >= n else None
        digits.append(before if index in places else draw.choice([d for d in range(1, values + 1) if d != before]))
    return digits


INSTRUMENTS: dict[str, Callable[[Block, random.Random], list[Trial]]] = {"RE": regex, "WO": which_one, "NB": nback}


# --- the block's course: exit rules, a failed block played again ---

def trial_limit(block: Block) -> int | None:
    """The trial count a `{Trials: n}` exit rule (of every trial, ending the block) sets, if any."""
    return next((int(rule["Trials"]) for rule in exit_rules(block)
                 if rule.get("Type", "All") == "All" and not rule.get("Consecutive")), None)


def exit_rules(block: Block) -> list[dict[str, Any]]:
    """The block's `Trials` exit rules. A `Time` rule is left out: nothing here takes time, so a time limit never ends a
    simulated block."""
    rules = []
    for rule in block.definition.get("ExitRules") or []:
        if "Time" in rule:
            continue
        if "Trials" not in rule or rule.get("Action", "EndBlock") not in ("EndBlock", "FailBlock"):
            raise ValueError(f"block {block.name}: ExitRules {rule}: the simulated build applies Trials rules that "
                             "end or fail the block, and Time rules not at all")
        rules.append(rule)
    return rules


def fired(rule: dict[str, Any], outcomes: list[bool]) -> bool:
    """Whether an exit rule holds after these outcomes (each trial right or not): so many trials, successes or failures,
    in all or in a row."""
    kind, count = rule.get("Type", "All"), int(rule["Trials"])
    if kind == "All":
        return len(outcomes) >= count
    wanted = kind == "Successes"
    if rule.get("Consecutive"):
        run = len(outcomes) - next((i + 1 for i in range(len(outcomes) - 1, -1, -1) if outcomes[i] != wanted), 0)
        return run >= count
    return outcomes.count(wanted) >= count


# --- one task, played ---

def trials_of(scene: str, block: Block, step: Any, attempt: int, external: float) -> list[Trial]:
    """The trials of one play of `block`, drawn from the run's seed, the step and the block, so every subject meets the
    same, each with the window its responder is sent: `external` when the task's `Bot` gives one
    (`MaxExternalResponseTime`), else the protocol's."""
    trials = INSTRUMENTS[scene](block, random.Random(f"{step.seed}:{step.id}:{block.name}:{attempt}"))[:trial_limit(block)]
    for trial in trials:
        trial["MaxResponseTime"] = external or trial.pop("window")()
    return trials


class Session:
    """One task played: the exchange with whoever answers along its flows, and the records it writes and tallies."""

    def __init__(self, step: Any, scene: str, task: dict[str, Any], exchange: Any, file: Any, context: dict[str, Any]) -> None:
        self.step, self.scene, self.task, self.exchange, self.file, self.context = step, scene, task, exchange, file, context
        self.recorded = behaverse.Trials()
        # The build's ids: every entry of the timeline played, a page and a repeat too (`block.id`), every trial (`trial.id`).
        self.block_id = self.trial_id = 0
        # The blocks of trials played, a repeat too: the block in each trial's request id, which a simulated participant
        # draws by, so it is counted as it always was and the same study draws the same answers.
        self.played = 0

    def write(self, name: str, **trial_context: Any) -> None:
        """A record, as the build sends one to the runner: its own fields, and the runner's stamp (`context`)."""
        result = trial_context.pop("result", None)
        event = {"object": {"name": f"{self.scene}.{name}"}, "trialContext": {"task": self.task, **trial_context},
                 **({"result": result} if result else {})}
        behaverse.tally(self.recorded, event)
        self.file.write(json.dumps({**event, "context": self.context}, separators=(",", ":")) + "\n")

    def page(self) -> None:
        """A page of instructions or a break, shown: nothing to answer, nothing recorded, but a block id taken."""
        self.block_id += 1

    def block(self, block: Block, trials: list[Trial]) -> bool:
        """The block's trials, one message each, until they run out or an exit rule ends it; whether it failed (an exit
        rule's FailBlock, or less accuracy than its MinAccuracyRequired). A burn-in trial is recorded with its answer and
        never scored: `isCorrect` null, and no outcome for the exit rules."""
        self.played += 1
        self.block_id += 1
        rules, outcomes = exit_rules(block), []
        for index, trial in enumerate(trials):
            if self.step.cancelled:
                raise behaverse.Cancelled(f"{self.step.id} was stopped")
            request = f"{self.step.id}.{self.context['subject']}.{self.played}.{index}"  # the subject's own: never shared
            started = time.monotonic()
            reply = self.exchange.ask({"RequestId": request, "TrialIndex": index, "Stimulus": trial["Stimulus"],
                                       "ResponseOptions": trial["ResponseOptions"],
                                       "MaxResponseTime": trial["MaxResponseTime"], "Scene": self.scene})
            response = reply.get("Response")
            scored = trial["condition"] != "BurnIn"
            correct = response is not None and response == trial["correct"]
            self.trial_id += 1
            self.write("TrialEnd", block={"id": self.block_id, "name": block.name, "gameBlockIndex": block.index},
                       trial={"id": self.trial_id, "indexInBlock": index + 1},
                       condition=trial["condition"], **({"load": trial["load"]} if "load" in trial else {}),
                       types=["TaskEvent", "BlockEvent", "TrialEvent", "TrialEnd"],
                       result={"isAnswered": response is not None, "isCorrect": correct if scored else None, "response": response,
                               "responseTime": round(time.monotonic() - started, 3) if response is not None else None})
            if scored:
                outcomes.append(correct)
            held = [rule for rule in rules if fired(rule, outcomes)]
            if held:
                return any(rule.get("Action") == "FailBlock" for rule in held)
        required = block.definition.get("MinAccuracyRequired")
        return required is not None and bool(outcomes) and sum(outcomes) / len(outcomes) < float(required)


def play(step: Any) -> dict[str, Any]:
    """The task, played to the end: its result is the Unity build's completion, `{TaskId, TimelineId, IsCompleted}`,
    with `trials` (those answered), `failedTrialRate` by the task's `ScoredBlocks`, and `events`, its records' file.
    Every block is read before the first trial, so what the build cannot play stops the task before it starts."""
    element, plan, state = step.element, step.elements, step.values
    payload = behaverse.task_payload(element, plan=plan)
    scene, name = payload["scene"], payload["timeline"]
    if scene not in INSTRUMENTS:
        raise ValueError(f"behaverse:Task {element['id']!r}: the simulated build plays {', '.join(INSTRUMENTS)}, not {scene}")
    if not behaverse.along_messages(payload):
        raise ValueError(f"behaverse:Task {element['id']!r}: the simulated build has no screen, so its trials are answered "
                         "along message flows: draw one carrying each trial out of the task and one bringing the answer back")
    parameters = element.get("parameters") or {}
    entries = timeline_of(parameters, name)
    blocks = [entry for entry in entries if isinstance(entry, Block)]
    scored = behaverse.scored_blocks(element)
    missing = behaverse.unplayed(scored, [block.name for block in blocks])
    if missing:
        raise ValueError(f"behaverse:Task {element['id']!r}: ScoredBlocks names {', '.join(missing)}, which timeline {name} does not play")
    # `Bot:` is how the Unity build's bot plays; of it, only the window an external responder is given applies here.
    external = float(((parameters.get("Bot") or {}).get("MaxExternalResponseTime")) or 0)
    first = iter([trials_of(scene, block, step, 0, external) for block in blocks])

    flow, _ = behaverse.trial_flows(element, plan)
    partner = ", ".join((plan.get(p) or {}).get("name") or p for p in behaverse.message_partners(element, plan))
    exchange = behaverse.Exchange(step, flow, partner, behaverse.data_inputs(element, state, plan))
    step.run_dir.mkdir(parents=True, exist_ok=True)
    events = step.run_dir / behaverse.events_uri(element, plan)
    events.parent.mkdir(parents=True, exist_ok=True)
    if not behaverse.opened_this_run(step.cache, events):
        events.unlink(missing_ok=True)
    with events.open("a") as file:
        # The plan holds the study's seed as text; the build records a task's seed as a number.
        seed = int(step.seed) if str(step.seed).lstrip("-").isdigit() else 0
        session = Session(step, scene, {"id": scene, "timelineName": name, "seed": seed}, exchange, file,
                          behaverse.trial_context(element, plan, state))
        session.write("TaskStart", types=["TaskEvent", "TaskStart"])
        for place, entry in enumerate(entries):
            if isinstance(entry, Page):
                session.page()
                continue
            # A failed block is played again, freshly drawn, up to its repeats, after the pages right before it that
            # say to show them again.
            again = 0
            while again < place and isinstance(entries[place - again - 1], Page) and entries[place - again - 1].again:
                again += 1
            trials = next(first)
            for attempt in range(1 + int(entry.definition.get("MaxRepeats", MAX_REPEATS))):
                if attempt:
                    for _ in range(again):
                        session.page()
                    trials = trials_of(scene, entry, step, attempt, external)
                if not session.block(entry, trials):
                    break
        session.write("TaskEnd", types=["TaskEvent", "TaskEnd"])
    answered = sum(was for was, _condition in session.recorded.ended.values())
    print(f"□ {element.get('name') or element['id']}: {scene} / {name} on the simulated build, {answered} trials answered", flush=True)
    return {"TaskId": scene, "TimelineId": name, "IsCompleted": True, "trials": answered,
            "failedTrialRate": behaverse.failed_trial_rate(session.recorded, scored), "events": str(events)}

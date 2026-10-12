"""A jsPsych trial as the study's actor is sent it and as the run records it (SKILL.md beside this file, "Local runs").

The local runner (`local.py`) plays a `jspsych://` step's timeline in jsPsych's data-only simulation mode, each trial's
response coming from the actor along the task's message flows. What it decides apart from the walk, the page and the
network is here: which jsPsych builds a reference plays, the timeline the Parameters make, what a trial offers the actor
and what each option presses, the message the actor is sent, the response its reply makes, and the trial's record.
"""

from __future__ import annotations

from html.parser import HTMLParser
from typing import Any

UNPKG = "https://unpkg.com"
BUILD = "dist/index.browser.min.js"
# The plugin release line that goes with each jsPsych major version the local runner plays: jsPsych 8 runs the 2.x
# plugins. The browser runtime plays jsPsych 7 too (`browser/trial.ts`); the stage page is written against 8 alone.
PLUGIN_MAJOR = {"8": "2"}
# The keys a timeline node holds for the timeline, not for its trials (`browser/trial.ts`, `TIMELINE_KEYS`).
TIMELINE_KEYS = frozenset({"timeline_variables", "randomize_order", "repetitions", "sample", "conditional_function", "loop_function"})
# The keys at the top of the Parameters that the runner reads and never hands jsPsych: `ResponseOptions`, and `Bot`, the
# task settings for an actor that is not a person (`external_deadline`).
RUNNER_KEYS = ("ResponseOptions", "Bot")
# Seconds the actor has for a trial that waits however long it takes (no `trial_duration`) when the task settings give
# it no deadline: as long as the SDK's exchange waits for a message that gives no time (`exchange.WAIT`).
WAIT = 30.0
# What a trial's record says it is, as a record of the Behaverse Data Model says (`record_of`).
TYPES = ["TaskEvent", "BlockEvent", "TrialEvent", "TrialEnd"]


def builds_of(implementation: str) -> dict[str, Any]:
    """What a `jspsych://<plugin>@<version>` reference plays, read as the browser runtime reads it (`browser/trial.ts`,
    `trialOf`): the plugin, jsPsych's version, each build as its npm package, version and file (jsPsych's sets
    `jsPsychModule`), and the global the plugin's build sets (`jsPsychHtmlKeyboardResponse`)."""
    scheme, _, rest = str(implementation or "").partition("://")
    plugin, _, version = rest.partition("@")
    if scheme != "jspsych" or not plugin:
        raise ValueError(f"{implementation!r} is no jspsych://<plugin>@<version> reference")
    if not version:
        raise ValueError(f"{implementation!r} names no jsPsych version: write jspsych://{plugin}@8")
    major = PLUGIN_MAJOR.get(version.split(".")[0])
    if major is None:
        raise ValueError(f"jsPsych {version} is not one the local runner plays ({', '.join(PLUGIN_MAJOR)}); "
                         "the browser runtime plays 7 too")
    name = plugin.removeprefix("plugin-")
    return {
        "plugin": name,
        "version": version,
        "core": {"package": "jspsych", "version": version, "file": BUILD},
        "script": {"package": f"@jspsych/plugin-{name}", "version": major, "file": BUILD},
        "global": "jsPsych" + "".join(word[:1].upper() + word[1:] for word in name.split("-")),
    }


def unpkg(build: dict[str, str]) -> str:
    """The address unpkg serves a build at, the one the browser runtime loads."""
    return f"{UNPKG}/{build['package']}@{build['version']}/{build['file']}"


def played(parameters: dict[str, Any]) -> dict[str, Any]:
    """What of the Parameters wired into a step jsPsych plays: all but the runner's keys (`RUNNER_KEYS`). The plan hands
    a runner every Parameters object wired into a step merged into one (packages/runtime-local/CONTRACT.md, "The plan"),
    so the protocol and the task settings are told apart by their keys, never by the object they came from."""
    return {key: value for key, value in parameters.items() if key not in RUNNER_KEYS}


def external_deadline(parameters: dict[str, Any], element_id: str) -> float | None:
    """The seconds the actor has for every trial when the task settings give it a deadline of their own: the
    `MaxExternalResponseTime` of the Parameters' `Bot` entry, above 0, the setting the Behaverse build reads too, so
    one settings object serves a study's tasks in both; None otherwise. The rest of `Bot` (`Speed`, `SkipInstructions`,
    ...) is the Behaverse build's and means nothing to jsPsych. Written at the top of the Parameters instead, it would reach jsPsych
    as a trial parameter and leave every deadline the protocol's, so it is refused."""
    if "MaxExternalResponseTime" in parameters:
        raise ValueError(f"{element_id}: MaxExternalResponseTime is a task setting, not jsPsych's: write it under Bot:, as "
                         "the settings a study wires into its Behaverse tasks do")
    bot = parameters.get("Bot")
    seconds = bot.get("MaxExternalResponseTime") if isinstance(bot, dict) else None
    if seconds is None:
        return None
    if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or seconds < 0:
        raise ValueError(f"{element_id}: Bot.MaxExternalResponseTime is the seconds the actor has for each trial; got {seconds!r}")
    return float(seconds) if seconds > 0 else None


def deadline_of(parameters: dict[str, Any], external: float | None) -> float:
    """The seconds the actor has to answer a trial: the task settings' (`external_deadline`) when they give some, else
    the trial's `trial_duration`, else `WAIT`."""
    if external:
        return external
    window = parameters.get("trial_duration")
    return window / 1000 if isinstance(window, (int, float)) and not isinstance(window, bool) and window > 0 else WAIT


def timeline_of(plugin: Any, parameters: dict[str, Any]) -> dict[str, Any]:
    """The jsPsych timeline one step runs, by the browser runtime's rule (`browser/trial.ts`, `timelineOf`): the
    Parameters as the plugin's, and, when they carry `timeline_variables`, a timeline over them, each variable a trial
    parameter unless the Parameters set it. A variable is `{"timelineVariable": name}`, which the stage page makes
    jsPsych's own; `plugin` is what the trial's `type` holds."""
    trial: dict[str, Any] = {"type": plugin}
    around: dict[str, Any] = {}
    for key, value in parameters.items():
        (around if key in TIMELINE_KEYS else trial)[key] = value
    variables = around.get("timeline_variables")
    if not isinstance(variables, list) or not variables:
        return trial
    for name in variables[0]:
        if name not in trial:
            trial[name] = {"timelineVariable": name}
    return {**around, "timeline": [trial]}


def variable_names(parameters: dict[str, Any]) -> list[str]:
    """The names of the timeline variables, every row's, in the order they first appear."""
    names: list[str] = []
    for row in parameters.get("timeline_variables") or []:
        names += [name for name in (row if isinstance(row, dict) else {}) if name not in names]
    return names


def field(name: str, variables: dict[str, Any], data: dict[str, Any]) -> Any:
    """A trial's own value of `name`: its timeline variable, else the field of its `data` (jsPsych's places for what a
    trial is: `block`, `condition`, `correct_response`, `task`); None when neither names it."""
    value = variables.get(name)
    return value if value is not None else data.get(name)


def response_options(parameters: dict[str, Any], element_id: str) -> dict[str, str] | None:
    """`ResponseOptions`, at the top of the Parameters: each option the actor is offered, with the key it presses or the
    button it clicks, by its label (`{Match: f, NonMatch: j}`); None without it, the trial's own `choices` being the
    options then. A key or a button the Parameters' `choices` do not list is named before the task starts."""
    options = parameters.get("ResponseOptions")
    if options is None:
        return None
    if not isinstance(options, dict) or not options or not all(isinstance(label, str) and label and isinstance(choice, str)
                                                                 and choice for label, choice in options.items()):
        raise ValueError(f"{element_id}: ResponseOptions maps each option the actor is offered to the key it presses, "
                         f"as {{Match: f, NonMatch: j}}; got {options!r}")
    choices = parameters.get("choices")
    if isinstance(choices, list):
        listed = {str(choice).lower() for choice in choices}
        unlisted = [f"{label}: {choice}" for label, choice in options.items() if choice.lower() not in listed]
        if unlisted:
            raise ValueError(f"{element_id}: ResponseOptions names what its choices {choices} do not list ({', '.join(unlisted)})")
    return options


def offered(choices: Any, keys: bool, mapping: dict[str, str] | None) -> dict[str, Any]:
    """What a trial offers the actor, each option with the response it makes in jsPsych's data: a key the trial takes,
    as its `choices` spell it, or, for a plugin of buttons, the button's place among them. With `ResponseOptions`, its
    options whose key or button the trial lists, in any case (as jsPsych compares keys); without, the trial's choices
    themselves. A trial that lists none (`NO_KEYS`, `ALL_KEYS`, or no `choices`) offers nothing: no trial the actor
    answers."""
    if not isinstance(choices, list) or not choices or not all(isinstance(choice, str) for choice in choices):
        return {}
    if mapping is None:
        return {choice: choice if keys else place for place, choice in enumerate(choices)}
    out: dict[str, Any] = {}
    for label, wanted in mapping.items():
        place = next((place for place, choice in enumerate(choices) if choice.lower() == wanted.lower()), None)
        if place is not None:
            out[label] = choices[place] if keys else place
    return out


class _Text(HTMLParser):
    """The text of a piece of markup, a line break at each block it opens or closes, scripts and styles aside."""

    BLOCKS = {"br", "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table"}
    UNSHOWN = {"script", "style"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in self.UNSHOWN:
            self.hidden += 1
        if tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.UNSHOWN and self.hidden:
            self.hidden -= 1
        if tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def text_of(markup: Any) -> Any:
    """A stimulus as text: the text its markup shows, blanks collapsed, one line per block (`<p>A</p>` is `A`). What is
    no text is itself."""
    if not isinstance(markup, str):
        return markup
    parser = _Text()
    parser.feed(markup)
    parser.close()
    lines = (" ".join(line.split()) for line in "".join(parser.parts).splitlines())
    return "\n".join(line for line in lines if line)


def message_of(index: int, parameters: dict[str, Any], options: dict[str, Any], deadline: float) -> dict[str, Any]:
    """The trial as the actor is sent it, with the fields any task's trial message has: its place in its block
    (`TrialIndex`, from 0), its stimulus as text, the options it offers, and the seconds it has to answer
    (`MaxResponseTime`, `deadline_of`). What the trial is (its condition, its block) and its right answer stay out of
    it, as they stay off the screen. The message's id is the session's (`local.py`)."""
    return {"TrialIndex": index, "Stimulus": text_of(parameters.get("stimulus")), "ResponseOptions": list(options),
            "MaxResponseTime": deadline}


def answer_of(label: str | None, options: dict[str, Any], latency: float, window: Any = None) -> dict[str, Any]:
    """What jsPsych is told the participant did: the response the option the actor's answer names makes (a key, or a
    button's place) and its time in ms, from the message to the answer. An answer that names no option, or none in time
    (the exchange's None), is no response: both null. jsPsych's own check drops a response later than the trial's
    `trial_duration`, which is the actor's deadline unless the task settings give it longer; then `window` is that
    `trial_duration`, and an answer later than it reaches jsPsych at the window's end, so the plugin keeps it while its
    data stay inside the trial's window. The real time is the record's (`record_of`)."""
    if label not in options:
        return {"response": None, "rt": None}
    rt = round(latency)
    if isinstance(window, (int, float)) and not isinstance(window, bool) and window > 0:
        rt = min(rt, int(window))
    return {"response": options[label], "rt": rt}


def same(response: Any, correct: Any) -> bool:
    """Whether a response is the right one: a key in any case, as jsPsych compares keys; a button by its place."""
    return str(response).lower() == str(correct).lower()


def record_of(trial: dict[str, Any], row: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """A trial's record, in the shape of a record of the Behaverse Data Model (`<TASK>.TrialEnd`), so one trial schema
    reads a study's jsPsych and Behaverse tasks alike: `trial` is what the runner knows of it
    (its task, block, numbering, condition, right answer, the options it offered and the actor's latency in ms), `row` is
    jsPsych's data for it, the authority on whether it was answered, and `context` the runner's stamp. The row rides
    along under `data`. `responseTime` is the actor's real latency in seconds, which may pass the trial's window when
    the task settings give the actor longer (jsPsych's `rt` is then the window's end, `answer_of`). `isCorrect` is null
    for a trial with no `correct_response`, and false for one left unanswered."""
    response = row.get("response")
    answered = response is not None
    label = next((label for label, value in trial["options"].items() if value == response), None) if answered else None
    correct = None if trial["correct"] is None else answered and same(response, trial["correct"])
    return {
        "object": {"name": f"{trial['task']}.TrialEnd"},
        "trialContext": {"task": {"id": trial["task"]}, "block": {"id": trial["blockId"], "name": trial["block"]},
                         "trial": {"id": trial["trialId"], "indexInBlock": trial["index"] + 1},
                         "condition": trial["condition"], "types": TYPES},
        "result": {"isAnswered": answered, "isCorrect": correct, "response": label,
                   "responseTime": round(trial["latency"] / 1000, 3) if answered else None},
        "data": row,
        "context": context,
    }

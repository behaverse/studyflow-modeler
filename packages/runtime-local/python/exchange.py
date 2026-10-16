"""A step's exchange with the actor along message flows, and the records it writes, for a runner written in Python.

What CONTRACT.md beside this folder says of messages ("Messages") and of the plan, worked out once for every runner:
which flows a step talks along and who is at their other end, what rides with each message, the option an answer
names, where a step's records go, and the stamp each record carries. A skill names the messages its steps exchange,
as a message flow's `messageRef` → `itemRef` → `structureRef` names them (`structures`, the one sent and the one that
answers it), such as a task's trial and its response.

    sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or ...)   # the SDK's folder, as for `runner`
    import exchange
"""

from __future__ import annotations

import json
import os
import string
import threading
from pathlib import Path
from typing import Any

from runner import Cancelled, Step

# What a step's message flows and data outputs may be drawn on instead of the step: a sub-process around it.
CONTAINERS = {"subprocess", "adhocsubprocess", "transaction"}
# The seconds an answer is waited for when the message gives no time to answer.
WAIT = 30.0


def element_process(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """The process the element belongs to: its `parent`, followed outward while the parent is itself an element."""
    current = str(element.get("parent") or "")
    while current in plan and plan[current].get("parent"):
        current = str(plan[current]["parent"])
    return current


def pool_participants(process_id: str, plan: dict[str, dict[str, Any]]) -> list[str]:
    """The participants whose pool holds the process."""
    return [pid for pid, p in plan.items()
            if p.get("type") == "participant" and (p.get("attributes") or {}).get("processRef") == process_id]


def message_structure(flow: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """What a message flow carries: its message's item definition (`structureRef`), '' when it names none."""
    message = plan.get(str((flow.get("attributes") or {}).get("messageRef") or "")) or {}
    item = plan.get(str((message.get("attributes") or {}).get("itemRef") or "")) or {}
    return str((item.get("attributes") or {}).get("structureRef") or "")


def talking_scope(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """Whose message flows the step exchanges along: its own, else the nearest enclosing sub-process that has some,
    else its pool's. A collapsed sub-process is the only place BPMN can draw a message flow to a step inside it, and
    a pool's flows are the whole pool's, lanes and all (the walk routes them the same way, packages/core/src/engine
    `messageScope`). A step with flows of its own inherits none."""
    ends = {end for flow in plan.values() if flow.get("type") == "messageFlow"
            for end in ((flow.get("attributes") or {}).get("sourceRef"), (flow.get("attributes") or {}).get("targetRef"))}
    scope = str(element.get("id") or "")
    while scope not in ends:
        parent = str((plan.get(scope) or {}).get("parent") or "")
        if str((plan.get(parent) or {}).get("type") or "").lower() not in CONTAINERS:
            pool = next((pid for pid in pool_participants(element_process(element, plan), plan) if pid in ends), "")
            return pool or str(element.get("id") or "")
        scope = parent
    return scope


def message_partners(element: dict[str, Any], plan: dict[str, dict[str, Any]], structures: tuple[str, str]) -> list[str]:
    """The participants at the other end of the message flows the step talks along: a pool itself, or the pool of
    the step the flow ends at. A flow that names its message outranks one that does not, and counts only when it
    carries the first of `structures` out of the step or the second back into it; a flow naming another message is
    another skill's exchange (a marker to an EEG pool, say). More than one partner left is an ambiguity to fix in the
    diagram, not an order to guess."""
    sent, answered = structures
    typed: list[str] = []
    untyped: list[str] = []
    talking = talking_scope(element, plan)
    for flow_id, flow in plan.items():
        attrs = flow.get("attributes") or {}
        if flow.get("type") != "messageFlow" or talking not in (attrs.get("sourceRef"), attrs.get("targetRef")):
            continue
        outgoing = attrs.get("sourceRef") == talking
        structure = message_structure(flow, plan)
        if structure and structure not in structures:
            continue
        if structure and (structure == sent) != outgoing:
            raise ValueError(f"message flow {flow_id!r} carries {structure} the wrong way: {sent} leaves the step, "
                             f"{answered} comes back")
        other = attrs["targetRef"] if outgoing else attrs.get("sourceRef")
        end = plan.get(str(other)) or {}
        found = [str(other)] if end.get("type") == "participant" else pool_participants(element_process(end, plan), plan)
        into = typed if structure else untyped
        into += [pid for pid in found if pid not in into]
    partners = typed or untyped
    if len(partners) > 1:
        raise ValueError(f"{element.get('id')} exchanges messages with {', '.join(partners)}: name the message each flow "
                         f"carries (messageRef, {sent} or {answered}), or keep one partner")
    return partners


def exchange_flows(element: dict[str, Any], plan: dict[str, dict[str, Any]], structures: tuple[str, str]) -> tuple[str, str] | None:
    """The message flow the step sends along and the one it takes the answers back from, when it has a partner
    (`message_partners`, which has checked the directions and that there is one)."""
    if not message_partners(element, plan, structures):
        return None
    sent, answered = structures
    scope = talking_scope(element, plan)
    ends = [(flow_id, (flow.get("attributes") or {}), message_structure(flow, plan)) for flow_id, flow in plan.items()
            if flow.get("type") == "messageFlow"]
    out = [(flow_id, structure) for flow_id, attrs, structure in ends if attrs.get("sourceRef") == scope and structure in ("", sent)]
    back = [(flow_id, structure) for flow_id, attrs, structure in ends if attrs.get("targetRef") == scope and structure in ("", answered)]
    # A flow that names its message outranks one that does not, as in `message_partners`, so a pool's once-only untyped
    # message to a step in another pool ("all subjects complete") is not the step's exchange.
    out = [flow_id for flow_id, structure in out if structure] or [flow_id for flow_id, _ in out]
    back = [flow_id for flow_id, structure in back if structure] or [flow_id for flow_id, _ in back]
    if len(out) != 1 or len(back) != 1:
        raise ValueError(f"{scope} sends along one message flow and takes the answers back along one; "
                         f"it has {len(out)} out and {len(back)} back")
    return out[0], back[0]


def data_inputs(element: dict[str, Any], state: dict[str, Any], plan: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    """What rides with every message the step sends beside its own content: its data inputs by source id, each with
    the value this run bound for it, else null, as an unclaimed activity sends its own (CONTRACT.md, "Messages"). That
    is how the `agentic:Prompt` wired into a task reaches the pool that answers. A `studyflow:Parameters` wired in is
    left out: it configures the tool, and says nothing to whoever answers."""
    elements = plan or {}

    def configures(source: str) -> bool:
        return any(str(ext.get("type") or "").lower() == "parameters" for ext in (elements.get(source) or {}).get("extensions") or [])

    return {source: state.get(source) for binding in element.get("inputs") or []
            if (source := binding.get("source")) and not configures(source)}


def delivered_once(source: str, elements: dict[str, dict[str, Any]]) -> bool:
    """Whether a data input is a prompt that rides with a step's first message only (`delivery: once`, the task's
    instructions), rather than with each (the default, a reminder of the rule)."""
    return any(str((ext.get("attributes") or {}).get("delivery") or "") == "once"
               for ext in (elements.get(source) or {}).get("extensions") or [])


def option_named(content: Any, options: list[str]) -> str | None:
    """The option an answer is: its text, or the one value of a mapping (a send task's one data input), matched whole
    and without case, with blanks, quotes, backticks and full stops at either end aside. An answer that only mentions
    an option names none ("NonMatch" holds "Match"). `replies.json` beside this file holds the cases, which a browser
    runner that reads replies is held to as well."""
    if isinstance(content, dict) and len(content) == 1:
        content = next(iter(content.values()))
    text = str(content or "").strip(string.whitespace + "`\"'.").lower()
    return next((option for option in options if option.lower() == text), None)


class Exchange:
    """The step's end of its message flows (CONTRACT.md, "Messages"): each message goes out along `flow`, with the
    step's data inputs before its content (`data_inputs`), and the answer that names it (`inReplyTo`) comes back.
    `partner` is who answers, by name, for what a runner shows."""

    def __init__(self, step: Step, flow: str, partner: str, inputs: dict[str, Any] | None = None) -> None:
        self.step, self.flow, self.partner, self.lock = step, flow, partner, threading.Lock()
        self.inputs = inputs or {}
        # A prompt delivered `once` rides with the step's first message only, and every other with each message.
        self.once = {key for key in self.inputs if delivered_once(key, getattr(step, "elements", None) or {})}
        self.asked = False

    def ask(self, content: dict[str, Any], id: str, options: list[str], window: float | None = None) -> str | None:  # noqa: A002 - the message's own field
        """The option the answer to message `id` names (`option_named`), or None when it names none, or none comes in
        time. An answer counts when it comes a quarter of a second before `window` seconds have passed, so the tool
        has time to take it, and never under a second; without a window, within `WAIT` seconds. One message awaits
        its answer at a time, and a step the walk stops has none."""
        with self.lock:
            inputs = {key: value for key, value in self.inputs.items() if not (self.asked and key in self.once)}
            self.asked = True
            try:
                message = self.step.ask(self.flow, {**inputs, **content}, id=id,
                                        timeout=max(1.0, window - 0.25) if window and window > 0 else WAIT)
            except Cancelled:
                return None
        return option_named(message.get("content"), options) if message else None


def output_scope(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Whose data output associations the step writes through: its own, else the nearest enclosing sub-process that
    has some, the climb `talking_scope` makes, for the same reason. One edge on a collapsed sub-process is where a
    study draws the dataset every task inside it fills. A step with outputs of its own inherits none."""
    current = element
    while not (current.get("outputs") or []):
        parent = plan.get(str(current.get("parent") or ""))
        if str((parent or {}).get("type") or "").lower() not in CONTAINERS:
            return element
        current = parent
    return current


def records_uri(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> str:
    """Where the step's records go, relative to the run directory: the `uri` of a data element its output edge
    targets, its enclosing sub-process's when it draws none of its own, else `<id>.events.jsonl`."""
    for binding in output_scope(element, plan).get("outputs") or []:
        uri = ((plan.get(str(binding.get("target"))) or {}).get("attributes") or {}).get("uri")
        if uri and not str(uri).endswith("/"):
            return str(uri)
    return f"{element['id']}.events.jsonl"


def opened_this_run(cache: Path, records: Path) -> bool:
    """Whether this run has already written this records file. Several steps may deposit their records in one drawn
    dataset, and a step may run once per subject in a loop: the first to write it in a run starts it empty, the rest
    append. The run is the walk's pid (`STUDYFLOW_RUN_PID`, CONTRACT.md), so a later run truncates again. ponytail:
    two pools writing one dataset at the same instant may both think they are first."""
    marker = cache / "events.written.json"
    run = os.environ.get("STUDYFLOW_RUN_PID", "")
    try:
        written = json.loads(marker.read_text())
    except (OSError, ValueError):
        written = {}
    if written.get(str(records)) == run:
        return True
    written[str(records)] = run
    cache.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps(written))
    return False


def attributes_of(element: dict[str, Any]) -> dict[str, Any]:
    """An element's attributes and those of its extension entries (a dataset's `schema`, a schema's `body`)."""
    held: dict[str, Any] = {}
    for ext in element.get("extensions") or []:
        held.update(ext.get("attributes") or {})
    return {**held, **(element.get("attributes") or {})}


def recorded_state(element: dict[str, Any], plan: dict[str, dict[str, Any]]) -> set[str] | None:
    """The properties the step's records keep under `context.state`: those the schema of a dataset the step writes
    names as `context.state.<name>` columns, so what a record carries is the study's to say. None when no dataset the
    step writes has a schema. The schema is a YAML (CSVW) text, so a runner that stamps its records lists `pyyaml`."""
    names: set[str] | None = None
    for binding in element.get("outputs") or []:
        dataset = plan.get(str(binding.get("target"))) or {}
        schema = plan.get(str(attributes_of(dataset).get("schema") or "")) or {}
        body = attributes_of(schema).get("body")
        if not isinstance(body, str) or not body.strip():
            continue
        import yaml
        columns = ((yaml.safe_load(body) or {}).get("tableSchema") or {}).get("columns") or []
        names = (names or set()) | {str(column.get("name"))[len("context.state."):] for column in columns
                                    if isinstance(column, dict) and str(column.get("name", "")).startswith("context.state.")}
    return names


def record_context(element: dict[str, Any], plan: dict[str, dict[str, Any]], state: dict[str, Any]) -> dict[str, Any]:
    """What this run knows about the step's records beside what its tool records, stamped on each as `context`: which
    subject, and the properties in scope at the hand-off, innermost last, as many of them as the schema of the dataset
    the step writes names under `context.state` (`recorded_state`), or all of them when it has none. The subject is the
    instance the nearest repeating scope around the step is on (`state._meta.instance`, 1-based): an enclosing
    activity, else the pool of several instances whose process holds it (kept under its participant's id). So every
    step of one subject stamps the same number, whichever subjects left before reaching it, and a step played twice per
    subject stamps it twice; with no repeating scope around it, the step's own visit count, which the study's state
    keeps."""
    tree = state.get("state") or {}
    meta = tree.get("_meta") or {}
    scopes: list[str] = []
    scope = str(element.get("id") or "")
    while scope:
        scopes.append(scope)
        scope = str((plan.get(scope) or {}).get("parent") or "")
    held: dict[str, Any] = {}
    for scope in reversed(scopes):  # outward in, so an inner scope shadows an outer one
        held.update(tree.get(scope) or {})
    kept = recorded_state(element, plan)
    if kept is not None:
        held = {name: value for name, value in held.items() if name in kept}
    instances = meta.get("instance") or {}
    around = [*scopes[1:], *pool_participants(scopes[-1], plan)]  # the process's pool is the outermost
    subject = next((instances[scope] for scope in around if scope in instances),
                   (meta.get("reached") or {}).get(element.get("id"), 1))
    return {"subject": subject, "state": held}

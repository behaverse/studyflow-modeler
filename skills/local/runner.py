"""The runner SDK: the partial-runner contract (SKILL.md beside this file), for a runner written in Python.

A runner is one process for the whole run. The local runtime starts it, asks it once which elements it takes, and
then hands it one element at a time, as JSON-RPC 2.0 on its stdin and stdout, one message a line:

    import os, sys
    from pathlib import Path
    sys.path.insert(0, os.environ.get("STUDYFLOW_LOCAL") or str(Path(__file__).resolve().parents[1] / "local"))
    from runner import serve

    def claims(plan):            # the ids of the elements this runner takes
        return [eid for eid, e in plan["elements"].items() if e["attributes"].get("implementation", "").startswith("echo://")]

    def execute(step):           # one hand-off; what it returns is the step's result
        return step.fill(step.element["additionalArguments"] or "")

    if __name__ == "__main__":
        sys.exit(serve(claims, execute))

Anything the runner prints goes to the run log; what it writes to stderr, and what a command it starts prints, stays
on the terminal. `Step` is what `execute` gets: the element, the run's values, and
how to bind a value, write a property, exchange messages, and say what it ran with.
"""

from __future__ import annotations

import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from feel import PLACEHOLDER, evaluate  # noqa: E402 - the local runtime's FEEL, and a `{name}` citation as it reads one

PROTOCOL = 2



class Cancelled(Exception):
    """The walk stopped the step: a timer at a boundary event ran out, it outlasted `--step-timeout`, or the run ended."""


def dig(value: Any, fields: list[str]) -> Any:
    for field in fields:
        value = value.get(field) if isinstance(value, dict) else getattr(value, field, None)
        if value is None:
            break
    return value


def resolve(path: str, element_id: str, values: dict[str, Any], plan: dict[str, Any]) -> Any:
    """The placeholder rule (docs/reference.qmd, "Placeholders"): `state` from its root; then, from the element
    outward, what each scope holds under the name; then an element's result, by id or unique name; then, for a lone
    `{reached}`, the element's own counter, 0 when no run reached it. `None` when nothing holds the name."""
    head, *fields = path.split(".")
    tree = values.get("state") or {}
    if head == "state":
        return dig(tree, fields)
    elements = plan.get("elements") or {}
    scope = element_id
    while scope:
        found = dig(tree.get(scope), [head, *fields])
        if found is not None:
            return found
        scope = (elements.get(scope) or {}).get("parent")
    ids = {name: eid for eid, name in (plan.get("names") or {}).items()}
    found = dig(values.get(head, values.get(ids.get(head, ""))), fields)
    if found is None and head == "reached" and not fields:
        # The element's own counter, never a container's: one no run reached counts 0.
        return dig(tree.get("_meta"), ["reached", element_id]) or 0
    return found


def fill(text: Any, element_id: str, values: dict[str, Any], plan: dict[str, Any]) -> str:
    """A text with each placeholder that resolves filled in, and one that does not left as written. YAML reads an
    unquoted `{name}` as a one-key mapping; that is the placeholder too."""
    if isinstance(text, dict) and len(text) == 1 and None in text.values():
        text = f"{{{next(iter(text))}}}"
    return PLACEHOLDER.sub(lambda m: m.group(0) if (v := resolve(m.group(1), element_id, values, plan)) is None else str(v), str(text))


def read(text: Any, element_id: str, values: dict[str, Any], plan: dict[str, Any]) -> Any:
    """A text that is one placeholder alone is what it names, as it is held (a number stays a number, and nothing is
    `None`); any other text is filled; what is no text is itself."""
    if not isinstance(text, str):
        return text
    whole = PLACEHOLDER.fullmatch(text.strip())
    return resolve(whole.group(1), element_id, values, plan) if whole else fill(text, element_id, values, plan)


class Step:
    """One hand-off: an element to run, or one message to a pool this runner plays."""

    def __init__(self, element_id: str, plan: dict[str, Any], values: dict[str, Any], message: dict[str, Any] | None = None,
                 run_dir: Path | None = None, cache: Path | None = None, wire: "_Wire | None" = None,
                 conversation: dict[str, Any] | None = None) -> None:
        self.id = element_id
        self.plan = plan
        self.elements: dict[str, dict[str, Any]] = plan.get("elements") or {}
        self.element: dict[str, Any] = self.elements.get(element_id) or {}
        # The run's values as handed over: each element's by its id, and the state tree under `state`.
        self.values = values
        # The message sent to the pool, when the element is a pool this runner plays.
        self.message = message
        # When that pool remembers (its actor's `memory: conversation`): `{"id", "turn"}`, the conversation the message
        # belongs to (one per instance of the pool asking) and how many exchanges of it came before. What was said is
        # the runner's to keep; a `turn` it has no record of means it was started again, and lost the conversation.
        self.conversation = conversation
        self.options: dict[str, Any] = plan.get("options") or {}
        self.seed = (plan.get("study") or {}).get("seed")
        self.run_dir = run_dir or Path.cwd()
        self.cache = cache or self.run_dir / ".cache"
        self.bound: dict[str, Any] = {}
        self.written: dict[str, dict[str, Any]] = {}
        self.record: dict[str, Any] = {}
        self._wire = wire
        self._inbox: "queue.Queue[dict[str, Any] | None]" = queue.Queue()
        self._cancelled = threading.Event()

    # --- what the step hands back ---

    def bind(self, key: str, value: Any) -> None:
        """A value later steps read, under the id it is bound to (a data edge's target). The step's own result is what
        `execute` returns."""
        self.bound[key] = value

    def outputs(self, result: Any) -> None:
        """Bind `result` into each of the element's data outputs, narrowed by that edge's `transformation` (FEEL over
        `result`: `result.trials`), as the walk binds what a step it runs itself makes."""
        for binding in self.element.get("outputs") or []:
            if binding.get("target"):
                narrowed = evaluate(binding["transformation"], {"result": result}) if binding.get("transformation") else result
                self.bind(binding["target"], narrowed)

    def write(self, scope: str, name: str, value: Any) -> None:
        """A property of a scope: `state.<scope>.<name>`."""
        self.written.setdefault(scope, {})[name] = value

    def note(self, **record: Any) -> None:
        """What the step ran with (a package version, a model digest, the request as sent): kept in its record, never
        read as a value."""
        self.record.update(record)

    # --- what the step reads ---

    def resolve(self, path: str, scope: str | None = None) -> Any:
        return resolve(path, scope or self.id, self.values, self.plan)

    def fill(self, text: Any, scope: str | None = None) -> str:
        return fill(text, scope or self.id, self.values, self.plan)

    def read(self, text: Any, scope: str | None = None) -> Any:
        return read(text, scope or self.id, self.values, self.plan)

    # --- messages, along the flows of the element (or of the sub-process or pool around it) ---

    def send(self, flow: str, content: Any, id: str | None = None, in_reply_to: str | None = None) -> None:  # noqa: A002 - the message's own field
        message = {"element": self.id, "flow": flow, "content": content}
        if id:
            message["id"] = id
        if in_reply_to:
            message["inReplyTo"] = in_reply_to
        if self._wire:
            self._wire.notify("message", message)

    def receive(self, timeout: float | None = None) -> dict[str, Any] | None:
        """The next message into the element: `{"id", "flow", "content", "inReplyTo"?}`. None when `timeout` seconds
        pass without one; raises `Cancelled` when the walk stops the step."""
        try:
            message = self._inbox.get(timeout=timeout)
        except queue.Empty:
            return None
        if message is None:
            raise Cancelled(f"{self.id} was stopped")
        return message

    def ask(self, flow: str, content: Any, id: str, timeout: float | None = None) -> dict[str, Any] | None:  # noqa: A002
        """Send a message and wait for the one that answers it (`inReplyTo`); others that arrive meanwhile are dropped."""
        self.send(flow, content, id=id)
        deadline = None if timeout is None else time.monotonic() + timeout
        while True:
            left = None if deadline is None else max(0.0, deadline - time.monotonic())
            message = self.receive(left)
            if message is None or message.get("inReplyTo") == id:
                return message

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    def prompt(self, text: str, default: str = "") -> str:
        """Ask the person running the study, on the walk's terminal; `default` when there is none to ask."""
        return str(self._wire.request("prompt", {"element": self.id, "text": text, "default": default})) if self._wire else default

    def log(self, text: str) -> None:
        if self._wire:
            self._wire.notify("log", {"element": self.id, "text": text})
        else:
            print(text, file=sys.stderr)

    def handback(self, result: Any, started: float) -> dict[str, Any]:
        out: dict[str, Any] = {"durationMs": round((time.perf_counter() - started) * 1000, 1)}
        if result is not None:
            out["result"] = result
        for key, held in (("values", self.bound), ("state", self.written), ("record", self.record)):
            if held:
                out[key] = held
        return out


class _Wire:
    """JSON-RPC 2.0, one message a line: requests in, responses and notifications out, and requests of its own."""

    def __init__(self, reader: Any, writer: Any) -> None:
        self.reader, self.writer = reader, writer
        self.lock = threading.Lock()
        self.asked = 0
        self.answers: dict[str, "queue.Queue[dict[str, Any]]"] = {}
        self.ending: Any = None  # the `shutdown` request, answered once the runner has closed

    def send(self, message: dict[str, Any]) -> None:
        with self.lock:
            self.writer.write(json.dumps({"jsonrpc": "2.0", **message}, default=str, separators=(",", ":")) + "\n")
            self.writer.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"method": method, "params": params})

    def request(self, method: str, params: dict[str, Any]) -> Any:
        with self.lock:
            self.asked += 1
            request_id = f"r{self.asked}"
        answer: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self.answers[request_id] = answer
        self.send({"id": request_id, "method": method, "params": params})
        return answer.get().get("result")


class _Log:
    """The runner's `print`s: each line a `log` notification, named for the element whose hand-off printed it."""

    def __init__(self, wire: _Wire, current: threading.local) -> None:
        self.wire, self.current, self.pending = wire, current, ""

    def write(self, text: str) -> int:
        *lines, self.pending = (self.pending + text).split("\n")
        for line in lines:
            if line.strip():
                self.wire.notify("log", {"element": getattr(self.current, "element", None), "text": line.rstrip()})
        return len(text)

    def flush(self) -> None:
        pass


def serve(claims: Callable[[dict[str, Any]], Any], execute: Callable[[Step], Any], *, live: bool = True,
          name: str | None = None, close: Callable[[], None] | None = None, terminal: bool = False) -> int:
    """Speak the contract on stdin and stdout until the walk says `shutdown`. `claims(plan)` answers with the ids of
    the elements this runner takes (or `{"elements": [...], "live": False}` for ones a re-run may skip);
    `execute(step)` runs one and returns its result, raising on failure: what it had bound by then is still handed
    back. One hand-off at a time runs on the main thread; one that overlaps it (two pools, or two paths of one, at once) runs on a thread of
    its own. `close()` runs at shutdown.
    `terminal` leaves what the runner prints on the terminal, for one a person sits at."""
    # The wire keeps the two pipes to itself: a command the runner starts reads nothing from it and writes to the
    # terminal, a `print` is a line for the run log, and `input()` finds no one (ask with `step.prompt`).
    wire = _Wire(os.fdopen(os.dup(0), "r", encoding="utf-8"), os.fdopen(os.dup(1), "w", encoding="utf-8"))
    os.dup2(os.open(os.devnull, os.O_RDONLY), 0)
    os.dup2(2, 1)
    sys.stdin = open(os.devnull)  # noqa: SIM115 - for the life of the process
    current = threading.local()
    sys.stdout = sys.stderr if terminal else _Log(wire, current)  # type: ignore[assignment]
    plan: dict[str, Any] = {}
    run: dict[str, Any] = {}
    steps: dict[str, Step] = {}

    def perform(request_id: Any, params: dict[str, Any]) -> None:
        element_id = str(params.get("element"))
        step = Step(element_id, plan, params.get("values") or {}, params.get("message"),
                    Path(run.get("dir") or "."), Path(run.get("cache") or ".cache"), wire, params.get("conversation"))
        steps[element_id] = step
        current.element = element_id
        started = time.perf_counter()
        try:
            result = execute(step)
            wire.send({"id": request_id, "result": step.handback(result, started)})
        except BaseException as error:  # noqa: BLE001 - reported to the walk, which records it
            wire.send({"id": request_id, "error": {
                "code": 2 if isinstance(error, Cancelled) else 1,
                "message": f"{type(error).__name__}: {error}",
                "data": step.handback(None, started),
            }})
        finally:
            steps.pop(element_id, None)

    # Hand-offs run here, on the main thread, where a library may insist on being (a GUI toolkit, a signal handler);
    # one that arrives while another runs gets a thread of its own. The wire is read beside them.
    work: "queue.Queue[tuple[Any, dict[str, Any]] | None]" = queue.Queue()
    free = threading.Event()
    free.set()

    def listen() -> None:
        nonlocal plan, run
        for line in wire.reader:
            if not line.strip():
                continue
            message = json.loads(line)
            method, params, request_id = message.get("method"), message.get("params") or {}, message.get("id")
            if method is None:  # an answer to a request of ours
                waiting = wire.answers.pop(str(request_id), None)
                if waiting:
                    waiting.put(message)
            elif method == "initialize":
                try:
                    plan = json.loads(Path(params["plan"]).read_text())
                    run = params.get("run") or {}
                    claimed = claims(plan)
                except Exception as error:  # noqa: BLE001 - what it lacks to run this study (a build, a device), said before the walk starts
                    wire.send({"id": request_id, "error": {"code": 1, "message": f"{type(error).__name__}: {error}"}})
                    continue
                answer = claimed if isinstance(claimed, dict) else {"elements": claimed, "live": live}
                wire.send({"id": request_id, "result": {"protocol": PROTOCOL, "runner": name or Path(sys.argv[0]).resolve().parent.name, **answer}})
            elif method == "execute":
                if free.is_set():
                    free.clear()
                    work.put((request_id, params))
                else:
                    threading.Thread(target=perform, args=(request_id, params), daemon=True).start()
            elif method == "message":
                step = steps.get(str(params.get("element")))
                if step:
                    step._inbox.put(params.get("message"))
            elif method == "cancel":
                step = steps.get(str(params.get("element")))
                if step:
                    step._cancelled.set()
                    step._inbox.put(None)
            elif method == "shutdown":
                work.put(None)
                wire.ending = request_id
                return
            elif request_id is not None:
                wire.send({"id": request_id, "error": {"code": -32601, "message": f"no method {method}"}})
        # The walk is gone without a word: what runs is stopped.
        for step in list(steps.values()):
            step._cancelled.set()
            step._inbox.put(None)
        work.put(None)

    threading.Thread(target=listen, daemon=True).start()
    while (job := work.get()) is not None:
        perform(*job)
        free.set()
    if close:
        close()
    if wire.ending is not None:
        wire.send({"id": wire.ending, "result": {}})
    return 0

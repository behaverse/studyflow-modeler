"""FEEL, the expression language of Studyflow's conditions and data-edge selections, in Python.

FEEL (Friendly Enough Expression Language) is the expression language of the OMG's DMN standard, BPMN's
sibling. Every expression a study writes (a flow's condition, a loop's condition, a conditional event, a data
edge's `transformation`) is FEEL, in both runtimes: the browser runtime and the modeler evaluate it with `feelin`
(packages/core/src/expression/feel.ts), and this module evaluates the subset below the same way. One fixture,
tests/fixtures/feel.json, pins the two against each other row by row.

The subset: literals (numbers, "strings", true, false, null, [lists], {"key": value} contexts); names and paths
(`a.b.c`, a missing key is null); 1-based indexing (`list[1]`); `+ - * /`, unary minus; `= != < <= > >=`;
`and`, `or` (three-valued), `not(x)`; `x in [a, b]`; `if c then a else b`; and the functions `contains`,
`starts with`, `ends with`, `substring after`, `substring before`, `upper case`, `lower case`, `string length`, `count`, `sum`, `min`, `max`, `mean`, `abs`,
`is defined`. As in FEEL, an operation on a value of the wrong type is null rather than an error, and null
propagates; a name no scope declares is an error here (feelin warns), so a misspelt name never passes as null.
A condition holds only when it evaluates to `true`.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = ["evaluate", "holds", "FeelError"]


class FeelError(ValueError):
    """An expression that is not FEEL, or names something no scope declares."""


_TOKEN = re.compile(r"""
    (?P<space>\s+)
  | (?P<number>\d+(?:\.\d+)?|\.\d+)
  | (?P<string>"(?:[^"\\]|\\.)*")
  | (?P<op><=|>=|!=|\.\.|[-+*/=<>()\[\]{},.:])
  | (?P<name>[A-Za-z_$?][A-Za-z0-9_$?]*)
""", re.VERBOSE)

_FUNCTIONS = ("upper case", "lower case", "string length", "starts with", "ends with", "is defined",
              "substring after", "substring before")
_KEYWORDS = {"and", "or", "if", "then", "else", "in", "true", "false", "null"}


def _tokens(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    position = 0
    while position < len(text):
        match = _TOKEN.match(text, position)
        if not match:
            raise FeelError(f"not FEEL: unexpected {text[position]!r} at {position} in {text!r}")
        kind = match.lastgroup or ""
        if kind != "space":
            out.append((kind, match.group()))
        position = match.end()
    # Two-word function names are one token when a parenthesis follows (`upper case(x)`).
    merged: list[tuple[str, str]] = []
    index = 0
    while index < len(out):
        if (index + 2 < len(out) and out[index][0] == "name" and out[index + 1][0] == "name"
                and f"{out[index][1]} {out[index + 1][1]}" in _FUNCTIONS and out[index + 2] == ("op", "(")):
            merged.append(("name", f"{out[index][1]} {out[index + 1][1]}"))
            index += 2
            continue
        merged.append(out[index])
        index += 1
    return merged


class _Parser:
    def __init__(self, text: str) -> None:
        self.text = text
        self.tokens = _tokens(text)
        self.index = 0

    def peek(self, offset: int = 0) -> tuple[str, str] | None:
        at = self.index + offset
        return self.tokens[at] if at < len(self.tokens) else None

    def take(self, value: str | None = None) -> tuple[str, str]:
        token = self.peek()
        if token is None or (value is not None and token[1] != value):
            raise FeelError(f"not FEEL: expected {value or 'more'} in {self.text!r}")
        self.index += 1
        return token

    def at(self, value: str) -> bool:
        token = self.peek()
        return token is not None and token[1] == value and token[0] in ("op", "name")

    def parse(self) -> tuple:
        node = self.expression()
        if self.peek() is not None:
            raise FeelError(f"not FEEL: unexpected {self.peek()[1]!r} in {self.text!r}")
        return node

    def expression(self) -> tuple:
        if self.at("if"):
            self.take("if")
            condition = self.expression()
            self.take("then")
            then = self.expression()
            self.take("else")
            return ("if", condition, then, self.expression())
        return self.disjunction()

    def disjunction(self) -> tuple:
        node = self.conjunction()
        while self.at("or"):
            self.take()
            node = ("or", node, self.conjunction())
        return node

    def conjunction(self) -> tuple:
        node = self.comparison()
        while self.at("and"):
            self.take()
            node = ("and", node, self.comparison())
        return node

    def comparison(self) -> tuple:
        node = self.additive()
        token = self.peek()
        if token and token[0] == "op" and token[1] in ("=", "!=", "<", "<=", ">", ">="):
            self.take()
            return ("cmp", token[1], node, self.additive())
        if self.at("in"):
            self.take()
            return ("in", node, self.additive())
        return node

    def additive(self) -> tuple:
        node = self.multiplicative()
        while self.peek() and self.peek()[0] == "op" and self.peek()[1] in ("+", "-"):
            node = ("arith", self.take()[1], node, self.multiplicative())
        return node

    def multiplicative(self) -> tuple:
        node = self.unary()
        while self.peek() and self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            node = ("arith", self.take()[1], node, self.unary())
        return node

    def unary(self) -> tuple:
        if self.peek() == ("op", "-"):
            self.take()
            return ("neg", self.unary())
        return self.postfix()

    def postfix(self) -> tuple:
        node = self.primary()
        while True:
            if self.peek() == ("op", "."):
                self.take()
                token = self.take()
                if token[0] != "name":
                    raise FeelError(f"not FEEL: a path needs a name after '.' in {self.text!r}")
                node = ("path", node, token[1])
            elif self.peek() == ("op", "["):
                self.take()
                index = self.expression()
                self.take("]")
                if index == ("lit", 0):
                    raise FeelError(f"not FEEL: [0] in {self.text!r} (a FEEL list starts at 1)")
                node = ("index", node, index)
            else:
                return node

    def primary(self) -> tuple:
        token = self.take()
        kind, value = token
        if kind == "number":
            return ("lit", float(value) if "." in value else int(value))
        if kind == "string":
            return ("lit", bytes(value[1:-1], "utf-8").decode("unicode_escape"))
        if kind == "name":
            if value in ("true", "false"):
                return ("lit", value == "true")
            if value == "null":
                return ("lit", None)
            if value in _KEYWORDS:
                raise FeelError(f"not FEEL: unexpected {value!r} in {self.text!r}")
            if self.peek() == ("op", "("):
                self.take()
                args = []
                while not self.at(")"):
                    args.append(self.expression())
                    if not self.at(")"):
                        self.take(",")
                self.take(")")
                return ("call", value, args)
            return ("name", value)
        if value == "(":
            node = self.expression()
            self.take(")")
            return node
        if value == "[":
            items = []
            while not self.at("]"):
                items.append(self.expression())
                if not self.at("]"):
                    self.take(",")
            self.take("]")
            return ("list", items)
        if value == "{":
            entries = []
            while not self.at("}"):
                key = self.take()
                if key[0] not in ("name", "string"):
                    raise FeelError(f"not FEEL: a context key must be a name or a string in {self.text!r}")
                self.take(":")
                entries.append((key[1].strip('"') if key[0] == "string" else key[1], self.expression()))
                if not self.at("}"):
                    self.take(",")
            self.take("}")
            return ("context", entries)
        raise FeelError(f"not FEEL: unexpected {value!r} in {self.text!r}")


def _host(value: Any) -> Any:
    """A host value as FEEL sees it: a series or an array as a list, a numpy scalar as a number."""
    if isinstance(value, (dict, list, str, int, float, bool)) or value is None:
        return value
    tolist = getattr(value, "tolist", None)
    return tolist() if callable(tolist) else value


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _tidy(value: float) -> Any:
    return int(value) if isinstance(value, float) and value.is_integer() and abs(value) < 2**53 else value


def _equal(left: Any, right: Any) -> Any:
    if left is None or right is None:
        return left is None and right is None
    if _number(left) and _number(right):
        return left == right
    if type(left) is not type(right):
        return None
    return left == right


def _compare(op: str, left: Any, right: Any) -> Any:
    if op == "=":
        return _equal(left, right)
    if op == "!=":
        same = _equal(left, right)
        return None if same is None else not same
    if left is None or right is None:
        return None
    comparable = (_number(left) and _number(right)) or (isinstance(left, str) and isinstance(right, str))
    if not comparable:
        return False  # as feelin orders two values of different types
    return {"<": left < right, "<=": left <= right, ">": left > right, ">=": left >= right}[op]


def _call(name: str, args: list[Any]) -> Any:
    def text(i: int) -> str | None:
        return args[i] if i < len(args) and isinstance(args[i], str) else None

    def numbers() -> list | None:
        items = args[0] if len(args) == 1 and isinstance(args[0], list) else args
        return items if items and all(_number(x) for x in items) else None

    if name == "not":
        return (not args[0]) if len(args) == 1 and isinstance(args[0], bool) else None
    if name in ("contains", "starts with", "ends with"):
        s, sub = text(0), text(1)
        if s is None or sub is None:
            return None
        return {"contains": sub in s, "starts with": s.startswith(sub), "ends with": s.endswith(sub)}[name]
    if name in ("upper case", "lower case", "string length"):
        s = text(0)
        if s is None:
            return None
        return s.upper() if name == "upper case" else s.lower() if name == "lower case" else len(s)
    if name in ("substring after", "substring before"):
        s, match = text(0), text(1)
        if s is None or match is None:
            return None
        head, found, tail = s.partition(match)
        return (tail if name == "substring after" else head) if found else ""
    if name == "count":
        return len(args[0]) if len(args) == 1 and isinstance(args[0], list) else None
    if name in ("sum", "min", "max", "mean"):
        items = numbers()
        if items is None:
            return None
        if name == "sum":
            return _tidy(sum(items))
        if name == "mean":
            return _tidy(sum(items) / len(items))
        return min(items) if name == "min" else max(items)
    if name == "abs":
        return abs(args[0]) if len(args) == 1 and _number(args[0]) else None
    raise FeelError(f"FEEL function {name!r} is not in the subset Studyflow runs")


def _eval(node: tuple, scope: dict[str, Any]) -> Any:
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "name":
        if node[1] not in scope:
            raise FeelError(f"{node[1]!r} is not declared by any scope in this run")
        return _host(scope[node[1]])
    if kind == "path":
        base = _eval(node[1], scope)
        if isinstance(base, dict):
            return base.get(node[2])
        if isinstance(base, list):  # FEEL projects a path over a list
            return [item.get(node[2]) if isinstance(item, dict) else None for item in base]
        if base is not None and not isinstance(base, (str, int, float, bool)):
            # A host value's field: a table's column (`result.trials`), else an object's attribute
            # (`result.pvalue` of a test result). Beyond FEEL's own values, for what a python:// step returns.
            try:
                return _host(base[node[2]])
            except (KeyError, IndexError, TypeError, ValueError):
                return _host(getattr(base, node[2], None))
        return None
    if kind == "index":
        base, index = _eval(node[1], scope), _eval(node[2], scope)
        base = list(base) if isinstance(base, tuple) else base
        if isinstance(base, list) and isinstance(index, int) and not isinstance(index, bool):
            at = index - 1 if index > 0 else len(base) + index
            return base[at] if 0 <= at < len(base) else None
        if isinstance(index, bool) or not isinstance(base, list):
            raise FeelError("a filter (`list[condition]`) is not in the subset Studyflow runs")
        return None
    if kind == "list":
        return [_eval(item, scope) for item in node[1]]
    if kind == "context":
        return {key: _eval(value, scope) for key, value in node[1]}
    if kind == "neg":
        value = _eval(node[1], scope)
        return -value if _number(value) else None
    if kind == "arith":
        left, right = _eval(node[2], scope), _eval(node[3], scope)
        op = node[1]
        if op == "+" and isinstance(left, str) and isinstance(right, str):
            return left + right
        if not (_number(left) and _number(right)):
            return None
        if op == "/":
            return None if right == 0 else _tidy(left / right)
        return _tidy({"+": left + right, "-": left - right, "*": left * right}[op])
    if kind == "cmp":
        return _compare(node[1], _eval(node[2], scope), _eval(node[3], scope))
    if kind == "in":
        value, collection = _eval(node[1], scope), _eval(node[2], scope)
        if isinstance(collection, list):
            return any(_equal(value, item) is True for item in collection)
        return _equal(value, collection)
    if kind in ("and", "or"):
        left, right = _eval(node[1], scope), _eval(node[2], scope)
        left = left if isinstance(left, bool) else None
        right = right if isinstance(right, bool) else None
        if kind == "and":
            if left is False or right is False:
                return False
            return True if left is True and right is True else None
        if left is True or right is True:
            return True
        return False if left is False and right is False else None
    if kind == "if":
        return _eval(node[2] if _eval(node[1], scope) is True else node[3], scope)
    if kind == "call":
        if node[1] == "is defined":
            argument = node[2][0] if len(node[2]) == 1 else None
            if argument is not None and argument[0] == "name":
                return argument[1] in scope
            try:
                return _eval(argument, scope) is not None if argument else None
            except FeelError:
                return False
        return _call(node[1], [_eval(arg, scope) for arg in node[2]])
    raise FeelError(f"cannot evaluate {kind}")


_PARSED: dict[str, tuple] = {}


def parse(expression: str) -> tuple:
    """The expression's syntax tree; a FeelError when it is not FEEL in the subset."""
    if expression not in _PARSED:
        _PARSED[expression] = _Parser(expression).parse()
    return _PARSED[expression]


def evaluate(expression: str, scope: dict[str, Any]) -> Any:
    """The value of a FEEL expression over the names in `scope`."""
    return _eval(parse(expression.strip()), scope)


def holds(expression: str, scope: dict[str, Any]) -> bool:
    """Whether a condition holds: only `true` does; false, null, and any other value do not."""
    return evaluate(expression, scope) is True

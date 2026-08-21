"""Provenance for studyflow-run: the run repository, the records, and the prov timeline.

`studyflow-run.py` loads this module from beside itself (or `STUDYFLOW_PROV_PY`)
and overrides `log_event` and `shown` with its own; without this file a run
still executes, with no repository, no records, and no reuse.
"""

from __future__ import annotations

import getpass
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from xml.sax.saxutils import quoteattr


# studyflow-run overrides these two with its own logging when it loads this module.
def log_event(event: str, message: str, *, level: int = logging.INFO, **_: Any) -> None:
    print(message, file=sys.stderr)


def shown(path: Path) -> Path:
    return path


def local(element: ET.Element) -> str:
    return element.tag.split("}")[-1]


PROV_TIMELINE = "https://w3id.org/studyflow/prov"


TIMELINE_FIELDS = ("action", "when", "who", "with", "what", "run", "seed", "note")


def insert_element_entry(xml: str, element_id: str, replace_action: str | None = None, **fields: str) -> str:
    """Text, not tree: ElementTree rewrites every namespace prefix, so a stamped copy would diff everywhere."""
    definitions = re.search(r"<(?:[\w.-]+:)?definitions\b[^>]*>", xml)
    if definitions is None:
        return xml

    bound = re.search(rf'xmlns:([\w.-]+)\s*=\s*"{re.escape(PROV_TIMELINE)}"', xml)
    if bound:
        prefix = bound.group(1)
    else:
        prefix = "prov" if not re.search(r'xmlns:prov\s*=\s*"', xml) else "sfprov"
        opening = definitions.group(0)
        declared = opening[:-1].rstrip("/") + f' xmlns:{prefix}="{PROV_TIMELINE}">'
        xml = xml[:definitions.start()] + declared + xml[definitions.end():]

    ordered = [(name, fields[name]) for name in TIMELINE_FIELDS if fields.get(name)]
    entry = f"<{prefix}:activity " + " ".join(f"{k}={quoteattr(v)}" for k, v in ordered) + " />"

    element = re.search(rf'<((?:[\w.-]+:)?)[\w.-]+\b[^>]*\bid="{re.escape(element_id)}"[^>]*>', xml)
    if element is None or element.group(0).endswith("/>"):
        return xml

    line_start = xml.rfind("\n", 0, element.start()) + 1
    lead = xml[line_start:element.start()]
    indent = lead if lead.isspace() or lead == "" else ""

    cursor = element.end()
    while True:
        doc = re.match(r"\s*<((?:[\w.-]+:)?)documentation\b[^>]*>", xml[cursor:])
        if doc is None:
            break
        if doc.group(0).endswith("/>"):
            cursor += doc.end()
        else:
            close = f"</{doc.group(1)}documentation>"
            cursor = xml.index(close, cursor + doc.end()) + len(close)

    existing = re.match(r"\s*<((?:[\w.-]+:)?)extensionElements>", xml[cursor:])
    if existing:
        block_open_end = cursor + existing.end()
        close_tag = f"</{existing.group(1)}extensionElements>"
        close_at = xml.index(close_tag, block_open_end)
        block = xml[block_open_end:close_at]
        # Only the same-action entry is replaced; `invalidated` markers are history and are never deleted —
        # the fresh `executed` gets a new `when`, so a marker referencing the old one (`what`) goes inert.
        if replace_action:
            block = re.sub(
                rf"\n[ \t]*<{re.escape(prefix)}:activity\b[^>]*\baction={re.escape(quoteattr(replace_action))}[^>]*/>",
                "", block,
            )
        block = block.rstrip() + "\n" + indent + "    " + entry + "\n" + indent + "  "
        return xml[:block_open_end] + block + xml[close_at:]

    wrapper_prefix = element.group(1)
    block = (
        f"\n{indent}  <{wrapper_prefix}extensionElements>"
        f"\n{indent}    {entry}"
        f"\n{indent}  </{wrapper_prefix}extensionElements>"
    )
    return xml[:cursor] + block + xml[cursor:]


def timeline_entries(element: ET.Element) -> tuple[list[dict], list[tuple[str | None, str | None]]]:
    """An element's `executed` entries in document (= chronological) order, and its markers."""
    executed: list[dict] = []
    markers: list[tuple[str | None, str | None]] = []
    for ext in element:
        if local(ext) != "extensionElements":
            continue
        for child in ext:
            if child.tag != f"{{{PROV_TIMELINE}}}activity":
                continue
            action = child.get("action")
            if action == "executed" and child.get("run"):
                executed.append({"run": child.get("run"), "when": child.get("when"), "what": child.get("what")})
            elif action == "invalidated":
                markers.append((child.get("run"), child.get("what")))
    return executed, markers


def element_records(studyflow) -> dict[str, dict]:
    """Element id -> its standing `executed` record: the newest not voided. A marker voids by exact
    `when` (its `what`), or — lacking a `what` — coarsely by run, a standing re-run pin. Older
    entries a branching run superseded are the first branch's history and never stand."""
    records: dict[str, dict] = {}
    process_id = studyflow.process.get("id")
    for element_id, element in studyflow.elements.items():
        if element_id == process_id:
            continue
        executed, markers = timeline_entries(element)
        if not executed:
            continue
        # Only the newest entry may stand: an older one is superseded even when unvoided.
        newest = executed[-1]
        voided = any(
            what == newest["when"] if what else (not run or run == newest["run"])
            for run, what in markers
        )
        if not voided:
            records[element_id] = newest
    return records


def invalidated_elements(studyflow) -> list[str]:
    """Elements whose ✕ marker names the newest record (`what` = its `when`) — only these branch.
    Coarse markers without a `what` re-run their step in place and never branch."""
    marked: list[str] = []
    for element_id, element in studyflow.elements.items():
        executed, markers = timeline_entries(element)
        newest = executed[-1].get("when") if executed else None
        if newest and any(what == newest for _, what in markers if what):
            marked.append(element_id)
    return marked


def digest_of(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def current_user() -> str:
    try:
        return getpass.getuser()
    except OSError:
        return ""


class RunRecord:
    def __init__(
        self,
        plan: str,
        seed: str | None,
        started: datetime,
        run: str = "",
        who: str = "",
        tool: str = "studyflow-run.py",
    ) -> None:
        self.plan_digest = digest_of(plan.encode())
        self.seed = seed
        self.started = started
        self.run = run
        self.who = who
        self.tool = tool
        self.status = "ok"
        self.finished: datetime | None = None
        self.entries: list[dict] = []

    def begin(self, element_id: str, name: str, element_type: str) -> dict:
        entry: dict[str, Any] = {
            "node": element_id,
            "name": name,
            "type": element_type,
            "startedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "status": "ok",
        }
        entry["_clock"] = time.perf_counter()
        self.entries.append(entry)
        return entry

    def end(self, entry: dict) -> None:
        entry["durationMs"] = round((time.perf_counter() - entry.pop("_clock")) * 1000, 1)

    def fail(self, entry: dict, error: BaseException) -> None:
        entry["status"] = "error"
        entry["error"] = {
            "type": type(error).__name__,
            "message": str(error)[:400],
            "traceback": traceback.format_exc().splitlines()[-6:],
        }
        self.status = "error"
        if "_clock" in entry:
            self.end(entry)

    def finish(self, status: str) -> None:
        self.status = status
        self.finished = datetime.now(timezone.utc)

    def header(self) -> dict:
        return {
            "studyflow": self.plan_digest,
            "run": self.run,
            "seed": self.seed,
            "who": self.who,
            "with": self.tool,
            # UTC throughout, like every step's `startedAt`; the timeline keeps the local-offset stamps.
            "startedAt": self.started.astimezone(timezone.utc).isoformat(timespec="milliseconds"),
        }

    def summary(self) -> dict:
        return {
            "status": self.status,
            "finishedAt": self.finished.isoformat(timespec="milliseconds") if self.finished else None,
            "steps": len(self.entries),
        }

    def steps_since(self, index: int) -> list[dict]:
        # `_clock` is the running duration timer, still on the step being written mid-run.
        return [{k: v for k, v in entry.items() if k != "_clock"} for entry in self.entries[index:]]


class RunRepo:
    """The run directory as a git repository. Replication never fails a run: git trouble degrades to a no-op."""

    # An inherited GIT_DIR would aim every command at the caller's repository instead of this one.
    SCRUBBED = ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")
    LFS_PATTERNS = ("*.joblib", "*.parquet", "*.png", "*.svg", "*.pdf")

    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.enabled = shutil.which("git") is not None
        self.lfs = self.enabled and shutil.which("git-lfs") is not None
        self.created = False
        self.env = {k: v for k, v in os.environ.items() if k not in self.SCRUBBED}
        if not self.enabled:
            log_event(
                "git.unavailable", "  no git on PATH — this run directory stays a plain folder",
                level=logging.WARNING,
            )
        elif not self.lfs:
            log_event(
                "git.lfs.unavailable", "  no git-lfs on PATH — artifacts are committed as plain blobs",
                level=logging.WARNING,
            )

    @property
    def active(self) -> bool:
        # Without a `.git` of its own the directory belongs to whatever repository contains it — never touch that.
        return self.enabled and (self.dir / ".git").is_dir()

    def git(
        self, *args: str, tolerate: bool = False, when: str | None = None, raw: bool = False,
    ) -> subprocess.CompletedProcess | None:
        """`tolerate` is for calls whose failure is an answer (no such ref), not a broken git.
        Without the directory's own `.git`, git would walk up into whatever repository contains
        it — so every call requires `active`, except `raw` ones that create the repo."""
        if not self.enabled or not (raw or self.active):
            return None
        env = dict(self.env)
        if when:
            env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = when
        try:
            done = subprocess.run(  # noqa: S603 - a fixed argv, never a shell
                ["git", "-C", str(self.dir), *args],
                capture_output=True, text=True, timeout=60, env=env, check=False,
            )
        except (OSError, subprocess.SubprocessError) as error:
            self.degrade(f"git {args[0]}: {type(error).__name__}: {error}")
            return None
        if done.returncode != 0 and not tolerate:
            detail = (done.stderr or done.stdout).strip().splitlines()
            self.degrade(f"git {args[0]} exited {done.returncode}: {detail[0] if detail else ''}")
            return None
        return done

    def degrade(self, reason: str) -> None:
        self.enabled = False
        log_event(
            "git.failed", f"  {reason} — the rest of this run is not replicated into git",
            level=logging.WARNING,
        )

    def open(self) -> None:
        """Init the directory, or adopt one a git-less run left — either way the next commit baselines it."""
        if not self.enabled or (self.dir / ".git").exists():
            return
        if self.git("-c", "init.defaultBranch=main", "init", "-q", raw=True) is None:
            return
        self.created = True
        who = current_user() or "studyflow-runner"
        self.git("config", "user.name", who)
        # RFC 2606's reserved TLD: an address git accepts and no mail ever leaves for.
        self.git("config", "user.email", f"{who}@studyflow.invalid")
        # A signing key the runner cannot unlock would fail every commit; provenance here is the history itself.
        self.git("config", "commit.gpgsign", "false")
        if self.lfs:
            # The filter has to be installed before `.gitattributes` declares it, or every later `add` fails.
            self.git("lfs", "install", "--local")
            (self.dir / ".gitattributes").write_text(
                "".join(f"{pattern} filter=lfs diff=lfs merge=lfs -text\n" for pattern in self.LFS_PATTERNS),
            )
        log_event("git.init", f"  → {shown(self.dir)}/.git", level=logging.DEBUG)

    def commit(
        self, subject: str, trailers: dict[str, str] | None = None,
        when: str | None = None, body: str | None = None,
    ) -> None:
        """One checkpoint: whatever the step wrote, plus the log lines, with its record entries as the body."""
        lines = [f"{key}: {value}" for key, value in (trailers or {}).items() if value]
        # Trailers must be the message's last block, so the body sits between subject and trailers.
        message = "\n\n".join(part for part in (subject, body, "\n".join(lines)) if part)
        if self.git("add", "-A") is None:
            return
        self.git("commit", "-q", "--allow-empty", "-m", message, when=when)

    def commit_for_node(self, element_id: str) -> str | None:
        """The newest commit that *executed* this element — skips near the tip are not where its work entered."""
        done = self.git(
            "log", "-1", "--format=%H", "--all-match",
            f"--grep=^Prov-Node: {re.escape(element_id)}$", "--grep=^Prov-Action: executed$", tolerate=True,
        )
        if done is None or done.returncode != 0:
            return None
        found = done.stdout.strip().splitlines()
        return found[0] if found else None

    def is_ancestor(self, commit: str, other: str) -> bool:
        done = self.git("merge-base", "--is-ancestor", commit, other, tolerate=True)
        return done is not None and done.returncode == 0

    def branch(self, name: str, commit: str | None = None) -> bool:
        """Checking a branch point out is the re-run: what was made after it leaves the worktree with it."""
        # No commit means a branch at HEAD, which checks nothing out: the worktree, and the open log, survive.
        if commit is None:
            done = self.git("switch", "-c", name, tolerate=True)
        else:
            # --discard-changes: what stands in the checkout's way is this run's own truncated log.
            done = self.git("switch", "--discard-changes", "-c", name, commit, tolerate=True)
        if done is not None and done.returncode != 0:
            log_event("git.branch.failed", f"  switch -c {name}: {done.stderr.strip()}", level=logging.WARNING)
        return done is not None and done.returncode == 0

    def current_branch(self) -> str:
        """Empty means a detached HEAD; a branch with no commits yet still answers with its name."""
        done = self.git("symbolic-ref", "--quiet", "--short", "HEAD", tolerate=True)
        return done.stdout.strip() if done is not None and done.returncode == 0 else ""

    def dirty(self) -> bool:
        """`studyflow.log` is left out: every run truncates it, which is not an edit from outside."""
        done = self.git("status", "--porcelain", "--", ".", ":(exclude)studyflow.log")
        return bool(done and done.stdout.strip())


def branch_point(repo: RunRepo, invalidated: list[str], from_ref: str | None) -> str | None:
    """Where a re-run branches: `--from`'s own commit, else the furthest back of the invalidated elements'."""
    if from_ref:
        return from_ref
    earliest: str | None = None
    for element_id in invalidated:
        commit = repo.commit_for_node(element_id)
        if commit and (earliest is None or repo.is_ancestor(commit, earliest)):
            earliest = commit
    return earliest


if __name__ == "__main__":
    print("studyflow-prov is the provenance module studyflow-run loads; run a study with studyflow-run.py", file=sys.stderr)
    sys.exit(2)

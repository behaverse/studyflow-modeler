"""A Chromium of its own for a page a runner serves, for a skill whose tool runs in a browser.

A runner serves its page from a local port and opens it here, in a Chromium found on this machine with a throwaway
profile, then closes it with `close`: the window or headless browser ends, the page stops being served, and the profile
goes. Without a Chromium, the runner opens the page in a tab of the default browser instead, which it cannot close.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

APPS = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "google-chrome", "chromium", "chromium-browser",
)
# Chrome throttles a window it takes to be unseen (occluded, on another Space) or a page in the background to 1 fps and
# slows its timers, which stretches every timed phase of a task to a second of wall clock; these keep it at full speed.
UNTHROTTLED = ("--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
               "--disable-background-timer-throttling")


def find() -> str | None:
    """The first Chromium this machine has, by path or on PATH; None when it has none."""
    return next((app for app in APPS if Path(app).is_file() or shutil.which(app)), None)


def profile_of(browser: subprocess.Popen) -> str:
    """The throwaway profile a Chromium was started with (`--user-data-dir=`)."""
    return next(arg.split("=", 1)[1] for arg in browser.args if str(arg).startswith("--user-data-dir="))


def close(server: Any, browser: subprocess.Popen | None) -> None:
    """Close the page's browser, stop serving the page (`server.shutdown()`), and throw the browser's profile away."""
    if browser is not None:
        browser.terminate()
    server.shutdown()
    if browser is None:
        return
    try:
        browser.wait(timeout=5)
    except subprocess.TimeoutExpired:
        browser.kill()
    shutil.rmtree(profile_of(browser), ignore_errors=True)

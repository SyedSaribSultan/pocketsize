"""The page and the compression worker speak the same contract version.

web/js/engine.js sends PROTOCOL with every job and web/worker.js stamps its own
on every reply; a mismatch means "another deploy" and is refused safely. That
only works if the two numbers are equal in any one commit, so this holds them
equal, and holds the service worker to waiting for the reload notice on an
update instead of taking over an open tab.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def protocol(path: Path) -> int:
    m = re.search(r"^(?:export )?const PROTOCOL = (\d+);", path.read_text(encoding="utf-8"), re.M)
    if not m:
        raise AssertionError(f"no PROTOCOL in {path.name}")
    return int(m.group(1))


class WorkerProtocol(unittest.TestCase):
    def test_page_and_worker_agree(self) -> None:
        self.assertEqual(protocol(WEB / "js" / "engine.js"), protocol(WEB / "worker.js"))

    def test_an_update_waits_for_the_reload(self) -> None:
        sw = (WEB / "sw.js").read_text(encoding="utf-8")
        self.assertIn("if (!self.registration.active) await self.skipWaiting();", sw)
        self.assertIn('"skip-waiting"', sw)


if __name__ == "__main__":
    unittest.main()
